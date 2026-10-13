import assert from 'node:assert/strict';
import test from 'node:test';
import {optimisticFs20State} from '../lib/fs20-state.js';

test('optimistic FS20 state follows on, off, and toggle commands', () => {
    assert.equal(optimisticFs20State('on'), true);
    assert.equal(optimisticFs20State('off', true), false);
    assert.equal(optimisticFs20State('reset', true), false);
    assert.equal(optimisticFs20State('on-for-timer'), true);
    assert.equal(optimisticFs20State('toggle', false), true);
    assert.equal(optimisticFs20State('toggle', true), false);
});
