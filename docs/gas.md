# Gas

Gas is the one utility this project cannot read over radio in most homes,
because most domestic gas meters have no radio to read. Check the faceplate: if
there is no wireless M-Bus marking, there is nothing on the air.

Two routes from there.

## If your meter has a radio module

Some distributors fit a wireless M-Bus module during smart metering rollouts.
Poland's PSG is doing this under the eGazomierz programme, replacing about 1.4
million meters between 2025 and 2027. It only covers tariff group W-3, which is
roughly 1200 m³ a year and up, so ordinary households heating with something
other than gas are outside it. You cannot apply; they call you.

The units they fit are typically Apator UniSmart, which `wmbusmeters` reads with
the `unismart` driver. People report these decoding with an all-zero key, so no
key request is needed:

```bash
DRIVER=unismart
METER_ID=<from the listen output>
METER_KEY=00000000000000000000000000000000
```

They transmit roughly every 20 minutes and report to 0.01 m³.

## If your meter is mechanical

Look under the dial for a small rectangular blanking plug. That is the socket
for a pulse transmitter, and the transmitter clips in without breaking the
calibration seal.

Inside the transmitter are two reed switches potted in resin, on a four-core
cable. One closes once per revolution of the last digit wheel, which is one
pulse per 0.01 m³ on a G4 meter. The other is normally closed and opens if
somebody holds a magnet against the meter, which you can wire up as a tamper
alarm or ignore.

Fitting it, on an Apator Metrix meter with the NI-3 transmitter:

1. Pierce the blanking plug where the small logo is.
2. Grip it through the hole with pliers and pull it out.
3. Push the transmitter in until the clips catch. The cable exits downward.

Before wiring anything, confirm which pair is which. Put a multimeter in
continuity mode across one pair and open a gas tap: the counting pair beeps once
per revolution of the last wheel, and the control pair beeps continuously and
falls silent when you bring a magnet close.

Wire the counting pair between a GPIO and ground, with the internal pull-up
enabled. No resistors, no transistors. Keep the board outside the meter cabinet
and run only the transmitter's thin cable inside.

```yaml
sensor:
  - platform: pulse_meter
    pin: { number: GPIO4, mode: { input: true, pullup: true } }
    name: "Gas flow"
    unit_of_measurement: "m³/h"
    internal_filter: 100ms          # reed switches bounce for a few ms
    filters: [ multiply: 0.6 ]      # pulses per minute to m³/h at 0.01 m³/pulse
    total:
      name: "Gas total"
      unit_of_measurement: "m³"
      device_class: gas
      state_class: total_increasing
      accuracy_decimals: 2
      filters: [ multiply: 0.01 ]
```

Set the starting offset to whatever the dial reads, and the counter tracks the
mechanical one from there.

Post readings to the panel on the same endpoint the radio agent uses:

```
POST /api/ingest
Authorization: Bearer <INGEST_TOKEN>

{"utility": "gas", "timestamp": "2026-09-10T06:03:00Z", "total": 2526.06}
```

## Permission

The meter belongs to the gas distributor. A potted reed switch at 3.3 V cannot
produce a spark, and the transmitter is made by the meter manufacturer for this
exact socket, but the manual still says installation is for authorised people
and the fitted transmitter gets sealed with a rivet.

Some operators ask for an intrinsic safety barrier between meter and
electronics. Ask yours before fitting, and put the question in writing so the
answer is on record either way.
