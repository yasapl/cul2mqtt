# CUL2MQTT

Packages the complete cul2mqtt project for Home Assistant. It supports the same CUL, COC, SCC and
CUNO connection modes as the command-line project, and publishes discovered devices through Home
Assistant MQTT Discovery.

## Configuration

| Option           | Meaning                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `serialport`     | CUL serial device. This is used when `host` is empty.                                                                 |
| `host` / `port`  | Network CUNO/CUL hostname and TCP port. Setting `host` selects TCP instead of serial.                                 |
| `cul_mode`       | `SlowRF`, `MORITZ`, or `AskSin`, matching the original project.                                                       |
| `coc` / `scc`    | Enable these for the corresponding Busware Raspberry Pi devices.                                                      |
| `fht_central`    | Four-digit hexadecimal FHT central ID. Required for temperature and mode commands.                                    |
| `fs20_devices`   | Explicit FS20 actuators: `name`, six-digit hexadecimal `address`, optional `type`, and optional `on_time` in seconds. |
| `instance_name`  | MQTT topic prefix; leave as `cul` unless more than one CUL is used.                                                   |
| `mqtt_url`       | Optional external MQTT broker URL. Leave empty (the default) to use Home Assistant's MQTT service.                    |
| `log_level`      | Set `debug` to show `cul <` decoded input and `cul >` commands in the app log.                                        |
| `publish_raw`    | Also publish unprocessed CUL lines on `<instance_name>/raw`.                                                          |
| `publish_events` | Publish each decoded update on `<instance_name>/event/...`; enabled by default.                                       |

By default the app obtains its MQTT host, username and password automatically from Home Assistant's
MQTT service. Nothing needs to be entered for the normal HA/Mosquitto setup. It can instead use any
external broker via `mqtt_url`, `mqtt_username`, and `mqtt_password`.

Serial devices are mapped into the app automatically. Files such as map files and TLS CAs can be
stored in the app configuration directory and referenced by their in-container path.

FS20 actuators do not report their state, so define each one explicitly. The displayed state is
the last command sent, not a confirmation from the actuator. Set `on_time` to send `on-for-timer`
whenever the Home Assistant switch is turned on; the displayed state returns to off when the timer
expires.

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

This first app release installs the matching, pinned CUL2MQTT commit from this repository during
the local build. Later app releases will pin their corresponding tested CUL2MQTT version too.

FHT80b devices announce a native climate entity after they report a temperature. FHT80TF contacts
announce as binary sensors. The FHT climate entity currently supports target temperature and
auto/manual mode; schedules and holiday mode are intentionally not exposed yet.
