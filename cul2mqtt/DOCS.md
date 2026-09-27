# CUL2MQTT

Connects Home Assistant directly to a network CUL/MAXCUL and publishes discovered devices through
Home Assistant MQTT Discovery. It needs the official Mosquitto Broker app installed and running.

## Configuration

| Option           | Meaning                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| `maxcul_host`    | IP address or DNS name of the MAXCUL/A-culfw device.                               |
| `maxcul_port`    | TCP CUL port; normally `2323`.                                                     |
| `fht_central`    | Four-digit hexadecimal FHT central ID. Required for temperature and mode commands. |
| `instance_name`  | MQTT topic prefix; leave as `cul` unless more than one CUL is used.                |
| `log_level`      | Set `debug` to show `cul <` decoded input and `cul >` commands in the app log.     |
| `publish_raw`    | Also publish unprocessed CUL lines on `<instance_name>/raw`.                       |
| `publish_events` | Publish each decoded update on `<instance_name>/event/...`; enabled by default.    |

The app obtains the MQTT connection and credentials from Home Assistant's Mosquitto Broker service.
No MQTT credentials are entered here.

This first app release installs the matching, pinned CUL2MQTT commit from this repository during
the local build. Later app releases will pin their corresponding tested CUL2MQTT version too.

FHT80b devices announce a native climate entity after they report a temperature. FHT80TF contacts
announce as binary sensors. The FHT climate entity currently supports target temperature and
auto/manual mode; schedules and holiday mode are intentionally not exposed yet.
