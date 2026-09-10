# Electricity

Electricity meters are the awkward one. The radio is usually fitted and usually
switched off, and the frames are encrypted, so you need two things from your
distribution operator: the interface turned on, and the AES-128 key.

The hardware side is free. A meter with a wireless M-Bus HAN interface talks on
868 MHz, the same band as the water meter, so the dongle you already have picks
it up.

## Is the radio on?

Stop whatever holds the dongle and listen for three minutes:

```bash
wmbusmeters --listento=t1,c1,s1 rtlwmbus
```

An active electricity meter shows up as its own block, for example:

```
Received telegram from: 12345678
          manufacturer: (APA) Apator
                  type: Electricity meter (0x02)
```

Apator uses the factory number from the faceplate as the radio address, so match
the id against the `Nr fabr.` printed on the meter. If three minutes pass with
only water meters in the output, the interface is off and only the operator can
turn it on. Meters that are transmitting usually also show a small antenna or
triangle icon on the display.

## Getting it switched on in Poland

Polish law gives customers in tariff groups G1x and C1x the right to ask for the
local interface. The legal basis is the metering regulation of 22 March 2022
(Dz.U. 2022 poz. 788) together with the Energy Law, and the operator has two
months from the date of the request.

The request goes to your distribution operator, not the company that bills you.
They are different organisations, and the seller will simply forward you.

For PGE Dystrybucja the form is "Wniosek o uruchomienie komunikacji WMBUS",
downloadable from their site, and it asks for:

- the address of the metering point and its 18-character PPE code, which is on
  the invoice and starts with `PL`
- the meter number from the faceplate
- your name, PESEL, email and mobile number, because the key is sent to those

Hand it in at a customer service point for your region. There is no fee. Other
operators have equivalent forms.

Reports of how long this takes vary from the same day to four months. One
account describes technicians handing over a key that turned out not to work,
which took another round to sort out.

## Configuring once the key arrives

The key is 32 hexadecimal characters.

```bash
sudo cp /etc/home-utilities/meters.d/electricity.conf.example \
        /etc/home-utilities/meters.d/electricity.conf
sudo nano /etc/home-utilities/meters.d/electricity.conf
```

Set `METER_ID` to the factory number and `METER_KEY` to the key. Start with
`DRIVER=auto`: these meters send standard OMS records and `wmbusmeters` usually
recognises them without help. If it decodes nothing, capture one frame and look
at what is inside:

```bash
wmbusmeters --analyze --listento=t1,c1 rtlwmbus <id> <key>
```

Then enable it:

```bash
/opt/home-utilities/bin/read-meter.sh electricity
systemctl enable --now home-utilities-read@electricity.timer
```

Add `electricity` to `UTILITIES` in the panel's `wrangler.jsonc` and redeploy,
and the switcher appears at the top of the dashboard.

## What you get

These meters report roughly once a minute: total import in kWh, export if you
have solar, current power, and per-phase voltages. This project stores the
cumulative import figure once an hour, which is what the day and hour charts
need. Reading every minute for live power would mean a dedicated dongle, since
each read briefly takes the radio away from anything else using it.

## Meters

| Meter | Notes |
| --- | --- |
| Apator Otus 3 | Common in Poland. Radio is optional and off by default. Factory number is the radio address. |
| Landis+Gyr E360 | Widely deployed in Europe, same request process. |

## Without the operator

If the operator refuses or you would rather not wait, the LED on the front of
the meter pulses a fixed number of times per kWh, usually 1000 or 2500 and
printed on the faceplate. A photodiode on an ESP board counts those pulses and
posts to the same ingest endpoint. You lose voltages and the export figure, but
you get consumption without asking anyone.
