import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CommunicationTracker, communicationTopic} from '../lib/communication.js';
import {discoveryModel} from '../lib/hadiscovery.js';

test('received values establish a baseline and only changes generate activity', () => {
    const tracker = new CommunicationTracker();
    assert.equal(tracker.record('received', 'fht/423C/actuator', 0), null);
    assert.equal(tracker.record('received', 'fht/423c/actuator', 0), null);
    const event = tracker.record('received', 'fht/423c/actuator', 20);
    assert.equal(event.event_type, 'received');
    assert.equal(event.previous_value, 0);
    assert.equal(event.value, 20);
    assert.equal(tracker.record('received', 'fht/423c/actuator', 20), null);
});

test('sent and received values are independent, including first confirmation', () => {
    const tracker = new CommunicationTracker();
    assert.equal(tracker.record('sent', 'fht/423c/desired_temp', 21).delivery, 'written_to_cul');
    assert.equal(tracker.record('sent', 'fht/423c/desired_temp', 21), null);
    assert.equal(tracker.record('received', 'fht/423c/desired_temp', 21).event_type, 'received');
    assert.equal(tracker.record('received', 'fht/423c/desired_temp', 21), null);
});

test('restored baselines suppress repeats and preserve actual changes after restart', () => {
    const tracker = new CommunicationTracker();
    tracker.record('received', 'fht/423c/desired_temp', 20);
    const restored = new CommunicationTracker(JSON.parse(JSON.stringify(tracker.state())));
    assert.equal(restored.record('received', 'fht/423c/desired_temp', 20), null);
    assert.equal(restored.record('received', 'fht/423c/desired_temp', 21).previous_value, 20);
});

test('clock, availability and signal reports stay quiet; explicit actions can repeat', () => {
    const tracker = new CommunicationTracker();
    for (const field of ['rssi', 'online', 'time', 'date', 'hour', 'measured_low']) {
        assert.equal(tracker.record('received', `fht/423c/${field}`, 1), null);
        assert.equal(tracker.record('received', `fht/423c/${field}`, 2), null);
    }
    assert.equal(tracker.record('sent', 'raw/command', 'T03'), null);
    for (let i = 0; i < 2; i++) {
        assert.equal(tracker.record('sent', 'fht/423c/sync_time', 'now', {repeat: true}).event_type, 'sent');
    }
});

test('communication discovery follows the raw address even with mapped state topics', () => {
    const devices = discoveryModel({
        name: 'cul',
        items: new Map([['living_room/temperature', {val: 20, raw: 'fht/423C/measured_temp'}]]),
        fs20Devices: [{name: 'Socket', address: '611400'}],
        fht8vDevices: [{name: 'Valve', address: '4341'}],
        fht8wAddress: 'CCBB',
    });
    for (const dev of devices.slice(1)) {
        assert.equal(dev.components.communication.p, 'event');
        assert.deepEqual(dev.components.communication.event_types, ['sent', 'received']);
        assert.equal(dev.components.communication.ent_cat, undefined);
    }
    assert.equal(devices[1].components.communication.stat_t, `cul/${communicationTopic('fht/423C/measured_temp')}`);
    assert.equal(devices[2].components.communication.stat_t, 'cul/communication/fs20/611400');
    assert.equal(devices[3].components.communication.stat_t, 'cul/communication/fht8v/4341');
    assert.equal(devices[4].components.communication.stat_t, 'cul/communication/fht8w/ccbb');
});
