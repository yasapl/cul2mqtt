# CUL2MQTT

Packages the complete cul2mqtt project for Home Assistant. It supports the same CUL, COC, SCC and
CUNO connection modes as the command-line project, and publishes discovered devices through Home
Assistant MQTT Discovery.

## Configuration

| Option           | Meaning                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `serialport`     | CUL serial device. This is used when `host` is empty.                                                                         |
| `host` / `port`  | Network CUNO/CUL hostname and TCP port. Setting `host` selects TCP instead of serial.                                         |
| `cul_mode`       | `SlowRF`, `MORITZ`, or `AskSin`, matching the original project.                                                               |
| `coc` / `scc`    | Enable these for the corresponding Busware Raspberry Pi devices.                                                              |
| `fht_central`    | Four-digit hexadecimal FHT central ID. Required for temperature and mode commands.                                            |
| `fs20_devices`   | Explicit FS20 actuators: `name`, six-digit hexadecimal `address`, optional `type`, and optional initial `on_time` in seconds. |
| `instance_name`  | MQTT topic prefix; leave as `cul` unless more than one CUL is used.                                                           |
| `mqtt_url`       | Optional external MQTT broker URL. Leave empty (the default) to use Home Assistant's MQTT service.                            |
| `log_level`      | Set `debug` to show `cul <` decoded input and `cul >` commands in the app log.                                                |
| `publish_raw`    | Also publish unprocessed CUL lines on `<instance_name>/raw`.                                                                  |
| `publish_events` | Publish each decoded update on `<instance_name>/event/...`; enabled by default.                                               |

By default the app obtains its MQTT host, username and password automatically from Home Assistant's
MQTT service. Nothing needs to be entered for the normal HA/Mosquitto setup. It can instead use any
external broker via `mqtt_url`, `mqtt_username`, and `mqtt_password`.

Serial devices are mapped into the app automatically. Files such as map files and TLS CAs can be
stored in the app configuration directory and referenced by their in-container path.

FS20 actuators do not report their state, so define each one explicitly. Home Assistant shows an
optimistic state based on the last command sent, not a confirmation from the actuator. Each device
gets an **On timer** number entity. Set it to `1`–`15360` seconds to send `on-for-timer` whenever the
switch is turned on, or set it to `0` for normal continuous on. `on_time` sets its initial value.
The displayed switch state returns to off when the timer expires.

Configure FS20 switches and lights in the app's **Configuration** page under `fs20_devices`.
Changes take effect after saving the configuration and restarting the app.

Home Assistant discovery IDs preserve their existing spelling so Home Assistant can match the
device and entity registry entries created by earlier releases. FHT thermostats also keep their
house-code identifier. On upgrade, retained lowercase discovery announcements from version 0.2.14
are cleared as devices are rediscovered.

```yaml
fs20_devices:
  - name: Hall light
    address: 6C4800
    type: light
  - name: Pump
    address: 6C4801
    type: switch
    on_time: 300
```

The app build pins the matching CUL2MQTT commit from this repository so builds are repeatable.

FHT80b devices announce a native climate entity after they report a temperature. FHT80TF contacts
announce as binary sensors. The FHT climate entity currently supports target temperature and
auto/manual mode; schedules and holiday mode are intentionally not exposed yet. If a newly
discovered FHT has a temperature but no mode or target temperature, it is set once to manual mode
and 10 °C. Use the device's **Sync time** button to send date and time manually; no time sync is
performed automatically.
