import {communicationTopic} from './communication.js';
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
    temperature: {
        dev_cla: 'temperature',
        unit_of_meas: '°C',
        stat_cla: 'measurement',
    },
    desired_temperature: {dev_cla: 'temperature', unit_of_meas: '°C'},
    measured_temperature: {
        dev_cla: 'temperature',
        unit_of_meas: '°C',
        stat_cla: 'measurement',
    },
    heater_temperature: {
        dev_cla: 'temperature',
        unit_of_meas: '°C',
        stat_cla: 'measurement',
    },
    comfort_temperature: {
        dev_cla: 'temperature',
        unit_of_meas: '°C',
        ent_cat: 'config',
    },
    eco_temperature: {
        dev_cla: 'temperature',
        unit_of_meas: '°C',
        ent_cat: 'config',
    },
    day_temp: {dev_cla: 'temperature', unit_of_meas: '°C', ent_cat: 'config'},
    night_temp: {dev_cla: 'temperature', unit_of_meas: '°C', ent_cat: 'config'},
    desired_temp: {dev_cla: 'temperature', unit_of_meas: '°C'},
    measured_temp: {
        dev_cla: 'temperature',
        unit_of_meas: '°C',
        stat_cla: 'measurement',
    },
    date: {dev_cla: 'date'},
    measured_low: {
        dev_cla: 'temperature',
        unit_of_meas: '°C',
        stat_cla: 'measurement',
    },
    humidity: {dev_cla: 'humidity', unit_of_meas: '%', stat_cla: 'measurement'},
    valve_position: {unit_of_meas: '%', ic: 'mdi:valve'},
    actuator: {unit_of_meas: '%', ic: 'mdi:valve'},
    rssi: {
        dev_cla: 'signal_strength',
        unit_of_meas: 'dBm',
        ent_cat: 'diagnostic',
        stat_cla: 'measurement',
    },
    battery: {ic: 'mdi:battery', ent_cat: 'diagnostic'},
    battery_state: {ic: 'mdi:battery', ent_cat: 'diagnostic'},
    battery_low: {dev_cla: 'battery', ent_cat: 'diagnostic'},
    low_temperature: {
        dev_cla: 'problem',
        ent_cat: 'diagnostic',
        ic: 'mdi:thermometer-alert',
    },
    window_open: {dev_cla: 'opening', ent_cat: 'diagnostic'},
    window_sensor_error: {dev_cla: 'problem', ent_cat: 'diagnostic'},
    current: {ic: 'mdi:flash', stat_cla: 'measurement'},
    peak: {ic: 'mdi:flash'},
    total: {ic: 'mdi:counter', stat_cla: 'total_increasing'},
    voltage: {dev_cla: 'voltage', unit_of_meas: 'V', stat_cla: 'measurement'},
    power: {dev_cla: 'power', unit_of_meas: 'W', stat_cla: 'measurement'},
    energy: {
        dev_cla: 'energy',
        unit_of_meas: 'kWh',
        stat_cla: 'total_increasing',
    },
    frequency: {
        dev_cla: 'frequency',
        unit_of_meas: 'Hz',
        stat_cla: 'measurement',
    },
    power_factor: {dev_cla: 'power_factor', stat_cla: 'measurement'},
    open: {dev_cla: 'opening'},
    mode_str: {ic: 'mdi:thermostat'},
};

const LABELS = {
    mode: 'Operating mode',
    desired_temp: 'Target temperature',
    measured_temp: 'Current temperature',
    day_temp: 'Day temperature',
    night_temp: 'Night temperature',
    windowopen_temp: 'Window-open temperature',
    lowtemp_offset: 'Low-temperature offset',
    warnings: 'Warnings',
    battery_low: 'Low battery',
    low_temperature: 'Low temperature',
    window_open: 'Window open',
    window_sensor_error: 'Window sensor error',
    actuator: 'Valve position',
    rssi: 'Signal strength',
    holiday1: 'Holiday start',
    holiday2: 'Holiday end',
    time: 'Thermostat time',
    date: 'Thermostat date',
};
const WEEKDAYS = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
};
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
    fht8v: {mf: 'eQ-3', mdl: 'FHT8V'},
    fht8w: {mf: 'eQ-3', mdl: 'FHT8W (emulated)'},
    moritz: {mf: 'eQ-3', mdl: 'MAX!'},
    asksin: {mf: 'eQ-3', mdl: 'HomeMatic'},
};

export function uidFor(item) {
    return item.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/** Discovery IDs used by the normalized release, so its retained configs can be cleared. */
export function normalizedDiscoveryIds({name, items, fs20Devices = [], fht8vDevices = [], fht8wAddress = ''}) {
    const bridgeId = discoveryId('cul2mqtt', name);
    const ids = new Set([bridgeId]);
    for (const [item, value] of items) {
        ids.add(`${bridgeId}_${uidFor(splitItem(item).device)}`);
        if (value.raw) {
            ids.add(`${bridgeId}_${uidFor(splitItem(value.raw).device)}`);
        }
    }
    for (const definition of fs20Devices) {
        ids.add(`${bridgeId}_fs20_${String(definition.address).toUpperCase()}`);
    }
    for (const definition of fht8vDevices) {
        ids.add(`${bridgeId}_fht8v_${String(definition.address).toUpperCase()}`);
    }
    if (fht8wAddress) {
        ids.add(`${bridgeId}_fht8w_${String(fht8wAddress).toUpperCase()}`);
    }
    return [...new Set([...ids].map((id) => id.toLowerCase()))];
}

/** Return the FHT8V/FHT8W discovery id to remove when a retained config is no longer active. */
export function obsoleteFhtDiscoveryId(topic, {name, haPrefix = 'homeassistant', activeIds = []}) {
    const levels = String(topic).split('/');
    const suffix = levels.slice(-3);
    if (suffix.length !== 3 || suffix[0] !== 'device' || suffix[2] !== 'config') {
        return null;
    }
    if (levels.slice(0, -3).join('/') !== haPrefix) {
        return null;
    }

    const id = suffix[1];
    const normalisedId = id.toLowerCase();
    const prefix = `${discoveryId('cul2mqtt', name).toLowerCase()}_`;
    if (!normalisedId.startsWith(`${prefix}fht8v_`) && !normalisedId.startsWith(`${prefix}fht8w_`)) {
        return null;
    }
    const active = new Set(activeIds.map((activeId) => String(activeId).toLowerCase()));
    return active.has(normalisedId) ? null : id;
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
 * @param {Array<{name: string, address: string}>} input.fht8vDevices explicitly configured physical FHT8V valves
 * @param {string} input.fht8wAddress active emulated FHT8W report address, if enabled
 * @returns {Array<{id: string, device: object, components: object, availabilityMin?: number}>}
 */
export function discoveryModel({
    name,
    items,
    jsonPayloads = true,
    rawSet = false,
    fs20Devices = [],
    fht8vDevices = [],
    fht8wAddress = '',
}) {
    // Discovery IDs are registry keys in Home Assistant. Preserve their original spelling so
    // existing device and entity registry entries continue to match after upgrading.
    const bridgeId = discoveryId('cul2mqtt', name);
    const devices = new Map();
    for (const [item, {val, raw, device: label}] of items) {
        if (!['string', 'number', 'boolean'].includes(typeof val)) {
            continue;
        }
        const {device, field} = splitItem(item);
        const protocol = String((raw || item).split('/')[0]).toLowerCase();
        const deviceKey = device.toLowerCase();
        if (!devices.has(deviceKey)) {
            const rawParts = (raw || item).split('/');
            const legacyId = `${bridgeId}_${uidFor(device)}`;
            const id = protocol === 'fht' ? `${legacyId}_v2` : legacyId;
            devices.set(deviceKey, {
                id,
                itemBase: device,
                protocol: rawParts[0].toLowerCase(),
                address: rawParts[1],
                ...(protocol === 'fht' && {legacyDiscoveryIds: [legacyId]}),
                device: {
                    name: device,
                    via_device: bridgeId,
                    ...(raw && rawParts[1] && {sn: rawParts[1]}),
                    ...(MODELS[protocol] || {mdl: protocol.toUpperCase()}),
                    // Keep the FHT device separate from manually configured MQTT devices, which commonly
                    // use the bare house code (for example, `423c`) as their identifier.
                    ...(protocol === 'fht' && {
                        ids: [`${bridgeId}_fht_${uidFor(rawParts[1])}`],
                    }),
                    // the cul parser names the device type for some protocols (S300TH, KS300, ...)
                    ...(label && {mdl: String(label)}),
                },
                components: {},
                // Keep components indexed by their original protocol field as well as their
                // mapped/published name. FHT climate topics must follow the actual mapped
                // state topics when a map file renames fields such as desired_temp.
                rawComponents: {},
            });
        }
        const dev = devices.get(deviceKey);
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
        if (
            protocol === 'fht' &&
            ['measured_low', 'measured_high', 'hour', 'minute', 'day', 'month', 'year'].includes(field)
        )
            continue;
        const {ent_cat: category, ic: icon, ...extra} = FIELDS[field] || {};
        const binary = typeof val === 'boolean';
        const component = entity({
            id: dev.id,
            name,
            item,
            uid: uidFor(field),
            platform: binary ? 'binary_sensor' : 'sensor',
            label: friendlyLabel(field),
            icon,
            category,
            jsonPayloads,
            extra:
                field === 'mode'
                    ? {
                          ...extra,
                          val_tpl: jsonPayloads
                              ? "{{ 'Automatic' if value_json.val == 'AUTO' else 'Manual' if value_json.val == 'MANU' else value_json.val }}"
                              : "{{ 'Automatic' if value == 'AUTO' else 'Manual' if value == 'MANU' else value }}",
                      }
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
        dev.components[uidFor(field)] = component;
        const rawField = splitItem(raw || item).field;
        dev.rawComponents[rawField] = component;
    }

    for (const dev of devices.values()) {
        const measuredTemp = dev.rawComponents.measured_temp;
        const desiredTemp = dev.rawComponents.desired_temp;
        const mode = dev.rawComponents.mode;
        const actuator = dev.rawComponents.actuator;
        if (dev.protocol !== 'fht' || !measuredTemp) {
            continue;
        }
        const base = `${name}/status/${dev.itemBase}`;
        dev.components.climate = {
            p: 'climate',
            uniq_id: `${dev.id}_climate`,
            name: 'Thermostat',
            curr_temp_t: measuredTemp.stat_t,
            ...(jsonPayloads && {curr_temp_tpl: '{{ value_json.val }}'}),
            temp_stat_t: desiredTemp?.stat_t || `${base}/desired_temp`,
            ...(jsonPayloads && {temp_stat_tpl: '{{ value_json.val }}'}),
            temp_cmd_t: `${name}/set/fht/${dev.address}/desired-temp`,
            mode_stat_t: mode?.stat_t || `${base}/mode`,
            mode_stat_tpl: jsonPayloads
                ? "{{ 'auto' if value_json.val == 'AUTO' else 'heat' }}"
                : "{{ 'auto' if value == 'AUTO' else 'heat' }}",
            mode_cmd_t: `${name}/set/fht/${dev.address}/mode`,
            mode_cmd_tpl: "{{ 'AUTO' if value == 'auto' else 'MANU' }}",
            act_t: actuator?.stat_t || `${base}/actuator`,
            act_tpl: jsonPayloads
                ? "{{ 'heating' if value_json.val | float(0) > 10 else 'idle' }}"
                : "{{ 'heating' if value | float(0) > 10 else 'idle' }}",
            modes: ['auto', 'heat'],
            temp_unit: 'C',
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
            opt: false,
            ...(jsonPayloads && {
                val_tpl: "{{ 'ON' if value_json.val else 'OFF' }}",
            }),
            ...(!jsonPayloads && {
                val_tpl: "{{ 'ON' if value == 'true' else 'OFF' }}",
            }),
        };
        if (type === 'light') {
            component.bri_cmd_t = topic;
            component.bri_scl = 100;
        }
        devices.set(`fs20/${address}`, {
            id,
            device: {
                name: label,
                via_device: bridgeId,
                sn: address,
                ...MODELS.fs20,
            },
            components: {
                control: component,
                timer_remaining: {
                    p: 'sensor',
                    uniq_id: `${id}_timer_remaining`,
                    name: 'Timer remaining',
                    stat_t: `${name}/status/fs20/${address}/timer_remaining`,
                    ...(jsonPayloads && {val_tpl: '{{ value_json.val }}'}),
                    dev_cla: 'duration',
                    unit_of_meas: 's',
                    stat_cla: 'measurement',
                    ic: 'mdi:timer-sand',
                },
                ...Object.fromEntries(
                    Array.from({length: 5}, (_, index) => {
                        const slot = index + 1;
                        const field = index === 0 ? 'on_time' : `timer_${slot}`;
                        const componentId = slot === 1 ? 'on_time' : `timer_${slot}_duration`;
                        return [
                            componentId,
                            {
                                p: 'number',
                                uniq_id: `${id}_${field}`,
                                name: `Timer ${slot} duration`,
                                stat_t: `${name}/status/fs20/${address}/${field}`,
                                ...(jsonPayloads && {val_tpl: '{{ value_json.val }}'}),
                                cmd_t: `${topic}/${field}`,
                                opt: false,
                                min: 0,
                                max: 15_360,
                                step: 0.25,
                                unit_of_meas: 's',
                            },
                        ];
                    }),
                ),
                ...Object.fromEntries(
                    Array.from({length: 5}, (_, index) => {
                        const slot = index + 1;
                        return [
                            `timer_${slot}_button`,
                            {
                                p: 'button',
                                uniq_id: `${id}_on_for_timer_${slot}`,
                                name: `Turn on for timer ${slot}`,
                                cmd_t: `${topic}/on-for-timer/${slot}`,
                                pl_prs: 'PRESS',
                            },
                        ];
                    }),
                ),
            },
        });
    }

    for (const definition of fht8vDevices) {
        const address = String(definition?.address || '')
            .trim()
            .toUpperCase();
        const label = String(definition?.name || '').trim();
        if (!label || !/^[0-9A-F]{4}$/.test(address)) {
            continue;
        }
        const id = `${bridgeId}_fht8v_${address}`;
        const base = `${name}/status/fht8v/${address.toLowerCase()}`;
        devices.set(`fht8v/${address.toLowerCase()}`, {
            id,
            device: {
                name: label,
                via_device: bridgeId,
                sn: address,
                ids: [id],
                ...MODELS.fht8v,
            },
            components: {
                valve_position: {
                    p: 'number',
                    mode: 'box',
                    uniq_id: `${id}_valve_position`,
                    name: 'Valve position',
                    stat_t: `${base}/valve_position`,
                    ...(jsonPayloads && {val_tpl: '{{ value_json.val }}'}),
                    cmd_t: `${name}/set/fht8v/${address}/valve-position`,
                    opt: false,
                    min: 0,
                    max: 100,
                    step: 1,
                    unit_of_meas: '%',
                    ic: 'mdi:valve',
                },
                pair: {
                    p: 'button',
                    uniq_id: `${id}_pair`,
                    name: 'Pair with CUL',
                    cmd_t: `${name}/set/fht8v/${address}/pair`,
                    pl_prs: 'PRESS',
                },
            },
        });
    }

    if (/^[0-9A-F]{4}$/.test(String(fht8wAddress).toUpperCase())) {
        const address = String(fht8wAddress).toUpperCase();
        const id = `${bridgeId}_fht8w_${address}`;
        const base = `${name}/status/fht8w/${address.toLowerCase()}`;
        devices.set(`fht8w/${address.toLowerCase()}`, {
            id,
            device: {
                name: 'Virtual FHT8W',
                via_device: bridgeId,
                sn: address,
                ids: [id],
                ...MODELS.fht8w,
            },
            components: {
                valve_position: {
                    p: 'number',
                    mode: 'box',
                    uniq_id: `${id}_valve_position`,
                    name: 'Heat request valve position',
                    stat_t: `${base}/valve_position`,
                    ...(jsonPayloads && {val_tpl: '{{ value_json.val }}'}),
                    cmd_t: `${name}/set/fht8w/${address}/valve-position`,
                    opt: false,
                    min: 0,
                    max: 100,
                    step: 1,
                    unit_of_meas: '%',
                    ic: 'mdi:valve',
                },
                active_position: {
                    p: 'sensor',
                    uniq_id: `${id}_active_position`,
                    name: 'Last transmitted valve position',
                    stat_t: `${base}/active_position`,
                    ...(jsonPayloads && {val_tpl: '{{ value_json.val }}'}),
                    unit_of_meas: '%',
                    ic: 'mdi:valve',
                },
                report: {
                    p: 'button',
                    uniq_id: `${id}_report_valve_position`,
                    name: 'Request heat (130 s)',
                    cmd_t: `${name}/set/fht8w/${address}/report`,
                    pl_prs: 'PRESS',
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
            ...(rawSet && {
                raw_command: {
                    p: 'text',
                    uniq_id: `${bridgeId}_raw_command`,
                    name: 'Raw CUL command',
                    cmd_t: `${name}/set/raw/command`,
                    stat_t: `${name}/status/raw/command`,
                    ...(jsonPayloads && {val_tpl: '{{ value_json.val }}'}),
                    mode: 'text',
                    max: 128,
                },
                send_raw_command: {
                    p: 'button',
                    uniq_id: `${bridgeId}_send_raw_command`,
                    name: 'Send raw command',
                    cmd_t: `${name}/set/raw/send`,
                    pl_prs: 'PRESS',
                },
            }),
            ...Object.fromEntries(
                [
                    ['ccconf', 'CC1101 configuration'],
                    ['cmds', 'Available CUL commands'],
                    ['credit10ms', 'CUL transmission credit'],
                    ['fhtbuf', 'FHT buffer space'],
                    ['uptime', 'CUL uptime'],
                    ['version', 'CUL firmware version'],
                ].map(([key, label]) => [
                    `diagnostic_${key}`,
                    {
                        p: 'button',
                        uniq_id: `${bridgeId}_diagnostic_${key}`,
                        name: label,
                        cmd_t: `${name}/set/diagnostic/${key}`,
                        pl_prs: 'PRESS',
                        ent_cat: 'diagnostic',
                    },
                ]),
            ),
            diagnostic_result: {
                p: 'text',
                uniq_id: `${bridgeId}_diagnostic_result`,
                name: 'Last CUL query result',
                // Home Assistant's MQTT text discovery requires command_topic
                // even though this entity displays query results only. Writes
                // to this topic are rejected by handleSet; they never reach CUL.
                cmd_t: `${name}/set/diagnostic/result`,
                stat_t: `${name}/status/diagnostic/result`,
                ...(jsonPayloads && {val_tpl: '{{ value_json.val }}'}),
                mode: 'text',
                max: 255,
                ent_cat: 'diagnostic',
            },
        },
    };
    // Remove internal lookup data before returning the discovery model.
    for (const [key, dev] of devices) {
        if (Object.keys(dev.components).length === 0) {
            delete dev.rawComponents;
            continue;
        }
        const rawDevice = dev.protocol && dev.address ? `${dev.protocol}/${dev.address}` : key;
        dev.components.communication = {
            p: 'event',
            uniq_id: `${dev.id}_communication`,
            name: 'Communication',
            stat_t: `${name}/${communicationTopic(rawDevice)}`,
            event_types: ['sent', 'received'],
            ic: 'mdi:swap-horizontal',
        };
        delete dev.rawComponents;
    }
    return [bridge, ...devices.values()];
}
