import {fht8vPositionCommand} from './fht8v-command.js';

export const FHT8W_REPEAT_MS = 120_000;
export const FHT8W_REQUEST_MS = 130_000;

/** Keep a virtual valve report alive, with a renewable timed position override. */
export class Fht8wReporter {
    constructor({
        address,
        write,
        onTransmit,
        onError,
        repeatMs = FHT8W_REPEAT_MS,
        requestMs = FHT8W_REQUEST_MS,
        now = Date.now,
        setTimer = setTimeout,
        clearTimer = clearTimeout,
    }) {
        this.address = address;
        this.write = write;
        this.onTransmit = onTransmit;
        this.onError = onError;
        this.repeatMs = repeatMs;
        this.requestMs = requestMs;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.requestedPosition = 20;
        this.requestExpiresAt = 0;
        this.timer = null;
        this.running = false;
        this.sending = false;
    }

    setPosition(position) {
        if (!Number.isInteger(position) || position < 0 || position > 100) {
            throw new Error('FHT8W valve position must be an integer from 0 to 100');
        }
        this.requestedPosition = position;
    }

    requestHeat(now = this.now()) {
        this.requestExpiresAt = now + this.requestMs;
        return this.requestExpiresAt;
    }

    currentPosition(now = this.now()) {
        return now < this.requestExpiresAt ? this.requestedPosition : 0;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.schedule(0);
    }

    stop() {
        this.running = false;
        if (this.timer) this.clearTimer(this.timer);
        this.timer = null;
    }

    schedule(delay) {
        if (!this.running || this.timer) return;
        this.timer = this.setTimer(() => {
            this.timer = null;
            void this.transmit();
        }, delay);
    }

    async transmit() {
        if (!this.running) return;
        if (this.sending) {
            this.schedule(this.repeatMs);
            return;
        }
        this.sending = true;
        const position = this.currentPosition();
        const data = fht8vPositionCommand(this.address, position);
        try {
            await this.write(data);
            this.onTransmit?.(position, data);
        } catch (err) {
            this.onError?.(err);
        } finally {
            this.sending = false;
            this.schedule(this.repeatMs);
        }
    }
}
