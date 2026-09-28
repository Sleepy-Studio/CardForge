"use client";

import { useId, useState, type ReactNode } from "react";
import type { GlossaryEntry } from "@cardforge/rules-tempofront";
import { useGameTheme } from "../theme-provider";
import { themedName } from "@/lib/cards";

/**
 * Keyword/rules term with a tooltip that works for mouse (hover), keyboard
 * (focus), and touch (tap toggles). Text comes from the canonical glossary.
 */
export function TermTip({
  entry,
  children,
}: {
  readonly entry: GlossaryEntry | undefined;
  readonly children?: ReactNode;
}) {
  const { theme } = useGameTheme();
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!entry) return <span className="term-chip">{children}</span>;
  return (
    <span
      className="term-tip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="term-chip"
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onFocus={() => setOpen(true)}
        type="button"
      >
        {children ?? themedName(entry, theme.terms)}
      </button>
      {open ? (
        <span className="term-tip__bubble" id={id} role="tooltip">
          <strong>{themedName(entry, theme.terms)}</strong>
          {entry.tooltip}
        </span>
      ) : null}
    </span>
  );
}
