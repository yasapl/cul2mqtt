import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {fhtCommand} from '../lib/fht-command.js';

describe('fhtCommand', () => {
    test('encodes the raw hexadecimal FHT address and half-degree temperature', () => {
        assert.equal(fhtCommand('4d3f', 'desired-temp', 21.5), 'T4D3F412B');
        assert.equal(fhtCommand('4D3F', 'desired-temp', '5.5'), 'T4D3F410B');
    });

    test('encodes AUTO and MANU mode', () => {
        assert.equal(fhtCommand('4d3f', 'mode', 'AUTO'), 'T4D3F3E00');
        assert.equal(fhtCommand('4d3f', 'mode', 'MANU'), 'T4D3F3E01');
    });

    test('rejects unsafe or unsupported commands', () => {
        assert.throws(() => fhtCommand('123', 'mode', 'AUTO'), /4-digit hexadecimal/);
        assert.throws(() => fhtCommand('4d3f', 'desired-temp', 21.2), /0.5/);
        assert.throws(() => fhtCommand('4d3f', 'holiday1', 1), /unsupported/);
    });
});
