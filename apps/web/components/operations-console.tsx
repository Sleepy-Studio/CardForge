"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface LiveOpsDefinition {
  readonly configId: string;
  readonly revision: number;
  readonly state: "draft" | "staged" | "published" | "deprecated";
  readonly seasonId: string;
  readonly activePatchId: string;
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly quests: readonly {
    readonly questId: string;
    readonly title: string;
    readonly cadence: string;
  }[];
  readonly events: readonly {
    readonly eventId: string;
    readonly title: string;
    readonly startsAt: string;
    readonly endsAt: string;
  }[];
}

interface SupportCase {
  readonly caseId: string;
  readonly accountId: string;
  readonly status: "open" | "resolved";
  readonly summary: string;
  readonly notes: readonly string[];
  readonly updatedAt: string;
}

interface AuditRecord {
  readonly auditId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetId: string;
  readonly createdAt: string;
}

interface OperationsPayload {
  readonly current: LiveOpsDefinition;
  readonly revisions: readonly LiveOpsDefinition[];
  readonly cases: readonly SupportCase[];
  readonly audit: readonly AuditRecord[];
}

export function OperationsConsole() {
  const endpoint =
    process.env.NEXT_PUBLIC_MATCH_SERVER_URL ?? "http://localhost:2567";
  const [token, setToken] = useState("cardforge-local-admin");
  const [actor, setActor] = useState("local-operator");
  const [payload, setPayload] = useState<OperationsPayload | null>(null);
  const [status, setStatus] = useState("Operator authentication required");
  const [draftFlags, setDraftFlags] = useState<Record<string, boolean>>({});
  const headers = useMemo(
    () => ({
      "content-type": "application/json",
      "x-cardforge-admin-token": token,
      "x-cardforge-admin-actor": actor,
    }),
    [actor, token],
  );

  const refresh = useCallback(async () => {
    setStatus("Reading immutable operations records…");
    const response = await fetch(`${endpoint}/api/admin/operations`, {
      headers,
    });
    if (!response.ok) throw new Error("Admin scope was rejected.");
    const next = (await response.json()) as OperationsPayload;
    setPayload(next);
    setDraftFlags({ ...next.current.featureFlags });
    setStatus(`Live // ${next.audit.length} audited actions`);
  }, [endpoint, headers]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem("cardforge.admin.token");
    const storedActor = window.localStorage.getItem("cardforge.admin.actor");
    if (storedToken) setToken(storedToken);
    if (storedActor) setActor(storedActor);
  }, []);

  const adminPost = async (path: string, body: Record<string, unknown>) => {
    setStatus("Committing operator action…");
    const response = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { message?: string };
    if (!response.ok)
      throw new Error(result.message ?? "Operator action rejected.");
    window.localStorage.setItem("cardforge.admin.token", token);
    window.localStorage.setItem("cardforge.admin.actor", actor);
    await refresh();
  };

  const nextRevision =
    Math.max(0, ...(payload?.revisions.map((item) => item.revision) ?? [])) + 1;
  const staged = payload?.revisions.find((item) => item.state === "staged");

  return (
    <main className="operations-shell">
      <header className="operations-header">
        <div>
          <p className="eyebrow">CARDFORGE // OPERATIONS</p>
          <h1>Control room.</h1>
          <p>{status}</p>
        </div>
        <nav>
          <a className="button button--quiet" href="/competitive">
            Competitive
          </a>
          <a className="button button--quiet" href="/academy">
            Academy
          </a>
          <button
            className="button button--primary"
            onClick={() =>
              void refresh().catch((error) =>
                setStatus(
                  error instanceof Error ? error.message : "Refresh failed.",
                ),
              )
            }
            type="button"
          >
            Authenticate
          </button>
        </nav>
      </header>

      <section className="operations-auth">
        <label>
          <span>ADMIN TOKEN</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <label>
          <span>OPERATOR ID</span>
          <input
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          />
        </label>
        <p>
          Local development uses an explicit test token. Production disables
          this API unless a server secret is configured.
        </p>
      </section>

      {payload ? (
        <div className="operations-grid">
          <section className="operations-panel operations-liveops">
            <div className="panel-heading">
              <span>LIVE-OPS MANIFEST</span>
              <small>
                {payload.current.configId}@{payload.current.revision}
              </small>
            </div>
            <dl>
              <div>
                <dt>STATE</dt>
                <dd>{payload.current.state}</dd>
              </div>
              <div>
                <dt>SEASON</dt>
                <dd>{payload.current.seasonId}</dd>
              </div>
              <div>
                <dt>PATCH</dt>
                <dd>{payload.current.activePatchId}</dd>
              </div>
            </dl>
            <div className="flag-grid">
              {Object.entries(draftFlags).map(([flag, enabled]) => (
                <label key={flag}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) =>
                      setDraftFlags((current) => ({
                        ...current,
                        [flag]: event.target.checked,
                      }))
                    }
                  />
                  <span>{flag}</span>
                </label>
              ))}
            </div>
            <div className="operator-actions">
              <button
                className="button button--primary"
                onClick={() =>
                  void adminPost("/api/admin/live-ops/stage", {
                    revision: nextRevision,
                    featureFlags: draftFlags,
                  }).catch((error) =>
                    setStatus(
                      error instanceof Error ? error.message : "Stage failed.",
                    ),
                  )
                }
                type="button"
              >
                Stage revision {nextRevision}
              </button>
              <button
                className="button button--quiet"
                disabled={!staged}
                onClick={() =>
                  staged &&
                  void adminPost("/api/admin/live-ops/publish", {
                    sourceRevision: staged.revision,
                    revision: nextRevision,
                  }).catch((error) =>
                    setStatus(
                      error instanceof Error
                        ? error.message
                        : "Publish failed.",
                    ),
                  )
                }
                type="button"
              >
                Publish staged
              </button>
            </div>
            <div className="revision-list">
              {payload.revisions.map((definition) => (
                <span key={`${definition.configId}-${definition.revision}`}>
                  R{definition.revision} // {definition.state}
                </span>
              ))}
            </div>
          </section>

          <section className="operations-panel">
            <div className="panel-heading">
              <span>QUESTS & EVENTS</span>
              <small>
                {payload.current.quests.length + payload.current.events.length}
              </small>
            </div>
            <ul className="operations-list">
              {payload.current.quests.map((quest) => (
                <li key={quest.questId}>
                  <strong>{quest.title}</strong>
                  <span>
                    {quest.cadence} // {quest.questId}
                  </span>
                </li>
              ))}
              {payload.current.events.map((event) => (
                <li key={event.eventId}>
                  <strong>{event.title}</strong>
                  <span>
                    {new Date(event.startsAt).toLocaleDateString()} →{" "}
                    {new Date(event.endsAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="operations-panel operations-support">
            <div className="panel-heading">
              <span>SUPPORT QUEUE</span>
              <small>
                {payload.cases.filter((item) => item.status === "open").length}{" "}
                open
              </small>
            </div>
            <div className="support-list">
              {payload.cases.map((supportCase) => (
                <article key={supportCase.caseId}>
                  <span>
                    {supportCase.status} // {supportCase.accountId}
                  </span>
                  <strong>{supportCase.summary}</strong>
                  <small>{supportCase.caseId}</small>
                  {supportCase.status === "open" ? (
                    <button
                      className="button button--quiet"
                      onClick={() =>
                        void adminPost(
                          `/api/admin/support-cases/${supportCase.caseId}`,
                          {
                            status: "resolved",
                            note: "Resolved through operations console.",
                          },
                        ).catch((error) =>
                          setStatus(
                            error instanceof Error
                              ? error.message
                              : "Resolution failed.",
                          ),
                        )
                      }
                      type="button"
                    >
                      Resolve + audit
                    </button>
                  ) : null}
                </article>
              ))}
              {!payload.cases.length ? (
                <p className="empty-copy">Support queue is clear.</p>
              ) : null}
            </div>
          </section>

          <section className="operations-panel operations-audit">
            <div className="panel-heading">
              <span>AUDIT TRAIL</span>
              <small>append-only</small>
            </div>
            <ol className="audit-list">
              {payload.audit.map((record) => (
                <li key={record.auditId}>
                  <strong>{record.action}</strong>
                  <span>
                    {record.actorId} → {record.targetId}
                  </span>
                  <small>{new Date(record.createdAt).toLocaleString()}</small>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </main>
  );
}
