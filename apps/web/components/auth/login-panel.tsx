"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { messageFor, useApi } from "@/lib/api";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { useSession } from "@/lib/session";
import { useHydrated } from "@/lib/use-hydrated";
import type { Account } from "@/lib/types";

const oauthErrors: Record<string, string> = {
  signup_code_required:
    "CardForge is in closed alpha. Register with your invite code first, or ask for one.",
  oauth_state_mismatch: "That sign-in attempt expired. Please try again.",
  oauth_exchange_failed:
    "Discord did not confirm the sign-in. Please try again.",
  oauth_profile_failed:
    "We could not read your Discord profile. Please try again.",
  oauth_unavailable:
    "Discord is unreachable right now. Try again or use email.",
  account_unavailable: "This account cannot sign in right now.",
  provider_disabled: "Discord sign-in is not enabled on this server.",
};

/** Same-origin paths only; mirrors the server's `safeNextPath`. */
function safeNext(value: string | null): string {
  if (!value || value.length > 200) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/";
  return /^\/[a-zA-Z0-9/_\-?=&.%]*$/.test(value) ? value : "/";
}

export function LoginPanel() {
  const api = useApi();
  const { apiUrl } = useRuntimeConfig();
  const { account, setAccount } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"signin" | "register">(
    params.get("mode") === "register" ? "register" : "signin",
  );
  const [providers, setProviders] = useState<{
    discord: boolean;
    signupMode: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(
    oauthErrors[params.get("error") ?? ""] ?? null,
  );
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  const [form, setForm] = useState({
    email: "",
    password: "",
    displayName: "",
    signupCode: params.get("code") ?? "",
    claimCode: "",
  });

  useEffect(() => {
    void api<{ discord: boolean; signupMode: string }>("/api/auth/providers")
      .then(setProviders)
      .catch(() => setProviders({ discord: false, signupMode: "open" }));
  }, [api]);

  useEffect(() => {
    if (account)
      router.replace(account.onboarding.starterLeaderId ? next : "/onboarding");
  }, [account, next, router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "signin"
          ? { email: form.email, password: form.password }
          : {
              email: form.email,
              password: form.password,
              displayName: form.displayName,
              ...(form.signupCode.trim()
                ? { signupCode: form.signupCode.trim() }
                : {}),
              ...(form.claimCode.trim()
                ? { claimCode: form.claimCode.trim() }
                : {}),
            };
      const result = await api<{ account: Account }>(
        mode === "signin" ? "/api/auth/login" : "/api/auth/register",
        { body },
      );
      setAccount(result.account);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: event.target.value }),
  });

  const discordHref = `${apiUrl}/api/auth/discord/start?next=${encodeURIComponent(next)}${
    form.signupCode.trim()
      ? `&signupCode=${encodeURIComponent(form.signupCode.trim())}`
      : ""
  }`;

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <p className="eyebrow">Closed alpha</p>
      <h1 id="auth-title">
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="muted">
        A tactical card game of shared time, contested fronts, and decisive
        reactions.
      </p>
      <div
        className="segmented"
        role="tablist"
        aria-label="Sign in or register"
      >
        <button
          aria-selected={mode === "signin"}
          onClick={() => setMode("signin")}
          role="tab"
          type="button"
        >
          Sign in
        </button>
        <button
          aria-selected={mode === "register"}
          onClick={() => setMode("register")}
          role="tab"
          type="button"
        >
          Register
        </button>
      </div>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        {mode === "register" ? (
          <label>
            <span>Display name</span>
            <input
              autoComplete="nickname"
              maxLength={32}
              minLength={2}
              required
              {...field("displayName")}
            />
          </label>
        ) : null}
        <label>
          <span>Email</span>
          <input
            autoComplete="email"
            inputMode="email"
            required
            type="email"
            {...field("email")}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            minLength={mode === "register" ? 10 : 1}
            required
            type="password"
            {...field("password")}
          />
          {mode === "register" ? <small>At least 10 characters.</small> : null}
        </label>
        {mode === "register" && providers?.signupMode === "invite" ? (
          <label>
            <span>Invite code</span>
            <input
              autoComplete="off"
              name="signupCode"
              {...field("signupCode")}
            />
          </label>
        ) : null}
        {mode === "register" ? (
          <details className="quiet-details">
            <summary>I have an account claim code</summary>
            <label>
              <span>Claim code</span>
              <input autoComplete="off" {...field("claimCode")} />
              <small>
                From support, to attach a sign-in to an existing alpha account.
              </small>
            </label>
          </details>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button button--primary button--wide"
          disabled={busy || !hydrated}
          type="submit"
        >
          {busy
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>
      {mode === "signin" ? <ResetPassword onDone={setAccount} /> : null}
      {providers?.discord ? (
        <>
          <div className="divider">
            <span>or</span>
          </div>
          <a className="button button--discord button--wide" href={discordHref}>
            Continue with Discord
          </a>
        </>
      ) : null}
    </section>
  );
}

/** Support-assisted reset: an operator issues a one-time code. */
function ResetPassword({
  onDone,
}: {
  readonly onDone: (account: Account) => void;
}) {
  const api = useApi();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ account: Account }>(
        "/api/auth/reset-password",
        { body: { code, password } },
      );
      onDone(result.account);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="quiet-details reset-details">
      <summary>Forgot your password?</summary>
      <p className="muted small">
        Report it from any signed-in device or ask the team in the alpha
        channel; support will give you a one-time reset code.
      </p>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Reset code</span>
          <input
            autoComplete="one-time-code"
            onChange={(event) => setCode(event.target.value)}
            required
            value={code}
          />
        </label>
        <label>
          <span>New password</span>
          <input
            autoComplete="new-password"
            minLength={10}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="button" disabled={busy || !hydrated} type="submit">
          Set new password
        </button>
      </form>
    </details>
  );
}
