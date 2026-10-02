import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMessage} from 'cul';

import {
    CUL_DIAGNOSTICS,
    ccconfRegisters,
    formatCcconf,
    formatDiagnosticResult,
    formatUptime,
    parseCcconfRegister,
} from '../lib/diagnostics.js';

test('diagnostic queries are fixed read-only CUL commands', () => {
    assert.deepEqual(
        Object.fromEntries(Object.entries(CUL_DIAGNOSTICS).map(([name, value]) => [name, value.command])),
        {version: 'V', uptime: 't', fhtbuf: 'T03', cmds: '?', credit10ms: 'X'},
    );
});

test('decodes the common CUL diagnostic replies', () => {
    assert.equal(formatDiagnosticResult('version', 'V 1.67 CUL868'), 'V 1.67 CUL868');
    assert.equal(formatUptime('0000007D'), '0 00:00:01');
    assert.equal(formatDiagnosticResult('uptime', '0000007D'), '0 00:00:01');
    assert.equal(formatDiagnosticResult('fhtbuf', '74'), '116 bytes free (0x74)');
    assert.equal(formatDiagnosticResult('cmds', 'CUL Use one of V ? T03'), 'V ? T03');
    assert.equal(formatDiagnosticResult('credit10ms', 'X 42'), '42');
});

test('accepts a short T03 hex reply even if the RF parser classifies its first nibble', () => {
    const reply = 'F0';
    assert.equal(parseMessage(reply).protocol, 'FS20');
    assert.equal(CUL_DIAGNOSTICS.fhtbuf.match(reply), true);
    assert.equal(CUL_DIAGNOSTICS.fhtbuf.allowParsedReply, true);
    assert.equal(CUL_DIAGNOSTICS.fhtbuf.match('F000'), false);
});

test('reads the six CC1101 registers and formats a CUL style summary', () => {
    assert.deepEqual(ccconfRegisters(), ['0D', '0E', '0F', '10', '1B', '1D']);
    assert.deepEqual(parseCcconfRegister('C0D = 21'), {register: '0D', value: 0x21});
    assert.equal(parseCcconfRegister('V 1.67 CUL868'), null);
    assert.equal(
        formatCcconf({'0D': 0x21, '0E': 0x65, '0F': 0x6a, 10: 0x2e, '1B': 0x07, '1D': 0x03}),
        'freq:868.300MHz bWidth:541KHz rAmpl:42dB sens:16dB',
    );
    assert.throws(() => formatCcconf({}), /incomplete CC1101/);
});
