/**
 * Encode the small, safe FHT command subset exposed by the Home Assistant climate entity.
 *
 * `cul`'s generic FHT helper accepts the old decimal ELV address notation and prepends T01
 * for every write.  Network CUL discovery uses the radio address as hexadecimal and A-culfw
 * clears its queued FHT frames on every T01, so this encoder deliberately produces only the
 * FHT data command.  The caller configures T01 once after connecting.
 */

const COMMANDS = {
    'desired-temp': {code: '41', type: 'temperature'},
    mode: {code: '3e', type: 'mode'},
};

function address(value) {
    const normalized = String(value).trim().toUpperCase();
    if (!/^[0-9A-F]{4}$/.test(normalized)) {
        throw new Error(`set/fht: device "${value}" must be the 4-digit hexadecimal FHT address`);
    }
    return normalized;
}

function temperature(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 5.5 || number > 30.5 || Math.round(number * 2) !== number * 2) {
        throw new Error('set/fht: temperature must be between 5.5 and 30.5 in 0.5 °C steps');
    }
    return Math.round(number * 2)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
}

function mode(value) {
    const normalized = String(value).trim().toUpperCase();
    if (normalized === 'AUTO') {
        return '00';
    }
    if (normalized === 'MANU' || normalized === 'MANUAL' || normalized === 'HEAT') {
        return '01';
    }
    throw new Error('set/fht: mode must be AUTO or MANU');
}

export function fhtCommand(device, command, value) {
    const spec = COMMANDS[String(command).trim().toLowerCase()];
    if (!spec) {
        throw new Error(`set/fht: unsupported command "${command}" (desired-temp, mode)`);
    }
    const encoded = spec.type === 'temperature' ? temperature(value) : mode(value);
    return `T${address(device)}${spec.code.toUpperCase()}${encoded}`;
}

/** Encode a validated raw FHT setting byte, for protocol settings not exposed as climate controls. */
export function fhtRawCommand(device, command, value) {
    const code = String(command).trim().toUpperCase();
    const byte = Number(value);
    if (!/^[0-9A-F]{2}$/.test(code) || !Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new Error('FHT command and value must each be one byte');
    }
    return `T${address(device)}${code}${byte.toString(16).padStart(2, '0').toUpperCase()}`;
}
