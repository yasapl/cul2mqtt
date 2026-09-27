import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {discoveryModel, splitItem, uidFor} from '../lib/hadiscovery.js';

describe('discoveryModel', () => {
    test('bridge device plus one device per RF address with a sensor per scalar field', () => {
        const items = new Map([
            ['ws/1/temperature', {val: 24.5, retain: true, raw: 'ws/1/temperature', device: 'S300TH'}],
            ['ws/1/humidity', {val: 58.5, retain: true, raw: 'ws/1/humidity', device: 'S300TH'}],
            ['ws/1/rssi', {val: -28, retain: true, raw: 'ws/1/rssi', device: 'S300TH'}],
            ['doorbell', {val: 'on', retain: false, raw: 'fs20/6C4800'}],
            ['em/0205/current', {val: 1, retain: true, raw: 'em/0205/current'}],
            ['x/list', {val: [1], retain: true, raw: 'x/list'}],
        ]);
        const devices = discoveryModel({name: 'cul', items});
        assert.deepEqual(
            devices.map((d) => d.id),
            ['cul2mqtt_cul', 'cul2mqtt_cul_ws_1', 'cul2mqtt_cul_doorbell', 'cul2mqtt_cul_em_0205'],
        );

        const [bridge, ws, doorbell, em] = devices;
        assert.deepEqual(bridge.device, {mf: 'Busware', mdl: 'CUL'});
        assert.equal(bridge.availabilityMin, 1);
        assert.equal(bridge.components.connected.p, 'binary_sensor');
        assert.equal(bridge.components.connected.stat_t, 'cul/connected');
        assert.equal(bridge.components.connected.dev_cla, 'connectivity');

        assert.deepEqual(ws.device, {name: 'ws/1', via_device: 'cul2mqtt_cul', mf: 'ELV', mdl: 'S300TH'});
        assert.deepEqual(Object.keys(ws.components), ['temperature', 'humidity', 'rssi']);
        const t = ws.components.temperature;
        assert.equal(t.p, 'sensor');
        assert.equal(t.name, 'temperature');
        assert.equal(t.stat_t, 'cul/status/ws/1/temperature');
        assert.equal(t.val_tpl, '{{ value_json.val }}');
        assert.equal(t.dev_cla, 'temperature');
        assert.equal(t.unit_of_meas, '°C');
        assert.equal(t.uniq_id, 'cul2mqtt_cul_ws_1_temperature');
        assert.equal(ws.components.rssi.ent_cat, 'diagnostic');

        // fully mapped single-segment item: device and field are the item itself
        assert.deepEqual(doorbell.device, {name: 'doorbell', via_device: 'cul2mqtt_cul', mf: 'ELV', mdl: 'FS20'});
        assert.equal(doorbell.components.doorbell.stat_t, 'cul/status/doorbell');
        assert.equal(doorbell.components.doorbell.dev_cla, undefined);

        assert.equal(em.device.mdl, 'EM1000');
        assert.equal(em.components.current.stat_cla, 'measurement');
    });

    test('mapped device names keep the protocol from the raw item', () => {
        const items = new Map([['living_room/temperature', {val: 20, retain: true, raw: 'hms/A5E3/temperature'}]]);
        const [, dev] = discoveryModel({name: 'cul', items});
        assert.equal(dev.id, 'cul2mqtt_cul_living_room');
        assert.equal(dev.device.name, 'living_room');
        assert.equal(dev.device.mdl, 'HMS');
        assert.equal(dev.components.temperature.uniq_id, 'cul2mqtt_cul_living_room_temperature');
    });

    test('unknown protocols get the protocol as model, plain payloads no value template', () => {
        const items = new Map([['foo/1/x', {val: 1, retain: true, raw: 'foo/1/x'}]]);
        const [, dev] = discoveryModel({name: 'cul', items, jsonPayloads: false});
        assert.deepEqual(dev.device, {name: 'foo/1', via_device: 'cul2mqtt_cul', mdl: 'FOO'});
        assert.equal(dev.components.x.val_tpl, undefined);
    });

    test('booleans become binary sensors', () => {
        const items = new Map([
            ['fhttk/123456/open', {val: false, retain: true, raw: 'fhttk/123456/open'}],
            ['fhttk/123456/battery_low', {val: false, retain: true, raw: 'fhttk/123456/battery_low'}],
        ]);
        const [, dev] = discoveryModel({name: 'cul', items});
        assert.equal(dev.components.open.p, 'binary_sensor');
        assert.equal(dev.components.open.dev_cla, 'opening');
        assert.equal(dev.components.open.val_tpl, "{{ 'ON' if value_json.val else 'OFF' }}");
        assert.equal(dev.components.battery_low.dev_cla, 'battery');
        assert.equal(dev.components.battery_low.ent_cat, 'diagnostic');
        const [, plain] = discoveryModel({name: 'cul', items, jsonPayloads: false});
        assert.equal(plain.components.open.val_tpl, "{{ 'ON' if value == 'true' else 'OFF' }}");
    });

    test('FHT80b announces a native climate entity using the raw hexadecimal address for commands', () => {
        const items = new Map([
            ['living_room/measured_temp', {val: 20.5, retain: true, raw: 'fht/4d3f/measured_temp'}],
            ['living_room/desired_temp', {val: 21, retain: true, raw: 'fht/4d3f/desired_temp'}],
            ['living_room/mode', {val: 'AUTO', retain: true, raw: 'fht/4d3f/mode'}],
            ['living_room/actuator', {val: 25, retain: true, raw: 'fht/4d3f/actuator'}],
        ]);
        const [, dev] = discoveryModel({name: 'cul', items});
        const climate = dev.components.climate;
        assert.equal(climate.p, 'climate');
        assert.equal(climate.curr_temp_t, 'cul/status/living_room/measured_temp');
        assert.equal(climate.temp_cmd_t, 'cul/set/fht/4d3f/desired-temp');
        assert.equal(climate.mode_cmd_t, 'cul/set/fht/4d3f/mode');
        assert.deepEqual(climate.modes, ['auto', 'heat']);
        assert.equal(climate.act_tpl, "{{ 'heating' if value_json.val | float(0) > 10 else 'idle' }}");
    });

    test('explicit FS20 actuators announce stateful switch and light entities', () => {
        const [bridge, light, sw] = discoveryModel({
            name: 'cul',
            items: new Map(),
            fs20Devices: [
                {name: 'Hall light', address: '6c4800', type: 'light'},
                {name: 'Pump', address: '6C4801', type: 'switch'},
            ],
        });
        assert.equal(bridge.id, 'cul2mqtt_cul');
        assert.equal(light.device.name, 'Hall light');
        assert.equal(light.components.control.p, 'light');
        assert.equal(light.components.control.cmd_t, 'cul/set/fs20/6C4800');
        assert.equal(light.components.control.bri_cmd_t, 'cul/set/fs20/6C4800');
        assert.equal(light.components.control.bri_scl, 100);
        assert.equal(light.components.control.stat_t, 'cul/status/fs20/6C4800/state');
        assert.equal(light.components.control.opt, undefined);
        assert.equal(sw.components.control.p, 'switch');
        assert.equal(sw.components.control.cmd_t, 'cul/set/fs20/6C4801');
    });

    test('online items become per-device availability, not sensors', () => {
        const items = new Map([
            ['ws/1/temperature', {val: 24.5, retain: true, raw: 'ws/1/temperature'}],
            ['ws/1/online', {val: 1, retain: true, raw: 'ws/1/online'}],
            ['em/0205/online', {val: 0, retain: true, raw: 'em/0205/online'}],
        ]);
        const [, ws, em] = discoveryModel({name: 'cul', items});
        assert.deepEqual(Object.keys(ws.components), ['temperature']);
        assert.deepEqual(ws.availability, [
            {t: 'cul/connected', val_tpl: "{{ 'online' if (value | int(0)) >= 2 else 'offline' }}"},
            {t: 'cul/status/ws/1/online', val_tpl: "{{ 'online' if value_json.val else 'offline' }}"},
        ]);
        // a device seen only through its online item still gets a (component-less) block
        assert.equal(em.device.name, 'em/0205');
        assert.deepEqual(em.components, {});
        const [, plain] = discoveryModel({name: 'cul', items, jsonPayloads: false});
        assert.equal(plain.availability[1].avty_tpl, undefined);
        assert.equal(plain.availability[1].val_tpl, "{{ 'online' if value == '1' else 'offline' }}");
    });

    test('splitItem / uidFor', () => {
        assert.deepEqual(splitItem('a/b/c'), {device: 'a/b', field: 'c'});
        assert.deepEqual(splitItem('doorbell'), {device: 'doorbell', field: 'doorbell'});
        assert.equal(uidFor('Leistung Spülmaschine/current'), 'Leistung_Sp_lmaschine_current');
    });
});
