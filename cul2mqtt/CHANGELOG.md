# Changelog

## 0.2.36

### Added

- A **Communication** MQTT event entity for each discovered RF device, distinguishing sent commands from received value changes.
- Non-retained communication messages containing the device address, field, value, previous value when known, and timestamp.
- Separate repeat filtering for sent and received values, with baselines saved across clean app restarts.

### Behaviour

- Unchanged reports, periodic clock updates, RSSI and availability do not generate communication activity.
- Sent means successfully written to the CUL; it does not confirm delivery to the thermostat.
- Communication events belong to their own event entity, rather than the climate entity's Activity.
- Existing MQTT topics, entity IDs, commands and configuration remain unchanged. Repeat filtering applies only to the new communication stream.
- No blueprint or direct Home Assistant Activity API logging is included.

### Upgrade notes

- No configuration migration is required. New Communication entities are created through MQTT discovery.
- Automated tests and lint pass; live validation in Home Assistant remains outstanding.

## 0.2.35

### Fixed

- Correct the **Last CUL query result** text entity's maximum length from 512 to 255 characters so Home Assistant accepts its discovery configuration.
- Full diagnostic replies remain available in the app log.

## 0.2.34

### Fixed

- Accept short hexadecimal FHT buffer replies to prevent the **FHT buffer space** query from timing out when the CUL parser misclassifies the reply.
- Include the command topic required by Home Assistant for discovery of **Last CUL query result**. Editing the result does not send a radio command.

## 0.2.33

### Added

- Diagnostic buttons for firmware version, uptime, FHT buffer space, transmission credit, available commands and CC1101 configuration.
- One shared **Last CUL query result** text entity.
- Diagnostic queries work without enabling unrestricted raw commands or raw traffic publishing.

### Known issues resolved in later releases

- Some FHT buffer replies timed out; fixed in 0.2.34.
- Home Assistant rejected the result text entity's discovery configuration; fully fixed in 0.2.35.
