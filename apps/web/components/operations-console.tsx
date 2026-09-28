"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, messageFor, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { TelemetryDashboard } from "./ops/telemetry-dashboard";

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
  readonly warnings?: readonly string[];
}

export function OperationsConsole() {
  const api = useApi();
  const { account } = useSession();
  const [payload, setPayload] = useState<OperationsPayload | null>(null);
  const [status, setStatus] = useState("Loading operations…");
  const [draftFlags, setDraftFlags] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const next = await api<OperationsPayload>("/api/admin/operations");
      setPayload(next);
      setDraftFlags({ ...next.current.featureFlags });
      setStatus(
        next.warnings?.length
          ? `Warnings: ${next.warnings.join("; ")}`
          : `Live · ${next.audit.length} audited actions`,
      );
    } catch (error) {
      setPayload(null);
      setStatus(
        error instanceof ApiError && error.status === 401
          ? "Sign in with an operator account to continue."
          : error instanceof ApiError && error.status === 403
            ? "This account is not an operator. Ask an admin to add your email to CARDFORGE_ADMIN_EMAILS."
            : messageFor(error),
      );
    }
  }, [api]);

  useEffect(() => {
    if (account !== undefined) void refresh();
  }, [account, refresh]);

  const adminPost = async (path: string, body: Record<string, unknown>) => {
    setStatus("Committing operator action…");
    await api(path, { body });
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
          <Link className="button button--quiet" href="/">
            Player app
          </Link>
          {account === null ? (
            <Link
              className="button button--quiet"
              href="/login?next=/operations"
            >
              Sign in
            </Link>
          ) : null}
          <button
            className="button button--primary"
            onClick={() => void refresh()}
            type="button"
          >
            Refresh
          </button>
        </nav>
      </header>

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
                          `/api/admin/support-cases/${encodeURIComponent(supportCase.caseId)}`,
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
      {payload ? <AccountSupport /> : null}
      {payload ? <TelemetryDashboard /> : null}
    </main>
  );
}

/** Look up an account and issue a one-time claim or password-reset code. */
function AccountSupport() {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<{
    accountId: string;
    displayName: string;
    createdAt: string;
  } | null>(null);
  const [code, setCode] = useState<{
    claimCode: string;
    expiresAt: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const lookup = async () => {
    setCode(null);
    setStatus(null);
    try {
      const result = await api<{
        account: { accountId: string; displayName: string; createdAt: string };
      }>(`/api/admin/accounts?q=${encodeURIComponent(query.trim())}`);
      setAccount(result.account);
    } catch (error) {
      setAccount(null);
      setStatus(messageFor(error));
    }
  };
  const issue = async () => {
    if (!account) return;
    try {
      setCode(
        await api<{ claimCode: string; expiresAt: string }>(
          `/api/admin/accounts/${encodeURIComponent(account.accountId)}/claim-code`,
          { body: {} },
        ),
      );
    } catch (error) {
      setStatus(messageFor(error));
    }
  };
  return (
    <section className="operations-panel account-support">
      <div className="panel-heading">
        <span>ACCOUNT SUPPORT</span>
        <small>audited</small>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup();
        }}
      >
        <input
          aria-label="Email or account ID"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Email or account ID"
          value={query}
        />
        <button className="button button--quiet" type="submit">
          Look up
        </button>
      </form>
      {status ? <p className="form-error">{status}</p> : null}
      {account ? (
        <div className="account-support__result">
          <p>
            <strong>{account.displayName}</strong> · {account.accountId} · since{" "}
            {new Date(account.createdAt).toLocaleDateString()}
          </p>
          <button className="button" onClick={() => void issue()} type="button">
            Issue reset / claim code
          </button>
          {code ? (
            <p className="success">
              Give the player this one-time code (shown once, expires{" "}
              {new Date(code.expiresAt).toLocaleDateString()}):{" "}
              <code>{code.claimCode}</code>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
