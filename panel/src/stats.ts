/// Turning raw counter readings into per-day and per-hour consumption, and
/// those into the figures the panel shows. Everything here is unit-agnostic:
/// it only ever subtracts one counter value from the next, so the same code
/// serves water, electricity and gas.
///
/// A local calendar day opens at its first reading. The day's consumption is
/// the counter at the next day's opening minus the counter at this one. Days
/// with no reading at all are filled by spreading the gap evenly and marking
/// them estimated. Hourly consumption is each reading-to-reading delta split
/// across the hours it spans.

import type { Env } from "./env";
import {
  HOUR_MS,
  addDays,
  addMonths,
  daysBetween,
  isWeekend,
  localDate,
  localHour,
  monthStart,
  today,
  weekStart,
} from "./dates";
import { holidayFor } from "./holidays";
import type { UtilityId } from "./utilities";

export interface Settings {
  zone: string;
  defaultPersons: number;
}

export function settingsFrom(env: Env): Settings {
  const persons = Number(env.DEFAULT_PERSONS ?? "2");
  return {
    zone: env.TIME_ZONE ?? "Europe/Warsaw",
    defaultPersons: Number.isInteger(persons) && persons > 0 ? persons : 2,
  };
}

export interface DayRow {
  date: string;
  total_end: number;
  usage: number;
  persons: number;
  per_person: number;
  is_weekend: number;
  is_holiday: number;
  holiday_name: string | null;
  estimated: number;
}

export interface HourRow {
  date: string;
  hour: number;
  usage: number;
  estimated: number;
}

interface Reading {
  ts: string;
  total: number;
}

/** Household size for any date, carrying the last known value forward. */
async function occupancyResolver(env: Env, fallback: number): Promise<(date: string) => number> {
  const { results } = await env.DB.prepare(
    "SELECT date, persons FROM occupancy ORDER BY date ASC",
  ).all<{ date: string; persons: number }>();

  return (date: string) => {
    let persons = fallback;
    for (const row of results) {
      if (row.date <= date) persons = row.persons;
      else break;
    }
    return persons;
  };
}

/** First reading of each local date, in date order. */
function dayOpenings(readings: Reading[], zone: string): Array<{ date: string; total: number }> {
  const opens: Array<{ date: string; total: number }> = [];
  let lastDate = "";
  for (const r of readings) {
    const date = localDate(r.ts, zone);
    if (date !== lastDate) {
      opens.push({ date, total: r.total });
      lastDate = date;
    }
  }
  return opens;
}

function buildDayRows(
  readings: Reading[],
  personsFor: (date: string) => number,
  zone: string,
): DayRow[] {
  const opens = dayOpenings(readings, zone);
  const rows: DayRow[] = [];

  for (let i = 1; i < opens.length; i++) {
    const from = opens[i - 1]!;
    const to = opens[i]!;
    const delta = to.total - from.total;
    // A counter that went backwards means a swapped meter or a corrupt frame.
    // Skipping beats inventing negative consumption.
    if (delta < 0) continue;

    const span = daysBetween(from.date, to.date); // at least 1
    const perDay = delta / span;

    for (let d = 0; d < span; d++) {
      const date = addDays(from.date, d);
      const persons = personsFor(date);
      const name = holidayFor(date);
      rows.push({
        date,
        total_end: to.total,
        usage: perDay,
        persons,
        per_person: perDay / persons,
        is_weekend: isWeekend(date) ? 1 : 0,
        is_holiday: name ? 1 : 0,
        holiday_name: name,
        estimated: span > 1 ? 1 : 0,
      });
    }
  }
  return rows;
}

function buildHourRows(readings: Reading[], zone: string): HourRow[] {
  const buckets = new Map<string, HourRow>();

  for (let i = 1; i < readings.length; i++) {
    const from = readings[i - 1]!;
    const to = readings[i]!;
    const delta = to.total - from.total;
    if (delta < 0) continue;

    const startMs = Date.parse(from.ts);
    const endMs = Date.parse(to.ts);
    if (!(endMs > startMs)) continue;

    // Anything covering much more than an hour is interpolation, not measurement.
    const estimated = endMs - startMs > 1.5 * HOUR_MS ? 1 : 0;

    let cursor = startMs;
    while (cursor < endMs) {
      const boundary = Math.floor(cursor / HOUR_MS) * HOUR_MS + HOUR_MS;
      const sliceEnd = Math.min(endMs, boundary);
      const share = (delta * (sliceEnd - cursor)) / (endMs - startMs);
      const date = localDate(cursor, zone);
      const hour = localHour(cursor, zone);
      const key = `${date}T${hour}`;
      const row = buckets.get(key) ?? { date, hour, usage: 0, estimated: 0 };
      row.usage += share;
      row.estimated = row.estimated || estimated;
      buckets.set(key, row);
      cursor = sliceEnd;
    }
  }
  return [...buckets.values()];
}

/**
 * Rebuilds days and hours for one utility from `from` onwards, deleting that
 * range first. Safe to call repeatedly: on ingest, after an occupancy edit and
 * from the nightly cron.
 */
export async function recompute(
  env: Env,
  utility: UtilityId,
  settings: Settings,
  from?: string,
): Promise<number> {
  const { results: readings } = await env.DB.prepare(
    "SELECT ts, total FROM readings WHERE utility = ? ORDER BY ts ASC",
  )
    .bind(utility)
    .all<Reading>();
  if (readings.length < 2) return 0;

  const personsFor = await occupancyResolver(env, settings.defaultPersons);
  const dayRows = buildDayRows(readings, personsFor, settings.zone);
  const hourRows = buildHourRows(readings, settings.zone);

  const start = from ?? dayRows[0]?.date ?? hourRows[0]?.date ?? today(settings.zone);
  const wantedDays = dayRows.filter((r) => r.date >= start);
  const wantedHours = hourRows.filter((r) => r.date >= start);

  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM days WHERE utility = ? AND date >= ?").bind(utility, start),
    env.DB.prepare("DELETE FROM hours WHERE utility = ? AND date >= ?").bind(utility, start),
  ];

  const insertDay = env.DB.prepare(
    `INSERT OR REPLACE INTO days
       (utility, date, total_end, usage, persons, per_person, is_weekend, is_holiday, holiday_name, estimated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of wantedDays) {
    statements.push(
      insertDay.bind(
        utility,
        r.date,
        r.total_end,
        r.usage,
        r.persons,
        r.per_person,
        r.is_weekend,
        r.is_holiday,
        r.holiday_name,
        r.estimated,
      ),
    );
  }

  const insertHour = env.DB.prepare(
    "INSERT OR REPLACE INTO hours (utility, date, hour, usage, estimated) VALUES (?, ?, ?, ?, ?)",
  );
  for (const r of wantedHours) {
    statements.push(insertHour.bind(utility, r.date, r.hour, r.usage, r.estimated));
  }

  // D1 caps how much one batch may carry, so a long backfill goes in chunks.
  for (let i = 0; i < statements.length; i += 100) {
    await env.DB.batch(statements.slice(i, i + 100));
  }
  return wantedDays.length;
}

async function sumBetween(env: Env, utility: UtilityId, from: string, to: string) {
  return env.DB.prepare(
    `SELECT COALESCE(SUM(usage), 0) AS usage,
            COALESCE(SUM(per_person), 0) AS per_person,
            COUNT(*) AS days
       FROM days WHERE utility = ? AND date >= ? AND date <= ?`,
  )
    .bind(utility, from, to)
    .first<{ usage: number; per_person: number; days: number }>();
}

interface Period {
  from: string;
  usage: number;
  per_person: number;
  days: number;
}

export interface Summary {
  utility: UtilityId;
  last_reading: {
    ts: string | null;
    total: number | null;
    battery_y: number | null;
    rssi_dbm: number | null;
  };
  latest_day: DayRow | null;
  previous_day: DayRow | null;
  week: Period;
  prev_week: Period;
  month: Period;
  prev_month: Period;
  avg7: number;
  avg30: number;
  special: { per_day: number; per_person: number; days: number };
  ordinary: { per_day: number; per_person: number; days: number };
  persons_today: number;
  total_days: number;
  /** Consumption since today's first reading, once there are two of them. */
  today_so_far: { usage: number; since_ts: string; readings: number } | null;
}

export async function buildSummary(
  env: Env,
  utility: UtilityId,
  settings: Settings,
): Promise<Summary> {
  const now = today(settings.zone);

  const last = await env.DB.prepare(
    "SELECT ts, total, battery_y, rssi_dbm FROM readings WHERE utility = ? ORDER BY ts DESC LIMIT 1",
  )
    .bind(utility)
    .first<{ ts: string; total: number; battery_y: number | null; rssi_dbm: number | null }>();

  const { results: recent } = await env.DB.prepare(
    "SELECT * FROM days WHERE utility = ? ORDER BY date DESC LIMIT 2",
  )
    .bind(utility)
    .all<DayRow>();

  // Today's opening reading. Readings are UTC and local midnight is at most a
  // day away from it, so scan from yesterday and filter on the local date.
  const { results: recentReadings } = await env.DB.prepare(
    "SELECT ts, total FROM readings WHERE utility = ? AND ts >= ? ORDER BY ts ASC",
  )
    .bind(utility, `${addDays(now, -1)}T00:00:00Z`)
    .all<Reading>();
  const todays = recentReadings.filter((r) => localDate(r.ts, settings.zone) === now);
  const todaySoFar =
    todays.length >= 1 && last
      ? { usage: last.total - todays[0]!.total, since_ts: todays[0]!.ts, readings: todays.length }
      : null;

  const thisWeek = weekStart(now);
  const lastWeek = addDays(thisWeek, -7);
  const thisMonth = monthStart(now);
  const lastMonth = addMonths(thisMonth, -1);

  // Compare like with like: a week that is three days old is measured against
  // the first three days of the week before, not against its full seven.
  const weekElapsed = daysBetween(thisWeek, now);
  const monthElapsed = daysBetween(thisMonth, now);

  const [w, pw, m, pm, avg7, avg30, special, ordinary, count, occ] = await Promise.all([
    sumBetween(env, utility, thisWeek, now),
    sumBetween(env, utility, lastWeek, addDays(lastWeek, weekElapsed)),
    sumBetween(env, utility, thisMonth, now),
    sumBetween(env, utility, lastMonth, addDays(lastMonth, monthElapsed)),
    env.DB.prepare(
      "SELECT COALESCE(AVG(usage), 0) AS v FROM (SELECT usage FROM days WHERE utility = ? ORDER BY date DESC LIMIT 7)",
    )
      .bind(utility)
      .first<{ v: number }>(),
    env.DB.prepare(
      "SELECT COALESCE(AVG(usage), 0) AS v FROM (SELECT usage FROM days WHERE utility = ? ORDER BY date DESC LIMIT 30)",
    )
      .bind(utility)
      .first<{ v: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(AVG(usage), 0) AS u, COALESCE(AVG(per_person), 0) AS p, COUNT(*) AS n
         FROM days WHERE utility = ? AND (is_holiday = 1 OR is_weekend = 1)`,
    )
      .bind(utility)
      .first<{ u: number; p: number; n: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(AVG(usage), 0) AS u, COALESCE(AVG(per_person), 0) AS p, COUNT(*) AS n
         FROM days WHERE utility = ? AND is_holiday = 0 AND is_weekend = 0`,
    )
      .bind(utility)
      .first<{ u: number; p: number; n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM days WHERE utility = ?")
      .bind(utility)
      .first<{ n: number }>(),
    env.DB.prepare("SELECT persons FROM occupancy WHERE date <= ? ORDER BY date DESC LIMIT 1")
      .bind(now)
      .first<{ persons: number }>(),
  ]);

  const empty = { usage: 0, per_person: 0, days: 0 };
  return {
    utility,
    last_reading: {
      ts: last?.ts ?? null,
      total: last?.total ?? null,
      battery_y: last?.battery_y ?? null,
      rssi_dbm: last?.rssi_dbm ?? null,
    },
    latest_day: recent[0] ?? null,
    previous_day: recent[1] ?? null,
    week: { from: thisWeek, ...(w ?? empty) },
    prev_week: { from: lastWeek, ...(pw ?? empty) },
    month: { from: thisMonth, ...(m ?? empty) },
    prev_month: { from: lastMonth, ...(pm ?? empty) },
    avg7: avg7?.v ?? 0,
    avg30: avg30?.v ?? 0,
    special: { per_day: special?.u ?? 0, per_person: special?.p ?? 0, days: special?.n ?? 0 },
    ordinary: { per_day: ordinary?.u ?? 0, per_person: ordinary?.p ?? 0, days: ordinary?.n ?? 0 },
    persons_today: occ?.persons ?? settings.defaultPersons,
    total_days: count?.n ?? 0,
    today_so_far: todaySoFar,
  };
}

export async function hoursBetween(
  env: Env,
  utility: UtilityId,
  from: string,
  to: string,
): Promise<HourRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT date, hour, usage, estimated FROM hours
      WHERE utility = ? AND date >= ? AND date <= ? ORDER BY date ASC, hour ASC`,
  )
    .bind(utility, from, to)
    .all<HourRow>();
  return results;
}

/** Weekly, monthly and yearly roll-ups for the chart tabs. */
export async function series(env: Env, utility: UtilityId, group: "week" | "month" | "all") {
  // %W buckets weeks from Monday, matching the ISO week the rest of the code uses.
  const label =
    group === "week" ? "strftime('%Y-W%W', date)" : group === "month" ? "strftime('%Y-%m', date)" : "strftime('%Y', date)";

  const { results } = await env.DB.prepare(
    `SELECT ${label} AS label,
            MIN(date) AS from_date,
            SUM(usage) AS usage,
            AVG(per_person) AS per_person,
            MAX(is_holiday) AS has_holiday
       FROM days WHERE utility = ?
      GROUP BY label ORDER BY from_date ASC`,
  )
    .bind(utility)
    .all();
  return results;
}
