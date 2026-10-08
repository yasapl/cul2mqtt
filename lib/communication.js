/** Device activity is a change stream, separate from retained current state. */
const QUIET_FIELDS = new Set([
    'rssi',
    'online',
    'measured_low',
    'measured_high',
    'hour',
    'minute',
    'day',
    'month',
    'year',
    'time',
    'date',
]);

export function communicationTopic(item) {
    const [protocol, address] = item.split('/');
    return `communication/${protocol.toLowerCase()}/${address.toLowerCase()}`;
}

export class CommunicationTracker {
    constructor(state = []) {
        this.values = new Map(state);
    }

    state() {
        return [...this.values];
    }

    record(direction, item, value, {repeat = false, detail} = {}) {
        const [protocol, address, ...fields] = item.toLowerCase().split('/');
        const field = fields.join('/') || 'command';
        if (!address || QUIET_FIELDS.has(field) || protocol === 'raw') return null;
        const key = `${direction}/${protocol}/${address}/${field}`;
        const known = this.values.has(key);
        const previous = this.values.get(key);
        this.values.set(key, value);
        // The first report establishes a baseline, not a change. Persisted baselines let
        // a real change after an app restart be reported, without replaying old activity.
        if (
            !repeat &&
            (Object.is(previous, value) ||
                (direction === 'received' && !known && !this.values.has(`sent/${protocol}/${address}/${field}`)))
        )
            return null;
        return {
            event_type: direction,
            protocol,
            address,
            field,
            value,
            ...(known && {previous_value: previous}),
            ...(detail && {detail}),
            ...(direction === 'sent' && {delivery: 'written_to_cul'}),
            occurred_at: new Date().toISOString(),
        };
    }
}
