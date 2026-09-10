#!/usr/bin/env bash
# Send one Telegram message summarising the last 24 hours for every configured
# meter. Reads only the stored history, so it never touches the radio and can
# run while something else is using the dongle.

set -uo pipefail

ETC=/etc/home-utilities
VAR=/var/lib/home-utilities
LOG=/var/log/home-utilities.log

# shellcheck source=/dev/null
source "$ETC/config.env"
log() { echo "$(date -Iseconds) [report] $*" >> "$LOG"; }

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  log "Telegram is not configured; nothing to send"
  exit 0
fi

# Collect one description line per meter for the Python summary below.
METERS=""
for conf in "$ETC"/meters.d/*.conf; do
  [ -e "$conf" ] || continue
  utility=$(basename "$conf" .conf)
  (
    # shellcheck source=/dev/null
    source "$conf"
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "$utility" "${METER_LABEL:-$utility}" "${UNIT:-m³}" \
      "${FINE_UNIT:-${UNIT:-m³}}" "${FINE_FACTOR:-1}"
  )
done > /tmp/home-utilities-meters.$$
METERS=/tmp/home-utilities-meters.$$

MSG=$(TZ_NAME="${TIME_ZONE:-Europe/Warsaw}" PANEL="${PANEL_URL:-}" python3 - "$METERS" "$VAR" <<'PY'
import datetime as dt, json, os, sys
from zoneinfo import ZoneInfo

meters_file, var_dir = sys.argv[1], sys.argv[2]
zone = ZoneInfo(os.environ.get("TZ_NAME", "Europe/Warsaw"))
panel = os.environ.get("PANEL", "")
now = dt.datetime.now(dt.timezone.utc)

def pl(value, decimals=3):
    return f"{value:.{decimals}f}".replace(".", ",")

def local(t):
    return t.astimezone(zone).strftime("%d.%m.%Y %H:%M")

def counter(entry):
    for key in ("total_m3", "total_kwh", "total_energy_consumption_kwh", "total"):
        if key in entry:
            return entry[key]
    return None

blocks = []
for line in open(meters_file):
    utility, label, unit, fine_unit, fine_factor = line.rstrip("\n").split("\t")
    fine_factor = float(fine_factor)

    rows = []
    try:
        with open(f"{var_dir}/{utility}/history.jsonl") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    entry = json.loads(raw)
                except ValueError:
                    continue
                if counter(entry) is None or "timestamp" not in entry:
                    continue
                entry["_t"] = dt.datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
                rows.append(entry)
    except FileNotFoundError:
        pass
    rows.sort(key=lambda e: e["_t"])

    if not rows:
        blocks.append(f"⚠️ {label}\nBrak odczytów.")
        continue

    latest = rows[-1]
    if now - latest["_t"] > dt.timedelta(hours=3):
        blocks.append(f"⚠️ {label}\nBrak aktualnych odczytów. Ostatni: {local(latest['_t'])}.")
        continue

    want = latest["_t"] - dt.timedelta(hours=24)
    older = [r for r in rows if r["_t"] <= want + dt.timedelta(minutes=30)]
    ref = min(older, key=lambda r: abs(r["_t"] - want)) if older else rows[0]

    hours = (latest["_t"] - ref["_t"]).total_seconds() / 3600
    delta = counter(latest) - counter(ref)
    period = "ostatnie 24 h" if 22 <= hours <= 26 else f"ostatnie {hours:.0f} h"
    fine = f" ({round(delta * fine_factor)} {fine_unit})" if fine_factor != 1 else ""

    lines = [
        f"{label}",
        f"Stan licznika: {pl(counter(latest))} {unit}",
        f"Zużycie przez {period} (od {local(ref['_t'])}): {pl(delta)} {unit}{fine}",
        f"Odczytów w tym okresie: {sum(1 for r in rows if r['_t'] > ref['_t'])}",
    ]
    if latest.get("target_date"):
        lines.append(f"Stan na {latest['target_date']}: {pl(latest.get('target_m3', 0))} {unit}")
    extras = []
    if latest.get("battery_y") is not None:
        extras.append(f"bateria ok. {pl(latest['battery_y'], 1)} lat")
    if latest.get("rssi_dbm") is not None:
        extras.append(f"sygnał {latest['rssi_dbm']} dBm")
    if latest.get("status"):
        extras.append(f"status {latest['status']}")
    if extras:
        lines.append(" · ".join(extras))
    blocks.append("\n".join(lines))

if panel:
    blocks.append(f"Panel: {panel}")
blocks.append(now.astimezone(zone).strftime("%d.%m.%Y %H:%M"))
print("\n\n".join(blocks))
PY
)
rm -f "$METERS"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  --data-urlencode text="$MSG" >/dev/null
log "report sent"
