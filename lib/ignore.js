/**
 * --ignore / --only: RF devices cul2mqtt leaves alone — it neither publishes what it hears from them
 * nor sends to them. Meant for a gradual move from another central (FHEM): `--only` names what has
 * moved already (everything else is left alone), `--ignore` what has not.
 *
 * Entries are a protocol (`fht`) or a device as it appears in the status topic
 * (`fs20/6C4800`, `em/0205`), case-insensitive, separated by commas or whitespace.
 */

/** @returns {string[]} normalised entries (lower case, no surrounding slashes) */
export function parseIgnore(value, option = '--ignore') {
    if (value === undefined || value === null) {
        return [];
    }
    const list = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
    return list
        .map((entry) =>
            String(entry)
                .trim()
                .toLowerCase()
                .replace(/^\/+|\/+$/g, ''),
        )
        .filter(Boolean)
        .map((entry) => {
            if (!/^[a-z0-9]+(\/[a-z0-9]+)?$/.test(entry)) {
                throw new Error(`${option}: "${entry}" must be <protocol> or <protocol>/<address>`);
            }
            return entry;
        });
}

/** Whether the protocol, or the device `<protocol>/<address>`, is on the list. */
function listed(protocol, address, list) {
    const p = String(protocol).toLowerCase();
    if (list.includes(p)) {
        return true;
    }
    return address !== undefined && address !== null && list.includes(`${p}/${String(address).toLowerCase()}`);
}

/**
 * Whether the device `<protocol>/<address>` is left alone: not on a non-empty `only` list, or on
 * the `ignore` list (which wins).
 */
export function isIgnored(protocol, address, ignore = [], only = []) {
    if (!protocol) {
        return false;
    }
    if (only.length > 0 && !listed(protocol, address, only)) {
        return true;
    }
    return listed(protocol, address, ignore);
}

/**
 * Whether a `set/<parts...>` request targets a device that is left alone. The device is the first
 * part after the protocol (`set/fs20/6C4800`, `set/fht/4D3F/desired-temp`) or the first two joined
 * (`set/fs20/6C48/00`, `set/uniroll/1234/0`), matching the address in the status topic.
 * `set/raw` is no device and is gated by --raw-set only.
 */
export function setIgnored(parts, ignore = [], only = []) {
    const [protocol, first, second] = parts.map((p) => String(p));
    if (protocol.toLowerCase() === 'raw') {
        return false;
    }
    const candidates = [first, second === undefined ? undefined : first + second].filter((c) => c !== undefined);
    if (candidates.length === 0) {
        candidates.push(undefined);
    }
    if (only.length > 0 && !candidates.some((address) => listed(protocol, address, only))) {
        return true;
    }
    return candidates.some((address) => listed(protocol, address, ignore));
}
