import assert from 'node:assert/strict';
import test from 'node:test';
import {DeviceConfirmation} from '../lib/confirm.js';

const HOUR = 3600_000;

test('a device is confirmed after count telegrams within the window', () => {
    const c = new DeviceConfirmation({count: 2, windowMs: HOUR});
    assert.deepEqual(c.seen('fhttk/abc123', 0), {confirmed: false, newly: false, heard: 1});
    assert.deepEqual(c.seen('fhttk/abc123', 60_000), {confirmed: true, newly: true, heard: 2});
    assert.deepEqual(c.seen('fhttk/abc123', 120_000), {confirmed: true, newly: false, heard: 2});
    assert.deepEqual(c.state(), ['fhttk/abc123']);
});

test('repeats of one transmission count once', () => {
    const c = new DeviceConfirmation({count: 2, windowMs: HOUR});
    c.seen('fhttk/abc123', 0);
    assert.deepEqual(c.seen('fhttk/abc123', 500), {confirmed: false, newly: false, heard: 1});
    assert.equal(c.seen('fhttk/abc123', 10_000).confirmed, true);
});

test('telegrams older than the window do not count', () => {
    const c = new DeviceConfirmation({count: 2, windowMs: HOUR});
    c.seen('fhttk/abc123', 0);
    assert.equal(c.seen('fhttk/abc123', HOUR + 1).confirmed, false);
    assert.equal(c.seen('fhttk/abc123', HOUR + 20_000).confirmed, true);
});

test('a single stray telegram is forgotten after the window', () => {
    const c = new DeviceConfirmation({count: 2, windowMs: HOUR});
    c.seen('fhttk/abc123', 0);
    c.seen('ws/7', 2 * HOUR);
    assert.equal(c.pending.has('fhttk/abc123'), false);
    assert.equal(c.pending.has('ws/7'), true);
});

test('count 1 confirms on the first telegram', () => {
    const c = new DeviceConfirmation({count: 1});
    assert.equal(c.seen('em/0205', 0).confirmed, true);
});

test('known devices are confirmed from the start, case-insensitive', () => {
    const c = new DeviceConfirmation({count: 3, confirmed: ['FS20/6C4800', 'garbage']});
    assert.equal(c.isConfirmed(DeviceConfirmation.key('FS20', '6c4800')), true);
    assert.deepEqual(c.state(), ['fs20/6c4800']);
    c.load(JSON.parse(JSON.stringify(['em/0205'])));
    assert.equal(c.isConfirmed('em/0205'), true);
});
