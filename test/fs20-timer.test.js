import assert from 'node:assert/strict';
import test from 'node:test';
import {fs20TimerDuration, isValidFs20TimerDuration} from '../lib/fs20-timer.js';

test('FS20 timer duration returns the smallest encodable duration not shorter than requested', () => {
    assert.equal(fs20TimerDuration(0.25), 0.25);
    assert.equal(fs20TimerDuration(4.25), 4.5);
    assert.equal(fs20TimerDuration(15), 15);
    assert.equal(fs20TimerDuration(15.25), 16);
    assert.equal(fs20TimerDuration(15_360), 15_360);
});

test('FS20 timer values allow quarter-second steps within the protocol range', () => {
    assert.equal(isValidFs20TimerDuration(0), true);
    assert.equal(isValidFs20TimerDuration(0.25), true);
    assert.equal(isValidFs20TimerDuration(1.1), false);
    assert.equal(isValidFs20TimerDuration(15_360.25), false);
});
