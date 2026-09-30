import {seconds2time, time2seconds} from 'cul/lib/fs20.js';

/** FS20 extended timers are encoded in quarter-second units, with coarser steps as duration grows. */
export function fs20TimerDuration(seconds) {
    return time2seconds(seconds2time(Number(seconds)));
}

export function isValidFs20TimerDuration(seconds) {
    const value = Number(seconds);
    return Number.isFinite(value) && value >= 0 && value <= 15_360 && Math.round(value * 4) === value * 4;
}
