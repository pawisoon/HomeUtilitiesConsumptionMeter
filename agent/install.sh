#!/usr/bin/env bash
# Install the reader agent on a Debian or Ubuntu machine.
#
#   sudo ./install.sh            copy scripts, units and example config
#   sudo ./install.sh --deps     also install and build the radio tools first
#
# Running it again is safe: existing config files are left alone, everything
# else is overwritten with the current version.

set -euo pipefail

OPT=/opt/home-utilities
ETC=/etc/home-utilities
VAR=/var/lib/home-utilities
LOG=/var/log/home-utilities.log
SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

say() { printf '\n== %s\n' "$*"; }

if [ "${1:-}" = "--deps" ]; then
  say "Installing packages"
  apt-get update -qq
  apt-get install -y -qq rtl-sdr librtlsdr-dev libusb-1.0-0-dev libxml2-dev \
    build-essential cmake pkg-config git curl python3

  say "Keeping the kernel DVB driver off the dongle"
  # The stick presents itself as a TV tuner, and that driver grabs it at boot.
  cat > /etc/modprobe.d/blacklist-rtlsdr.conf <<'BLACKLIST'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
blacklist rtl2832_sdr
BLACKLIST
  modprobe -r dvb_usb_rtl28xxu rtl2832_sdr rtl2832 rtl2830 2>/dev/null || true

  if ! command -v rtl_wmbus >/dev/null; then
    say "Building rtl_wmbus"
    tmp=$(mktemp -d)
    git clone -q --depth 1 https://github.com/xaelsouth/rtl-wmbus.git "$tmp/rtl-wmbus"
    make -C "$tmp/rtl-wmbus" release
    install -m755 "$tmp/rtl-wmbus/build/rtl_wmbus" /usr/local/bin/rtl_wmbus
    rm -rf "$tmp"
  fi

  if ! command -v wmbusmeters >/dev/null; then
    say "Building wmbusmeters"
    tmp=$(mktemp -d)
    git clone -q --depth 1 https://github.com/wmbusmeters/wmbusmeters.git "$tmp/wmbusmeters"
    (cd "$tmp/wmbusmeters" && ./configure && make -j"$(nproc)" && make install)
    rm -rf "$tmp"
  fi
fi

say "Checking the tools are present"
missing=0
for tool in rtl_sdr rtl_wmbus wmbusmeters python3 curl; do
  if command -v "$tool" >/dev/null; then
    printf '  %-12s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '  %-12s MISSING\n' "$tool"
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  echo "Install the missing tools, or re-run with --deps." >&2
  exit 1
fi

say "Installing scripts into $OPT"
install -d -m755 "$OPT/bin" "$ETC/meters.d" "$VAR"
install -m755 "$SRC/bin/"*.sh "$OPT/bin/"
touch "$LOG"
chmod 640 "$LOG"

say "Installing systemd units"
install -m644 "$SRC/systemd/"* /etc/systemd/system/
systemctl daemon-reload

say "Placing example configuration in $ETC"
if [ ! -f "$ETC/config.env" ]; then
  install -m600 "$SRC/config/config.env.example" "$ETC/config.env"
  echo "  created $ETC/config.env — fill it in before the first read"
else
  echo "  kept your $ETC/config.env"
fi
for example in "$SRC"/config/meters.d/*.conf.example; do
  name=$(basename "$example" .example)
  if [ ! -f "$ETC/meters.d/$name" ]; then
    install -m600 "$example" "$ETC/meters.d/$name.example"
  fi
done
echo "  meter templates are in $ETC/meters.d/ as *.conf.example"

cat <<'NEXT'

== Installed. Three things left:

1. Edit /etc/home-utilities/config.env
     panel address and token, Telegram bot, and any service sharing the dongle.

2. Create a meter file, one per meter:
     cp /etc/home-utilities/meters.d/water.conf.example \
        /etc/home-utilities/meters.d/water.conf
     then set DRIVER, METER_ID and METER_KEY.

   To find those, listen once and watch what turns up:
     wmbusmeters --listento=t1,c1,s1 rtlwmbus

3. Try it, then turn on the timers:
     /opt/home-utilities/bin/read-meter.sh water
     systemctl enable --now home-utilities-read@water.timer
     systemctl enable --now home-utilities-report.timer

   Progress goes to /var/log/home-utilities.log
NEXT
