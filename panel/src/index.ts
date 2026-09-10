/// Home Utilities Consumption Meter — panel Worker.
///
/// Serves a password-gated dashboard, accepts readings from the reader agents
/// over a bearer token, and answers the aggregate queries the dashboard charts.

import type { Env } from "./env";
import {
  MAX_ATTEMPTS,
  clearFailures,
  isLoggedIn,
  isValidIngestToken,
  recentFailures,
  recordFailure,
  sessionCookie,
  signSession,
  verifyPassword,
} from "./auth";
import { addDays, localDate, today } from "./dates";
import { buildSummary, hoursBetween, recompute, series, settingsFrom } from "./stats";
import { type UtilityId, enabledUtilities, isUtilityId } from "./utilities";
import { loginPage } from "./login";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Utility named by ?u=, falling back to the first one this panel shows. */
function utilityParam(url: URL, env: Env): UtilityId {
  const raw = url.searchParams.get("u");
  if (raw && isUtilityId(raw)) return raw;
  return enabledUtilities(env.UTILITIES)[0]!.id;
}

interface IngestBody {
  utility?: string;
  ts?: string;
  timestamp?: string;
  /** Preferred name for the counter value. */
  total?: number;
  /** Accepted for readers that emit wmbusmeters field names directly. */
  total_m3?: number;
  total_kwh?: number;
  target?: number;
  target_m3?: number;
  target_date?: string;
  battery_y?: number;
  rssi_dbm?: number;
  is_test?: number | boolean;
}

function counterOf(item: IngestBody): number {
  for (const v of [item.total, item.total_m3, item.total_kwh]) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return NaN;
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  if (!(await isValidIngestToken(request, env))) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const items = (Array.isArray(body) ? body : [body]) as IngestBody[];
  const settings = settingsFrom(env);
  const fallback = enabledUtilities(env.UTILITIES)[0]!.id;

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO readings
       (utility, ts, total, target, target_date, battery_y, rssi_dbm, raw, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const statements: D1PreparedStatement[] = [];
  // Earliest affected local date per utility, so each rebuild starts far enough back.
  const earliest = new Map<UtilityId, string>();

  for (const item of items) {
    const ts = item.ts ?? item.timestamp;
    const total = counterOf(item);
    if (!ts || Number.isNaN(total)) continue;

    const utility: UtilityId =
      item.utility && isUtilityId(item.utility) ? item.utility : fallback;
    const parsed = Date.parse(ts);
    if (Number.isNaN(parsed)) continue;
    const isoTs = new Date(parsed).toISOString();

    statements.push(
      insert.bind(
        utility,
        isoTs,
        total,
        item.target ?? item.target_m3 ?? null,
        item.target_date ?? null,
        item.battery_y ?? null,
        item.rssi_dbm ?? null,
        JSON.stringify(item),
        item.is_test ? 1 : 0,
      ),
    );

    const day = addDays(localDate(isoTs, settings.zone), -1);
    const seen = earliest.get(utility);
    if (!seen || day < seen) earliest.set(utility, day);
  }

  if (statements.length === 0) return json({ error: "no valid readings" }, 400);
  await env.DB.batch(statements);

  let recomputed = 0;
  for (const [utility, from] of earliest) {
    recomputed += await recompute(env, utility, settings, from);
  }
  return json({ inserted: statements.length, recomputed });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if ((await recentFailures(env, ip)) >= MAX_ATTEMPTS) {
    return json({ error: "Za dużo prób. Spróbuj ponownie za 15 minut." }, 429);
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    return json({ error: "Nieprawidłowe dane." }, 400);
  }

  if (!(await verifyPassword(password, env.PASSWORD_HASH))) {
    await recordFailure(env, ip);
    await sleep(1000); // blunt the pace of guessing
    return json({ error: "Nieprawidłowe hasło." }, 401);
  }

  await clearFailures(env, ip);
  const token = await signSession(env.SESSION_SECRET);
  return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie(token) } });
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === "/api/ingest" && request.method === "POST") return handleIngest(request, env);
  if (path === "/api/login" && request.method === "POST") return handleLogin(request, env);
  if (path === "/api/logout" && request.method === "POST") {
    return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie("", 0) } });
  }

  if (!(await isLoggedIn(request, env))) return json({ error: "unauthorized" }, 401);

  const settings = settingsFrom(env);
  const utility = utilityParam(url, env);

  if (path === "/api/config") {
    return json({ utilities: enabledUtilities(env.UTILITIES), time_zone: settings.zone });
  }

  if (path === "/api/summary") return json(await buildSummary(env, utility, settings));

  if (path === "/api/days") {
    const to = url.searchParams.get("to") ?? today(settings.zone);
    const from = url.searchParams.get("from") ?? addDays(to, -29);
    const { results } = await env.DB.prepare(
      "SELECT * FROM days WHERE utility = ? AND date >= ? AND date <= ? ORDER BY date ASC",
    )
      .bind(utility, from, to)
      .all();
    return json({ utility, from, to, days: results });
  }

  if (path === "/api/hours") {
    const to = url.searchParams.get("to") ?? today(settings.zone);
    const from = url.searchParams.get("from") ?? to;
    return json({ utility, from, to, hours: await hoursBetween(env, utility, from, to) });
  }

  if (path === "/api/series") {
    const g = url.searchParams.get("g");
    if (g !== "week" && g !== "month" && g !== "all") return json({ error: "bad group" }, 400);
    return json({ utility, group: g, points: await series(env, utility, g) });
  }

  if (path === "/api/occupancy" && request.method === "GET") {
    const to = url.searchParams.get("to") ?? today(settings.zone);
    const from = url.searchParams.get("from") ?? addDays(to, -13);
    const { results } = await env.DB.prepare(
      "SELECT date, persons FROM occupancy WHERE date >= ? AND date <= ? ORDER BY date DESC",
    )
      .bind(from, to)
      .all();
    return json({ from, to, occupancy: results });
  }

  if (path === "/api/occupancy" && request.method === "PUT") {
    let date = "";
    let persons = 0;
    try {
      const body = (await request.json()) as { date?: string; persons?: number };
      date = body.date ?? "";
      persons = Number(body.persons);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad date" }, 400);
    if (!Number.isInteger(persons) || persons < 1 || persons > 12) {
      return json({ error: "bad persons" }, 400);
    }

    await env.DB.prepare(
      "INSERT INTO occupancy (date, persons) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET persons = excluded.persons",
    )
      .bind(date, persons)
      .run();

    // Per-person figures change for every utility, not just the one on screen.
    let recomputed = 0;
    for (const u of enabledUtilities(env.UTILITIES)) {
      recomputed += await recompute(env, u.id, settings, date);
    }
    return json({ date, persons, recomputed });
  }

  if (path === "/api/readings" && request.method === "DELETE") {
    if (url.searchParams.get("test") !== "1") return json({ error: "refusing" }, 400);
    await env.DB.prepare("DELETE FROM readings WHERE utility = ? AND is_test = 1")
      .bind(utility)
      .run();
    await env.DB.prepare("DELETE FROM days WHERE utility = ?").bind(utility).run();
    await env.DB.prepare("DELETE FROM hours WHERE utility = ?").bind(utility).run();
    const recomputed = await recompute(env, utility, settings);
    return json({ ok: true, utility, recomputed });
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);

    // The dashboard itself is private, assets included.
    if (!(await isLoggedIn(request, env))) {
      return new Response(loginPage(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    const asset = await env.ASSETS.fetch(request);
    // The HTML shell is always revalidated so a deploy lands on the next visit.
    // Scripts and styles carry a version query, so they may be cached.
    if ((asset.headers.get("content-type") ?? "").includes("text/html")) {
      const fresh = new Response(asset.body, asset);
      fresh.headers.set("cache-control", "no-cache");
      return fresh;
    }
    return asset;
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Safety net: a reading may have landed late, or an occupancy edit may have
    // raced a rebuild. Redoing the last 45 days costs little at one row per day.
    const settings = settingsFrom(env);
    const from = addDays(today(settings.zone), -45);
    for (const u of enabledUtilities(env.UTILITIES)) {
      await recompute(env, u.id, settings, from);
    }
    const cutoff = Math.floor(Date.now() / 1000) - 86_400;
    await env.DB.prepare("DELETE FROM login_attempts WHERE ts < ?").bind(cutoff).run();
  },
};
