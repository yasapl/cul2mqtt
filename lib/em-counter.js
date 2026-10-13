/**
 * EM1000 meters (power, gas, water) send their pulse total as a 16-bit counter that wraps at
 * 65536 and restarts at 0 when the battery is changed. Like FHEM's CUL_EM `basis` reading, we
 * keep a correction per meter so `<protocol>/<address>/cumulative` = basis + total only grows:
 *
 *   total drops and the previous total was above 65000  →  wraparound, basis += 65536
 *   total drops otherwise                               →  reset,      basis += previous total
 *
 * Unit conversion (pulses → m³, kWh) is left to the consumer.
 */

export const WRAP = 65536;
const WRAP_THRESHOLD = 65000; // as 15_CUL_EM.pm

/**
 * @param {{basis: number, last?: number}|undefined} state previous state of one meter
 * @param {number} total raw counter from the message
 * @returns {{basis: number, last: number}} new state; cumulative = basis + last
 */
export function advanceCounter(state, total) {
    let basis = state?.basis ?? 0;
    const last = state?.last;
    if (typeof last === 'number' && total < last) {
        basis += last > WRAP_THRESHOLD ? WRAP : last;
    }
    return {basis, last: total};
}

function validBasis(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

/**
 * --em-basis: JSON object address → initial basis in pulses, e.g. {"0205": 123456}, to continue
 * a meter reading taken over from another system. Used only for meters without saved state.
 *
 * @param {string|undefined} value
 * @returns {Map<string, number>} upper-case address → basis
 */
export function parseEmBasis(value) {
    const seeds = new Map();
    if (value === undefined || value === null || String(value).trim() === '') {
        return seeds;
    }
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch (err) {
        throw new Error(`invalid --em-basis JSON: ${err.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('--em-basis must be a JSON object of address → pulses');
    }
    for (const [address, basis] of Object.entries(parsed)) {
        if (!/^[0-9A-F]{4}$/i.test(address) || !validBasis(basis)) {
            throw new Error(
                `--em-basis: expected a 4-digit hexadecimal address and a non-negative integer, got ${address}: ${basis}`,
            );
        }
        seeds.set(address.toUpperCase(), basis);
    }
    return seeds;
}

/** Cumulative counters of all EM meters, persisted as {address: {basis, last}}. */
export class EmCounters {
    /** @param {Map<string, number>} [seeds] from parseEmBasis */
    constructor(seeds = new Map()) {
        this.seeds = seeds;
        this.meters = new Map();
    }

    /** @param {object} saved state() of a previous run; invalid entries are dropped */
    load(saved) {
        for (const [address, state] of Object.entries(saved || {})) {
            if (validBasis(state?.basis) && validBasis(state?.last) && state.last < WRAP) {
                this.meters.set(address.toUpperCase(), {basis: state.basis, last: state.last});
            }
        }
    }

    state() {
        return Object.fromEntries(this.meters);
    }

    /**
     * @param {string} address
     * @param {number} total raw 16-bit counter
     * @returns {{cumulative: number, changed: boolean, corrected: boolean}} changed: state needs
     *   saving; corrected: a wraparound or reset was added to the basis
     */
    update(address, total) {
        const key = String(address).toUpperCase();
        const previous = this.meters.get(key) ?? {basis: this.seeds.get(key) ?? 0};
        const next = advanceCounter(previous, total);
        const changed = next.basis !== previous.basis || next.last !== previous.last;
        this.meters.set(key, next);
        return {cumulative: next.basis + next.last, changed, corrected: next.basis !== previous.basis};
    }
}
