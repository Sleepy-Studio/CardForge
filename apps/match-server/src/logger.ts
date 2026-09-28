/**
 * Minimal structured logger. Emits one JSON object per line so any log
 * collector (Coolify, Loki, Datadog, CloudWatch) can index fields without a
 * parser. Keys that may carry credentials are redacted recursively.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  critical: 50,
};

const redactedKey =
  /pass(word)?|secret|token|cookie|authorization|credential|dsn|code_verifier/i;

export type LogFields = Readonly<Record<string, unknown>>;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value instanceof Error)
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split("\n").slice(0, 8).join("\n"),
    };
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      output[key] = redactedKey.test(key)
        ? "[redacted]"
        : redact(item, depth + 1);
    return output;
  }
  return value;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /**
   * High-severity integrity failures (replay divergence, duplicate
   * settlement, migration failure). Always emitted with `alert: true`.
   */
  critical(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

type Sink = (line: string) => void;

export function createLogger(
  options: {
    readonly level?: LogLevel;
    readonly base?: LogFields;
    readonly sink?: Sink;
  } = {},
): Logger {
  const minimum = levelRank[options.level ?? "info"];
  const base = options.base ?? {};
  const sink: Sink = options.sink ?? ((line) => process.stdout.write(`${line}\n`));
  const write = (level: LogLevel, message: string, fields?: LogFields) => {
    if (levelRank[level] < minimum) return;
    const entry = redact({
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...base,
      ...fields,
      ...(level === "critical" ? { alert: true } : {}),
    });
    sink(JSON.stringify(entry));
    if (level === "error" || level === "critical")
      errorObservers.forEach((observer) => observer(level, message, fields));
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    critical: (message, fields) => write("critical", message, fields),
    child: (fields) =>
      createLogger({
        ...options,
        base: { ...base, ...fields },
      }),
  };
}

type ErrorObserver = (
  level: "error" | "critical",
  message: string,
  fields?: LogFields,
) => void;
const errorObservers: ErrorObserver[] = [];

/** Hook for metrics and optional external error monitoring. */
export function observeErrors(observer: ErrorObserver): void {
  errorObservers.push(observer);
}

function configuredLevel(): LogLevel {
  const value = process.env.CARDFORGE_LOG_LEVEL;
  return value && value in levelRank ? (value as LogLevel) : "info";
}

export const logger = createLogger({
  level: configuredLevel(),
  base: {
    service: "cardforge-match-server",
    environment: process.env.CARDFORGE_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  },
});
