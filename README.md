# Home Utilities Consumption Meter

Reads household utility meters over radio and shows what the house actually
used, by hour and by day, on a private web page the whole family can open.

Water works today. Electricity is written and waiting on my distribution
operator to switch the meter's radio on. Gas needs a pulse sensor I have not
fitted yet.

## What it does

A meter counts upward forever. It never tells you what a Tuesday cost. This
project reads the counter every hour and does the subtraction, so you get:

- consumption per hour for any day you pick, with hours nobody measured left
  blank rather than guessed
- this week against the same days of last week, and this month against the same
  days of last month
- litres or kWh per person, using a household size you set in the panel, because
  ours swings between two and six people depending on who is visiting
- Polish public holidays marked on the charts, including the Easter-based ones,
  and a card comparing holidays and weekends against working days
- one Telegram message a morning with the last 24 hours

Everything sits behind one shared password. There are no accounts to manage,
which matters when the people using it are my family.

## How it is put together

Two halves that talk over one HTTP endpoint.

**The agent** runs on a Linux machine near the meters. A systemd timer wakes it
hourly, it listens for a single wireless M-Bus frame, writes it to a local file
and posts it to the panel. If the panel is unreachable the reading is still on
disk. A second timer sends the daily Telegram summary, built from those files
rather than the radio, so it works even when the dongle is busy.

**The panel** is a Cloudflare Worker with a D1 database. It stores raw readings,
derives the per-day and per-hour tables from them, and serves the dashboard. On
the free plan this costs nothing: one reading an hour is 24 rows a day.

Readings are never edited in place. The day and hour tables are rebuilt from the
raw readings whenever something changes, so correcting the household size for
last Tuesday recalculates that day's per-person figures immediately.

## Hardware

Short version: a Linux box that stays on and a 15 EUR RTL-SDR dongle covers
water and electricity. Gas needs a pulse transmitter and an ESP board instead.

Full list, including which dongles to avoid and why:
[docs/hardware.md](docs/hardware.md).

## Setup

### 1. The panel

```bash
cd panel
npm install
cp wrangler.jsonc.example wrangler.jsonc

npx wrangler d1 create utilities-db          # paste the id into wrangler.jsonc
npx wrangler d1 execute utilities-db --remote --file=schema.sql

node scripts/hash-password.mjs 'household password' | npx wrangler secret put PASSWORD_HASH
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
openssl rand -hex 24    | npx wrangler secret put INGEST_TOKEN   # keep this, the agent needs it

npm run deploy
```

Set `UTILITIES` in `wrangler.jsonc` to the ones you actually have, for example
`"water,electricity"`. The switcher at the top of the page hides itself when
there is only one.

To see the dashboard with data before any meter is wired up, put the same three
secrets in a local `.dev.vars` and seed it:

```bash
printf 'PASSWORD_HASH=%s\nSESSION_SECRET=dev\nINGEST_TOKEN=dev-token\n' \
  "$(node scripts/hash-password.mjs 'demo')" > .dev.vars
npx wrangler d1 execute utilities-db --local --file=schema.sql
npm run dev
node scripts/seed-demo.mjs http://localhost:8799 dev-token water 60
```

Delete the samples afterwards with `DELETE /api/readings?test=1&u=water`.

### 2. The agent

On the Linux machine, as root:

```bash
git clone https://github.com/pawisoon/HomeUtilitiesConsumptionMeter.git
cd HomeUtilitiesConsumptionMeter/agent
sudo ./install.sh --deps        # installs rtl-sdr, builds rtl_wmbus and wmbusmeters
```

Then fill in `/etc/home-utilities/config.env` with the panel address and the
ingest token, and create one meter file per meter. To find out what your meter
calls itself, listen for a couple of minutes and read the output:

```bash
wmbusmeters --listento=t1,c1,s1 rtlwmbus
```

Every meter within radio range shows up, so expect the neighbours. Match the id
against the serial printed on your own meter. Copy the driver name and id into
`/etc/home-utilities/meters.d/water.conf`, then:

```bash
/opt/home-utilities/bin/read-meter.sh water
systemctl enable --now home-utilities-read@water.timer
systemctl enable --now home-utilities-report.timer
```

Per-meter notes: [water](docs/water.md), [electricity](docs/electricity.md),
[gas](docs/gas.md).

## Adding a utility later

The database, the API and the dashboard all take a utility name, so adding one
is configuration rather than code:

1. Add it to `UTILITIES` in `wrangler.jsonc` and redeploy.
2. Drop a new file in `/etc/home-utilities/meters.d/` and enable its timer.

`water`, `electricity` and `gas` are defined in
[panel/src/utilities.ts](panel/src/utilities.ts) with their units and rounding.
Anything else means adding an entry there.

## Upgrading from a water-only install

Databases created before the utility column exists need one migration, which
labels the existing rows as water:

```bash
npx wrangler d1 execute utilities-db --remote --file=migrations/0001-single-to-multi-utility.sql
```

## Repository layout

```
agent/     reader for the Linux machine: scripts, systemd units, install.sh
panel/     Cloudflare Worker, D1 schema, dashboard
docs/      hardware and per-utility setup notes
```

## Limitations

The dashboard is Polish only. The holiday calendar is Polish only, though
[panel/src/holidays.ts](panel/src/holidays.ts) is a single self-contained file
if you want to swap in another country's.

The agent reads wireless M-Bus meters. Anything else needs its own reader that
posts to the same endpoint, which is one HTTP call:

```
POST /api/ingest
Authorization: Bearer <INGEST_TOKEN>

{"utility": "water", "timestamp": "2026-09-10T06:03:00Z", "total": 12.681}
```

The rest of the endpoints are in [docs/api.md](docs/api.md).

Hourly readings on a shared dongle interrupt whatever else uses it, briefly,
once an hour. With a dedicated dongle there is no interruption.

## Licence

MIT. See [LICENSE](LICENSE).
