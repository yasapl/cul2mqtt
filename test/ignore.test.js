import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {isIgnored, parseIgnore, setIgnored} from '../lib/ignore.js';

describe('parseIgnore', () => {
    test('splits on commas and whitespace, lower case, trims slashes', () => {
        assert.deepEqual(parseIgnore('FHT, fs20/6C4800  /hms/A5E3/'), ['fht', 'fs20/6c4800', 'hms/a5e3']);
    });

    test('empty and missing values ignore nothing', () => {
        assert.deepEqual(parseIgnore(undefined), []);
        assert.deepEqual(parseIgnore(''), []);
        assert.deepEqual(parseIgnore(' , '), []);
    });

    test('rejects entries that are neither a protocol nor a device', () => {
        assert.throws(() => parseIgnore('fs20/6C48/00'), /--ignore/);
        assert.throws(() => parseIgnore('fs20/*'), /--ignore/);
    });
});

describe('isIgnored', () => {
    const ignore = parseIgnore('fht,fs20/6C4800');

    test('a whole protocol', () => {
        assert.equal(isIgnored('FHT', '4D3F', ignore), true);
        assert.equal(isIgnored('fht', undefined, ignore), true);
    });

    test('a single device, case-insensitive', () => {
        assert.equal(isIgnored('FS20', '6c4800', ignore), true);
        assert.equal(isIgnored('FS20', '6C4801', ignore), false);
        assert.equal(isIgnored('WS', '1', ignore), false);
    });

    test('an empty list ignores nothing', () => {
        assert.equal(isIgnored('fht', '4D3F', []), false);
    });
});

describe('setIgnored', () => {
    const ignore = parseIgnore('fht,fs20/6C4800,uniroll/12340');

    test('matches the device in its one- and two-part topic forms', () => {
        assert.equal(setIgnored(['fs20', '6C4800'], ignore), true);
        assert.equal(setIgnored(['fs20', '6C48', '00'], ignore), true);
        assert.equal(setIgnored(['fs20', '6C4800', 'on-for-timer', '1'], ignore), true);
        assert.equal(setIgnored(['uniroll', '1234', '0'], ignore), true);
        assert.equal(setIgnored(['fht', '4D3F', 'desired-temp'], ignore), true);
    });

    test('lets other devices through', () => {
        assert.equal(setIgnored(['fs20', '6C4801'], ignore), false);
        assert.equal(setIgnored(['uniroll', '1234', '1'], ignore), false);
        assert.equal(setIgnored(['raw'], ignore), false);
    });
});

describe('--only', () => {
    const only = parseIgnore('em/0205, uniroll', '--only');

    test('names the option in errors', () => {
        assert.throws(() => parseIgnore('em/*', '--only'), /--only/);
    });

    test('leaves everything alone that is not listed', () => {
        assert.equal(isIgnored('EM', '0205', [], only), false);
        assert.equal(isIgnored('EM', '0206', [], only), true);
        assert.equal(isIgnored('UNIRoll', '12340', [], only), false);
        assert.equal(isIgnored('FS20', '6C4800', [], only), true);
        assert.equal(isIgnored('TX', '1', [], only), true);
    });

    test('--ignore wins over --only', () => {
        assert.equal(isIgnored('UNIRoll', '12340', parseIgnore('uniroll/12340'), only), true);
        assert.equal(isIgnored('UNIRoll', '12341', parseIgnore('uniroll/12340'), only), false);
    });

    test('set requests follow the same rules', () => {
        assert.equal(setIgnored(['uniroll', '1234', '0'], [], only), false);
        assert.equal(setIgnored(['uniroll', '12340'], [], only), false);
        assert.equal(setIgnored(['fs20', '6C4800'], [], only), true);
        assert.equal(setIgnored(['fs20', '6C4800', 'on-for-timer', '1'], parseIgnore('fs20/6C4800'), []), true);
        assert.equal(setIgnored(['uniroll', '1234', '0'], parseIgnore('uniroll/12340'), only), true);
    });

    test('set/raw is not a device and stays gated by --raw-set alone', () => {
        assert.equal(setIgnored(['raw'], [], only), false);
    });
});
