/**
 * Maps a parsed cul message to mqtt-smarthome status items.
 *
 *   <protocol>/<address>            FS20 command as event (not retained): on, off, toggle, dim50%, ...
 *   <protocol>/<address>/<field>    one retained item per parsed value (temperature, humidity,
 *                                   current, desired_temperature, ...) plus rssi
 *
 * Protocol names are lower case, field names snake_case. An optional map file renames items
 * (see mapItem).
 */

/** Parser meta fields that are not published as items. */
const SKIP = new Set([
    'seq',
    'len',
    'strlen',
    'expectedlen',
    'msgcnt',
    'msgFlag',
    'msgTypeRaw',
    'payload',
    'cmdRaw',
    'valueRaw',
    'addressCode',
    'addressCodeElv',
    'addressDevice',
    'addressDeviceElv',
    'src',
    'dst',
    'dstDevice',
    'unknownBits',
    'stateRaw',
    'confirmRaw',
    'reportRaw',
    'repetition',
    'error',
]);

export function snakeCase(name) {
    return String(name)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .toLowerCase();
}

function scalar(value) {
    return ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * @param {object} obj parsed message from cul's `data` event
 * @returns {Array<{item: string, val: *, retain: boolean}>}
 */
export function itemsFor(obj) {
    if (!obj || !obj.protocol || obj.address === undefined || obj.address === null || obj.address === '') {
        return [];
    }
    const base = `${String(obj.protocol).toLowerCase()}/${obj.address}`;
    const data = obj.data && typeof obj.data === 'object' ? obj.data : {};
    if (data.error) {
        // the parser could not make sense of the message (checksum, length, no matching decoder)
        return [];
    }
    const items = [];

    switch (String(obj.protocol).toUpperCase()) {
        case 'FS20': {
            const cmd = data.cmd || data.cmdRaw;
            if (cmd !== undefined) {
                items.push({item: base, val: String(cmd), retain: false});
            }
            if (typeof data.time === 'number' && data.time > 0) {
                items.push({item: `${base}/time`, val: data.time, retain: false});
            }
            break;
        }
        case 'FHT': {
            if (
                data.cmd &&
                data.cmd !== 'UNKNOWN' &&
                !['hour', 'minute', 'day', 'month', 'year'].includes(snakeCase(data.cmd))
            ) {
                const val = data.value !== undefined ? data.value : data.valueRaw;
                items.push({item: `${base}/${snakeCase(data.cmd)}`, val: numeric(val), retain: true});
                if (data.cmd === 'warnings') {
                    const warning = String(val || '').toUpperCase();
                    items.push(
                        {item: `${base}/battery_low`, val: warning.includes('BATT'), retain: true},
                        {item: `${base}/low_temperature`, val: warning.includes('TEMP LOW'), retain: true},
                        {item: `${base}/window_open`, val: warning.includes('WINDOW OPEN'), retain: true},
                        {item: `${base}/window_sensor_error`, val: warning.includes('WINDOW ERR'), retain: true},
                    );
                }
            }
            break;
        }
        default:
            for (const [key, value] of Object.entries(data)) {
                if (SKIP.has(key) || !scalar(value)) {
                    continue;
                }
                items.push({item: `${base}/${snakeCase(key)}`, val: value, retain: true});
            }
    }

    if (typeof obj.rssi === 'number' && Number.isFinite(obj.rssi)) {
        items.push({item: `${base}/rssi`, val: obj.rssi, retain: true});
    }
    return items;
}

/**
 * FHT80b sends its measured temperature in two frames.  The low byte arrives first and the
 * high byte completes the value: (high * 256 + low) / 10.  Keep this protocol detail outside
 * the generic item mapper so callers can retain the two bytes independently.
 *
 * @param {object} obj parsed CUL message
 * @param {Map<string, {low?: number, high?: number}>} parts previous bytes by FHT address
 * @returns {{item: string, val: number, retain: boolean}|undefined}
 */
export function fhtMeasuredTemperature(obj, parts) {
    if (String(obj?.protocol).toUpperCase() !== 'FHT') {
        return undefined;
    }
    const data = obj.data || {};
    if (!['measured-low', 'measured-high'].includes(data.cmd) || !/^[0-9a-f]{2}$/i.test(data.valueRaw || '')) {
        return undefined;
    }
    const address = String(obj.address || '');
    if (!address) {
        return undefined;
    }
    const current = parts.get(address) || {};
    current[data.cmd === 'measured-low' ? 'low' : 'high'] = Number.parseInt(data.valueRaw, 16);
    parts.set(address, current);
    if (data.cmd !== 'measured-high' || current.low === undefined) {
        return undefined;
    }
    return {item: `fht/${address}/measured_temp`, val: (current.high * 256 + current.low) / 10, retain: true};
}

/** Combine FHT calendar/time bytes into HA-friendly date and clock sensor states. */
const FHT_CLOCK_FIELDS = new Set(['hour', 'minute', 'day', 'month', 'year']);

/**
 * Convert a cached FHT byte to a combined clock/date item. Previous releases published raw
 * valueRaw via numeric(), so digit-only hex bytes may be retained as numbers (e.g. 0x10 as 10).
 * Parsing the stored scalar's string representation as hexadecimal reverses that conversion.
 */
export function fhtClockItemsFromValue(address, field, value, parts) {
    if (!FHT_CLOCK_FIELDS.has(field) || value === undefined || value === null || value === '') return [];
    const hex = String(value);
    if (!/^[0-9a-f]{1,2}$/i.test(hex)) return [];
    const current = parts.get(String(address)) || {};
    current[field] = Number.parseInt(hex, 16);
    parts.set(String(address), current);
    const out = [];
    if (
        (field === 'hour' || field === 'minute') &&
        Number.isInteger(current.hour) &&
        current.hour < 24 &&
        Number.isInteger(current.minute) &&
        current.minute < 60
    ) {
        out.push({
            item: `fht/${address}/time`,
            val: `${String(current.hour).padStart(2, '0')}:${String(current.minute).padStart(2, '0')}`,
            retain: true,
        });
    }
    const year = Number.isInteger(current.year) ? 2000 + current.year : NaN;
    const date = new Date(Date.UTC(year, current.month - 1, current.day));
    if (
        (field === 'year' || field === 'month' || field === 'day') &&
        Number.isFinite(year) &&
        current.month >= 1 &&
        current.month <= 12 &&
        current.day >= 1 &&
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === current.month - 1 &&
        date.getUTCDate() === current.day
    ) {
        out.push({
            item: `fht/${address}/date`,
            val: `${year}-${String(current.month).padStart(2, '0')}-${String(current.day).padStart(2, '0')}`,
            retain: true,
        });
    }
    return out;
}

/** Combine FHT calendar/time bytes from live radio messages. */
export function fhtClockItems(obj, parts) {
    if (String(obj?.protocol).toUpperCase() !== 'FHT') return [];
    const field = snakeCase(obj.data?.cmd || '');
    if (!FHT_CLOCK_FIELDS.has(field) || !/^[0-9a-f]{2}$/i.test(obj.data?.valueRaw || '')) return [];
    const address = String(obj.address || '');
    if (!address) return [];
    return fhtClockItemsFromValue(address, field, obj.data.valueRaw, parts);
}

function numeric(value) {
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) {
        return Number(value);
    }
    return value;
}

/**
 * Rename an item via the map file: keys are items or item prefixes (`EM/0205`, `WS/1/temperature`,
 * case-insensitive), values the friendly name. A prefix match keeps the remaining path.
 */
export function mapItem(item, map) {
    if (!map) {
        return item;
    }
    const lower = item.toLowerCase();
    let best = null;
    for (const [key, name] of Object.entries(map)) {
        const k = key.toLowerCase().replace(/^\/+|\/+$/g, '');
        if (lower === k || lower.startsWith(k + '/')) {
            if (!best || k.length > best.key.length) {
                best = {key: k, name: typeof name === 'string' ? name : name && name.name};
            }
        }
    }
    if (!best || !best.name) {
        return item;
    }
    return best.name + item.slice(best.key.length);
}
