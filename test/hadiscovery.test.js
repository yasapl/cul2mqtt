import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {devicePayload} from 'mqtt-interfaces-core';

import {discoveryModel, normalizedDiscoveryIds, splitItem, uidFor} from '../lib/hadiscovery.js';

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

        assert.deepEqual(ws.device, {
            name: 'ws/1',
            via_device: 'cul2mqtt_cul',
            sn: '1',
            mf: 'ELV',
            mdl: 'S300TH',
        });
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
        assert.deepEqual(doorbell.device, {
            name: 'doorbell',
            via_device: 'cul2mqtt_cul',
            sn: '6C4800',
            mf: 'ELV',
            mdl: 'FS20',
        });
        assert.equal(doorbell.components.doorbell.stat_t, 'cul/status/doorbell');
        assert.equal(doorbell.components.doorbell.dev_cla, undefined);

        assert.equal(em.device.mdl, 'EM1000');
        assert.equal(em.components.current.stat_cla, 'measurement');
    });

    test('raw command text and send button are only exposed when raw sending is enabled', () => {
        const [disabled] = discoveryModel({name: 'cul', items: new Map()});
        assert.equal(disabled.components.raw_command, undefined);
        assert.equal(disabled.components.send_raw_command, undefined);

        const [bridge] = discoveryModel({
            name: 'cul',
            items: new Map(),
            rawSet: true,
        });
        assert.equal(bridge.components.raw_command.p, 'text');
        assert.equal(bridge.components.raw_command.cmd_t, 'cul/set/raw/command');
        assert.equal(bridge.components.raw_command.stat_t, 'cul/status/raw/command');
        assert.equal(bridge.components.raw_command.val_tpl, '{{ value_json.val }}');
        assert.equal(bridge.components.raw_command.max, 128);
        assert.equal(bridge.components.send_raw_command.p, 'button');
        assert.equal(bridge.components.send_raw_command.cmd_t, 'cul/set/raw/send');
        assert.equal(bridge.components.send_raw_command.pl_prs, 'PRESS');
    });

    test('mapped device names keep the protocol from the raw item', () => {
        const items = new Map([['living_room/temperature', {val: 20, retain: true, raw: 'hms/A5E3/temperature'}]]);
        const [, dev] = discoveryModel({name: 'cul', items});
        assert.equal(dev.id, 'cul2mqtt_cul_living_room');
        assert.equal(dev.device.name, 'living_room');
        assert.equal(dev.device.mdl, 'HMS');
        assert.equal(dev.components.temperature.uniq_id, 'cul2mqtt_cul_living_room_temperature');
    });

    test('unmapped HMS device names and IDs preserve the RF address spelling', () => {
        const items = new Map([['hms/B24E/temperature', {val: 17.6, raw: 'hms/B24E/temperature'}]]);
        const [, device] = discoveryModel({name: 'MAX_CUL', items});
        assert.equal(device.id, 'cul2mqtt_MAX_CUL_hms_B24E');
        assert.equal(device.device.name, 'hms/B24E');
        assert.equal(device.device.sn, 'B24E');
        assert.equal(device.components.temperature.uniq_id, 'cul2mqtt_MAX_CUL_hms_B24E_temperature');
    });

    test('unknown protocols get the protocol as model, plain payloads no value template', () => {
        const items = new Map([['foo/1/x', {val: 1, retain: true, raw: 'foo/1/x'}]]);
        const [, dev] = discoveryModel({name: 'cul', items, jsonPayloads: false});
        assert.deepEqual(dev.device, {
            name: 'foo/1',
            via_device: 'cul2mqtt_cul',
            sn: '1',
            mdl: 'FOO',
        });
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
        const [, plain] = discoveryModel({
            name: 'cul',
            items,
            jsonPayloads: false,
        });
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
        assert.equal(climate.initial, 16);
        assert.equal(climate.min_temp, 10);
        assert.equal(climate.max_temp, 30);
        assert.equal(climate.precision, 0.5);
        assert.equal(climate.temp_unit, 'C');
        assert.equal(dev.components.measured_temp.dev_cla, 'temperature');
        assert.equal(dev.components.measured_temp.unit_of_meas, '°C');
        assert.equal(dev.device.sn, '4d3f');
        assert.equal(dev.device.mf, 'eQ-3');
        assert.equal(climate.act_tpl, "{{ 'heating' if value_json.val | float(0) > 10 else 'idle' }}");
        assert.equal(dev.components.sync_time.p, 'button');
        assert.equal(dev.components.sync_time.cmd_t, 'cul/set/fht/4d3f/sync-time');
    });
    test('FHT discovery uses an app-scoped identifier separate from a bare house code', () => {
        const items = new Map([['fht/423c/measured_temp', {val: 21, retain: true, raw: 'fht/423c/measured_temp'}]]);
        const [, fht] = discoveryModel({name: 'MAX_CUL', items});
        assert.equal(fht.id, 'cul2mqtt_MAX_CUL_fht_423c_v2');
        assert.deepEqual(fht.legacyDiscoveryIds, ['cul2mqtt_MAX_CUL_fht_423c']);
        assert.deepEqual(fht.device.ids, ['cul2mqtt_MAX_CUL_fht_423c']);
        assert.equal(fht.device.sn, '423c');
        assert.equal(fht.components.measured_temp.uniq_id, 'cul2mqtt_MAX_CUL_fht_423c_v2_measured_temp');
        const {payload} = devicePayload({
            pkg: {name: 'cul2mqtt', version: '1.2.1'},
            name: 'MAX_CUL',
            id: fht.id,
            device: fht.device,
            components: fht.components,
        });
        assert.deepEqual(payload.dev.ids, ['cul2mqtt_MAX_CUL_fht_423c']);
    });

    test('mixed-case RF addresses merge while preserving the first discovery spelling', () => {
        const items = new Map([
            ['fht/423C/measured_temp', {val: 20.5, retain: true, raw: 'fht/423C/measured_temp'}],
            ['fht/423c/desired_temp', {val: 21, retain: true, raw: 'fht/423c/desired_temp'}],
            ['fht/423C/mode', {val: 'AUTO', retain: true, raw: 'fht/423C/mode'}],
        ]);
        const devices = discoveryModel({name: 'CUL', items});
        assert.equal(devices.length, 2);
        const fht = devices[1];
        assert.equal(fht.id, 'cul2mqtt_CUL_fht_423C_v2');
        assert.equal(fht.device.name, 'fht/423C');
        assert.deepEqual(fht.device.ids, ['cul2mqtt_CUL_fht_423C']);
        assert.deepEqual(fht.legacyDiscoveryIds, ['cul2mqtt_CUL_fht_423C']);
        assert.equal(fht.components.climate.curr_temp_t, 'CUL/status/fht/423C/measured_temp');
        assert.equal(fht.components.climate.temp_stat_t, 'CUL/status/fht/423c/desired_temp');
        assert.equal(fht.components.climate.mode_stat_t, 'CUL/status/fht/423C/mode');
    });

    test('normalized discovery IDs can be cleared after restoring registry-compatible IDs', () => {
        const ids = normalizedDiscoveryIds({
            name: 'MAX_CUL',
            items: new Map([
                ['fht/423C/measured_temp', {val: 20, raw: 'fht/423C/measured_temp'}],
                ['fht/423c/desired_temp', {val: 21, raw: 'fht/423c/desired_temp'}],
            ]),
            fs20Devices: [{name: 'pump', address: '6C4801'}],
        });
        assert.deepEqual(ids, ['cul2mqtt_max_cul', 'cul2mqtt_max_cul_fht_423c', 'cul2mqtt_max_cul_fs20_6c4801']);
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
        assert.equal(light.device.sn, '6C4800');
        assert.equal(light.components.control.p, 'light');
        assert.equal(light.components.control.cmd_t, 'cul/set/fs20/6C4800');
        assert.equal(light.components.control.bri_cmd_t, 'cul/set/fs20/6C4800');
        assert.equal(light.components.control.bri_scl, 100);
        assert.equal(light.components.control.stat_t, 'cul/status/fs20/6C4800/state');
        assert.equal(light.components.control.opt, false);
        assert.equal(light.components.control.val_tpl, "{{ 'ON' if value_json.val else 'OFF' }}");
        assert.equal(light.components.timer_remaining.p, 'sensor');
        assert.equal(light.components.timer_remaining.name, 'Timer remaining');
        assert.equal(light.components.timer_remaining.stat_t, 'cul/status/fs20/6C4800/timer_remaining');
        assert.equal(light.components.timer_remaining.dev_cla, 'duration');
        assert.equal(light.components.timer_remaining.unit_of_meas, 's');
        assert.equal(light.components.timer_remaining.stat_cla, 'measurement');
        assert.equal(light.components.timer_remaining.val_tpl, '{{ value_json.val }}');
        assert.equal(light.components.on_time.uniq_id, 'cul2mqtt_cul_fs20_6C4800_on_time');
        assert.equal('timer_1_duration' in light.components, false);
        for (let slot = 1; slot <= 5; slot += 1) {
            const field = slot === 1 ? 'on_time' : `timer_${slot}`;
            const componentId = slot === 1 ? 'on_time' : `timer_${slot}_duration`;
            const timer = light.components[componentId];
            assert.equal(timer.p, 'number');
            assert.equal(timer.opt, false);
            assert.equal(timer.val_tpl, '{{ value_json.val }}');
            assert.equal(timer.cmd_t, `cul/set/fs20/6C4800/${field}`);
            assert.equal(timer.min, 0);
            assert.equal(timer.max, 15_360);
            assert.equal(timer.step, 0.25);
            assert.equal(timer.unit_of_meas, 's');

            const button = light.components[`timer_${slot}_button`];
            assert.equal(button.p, 'button');
            assert.equal(button.cmd_t, `cul/set/fs20/6C4800/on-for-timer/${slot}`);
            assert.equal(button.pl_prs, 'PRESS');
        }
        assert.equal(sw.components.control.p, 'switch');
        assert.equal(sw.device.sn, '6C4801');
        assert.equal(sw.components.control.cmd_t, 'cul/set/fs20/6C4801');
        assert.equal(sw.components.control.opt, false);
        assert.equal(sw.components.control.val_tpl, "{{ 'ON' if value_json.val else 'OFF' }}");
        const [, plainSwitch] = discoveryModel({
            name: 'cul',
            items: new Map(),
            jsonPayloads: false,
            fs20Devices: [{name: 'Pump', address: '6C4801', type: 'switch'}],
        });
        assert.equal(plainSwitch.components.control.val_tpl, "{{ 'ON' if value == 'true' else 'OFF' }}");
    });

    test('configured physical FHT8V valves expose position control and explicit pairing', () => {
        const [, valve] = discoveryModel({
            name: 'cul',
            items: new Map(),
            fht8vDevices: [{name: 'Living Room Valve', address: '4341'}],
        });
        assert.equal(valve.id, 'cul2mqtt_cul_fht8v_4341');
        assert.equal(valve.device.name, 'Living Room Valve');
        assert.equal(valve.device.mdl, 'FHT8V');
        assert.equal(valve.device.sn, '4341');
        assert.equal(valve.components.valve_position.p, 'number');
        assert.equal(valve.components.valve_position.p.mode, 'box');
        assert.equal(valve.components.valve_position.cmd_t, 'cul/set/fht8v/4341/valve-position');
        assert.equal(valve.components.valve_position.stat_t, 'cul/status/fht8v/4341/valve_position');
        assert.equal(valve.components.valve_position.max, 100);
        assert.equal(valve.components.valve_position.step, 1);
        assert.equal(valve.components.pair.p, 'button');
        assert.equal(valve.components.pair.cmd_t, 'cul/set/fht8v/4341/pair');
        assert.equal(valve.components.pair.pl_prs, 'PRESS');
    });

    test('virtual FHT8W announces request position, transmitted position, and timed request button', () => {
        const [, relay] = discoveryModel({name: 'cul', items: new Map(), fht8wAddress: '4341'});
        assert.equal(relay.id, 'cul2mqtt_cul_fht8w_4341');
        assert.equal(relay.device.name, 'Virtual FHT8W');
        assert.equal(relay.device.mdl, 'FHT8W (emulated)');
        assert.equal(relay.components.valve_position.p, 'number');
        assert.equal(relay.components.valve_position.p.mode, 'box');
        assert.equal(relay.components.valve_position.cmd_t, 'cul/set/fht8w/4341/valve-position');
        assert.equal(relay.components.active_position.p, 'sensor');
        assert.equal(relay.components.active_position.stat_t, 'cul/status/fht8w/4341/active_position');
        assert.equal(relay.components.report.p, 'button');
        assert.equal(relay.components.report.cmd_t, 'cul/set/fht8w/4341/report');
        assert.equal(relay.components.report.pl_prs, 'PRESS');
        assert.equal(relay.components.report.name, 'Request heat (130 s)');
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
            {
                t: 'cul/connected',
                val_tpl: "{{ 'online' if (value | int(0)) >= 2 else 'offline' }}",
            },
            {
                t: 'cul/status/ws/1/online',
                val_tpl: "{{ 'online' if value_json.val else 'offline' }}",
            },
        ]);
        // a device seen only through its online item still gets a (component-less) block
        assert.equal(em.device.name, 'em/0205');
        assert.deepEqual(em.components, {});
        const [, plain] = discoveryModel({
            name: 'cul',
            items,
            jsonPayloads: false,
        });
        assert.equal(plain.availability[1].avty_tpl, undefined);
        assert.equal(plain.availability[1].val_tpl, "{{ 'online' if value == '1' else 'offline' }}");
    });

    test('splitItem / uidFor', () => {
        assert.deepEqual(splitItem('a/b/c'), {device: 'a/b', field: 'c'});
        assert.deepEqual(splitItem('doorbell'), {
            device: 'doorbell',
            field: 'doorbell',
        });
        assert.equal(uidFor('Leistung Spülmaschine/current'), 'Leistung_Sp_lmaschine_current');
    });
});
