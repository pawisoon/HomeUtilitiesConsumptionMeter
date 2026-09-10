# Hardware

## The reader machine

Any Linux box that stays on. Mine is an Ubuntu 24.04 mini PC that also feeds
flight data, but a Raspberry Pi 3 or newer is plenty. The reader wakes once an
hour, listens for a few seconds and goes back to sleep, so the load is close to
nothing.

| Part | What works | Notes |
| --- | --- | --- |
| Computer | Raspberry Pi 3/4/5, or any x86 machine | Debian or Ubuntu. Needs systemd and a free USB port. |
| Storage | 8 GB and up | One reading is roughly 300 bytes. A year of hourly readings is under 3 MB. |
| Power | Whatever the machine came with | It has to stay on for the hourly timer to fire. |

## Radio: water and electricity

Both meters talk wireless M-Bus on 868 MHz, so one receiver covers both.

| Part | Cost | Notes |
| --- | --- | --- |
| RTL-SDR dongle, RTL2832U chip | 10 to 30 EUR | The cheap DVB-T sticks work. Nooelec and RTL-SDR Blog v3 are the safe buys. |
| Antenna | Included, or 5 EUR | The stub that ships with the dongle reaches a meter a few rooms away. For a longer run, cut a wire to 8.2 cm, which is a quarter wave at 868 MHz. |
| USB extension | 5 EUR | Optional. Gets the dongle away from the computer, which is a noisy neighbour at these frequencies. |

Two warnings about dongles.

Avoid anything sold with a built-in 1090 MHz filter for flight tracking, such as
the blue FlightAware Pro Stick Plus. The filter that makes it good at 1090 makes
it deaf at 868.

A dongle can only sit on one frequency at a time. If the same stick already
feeds an ADS-B receiver, put the service name in `SDR_SHARED_SERVICES` and the
reader will stop it, take its reading, and start it again. That costs the feed
about ten seconds per hour. A second dongle avoids the interruption entirely.

## Radio: gas

Most domestic gas meters have no radio at all, and the ones that do are usually
fitted by the distributor rather than the owner. Check the faceplate for a
wireless M-Bus logo before buying anything.

If yours is a plain mechanical meter, it very likely has an empty socket under
the dial for a pulse transmitter. That route needs different hardware:

| Part | Cost | Notes |
| --- | --- | --- |
| Pulse transmitter matching the meter | 20 to 30 EUR | Apator Metrix NI-3 for Metrix meters, IN-Z61 for several German ones. It is a sealed reed switch that clips into the socket without touching the calibration seal. |
| ESP8266 or ESP32 board | 5 EUR | Wemos D1 mini or an ESP32-C3 Super Mini. Runs ESPHome and counts pulses. |
| 5 V USB supply and an IP65 box | 10 EUR | The board lives outside the meter cabinet. Only the transmitter's thin cable goes in. |

The reed switch carries microamps at 3.3 V and cannot produce a spark, but the
meter belongs to the gas distributor. Some of them ask for an intrinsic safety
barrier between meter and electronics, and some want to be told first. Ask
before you fit it.

## What each meter needs beyond hardware

Water meters with a Diehl IZAR module broadcast unencrypted, so a dongle is
everything you need.

Electricity meters keep their radio switched off until the distribution operator
turns it on, and the frames are AES encrypted. You need both the activation and
the key from them. In Poland this is a written request and a legal deadline of
two months. See [electricity.md](electricity.md).

Gas, as above, is mostly a mechanical problem rather than a radio one.
