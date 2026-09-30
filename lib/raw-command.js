/** Validate a raw CUL command entered through the Home Assistant text entity. */
export function rawCommandText(value) {
    if (typeof value !== 'string') {
        throw new Error('payload must be a single CUL command string');
    }
    const command = value.trim();
    if (command.length > 128 || /[\r\n]/.test(command)) {
        throw new Error('expected one command of at most 128 characters');
    }
    return command;
}
