#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Cul from 'cul';
import {createAdapter, createLogger, runDiscovery, autoAddress} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {fhtClockItems, fhtClockItemsFromValue, fhtMeasuredTemperature, itemsFor, mapItem} from './lib/items.js';
import {commandFor} from './lib/commands.js';
import {fhtCommand, fhtRawCommand} from './lib/fht-command.js';
import {
    defaultFht8wAddress,
    fht8vPairCommand,
    fht8vPositionCommand,
    isFht8vAddressForCentral,
} from './lib/fht8v-command.js';
import {optimisticFs20State} from './lib/fs20-state.js';
import {fs20TimerDuration, isValidFs20TimerDuration} from './lib/fs20-timer.js';
import {rawCommandText} from './lib/raw-command.js';
import {discoveryModel, normalizedDiscoveryIds} from './lib/hadiscovery.js';
import {OfflineTracker, timeoutsFromMap} from './lib/offline.js';
import {handle as handleInstall} from './lib/install.js';
import {discoveryHint} from './lib/discovery.js';

/*
 * finding the stick (core B-2): --discover lists the busware sticks udev named, --serialport auto
 * uses the one it found. Before the installer on purpose: `--install -s auto` persists the by-id
 * path rather than scanning on every service start. A CUNO on the network is --host instead.
 */
if (config.discover || config.serialport === 'auto') {
    const discoveryLog = createLogger({envPrefix: config.$envPrefix || 'CUL2MQTT', level: config.verbosity});
    const hint = discoveryHint();
    if (config.discover) {
        await runDiscovery({hint, config, log: discoveryLog}); // prints and exits
    }
    try {
        config.serialport = await autoAddress(hint, {config, log: discoveryLog});
    } catch (err) {
        // none, or two sticks: opening the wrong one talks to the wrong radio
        discoveryLog.error('--serialport auto:', err.message);
        process.exit(1);
    }
}

handleInstall(config);

const RECONNECT_MS = 10000;
const OFFLINE_CHECK_MS = 10000;
const STATE_SAVE_MS = 60000;

let map;
if (config.mapFile) {
    const file = path.resolve(config.mapFile);
    map = JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normaliseFs20Devices(value) {
    const list = value === null ? [] : Array.isArray(value) ? value : [value];
    return list.map((device) => ({
        name: String(device?.name || '').trim(),
        address: String(device?.address || '')
            .trim()
            .toUpperCase(),
        type: String(device?.type || 'switch').toLowerCase(),
        on_time: Number(device?.on_time) || 0,
    }));
}

function normaliseFht8vDevices(value) {
    const list = value === null ? [] : Array.isArray(value) ? value : [value];
    return list.map((device) => ({
        name: String(device?.name || '').trim(),
        address: String(device?.address || '')
            .trim()
            .toUpperCase(),
    }));
}

let fs20Devices;
try {
    fs20Devices = normaliseFs20Devices(JSON.parse(config.fs20Devices || '[]'));
} catch (err) {
    throw new Error(`invalid --fs20-devices JSON: ${err.message}`);
}
let fht8vDevices;
try {
    fht8vDevices = normaliseFht8vDevices(JSON.parse(config.fht8vDevices || '[]'));
} catch (err) {
    throw new Error(`invalid --fht8v-devices JSON: ${err.message}`);
}
const fht8vDeviceByAddress = new Map();
const fht8vPositions = new Map();
const fht8vStateFile = config.stateDir ? path.join(config.stateDir, 'fht8v-positions.json') : null;
const fht8wStateFile = config.stateDir ? path.join(config.stateDir, 'fht8w-position.json') : null;
let fht8wAddress = '';
let fht8wPosition = 0;
if (config.fht8wEnabled) {
    fht8wAddress =
        String(config.fht8wAddress || '')
            .trim()
            .toUpperCase() || defaultFht8wAddress(config.fhtCentral || '');
    if (!isFht8vAddressForCentral(fht8wAddress, config.fhtCentral || '')) {
        throw new Error('fht8w_address must be a 4-digit hexadecimal address compatible with fht_central');
    }
}
let fs20DeviceByAddress = new Map();
const fs20TimerValues = new Map();
const fs20States = new Map();
const fs20OffTimers = new Map();
const fhtInitialized = new Set();
const fhtInitialising = new Set();
const fhtStateFile = config.stateDir ? path.join(config.stateDir, 'fht-initialized.json') : null;
const fs20TimerFile = config.stateDir ? path.join(config.stateDir, 'fs20-timers.json') : null;
const rawCommandFile = config.stateDir ? path.join(config.stateDir, 'raw-command.json') : null;
let rawCommand = '';

const FS20_TIMER_COUNT = 5;

function fs20TimerField(index) {
    return index === 0 ? 'on_time' : `timer_${index + 1}`;
}

function fs20TimerIndex(field) {
    if (field === 'on_time') {
        return 0;
    }
    const match = /^timer_([2-5])$/.exec(field);
    return match ? Number(match[1]) - 1 : undefined;
}

function normalizedTimerValues(values, initialOnTime = 0) {
    return Array.from({length: FS20_TIMER_COUNT}, (_, index) => {
        const candidate = Array.isArray(values) ? Number(values[index]) : NaN;
        const fallback = index === 0 ? Number(initialOnTime) : 0;
        const seconds = Number.isFinite(candidate) ? candidate : fallback;
        return isValidFs20TimerDuration(seconds) ? seconds : 0;
    });
}

/** items seen so far (published name → last value) for discovery */
const seen = new Map();
let discoveryTimer = null;
let cul = null;
let lastError = null;
let fhtCentralConfigured = false;
const fhtMeasurementParts = new Map();
const fhtClockParts = new Map();
const clearedNormalizedDiscoveryIds = new Set();

const FHT_CLOCK_FIELDS = new Set(['hour', 'minute', 'day', 'month', 'year']);

/** Remove obsolete retained announcements from prior FHT discovery identities. */
function clearLegacyDiscoveryTopics(devices) {
    if (!config.haDiscovery) {
        return;
    }
    const activeIds = new Set(devices.map((device) => device.id));
    const normalizedIds = normalizedDiscoveryIds({
        name: config.name,
        items: seen,
        fs20Devices,
        fht8vDevices,
        fht8wAddress: config.fht8wEnabled ? fht8wAddress : '',
    });
    const legacyIds = devices.flatMap((device) => device.legacyDiscoveryIds || []);
    for (const id of [...normalizedIds, ...legacyIds]) {
        if (!id || activeIds.has(id) || clearedNormalizedDiscoveryIds.has(id)) {
            continue;
        }
        adapter.publish(`${config.haPrefix}/device/${id}/config`, '', {retain: true});
        clearedNormalizedDiscoveryIds.add(id);
        log.debug('mqtt cleared normalized Home Assistant discovery', id);
    }
}

/**
 * Restore retained FHT states after MQTT reconnect/startup. This repopulates discovery from the
 * broker's existing values, migrates the old raw clock bytes to combined items, and lets the next
 * device discovery payload update friendly names and drop obsolete components.
 */
function restoreFhtStatus(parts, payload) {
    const [address, field] = parts;
    if (!/^[0-9A-F]{4}$/i.test(address || '') || !field) return;
    const rawItem = `fht/${address}/${field}`;
    const value = payload && typeof payload === 'object' && Object.hasOwn(payload, 'val') ? payload.val : payload;
    if (value === undefined || value === null || value === '') return;

    if (FHT_CLOCK_FIELDS.has(field)) {
        for (const item of fhtClockItemsFromValue(address, field, value, fhtClockParts)) {
            const [, , derivedField] = item.item.split('/');
            publishFhtField(address, derivedField, item.val);
        }
        return;
    }

    const name = mapItem(rawItem, map);
    if (!seen.has(name)) {
        seen.set(name, {val: value, retain: true, raw: rawItem});
        scheduleDiscovery();
    }
}

const culLabel = config.host ? `${config.host}:${config.port}` : config.serialport;

const adapter = createAdapter({
    pkg,
    config,
    deviceLabel: 'cul',
    info: {cul: culLabel, mode: config.culMode},
    discovery: () => {
        const devices = discoveryModel({
            name: config.name,
            items: seen,
            jsonPayloads: config.jsonPayloads,
            rawSet: config.rawSet,
            fs20Devices,
            fht8vDevices,
            fht8wAddress: config.fht8wEnabled ? fht8wAddress : '',
        });
        clearLegacyDiscoveryTopics(devices);
        return devices;
    },
    subscriptions: {
        'status/fht/+/+': (parts, value) => restoreFhtStatus(parts, value),
    },
    onSet: handleSet,
    onShutdown: () => {
        clearInterval(offlineTimer);
        clearInterval(stateTimer);
        saveState();
        if (!cul) {
            return;
        }
        // close() stops the reconnect loop; do not wait forever for an unplugged device
        return Promise.race([cul.close(), new Promise((resolve) => setTimeout(resolve, 1000))]).catch(() => {});
    },
});
const {log, pubStatus} = adapter;

function logSentEvent(item, value, detail) {
    log.info('cul event sent', item, '=', value, ...(detail ? [detail] : []));
}

async function sendRaw(data) {
    await cul.write(data);
    logSentEvent('raw/command', data);
}

restoreRawCommand();
if (config.rawSet) {
    pubStatus('raw/command', rawCommand, {retain: true});
}

function restoreRawCommand() {
    if (!rawCommandFile || !fs.existsSync(rawCommandFile)) {
        return;
    }
    try {
        const saved = JSON.parse(fs.readFileSync(rawCommandFile, 'utf8'));
        if (typeof saved === 'string' && saved.length <= 128 && !/[\r\n]/.test(saved)) {
            rawCommand = saved;
        } else {
            log.warn('cannot read', rawCommandFile, '- expected a single CUL command string');
        }
    } catch (err) {
        log.warn('cannot read', rawCommandFile, '-', err.message);
    }
}

function saveRawCommand() {
    if (!rawCommandFile) {
        return;
    }
    try {
        fs.mkdirSync(config.stateDir, {recursive: true});
        fs.writeFileSync(rawCommandFile, JSON.stringify(rawCommand));
    } catch (err) {
        log.warn('cannot save', rawCommandFile, '-', err.message);
    }
}

function setFs20Devices(value) {
    const definitions = normaliseFs20Devices(value);
    const invalid = definitions.find(
        (device) => !device.name || !/^[0-9A-F]{6}$/.test(device.address) || !['switch', 'light'].includes(device.type),
    );
    if (invalid) {
        throw new Error('Each FS20 device needs a name, a 6-digit hexadecimal address, and switch or light type');
    }
    const addresses = new Set();
    for (const device of definitions) {
        if (addresses.has(device.address)) {
            throw new Error(`Duplicate FS20 address: ${device.address}`);
        }
        addresses.add(device.address);
    }
    fs20Devices = definitions;
    fs20DeviceByAddress = new Map(definitions.map((device) => [device.address, device]));
    for (const address of fs20TimerValues.keys()) {
        if (!fs20DeviceByAddress.has(address)) {
            fs20TimerValues.delete(address);
        }
    }
    for (const address of fs20States.keys()) {
        if (!fs20DeviceByAddress.has(address)) {
            fs20States.delete(address);
        }
    }
    for (const [address, timer] of fs20OffTimers) {
        if (!fs20DeviceByAddress.has(address)) {
            clearTimeout(timer.timeout);
            clearInterval(timer.interval);
            fs20OffTimers.delete(address);
        }
    }
    for (const device of definitions) {
        if (!fs20TimerValues.has(device.address)) {
            fs20TimerValues.set(device.address, normalizedTimerValues(null, device.on_time));
        }
        fs20TimerValues.get(device.address).forEach((seconds, index) => {
            pubStatus(`fs20/${device.address}/${fs20TimerField(index)}`, seconds, {retain: true});
        });
        if (!fs20States.has(device.address)) {
            fs20States.set(device.address, false);
            pubStatus(`fs20/${device.address}/state`, false, {retain: true});
        }
        pubStatus(`fs20/${device.address}/timer_remaining`, 0, {retain: true});
    }
    adapter.markDiscoveryDirty();
    adapter.publishDiscovery();
    saveFs20Timers();
}

function setFht8vDevices(value) {
    const definitions = normaliseFht8vDevices(value);
    const invalid = definitions.find(
        (device) =>
            !device.name ||
            !/^[0-9A-F]{4}$/.test(device.address) ||
            !config.fhtCentral ||
            !isFht8vAddressForCentral(device.address, config.fhtCentral),
    );
    if (invalid) {
        throw new Error('Each FHT8V device needs a name and a 4-digit hexadecimal address compatible with fht_central');
    }
    const addresses = new Set();
    for (const device of definitions) {
        if (addresses.has(device.address)) {
            throw new Error(`Duplicate FHT8V address: ${device.address}`);
        }
        addresses.add(device.address);
    }
    if (fht8wAddress && addresses.has(fht8wAddress)) {
        throw new Error(`FHT8W report address ${fht8wAddress} is already configured as a physical FHT8V`);
    }
    fht8vDevices = definitions;
    fht8vDeviceByAddress.clear();
    for (const device of definitions) {
        fht8vDeviceByAddress.set(device.address, device);
        if (fht8vPositions.has(device.address)) {
            pubStatus(`fht8v/${device.address.toLowerCase()}/valve_position`, fht8vPositions.get(device.address), {
                retain: true,
            });
        }
    }
    for (const address of fht8vPositions.keys()) {
        if (!fht8vDeviceByAddress.has(address)) {
            fht8vPositions.delete(address);
        }
    }
    adapter.markDiscoveryDirty();
    adapter.publishDiscovery();
    saveFht8vPositions();
    if (fht8wAddress) {
        loadFht8wPosition();
        pubStatus(`fht8w/${fht8wAddress.toLowerCase()}/valve_position`, fht8wPosition, {retain: true});
    }
}

function loadFht8vPositions() {
    if (!fht8vStateFile || !fs.existsSync(fht8vStateFile)) {
        return;
    }
    try {
        const saved = JSON.parse(fs.readFileSync(fht8vStateFile, 'utf8'));
        for (const [address, value] of Object.entries(saved)) {
            const normalized = address.toUpperCase();
            const position = Number(value);
            if (/^[0-9A-F]{4}$/.test(normalized) && Number.isInteger(position) && position >= 0 && position <= 100) {
                fht8vPositions.set(normalized, position);
            }
        }
    } catch (err) {
        log.warn('cannot read', fht8vStateFile, '-', err.message);
    }
}

function saveFht8vPositions() {
    if (!fht8vStateFile) {
        return;
    }
    try {
        fs.mkdirSync(config.stateDir, {recursive: true});
        fs.writeFileSync(fht8vStateFile, JSON.stringify(Object.fromEntries(fht8vPositions)));
    } catch (err) {
        log.warn('cannot save', fht8vStateFile, '-', err.message);
    }
}

function loadFht8wPosition() {
    if (!fht8wStateFile || !fs.existsSync(fht8wStateFile)) {
        return;
    }
    try {
        const value = Number(JSON.parse(fs.readFileSync(fht8wStateFile, 'utf8')));
        if (Number.isInteger(value) && value >= 0 && value <= 100) {
            fht8wPosition = value;
        }
    } catch (err) {
        log.warn('cannot read', fht8wStateFile, '-', err.message);
    }
}

function saveFht8wPosition() {
    if (!fht8wStateFile) {
        return;
    }
    try {
        fs.mkdirSync(config.stateDir, {recursive: true});
        fs.writeFileSync(fht8wStateFile, JSON.stringify(fht8wPosition));
    } catch (err) {
        log.warn('cannot save', fht8wStateFile, '-', err.message);
    }
}

loadFs20Timers();
setFs20Devices(fs20Devices);
loadFht8vPositions();
setFht8vDevices(fht8vDevices);

/*
 * offline detection — devices that stop sending get a retained <protocol>/<address>/online item
 */

const offline = config.offlineDetection
    ? new OfflineTracker({timeouts: timeoutsFromMap(map), learn: config.learnIntervals})
    : null;
const stateFile = offline && config.stateDir ? path.join(config.stateDir, 'offline.json') : null;
let offlineTimer = null;
let stateTimer = null;

if (stateFile && fs.existsSync(stateFile)) {
    try {
        offline.load(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
    } catch (err) {
        log.warn('cannot read', stateFile, '-', err.message);
    }
}
if (fhtStateFile && fs.existsSync(fhtStateFile)) {
    try {
        for (const address of JSON.parse(fs.readFileSync(fhtStateFile, 'utf8'))) {
            if (/^[0-9A-F]{4}$/i.test(address)) {
                fhtInitialized.add(address.toUpperCase());
            }
        }
    } catch (err) {
        log.warn('cannot read', fhtStateFile, '-', err.message);
    }
}

function saveState() {
    if (!stateFile) {
        return;
    }
    try {
        fs.mkdirSync(config.stateDir, {recursive: true});
        fs.writeFileSync(stateFile, JSON.stringify(offline.state()));
    } catch (err) {
        log.warn('cannot save', stateFile, '-', err.message);
    }
}

function saveFhtState() {
    if (!fhtStateFile) {
        return;
    }
    try {
        fs.mkdirSync(config.stateDir, {recursive: true});
        fs.writeFileSync(fhtStateFile, JSON.stringify([...fhtInitialized].sort()));
    } catch (err) {
        log.warn('cannot save', fhtStateFile, '-', err.message);
    }
}

function loadFs20Timers() {
    if (!fs20TimerFile || !fs.existsSync(fs20TimerFile)) {
        return;
    }
    try {
        const saved = JSON.parse(fs.readFileSync(fs20TimerFile, 'utf8'));
        for (const [address, values] of Object.entries(saved)) {
            if (/^[0-9A-F]{6}$/.test(address) && Array.isArray(values)) {
                fs20TimerValues.set(address, normalizedTimerValues(values));
            }
        }
    } catch (err) {
        log.warn('cannot read', fs20TimerFile, '-', err.message);
    }
}

function saveFs20Timers() {
    if (!fs20TimerFile) {
        return;
    }
    try {
        fs.mkdirSync(config.stateDir, {recursive: true});
        fs.writeFileSync(fs20TimerFile, JSON.stringify(Object.fromEntries(fs20TimerValues)));
    } catch (err) {
        log.warn('cannot save', fs20TimerFile, '-', err.message);
    }
}

function publishOnline(device, online) {
    const name = mapItem(`${device}/online`, map);
    const isNew = !seen.has(name);
    seen.set(name, {val: online ? 1 : 0, retain: true, raw: `${device}/online`});
    pubStatus(name, online ? 1 : 0, {retain: true});
    if (isNew) {
        scheduleDiscovery();
    }
}

if (offline) {
    offlineTimer = setInterval(() => {
        for (const device of offline.check(Date.now() / 1000)) {
            log.info('cul device offline', device, `(no message for ${Math.round(offline.timeoutFor(device))}s)`);
            publishOnline(device, false);
        }
    }, OFFLINE_CHECK_MS);
    if (stateFile) {
        stateTimer = setInterval(saveState, STATE_SAVE_MS);
    }
}

/*
 * set handling
 */

async function handleSet(parts, value, topic) {
    const rawCommandInput = String(parts[0]).toLowerCase() === 'raw' && parts.length === 2 && parts[1] === 'command';
    if (value === undefined && !rawCommandInput) {
        log.warn('mqtt ignoring empty payload on', topic);
        return;
    }
    if (rawCommandInput) {
        if (!config.rawSet) {
            log.warn('mqtt set raw command: disabled (see --raw-set)');
            return;
        }
        try {
            rawCommand = rawCommandText(value === undefined ? '' : value);
        } catch (err) {
            log.warn('mqtt set raw command:', err.message);
            return;
        }
        saveRawCommand();
        pubStatus('raw/command', rawCommand, {retain: true});
        log.info(rawCommand ? 'raw CUL command updated' : 'raw CUL command cleared');
        return;
    }
    if (String(parts[0]).toLowerCase() === 'raw' && parts.length === 2 && parts[1] === 'send') {
        if (!config.rawSet) {
            log.warn('mqtt send raw command: disabled (see --raw-set)');
            return;
        }
        if (String(value).trim().toUpperCase() !== 'PRESS') {
            log.warn('mqtt send raw command: expected PRESS');
            return;
        }
        if (!rawCommand) {
            log.warn('mqtt send raw command: enter a command first');
            return;
        }
        let command;
        try {
            command = commandFor(['raw'], rawCommand, {rawSet: true});
        } catch (err) {
            log.warn('mqtt send raw command:', err.message);
            return;
        }
        if (!cul || !cul.connected) {
            throw new Error('cul not connected');
        }
        log.debug('cul > raw', command.data);
        return sendRaw(command.data);
    }
    if (String(parts[0]).toLowerCase() === 'fht8w' && parts.length === 3) {
        if (!fht8wAddress) {
            log.warn('mqtt set FHT8W emulator: disabled; enable fht8w_enabled in app configuration');
            return;
        }
        const requestedAddress = String(parts[1]).trim().toUpperCase();
        if (requestedAddress !== fht8wAddress) {
            log.warn('mqtt set FHT8W emulator: unknown address', requestedAddress);
            return;
        }
        const field = String(parts[2]).toLowerCase();
        if (field === 'valve-position') {
            const position = Number(value);
            if (!Number.isInteger(position) || position < 0 || position > 100) {
                log.warn('mqtt set FHT8W emulator: valve position must be an integer from 0 to 100');
                return;
            }
            fht8wPosition = position;
            saveFht8wPosition();
            pubStatus(`fht8w/${fht8wAddress.toLowerCase()}/valve_position`, fht8wPosition, {retain: true});
            log.info('FHT8W emulator valve position set to', position, '%');
            return;
        }
        if (field === 'report') {
            if (String(value).trim().toUpperCase() !== 'PRESS') {
                log.warn('mqtt set FHT8W emulator report: expected PRESS');
                return;
            }
            if (!cul || !cul.connected) {
                throw new Error('cul not connected');
            }
            if (!fhtCentralConfigured) {
                throw new Error('FHT central code is not configured yet');
            }
            const data = fht8vPositionCommand(fht8wAddress, fht8wPosition);
            log.debug('cul > FHT8W emulator', data);
            await cul.write(data);
            logSentEvent(`fht8w/${fht8wAddress.toLowerCase()}/valve_position`, `${fht8wPosition}%`);
            return;
        }
        log.warn('mqtt set FHT8W emulator: unsupported field', field);
        return;
    }
    if (String(parts[0]).toLowerCase() === 'fht8v' && parts.length === 3) {
        const address = String(parts[1]).trim().toUpperCase();
        const device = fht8vDeviceByAddress.get(address);
        if (!device) {
            log.warn('mqtt set FHT8V: unknown configured address', address);
            return;
        }
        if (!cul || !cul.connected) {
            throw new Error('cul not connected');
        }
        if (!fhtCentralConfigured) {
            throw new Error('FHT central code is not configured yet');
        }
        const field = String(parts[2]).toLowerCase();
        if (field === 'valve-position') {
            const position = Number(value);
            let data;
            try {
                data = fht8vPositionCommand(address, position);
            } catch (err) {
                log.warn('mqtt set FHT8V position:', err.message);
                return;
            }
            log.debug('cul > FHT8V', data);
            await cul.write(data);
            fht8vPositions.set(address, position);
            saveFht8vPositions();
            pubStatus(`fht8v/${address.toLowerCase()}/valve_position`, position, {retain: true});
            logSentEvent(`fht8v/${address.toLowerCase()}/valve_position`, position);
            return;
        }
        if (field === 'pair') {
            if (String(value).trim().toUpperCase() !== 'PRESS') {
                log.warn('mqtt set FHT8V pair:', address, '- expected PRESS');
                return;
            }
            const data = fht8vPairCommand(address);
            log.debug('cul > FHT8V', data);
            await cul.write(data);
            logSentEvent(`fht8v/${address.toLowerCase()}/pair`, 'paired with CUL');
            return;
        }
        log.warn('mqtt set FHT8V: unsupported field', field);
        return;
    }
    if (String(parts[0]).toLowerCase() === 'fs20' && parts.length === 3 && fs20TimerIndex(parts[2]) !== undefined) {
        const address = String(parts[1]).trim().toUpperCase();
        if (!fs20DeviceByAddress.has(address)) {
            log.warn('mqtt set fs20 timer: unknown configured FS20 address', address);
            return;
        }
        const index = fs20TimerIndex(parts[2]);
        const seconds = Number(value);
        if (!isValidFs20TimerDuration(seconds)) {
            log.warn('mqtt set fs20 timer:', value, '- expected a 0.25-second increment from 0 to 15360 seconds');
            return;
        }
        const values = [...fs20TimerValues.get(address)];
        values[index] = seconds;
        fs20TimerValues.set(address, values);
        saveFs20Timers();
        pubStatus(`fs20/${address}/${fs20TimerField(index)}`, seconds, {retain: true});
        log.info('FS20 timer preset', address, 'slot', index + 1, 'set to', seconds, 'seconds');
        return;
    }
    if (
        String(parts[0]).toLowerCase() === 'fs20' &&
        parts.length === 4 &&
        parts[2] === 'on-for-timer' &&
        /^[1-5]$/.test(parts[3])
    ) {
        const address = String(parts[1]).trim().toUpperCase();
        if (!fs20DeviceByAddress.has(address)) {
            log.warn('mqtt set fs20 timed-on button: unknown configured FS20 address', address);
            return;
        }
        const slot = Number(parts[3]);
        const seconds = fs20TimerValues.get(address)?.[slot - 1] || 0;
        if (!seconds) {
            log.warn('mqtt set fs20 timed-on button:', address, 'timer', slot, 'is 0 seconds; set a duration first');
            return;
        }
        if (!cul || !cul.connected) {
            throw new Error('cul not connected');
        }
        const command = commandFor(['fs20', address], {cmd: 'on-for-timer', time: seconds});
        log.info('FS20 timer button', address, 'slot', slot, 'pressed for', seconds, 'seconds');
        return sendFs20(command);
    }
    if (String(parts[0]).toLowerCase() === 'fht' && parts.length === 3 && parts[2] === 'sync-time') {
        await syncFhtTime(parts[1]);
        return;
    }
    let command;
    try {
        command = commandFor(parts, value, {rawSet: config.rawSet});
    } catch (err) {
        log.warn('mqtt set', parts.join('/'), String(value), '-', err.message);
        return;
    }
    if (!cul || !cul.connected) {
        throw new Error('cul not connected');
    }
    switch (command.type) {
        case 'fs20':
            return sendFs20(command);
        case 'fht':
            if (!config.fhtCentral) {
                throw new Error('set/fht needs --fht-central');
            }
            if (!fhtCentralConfigured) {
                throw new Error('FHT central code is not configured yet');
            }
            {
                const data = fhtCommand(command.device, command.cmd, command.value);
                log.debug('cul > FHT', data);
                await cul.write(data);
                const field = command.cmd === 'mode' ? 'mode' : command.cmd === 'desired-temp' ? 'desired_temp' : null;
                if (field) {
                    const value =
                        field === 'mode'
                            ? String(command.value).toUpperCase() === 'AUTO'
                                ? 'AUTO'
                                : 'MANU'
                            : Number(command.value);
                    logSentEvent(`fht/${String(command.device).toLowerCase()}/${field}`, value);
                    publishFhtField(command.device, field, value);
                }
                return;
            }
        case 'raw':
            log.debug('cul > raw', command.data);
            return sendRaw(command.data);
        default:
            throw new Error('unhandled command type ' + command.type);
    }
}

function fhtReady() {
    if (!cul || !cul.connected) {
        throw new Error('cul not connected');
    }
    if (!config.fhtCentral || !fhtCentralConfigured) {
        throw new Error('FHT central code is not configured yet');
    }
}

async function syncFhtTime(device) {
    fhtReady();
    const address = String(device).trim().toUpperCase();
    if (!/^[0-9A-F]{4}$/.test(address)) {
        throw new Error('sync-time needs a 4-digit hexadecimal FHT address');
    }
    const now = new Date();
    const settings = [
        ['60', 'year', now.getFullYear() % 100],
        ['61', 'month', now.getMonth() + 1],
        ['62', 'day', now.getDate()],
        ['63', 'hour', now.getHours()],
        ['64', 'minute', now.getMinutes()],
    ];
    log.info('cul syncing time for FHT', address);
    for (const [command, field, value] of settings) {
        const data = fhtRawCommand(address, command, value);
        log.debug('cul > FHT', data);
        await cul.write(data);
        logSentEvent(`fht/${address.toLowerCase()}/${field}`, value);
        await new Promise((resolve) => setTimeout(resolve, 750));
    }
}

function hasFhtField(address, field) {
    const raw = `fht/${address}/${field}`;
    return [...seen.values()].some((item) => String(item.raw).toUpperCase() === raw.toUpperCase());
}

function publishFhtField(address, field, value) {
    const item = `fht/${address}/${field}`;
    const name = mapItem(item, map);
    const isNew = !seen.has(name);
    seen.set(name, {val: value, retain: true, raw: item});
    pubStatus(name, value, {retain: true});
    if (isNew) {
        scheduleDiscovery();
    }
}

async function initialiseFht(address) {
    address = String(address).toUpperCase();
    if (fhtInitialized.has(address) || fhtInitialising.has(address)) {
        return;
    }
    if (hasFhtField(address, 'mode') && hasFhtField(address, 'desired_temp')) {
        fhtInitialized.add(address);
        saveFhtState();
        return;
    }
    if (!config.fhtCentral || !fhtCentralConfigured) {
        log.warn('FHT', address, 'has incomplete state; configure fht_central to initialise it');
        return;
    }
    fhtInitialising.add(address);
    try {
        const mode = fhtCommand(address, 'mode', 'MANU');
        const temperature = fhtCommand(address, 'desired-temp', 16);
        log.info('cul initialising FHT', address, 'to manual, 16 °C');
        await cul.write(mode);
        logSentEvent(`fht/${address.toLowerCase()}/mode`, 'MANU');
        await cul.write(temperature);
        logSentEvent(`fht/${address.toLowerCase()}/desired_temp`, 16);
        publishFhtField(address, 'mode', 'MANU');
        publishFhtField(address, 'desired_temp', 16);
        fhtInitialized.add(address);
        saveFhtState();
    } catch (err) {
        log.warn('cannot initialise FHT', address, '-', err.message);
    } finally {
        fhtInitialising.delete(address);
    }
}

async function sendFs20(command) {
    const address = `${command.housecode}${command.address}`.replace(/\s+/g, '').toUpperCase();
    const definition = fs20DeviceByAddress.get(address);
    const {cmd, time} = command;
    await cul.cmd('FS20', command.housecode, command.address, cmd, time);
    let timerDetail;
    if (cmd.includes('timer') && isValidFs20TimerDuration(time) && Number(time) > 0) {
        const effectiveSeconds = fs20TimerDuration(time);
        timerDetail =
            effectiveSeconds === Number(time)
                ? `timer ${effectiveSeconds} seconds`
                : `timer ${effectiveSeconds} seconds (requested ${time})`;
    }
    logSentEvent(`fs20/${address}`, cmd, timerDetail);
    if (!definition) {
        return;
    }
    const item = `fs20/${address}/state`;
    if (fs20OffTimers.has(address)) {
        const activeTimer = fs20OffTimers.get(address);
        clearTimeout(activeTimer.timeout);
        clearInterval(activeTimer.interval);
        fs20OffTimers.delete(address);
        pubStatus(`fs20/${address}/timer_remaining`, 0, {retain: true});
    }
    const isOn = optimisticFs20State(cmd, fs20States.get(address));
    fs20States.set(address, isOn);
    pubStatus(item, isOn, {retain: true});
    if (cmd === 'on-for-timer' && Number.isFinite(Number(time)) && Number(time) > 0) {
        const effectiveSeconds = fs20TimerDuration(time);
        if (effectiveSeconds !== Number(time)) {
            log.info('FS20 timer', address, 'requested', time, 'seconds; radio timer is', effectiveSeconds, 'seconds');
        }
        const endsAt = Date.now() + effectiveSeconds * 1000;
        let lastRemaining = Math.ceil(effectiveSeconds);
        pubStatus(`fs20/${address}/timer_remaining`, lastRemaining, {retain: true});
        const interval = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
            if (remaining !== lastRemaining) {
                lastRemaining = remaining;
                pubStatus(`fs20/${address}/timer_remaining`, remaining, {retain: true});
            }
        }, 250);
        const timeout = setTimeout(() => {
            const activeTimer = fs20OffTimers.get(address);
            if (activeTimer) {
                clearInterval(activeTimer.interval);
            }
            fs20OffTimers.delete(address);
            fs20States.set(address, false);
            pubStatus(`fs20/${address}/timer_remaining`, 0, {retain: true});
            pubStatus(item, false, {retain: true});
        }, effectiveSeconds * 1000);
        fs20OffTimers.set(address, {timeout, interval, endsAt});
    }
}

function publishFs20TimerStates() {
    for (const [address, values] of fs20TimerValues) {
        values.forEach((seconds, index) => {
            pubStatus(`fs20/${address}/${fs20TimerField(index)}`, seconds, {retain: true});
        });
        const activeTimer = fs20OffTimers.get(address);
        const remaining = activeTimer ? Math.max(0, Math.ceil((activeTimer.endsAt - Date.now()) / 1000)) : 0;
        pubStatus(`fs20/${address}/timer_remaining`, remaining, {retain: true});
    }
}

/*
 * CUL — the cul library reconnects by itself (every RECONNECT_MS); we only mirror its state
 */

function culOptions() {
    const options = {
        mode: config.culMode,
        coc: config.coc,
        scc: config.scc,
        reconnect: RECONNECT_MS,
        logger: (...args) => log.debug('cul', ...args),
    };
    if (config.host) {
        options.connectionMode = 'telnet';
        options.host = config.host;
        options.port = config.port;
    } else {
        options.serialport = config.serialport;
        if (config.baudrate) {
            options.baudrate = config.baudrate;
        }
    }
    return options;
}

function connect() {
    log.debug('cul connecting', culLabel);
    cul = new Cul(culOptions());

    cul.on('ready', async () => {
        lastError = null;
        log.info('cul ready', culLabel);
        fhtCentralConfigured = false;
        if (config.fhtCentral) {
            const central = String(config.fhtCentral).trim().toUpperCase();
            if (!/^[0-9A-F]{4}$/.test(central)) {
                log.warn('invalid --fht-central; expected 4 hexadecimal digits');
            } else {
                try {
                    await cul.write(`T01${central}`);
                    fhtCentralConfigured = true;
                    log.debug('cul > FHT central configured');
                } catch (err) {
                    log.warn('cannot configure FHT central code -', err.message);
                }
            }
        }
        adapter.setDeviceConnected(true);
        publishFs20TimerStates();
    });

    cul.on('data', onData);

    cul.on('close', () => {
        fhtCentralConfigured = false;
        if (adapter.shuttingDown) {
            return;
        }
        if (adapter.deviceConnected) {
            log.warn('cul disconnected', culLabel, '- reconnecting every', RECONNECT_MS / 1000, 's');
            adapter.setDeviceConnected(false);
        }
    });

    cul.on('error', (err) => {
        const msg = (err && err.message) || String(err);
        if (adapter.shuttingDown) {
            log.debug('cul', msg);
            return;
        }
        // repeated identical errors (device unplugged, every reconnect attempt) are logged once
        if (msg !== lastError) {
            log.warn('cul', msg);
            lastError = msg;
        }
        adapter.setDeviceConnected(false);
    });
}

function onData(raw, obj) {
    log.debug('cul <', raw, obj && obj.protocol ? JSON.stringify(obj) : '');
    if (config.publishRaw) {
        adapter.publish(adapter.topic('raw'), raw, {retain: false});
    }
    if (!obj || !obj.protocol) {
        return;
    }
    if (obj.unknown) {
        log.debug('cul no parser for', obj.protocol, raw);
        return;
    }
    const items = itemsFor(obj);
    const measuredTemperature = fhtMeasuredTemperature(obj, fhtMeasurementParts);
    if (measuredTemperature) items.push(measuredTemperature);
    items.push(...fhtClockItems(obj, fhtClockParts));
    if (items.length === 0) {
        if (obj.address !== undefined) {
            log.debug(
                'cul nothing to publish for',
                obj.protocol,
                obj.address,
                obj.data && obj.data.error ? obj.data.error : '',
            );
        }
        return;
    }
    let newItems = false;
    for (const {item, val, retain} of items) {
        const name = mapItem(item, map);
        if (!seen.has(name)) {
            newItems = true;
            log.info('cul new item', name, obj.device ? `(${obj.device})` : '');
        }
        log.info('cul event', name, '=', val);
        seen.set(name, {val, retain, raw: item, device: obj.device});
        pubStatus(name, val, {retain});
        if (config.publishEvents) {
            const [protocol, address, ...field] = item.split('/');
            adapter.publish(
                adapter.topic(`event/${name}`),
                {
                    protocol,
                    address,
                    field: field.join('/'),
                    value: val,
                    ...(typeof obj.rssi === 'number' && {rssi: obj.rssi}),
                    received_at: new Date().toISOString(),
                },
                {retain: false},
            );
        }
    }
    if (newItems) {
        scheduleDiscovery();
    }
    if (offline) {
        // same device key as the items' base: protocol lower case, address verbatim
        const device = `${String(obj.protocol).toLowerCase()}/${obj.address}`;
        const transition = offline.seen(device, Date.now() / 1000);
        if (transition && transition.changed) {
            publishOnline(device, true);
        }
    }
    if (String(obj.protocol).toUpperCase() === 'FHT') {
        const address = String(obj.address).toUpperCase();
        if (hasFhtField(address, 'measured_temp')) {
            if (fhtInitialized.has(address)) {
                if (!hasFhtField(address, 'mode')) {
                    publishFhtField(address, 'mode', 'MANU');
                }
            } else {
                void initialiseFht(obj.address);
            }
        }
    }
}

/** Devices announce themselves over time; coalesce discovery updates. */
function scheduleDiscovery() {
    if (discoveryTimer) {
        return;
    }
    discoveryTimer = setTimeout(() => {
        discoveryTimer = null;
        adapter.markDiscoveryDirty();
        adapter.publishDiscovery();
    }, 2000);
}

adapter.start();
connect();
