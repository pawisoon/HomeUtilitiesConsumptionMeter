# Heating (research notes)

Not wired into the panel yet. These are notes from listening to a Salus
091FLRFv2 wireless thermostat with the same RTL-SDR dongle that reads the
meters, kept here so the work can be picked up again.

## The setup

A gas boiler, here a Bosch Condens 5300i WT, is switched on and off by a Salus
091FLRFv2 room thermostat. The thermostat talks to a receiver box next to the
boiler over 868 MHz, and the receiver closes the boiler's room-thermostat
contact. The boiler decides flame size and water temperature on its own; the
thermostat only ever says "heat" or "stop".

## What can and cannot be done without new hardware

An RTL-SDR only receives. So with the dongle alone, the heating can be
monitored but not controlled. Nothing else in the house can send a command
either: the boiler has no network connection of its own, and the 091FLRF is a
standalone thermostat with no app.

Control would need at least one new part, the cheapest being a CC1101 radio
module (about 5 EUR) to imitate the thermostat, or a Wi-Fi relay on the
boiler's thermostat terminals. A fuller option is an
[EMS-ESP](https://github.com/emsesp/EMS-ESP32) gateway on the boiler's EMS2 bus,
which reads temperatures and burner data and can change setpoints.

## What the thermostat transmits

Captured with rtl_433 at `-f 868.5M -s 2048k`, listening for an hour without
touching the thermostat.

| | |
|---|---|
| Frequency | about 868.26 MHz, FSK, tones at 868.212 and 868.309 MHz |
| Bit rate | 2400 bit/s, NRZ, 417 µs per bit |
| Framing | preamble `AA AA …`, sync word `2D D4` |
| Rhythm | a burst every 9 to 10 minutes, unprompted |
| Burst | the same three packets repeated 7 times over about 3 seconds, 128 ms apart |

rtl_433 decodes the bits with:

```bash
rtl_433 -f 868.5M -s 2048k -R 0 -X "n=salus,m=FSK_PCM,s=417,l=417,r=6000"
```

Each burst repeats this triplet:

```
30 01 31 54                                  short
a5 30 04 20  9c 07  98 08  98 08  28 00     long
a7 30 04 20  9c 07  98 08  98 08  28 00     long, a7 instead of a5
```

## What the fields mean

| Field | Example | Meaning | Status |
|---|---|---|---|
| Long, bytes 5-6 | `9c 07` | room temperature, little-endian, hundredths of a degree: 0x079C = 19.48 °C | confirmed against the thermostat display (radio 19.94, display 20.0) |
| Long, bytes 7-8 and 9-10 | `98 08` | 0x0898 = 22.00 °C, most likely the setpoint | likely, not yet checked on the display |
| Long, byte 1 | `a5` / `a7` | alternates packet by packet, one bit apart | a counter or message type |
| Short, byte 3 | `31` | equals byte 1 plus byte 2 | probably a simple check |
| Short, byte 2 | `01` | suspected "heat on": the room was below the setpoint in every capture | unconfirmed |

Not found yet: the pairing ID, and any checksum covering the temperature bytes.
Neither is needed to log one thermostat, since it is by far the strongest
signal in range.

## Captures so far

| Time (UTC) | Room | Setpoint | Short packet |
|---|---|---|---|
| 2026-09-26 10:08 | 19.48 °C | 22.00 | `30 01 31 54` |
| 2026-09-26 10:27 | 19.45 °C | 22.00 | `30 01 31 54` |
| 2026-09-26 12:56 | 19.94 °C | 22.00 | `30 01 31 54` |

## Where to pick up

1. Confirm the on/off byte with a passive capture across a moment the heating
   switches off by itself: the room reaching the setpoint, or the schedule
   lowering it in the evening. If `01` turns into something else, that is the
   flag.
2. Check the setpoint on the thermostat display against the 22.00 reading.
3. Add a `heating` reader on the agent side. Unlike the meters this is not a
   counter: it reports room temperature, setpoint and on/off every ten
   minutes, so the panel would show a timeline and heating hours per day
   rather than consumption.
4. Sort out dongle time. A burst every ten minutes means listening for up to
   ten minutes an hour, which is ten minutes of ADS-B gap on a shared dongle.

## Capturing on a shared dongle

The capture has to pause whatever else uses the dongle, ADS-B here, and stay
clear of the meter reads at :03 and :33. The approach used: a script run with
`sudo systemd-run` that stops ADS-B, runs rtl_433 with `-A -S unknown` (pulse
analysis plus a raw recording of every undecoded signal), steps aside from :01
to :06 and :31 to :36, and starts ADS-B again on exit.
