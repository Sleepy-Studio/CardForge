"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { useSession } from "@/lib/session";

const navigation = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/play", label: "Play", icon: "▶" },
  { href: "/decks", label: "Decks", icon: "▤" },
  { href: "/collection", label: "Collection", icon: "◈" },
  { href: "/academy", label: "Academy", icon: "✦" },
  { href: "/competitive", label: "Competitive", icon: "♛" },
  { href: "/history", label: "History", icon: "↺" },
  { href: "/profile", label: "Profile", icon: "◉" },
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
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link className="player-identity" href="/profile">
              {account?.displayName}
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
        <span>CardForge closed alpha</span>
        <Link href="/rules">Rules reference</Link>
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
