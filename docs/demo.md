# The demo

The public demo at <https://home-utilities-demo.pawels-apps.workers.dev>
(password `demo`) runs the same panel code as a real install. The only
difference is where the readings come from: there is no meter and no agent, so
the Worker invents them.

## How the numbers are made

[panel/src/demo.ts](../panel/src/demo.ts) derives every hour's consumption from
the date and the hour alone. Water follows a morning and evening shower curve,
electricity adds a base load for the fridge and router, and both scale with how
many people are home. That headcount is invented too: usually two, sometimes
one or three, often four at weekends, six on public holidays.

Because nothing is random in the usual sense, the same hour always produces the
same reading. That matters for two reasons. The hourly cron and the one-off
backfill agree with each other to the last litre, and two runs that overlap
insert identical rows that the primary key then quietly drops.

A real receiver misses frames, and the panel is built to show that honestly, so
the demo loses some on purpose: a few runs of missing hours, and in the history,
the odd whole day. Those days show up in the charts as estimates.

The counter moves in whole litres and tens of watt-hours, as a real register
does. A float would let a run that resumes from a stored total drift a digit
away from one that ran straight through.

## Running your own

A separate Worker and database, so a demo never touches real data:

```bash
cd panel
cp wrangler.demo.jsonc.example wrangler.demo.jsonc
npx wrangler d1 create home-utilities-demo       # paste the id into wrangler.demo.jsonc
```

Inventing 150 days of history is too heavy for a single Worker request on the
free plan, so it runs locally and the result is imported:

```bash
npx wrangler d1 execute home-utilities-demo -c wrangler.demo.jsonc \
  --local --persist-to .wrangler/demo-state --file=schema.sql
npm run demo:dev -- --test-scheduled              # uses the INGEST_TOKEN from .dev.vars
curl -X POST 'http://localhost:8800/api/demo/backfill?days=150' \
  -H 'authorization: Bearer dev-token'

# Copy the rows out of the local database and into the remote one.
DB=$(find .wrangler/demo-state -name '*.sqlite' -size +100k | head -1)
for t in readings days hours occupancy; do
  sqlite3 "$DB" ".mode insert $t" "SELECT * FROM $t"
done > demo-data.sql
npx wrangler d1 execute home-utilities-demo -c wrangler.demo.jsonc --remote --file=schema.sql
npx wrangler d1 execute home-utilities-demo -c wrangler.demo.jsonc --remote --file=demo-data.sql
```

Then the secrets and the deploy:

```bash
node scripts/hash-password.mjs demo | npx wrangler secret put PASSWORD_HASH -c wrangler.demo.jsonc
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET -c wrangler.demo.jsonc
openssl rand -hex 24    | npx wrangler secret put INGEST_TOKEN -c wrangler.demo.jsonc
npm run demo:deploy
```

From then on the cron at three minutes past each hour adds whatever readings
have come due, so the demo never goes stale. If it sits idle for a while, the
next run catches up on the missing hours in one go.

`DEMO` set to `"1"` is what switches all of this on: the invented readings, the
banner on the dashboard and the password hint on the login screen. Without it,
the backfill endpoint answers 404 and the hourly cron does nothing.
