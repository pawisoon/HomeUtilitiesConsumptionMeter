-- Migration: water-only schema → multi-utility schema.
--
-- Only needed if your database was created before the utility column existed,
-- i.e. it has readings(ts, total_m3) rather than readings(utility, ts, total).
-- Existing rows are assumed to be water. Safe to run once; running it twice
-- fails harmlessly on the first CREATE because the new tables already exist.
--
--   wrangler d1 execute <db> --remote --file=migrations/0001-single-to-multi-utility.sql

CREATE TABLE readings_new (
  utility     TEXT NOT NULL,
  ts          TEXT NOT NULL,
  total       REAL NOT NULL,
  target      REAL,
  target_date TEXT,
  battery_y   REAL,
  rssi_dbm    INTEGER,
  raw         TEXT NOT NULL,
  is_test     INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (utility, ts)
);
INSERT INTO readings_new (utility, ts, total, target, target_date, battery_y, rssi_dbm, raw, is_test, received_at)
  SELECT 'water', ts, total_m3, target_m3, target_date, battery_y, rssi_dbm, raw, is_test, received_at FROM readings;
DROP TABLE readings;
ALTER TABLE readings_new RENAME TO readings;

CREATE TABLE days_new (
  utility      TEXT NOT NULL,
  date         TEXT NOT NULL,
  total_end    REAL NOT NULL,
  usage        REAL NOT NULL,
  persons      INTEGER NOT NULL,
  per_person   REAL NOT NULL,
  is_weekend   INTEGER NOT NULL,
  is_holiday   INTEGER NOT NULL,
  holiday_name TEXT,
  estimated    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (utility, date)
);
INSERT INTO days_new (utility, date, total_end, usage, persons, per_person, is_weekend, is_holiday, holiday_name, estimated)
  SELECT 'water', date, total_m3_end, usage_m3, persons, per_person_l, is_weekend, is_holiday, holiday_name, estimated FROM days;
DROP TABLE days;
ALTER TABLE days_new RENAME TO days;
CREATE INDEX IF NOT EXISTS days_date ON days(date);

CREATE TABLE hours_new (
  utility   TEXT NOT NULL,
  date      TEXT NOT NULL,
  hour      INTEGER NOT NULL,
  usage     REAL NOT NULL,
  estimated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (utility, date, hour)
);
INSERT INTO hours_new (utility, date, hour, usage, estimated)
  SELECT 'water', date, hour, usage_m3, estimated FROM hours;
DROP TABLE hours;
ALTER TABLE hours_new RENAME TO hours;
