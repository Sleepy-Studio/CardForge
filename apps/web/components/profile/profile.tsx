"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { messageFor, useApi } from "@/lib/api";
import { useRequireAccount, useSession } from "@/lib/session";
import type { Account } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { ThemeSwitcher } from "../theme-provider";
import { PageHeader, formatDate } from "../ui/bits";

interface SupportCase {
  readonly caseId: string;
  readonly status: "open" | "resolved";
  readonly summary: string;
  readonly notes: readonly string[];
  readonly createdAt: string;
}

export function Profile() {
  const account = useRequireAccount();
  const { setAccount, logout } = useSession();
  const api = useApi();
  const router = useRouter();
  const cases = useApiData<{ cases: SupportCase[] }>(
    account ? "/api/me/support-cases" : null,
  );
  const [displayName, setDisplayName] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  if (!account) return <p className="loading-line">Loading…</p>;

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await api<{ account: Account }>("/api/me", {
        method: "PATCH",
        body: { displayName },
      });
      setAccount(result.account);
      setDisplayName("");
      setStatus({ tone: "ok", text: "Display name updated." });
    } catch (caught) {
      setStatus({ tone: "error", text: messageFor(caught) });
    }
  };

  const report = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/me/support-cases", { body: { summary } });
      setSummary("");
      await cases.reload();
      setStatus({ tone: "ok", text: "Thanks — the team will look at it." });
    } catch (caught) {
      setStatus({ tone: "error", text: messageFor(caught) });
    }
  };

  return (
    <div className="profile-page">
      <PageHeader eyebrow="Profile" title={account.displayName}>
        <p className="muted">Member since {formatDate(account.createdAt)}</p>
      </PageHeader>
      {status ? (
        <p className={status.tone === "ok" ? "success" : "form-error"}>
          {status.text}
        </p>
      ) : null}
      <div className="dashboard-grid">
        <section className="panel-card">
          <h2>Display name</h2>
          <form className="form-stack" onSubmit={(event) => void rename(event)}>
            <label>
              <span>New name</span>
              <input
                maxLength={32}
                minLength={2}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={account.displayName}
                required
                value={displayName}
              />
            </label>
            <button className="button" type="submit">
              Save
            </button>
          </form>
        </section>
        <section className="panel-card">
          <h2>Appearance</h2>
          <p className="muted">
            Theme packs rename and restyle everything without changing the
            rules.
          </p>
          <ThemeSwitcher />
        </section>
        <section className="panel-card">
          <h2>Sessions</h2>
          <div className="action-row">
            <button
              className="button"
              onClick={() => void logout().then(() => router.push("/"))}
              type="button"
            >
              Sign out
            </button>
            <button
              className="button button--quiet"
              onClick={() =>
                void api("/api/auth/logout-all", { body: {} })
                  .catch(() => undefined)
                  .then(() => logout())
                  .then(() => router.push("/"))
              }
              type="button"
            >
              Sign out everywhere
            </button>
          </div>
        </section>
        <section className="panel-card panel-card--wide">
          <h2>Report a problem</h2>
          <form className="form-stack" onSubmit={(event) => void report(event)}>
            <label>
              <span>What happened?</span>
              <textarea
                maxLength={500}
                minLength={10}
                onChange={(event) => setSummary(event.target.value)}
                required
                rows={3}
                value={summary}
              />
            </label>
            <button className="button" type="submit">
              Send report
            </button>
          </form>
          <ul className="case-list">
            {(cases.data?.cases ?? []).map((item) => (
              <li key={item.caseId}>
                <span
                  className={`pill ${item.status === "resolved" ? "pill--ok" : ""}`}
                >
                  {item.status}
                </span>
                <span>{item.summary}</span>
                <small>{formatDate(item.createdAt)}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
