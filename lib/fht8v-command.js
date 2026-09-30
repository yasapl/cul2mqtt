/** Encode the FHT8V commands used by FHEM's 11_FHT8V module. */

function address(value) {
    const normalized = String(value).trim().toUpperCase();
    if (!/^[0-9A-F]{4}$/.test(normalized)) {
        throw new Error(`FHT8V address "${value}" must be four hexadecimal digits`);
    }
    return normalized;
}

export function fht8vPositionCommand(device, percent) {
    const position = Number(percent);
    if (!Number.isInteger(position) || position < 0 || position > 100) {
        throw new Error('FHT8V valve position must be an integer from 0 to 100');
    }
    // Match FHEM's sprintf("%02X", position * 2.55), including its truncation behavior.
    const encoded = Math.floor(position * 2.55)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    return `T${address(device)}0026${encoded}`;
}

export function fht8vPairCommand(device) {
    return `T${address(device)}002F00`;
}

/** FHT8V addresses must share the central's low byte and use one of its next eight high bytes. */
export function isFht8vAddressForCentral(device, central) {
    const valve = String(device).trim().toUpperCase();
    const master = String(central).trim().toUpperCase();
    if (!/^[0-9A-F]{4}$/.test(valve) || !/^[0-9A-F]{4}$/.test(master)) {
        return false;
    }
    const centralHigh = Number.parseInt(master.slice(0, 2), 16);
    const valveHigh = Number.parseInt(valve.slice(0, 2), 16);
    return valve.slice(2) === master.slice(2) && valveHigh >= centralHigh && valveHigh < centralHigh + 8;
}

export function defaultFht8wAddress(central) {
    const master = String(central).trim().toUpperCase();
    if (!/^[0-9A-F]{4}$/.test(master)) {
        throw new Error('FHT8W emulation requires a four-digit hexadecimal fht_central');
    }
    const high = Number.parseInt(master.slice(0, 2), 16);
    const next = Math.min(high + 1, 0xff);
    return `${next.toString(16).padStart(2, '0')}${master.slice(2)}`.toUpperCase();
}
