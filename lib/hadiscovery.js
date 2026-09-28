/**
 * Home Assistant discovery from the items seen so far: the CUL is a bridge device, every RF
 * address (`<protocol>/<address>`, or its map-file name) becomes its own device linked to the
 * bridge via `via_device`, with one sensor per scalar field. Devices announce themselves by
 * sending; device classes are derived from the field name. The scaffold (topics, availability,
 * origin) comes from mqtt-interfaces-core.
 */

import {availability, discoveryId, entity} from 'mqtt-interfaces-core';

/** field name → HA sensor attributes */
const FIELDS = {
    temperature: {dev_cla: 'temperature', unit_of_meas: '°C', stat_cla: 'measurement'},
    desired_temperature: {dev_cla: 'temperature', unit_of_meas: '°C'},
    measured_temperature: {dev_cla: 'temperature', unit_of_meas: '°C', stat_cla: 'measurement'},
    heater_temperature: {dev_cla: 'temperature', unit_of_meas: '°C', stat_cla: 'measurement'},
    comfort_temperature: {dev_cla: 'temperature', unit_of_meas: '°C', ent_cat: 'config'},
    eco_temperature: {dev_cla: 'temperature', unit_of_meas: '°C', ent_cat: 'config'},
    day_temp: {dev_cla: 'temperature', unit_of_meas: '°C', ent_cat: 'config'},
    night_temp: {dev_cla: 'temperature', unit_of_meas: '°C', ent_cat: 'config'},
    desired_temp: {dev_cla: 'temperature', unit_of_meas: '°C'},
    measured_low: {dev_cla: 'temperature', unit_of_meas: '°C', stat_cla: 'measurement'},
    humidity: {dev_cla: 'humidity', unit_of_meas: '%', stat_cla: 'measurement'},
    valve_position: {unit_of_meas: '%', ic: 'mdi:valve'},
    actuator: {unit_of_meas: '%', ic: 'mdi:valve'},
    rssi: {dev_cla: 'signal_strength', unit_of_meas: 'dBm', ent_cat: 'diagnostic', stat_cla: 'measurement'},
    battery: {ic: 'mdi:battery', ent_cat: 'diagnostic'},
    battery_state: {ic: 'mdi:battery', ent_cat: 'diagnostic'},
    battery_low: {dev_cla: 'battery', ent_cat: 'diagnostic'},
    low_temperature: {dev_cla: 'problem', ent_cat: 'diagnostic', ic: 'mdi:thermometer-alert'},
    window_open: {dev_cla: 'opening', ent_cat: 'diagnostic'},
    window_sensor_error: {dev_cla: 'problem', ent_cat: 'diagnostic'},
    current: {ic: 'mdi:flash', stat_cla: 'measurement'},
    peak: {ic: 'mdi:flash'},
    total: {ic: 'mdi:counter', stat_cla: 'total_increasing'},
    voltage: {dev_cla: 'voltage', unit_of_meas: 'V', stat_cla: 'measurement'},
    power: {dev_cla: 'power', unit_of_meas: 'W', stat_cla: 'measurement'},
    energy: {dev_cla: 'energy', unit_of_meas: 'kWh', stat_cla: 'total_increasing'},
    frequency: {dev_cla: 'frequency', unit_of_meas: 'Hz', stat_cla: 'measurement'},
    power_factor: {dev_cla: 'power_factor', stat_cla: 'measurement'},
    open: {dev_cla: 'opening'},
    mode_str: {ic: 'mdi:thermostat'},
};

const LABELS = {
    mode: 'Operating mode', desired_temp: 'Target temperature', measured_temp: 'Current temperature',
    day_temp: 'Day temperature', night_temp: 'Night temperature', windowopen_temp: 'Window-open temperature',
    lowtemp_offset: 'Low-temperature offset', warnings: 'Warnings', battery_low: 'Low battery',
    low_temperature: 'Low temperature', window_open: 'Window open', window_sensor_error: 'Window sensor error',
    actuator: 'Valve position', rssi: 'Signal strength', holiday1: 'Holiday start', holiday2: 'Holiday end',
    time: 'Thermostat time', date: 'Thermostat date',
};
const WEEKDAYS = {mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday'};
function friendlyLabel(field) {
    if (LABELS[field]) return LABELS[field];
    const schedule = /^(mon|tue|wed|thu|fri|sat|sun)_(from|to)([12])$/.exec(field);
    if (schedule) return `${WEEKDAYS[schedule[1]]} period ${schedule[3]} ${schedule[2] === 'from' ? 'starts' : 'ends'}`;
    return field.replace(/_/g, ' ').replace(/\\b\\w/g, (letter) => letter.toUpperCase());
}

/** protocol → HA device manufacturer / model */
const MODELS = {
    fs20: {mf: 'ELV', mdl: 'FS20'},
    em: {mf: 'ELV', mdl: 'EM1000'},
    ws: {mf: 'ELV', mdl: 'S300TH / KS300'},
    hms: {mf: 'ELV', mdl: 'HMS'},
    fht: {mf: 'eQ-3', mdl: 'FHT80b'},
    moritz: {mf: 'eQ-3', mdl: 'MAX!'},
    asksin: {mf: 'eQ-3', mdl: 'HomeMatic'},
};

export function uidFor(item) {
    return item.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/**
 * Split a published item into its device part and field: `living_room/temperature` →
 * `living_room` + `temperature`; a single-segment item (fully mapped, or an FS20 event) is both.
 */
export function splitItem(item) {
    const i = item.lastIndexOf('/');
    return i < 0 ? {device: item, field: item} : {device: item.slice(0, i), field: item.slice(i + 1)};
}

/**
 * @param {object} input
 * @param {string} input.name instance name / topic prefix
 * @param {Map<string, {val: *, retain: boolean, raw?: string, device?: string}>} input.items items
 *        seen so far (published name → last value, `raw` = unmapped `<protocol>/<address>/<field>`)
 * @param {boolean} input.jsonPayloads
 * @param {Array<{name: string, address: string, type?: 'switch'|'light', on_time?: number}>} input.fs20Devices explicit FS20 actuators
 * @returns {Array<{id: string, device: object, components: object, availabilityMin?: number}>}
 */
export function discoveryModel({name, items, jsonPayloads = true, fs20Devices = []}) {
    const bridgeId = discoveryId('cul2mqtt', name);
    const devices = new Map();
    for (const [item, {val, raw, device: label}] of items) {
        if (!['string', 'number', 'boolean'].includes(typeof val)) {
            continue;
        }
        const {device, field} = splitItem(item);
        const protocol = String((raw || item).split('/')[0]).toLowerCase();
        if (!devices.has(device)) {
            const rawParts = (raw || item).split('/');
            devices.set(device, {
                id: `${bridgeId}_${uidFor(device)}`,
                itemBase: device,
                protocol: rawParts[0].toLowerCase(),
                address: rawParts[1],
                device: {
                    name: device,
                    via_device: bridgeId,
                    ...(MODELS[protocol] || {mdl: protocol.toUpperCase()}),
                    // the cul parser names the device type for some protocols (S300TH, KS300, ...)
                    ...(label && {mdl: String(label)}),
                },
                components: {},
            });
        }
        const dev = devices.get(device);
        if (field === 'online' && device !== item) {
            // offline detection item: per-device availability (bridge connected AND device online,
            // avty_mode 'all' comes from the core), not a sensor
            dev.availability = [
                ...availability(name),
                {
                    t: `${name}/status/${item}`,
                    // the template of an entry of an availability *list* is `val_tpl`; `avty_tpl`
                    // expands to `availability_template`, which Home Assistant's schema for such an
                    // entry does not allow - and it refuses the whole device payload over it
                    // (core 0.15.2)
                    val_tpl: jsonPayloads
                        ? "{{ 'online' if value_json.val else 'offline' }}"
                        : "{{ 'online' if value == '1' else 'offline' }}",
                },
            ];
            continue;
        }
        // FHT byte fields are inputs to the combined temperature/time/date values, not useful entities.
        if (protocol === 'fht' && ['measured_low', 'measured_high', 'hour', 'minute', 'day', 'month', 'year'].includes(field)) continue;
        const {ent_cat: category, ic: icon, ...extra} = FIELDS[field] || {};
        const binary = typeof val === 'boolean';
        dev.components[uidFor(field)] = entity({
            id: dev.id,
            name,
            item,
            uid: uidFor(field),
            platform: binary ? 'binary_sensor' : 'sensor',
            label: friendlyLabel(field),
            icon,
            category,
            jsonPayloads,
            extra: field === 'mode'
                ? { ...extra, val_tpl: jsonPayloads
                      ? "{{ 'Automatic' if value_json.val == 'AUTO' else 'Manual' if value_json.val == 'MANU' else value_json.val }}"
                      : "{{ 'Automatic' if value == 'AUTO' else 'Manual' if value == 'MANU' else value }}" }
                : binary
                ? {
                      ...extra,
                      // booleans (batteryLow, open, ...) as binary sensors
                      val_tpl: jsonPayloads
                          ? "{{ 'ON' if value_json.val else 'OFF' }}"
                          : "{{ 'ON' if value == 'true' else 'OFF' }}",
                  }
                : extra,
        });
    }

    for (const dev of devices.values()) {
        if (dev.protocol !== 'fht' || !dev.components.measured_temp) {
            continue;
        }
        const base = `${name}/status/${dev.itemBase}`;
        dev.components.climate = {
            p: 'climate',
            uniq_id: `${dev.id}_climate`,
            name: 'Thermostat',
            curr_temp_t: `${base}/measured_temp`,
            ...(jsonPayloads && {curr_temp_tpl: '{{ value_json.val }}'}),
            temp_stat_t: `${base}/desired_temp`,
            ...(jsonPayloads && {temp_stat_tpl: '{{ value_json.val }}'}),
            temp_cmd_t: `${name}/set/fht/${dev.address}/desired-temp`,
            mode_stat_t: `${base}/mode`,
            mode_stat_tpl: jsonPayloads
                ? "{{ 'auto' if value_json.val == 'AUTO' else 'heat' }}"
                : "{{ 'auto' if value == 'AUTO' else 'heat' }}",
            mode_cmd_t: `${name}/set/fht/${dev.address}/mode`,
            mode_cmd_tpl: "{{ 'AUTO' if value == 'auto' else 'MANU' }}",
            act_t: `${base}/actuator`,
            act_tpl: jsonPayloads
                ? "{{ 'heating' if value_json.val | float(0) > 10 else 'idle' }}"
                : "{{ 'heating' if value | float(0) > 10 else 'idle' }}",
            modes: ['auto', 'heat'],
            initial: 16,
            min_temp: 10,
            max_temp: 30,
            precision: 0.5,
        };
        dev.components.sync_time = {
            p: 'button',
            uniq_id: `${dev.id}_sync_time`,
            name: 'Sync time',
            cmd_t: `${name}/set/fht/${dev.address}/sync-time`,
        };
    }

    for (const definition of fs20Devices) {
        const address = String(definition?.address || '')
            .trim()
            .toUpperCase();
        const label = String(definition?.name || '').trim();
        const type = String(definition?.type || 'switch').toLowerCase();
        if (!label || !/^[0-9A-F]{6}$/.test(address) || !['switch', 'light'].includes(type)) {
            continue;
        }
        const id = `${bridgeId}_fs20_${address}`;
        const topic = `${name}/set/fs20/${address}`;
        const component = {
            p: type,
            uniq_id: `${id}_control`,
            name: null,
            cmd_t: topic,
            stat_t: `${name}/status/fs20/${address}/state`,
            ...(jsonPayloads && {stat_tpl: '{{ value_json.val }}'}),
        };
        if (type === 'light') {
            component.bri_cmd_t = topic;
            component.bri_scl = 100;
        }
        devices.set(`fs20/${address}`, {
            id,
            device: {name: label, via_device: bridgeId, ...MODELS.fs20},
            components: {
                control: component,
                on_time: {
                    p: 'number',
                    uniq_id: `${id}_on_time`,
                    name: 'On timer',
                    stat_t: `${name}/status/fs20/${address}/on_time`,
                    ...(jsonPayloads && {stat_tpl: '{{ value_json.val }}'}),
                    cmd_t: `${topic}/on_time`,
                    min: 0,
                    max: 15_360,
                    step: 1,
                    unit_of_meas: 's',
                },
            },
        });
    }

    const bridge = {
        id: bridgeId,
        device: {mf: 'Busware', mdl: 'CUL'},
        availabilityMin: 1,
        components: {
            connected: entity({
                id: bridgeId,
                name,
                item: 'connected',
                uid: 'connected',
                platform: 'binary_sensor',
                label: 'Connected',
                category: 'diagnostic',
                extra: {
                    stat_t: `${name}/connected`,
                    val_tpl: "{{ 'ON' if (value | int(0)) >= 2 else 'OFF' }}",
                    dev_cla: 'connectivity',
                },
            }),
        },
    };
    return [bridge, ...devices.values()];
}
