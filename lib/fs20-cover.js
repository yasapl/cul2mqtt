/*
 * FS20 shutter / awning actuators (FS20 RSU, ...) as Home Assistant covers. They have one command per
 * direction; repeating the command of a running movement stops it. So cul2mqtt remembers the last
 * movement: stop resends it, and open/close in the direction already running are not resent.
 */

import {FS20_COMMANDS} from './commands.js';
import {normaliseTiming} from './cover-position.js';

/** Home Assistant cover device classes. */
export const COVER_DEVICE_CLASSES = [
    'awning',
    'blind',
    'curtain',
    'damper',
    'door',
    'garage',
    'gate',
    'shade',
    'shutter',
    'window',
];

/**
 * Cover options of an --fs20-devices entry with type cover: FS20 command per direction (RSU: on = up),
 * HA device class, the run time in seconds after which a movement counts as finished (0 = unknown) and
 * optionally the run times for a time-based position (seconds_open / seconds_close, see cover-position.js).
 *
 * @returns {{open: string, close: string, deviceClass: string, runTime: number, timing: object|null, timingError?: string}}
 */
export function normaliseCover(device) {
    const cover = {
        open: String(device?.open || 'on').toLowerCase(),
        close: String(device?.close || 'off').toLowerCase(),
        deviceClass: String(device?.device_class || 'shutter').toLowerCase(),
        runTime: Number(device?.run_time) || 0,
        timing: null,
    };
    try {
        cover.timing = normaliseTiming(device);
    } catch (err) {
        cover.timingError = err.message;
    }
    return cover;
}

/** @returns {string|undefined} why the cover options are invalid */
export function coverError(cover) {
    if (!FS20_COMMANDS.includes(cover.open) || !FS20_COMMANDS.includes(cover.close)) {
        return 'open and close must be FS20 commands (e.g. on, off)';
    }
    if (cover.open === cover.close) {
        return 'open and close must be different FS20 commands';
    }
    if (!COVER_DEVICE_CLASSES.includes(cover.deviceClass)) {
        return `device_class must be one of ${COVER_DEVICE_CLASSES.join(', ')}`;
    }
    if (cover.runTime < 0) {
        return 'run_time must be a positive number of seconds';
    }
    if (cover.timingError) {
        return cover.timingError;
    }
}

function moving(motion, now) {
    return Boolean(motion) && motion.until > now;
}

/**
 * The FS20 command for a Home Assistant cover action.
 *
 * @param {{open: string, close: string}} cover
 * @param {'open'|'close'|'stop'} action
 * @param {{cmd: string, until: number}|null} motion last movement, see trackCoverCommand()
 * @param {number} now ms
 * @returns {{cmd: string|null, reason?: string}} cmd null = send nothing
 */
export function coverAction(cover, action, motion, now = Date.now()) {
    const running = moving(motion, now);
    if (action === 'stop') {
        return running ? {cmd: motion.cmd} : {cmd: null, reason: 'not moving'};
    }
    const cmd = cover[action];
    if (running && motion.cmd === cmd) {
        // repeating it would stop the actuator
        return {cmd: null, reason: `already moving (${action})`};
    }
    return {cmd};
}

/**
 * The movement after an FS20 command was sent to the cover: the same command again stops it, a
 * direction command starts a movement, anything else leaves the position unknown.
 *
 * @returns {{cmd: string, until: number}|null}
 */
export function trackCoverCommand(cover, cmd, motion, now = Date.now()) {
    const normalized = String(cmd).toLowerCase();
    if (normalized !== cover.open && normalized !== cover.close) {
        return null;
    }
    if (moving(motion, now) && motion.cmd === normalized) {
        return null;
    }
    return {cmd: normalized, until: cover.runTime > 0 ? now + cover.runTime * 1000 : Infinity};
}
