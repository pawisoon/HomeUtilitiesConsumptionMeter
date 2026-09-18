/// Made-up readings for the public demo.
///
/// Every number is derived from the date and hour alone, so the same hour
/// always consumes the same amount. A backfill and the hourly tick agree with
/// each other, and two runs that overlap insert identical rows that the
/// primary key then drops.
///
/// Only a panel with DEMO set to "1" ever calls into this file.

import type { Env } from "./env";
import { HOUR_MS, addDays, isWeekend, localDate, localHour } from "./dates";
import { holidayFor } from "./holidays";
import { recompute, settingsFrom } from "./stats";
import { type UtilityId, enabledUtilities } from "./utilities";

interface Profile {
  /** Base-unit use per person per day. */
  perPerson: number;
  /** Base-unit use per day that does not depend on who is home: fridge, router. */
  floor: number;
  /** Counter value the invented history starts from. */
  start: number;
  /** Decimals the meter reports. */
  decimals: number;
  /** Relative use per local hour, midnight first. */
  shape: number[];
}

const PROFILES: Record<UtilityId, Profile> = {
  water: {
    perPerson: 0.12,
    floor: 0,
    start: 412.318,
    decimals: 3,
    // Showers before work, cooking and baths in the evening.
    shape: [0.2, 0.1, 0.1, 0.1, 0.2, 0.7, 1.8, 2.3, 1.5, 0.9, 0.7, 0.8,
            1.0, 0.8, 0.6, 0.7, 1.0, 1.5, 2.0, 2.4, 1.9, 1.2, 0.6, 0.3],
  },
  electricity: {
    perPerson: 2.1,
    floor: 3.6,
    start: 18240.52,
    decimals: 2,
    // Kettle in the morning, oven, washing and lights in the evening.
    shape: [0.5, 0.4, 0.4, 0.4, 0.4, 0.6, 1.1, 1.5, 1.1, 0.8, 0.8, 0.9,
            1.1, 0.9, 0.8, 0.9, 1.2, 1.7, 2.2, 2.4, 2.1, 1.6, 1.0, 0.7],
  },
  gas: {
    perPerson: 0.35,
    floor: 0.4,
    start: 2526.058,
    decimals: 3,
    shape: [0.6, 0.5, 0.5, 0.5, 0.6, 1.2, 1.8, 1.8, 1.2, 0.9, 0.8, 0.8,
            1.0, 0.8, 0.8, 0.9, 1.1, 1.5, 1.8, 1.8, 1.5, 1.2, 0.9, 0.7],
  },
};

/** Stable pseudo-random number in [0, 1) for a string key. */
function rand(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Household size on a date: two usually, family over at weekends and holidays. */
export function demoPersons(date: string): number {
  const r = rand(`persons:${date}`);
  if (holidayFor(date)) return r < 0.5 ? 6 : 4;
  if (isWeekend(date)) return r < 0.45 ? 4 : 2;
  if (r < 0.08) return 1;
  if (r < 0.18) return 3;
  return 2;
}

/** Consumption in the hour that ends at `endMs`, in the utility's base unit. */
function hourUsage(utility: UtilityId, endMs: number, zone: string): number {
  const p = PROFILES[utility];
  const mid = endMs - HOUR_MS / 2;
  const date = localDate(mid, zone);
  const hour = localHour(mid, zone);

  const special = holidayFor(date) ? 1.2 : isWeekend(date) ? 1.1 : 1;
  const dayMood = 0.85 + 0.3 * rand(`day:${utility}:${date}`);
  const daily = (p.floor + demoPersons(date) * p.perPerson) * special * dayMood;

  const weights = p.shape;
  const sum = weights.reduce((a, b) => a + b, 0);
  const jitter = 0.6 + 0.8 * rand(`hour:${utility}:${date}:${hour}`);
  return (daily * weights[hour]! * jitter) / sum;
}

/**
 * Whether the reading at `endMs` goes missing. Real receivers drop frames, and
 * the panel is built to show gaps honestly, so the demo has a few: an odd run
 * of lost hours, and, in the backfilled history only, the occasional whole day.
 */
function isLost(endMs: number, zone: string, allowWholeDays: boolean): boolean {
  const date = localDate(endMs, zone);
  if (allowWholeDays && rand(`lost-day:${date}`) < 0.025) return true;
  if (rand(`lost-hours:${date}`) >= 0.07) return false;
  const from = Math.floor(rand(`lost-from:${date}`) * 18);
  const hour = localHour(endMs, zone);
  return hour >= from && hour < from + 4;
}

/** Reading slots are three minutes past each hour, as the real agent reads. */
function slotAtOrBefore(ms: number): number {
  const slot = Math.floor(ms / HOUR_MS) * HOUR_MS + 3 * 60_000;
  return slot <= ms ? slot : slot - HOUR_MS;
}

interface Generated {
  utility: UtilityId;
  ts: string;
  total: number;
}

/**
 * Walks the counter forward one hour at a time from `fromMs` (exclusive) to
 * `toMs` (inclusive). Lost readings still add to the counter, because a real
 * meter keeps counting whether anyone hears it or not.
 *
 * The counter moves in whole steps of the meter's resolution, a litre or ten
 * watt-hours, the way a real register does. Carrying a float instead would let
 * a walk that resumes from a stored, rounded total drift a digit away from one
 * that ran straight through.
 */
function generate(
  utility: UtilityId,
  fromMs: number,
  fromTotal: number,
  toMs: number,
  zone: string,
  allowWholeDays: boolean,
): Generated[] {
  const p = PROFILES[utility];
  const step = 10 ** p.decimals;
  const out: Generated[] = [];
  let units = Math.round(fromTotal * step);
  for (let slot = fromMs + HOUR_MS; slot <= toMs; slot += HOUR_MS) {
    units += Math.round(hourUsage(utility, slot, zone) * step);
    if (isLost(slot, zone, allowWholeDays)) continue;
    out.push({ utility, ts: new Date(slot).toISOString(), total: units / step });
  }
  return out;
}

async function store(env: Env, rows: Generated[]): Promise<void> {
  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO readings (utility, ts, total, raw, is_test) VALUES (?, ?, ?, ?, 0)`,
  );
  for (let i = 0; i < rows.length; i += 500) {
    await env.DB.batch(
      rows.slice(i, i + 500).map((r) => insert.bind(r.utility, r.ts, r.total, '{"demo":true}')),
    );
  }
}

/** Headcount for each date, left alone where a visitor already changed it. */
async function storeOccupancy(env: Env, dates: string[]): Promise<void> {
  const insert = env.DB.prepare("INSERT OR IGNORE INTO occupancy (date, persons) VALUES (?, ?)");
  for (let i = 0; i < dates.length; i += 500) {
    await env.DB.batch(dates.slice(i, i + 500).map((d) => insert.bind(d, demoPersons(d))));
  }
}

function datesFrom(first: string, last: string): string[] {
  const dates: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/**
 * Invents `days` of history for every utility that has no readings yet. Heavy
 * enough that it is meant to be run once, locally, and the result imported.
 */
export async function backfillDemo(env: Env, days: number): Promise<Record<string, number>> {
  const { zone } = settingsFrom(env);
  const now = slotAtOrBefore(Date.now());
  const start = now - days * 24 * HOUR_MS;
  const written: Record<string, number> = {};

  await storeOccupancy(env, datesFrom(localDate(start, zone), localDate(now, zone)));

  for (const { id } of enabledUtilities(env.UTILITIES)) {
    const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM readings WHERE utility = ?")
      .bind(id)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) continue;

    // The starting reading is stored as is; the walk carries on from it.
    const first: Generated = { utility: id, ts: new Date(start).toISOString(), total: PROFILES[id].start };
    const rows = [first, ...generate(id, start, PROFILES[id].start, now, zone, true)];
    await store(env, rows);
    await recompute(env, id, settingsFrom(env));
    written[id] = rows.length;
  }
  return written;
}

/**
 * Adds the readings that have come due since the last one, as if the agent had
 * been running all along. Called hourly by the cron; cheap when nothing is due.
 */
export async function tickDemo(env: Env): Promise<Record<string, number>> {
  const settings = settingsFrom(env);
  const now = slotAtOrBefore(Date.now());
  const written: Record<string, number> = {};

  for (const { id } of enabledUtilities(env.UTILITIES)) {
    const last = await env.DB.prepare(
      "SELECT ts, total FROM readings WHERE utility = ? ORDER BY ts DESC LIMIT 1",
    )
      .bind(id)
      .first<{ ts: string; total: number }>();

    // With no history at all, start two days back so the charts have something.
    const fromMs = last ? slotAtOrBefore(Date.parse(last.ts)) : now - 48 * HOUR_MS;
    const fromTotal = last?.total ?? PROFILES[id].start;
    if (fromMs >= now) continue;

    const rows = generate(id, fromMs, fromTotal, now, settings.zone, false);
    if (rows.length === 0) continue;

    await storeOccupancy(env, datesFrom(localDate(fromMs, settings.zone), localDate(now, settings.zone)));
    await store(env, rows);
    await recompute(env, id, settings, addDays(localDate(fromMs, settings.zone), -1));
    written[id] = rows.length;
  }
  return written;
}
