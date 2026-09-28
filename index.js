#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Cul from 'cul';
import {createAdapter, createLogger, runDiscovery, autoAddress} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {fhtMeasuredTemperature, itemsFor, mapItem} from './lib/items.js';
import {commandFor} from './lib/commands.js';
import {fhtCommand, fhtRawCommand} from './lib/fht-command.js';
import {discoveryModel} from './lib/hadiscovery.js';
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

let fs20Devices = [];
try {
    const parsed = JSON.parse(config.fs20Devices || '[]');
    // Home Assistant's app config may serialise an empty list as null and a single nested
    // definition as an object. Accept both forms; the discovery model validates each entry.
    fs20Devices = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
} catch (err) {
    throw new Error(`invalid --fs20-devices JSON: ${err.message}`);
}
const fs20DeviceByAddress = new Map(
    fs20Devices
        .map((device) => [
            String(device?.address || '')
                .trim()
                .toUpperCase(),
            device,
        ])
        .filter(([address]) => /^[0-9A-F]{6}$/.test(address)),
);
const fs20OnTimes = new Map(
    [...fs20DeviceByAddress].map(([address, device]) => {
        const seconds = Number(device.on_time);
        return [address, Number.isFinite(seconds) && seconds >= 0 ? seconds : 0];
    }),
);
const fs20OffTimers = new Map();
const fhtInitialized = new Set();
const fhtInitialising = new Set();
const fhtStateFile = config.stateDir ? path.join(config.stateDir, 'fht-initialized.json') : null;

/** items seen so far (published name → last value) for discovery */
const seen = new Map();
let discoveryTimer = null;
let cul = null;
let lastError = null;
let fhtCentralConfigured = false;
const fhtMeasurementParts = new Map();

const culLabel = config.host ? `${config.host}:${config.port}` : config.serialport;

const adapter = createAdapter({
    pkg,
    config,
    deviceLabel: 'cul',
    info: {cul: culLabel, mode: config.culMode},
    discovery: () => discoveryModel({name: config.name, items: seen, jsonPayloads: config.jsonPayloads, fs20Devices}),
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
    if (value === undefined) {
        log.warn('mqtt ignoring empty payload on', topic);
        return;
    }
    if (String(parts[0]).toLowerCase() === 'fs20' && parts.length === 3 && parts[2] === 'on_time') {
        const address = String(parts[1]).trim().toUpperCase();
        if (!fs20DeviceByAddress.has(address)) {
            log.warn('mqtt set fs20 timer: unknown configured FS20 address', address);
            return;
        }
        const seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 15_360) {
            log.warn('mqtt set fs20 timer:', value, '- expected a whole number from 0 to 15360 seconds');
            return;
        }
        fs20OnTimes.set(address, seconds);
        pubStatus(`fs20/${address}/on_time`, seconds, {retain: true});
        return;
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
            log.debug('cul > FS20', command.housecode, command.address, command.cmd, command.time);
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
                return cul.write(data);
            }
        case 'raw':
            log.debug('cul > raw', command.data);
            return cul.write(command.data);
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
        ['60', now.getFullYear() % 100],
        ['61', now.getMonth() + 1],
        ['62', now.getDate()],
        ['63', now.getHours()],
        ['64', now.getMinutes()],
    ];
    log.info('cul syncing time for FHT', address);
    for (const [command, value] of settings) {
        const data = fhtRawCommand(address, command, value);
        log.debug('cul > FHT', data);
        await cul.write(data);
        await new Promise((resolve) => setTimeout(resolve, 750));
    }
}

function hasFhtField(address, field) {
    const raw = `fht/${address}/${field}`;
    return [...seen.values()].some((item) => item.raw === raw);
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
        const temperature = fhtCommand(address, 'desired-temp', 10);
        log.info('cul initialising FHT', address, 'to manual, 10 °C');
        await cul.write(mode);
        await cul.write(temperature);
        publishFhtField(address, 'mode', 'MANU');
        publishFhtField(address, 'desired_temp', 10);
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
    let {cmd, time} = command;
    const onTime = fs20OnTimes.get(address) || 0;
    if (cmd === 'on' && Number.isFinite(onTime) && onTime > 0) {
        cmd = 'on-for-timer';
        time = onTime;
    }
    await cul.cmd('FS20', command.housecode, command.address, cmd, time);
    if (!definition) {
        return;
    }
    const item = `fs20/${address}/state`;
    if (fs20OffTimers.has(address)) {
        clearTimeout(fs20OffTimers.get(address));
        fs20OffTimers.delete(address);
    }
    const isOn = cmd !== 'off' && cmd !== 'reset';
    pubStatus(item, isOn, {retain: true});
    if (cmd === 'on-for-timer' && Number.isFinite(Number(time)) && Number(time) > 0) {
        fs20OffTimers.set(
            address,
            setTimeout(
                () => {
                    fs20OffTimers.delete(address);
                    pubStatus(item, false, {retain: true});
                },
                Number(time) * 1000,
            ),
        );
    }
}

function publishFs20TimerStates() {
    for (const [address, seconds] of fs20OnTimes) {
        pubStatus(`fs20/${address}/on_time`, seconds, {retain: true});
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
    if (measuredTemperature) {
        items.push(measuredTemperature);
    }
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
    if (
        String(obj.protocol).toUpperCase() === 'FHT' &&
        hasFhtField(String(obj.address).toUpperCase(), 'measured_temp')
    ) {
        void initialiseFht(obj.address);
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
