# cul2mqtt

[![mqtt-smarthome](https://img.shields.io/badge/mqtt-smarthome-blue.svg)](https://github.com/mqtt-smarthome/mqtt-smarthome)
[![NPM version](https://badge.fury.io/js/cul2mqtt.svg)](http://badge.fury.io/js/cul2mqtt)
[![CI](https://github.com/hobbyquaker/cul2mqtt/actions/workflows/ci.yml/badge.svg)](https://github.com/hobbyquaker/cul2mqtt/actions/workflows/ci.yml)
[![License][gpl-badge]][gpl-url]

> Interface between a [Busware](https://busware.de) CUL / COC / SCC / CUNO running
> [culfw](http://culfw.de) and MQTT 📡 — FS20, EM1000, HMS, S300TH, FHT, MAX!, ... with Home
> Assistant discovery

Built on the [cul](https://github.com/hobbyquaker/cul) library and
[mqtt-interfaces-core](https://github.com/hobbyquaker/mqtt-interfaces-core).

FHT80b thermostats paired to an ELV FHZ1000 PC / FHZ1300 PC instead of a CUL: see the sister
project [fhz2mqtt](https://github.com/sker65/fhz2mqtt).

Upgrading from 0.1.x? Topics changed — see [CHANGELOG.md](CHANGELOG.md).

## Getting started

### Install and run

```
npm install -g cul2mqtt
cul2mqtt --serialport /dev/ttyACM0 --mqtt-url mqtt://192.168.1.2
```

The user running cul2mqtt needs access to the serial port (usually group `dialout`). Received
telegrams show up as `cul/status/<protocol>/<address>/<field>` right away; `-v debug` prints the
raw traffic (`cul <` / `cul >`).

`cul2mqtt --help` lists all options; every option can also be set via an environment variable
(`CUL2MQTT_SERIALPORT`, `CUL2MQTT_MQTT_URL`, `CUL2MQTT_NAME`, ...).

### Home Assistant app

This repository can also be installed as a custom Home Assistant app. It runs under Home Assistant
and packages the same CUL2MQTT functionality as the command-line project. It supports serial
CUL/COC/SCC devices as well as network CUNO/CUL devices. The app's **Info** page includes a short
description; its **Documentation** page contains the complete configuration and feature guide.

1. In Home Assistant, open **Settings → Apps → App Store**, open the menu, then add this custom
   repository URL:

   ```
   https://github.com/yasapl/cul2mqtt
   ```

2. Install **CUL2MQTT**, then select one connection type:

   ```yaml
   # Serial CUL / COC / SCC (default)
   serialport: /dev/ttyACM0
   host: ''
   ```

   ```yaml
   # Network CUNO / CUL
   host: 192.168.1.50
   port: 2323
   ```

   Set `cul_mode` to `SlowRF`, `MORITZ`, or `AskSin` as appropriate. `fht_central` is the
   four-digit hexadecimal central ID used for FHT commands, time sync, and first-time climate
   initialization. Leave
   `instance_name` as `cul` unless another CUL already uses that MQTT topic prefix. The app uses
   Home Assistant's MQTT service and its credentials automatically by default; set `mqtt_url` only
   for an external broker.

   FS20 actuators must be defined explicitly because they cannot report their state. Home Assistant
   shows an optimistic state based on the last command sent, not a radio confirmation:

   ```yaml
   fs20_devices:
     - name: Hall light
       address: 6C4800
       type: light
   ```

   Every defined FS20 device gets five timer-duration number entities and five matching
   **Turn on for timer** buttons. Set a duration in seconds and press its button to send native
   `on-for-timer`; set a duration to `0` to disable that button. `on_time` below sets the initial
   value for timer 1:

   ```yaml
   fs20_devices:
     - name: AS1
       address: 6C4801
       on_time: 300
   ```

3. Start the app. It will discover supported radio devices and publish them to Home Assistant
   through MQTT Discovery. Set `raw_set: true` to send manual raw CUL firmware commands. Debug
   logging is not required to send them; `log_level: debug` only adds `cul <`/`cul >` traffic to the
   app log. See the [Home Assistant app documentation](cul2mqtt/DOCS.md) for all configuration
   options, MQTT topics, maintenance functions, and protocol details.

| option                               | default            | description                                                                                   |
| ------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| `-s, --serialport`                   | `/dev/ttyACM0`     | serial port of the CUL / COC / SCC, or `auto` (see above)                                     |
| `--discover`                         |                    | list the busware sticks on this host and exit (`--discover-json` for JSON)                    |
| `--baudrate`                         | `9600`             | serial baud rate (`38400` with `--coc` / `--scc`)                                             |
| `-c, --cul-mode`                     | `SlowRF`           | RF mode: `SlowRF` (FS20, HMS, EM, S300TH, FHT, ...), `MORITZ` (MAX!) or `AskSin`              |
| `--coc`, `--scc`                     | off                | device is a Busware COC / SCC on a Raspberry Pi                                               |
| `--host`, `--port`                   | , `2323`           | CUNO / CUNO2 via telnet instead of a serial port                                              |
| `-m, --map-file`                     |                    | JSON file with friendly item names (see below)                                                |
| `--fht-central`                      |                    | FHT central code (4 hex digits), required for FHT commands and time sync                      |
| `--fht-init`                         | off                | set a new FHT without mode/target once to manual, 16 °C (see Home Assistant)                  |
| `--uniroll-devices`                  | `[]`               | JSON list of UNIRoll shutters announced as HA covers (see below)                              |
| `--em-basis`                         |                    | JSON object of initial EM counter bases in pulses, e.g. `{"0205": 123456}`                    |
| `--only`                             |                    | handle only these protocols / devices, e.g. `uniroll,em/0205` (see below)                     |
| `--ignore`                           |                    | protocols / devices to leave alone, e.g. `fht,fs20/6C4800` (see below)                        |
| `--offline-detection`                | on                 | mark silent devices offline on `cul/status/<protocol>/<address>/online`                       |
| `--learn-intervals`                  | on                 | widen offline timeouts from observed per-device message gaps                                  |
| `--confirm-count`                    | `3`                | publish a new device only after this many telegrams within `--confirm-window` (`1` = at once) |
| `--confirm-window`                   | `3600`             | seconds in which a new device must reach `--confirm-count` telegrams                          |
| `--state-dir`                        | `$STATE_DIRECTORY` | directory for persisted state (learned intervals, EM counters, cover positions)               |
| `--publish-raw`                      | off                | additionally publish every raw culfw line on `cul/raw`                                        |
| `--publish-events`                   | on                 | publish every parsed update on `cul/event/...` (not retained)                                 |
| `--raw-set`                          | off                | accept raw culfw commands on `cul/set/raw` (see below)                                        |
| `-u, --mqtt-url`                     | `mqtt://localhost` | broker URL, see [MQTT.js](https://github.com/mqttjs/MQTT.js#connect-using-a-url)              |
| `--mqtt-username`, `--mqtt-password` |                    | broker credentials                                                                            |
| `-n, --name`                         | `cul`              | instance name, used as topic prefix                                                           |
| `--json-payloads`                    | on                 | status as `{"val", "ts", "lc"}` JSON; `--no-json-payloads` for plain values                   |
| `--ha-discovery`                     | on                 | Home Assistant MQTT discovery (`--no-ha-discovery` disables and clears it)                    |
| `--ha-prefix`                        | `homeassistant`    | discovery prefix                                                                              |
| `--no-maintenance`                   | (on)               | disable the `maintenance/set/loglevel` and `restart` topics (see below)                       |
| `--mqtt-client-id-prefix`            |                    | prefix for the mqtt client id                                                                 |
| `--mqtt-tls-ca`                      |                    | CA certificate file for `mqtts://` brokers                                                    |
| `--config-schema`                    |                    | print a JSON Schema of all options and exit                                                   |
| `-v, --verbosity`                    | `info`             | `error`, `warn`, `info`, `debug`                                                              |

### Finding the stick

```
cul2mqtt --discover
```

lists the busware sticks plugged into this host — udev has already named them, so there is
nothing to scan:

```
/dev/serial/by-id/usb-busware.de_CUL868-if00  → /dev/ttyACM0  (serial)
```

Use the `by-id` path rather than `/dev/ttyACM0`: it survives a replug and a reboot, while the
`ttyACM` number can swap with another stick's. `-s auto` does that for you — it runs the same
scan at start and opens the stick it found, refusing to start when none or more than one busware
CUL is plugged in rather than talking to the wrong radio:

```
cul2mqtt -s auto -u mqtt://192.168.1.2
```

Only sticks whose name contains both **busware** and **CUL** are recognised — that is what a
CUL433/CUL868 looks like in `/dev/serial/by-id`. A CUN or COC, a nanoCUL, or any other vendor's
culfw clone is named differently: give those to `--serialport` directly. A CUNO on the network is
`--host` instead.

### Docker

Multi-arch image (amd64, arm64, armv7):

```
docker run -d --name cul2mqtt --restart unless-stopped --device /dev/ttyACM0 --group-add $(stat -c %g /dev/ttyACM0) \
  -e CUL2MQTT_SERIALPORT=/dev/ttyACM0 -e CUL2MQTT_MQTT_URL=mqtt://192.168.1.2 \
  ghcr.io/hobbyquaker/cul2mqtt
```

`--device` passes the CUL through, `--group-add` gives the unprivileged container user the
serial port's group. A map file can be mounted and referenced with `CUL2MQTT_MAP_FILE`. State
(learned offline intervals, FS20 timers) lives in the `/data` volume. A commented Compose file is in
[docker-compose.example.yml](docker-compose.example.yml). Disable the maintenance topics with
`CUL2MQTT_MAINTENANCE=false` (the `--no-` form does not exist as a variable).

### Run as a systemd service

```
sudo cul2mqtt --install --name cul --serialport /dev/ttyACM0 --mqtt-url mqtt://192.168.1.2
```

`--install` creates a system user `cul2mqtt` (member of `dialout` for the serial port), writes the
given options to `/etc/cul2mqtt/<name>.env` (`CUL2MQTT_*` variables — edit and
`systemctl restart cul2mqtt@<name>` to change), installs the template unit
`/etc/systemd/system/cul2mqtt@.service` and enables + starts `cul2mqtt@<name>`. The instance name
is the `--name` option, i.e. the MQTT topic prefix. Logs: `journalctl -u cul2mqtt@<name> -f`.

**Several CULs** (e.g. one in SlowRF and one in MORITZ mode): run `--install` once per device with
a different `--name` — each becomes its own instance `cul2mqtt@<name>` with its own config and
topic prefix, sharing one template unit and one system user:

```
sudo cul2mqtt --install --name cul  --serialport /dev/ttyACM0 --mqtt-url mqtt://broker
sudo cul2mqtt --install --name max  --serialport /dev/ttyACM1 --cul-mode MORITZ --mqtt-url mqtt://broker
systemctl status 'cul2mqtt@*'
```

`sudo cul2mqtt --uninstall --name max` removes one instance (the template unit goes with the last
one).

Tip: with several USB serial devices use a stable path like
`/dev/serial/by-id/usb-busware.de_CUL868-if00` instead of `/dev/ttyACM0`.

### Deploy to a host (developers)

`deploy.sh [user@host]` packs the module, copies it to the host, installs it under
`/usr/local/lib/node_modules/cul2mqtt` and restarts every `cul2mqtt@<name>` service there
(`SERVICE`, `REMOTE_DIR`, `SKIP_TESTS` env vars, see the script). Install the service once with
`--install` first.

## Topics

Topics and payloads follow the [mqtt-smarthome architecture](https://github.com/mqtt-smarthome/mqtt-smarthome).
`cul` is the instance name (`--name`).

### `cul/connected`

Retained. `0` = cul2mqtt is not running (set via last will), `1` = connected to the broker but the
CUL is not open (unplugged, wrong port, telnet down — retried every 10 s), `2` = connected to both.

### `cul/status/<protocol>/<address>/<field>`

One retained item per parsed value. Every status is
`{"val": <value>, "ts": <ms received>, "lc": <ms last changed>}` (mqtt-smarthome); with
`--no-json-payloads` the plain value is published instead. Protocol names are lower case, field
names snake_case; `rssi` is published alongside when the CUL reports it.

| protocol | devices                           | example topics                                                                                                                                                         |
| -------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs20`   | FS20 remotes, sensors, actuators  | `cul/status/fs20/6C4800` — the received command (`on`, `off`, `toggle`, `dim50%`, ...) as an **event, not retained**; `cul/status/fs20/6C4800/time` for timer commands |
| `em`     | EM1000 power / gas / water meters | `cul/status/em/0205/current`, `cul/status/em/0205/total`, `cul/status/em/0205/cumulative` (see below), `cul/status/em/0205/peak`                                       |
| `ws`     | S300TH, KS300, ...                | `cul/status/ws/1/temperature`, `cul/status/ws/1/humidity`                                                                                                              |
| `hms`    | HMS100T, HMS100TF, ...            | `cul/status/hms/A5E3/temperature`, `cul/status/hms/A5E3/humidity`, `cul/status/hms/A5E3/battery`                                                                       |
| `fht`    | FHT80b thermostats                | `cul/status/fht/1234/measured_temp`, `cul/status/fht/1234/desired_temp`, `cul/status/fht/1234/actuator`                                                                |
| `moritz` | MAX! (`--cul-mode MORITZ`)        | `cul/status/moritz/0A1B2C/measured_temperature`, `cul/status/moritz/0A1B2C/valveposition`, `cul/status/moritz/0A1B2C/isopen`                                           |

What exactly is published depends on the parsers in the [cul](https://github.com/hobbyquaker/cul)
library.

#### New devices

A device heard for the first time is not published at once: only after `--confirm-count` telegrams
(default 3) within `--confirm-window` seconds (default 3600) do its status topics and Home Assistant
discovery appear. Until then cul2mqtt logs `cul unconfirmed device <protocol>/<address>`. A single
garbled telegram therefore does not leave a phantom device in Home Assistant that never reports
again. Telegrams less than 10 s apart count once, as many devices repeat each transmission at once. Devices named in the configuration (`--fs20-devices`, `--uniroll-devices`, an address in
`--only`) count as confirmed; confirmed devices are remembered in `--state-dir`
(`confirmed-devices.json`). `--confirm-count 1` publishes on the first telegram, as before.

`cul/info` (retained JSON) describes the running instance: adapter name and version, implemented
mqtt-smarthome spec version, node version, host, pid, start time, whether maintenance topics are on.

#### Map file

`--map-file names.json` replaces addresses with friendly names. Keys are item prefixes
(`<protocol>/<address>` or `<protocol>/<address>/<field>`, case-insensitive), values the name that
replaces the matched part:

```json
{
  "EM/0205": "power_dishwasher",
  "FS20/6C4800": "doorbell",
  "WS/1": "living_room",
  "WS/4/temperature": "garden_temperature"
}
```

→ `cul/status/power_dishwasher/current`, `cul/status/doorbell` (event),
`cul/status/living_room/temperature`, `cul/status/garden_temperature`. See
[example-map.json](example-map.json).

A value may also be an object: `{"name": "power_dryer", "timeout": 900}` — `name` renames as
above, `timeout` sets the offline detection timeout in seconds for that device (see below).

### `cul/status/<protocol>/<address>/online`

Retained, `1`/`0`. Offline detection (on by default, `--no-offline-detection` disables it): a
device that stays silent longer than its timeout is marked offline. The timeout per device is, in
order of precedence:

1. an explicit `timeout` (seconds) in the map file object value — always wins, disables interval
   learning for that device; `0` turns detection off for the device.
2. self-learned from the observed message gaps — only ever _wider_ than the protocol default
   (median of the recent gaps × 3, or the largest recent gap × 1.5, whichever is larger), so
   devices that send slower or lose more messages than expected don't flap. Disable with
   `--no-learn-intervals`.
3. a lenient per-protocol default: EM, WS and HMS 30 min, FHT 60 min. SlowRF reception routinely
   loses several transmissions in a row, so a missed cycle or three is normal, not offline.

Event-only protocols (FS20 remotes ring when someone presses them, not on a schedule) are never
marked offline unless a map file `timeout` opts them in. Learned intervals and last-seen times are
persisted in `--state-dir` (systemd sets `$STATE_DIRECTORY=/var/lib/cul2mqtt/<name>`; without a
state dir learning starts over on restart).

### EM meter totals

An EM1000 sends its pulse total as a 16-bit counter: it wraps at 65536 and starts again at 0 after
a battery change. `cul/status/em/<address>/total` is that raw counter;
`cul/status/em/<address>/cumulative` adds a basis kept per meter so the value only grows — like
FHEM's CUL_EM: when the total drops, a previous total above 65000 counts as a wraparound (+65536),
anything else as a reset (+ previous total). The basis is persisted in `--state-dir`
(`em-counters.json`); without a state dir it starts over on restart.

To continue a reading taken over from another system, set the initial basis in pulses with
`--em-basis '{"0205": 123456}'` (from FHEM: the `basis` reading of the CUL_EM device). It is only
used for meters without saved state. Conversion to m³ or kWh is up to the consumer, e.g. a Home
Assistant template sensor.

### `cul/set/fs20/<address>`

Sends an FS20 command. `<address>` is housecode + address as 6 hex digits (`6C4800`) or
`<housecode>/<address>` (`6C48/00`, ELV notation works too). Payload is a plain value or
mqtt-smarthome style JSON (`{"val": "on"}`):

| payload                                                                                               | sends                                                |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `on`, `off`, `true`, `false`, `1`, `0`                                                                | `on` / `off`                                         |
| `0`..`100`                                                                                            | nearest dim step (`dim06%` ... `dim100%`, 0 = `off`) |
| `toggle`, `dimup`, `dimdown`, `dimupdown`, `on-for-timer`, `off-for-timer`, `sendstate`, `reset`, ... | the FS20 command as culfw names it                   |
| `{"cmd": "on-for-timer", "time": 120}`                                                                | command with a timer in seconds                      |
| `11`..`ff` (2 hex digits)                                                                             | raw FS20 command byte                                |

```
mosquitto_pub -t cul/set/fs20/6C4800 -m on
mosquitto_pub -t cul/set/fs20/6C4801 -m 50
mosquitto_pub -t cul/set/fs20/6C4802 -m '{"cmd": "on-for-timer", "time": 300}'
```

### `cul/set/fht/<device>/<command>`

Sends an FHT command (`desired-temp` or `mode`); needs `--fht-central <code>`. The device is its
four-digit hexadecimal RF address (as shown in the status topic). The payload is the value,
alternatively JSON `{"cmd": "desired-temp", "value": 21.5}` on `cul/set/fht/<device>`.

```
mosquitto_pub -t cul/set/fht/1234/desired-temp -m 21.5
```

### `cul/set/uniroll/<group><device>`

Moves a LoTT UNIRoll shutter (needs culfw ≥ 1.58). The address is the 4 hex digit group plus the
1 hex digit device (`12340`, or `1234/0`); the payload is `up`, `down` or `stop` (`open` / `close`,
as a Home Assistant cover sends them, work too). Anything else is rejected rather than sent.

```
mosquitto_pub -t cul/set/uniroll/12340 -m down
```

UNIRoll is send-only: the protocol has no preamble, so culfw cannot report received frames and
there is no status topic — the position Home Assistant shows is optimistic. To get a cover entity,
list the shutters in `--uniroll-devices` (`CUL2MQTT_UNIROLL_DEVICES`):

```json
[
  {"name": "Living room shutter", "address": "12340"},
  {"name": "Garden shutter", "address": "12341", "stop_before_cmd": false}
]
```

Like FHEM's `sendStopBeforeCmd` (default `1`), a listed shutter gets a `stop` 100 ms before every
`up` / `down`, so the command starts a movement instead of only stopping a running one;
`"stop_before_cmd": false` sends the command alone (`sendStopBeforeCmd 0`). A bare
`set/uniroll/...` to an address that is not listed sends exactly what was asked. FHEM's channel is
the device digit as is: `define … UNIRoll 1234 2` is address `12342`.

### FS20 covers

FS20 shutter and awning actuators such as the FS20 RSU have one command per direction, and
repeating the command of a running movement stops it. List them in `--fs20-devices` with
`"type": "cover"` to get a Home Assistant cover:

```json
[
  {
    "name": "Awning",
    "address": "6C4800",
    "type": "cover",
    "open": "off",
    "close": "on",
    "device_class": "awning",
    "run_time": 40
  }
]
```

| key            | default   |                                                                                |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `open`         | `on`      | FS20 command that opens (for an awning: extends)                               |
| `close`        | `off`     | FS20 command that closes (retracts)                                            |
| `device_class` | `shutter` | Home Assistant cover device class (`awning`, `blind`, `shade`, `shutter`, ...) |
| `run_time`     | unknown   | seconds after which a movement counts as finished; without it, it never does   |

`cul/set/fs20/<address>` then also takes `open`, `close` and `stop`. cul2mqtt remembers the
direction it sent last: `stop` repeats it, `open` / `close` in the direction already running is not
sent again (it would stop), and the other direction is sent as is. A movement started by a remote
or by the actuator's own end stop is not seen; with `run_time` a later `stop` is skipped instead
of starting the motor again. The state in Home Assistant is optimistic, as for every FS20 actuator.

### Cover positions from run times

UNIRoll shutters and FS20 covers report nothing back. With the run times of a full movement in
their definition, cul2mqtt keeps a position like FHEM's ROLLO module (`rl_type HomeKit`):

```json
{"name": "Living room shutter", "address": "12340", "seconds_open": 25, "seconds_close": 16}
```

| key             | default |                                                                        |
| --------------- | ------- | ---------------------------------------------------------------------- |
| `seconds_open`  |         | seconds from closed to fully open (FHEM `rl_secondsUp`)                |
| `seconds_close` |         | seconds from open to fully closed (FHEM `rl_secondsDown`)              |
| `switch_time`   | `0`     | pause in seconds between stopping and reversing (FHEM `rl_switchTime`) |
| `calibrate`     | `open`  | end position the Calibrate button runs to: `open` or `close`           |

The cover then publishes `cul/status/<protocol>/<address>/position` (0 = closed, 100 = open) and
`.../state` (`opening`, `closing`, `open`, `closed`, `stopped`), and its command topic also takes a
target position as a number. A position between the ends is reached by sending open / close and a
stop after the share of the run time; an end position is left to the end stop. From an unknown
position the cover first opens fully (or runs straight closed, if that is the target). The position is persisted in `--state-dir`
(`cover-positions.json`). Operation at the cover itself (switch, remote) is not seen, so after that
the position is off until the cover is next sent to an end position.

To re-sync after that, `cul/set/<protocol>/<address>/calibrate` (any payload; a **Calibrate** button
in Home Assistant) runs the cover to its `calibrate` end position for the full run time, whatever
position is assumed.
`cul/set/<protocol>/<address>/sync` with a position (0..100) sets it without moving anything.

### `cul/set/raw`

With `--raw-set`, any culfw command line is written to the CUL (`F6C480011`, `X21`, ...). This is
an unrestricted RF transmitter — protect your broker with authentication/ACLs before enabling it.
`--publish-raw` does the opposite: every line received from the CUL is published on `cul/raw`
(not retained), useful for unsupported protocols.

### Moving devices over gradually: `--only` and `--ignore`

Both options name protocols or single devices cul2mqtt leaves alone: nothing it hears from them is
published (no status, events, offline tracking or discovery) and `set` requests to them are
refused. Entries are a protocol (`fht`) or a device as it appears in the status topic
(`fs20/6C4800`, `em/0205`), case-insensitive, separated by commas or spaces.

- `--only` (`CUL2MQTT_ONLY`) is an allow list: everything not on it is left alone. Start with one
  device and add entries as you move devices over from another central such as FHEM — devices it
  still manages do not show up in Home Assistant twice, and neither do your neighbours' weather
  stations.
- `--ignore` (`CUL2MQTT_IGNORE`) is the opposite and wins over `--only`, e.g. once most devices have
  moved: `--ignore 'fht fhttk'`.

```
cul2mqtt --only 'uniroll em/0205' ...
```

Both win over `--fs20-devices` / `--uniroll-devices` definitions. Announcements published before a
device was left alone stay retained on the broker; delete the device in Home Assistant or publish an
empty retained message on its `homeassistant/device/.../config` topic. `set/raw` and `cul/raw`
(`--publish-raw`) are not filtered.

### Processed event monitor

`--publish-events` is on by default. Every parsed field update is also published as a non-retained
JSON message on `cul/event/<protocol>/<address>/<field>` (or the mapped item name), for example
`cul/event/fht/4d3f/measured_temp`. It contains `protocol`, `address`, `field`, `value`, optional
`rssi`, and `received_at`. This is the MQTT equivalent of FHEM's Event Monitor; unlike `cul/raw`,
it shows decoded updates rather than radio frames.

### `cul/maintenance/set/<command>`

| command    | payload                            |                                                                                           |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `loglevel` | `error`, `warn`, `info` or `debug` | change the log level at runtime (e.g. to see `cul >`/`cul <` traffic without a restart)   |
| `restart`  | anything                           | graceful shutdown (`connected 0`) and exit 0; systemd (`Restart=always`) / Docker restart |

Anyone who can publish to your broker can use these. Use broker authentication and ACLs, or
disable them with `--no-maintenance`.

## Home Assistant

MQTT discovery is on by default (HA ≥ 2024.11, device-based discovery). Every RF address the CUL
hears becomes its own HA device — `ws/1` or, with a map file, `living_room` — with a sensor per
field (temperature, humidity, signal strength, power etc. get the matching device class and unit;
booleans like `open` or `battery_low` become binary sensors) and the
manufacturer/model derived from the protocol (`ELV S300TH`, `ELV EM1000`, `ELV FHT80b`, `eQ-3 MAX!`,
...). The devices are linked to the CUL itself, which appears as a bridge device with a
_Connected_ diagnostic. Devices are announced as they show up on air (each address has to send
once); availability follows `cul/connected` — and, with offline detection (the default), the
per-device `online` item: a device that stops sending becomes _unavailable_ in HA on its own.

An FHT80b that reports `measured_temp` also announces a native MQTT climate entity. Its target
temperature uses `cul/set/fht/<hex-address>/desired-temp`; HA's `auto` maps to FHT `AUTO`, while
HA's `heat` maps to FHT `MANU`. The existing FHT80TF contact discovery remains a binary sensor.
cul2mqtt never sends to an FHT on its own unless you opt in: with `--fht-init` (and
`--fht-central`), a newly discovered FHT that reports a temperature but has not yet reported both
its mode and target temperature is set once to manual mode and 16 °C, and that initialisation
marker is persisted in `--state-dir`. This overrides the thermostat's weekly program, so leave it
off while another central (e.g. FHEM) still manages the FHTs — without it, the climate entity shows
mode and target as soon as the thermostat reports them. Each FHT
device also has a **Sync time** button. It sends date and time only when explicitly pressed; it is
never run automatically.

FS20 actuators do not report back, so they cannot be discovered; list them in `--fs20-devices` to
get switches, lights or covers (see [FS20 covers](#fs20-covers)) with an optimistic state. An FS20 remote appears as a device with one sensor
holding the last command. UNIRoll shutters listed in `--uniroll-devices` become covers.
`--no-ha-discovery` disables discovery and removes all announcements on startup; `--ha-prefix`
changes the discovery prefix.

## Notes

- An unplugged or busy CUL is logged once at `warn`; the connection is retried every 10 s and
  `cul/connected` goes back to `2` when it is back. CUNO (telnet) connections have a watchdog; a
  silent link is reconnected the same way.
- The RF protocol parsing lives in the [cul](https://github.com/hobbyquaker/cul) library (1.x) —
  its README lists the supported devices and the parsed fields per protocol. Open parser issues
  there, with the raw line from `-v debug` or `cul/raw`. Messages it has no parser for are logged at
  `debug` only.
- serialport ships prebuilt binaries, so `npm install -g cul2mqtt` needs no compiler on the
  Raspberry Pi.
- Under systemd the log goes to the journal without timestamps and with proper priorities
  (`journalctl -u cul2mqtt@<name> -p warning`).

## License

[Licensed under GPLv2](LICENSE)

Copyright (c) 2015–2026 Sebastian Raff <hobbyquaker@gmail.com>

[gpl-badge]: https://img.shields.io/badge/License-GPL-blue.svg?style=flat
[gpl-url]: LICENSE
