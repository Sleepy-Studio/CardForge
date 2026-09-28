"use client";

import { useState } from "react";
import { glossary, type GlossaryKind } from "@cardforge/rules-tempofront";
import { themedName } from "@/lib/cards";
import { useGameTheme } from "../theme-provider";
import { PageHeader } from "../ui/bits";

const sections: readonly { kind: GlossaryKind; title: string }[] = [
  { kind: "resource", title: "Resources" },
  { kind: "victory", title: "Winning" },
  { kind: "timing", title: "Timing and the chain" },
  { kind: "action", title: "Actions" },
  { kind: "keyword", title: "Keywords" },
  { kind: "status", title: "Statuses" },
  { kind: "zone", title: "Board" },
];

/** The canonical glossary, rendered under the active Theme Pack's terms. */
export function RulesReference() {
  const { theme } = useGameTheme();
  const [query, setQuery] = useState("");
  const match = (text: string) =>
    text.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <div className="rules-page">
      <PageHeader eyebrow="Rules reference" title="How TempoFront works">
        <p className="muted">
          No turns: both players share one Timeline. Control two of three Fronts
          at the end of a Cycle to gain Dominion — six wins — or reduce the
          enemy Leader&apos;s Integrity to zero.
        </p>
      </PageHeader>
      <input
        aria-label="Search the rules"
        className="rules-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search terms"
        value={query}
      />
      {sections.map((section) => {
        const entries = glossary.filter(
          (entry) =>
            entry.kind === section.kind &&
            (!query ||
              match(entry.name) ||
              match(entry.rules) ||
              match(themedName(entry, theme.terms))),
        );
        if (!entries.length) return null;
        return (
          <section className="rules-section" key={section.kind}>
            <h2>{section.title}</h2>
            <dl>
              {entries.map((entry) => {
                const shown = themedName(entry, theme.terms);
                return (
                  <div className="rules-entry" id={entry.id} key={entry.id}>
                    <dt>
                      {shown}
                      {shown !== entry.name ? (
                        <small> ({entry.name})</small>
                      ) : null}
                    </dt>
                    <dd>
                      <p>{entry.explanation}</p>
                      <p className="rules-entry__precise">
                        <b>Exact rule:</b> {entry.rules}
                      </p>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
