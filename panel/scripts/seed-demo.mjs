#!/usr/bin/env node
/// Fills a panel with plausible readings so the charts can be judged before a
/// real meter is wired up. Every row is flagged is_test, and
/// DELETE /api/readings?test=1&u=<utility> removes them again.
///
///   node scripts/seed-demo.mjs <base-url> <ingest-token> [utility] [days]

const [, , base = "http://localhost:8799", token = "dev-token", utility = "water", daysArg = "60"] =
  process.argv;
const DAYS = Number(daysArg);

/** Base-unit consumption per person per day, and where the counter starts. */
const PROFILE = {
  water: { perPerson: () => 0.09 + Math.random() * 0.05, start: 0.7 },
  electricity: { perPerson: () => 3.4 + Math.random() * 1.6, start: 1420 },
  gas: { perPerson: () => 0.5 + Math.random() * 0.4, start: 2526 },
}[utility];

if (!PROFILE) {
  console.error(`unknown utility: ${utility} (water, electricity or gas)`);
  process.exit(1);
}

// Shape of an ordinary day: quiet at night, busy at breakfast and in the evening.
const HOURLY = [0.2, 0.1, 0.1, 0.1, 0.2, 0.6, 1.6, 2.2, 1.6, 1.0, 0.8, 0.8,
                1.0, 0.8, 0.6, 0.7, 1.0, 1.4, 2.0, 2.4, 1.8, 1.2, 0.6, 0.3];
const HOURLY_SUM = HOURLY.reduce((a, b) => a + b, 0);

// Polish holidays with fixed dates, enough to give the demo a few marked days.
const HOLIDAYS = new Set(["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-24", "12-25", "12-26", "12-31"]);

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const readings = [];
let total = PROFILE.start;
const start = new Date();
start.setUTCDate(start.getUTCDate() - DAYS);

for (let i = 0; i <= DAYS; i++) {
  const day = new Date(start.getTime() + i * 86400000);
  const iso = isoDay(day);
  const dow = day.getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const holiday = HOLIDAYS.has(iso.slice(5));

  // A couple most days, more people at weekends and holidays.
  const people = holiday ? 6 : weekend ? 4 : 2;
  const usage = people * PROFILE.perPerson() * (holiday ? 1.15 : 1);

  // The last few days get hourly readings, matching how a live agent reports.
  if (i >= DAYS - 3) {
    for (let h = 0; h < 24; h++) {
      total += (usage * HOURLY[h]) / HOURLY_SUM;
      readings.push({ utility, timestamp: `${iso}T${pad(h)}:03:00Z`, total: round(total), is_test: 1 });
    }
  } else {
    total += usage;
    readings.push({ utility, timestamp: `${iso}T00:03:00Z`, total: round(total), is_test: 1 });
  }
}

function round(v) {
  return Number(v.toFixed(3));
}

const res = await fetch(`${base}/api/ingest`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(readings),
});
console.log(res.status, await res.text());
