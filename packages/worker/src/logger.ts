// Structured logging with an allowlist: only ids, codes and counters can be logged, never message bodies,
// names, emails, phone numbers, tokens or secrets (rules 19-20). Unknown fields are dropped, strings capped.

export const LOG_FIELDS = [
  'correlationId',
  'tenantId',
  'invoiceId',
  'msgId',
  'messageId',
  'stepId',
  'channel',
  'outcome',
  'reason',
  'attempt',
  'count',
  'durationMs',
  'gate',
  'status',
] as const;
export type LogField = (typeof LOG_FIELDS)[number];
export type LogFields = Partial<Record<LogField, string | number | boolean | null>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Reason strings must be codes; anything that looks like an address or a long free text is cut. */
function clean(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  const v = value.replace(/[^\w.:\-/ ]/g, '_').slice(0, 80);
  return /@|\+\d{6,}/.test(value) ? '[redacted]' : v;
}

export function createJsonLogger(write: (line: string) => void, nowIso: () => string): Logger {
  const emit = (level: string, event: string, fields: LogFields = {}) => {
    const out: Record<string, unknown> = { level, event: event.replace(/[^\w.]/g, '_'), at: nowIso() };
    for (const k of LOG_FIELDS) if (fields[k] !== undefined) out[k] = clean(fields[k] ?? null);
    write(JSON.stringify(out));
  };
  return {
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
  };
}
