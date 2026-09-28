/**
 * Process-local operational metrics exposed in Prometheus text format at
 * `/metrics`. Counters are monotonic; gauges are sampled on scrape.
 */
type Labels = Readonly<Record<string, string>>;

function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.length
    ? `{${entries.map(([key, value]) => `${key}="${value.replace(/["\\\n]/g, "_")}"`).join(",")}}`
    : "";
}

class Counter {
  readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }
  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }
}

const counters = new Map<string, Counter>();
const gauges = new Map<
  string,
  { help: string; sample: () => number | Map<string, number> }
>();

export function counter(name: string, help: string): Counter {
  let existing = counters.get(name);
  if (!existing) {
    existing = new Counter(name, help);
    counters.set(name, existing);
  }
  return existing;
}

export function gauge(
  name: string,
  help: string,
  sample: () => number | Map<string, number>,
): void {
  gauges.set(name, { help, sample });
}

export const metrics = {
  httpRequests: counter(
    "cardforge_http_requests_total",
    "HTTP requests by route class and status class",
  ),
  httpErrors: counter("cardforge_http_errors_total", "HTTP 5xx responses"),
  wsJoins: counter("cardforge_ws_joins_total", "Room joins by room kind"),
  wsDrops: counter("cardforge_ws_drops_total", "Unexpected client drops"),
  wsReconnects: counter(
    "cardforge_ws_reconnects_total",
    "Successful reconnections",
  ),
  matchesStarted: counter(
    "cardforge_matches_started_total",
    "Matches with both seats filled",
  ),
  matchesCompleted: counter(
    "cardforge_matches_completed_total",
    "Matches that reached an outcome",
  ),
  commandsRejected: counter(
    "cardforge_commands_rejected_total",
    "Rejected command intents by code",
  ),
  authEvents: counter(
    "cardforge_auth_events_total",
    "Authentication events by kind and result",
  ),
  integrityFailures: counter(
    "cardforge_integrity_failures_total",
    "Replay/settlement integrity failures",
  ),
  logErrors: counter(
    "cardforge_log_errors_total",
    "Error and critical log lines",
  ),
};

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const item of counters.values()) {
    lines.push(
      `# HELP ${item.name} ${item.help}`,
      `# TYPE ${item.name} counter`,
    );
    if (!item.values.size) lines.push(`${item.name} 0`);
    for (const [labels, value] of item.values)
      lines.push(`${item.name}${labels} ${value}`);
  }
  for (const [name, item] of gauges) {
    lines.push(`# HELP ${name} ${item.help}`, `# TYPE ${name} gauge`);
    const value = item.sample();
    if (typeof value === "number") lines.push(`${name} ${value}`);
    else
      for (const [labels, sample] of value)
        lines.push(`${name}${labels} ${sample}`);
  }
  return `${lines.join("\n")}\n`;
}

export { labelKey };
