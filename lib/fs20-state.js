/** Predict the resulting state for a successfully transmitted FS20 command. */
export function optimisticFs20State(command, currentState = false) {
    const normalized = String(command).toLowerCase();
    if (normalized === 'toggle') {
        return !currentState;
    }
    return !['off', 'reset'].includes(normalized);
}
