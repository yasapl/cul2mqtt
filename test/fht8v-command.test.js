import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {
    defaultFht8wAddress,
    fht8vPairCommand,
    fht8vPositionCommand,
    isFht8vAddressForCentral,
} from '../lib/fht8v-command.js';

describe('FHT8V commands', () => {
    test('encodes FHEM valve-position commands', () => {
        assert.equal(fht8vPositionCommand('4341', 20), 'T4341002633');
        assert.equal(fht8vPositionCommand('4341', 50), 'T434100267F');
        assert.equal(fht8vPositionCommand('4341', 100), 'T43410026FE');
        assert.equal(fht8vPositionCommand('4341', 0), 'T4341002600');
        assert.throws(() => fht8vPositionCommand('4341', 20.5), /integer from 0 to 100/);
        assert.throws(() => fht8vPositionCommand('4341', 101), /integer from 0 to 100/);
    });

    test('encodes the one-time FHEM pairing command', () => {
        assert.equal(fht8vPairCommand('4341'), 'T4341002F00');
    });

    test('validates FHT8V address compatibility and chooses the next high byte', () => {
        assert.equal(isFht8vAddressForCentral('4341', '4241'), true);
        assert.equal(isFht8vAddressForCentral('4941', '4241'), true);
        assert.equal(isFht8vAddressForCentral('4A41', '4241'), false);
        assert.equal(isFht8vAddressForCentral('4342', '4241'), false);
        assert.equal(defaultFht8wAddress('4241'), '4341');
    });
});
