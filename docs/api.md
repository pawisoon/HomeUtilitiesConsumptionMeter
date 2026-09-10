# Panel API

Two ways in. Readers authenticate with a bearer token; browsers authenticate
with a password and get a session cookie. Everything is JSON.

`<utility>` is `water`, `electricity` or `gas`.

## Sending readings

```
POST /api/ingest
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{"utility": "water", "timestamp": "2026-09-10T06:03:00Z", "total": 12.681}
```

`total` is the cumulative counter in the utility's base unit: m³ for water and
gas, kWh for electricity. Send the counter, not a difference. The panel works
out consumption by subtracting consecutive readings, which means a missed
reading costs you resolution but never corrupts the running total.

Send an array to backfill many at once. Readings are keyed by utility and
timestamp, so re-sending the same one changes nothing and returns without error.

Accepted field names, in case your reader emits `wmbusmeters` output directly:

| Field | Alternatives | Required |
| --- | --- | --- |
| `timestamp` | `ts` | yes |
| `total` | `total_m3`, `total_kwh` | yes |
| `utility` | | no, defaults to the first configured one |
| `target`, `target_date` | `target_m3` | no |
| `battery_y`, `rssi_dbm` | | no |
| `is_test` | | no, marks rows the cleanup endpoint may delete |

Response:

```json
{"inserted": 1, "recomputed": 2}
```

## Reading data

All of these need the session cookie from `POST /api/login`.

| Endpoint | Returns |
| --- | --- |
| `GET /api/config` | Configured utilities with their units, and the time zone. |
| `GET /api/summary?u=<utility>` | Yesterday, week and month comparisons, per-person averages, holiday against workday, today so far. |
| `GET /api/days?u=<utility>&from=&to=` | One row per day: consumption, household size, per person, holiday name, whether it was estimated. |
| `GET /api/hours?u=<utility>&from=&to=` | One row per local hour. |
| `GET /api/series?u=<utility>&g=week\|month\|all` | Roll-ups for the longer chart tabs. |
| `GET /api/occupancy?from=&to=` | Household size per day. |

## Writing

| Endpoint | Effect |
| --- | --- |
| `PUT /api/occupancy` | `{"date": "2026-09-10", "persons": 4}`. Rebuilds per-person figures for that day onward, for every utility. |
| `DELETE /api/readings?test=1&u=<utility>` | Removes rows marked `is_test` for that utility and rebuilds. |

## Login

```
POST /api/login    {"password": "..."}   204 and a session cookie, or 401
POST /api/logout                          204
```

Ten failures from one address inside fifteen minutes returns 429 until the
window passes. Every failure also costs the caller a second of delay.

## Estimated values

A day with no reading of its own gets its consumption by spreading the gap
evenly across the days it covers, and is flagged `estimated: 1`. Hours work the
same way: any hour covered by a gap longer than 90 minutes is flagged.

The dashboard draws estimated days in a separate colour and leaves estimated
hours out of the hourly charts entirely, because an hourly figure nobody
measured is a guess, not a measurement.
