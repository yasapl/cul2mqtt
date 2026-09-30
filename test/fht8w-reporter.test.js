import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {Fht8wReporter, FHT8W_REPEAT_MS, FHT8W_REQUEST_MS} from '../lib/fht8w-reporter.js';

class FakeClock {
    constructor() {
        this.now = 0;
        this.nextId = 0;
        this.timers = new Map();
    }

    setTimeout = (callback, delay) => {
        const id = ++this.nextId;
        this.timers.set(id, {callback, at: this.now + delay});
        return id;
    };

    clearTimeout = (id) => this.timers.delete(id);

    async advance(ms) {
        const target = this.now + ms;
        while (true) {
            const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > target) break;
            this.now = next[1].at;
            this.timers.delete(next[0]);
            next[1].callback();
            await Promise.resolve();
            await Promise.resolve();
        }
        this.now = target;
    }
}

describe('FHT8W virtual valve reporter', () => {
    test('reports 0% at idle, renews the selected position, then returns to 0%', async () => {
        const clock = new FakeClock();
        const transmitted = [];
        const reporter = new Fht8wReporter({
            address: '4341',
            write: async (data) => transmitted.push(data),
            repeatMs: FHT8W_REPEAT_MS,
            requestMs: FHT8W_REQUEST_MS,
            now: () => clock.now,
            setTimer: clock.setTimeout,
            clearTimer: clock.clearTimeout,
        });

        reporter.start();
        await clock.advance(0);
        assert.deepEqual(transmitted, ['T4341002600']);

        reporter.setPosition(20);
        reporter.requestHeat();
        await clock.advance(FHT8W_REPEAT_MS);
        assert.equal(transmitted.at(-1), 'T4341002633');

        reporter.requestHeat();
        await clock.advance(FHT8W_REPEAT_MS);
        assert.equal(transmitted.at(-1), 'T4341002633');
        assert.equal(reporter.currentPosition(), 20);

        await clock.advance(FHT8W_REPEAT_MS);
        assert.equal(transmitted.at(-1), 'T4341002600');
        reporter.stop();
    });

    test('serializes writes and does not queue reports while a CUL write is pending', async () => {
        const clock = new FakeClock();
        let releaseWrite;
        let activeWrites = 0;
        let maxActiveWrites = 0;
        let count = 0;
        const reporter = new Fht8wReporter({
            address: '4341',
            write: () => {
                count += 1;
                activeWrites += 1;
                maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
                return new Promise((resolve) => {
                    releaseWrite = () => {
                        activeWrites -= 1;
                        resolve();
                    };
                });
            },
            now: () => clock.now,
            setTimer: clock.setTimeout,
            clearTimer: clock.clearTimeout,
        });

        reporter.start();
        await clock.advance(0);
        await clock.advance(FHT8W_REPEAT_MS * 3);
        assert.equal(count, 1);
        assert.equal(maxActiveWrites, 1);

        releaseWrite();
        await Promise.resolve();
        await Promise.resolve();
        reporter.stop();
        assert.equal(maxActiveWrites, 1);
    });
});
