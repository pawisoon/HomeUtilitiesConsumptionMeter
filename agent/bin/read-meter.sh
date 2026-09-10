#!/usr/bin/env bash
# Read one wireless M-Bus meter and send the result to the panel.
#
#   read-meter.sh <utility>      e.g. read-meter.sh water
#
# Settings come from /etc/home-utilities/config.env plus the per-meter file
# /etc/home-utilities/meters.d/<utility>.conf. Nothing is reported to Telegram
# here; report-daily.sh does that from the stored history.

set -uo pipefail

UTILITY="${1:-}"
if [ -z "$UTILITY" ]; then
  echo "usage: $(basename "$0") <utility>" >&2
  exit 2
fi

ETC=/etc/home-utilities
VAR=/var/lib/home-utilities/$UTILITY
LOG=/var/log/home-utilities.log

# shellcheck source=/dev/null
source "$ETC/config.env"
# shellcheck source=/dev/null
source "$ETC/meters.d/$UTILITY.conf"

: "${METER_ID:?METER_ID missing in $ETC/meters.d/$UTILITY.conf}"
: "${DRIVER:?DRIVER missing in $ETC/meters.d/$UTILITY.conf}"
METER_KEY="${METER_KEY:-NOKEY}"
LINK_MODES="${LINK_MODES:-t1,c1,s1}"
READ_TIMEOUT="${READ_TIMEOUT:-120}"
SDR_SHARED_SERVICES="${SDR_SHARED_SERVICES:-}"

mkdir -p "$VAR"
log() { echo "$(date -Iseconds) [$UTILITY] $*" >> "$LOG"; }

OUT=$(mktemp -t wmbus.XXXXXX)
LISTENER=""

cleanup() {
  # Kill the whole listener process group: wmbusmeters plus the rtl_sdr and
  # rtl_wmbus processes it spawned through a shell.
  if [ -n "$LISTENER" ]; then
    kill -TERM -- "-$LISTENER" 2>/dev/null
    sleep 1
    kill -KILL -- "-$LISTENER" 2>/dev/null
  fi
  pkill -f rtl_sdr 2>/dev/null
  pkill -f rtl_wmbus 2>/dev/null
  pkill -x wmbusmeters 2>/dev/null
  rm -f "$OUT"

  if [ -n "$SDR_SHARED_SERVICES" ]; then
    log "starting $SDR_SHARED_SERVICES"
    # shellcheck disable=SC2086
    systemctl start $SDR_SHARED_SERVICES || true
  fi
}
trap cleanup EXIT

# One radio, possibly several users. Anything else holding the dongle has to let
# go first, and gets restarted on the way out.
if [ -n "$SDR_SHARED_SERVICES" ]; then
  log "stopping $SDR_SHARED_SERVICES"
  # shellcheck disable=SC2086
  systemctl stop $SDR_SHARED_SERVICES || true
  sleep 2
fi

log "listening for $METER_ID, up to ${READ_TIMEOUT}s"
setsid wmbusmeters --format=json --listento="$LINK_MODES" rtlwmbus \
  "$UTILITY" "$DRIVER" "$METER_ID" "$METER_KEY" >"$OUT" 2>/dev/null &
LISTENER=$!

# Poll rather than wait: the listener would otherwise keep the radio, and the
# feed it displaced, busy for the full timeout after the telegram arrived.
JSON=""
WAITED=0
while [ "$WAITED" -lt "$READ_TIMEOUT" ]; do
  JSON=$(grep -m1 "\"id\":\"$METER_ID\"" "$OUT" 2>/dev/null)
  [ -n "$JSON" ] && break
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ -z "$JSON" ]; then
  log "no telegram received"
  exit 1
fi

log "reading after ${WAITED}s: $JSON"
echo "$JSON" > "$VAR/last.json"
echo "$JSON" >> "$VAR/history.jsonl"

if [ -n "${PANEL_URL:-}" ] && [ -n "${PANEL_TOKEN:-}" ]; then
  BODY=$(UTILITY="$UTILITY" python3 - "$VAR/last.json" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
# wmbusmeters names the counter after its unit; the panel wants "total".
total = next((d[k] for k in ("total_m3", "total_kwh", "total_energy_consumption_kwh", "total") if k in d), None)
out = {"utility": os.environ["UTILITY"], "timestamp": d["timestamp"], "total": total}
for src, dst in (("target_m3", "target"), ("target_date", "target_date"),
                 ("battery_y", "battery_y"), ("rssi_dbm", "rssi_dbm")):
    if src in d:
        out[dst] = d[src]
print(json.dumps(out))
PY
)
  if curl -fsS --max-time 20 -X POST "$PANEL_URL/api/ingest" \
      -H "Authorization: Bearer $PANEL_TOKEN" \
      -H 'Content-Type: application/json' \
      --data "$BODY" >/dev/null; then
    log "sent to panel"
  else
    log "panel rejected the reading or was unreachable"
  fi
fi
