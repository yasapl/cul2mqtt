/**
 * New devices are only published once they have been heard often enough: a single garbled
 * telegram (a phantom FHT80TF next to the stick, say) would otherwise become a device in Home
 * Assistant that never reports again. A device `<protocol>/<address>` counts as confirmed after
 * `count` transmissions within `windowMs`; confirmed devices are remembered (persisted by the caller).
 * Many devices repeat each transmission right away (an FHT80TF sends it twice within a second), so
 * telegrams less than REPEAT_MS apart count once.
 */

export const REPEAT_MS = 10_000;
export class DeviceConfirmation {
    /**
     * @param {{count?: number, windowMs?: number, confirmed?: Iterable<string>}} [options]
     *   count 1 confirms on the first telegram (check off)
     */
    constructor({count = 3, windowMs = 3600_000, confirmed = []} = {}) {
        this.count = count;
        this.windowMs = windowMs;
        this.confirmed = new Set();
        this.pending = new Map(); // device → timestamps (ms) within the window
        this.load(confirmed);
    }

    static key(protocol, address) {
        return `${String(protocol).toLowerCase()}/${String(address).toLowerCase()}`;
    }

    /** @param {Iterable<string>} devices `<protocol>/<address>` */
    load(devices) {
        for (const device of devices || []) {
            if (typeof device === 'string' && device.includes('/')) {
                this.confirmed.add(device.toLowerCase());
            }
        }
    }

    /** @returns {string[]} confirmed devices, sorted */
    state() {
        return [...this.confirmed].sort();
    }

    isConfirmed(device) {
        return this.count <= 1 || this.confirmed.has(device);
    }

    /**
     * Counts a telegram of `device`.
     *
     * @returns {{confirmed: boolean, newly: boolean, heard: number}} newly: confirmed by this
     *   telegram (save the state); heard: telegrams within the window so far
     */
    seen(device, now = Date.now()) {
        if (this.isConfirmed(device)) {
            return {confirmed: true, newly: false, heard: this.count};
        }
        const heard = (this.pending.get(device) || []).filter((ts) => now - ts < this.windowMs);
        if (heard.length === 0 || now - heard[heard.length - 1] >= REPEAT_MS) {
            heard.push(now);
        }
        if (heard.length >= this.count) {
            this.pending.delete(device);
            this.confirmed.add(device);
            return {confirmed: true, newly: true, heard: heard.length};
        }
        this.pending.set(device, heard);
        this.prune(now);
        return {confirmed: false, newly: false, heard: heard.length};
    }

    /** Forgets devices not heard within the window, so stray telegrams do not pile up. */
    prune(now) {
        for (const [device, heard] of this.pending) {
            if (now - heard[heard.length - 1] >= this.windowMs) {
                this.pending.delete(device);
            }
        }
    }
}
