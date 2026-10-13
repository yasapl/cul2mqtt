import assert from 'node:assert/strict';
import test, {describe} from 'node:test';
import {
    normalisePosition,
    normaliseTiming,
    planMove,
    positionAt,
    restingState,
    TimedCover,
} from '../lib/cover-position.js';

const timing = {secondsOpen: 25, secondsClose: 16, switchMs: 0};

describe('normaliseTiming', () => {
    test('no run times = no position support', () => {
        assert.equal(normaliseTiming({name: 'x'}), null);
    });

    test('run times and switch time in seconds', () => {
        assert.deepEqual(normaliseTiming({seconds_open: 25, seconds_close: '16', switch_time: 1}), {
            secondsOpen: 25,
            secondsClose: 16,
            switchMs: 1000,
            calibrateTo: 100,
        });
        assert.equal(normaliseTiming({seconds_open: 1, seconds_close: 1, calibrate: 'close'}).calibrateTo, 0);
        assert.throws(() => normaliseTiming({seconds_open: 1, seconds_close: 1, calibrate: 'up'}), /calibrate/);
    });

    test('both run times are required', () => {
        assert.throws(() => normaliseTiming({seconds_open: 25}), /seconds_open and seconds_close/);
        assert.throws(() => normaliseTiming({seconds_open: 25, seconds_close: 0}), /seconds_open and seconds_close/);
        assert.throws(() => normaliseTiming({seconds_open: 1, seconds_close: 1, switch_time: -1}), /switch_time/);
    });
});

test('normalisePosition clamps and rounds, null for garbage', () => {
    assert.equal(normalisePosition(40.4), 40);
    assert.equal(normalisePosition('120'), 100);
    assert.equal(normalisePosition(-3), 0);
    assert.equal(normalisePosition(null), null);
    assert.equal(normalisePosition('x'), null);
    assert.equal(normalisePosition(true), null);
});

describe('planMove', () => {
    test('intermediate positions stop after the share of the run time', () => {
        assert.deepEqual(planMove(100, 40, timing), [{dir: 'close', from: 100, to: 40, ms: 9600, stop: true}]);
        assert.deepEqual(planMove(40, 91, timing), [{dir: 'open', from: 40, to: 91, ms: 12750, stop: true}]);
    });

    test('end positions are left to the end stop', () => {
        assert.deepEqual(planMove(40, 100, timing), [{dir: 'open', from: 40, to: 100, ms: 15000, stop: false}]);
        assert.deepEqual(planMove(40, 0, timing), [{dir: 'close', from: 40, to: 0, ms: 6400, stop: false}]);
    });

    test('nothing to do at the target', () => {
        assert.deepEqual(planMove(40, 40, timing), []);
    });

    test('from an unknown position it first opens fully', () => {
        assert.deepEqual(planMove(null, 100, timing), [{dir: 'open', from: 0, to: 100, ms: 25000, stop: false}]);
        assert.deepEqual(planMove(null, 0, timing), [{dir: 'close', from: 100, to: 0, ms: 16000, stop: false}]);
        assert.deepEqual(planMove(null, 21, timing), [
            {dir: 'open', from: 0, to: 100, ms: 25000, stop: false},
            {dir: 'close', from: 100, to: 21, ms: 12640, stop: true},
        ]);
    });
});

test('positionAt interpolates a run', () => {
    const run = {dir: 'close', from: 100, to: 40, ms: 6000};
    assert.equal(positionAt(run, 0), 100);
    assert.equal(positionAt(run, 3000), 70);
    assert.equal(positionAt(run, 9000), 40);
});

test('restingState', () => {
    assert.equal(restingState(0), 'closed');
    assert.equal(restingState(100), 'open');
    assert.equal(restingState(40), 'stopped');
});

/** A TimedCover on a fake clock; tick(ms) fires due timers. */
function harness(position, overrides = {}) {
    let clock = 0;
    let timers = [];
    const sent = [];
    const published = [];
    const cover = new TimedCover({
        timing: {...timing, ...overrides},
        position,
        send: async (action, run) => {
            sent.push(run && action === 'stop' ? `stop(${run.dir})` : action);
        },
        publish: (state) => published.push(state),
        now: () => clock,
        setTimer: (fn, ms) => {
            const timer = {at: clock + ms, fn};
            timers.push(timer);
            return timer;
        },
        clearTimer: (timer) => {
            timers = timers.filter((t) => t !== timer);
        },
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    async function tick(ms) {
        const until = clock + ms;
        await settle();
        for (;;) {
            const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
            if (!due) {
                break;
            }
            timers = timers.filter((t) => t !== due);
            clock = due.at;
            due.fn();
            await settle();
        }
        clock = until;
    }
    return {cover, sent, published, tick};
}

describe('TimedCover', () => {
    test('moves to an intermediate position and stops', async () => {
        const {cover, sent, published, tick} = harness(100);
        const done = cover.moveTo(40);
        await tick(9600);
        await done;
        assert.deepEqual(sent, ['close', 'stop(close)']);
        assert.deepEqual(published, [
            {position: 100, state: 'closing'},
            {position: 40, state: 'stopped'},
        ]);
        assert.equal(cover.current(), 40);
    });

    test('a stop while running keeps the interpolated position', async () => {
        const {cover, sent, published, tick} = harness(100);
        void cover.moveTo(0);
        await tick(8000);
        assert.equal(cover.current(), 50);
        await cover.stop();
        assert.deepEqual(sent, ['close', 'stop(close)']);
        assert.deepEqual(published.at(-1), {position: 50, state: 'stopped'});
        assert.equal(cover.moving, false);
    });

    test('a new target in the same direction does not resend the command', async () => {
        const {cover, sent, tick} = harness(100);
        void cover.moveTo(0);
        await tick(4000); // at 75
        const done = cover.moveTo(40);
        await tick(5600); // 35 % of 16 s
        await done;
        assert.deepEqual(sent, ['close', 'stop(close)']);
        assert.equal(cover.current(), 40);
    });

    test('reversing stops first and waits the switch time', async () => {
        const {cover, sent, published, tick} = harness(100, {switchMs: 1000});
        void cover.moveTo(0);
        await tick(8000); // at 50
        const done = cover.moveTo(100);
        await tick(1000 + 12500);
        await done;
        assert.deepEqual(sent, ['close', 'stop(close)', 'open']);
        assert.deepEqual(published.at(-1), {position: 100, state: 'open'});
    });

    test('from an unknown position it opens first', async () => {
        const {cover, sent, tick} = harness(null);
        const done = cover.moveTo(21);
        await tick(25000 + 12640);
        await done;
        assert.deepEqual(sent, ['open', 'close', 'stop(close)']);
        assert.equal(cover.current(), 21);
    });

    test('calibrate runs fully open for the full run time from any assumed position', async () => {
        const {cover, sent, published, tick} = harness(90);
        const done = cover.calibrate();
        await tick(24000);
        assert.equal(cover.moving, true);
        await tick(1000);
        await done;
        assert.deepEqual(sent, ['open']);
        assert.deepEqual(published.at(-1), {position: 100, state: 'open'});
    });

    test('calibrate can run fully closed instead', async () => {
        const {cover, sent, published, tick} = harness(30, {calibrateTo: 0});
        const done = cover.calibrate();
        await tick(16000);
        await done;
        assert.deepEqual(sent, ['close']);
        assert.deepEqual(published.at(-1), {position: 0, state: 'closed'});
    });

    test('sync sets the position without sending anything', async () => {
        const {cover, sent, published} = harness(100);
        cover.sync(0);
        assert.deepEqual(sent, []);
        assert.deepEqual(published, [{position: 0, state: 'closed'}]);
        cover.sync('x');
        assert.equal(cover.current(), null);
    });

    test('a stop at rest is still sent, without a run', async () => {
        const {cover, sent, published} = harness(40);
        await cover.stop();
        assert.deepEqual(sent, ['stop']);
        assert.deepEqual(published, []);
    });
});
