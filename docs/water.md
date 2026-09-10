# Water

Water is the easy one. Many modern water meters carry a radio module that
broadcasts the counter in clear text every few seconds, and nobody has to grant
you permission to listen to your own meter.

## Finding the meter

Free the dongle if something else is using it, then listen:

```bash
sudo systemctl stop readsb            # or whatever holds the dongle
wmbusmeters --listento=t1,c1,s1 rtlwmbus
```

Within a minute or two you should see blocks like this:

```
Received telegram from: 41a7c3d2
          manufacturer: (SAP) Diehl Metering, Germany (0x4c30)
                  type: Water meter (0x07)
                driver: izarv2
```

Expect several. Radio does not stop at your walls, so the neighbours' meters
appear too. Pick yours by matching the id against the serial number printed on
the meter face. On Diehl modules the panel later shows a `prefix` and
`serial_number` in the decoded reading, which is the surest confirmation:

```bash
wmbusmeters --format=json --listento=t1,c1,s1 rtlwmbus Water izarv2 41a7c3d2 NOKEY
```

```json
{"total_m3":1.818,"prefix":"K24AB","serial_number":"204915","status":"OK","rssi_dbm":102}
```

If that serial matches the label, you have the right meter.

## Configuring

```bash
sudo cp /etc/home-utilities/meters.d/water.conf.example \
        /etc/home-utilities/meters.d/water.conf
sudo nano /etc/home-utilities/meters.d/water.conf
```

Set `DRIVER` and `METER_ID` to what you found. Leave `METER_KEY=NOKEY` unless
your utility encrypts, which is uncommon for water.

## Drivers seen in the wild

| Meter | Driver | Notes |
| --- | --- | --- |
| Diehl IZAR RC i, G4 module | `izarv2` | No key needed. Sends every 8 seconds in R3 mode, every 15 minutes in R4. |
| Diehl IZAR, older modules | `izar` | Try this if `izarv2` decodes nothing. |
| Kamstrup MULTICAL 21 | `multical21` | Usually needs a key from the utility. |
| Sensus iPERL | `iperl` | Usually needs a key. |

`wmbusmeters` supports well over a hundred meters. If yours is not in this
table, run it with `auto` as the driver and see what it picks.

## Signal

Around -100 dBm is normal for a meter one floor away and works fine. If nothing
arrives at all, the usual causes are the kernel DVB driver still holding the
dongle, an antenna inside a metal cabinet, or a meter in R4 mode that only
speaks once every 15 minutes. The install script blacklists the kernel driver;
for the other two, move the antenna and wait longer than you think you need to.
