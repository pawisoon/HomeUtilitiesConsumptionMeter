-- Home Utilities Consumption Meter — panel database (Cloudflare D1 / SQLite).
--
-- Every table that holds measurements is keyed by utility, so water, electricity
-- and gas live side by side without separate databases. Totals are stored in the
-- utility's base unit: m³ for water and gas, kWh for electricity.

-- Raw meter readings exactly as they arrived from a reader agent.
CREATE TABLE IF NOT EXISTS readings (
  utility     TEXT NOT NULL,
  ts          TEXT NOT NULL,           -- ISO 8601 UTC, from the meter or the agent
  total       REAL NOT NULL,           -- cumulative counter in the base unit
  target      REAL,                    -- meter's own stored period-end value, if any
  target_date TEXT,
  battery_y   REAL,                    -- battery years remaining, radio meters only
  rssi_dbm    INTEGER,
  raw         TEXT NOT NULL,           -- original JSON, kept for later re-parsing
  is_test     INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (utility, ts)
);

-- Derived: consumption per local calendar day. Rebuilt from readings, never
-- written directly.
CREATE TABLE IF NOT EXISTS days (
  utility      TEXT NOT NULL,
  date         TEXT NOT NULL,          -- YYYY-MM-DD in the configured time zone
  total_end    REAL NOT NULL,          -- counter value that closed this day
  usage        REAL NOT NULL,
  persons      INTEGER NOT NULL,
  per_person   REAL NOT NULL,
  is_weekend   INTEGER NOT NULL,
  is_holiday   INTEGER NOT NULL,
  holiday_name TEXT,
  estimated    INTEGER NOT NULL DEFAULT 0,  -- 1 when readings were missing
  PRIMARY KEY (utility, date)
);
CREATE INDEX IF NOT EXISTS days_date ON days(date);

-- Derived: consumption per local hour, for the day view.
CREATE TABLE IF NOT EXISTS hours (
  utility   TEXT NOT NULL,
  date      TEXT NOT NULL,
  hour      INTEGER NOT NULL,          -- 0-23, local time
  usage     REAL NOT NULL,
  estimated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (utility, date, hour)
);

-- How many people the household had that day. Shared by every utility, and
-- carried forward to days that were never filled in.
CREATE TABLE IF NOT EXISTS occupancy (
  date    TEXT PRIMARY KEY,
  persons INTEGER NOT NULL CHECK(persons BETWEEN 1 AND 12)
);

-- Failed logins, for rate limiting. Pruned nightly.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts(ip, ts);
