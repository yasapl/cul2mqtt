/**
 * Time-based position for covers that do not report back (UNIRoll, FS20 RSU), like FHEM's ROLLO
 * module with rl_type HomeKit: 100 = open, 0 = closed. The position is what the run times say: a
 * move to an intermediate position sends open/close and a stop after the share of the full run
 * time; a move to an end position sends only open/close and lets the end stop end it. From an
 * unknown position the cover first runs fully open (or straight closed, if that is the target). Operation at the cover itself is not seen.
 */

export const OPEN = 100;
export const CLOSED = 0;

/**
 * Run times of a cover definition: seconds for a full run open and closed, the pause before
 * reversing a running cover (FHEM rl_switchTime) and the end position a calibration runs to.
 *
 * @returns {{secondsOpen: number, secondsClose: number, switchMs: number, calibrateTo: number}|null}
 *   null = no position
 */
export function normaliseTiming(device) {
    if (device?.seconds_open === undefined && device?.seconds_close === undefined) {
        return null;
    }
    const secondsOpen = Number(device.seconds_open);
    const secondsClose = Number(device.seconds_close);
    const switchTime = Number(device.switch_time ?? 0);
    if (!(secondsOpen > 0) || !(secondsClose > 0)) {
        throw new Error('seconds_open and seconds_close must both be positive numbers of seconds');
    }
    if (!(switchTime >= 0)) {
        throw new Error('switch_time must be a non-negative number of seconds');
    }
    const calibrate = String(device.calibrate ?? 'open').toLowerCase();
    if (!['open', 'close'].includes(calibrate)) {
        throw new Error('calibrate must be open or close');
    }
    return {secondsOpen, secondsClose, switchMs: switchTime * 1000, calibrateTo: calibrate === 'open' ? OPEN : CLOSED};
}

/** @returns {number|null} position 0..100, rounded; null for anything else */
export function normalisePosition(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
        return null;
    }
    const position = Number(value);
    if (!Number.isFinite(position)) {
        return null;
    }
    return Math.min(OPEN, Math.max(CLOSED, Math.round(position)));
}

/**
 * The runs from `current` to `target`.
 *
 * @param {number|null} current known position, null = unknown
 * @param {number} target 0..100
 * @param {{secondsOpen: number, secondsClose: number}} timing
 * @returns {Array<{dir: 'open'|'close', from: number, to: number, ms: number, stop: boolean}>}
 *   stop: send a stop after ms; otherwise the run ends at the end stop and ms only tracks it
 */
export function planMove(current, target, timing) {
    if (current === null) {
        if (target === CLOSED) {
            return [{dir: 'close', from: OPEN, to: CLOSED, ms: timing.secondsClose * 1000, stop: false}];
        }
        const open = {dir: 'open', from: CLOSED, to: OPEN, ms: timing.secondsOpen * 1000, stop: false};
        return target === OPEN ? [open] : [open, ...planMove(OPEN, target, timing)];
    }
    if (current === target) {
        return [];
    }
    const dir = target > current ? 'open' : 'close';
    const seconds = dir === 'open' ? timing.secondsOpen : timing.secondsClose;
    const ms = Math.round((Math.abs(target - current) / 100) * seconds * 1000);
    return [{dir, from: current, to: target, ms, stop: target !== OPEN && target !== CLOSED}];
}

/** Position of a run `elapsed` ms after it started. */
export function positionAt(run, elapsed) {
    if (run.ms <= 0 || elapsed >= run.ms) {
        return run.to;
    }
    const share = Math.max(0, elapsed) / run.ms;
    return Math.round(run.from + (run.to - run.from) * share);
}

/** Home Assistant cover state of a cover at rest at `position`. */
export function restingState(position) {
    if (position === CLOSED) {
        return 'closed';
    }
    return position === OPEN ? 'open' : 'stopped';
}

/**
 * One cover with a time-based position.
 *
 * send(action, run): action 'open' | 'close' | 'stop'; for 'stop', `run` is the run being stopped
 * (FS20 stops by repeating its direction command). publish({position, state}) reports changes.
 */
export class TimedCover {
    constructor({
        timing,
        position = null,
        send,
        publish,
        now = Date.now,
        setTimer = setTimeout,
        clearTimer = clearTimeout,
    }) {
        this.timing = timing;
        this.position = normalisePosition(position);
        this.send = send;
        this.publish = publish;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.run = null; // {dir, from, to, ms, stop, startedAt}
        this.wait = null; // {timer, resolve}
        this.generation = 0;
    }

    /** Current position, interpolated while running; null = unknown. */
    current() {
        return this.run ? positionAt(this.run, this.now() - this.run.startedAt) : this.position;
    }

    get moving() {
        return this.run !== null;
    }

    /** Ends the tracked run without sending anything; returns that run. */
    interrupt() {
        const run = this.run;
        if (run) {
            this.position = this.current();
            this.run = null;
        }
        if (this.wait) {
            this.clearTimer(this.wait.timer);
            this.wait.resolve(false);
            this.wait = null;
        }
        return run;
    }

    sleep(ms) {
        return new Promise((resolve) => {
            const wait = {resolve};
            wait.timer = this.setTimer(() => {
                if (this.wait === wait) {
                    this.wait = null;
                }
                resolve(true);
            }, ms);
            this.wait = wait;
        });
    }

    async stop() {
        this.generation++;
        const run = this.interrupt();
        await this.send('stop', run);
        if (run) {
            this.publish({position: this.position, state: restingState(this.position)});
        }
    }

    /** Runs to the calibration end position for the full run time, whatever the assumed position. */
    calibrate() {
        return this.moveTo(this.timing.calibrateTo ?? OPEN, {fromUnknown: true});
    }

    /** Sets the position without moving anything, e.g. after the cover was moved at the device. */
    sync(position) {
        this.generation++;
        this.interrupt();
        this.position = normalisePosition(position);
        this.publish({position: this.position, state: this.position === null ? null : restingState(this.position)});
    }

    /**
     * @param {number} target 0..100
     * @param {{fromUnknown?: boolean}} [options] fromUnknown: ignore the assumed position
     */
    async moveTo(target, {fromUnknown = false} = {}) {
        const generation = ++this.generation;
        const running = this.interrupt();
        if (fromUnknown) {
            this.position = null;
        }
        const runs = planMove(this.position, target, this.timing);
        // keep a run going in the same direction: repeating the command would stop an FS20 actuator
        const keep = running && runs.length > 0 && runs[0].dir === running.dir;
        if (running && !keep) {
            await this.send('stop', running);
            this.publish({position: this.position, state: restingState(this.position)});
            if (runs.length > 0 && this.timing.switchMs > 0 && !(await this.sleep(this.timing.switchMs))) {
                return;
            }
        }
        for (const [index, run] of runs.entries()) {
            if (generation !== this.generation) {
                return;
            }
            if (!(keep && index === 0)) {
                await this.send(run.dir, null);
                if (generation !== this.generation) {
                    return;
                }
            }
            this.run = {...run, startedAt: this.now()};
            this.publish({position: this.position, state: run.dir === 'open' ? 'opening' : 'closing'});
            if (!(await this.sleep(run.ms))) {
                return;
            }
            this.run = null;
            this.position = run.to;
            if (run.stop) {
                await this.send('stop', run);
                if (generation !== this.generation) {
                    return;
                }
            }
            this.publish({position: this.position, state: restingState(this.position)});
        }
    }
}
