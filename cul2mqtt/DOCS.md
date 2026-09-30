# CUL2MQTT Home Assistant App

Connect a CUL-compatible radio running culfw to MQTT and Home Assistant. The app supports serial CUL,
COC, and SCC devices, network CUNO/CUL devices, MQTT discovery, and the same radio protocols as the
original CUL2MQTT project.

## Installation

1. In Home Assistant, open **Settings → Apps → App Store**, open the menu, and add this repository:

   ```text
   https://github.com/yasapl/cul2mqtt
   ```

2. Install **CUL2MQTT** and choose a radio connection:

   - **Serial:** set `serialport` to the CUL device path. Leave `host` empty. The default is
     `/dev/ttyACM0`.
   - **TCP:** set `host` to the CUNO/CUL network address. `port` defaults to `2323`. A non-empty
     `host` selects TCP and the serial settings are ignored.

3. Confirm Home Assistant's MQTT integration is connected to the broker the app will use. Start
   the app. Supported devices are discovered as their radio messages arrive.

The app uses the Home Assistant MQTT service and its credentials by default. For an external broker,
set `mqtt_url` and, if needed, `mqtt_username` and `mqtt_password`. Home Assistant's MQTT integration
must use that same broker for discovery to work.

## Configuration

Options are set in the app's **Configuration** page. Defaults are shown below.

| Option                  | Default         | Description                                                                                                                                                                                                                 |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serialport`            | `/dev/ttyACM0`  | Serial device path; used when `host` is empty.                                                                                                                                                                              |
| `host`                  | empty           | CUNO/CUL hostname or IP. A value selects TCP instead of serial.                                                                                                                                                             |
| `port`                  | `2323`          | CUNO/CUL TCP port.                                                                                                                                                                                                          |
| `baudrate`              | `0`             | Serial baud rate override. `0` uses the CUL library default: 9600, or 38400 with `coc`/`scc`. Ignored for TCP.                                                                                                              |
| `cul_mode`              | `SlowRF`        | Radio mode: `SlowRF`, `MORITZ`, or `AskSin`. Choose the mode matching the protocols and firmware in use.                                                                                                                    |
| `coc`                   | `false`         | Enable for a Busware COC connected to a Raspberry Pi.                                                                                                                                                                       |
| `scc`                   | `false`         | Enable for a Busware SCC connected to a Raspberry Pi.                                                                                                                                                                       |
| `fht_central`           | empty           | Four-digit hexadecimal FHT central ID. The app sets this as the CUL's own FHT ID on connection. Required for FHT commands, time sync, first-time climate initialization, physical FHT8V control, and virtual FHT8W reports. |
| `fs20_devices`          | `[]`            | FS20 devices to expose in Home Assistant. Define each with a `name`, six-digit hexadecimal `address`, optional `type` (`switch` or `light`), and optional `on_time` initial timer value in seconds.                         |
| `fht8v_devices`         | `[]`            | Physical FHT8V valves to expose. Each entry has a `name` and four-digit hexadecimal `address` compatible with `fht_central`.                                                                                                |
| `fht8w_enabled`         | `false`         | Expose virtual FHT8W controls to send a manually selected valve-position report to a physical FHT8W demand relay.                                                                                                           |
| `fht8w_address`         | derived         | Optional four-digit hexadecimal report address for the virtual FHT8W. By default, the app uses the next compatible high byte after `fht_central`.                                                                           |
| `instance_name`         | `cul`           | Prefix for MQTT topics and the MQTT client ID. Change it when another CUL2MQTT instance uses the same broker.                                                                                                               |
| `mqtt_url`              | empty           | Leave empty to use the Home Assistant MQTT service. For an external broker, set a URL such as `mqtt://broker:1883` or `mqtts://broker:8883`.                                                                                |
| `mqtt_username`         | empty           | Username for an external MQTT broker.                                                                                                                                                                                       |
| `mqtt_password`         | empty           | Password for an external MQTT broker.                                                                                                                                                                                       |
| `mqtt_client_id_prefix` | empty           | Optional prefix for the MQTT client ID. A random suffix is added automatically.                                                                                                                                             |
| `mqtt_tls_ca`           | empty           | Path to a CA certificate for an `mqtts://` broker. Store the file in the app configuration directory and use its `/config/...` path.                                                                                        |
| `log_level`             | `info`          | Log level: `error`, `warn`, `info`, or `debug`. Info logs decoded received events and successfully sent commands; debug adds raw received `cul <` and outgoing `cul >` lines. Debug is not required to send commands.       |
| `publish_raw`           | `false`         | Publish raw lines received from the CUL on `<instance_name>/raw`. This is for monitoring incoming radio traffic.                                                                                                            |
| `raw_set`               | `false`         | Accept raw CUL firmware commands on `<instance_name>/set/raw`. This enables sending commands; it is separate from `publish_raw`. See [Raw CUL commands](#raw-cul-commands).                                                 |
| `publish_events`        | `true`          | Publish each decoded field update as a non-retained message on `<instance_name>/event/...`.                                                                                                                                 |
| `offline_detection`     | `true`          | Mark devices unavailable when no message arrives within their timeout.                                                                                                                                                      |
| `learn_intervals`       | `true`          | Learn longer per-device offline timeouts from observed message gaps. Applies only when `offline_detection` is enabled.                                                                                                      |
| `json_payloads`         | `true`          | Publish retained status as mqtt-smarthome JSON (`val`, `ts`, `lc`). Disable for plain status values.                                                                                                                        |
| `ha_discovery`          | `true`          | Publish Home Assistant MQTT Discovery. Disabling it also clears the app's retained discovery announcements.                                                                                                                 |
| `ha_prefix`             | `homeassistant` | Home Assistant MQTT Discovery prefix; must match the prefix configured in Home Assistant.                                                                                                                                   |
| `maintenance`           | `true`          | Enable MQTT commands to change log level or request a graceful restart. See [Maintenance topics](#maintenance-and-diagnostics).                                                                                             |
| `stats_interval`        | `60`            | Publish retained process statistics every this many seconds to `<instance_name>/maintenance/stats`. Set to `0` to disable. This is independent of `maintenance`.                                                            |
| `map_file`              | empty           | Optional JSON file mapping protocol/address/field names to friendly names. Put it in the app configuration directory and reference it as `/config/filename.json`.                                                           |

### Files in the app configuration directory

The app configuration directory is mounted in the container at `/config`. For example, save a map
file there and set `map_file` to `/config/map.json`. A TLS CA certificate can be stored in the same
directory and referenced by `mqtt_tls_ca`.

### FS20 devices

FS20 actuators are one-way devices and do not report their state. Define each actuator under
`fs20_devices`; Home Assistant shows an optimistic state based on commands sent by the app. The
state starts off after an app restart because the actuator cannot confirm its actual state.

Each configured device gets a main switch, five timer-duration number entities, five matching
**Turn on for timer** buttons, and a **Timer remaining** sensor. Enter a duration from `0.25` to
`15360` seconds, then press its matching button. The timed command turns the main switch on and the
app returns it to off when the timer expires. A duration of `0` disables that timer button. FS20
rounds durations up to a supported radio interval; the app logs the effective duration when it
differs. Timer values persist across app restarts. The `on_time` option sets the initial value for
timer 1; omit it to start at `0`.

Example:

```yaml
fs20_devices:
  - name: Hall light
    address: 6C4800
    type: light
  - name: Hot water switch
    address: 6C4801
    type: switch
    on_time: 1800
```

Configure FS20 devices in the app's **Configuration** page. Changes take effect after saving and
restarting the app.

### FHT thermostats and valves

FHT80b thermostats publish a native climate entity after reporting a temperature. The climate
supports target temperature and `auto`/`heat` modes (`auto` maps to FHT automatic mode; `heat` maps
to manual mode). Current temperatures use °C. FHT80TF window contacts publish as binary sensors.
Schedules and holiday mode are not currently exposed.

If a newly discovered thermostat reports a temperature but is missing either its mode or target
temperature, the app initializes it once to manual mode and 16 °C. Each thermostat also has a
**Sync time** button; time is sent only when that button is pressed. Set `fht_central` for these
commands to work.

Configure physical FHT8V valves under `fht8v_devices`. Each gets a valve-position number entity and
a **Pair with CUL** button. FHEM's FHT8V module sends `T<address>002F00` for pairing and
`T<address>0026<encoded-position>` for position commands. Pair a real valve once with the CUL before
controlling its position. Position commands are sent directly to culfw, which handles the radio
timing; Home Assistant does not calculate a timeslot. The number retains the last position sent;
the app does not currently read back the physical valve's actual position.

The optional virtual FHT8W controls send valve-position reports to a physical FHT8W demand relay.
The **Heat request valve position** number selects the requested opening (20% by default); the
**Request heat (130 s)** button activates that value for 130 seconds. Pressing it again renews the
timer. The app sends 0% while idle and repeats the current value every 120 seconds. The separate
**Last transmitted valve position** sensor shows the most recently sent value. A renewed request is
included in the next report; when the timer expires, the next report returns to 0%. The
reporter waits for each CUL write to complete before scheduling the next one, so it cannot build up
a backlog of periodic reports. CUL/culfw handles the radio timing. The virtual report source does
not need pairing. Add its four-digit address to the physical FHT8W through its local interface. By
default the app derives this address from `fht_central` by adding one to the high byte (for example
`4241` → `4341`); `fht8w_address` overrides it. FHT8V addresses must use the same low byte as the
central and a high byte from the central's high byte through the next seven values. Do not assign
the same address to a virtual reporter and a physical FHT8V.

## MQTT topics and commands

Replace `cul` in the topic examples with the configured `instance_name` if it differs.

- `<instance_name>/connected`: retained connection state (`0` disconnected, `1` MQTT connected but
  CUL disconnected, `2` both connected).
- `<instance_name>/status/<protocol>/<address>/<field>`: retained decoded status values. By default
  payloads are JSON objects containing `val`, `ts`, and `lc`; set `json_payloads: false` for plain
  values.
- `<instance_name>/event/<protocol>/<address>/<field>`: received decoded updates, non-retained,
  when `publish_events` is enabled. These are useful as a processed event monitor. Commands sent by
  the app are shown in the app log, not published on this event topic.
- `<instance_name>/raw`: received CUL firmware lines, non-retained, when `publish_raw` is enabled.
- `<instance_name>/info`: retained information about the running instance.

Supported protocols and parsed fields depend on the CUL parser. Device-based Home Assistant
discovery is enabled by default; devices appear after the CUL receives a message from them.

### Sending FS20 commands

`<instance_name>/set/fs20/<address>` accepts a plain command or JSON. The address is six hexadecimal
digits (house code plus unit address), for example `6C4800`.

```text
Topic:   cul/set/fs20/6C4800
Payload: on
```

For a timer, publish JSON with `cmd` and `time` in seconds:

```json
{"cmd": "on-for-timer", "time": 300}
```

### Sending FHT commands

`<instance_name>/set/fht/<device>/<command>` supports `desired-temp` and `mode`. The FHT device
address is four hexadecimal digits. Set `fht_central` first.

```text
Topic:   cul/set/fht/1234/desired-temp
Payload: 21.5
```

### Raw CUL commands

Set `raw_set: true` in the app's configuration to enable
`<instance_name>/set/raw`. Publish a plain CUL firmware command as the payload. Sent commands are
recorded in the app log at `info`; `log_level: debug` additionally shows the raw outgoing `cul >`
line. `publish_raw` is also not required; it controls incoming raw messages in the opposite
direction.

With `raw_set: true`, the CUL bridge device in Home Assistant also has a **Raw CUL command** text
entity and a **Send raw command** button. Enter one command (up to 128 characters), then press the
button. The text value is saved in the app's `/data` state directory and restored after restart.
These controls use `<instance_name>/set/raw/command` and
`<instance_name>/set/raw/send` (payload `PRESS`). The direct `<instance_name>/set/raw` topic remains
available.

For example, with the default `instance_name: cul`:

```text
Topic:   cul/set/raw
Payload: T4341002633
```

Raw commands can transmit arbitrary radio commands. Enable this only when MQTT access is restricted
to trusted clients.

## Maintenance and diagnostics

These diagnostic topics are available:

| Topic                                      | Payload / effect                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<instance_name>/maintenance/set/loglevel` | With `maintenance: true`, `error`, `warn`, `info`, or `debug` changes logging at runtime.                                                                                                                  |
| `<instance_name>/maintenance/set/restart`  | With `maintenance: true`, requests a graceful app shutdown. Restart behavior is managed by Home Assistant.                                                                                                 |
| `<instance_name>/maintenance/stats`        | Retained process statistics, published at `stats_interval`: memory, CPU, event loop lag, uptime, and timestamp. Set `stats_interval: 0` to stop these updates. This topic is independent of `maintenance`. |

The log level can also be changed in the app Configuration page; that change requires restarting
the app. Use `debug` to inspect raw incoming `cul <` and outgoing `cul >` lines. Commands do not
require debug logging to be enabled.

Protect broker access with authentication and MQTT ACLs, especially if `raw_set` or maintenance
topics are enabled. Set `maintenance: false` to disable the log-level and restart commands. This
does not disable the statistics topic; use `stats_interval: 0` for that.

## Home Assistant discovery details

The app uses Home Assistant MQTT device-based discovery. `ha_discovery: false` disables discovery
and clears retained discovery announcements. Use `ha_prefix` only if Home Assistant is configured
with a different discovery prefix.

Home Assistant matches devices by their identifiers; a serial number is separate metadata.
CUL2MQTT scopes FHT identifiers to its instance, so its device stays separate from a manually
configured MQTT device whose identifier is just the house code. The FHT house code remains in the
serial-number field. On upgrade, the app clears the previous FHT discovery topic and republishes
the entities under a new discovery ID, so Home Assistant recreates them on the separate device
instead of retaining their old registry association with the manual MQTT device. Other RF devices
use their radio address in device info. Current-temperature entities use °C.
Older retained lowercase discovery announcements from version 0.2.14 are cleared during
rediscovery.

The app records learned device intervals and FS20 timer values in its persistent data directory so
they survive app restarts.
