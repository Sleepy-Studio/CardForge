import type { CardDefinition, ThemeManifest } from "@cardforge/card-schema";
import { generateRulesText } from "@cardforge/rules-tempofront";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderCardSvg(
  definition: CardDefinition,
  theme: ThemeManifest,
): string {
  const name =
    theme.cardOverrides?.[definition.cardId]?.name ?? definition.name;
  const rules = generateRulesText(definition, {
    focus: theme.terms.focus!,
    entity: theme.terms.entity!,
    leader: theme.terms.leader!,
    discard: theme.terms.discard!,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="504" viewBox="0 0 360 504" role="img" aria-label="${escapeXml(name)}">
  <rect width="360" height="504" rx="24" fill="${escapeXml(theme.palette.canvas!)}"/>
  <rect x="12" y="12" width="336" height="480" rx="18" fill="${escapeXml(theme.palette.panel!)}" stroke="${escapeXml(theme.palette.primary!)}" stroke-width="3"/>
  <text x="28" y="48" fill="${escapeXml(theme.palette.text!)}" font-family="system-ui" font-size="21" font-weight="700">${escapeXml(name)}</text>
  <text x="318" y="48" text-anchor="end" fill="${escapeXml(theme.palette.primary!)}" font-family="monospace" font-size="18">${definition.focusCost}</text>
  <rect x="28" y="72" width="304" height="230" rx="12" fill="${escapeXml(theme.palette.secondary!)}" opacity="0.14"/>
  <text x="28" y="332" fill="${escapeXml(theme.palette.secondary!)}" font-family="monospace" font-size="12">${escapeXml(definition.type.toUpperCase())} // ${definition.playTime} TIME</text>
  <foreignObject x="28" y="350" width="304" height="116"><div xmlns="http://www.w3.org/1999/xhtml" style="color:${escapeXml(theme.palette.text!)};font:15px/1.45 system-ui">${escapeXml(rules)}</div></foreignObject>
</svg>`;
}
