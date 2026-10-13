import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceCounter, EmCounters, parseEmBasis, WRAP} from '../lib/em-counter.js';

test('EM counter keeps the basis while the total grows', () => {
    assert.deepEqual(advanceCounter(undefined, 100), {basis: 0, last: 100});
    assert.deepEqual(advanceCounter({basis: 5, last: 100}, 100), {basis: 5, last: 100});
    assert.deepEqual(advanceCounter({basis: 5, last: 100}, 120), {basis: 5, last: 120});
});

test('EM counter adds 65536 on a wraparound', () => {
    assert.deepEqual(advanceCounter({basis: 0, last: 65530}, 4), {basis: WRAP, last: 4});
});

test('EM counter adds the previous total on a reset', () => {
    assert.deepEqual(advanceCounter({basis: 1000, last: 30000}, 2), {basis: 31000, last: 2});
});

test('EmCounters starts at the seed and only grows', () => {
    const counters = new EmCounters(parseEmBasis('{"0205": 1000000}'));
    assert.deepEqual(counters.update('0205', 20000), {cumulative: 1020000, changed: true, corrected: false});
    assert.deepEqual(counters.update('0205', 20000), {cumulative: 1020000, changed: false, corrected: false});
    assert.deepEqual(counters.update('0205', 65535), {cumulative: 1065535, changed: true, corrected: false});
    assert.deepEqual(counters.update('0205', 3), {cumulative: 1065539, changed: true, corrected: true});
    assert.deepEqual(counters.update('0101', 10), {cumulative: 10, changed: true, corrected: false});
});

test('EmCounters saved state wins over the seed and survives a restart', () => {
    const before = new EmCounters();
    before.update('0205', 60000);
    before.update('0205', 100);
    const after = new EmCounters(parseEmBasis('{"0205": 1}'));
    after.load(JSON.parse(JSON.stringify(before.state())));
    assert.deepEqual(after.update('0205', 50), {cumulative: 60150, changed: true, corrected: true});
});

test('EmCounters drops invalid saved entries', () => {
    const counters = new EmCounters();
    counters.load({'0207': {basis: -1, last: 5}, '0205': {basis: 1, last: WRAP}, '0101': {basis: 2, last: 3}});
    assert.deepEqual(counters.state(), {'0101': {basis: 2, last: 3}});
});

test('parseEmBasis accepts an empty value and rejects garbage', () => {
    assert.equal(parseEmBasis(undefined).size, 0);
    assert.equal(parseEmBasis('').size, 0);
    assert.deepEqual([...parseEmBasis('{"03ab": 0}')], [['03AB', 0]]);
    assert.throws(() => parseEmBasis('{'), /invalid --em-basis JSON/);
    assert.throws(() => parseEmBasis('[1]'), /must be a JSON object/);
    assert.throws(() => parseEmBasis('{"309": 1}'), /4-digit/);
    assert.throws(() => parseEmBasis('{"0205": 1.5}'), /non-negative integer/);
});
