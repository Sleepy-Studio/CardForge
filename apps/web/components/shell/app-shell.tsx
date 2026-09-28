"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { useSession } from "@/lib/session";

const navigation = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Play" },
  { href: "/decks", label: "Decks" },
  { href: "/collection", label: "Collection" },
  { href: "/academy", label: "Learn" },
  { href: "/competitive", label: "Ranked" },
  { href: "/history", label: "History" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const { account } = useSession();
  const { environment } = useRuntimeConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  const signedIn = Boolean(account?.onboarding.starterLeaderId);

  return (
    <div className="player-app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="player-topbar">
        <Link className="player-brand" href="/">
          <span className="player-brand__mark" aria-hidden="true" />
          <span>CardForge</span>
          {environment !== "production" ? (
            <em className="env-badge">{environment}</em>
          ) : null}
        </Link>
        {signedIn ? (
          <>
            <button
              aria-controls="player-nav"
              aria-expanded={menuOpen}
              className="player-menu-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              Menu
            </button>
            <nav
              aria-label="Main"
              className={`player-nav ${menuOpen ? "is-open" : ""}`}
              id="player-nav"
            >
              {navigation.map((item) => (
                <Link
                  aria-current={
                    isActive(pathname, item.href) ? "page" : undefined
                  }
                  className="player-nav__link"
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link
              aria-current={isActive(pathname, "/profile") ? "page" : undefined}
              className="player-identity"
              href="/profile"
              title="Profile and settings"
            >
              <span className="avatar" aria-hidden="true">
                {account?.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="player-identity__name">
                {account?.displayName}
              </span>
            </Link>
          </>
        ) : account === null ? (
          <Link
            className="button button--primary"
            href={`/login?next=${encodeURIComponent(pathname)}`}
          >
            Sign in
          </Link>
        ) : null}
      </header>
      <main className="player-main" id="main">
        {children}
      </main>
      <footer className="player-footer">
        <span>Powered by CardForge</span>
        <Link href="/rules">How to play</Link>
        {account?.role === "admin" ? (
          <>
            <Link href="/operations">Operations</Link>
            <Link href="/studio">Card Studio</Link>
            <Link href="/lab">Match Lab</Link>
          </>
        ) : null}
      </footer>
    </div>
  );
}
