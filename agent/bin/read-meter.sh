#!/usr/bin/env bash
# Read one wireless M-Bus meter and send the result to the panel.
#
#   read-meter.sh <utility>      e.g. read-meter.sh water
#
# Settings come from /etc/home-utilities/config.env plus the per-meter file
# /etc/home-utilities/meters.d/<utility>.conf. The daily Telegram summary is
# report-daily.sh's job; this script only messages when reads start failing
# and again when they recover.

set -uo pipefail

UTILITY="${1:-}"
if [ -z "$UTILITY" ]; then
  echo "usage: $(basename "$0") <utility>" >&2
  exit 2
fi

# Overridable so the script can be exercised against a scratch directory.
ETC="${HOME_UTILITIES_ETC:-/etc/home-utilities}"
VAR="${HOME_UTILITIES_VAR:-/var/lib/home-utilities}/$UTILITY"
LOG="${HOME_UTILITIES_LOG:-/var/log/home-utilities.log}"

# shellcheck source=/dev/null
source "$ETC/config.env"
# shellcheck source=/dev/null
source "$ETC/meters.d/$UTILITY.conf"

: "${METER_ID:?METER_ID missing in $ETC/meters.d/$UTILITY.conf}"
: "${DRIVER:?DRIVER missing in $ETC/meters.d/$UTILITY.conf}"
METER_KEY="${METER_KEY:-NOKEY}"
METER_LABEL="${METER_LABEL:-$UTILITY}"
LINK_MODES="${LINK_MODES:-t1,c1,s1}"
READ_TIMEOUT="${READ_TIMEOUT:-120}"
UNIT="${UNIT:-m³}"
SDR_SHARED_SERVICES="${SDR_SHARED_SERVICES:-}"
ALERT_AFTER_MISSES="${ALERT_AFTER_MISSES:-3}"
TZ_NAME="${TIME_ZONE:-Europe/Warsaw}"

STATE="$VAR/alert.state"     # "ok", or "<reason> <epoch of first failure>"
MISSES="$VAR/misses"         # consecutive reads with no frame from the meter

mkdir -p "$VAR"
log() { echo "$(date -Iseconds) [$UTILITY] $*" >> "$LOG"; }
stamp() { TZ="$TZ_NAME" date '+%d.%m.%Y %H:%M'; }
short() { TZ="$TZ_NAME" date -d "@$1" '+%d.%m %H:%M' 2>/dev/null || TZ="$TZ_NAME" date -r "$1" '+%d.%m %H:%M'; }

telegram() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 0
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" --data-urlencode text="$1" >/dev/null
}

# Message once per failure streak. A change of reason (signal lost, then the
# dongle vanishing) is news and gets its own message, but keeps the original
# start time so the recovery note reports the whole outage.
alert() {
  local reason="$1" text="$2" current since
  current=$(cat "$STATE" 2>/dev/null || echo ok)
  [ "${current%% *}" = "$reason" ] && return 0
  since=$(date +%s)
  [ "$current" != "ok" ] && since="${current##* }"
  echo "$reason $since" > "$STATE"
  telegram "⚠️ ${METER_LABEL}
${text}
$(stamp)"
  log "alert sent: $reason"
}

recovered() {
  local total="$1" current
  current=$(cat "$STATE" 2>/dev/null || echo ok)
  echo 0 > "$MISSES"
  [ "$current" = "ok" ] && return 0
  echo ok > "$STATE"
  telegram "✅ ${METER_LABEL}
Odczyty wznowione. Stan licznika: ${total/./,} ${UNIT}.
Przerwa od $(short "${current##* }") do $(short "$(date +%s)").
$(stamp)"
  log "recovery sent"
}

# An RTL2832U stick that hangs drops off the bus entirely. Checking first gives
# a precise alert, and avoids stopping the shared services for a radio that is
# not there to take over from them.
# Capture first: "lsusb | grep -q" under pipefail fails at random, because grep
# exits on the first match and lsusb dies writing the rest of its output.
USB_DEVICES=$(lsusb 2>/dev/null)
if ! grep -qiE "0bda:283[28]" <<<"$USB_DEVICES"; then
  log "dongle not detected on USB"
  alert usb "Odbiornik radiowy (dongle RTL-SDR) nie jest widoczny na USB, więc odczyty są wstrzymane.
Wyjmij dongle z portu, odczekaj 5 sekund i włóż go z powrotem."
  exit 1
fi

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
# feed it displaced, busy for the full timeout after the frame arrived.
JSON=""
WAITED=0
while [ "$WAITED" -lt "$READ_TIMEOUT" ]; do
  JSON=$(grep -m1 "\"id\":\"$METER_ID\"" "$OUT" 2>/dev/null)
  [ -n "$JSON" ] && break
  sleep 1
  WAITED=$((WAITED + 1))
done

# A single silent hour happens. Several in a row mean the antenna, the dongle
# or the meter has a problem worth telling someone about.
if [ -z "$JSON" ]; then
  n=$(( $(cat "$MISSES" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$MISSES"
  log "no telegram received (miss $n)"
  if [ "$n" -ge "$ALERT_AFTER_MISSES" ]; then
    alert signal "Brak sygnału z licznika od ${n} odczytów z rzędu. Dongle jest podłączony, ale nic nie odbiera.
Sprawdź, czy antena jest wpięta, i czy dongle nie jest gorący."
  fi
  exit 1
fi

log "reading after ${WAITED}s: $JSON"
echo "$JSON" > "$VAR/last.json"
echo "$JSON" >> "$VAR/history.jsonl"

TOTAL=$(python3 - "$VAR/last.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(next((d[k] for k in ("total_m3", "total_kwh", "total_energy_consumption_kwh", "total") if k in d), ""))
PY
)
recovered "$TOTAL"

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
