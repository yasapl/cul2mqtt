/** Fixed, read-only CUL queries exposed as Home Assistant buttons. */
export const CUL_DIAGNOSTICS = {
    version: {label: 'CUL firmware version', command: 'V', match: (line) => /^V\s/i.test(line)},
    uptime: {label: 'CUL uptime', command: 't', match: (line) => /^[0-9A-F]{8}$/i.test(line)},
    // T03 returns a single byte (remaining buffer size, hex). Short hex-only
    // replies can be misidentified by the RF parser as an FS20/AskSin packet.
    fhtbuf: {
        label: 'FHT buffer space',
        command: 'T03',
        match: (line) => /^[0-9A-F]{1,2}$/i.test(line),
        allowParsedReply: true,
    },
    cmds: {label: 'Available CUL commands', command: '?', match: (line) => /Use one of/i.test(line)},
    credit10ms: {label: 'CUL transmission credit', command: 'X', match: (line) => /^..\s*\d*$/i.test(line)},
};

const CC_REGISTERS = ['0D', '0E', '0F', '10', '1B', '1D'];
const CC_REGISTER_LINE = /^C([0-9A-F]{2})\s*=\s*([0-9A-F]{2})\b/i;

export function ccconfRegisters() {
    return [...CC_REGISTERS];
}

export function parseCcconfRegister(line) {
    const match = CC_REGISTER_LINE.exec(String(line).trim());
    return match ? {register: match[1].toUpperCase(), value: Number.parseInt(match[2], 16)} : null;
}

/** Convert raw CC1101 register values to the same concise summary FHEM's ccconf get shows. */
export function formatCcconf(registers) {
    const r = Object.fromEntries(Object.entries(registers).map(([key, value]) => [key.toUpperCase(), Number(value)]));
    if (CC_REGISTERS.some((key) => !Number.isFinite(r[key]))) {
        throw new Error('incomplete CC1101 register response');
    }
    const frequency = (26 * ((r['0D'] * 65536 + r['0E'] * 256 + r['0F']) / 65536)).toFixed(3);
    const bandwidth = Math.floor(26000 / (8 * (4 + ((r['10'] >> 4) & 3)) * (1 << ((r['10'] >> 6) & 3))));
    const amplifiers = [24, 27, 30, 33, 36, 38, 40, 42];
    const amplitude = amplifiers[r['1B'] & 7];
    const sensitivity = 4 + 4 * (r['1D'] & 3);
    return `freq:${frequency}MHz bWidth:${bandwidth}KHz rAmpl:${amplitude}dB sens:${sensitivity}dB`;
}

export function formatUptime(hex) {
    const seconds = Math.floor(Number.parseInt(hex, 16) / 125);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${days} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function formatDiagnosticResult(name, response) {
    const line = String(response).trim();
    switch (name) {
        case 'uptime':
            return formatUptime(line);
        case 'fhtbuf':
            return `${Number.parseInt(line, 16)} bytes free (0x${line.toUpperCase()})`;
        case 'cmds':
            return line.replace(/^.*?Use one of\s*/i, '').trim() || line;
        case 'credit10ms':
            return line.replace(/^..\s*/i, '').trim();
        default:
            return line;
    }
}
