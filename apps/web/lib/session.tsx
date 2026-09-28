"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useApi } from "./api";
import type { Account } from "./types";

interface SessionValue {
  /** undefined while loading; null when signed out. */
  readonly account: Account | null | undefined;
  readonly refresh: () => Promise<Account | null>;
  readonly setAccount: (account: Account | null) => void;
  readonly logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const api = useApi();
  const [account, setAccount] = useState<Account | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const { account: current } = await api<{ account: Account | null }>(
        "/api/auth/session",
      );
      setAccount(current);
      return current;
    } catch {
      setAccount(null);
      return null;
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { body: {} }).catch(() => undefined);
    setAccount(null);
  }, [api]);

  const value = useMemo(
    () => ({ account, refresh, setAccount, logout }),
    [account, refresh, logout],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession requires SessionProvider");
  return value;
}

/**
 * Gate for player pages: signed-out visitors go to login (returning here
 * afterwards) and players without a starter go to onboarding.
 */
export function useRequireAccount(
  options: { readonly allowOnboarding?: boolean } = {},
): Account | null {
  const { account } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (account === null)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (
      account &&
      !options.allowOnboarding &&
      !account.onboarding.starterLeaderId
    )
      router.replace("/onboarding");
  }, [account, options.allowOnboarding, pathname, router]);
  if (!account) return null;
  if (!options.allowOnboarding && !account.onboarding.starterLeaderId)
    return null;
  return account;
}
