#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Cul from 'cul';
import {createAdapter, createLogger, runDiscovery, autoAddress} from 'mqtt-interfaces-core';
import config from './config.js';
import pkg from './package.json' with {type: 'json'};
import {fhtClockItems, fhtMeasuredTemperature, itemsFor, mapItem} from './lib/items.js';
import {commandFor} from './lib/commands.js';
import {fhtCommand, fhtRawCommand} from './lib/fht-command.js';
import {optimisticFs20State} from './lib/fs20-state.js';
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

let fs20Devices;
try {
    fs20Devices = normaliseFs20Devices(JSON.parse(config.fs20Devices || '[]'));
} catch (err) {
    throw new Error(`invalid --fs20-devices JSON: ${err.message}`);
}
const fs20DevicesFile = config.stateDir ? path.join(config.stateDir, 'fs20-devices.json') : null;
if (fs20DevicesFile && fs.existsSync(fs20DevicesFile)) {
    try {
        fs20Devices = normaliseFs20Devices(JSON.parse(fs.readFileSync(fs20DevicesFile, 'utf8')));
    } catch {
        // Keep the app configuration definitions if an interrupted UI save left an invalid file.
    }
}
let fs20DeviceByAddress = new Map();
const fs20OnTimes = new Map();
const fs20States = new Map();
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
const fhtClockParts = new Map();

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

function saveFs20Devices() {
    if (!fs20DevicesFile) {
        return;
    }
    fs.mkdirSync(config.stateDir, {recursive: true});
    fs.writeFileSync(fs20DevicesFile, JSON.stringify(fs20Devices, null, 2));
}

function setFs20Devices(value, {persist = false} = {}) {
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
    for (const address of fs20OnTimes.keys()) {
        if (!fs20DeviceByAddress.has(address)) {
            fs20OnTimes.delete(address);
        }
    }
    for (const address of fs20States.keys()) {
        if (!fs20DeviceByAddress.has(address)) {
            fs20States.delete(address);
        }
    }
    for (const device of definitions) {
        if (!fs20OnTimes.has(device.address)) {
            fs20OnTimes.set(device.address, device.on_time);
        }
        if (!fs20States.has(device.address)) {
            fs20States.set(device.address, false);
            pubStatus(`fs20/${device.address}/state`, false, {retain: true});
        }
    }
    if (persist) {
        saveFs20Devices();
    }
    adapter.markDiscoveryDirty();
    adapter.publishDiscovery();
}

setFs20Devices(fs20Devices);

const FS20_UI = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>FS20 Devices</title><style>body{font:16px system-ui;margin:20px;max-width:680px}fieldset{margin:12px 0;padding:12px}label{display:block;margin:8px 0}input,select,button{font:inherit;padding:7px}input{width:100%;box-sizing:border-box}.row{display:flex;gap:8px}.row>*{flex:1}button{cursor:pointer}#status{min-height:24px}</style></head><body><h2>FS20 devices</h2><p>Changes are saved by this app and take effect immediately.</p><div id="devices"></div><p><button id="add" type="button">Add device</button> <button id="save" type="button">Save</button></p><div id="status"></div><script>const box=document.querySelector('#devices'),status=document.querySelector('#status');function field(label,type,value){const l=document.createElement('label'),i=document.createElement('input');l.textContent=label;i.type=type;i.value=value||'';l.append(i);return[l,i]}function row(d={type:'switch',on_time:0}){const f=document.createElement('fieldset'),r=document.createElement('div');r.className='row';const[n,name]=field('Name','text',d.name),[a,address]=field('Address (6 hex digits)','text',d.address),[t,timer]=field('Initial timer (seconds)','number',d.on_time);timer.min=0;timer.max=15360;const type=document.createElement('select');for(const v of ['switch','light']){const o=new Option(v,v,v===d.type,v===d.type);type.add(o)}const tl=document.createElement('label');tl.textContent='Type';tl.append(type);r.append(n,a,tl,t);const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>f.remove();f.append(r,remove);f.data=()=>({name:name.value.trim(),address:address.value.trim().toUpperCase(),type:type.value,on_time:Number(timer.value)||0});box.append(f)}async function load(){const r=await fetch('api/fs20');for(const d of await r.json())row(d)}async function save(){const devices=[...box.children].map(x=>x.data());const r=await fetch('api/fs20',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(devices)});const out=await r.json();status.textContent=r.ok?'Saved.':out.error||'Could not save.'}document.querySelector('#add').onclick=()=>row();document.querySelector('#save').onclick=save;load()</script></body></html>`;

function startFs20Ui() {
    http.createServer(async (request, response) => {
        if (request.method === 'GET' && (request.url === '/' || request.url === '')) {
            response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(FS20_UI);
            return;
        }
        if (request.method === 'GET' && request.url === '/api/fs20') {
            response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(fs20Devices));
            return;
        }
        if (request.method === 'POST' && request.url === '/api/fs20') {
            let body = '';
            for await (const chunk of request) {
                body += chunk;
                if (body.length > 32_768) {
                    response.writeHead(413).end();
                    return;
                }
            }
            try {
                setFs20Devices(JSON.parse(body), {persist: true});
                response.writeHead(200, {'content-type': 'application/json'}).end('{}');
            } catch (err) {
                response.writeHead(400, {'content-type': 'application/json'}).end(JSON.stringify({error: err.message}));
            }
            return;
        }
        response.writeHead(404).end();
    }).listen(8099, '0.0.0.0', () => log.info('FS20 configuration UI ready'));
}

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
                await cul.write(data);
                const field = command.cmd === 'mode' ? 'mode' : command.cmd === 'desired-temp' ? 'desired_temp' : null;
                if (field) {
                    const value =
                        field === 'mode'
                            ? String(command.value).toUpperCase() === 'AUTO'
                                ? 'AUTO'
                                : 'MANU'
                            : Number(command.value);
                    publishFhtField(command.device, field, value);
                }
                return;
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
        await cul.write(temperature);
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
    const isOn = optimisticFs20State(cmd, fs20States.get(address));
    fs20States.set(address, isOn);
    pubStatus(item, isOn, {retain: true});
    if (cmd === 'on-for-timer' && Number.isFinite(Number(time)) && Number(time) > 0) {
        fs20OffTimers.set(
            address,
            setTimeout(
                () => {
                    fs20OffTimers.delete(address);
                    fs20States.set(address, false);
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
startFs20Ui();
connect();
