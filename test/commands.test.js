import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {commandFor, dimCommand, unirollSequence} from '../lib/commands.js';

describe('commandFor fs20', () => {
    test('6 hex digit address, text / boolean / numeric commands', () => {
        assert.deepEqual(commandFor(['fs20', '6C4800'], 'on'), {
            type: 'fs20',
            housecode: '6C48',
            address: '00',
            cmd: 'on',
            time: undefined,
        });
        assert.equal(commandFor(['fs20', '6C4800'], false).cmd, 'off');
        assert.equal(commandFor(['fs20', '6C4800'], 'true').cmd, 'on');
        assert.equal(commandFor(['fs20', '6C4800'], 0).cmd, 'off');
        assert.equal(commandFor(['fs20', '6C4800'], 50).cmd, 'dim50%');
        assert.equal(commandFor(['fs20', '6C4800'], '100').cmd, 'dim100%');
        assert.equal(commandFor(['fs20', '6C4800'], 'TOGGLE').cmd, 'toggle');
        assert.equal(commandFor(['fs20', '6C4800'], '11').cmd, 'dim12%');
    });

    test('housecode/address split and ELV notation pass through', () => {
        const c = commandFor(['fs20', '2341 2131', '1112'], 'on');
        assert.equal(c.housecode, '2341 2131');
        assert.equal(c.address, '1112');
    });

    test('json with time', () => {
        assert.deepEqual(commandFor(['fs20', '6C4800'], {cmd: 'on-for-timer', time: 30}), {
            type: 'fs20',
            housecode: '6C48',
            address: '00',
            cmd: 'on-for-timer',
            time: 30,
        });
    });

    test('rejects garbage', () => {
        assert.throws(() => commandFor(['fs20'], 'on'), /address missing/);
        assert.throws(() => commandFor(['fs20', '6C48'], 'on'), /6 hex digits/);
        assert.throws(() => commandFor(['fs20', '6C4800'], 'explode'), /unknown command/);
    });
});

describe('commandFor fht / raw', () => {
    test('fht topic and json forms', () => {
        assert.deepEqual(commandFor(['fht', '4d3f', 'desired-temp'], 21.5), {
            type: 'fht',
            device: '4d3f',
            cmd: 'desired-temp',
            value: '21.5',
        });
        assert.deepEqual(commandFor(['fht', '4d3f'], {cmd: 'mode', value: 'AUTO'}), {
            type: 'fht',
            device: '4d3f',
            cmd: 'mode',
            value: 'AUTO',
        });
        assert.throws(() => commandFor(['fht', '4d3f'], 21), /command missing/);
    });

    test('raw only with --raw-set', () => {
        assert.throws(() => commandFor(['raw'], 'V'), /disabled/);
        assert.deepEqual(commandFor(['raw'], 'F6C480111', {rawSet: true}), {type: 'raw', data: 'F6C480111'});
        assert.throws(() => commandFor(['raw'], {a: 1}, {rawSet: true}), /command string/);
    });

    test('unknown protocol', () => {
        assert.throws(() => commandFor(['zigbee', '1'], 1), /unknown set item/);
    });
});

describe('dimCommand', () => {
    test('nearest step', () => {
        assert.equal(dimCommand(0), 'off');
        assert.equal(dimCommand(1), 'dim06%');
        assert.equal(dimCommand(33), 'dim31%');
        assert.equal(dimCommand(99), 'dim100%');
        assert.equal(dimCommand(250), 'dim100%');
    });
});

describe('commandFor uniroll', () => {
    test('group + device as one or two topic parts', () => {
        assert.deepEqual(commandFor(['uniroll', '1234a'], 'up'), {
            type: 'uniroll',
            group: '1234',
            device: 'A',
            cmd: 'up',
        });
        assert.deepEqual(commandFor(['uniroll', 'abcd', '0'], 'down'), {
            type: 'uniroll',
            group: 'ABCD',
            device: '0',
            cmd: 'down',
        });
    });

    test('Home Assistant cover payloads', () => {
        assert.equal(commandFor(['uniroll', '12340'], 'OPEN').cmd, 'up');
        assert.equal(commandFor(['uniroll', '12340'], 'CLOSE').cmd, 'down');
        assert.equal(commandFor(['uniroll', '12340'], 'STOP').cmd, 'stop');
    });

    test('rejects unknown commands instead of sending stop', () => {
        assert.throws(() => commandFor(['uniroll', '12340'], 'toggle'), /unknown command/);
    });

    test('a number is a target position', () => {
        assert.deepEqual(commandFor(['uniroll', '12340'], 40), {
            type: 'uniroll',
            group: '1234',
            device: '0',
            position: 40,
        });
        assert.equal(commandFor(['uniroll', '12340'], '91').position, 91);
        assert.throws(() => commandFor(['uniroll', '12340'], 150), /out of range/);
    });

    test('rejects malformed addresses', () => {
        assert.throws(() => commandFor(['uniroll', '1234'], 'up'), /address/);
        assert.throws(() => commandFor(['uniroll', '123', '40'], 'up'), /address/);
        assert.throws(() => commandFor(['uniroll', '12G40'], 'up'), /address/);
        assert.throws(() => commandFor(['uniroll', '1234', '10'], 'up'), /address/);
        assert.throws(() => commandFor(['uniroll'], 'up'), /address/);
    });
});

describe('unirollSequence', () => {
    test('stop first, like FHEM sendStopBeforeCmd 1', () => {
        assert.deepEqual(unirollSequence('up'), ['stop', 'up']);
        assert.deepEqual(unirollSequence('down', true), ['stop', 'down']);
    });

    test('stop alone is sent once', () => {
        assert.deepEqual(unirollSequence('stop', true), ['stop']);
    });

    test('sendStopBeforeCmd 0', () => {
        assert.deepEqual(unirollSequence('up', false), ['up']);
    });
});
