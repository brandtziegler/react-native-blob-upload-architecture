// src/ports/LoggerPort.ts

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface LogEvent {
  level: LogLevel;
  msg: string;
  fields?: LogFields;
  /**
   * Use for correlation across an upload run (batchId/deviceId/etc).
   * Keep it non-sensitive (no emails, no secrets).
   */
  traceId?: string;
  /**
   * Optional namespace like "upload", "blob", "api", "prep".
   */
  scope?: string;
  /**
   * Optional error payload; adapters should serialize safely.
   */
  err?: unknown;
}

export interface LoggerPort {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields & { err?: unknown }): void;

  /**
   * Create a scoped logger that auto-includes fields (like batchId, sheetId).
   * Think: logger.with({ batchId }).info("Start");
   */
  with(fields: LogFields): LoggerPort;

  /**
   * Optional structured event emit (nice for adapters that ship logs).
   * Your minimal emulation can just map this to info/error, etc.
   */
  event(e: LogEvent): void;
}

/**
 * Minimal helper: scrub obvious secrets out of strings.
 * Keep it lightweight: this repo is not a security product.
 */
export function redact(value: unknown): unknown {
  if (typeof value !== "string") return value;

  // mask SAS tokens / querystrings-ish
  const masked = value
    .replace(/(sig=)[^&]+/gi, "$1***")
    .replace(/(se=)[^&]+/gi, "$1***")
    .replace(/(sp=)[^&]+/gi, "$1***")
    .replace(/(sv=)[^&]+/gi, "$1***")
    .replace(/(token=)[^&]+/gi, "$1***")
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1***");

  return masked;
}

/**
 * Tiny “default” logger for the emulation repo.
 * Your real app adapter could use console, Sentry, AppCenter, etc.
 */
export class ConsoleLogger implements LoggerPort {
  private baseFields: LogFields;

  constructor(baseFields: LogFields = {}) {
    this.baseFields = baseFields;
  }

  with(fields: LogFields): LoggerPort {
    return new ConsoleLogger({ ...this.baseFields, ...fields });
  }

  debug(msg: string, fields?: LogFields): void {
    this.write("debug", msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.write("info", msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.write("warn", msg, fields);
  }
  error(msg: string, fields?: LogFields & { err?: unknown }): void {
    this.write("error", msg, fields, fields?.err);
  }

  event(e: LogEvent): void {
    // Route to correct level; keep it dead simple.
    const fields = { ...e.fields, traceId: e.traceId, scope: e.scope };
    if (e.level === "error") this.error(e.msg, { ...fields, err: e.err });
    else if (e.level === "warn") this.warn(e.msg, fields);
    else if (e.level === "info") this.info(e.msg, fields);
    else this.debug(e.msg, fields);
  }

  private write(level: LogLevel, msg: string, fields?: LogFields, err?: unknown): void {
    const merged: LogFields = { ...this.baseFields, ...(fields ?? {}) };

    // Light redaction pass (only strings)
    const safe: LogFields = {};
    for (const [k, v] of Object.entries(merged)) safe[k] = redact(v);

    const line = `[${level.toUpperCase()}] ${msg}`;

    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(line, safe, err ? { err: redact(String(err)) } : "");
      return;
    }
    if (level === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line, safe);
      return;
    }
    if (level === "debug") {
      // eslint-disable-next-line no-console
      console.debug(line, safe);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(line, safe);
  }
}
