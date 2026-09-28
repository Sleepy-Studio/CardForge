import type { Aspect, CardDefinition } from "@cardforge/card-schema";

/*
 * Procedural card illustrations. Every card gets a deterministic SVG scene
 * built from its ID, type, subtype, and aspects, drawn in the active Theme
 * Pack's style. Real art in a theme's assets.json always wins (see
 * lib/assets.ts); this is what renders when a theme ships none. Pure
 * presentation: nothing here reaches the rules engine.
 */

export type ArtStyle = "fantasy" | "scifi" | "neutral";

const styleByTheme: Readonly<Record<string, ArtStyle>> = {
  aetherfront: "fantasy",
  "orbital-conflict": "scifi",
};

export function artStyleFor(themeId: string): ArtStyle {
  return styleByTheme[themeId] ?? "neutral";
}

export const aspectHue: Readonly<Record<Aspect, number>> = {
  force: 352,
  bastion: 208,
  motion: 165,
  growth: 105,
  cunning: 272,
  entropy: 32,
  neutral: 220,
};

export type ArtCard = Pick<
  CardDefinition,
  "cardId" | "type" | "aspects" | "subtypes" | "rarity"
>;

/** Art is 400×300 (4:3); card frames crop it with background-size: cover. */
const W = 400;
const H = 300;

export function generateCardArt(card: ArtCard, themeId: string): string {
  const style = artStyleFor(themeId);
  const rand = rng(hash(`${themeId}:${card.cardId}`));
  const hue = aspectHue[card.aspects[0] ?? "neutral"];
  const hue2 = card.aspects[1]
    ? aspectHue[card.aspects[1]]
    : (hue + (style === "scifi" ? 180 : 35)) % 360;
  const ctx: Ctx = { rand, hue, hue2, style };
  const parts = [
    defs(ctx),
    sky(ctx),
    backdrop(ctx),
    subject(ctx, card),
    foreground(ctx),
    `<rect width="${W}" height="${H}" fill="url(#vignette)"/>`,
  ];
  return svg(parts.join(""));
}

/** A subject-free scene for the match board backdrop. */
export function generateBoardArt(themeId: string): string {
  const style = artStyleFor(themeId);
  const rand = rng(hash(`${themeId}:board`));
  const hue = style === "scifi" ? 215 : style === "fantasy" ? 250 : 220;
  const ctx: Ctx = { rand, hue, hue2: (hue + 40) % 360, style };
  return svg(
    [
      defs(ctx),
      sky(ctx),
      backdrop(ctx),
      foreground(ctx),
      `<rect width="${W}" height="${H}" fill="#000" opacity="0.35"/>`,
      `<rect width="${W}" height="${H}" fill="url(#vignette)"/>`,
    ].join(""),
  );
}

/** A patterned card back in the theme's style. */
export function generateCardBack(
  themeId: string,
  colors: Readonly<Record<string, string>>,
): string {
  const palette: Palette = {
    canvas: colors.canvas ?? "#07111d",
    panel: colors.panel ?? "#0d2030",
    primary: colors.primary ?? "#6dffba",
    secondary: colors.secondary ?? "#45d9ff",
  };
  const style = artStyleFor(themeId);
  const rand = rng(hash(`${themeId}:back`));
  const rings = Array.from({ length: 6 }, (_, index) => {
    const r = 30 + index * 22;
    return `<circle cx="150" cy="210" r="${r}" fill="none" stroke="${palette.primary}" stroke-opacity="${0.5 - index * 0.06}" stroke-width="${index % 2 ? 1 : 2.5}" ${style === "scifi" ? `stroke-dasharray="${4 + index * 3} ${3 + index}"` : ""}/>`;
  }).join("");
  const rays = Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2;
    const inner = 40 + rand() * 10;
    const outer = 150 + rand() * 30;
    return `<line x1="${150 + Math.cos(angle) * inner}" y1="${210 + Math.sin(angle) * inner}" x2="${150 + Math.cos(angle) * outer}" y2="${210 + Math.sin(angle) * outer}" stroke="${palette.secondary}" stroke-opacity="0.35"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420"><defs><radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="${palette.panel}"/><stop offset="1" stop-color="${palette.canvas}"/></radialGradient></defs><rect width="300" height="420" rx="18" fill="url(#g)"/><rect x="10" y="10" width="280" height="400" rx="12" fill="none" stroke="${palette.primary}" stroke-opacity="0.6" stroke-width="2"/>${rays}${rings}<path d="M150 170 L178 210 L150 250 L122 210 Z" fill="${palette.primary}" fill-opacity="0.85"/><path d="M150 186 L166 210 L150 234 L134 210 Z" fill="${palette.canvas}"/></svg>`;
}

export interface Palette {
  readonly canvas: string;
  readonly panel: string;
  readonly primary: string;
  readonly secondary: string;
}

// --- internals ------------------------------------------------------------

interface Ctx {
  readonly rand: () => number;
  readonly hue: number;
  readonly hue2: number;
  readonly style: ArtStyle;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h: number, s: number, l: number, a = 1) =>
  a === 1
    ? `hsl(${Math.round(h)} ${s}% ${l}%)`
    : `hsl(${Math.round(h)} ${s}% ${l}% / ${a})`;
const n = (value: number) => Math.round(value * 10) / 10;
const between = (rand: () => number, min: number, max: number) =>
  min + rand() * (max - min);

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}

function defs({ hue, hue2, style }: Ctx): string {
  const top =
    style === "scifi"
      ? hsl(hue2, 55, 6)
      : hsl(hue, style === "neutral" ? 20 : 45, 10);
  const mid = hsl(hue, 60, style === "scifi" ? 22 : 30);
  const low = hsl(hue2, 65, style === "scifi" ? 35 : 55);
  return `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.62" stop-color="${mid}"/><stop offset="1" stop-color="${low}"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="${hsl(hue2, 90, 80, 0.95)}"/><stop offset="0.35" stop-color="${hsl(hue2, 90, 65, 0.45)}"/><stop offset="1" stop-color="${hsl(hue2, 90, 60, 0)}"/></radialGradient>
<radialGradient id="aura"><stop offset="0" stop-color="${hsl(hue, 95, 70, 0.8)}"/><stop offset="1" stop-color="${hsl(hue, 95, 55, 0)}"/></radialGradient>
<linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(hue, 30, 16)}"/><stop offset="1" stop-color="${hsl(hue, 35, 5)}"/></linearGradient>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(hue2, 40, 85)}"/><stop offset="0.5" stop-color="${hsl(hue, 30, 55)}"/><stop offset="1" stop-color="${hsl(hue, 40, 22)}"/></linearGradient>
<radialGradient id="vignette" cx="50%" cy="45%" r="75%"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
</defs>`;
}

function sky(ctx: Ctx): string {
  const { rand, hue2, style } = ctx;
  const out = [`<rect width="${W}" height="${H}" fill="url(#sky)"/>`];
  const starCount = style === "scifi" ? 70 : style === "fantasy" ? 30 : 18;
  for (let index = 0; index < starCount; index += 1) {
    const r = rand() < 0.1 ? 1.6 : 0.8;
    out.push(
      `<circle cx="${n(rand() * W)}" cy="${n(rand() * H * 0.6)}" r="${r}" fill="#fff" opacity="${n(0.25 + rand() * 0.6)}"/>`,
    );
  }
  const cx = between(rand, 60, 340);
  const cy = between(rand, 45, 110);
  if (style === "scifi") {
    const r = between(rand, 34, 60);
    out.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 2.2)}" fill="url(#glow)" opacity="0.5"/>`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${hsl(hue2, 45, 38)}"/>`,
      `<path d="M${n(cx - r)} ${n(cy)} a${n(r)} ${n(r)} 0 0 0 ${n(r * 2)} 0" fill="${hsl(hue2, 50, 22)}" opacity="0.7"/>`,
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(r * 1.9)}" ry="${n(r * 0.45)}" fill="none" stroke="${hsl(hue2, 70, 75, 0.7)}" stroke-width="3" transform="rotate(${n(between(rand, -25, 25))} ${n(cx)} ${n(cy)})"/>`,
    );
  } else {
    out.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="70" fill="url(#glow)"/>`,
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(between(rand, 14, 24))}" fill="${hsl(hue2, 90, 88)}"/>`,
    );
    if (style === "fantasy")
      for (let index = 0; index < 3; index += 1) {
        const y = between(rand, 70, 150);
        const x = between(rand, -40, 300);
        out.push(
          `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(between(rand, 60, 120))}" ry="${n(between(rand, 8, 16))}" fill="${hsl(hue2, 40, 75, 0.12)}"/>`,
        );
      }
  }
  return out.join("");
}

/** Jagged ridge from x=0 to x=W at a base height, closed to the bottom. */
function ridge(
  rand: () => number,
  base: number,
  amplitude: number,
  steps: number,
  fill: string,
): string {
  const points: string[] = [`0,${H}`];
  for (let index = 0; index <= steps; index += 1) {
    const x = (index / steps) * W;
    const y = base - rand() * amplitude;
    points.push(`${n(x)},${n(y)}`);
  }
  points.push(`${W},${H}`);
  return `<polygon points="${points.join(" ")}" fill="${fill}"/>`;
}

function backdrop(ctx: Ctx): string {
  const { rand, hue, hue2, style } = ctx;
  if (style === "scifi") {
    const out: string[] = [];
    // Skyline of blocky towers with lit windows.
    let x = -10;
    while (x < W) {
      const width = between(rand, 18, 42);
      const height = between(rand, 30, 110);
      out.push(
        `<rect x="${n(x)}" y="${n(210 - height)}" width="${n(width)}" height="${n(height + 10)}" fill="${hsl(hue, 30, 10)}"/>`,
      );
      for (let wy = 210 - height + 6; wy < 205; wy += 9)
        if (rand() < 0.35)
          out.push(
            `<rect x="${n(x + between(rand, 3, width - 6))}" y="${n(wy)}" width="3" height="2" fill="${hsl(hue2, 90, 70, 0.8)}"/>`,
          );
      x += width + between(rand, 0, 6);
    }
    // Perspective grid floor.
    out.push(
      `<rect y="210" width="${W}" height="${H - 210}" fill="${hsl(hue, 45, 7)}"/>`,
    );
    for (let index = 0; index < 7; index += 1) {
      const y = 210 + (index * index * 90) / 36;
      out.push(
        `<line x1="0" y1="${n(y)}" x2="${W}" y2="${n(y)}" stroke="${hsl(hue2, 90, 60, 0.35)}"/>`,
      );
    }
    for (let index = -8; index <= 8; index += 1)
      out.push(
        `<line x1="${200 + index * 12}" y1="210" x2="${200 + index * 70}" y2="${H}" stroke="${hsl(hue2, 90, 60, 0.25)}"/>`,
      );
    return out.join("");
  }
  const far = hsl(hue, 30, style === "neutral" ? 22 : 26, 0.9);
  const mid = hsl(hue, 35, 15);
  const near = hsl(hue, 40, 8);
  return [
    ridge(rand, 185, 70, 7, far),
    style === "fantasy" ? mist(ctx, 175) : "",
    ridge(rand, 220, 45, 11, mid),
    ridge(rand, 262, 22, 14, near),
    style === "fantasy" ? trees(ctx) : "",
    `<rect y="0" width="${W}" height="${H}" fill="${hsl(hue2, 60, 50, 0.05)}"/>`,
  ].join("");
}

function mist({ rand, hue2 }: Ctx, y: number): string {
  return `<ellipse cx="${n(between(rand, 120, 280))}" cy="${y}" rx="260" ry="18" fill="${hsl(hue2, 50, 80, 0.12)}" filter="url(#soft)"/>`;
}

function trees({ rand, hue }: Ctx): string {
  const out: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    const x = between(rand, 0, W);
    const height = between(rand, 16, 34);
    const base = between(rand, 255, 272);
    out.push(
      `<polygon points="${n(x)},${n(base - height)} ${n(x - height * 0.3)},${n(base)} ${n(x + height * 0.3)},${n(base)}" fill="${hsl(hue, 35, 6)}"/>`,
    );
  }
  return out.join("");
}

function foreground({ rand, hue, hue2, style }: Ctx): string {
  const out: string[] = [];
  const count = style === "fantasy" ? 18 : 10;
  for (let index = 0; index < count; index += 1) {
    const color = rand() < 0.5 ? hue : hue2;
    out.push(
      `<circle cx="${n(rand() * W)}" cy="${n(between(rand, 120, H))}" r="${n(between(rand, 0.8, 2.4))}" fill="${hsl(color, 95, 75, n(between(rand, 0.3, 0.9)))}"/>`,
    );
  }
  out.push(
    `<rect y="${H - 30}" width="${W}" height="30" fill="${hsl(hue, 40, 4, 0.55)}"/>`,
  );
  return out.join("");
}

// --- subjects -------------------------------------------------------------

function subject(ctx: Ctx, card: ArtCard): string {
  const subtype = card.subtypes?.[0];
  switch (card.type) {
    case "leader":
      return portrait(ctx);
    case "entity":
    case "token":
      return subtype === "beast"
        ? beast(ctx)
        : subtype === "structure"
          ? tower(ctx, 1)
          : figure(ctx, subtype ?? "soldier");
    case "site":
      return tower(ctx, 1.25);
    case "tactic":
      return burst(ctx);
    case "reaction":
      return ward(ctx);
    case "attachment":
      return blade(ctx);
    case "relic":
      return gem(ctx);
    default:
      return gem(ctx);
  }
}

const rim = ({ hue2 }: Ctx) =>
  `stroke="${hsl(hue2, 95, 72, 0.9)}" stroke-width="2" stroke-linejoin="round"`;

function aura(ctx: Ctx, x: number, y: number, r: number): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#aura)" opacity="${n(between(ctx.rand, 0.55, 0.85))}"/>`;
}

function figure(ctx: Ctx, role: string): string {
  const { rand, hue, hue2, style } = ctx;
  const x = n(between(rand, 175, 225));
  const lean = n(between(rand, -5, 5));
  const cloak = role === "agent" || role === "scout" || role === "reclaimer";
  const eye = hsl(hue2, 95, 72);
  const helm = Math.floor(rand() * 4);
  let head: string;
  if (style === "scifi")
    head = `<rect x="-16" y="-132" width="32" height="34" rx="11" fill="url(#body)" ${rim(ctx)}/><rect x="-12" y="-121" width="24" height="7" rx="3.5" fill="${eye}"/>${helm % 2 ? `<line x1="10" y1="-132" x2="18" y2="-150" stroke="url(#metal)" stroke-width="2"/><circle cx="18" cy="-151" r="2.5" fill="${eye}"/>` : ""}`;
  else if (cloak)
    head = `<path d="M-21 -96 Q-24 -140 0 -150 Q24 -140 21 -96 Z" fill="url(#body)" ${rim(ctx)}/><circle cx="-6" cy="-116" r="2.2" fill="${eye}"/><circle cx="6" cy="-116" r="2.2" fill="${eye}"/>`;
  else {
    const crest = [
      `<path d="M-2 -134 Q18 -150 10 -118" fill="none" stroke="${hsl(hue, 85, 55)}" stroke-width="6" stroke-linecap="round"/>`,
      `<path d="M-16 -124 Q-30 -138 -26 -150 Q-18 -136 -10 -130 Z M16 -124 Q30 -138 26 -150 Q18 -136 10 -130 Z" fill="url(#metal)"/>`,
      `<path d="M-17 -118 L0 -148 L17 -118 Z" fill="url(#metal)"/>`,
      "",
    ][helm];
    head = `${crest}<path d="M-16 -100 L-16 -122 Q0 -138 16 -122 L16 -100 Q0 -94 -16 -100 Z" fill="url(#body)" ${rim(ctx)}/><rect x="-11" y="-116" width="22" height="4" rx="2" fill="${eye}" opacity="0.9"/>`;
  }
  const cape =
    rand() < 0.6
      ? `<path d="M-24 -92 Q-52 -10 -44 22 L44 22 Q52 -10 24 -92 Z" fill="${hsl(hue, 70, 28)}" opacity="0.95"/>`
      : "";
  const legs = `<path d="M-20 0 L-24 44 L-8 44 L-4 0 Z M4 0 L8 44 L24 44 L20 0 Z" fill="url(#body)" ${rim(ctx)}/>`;
  const torso = cloak
    ? `<path d="M-22 -98 Q-40 -30 -44 30 L44 30 Q40 -30 22 -98 Z" fill="url(#body)" ${rim(ctx)}/><path d="M-10 -60 L10 -60 L6 20 L-6 20 Z" fill="${hsl(hue, 60, 32)}" opacity="0.6"/>`
    : `${legs}<path d="M-26 -94 L26 -94 L30 -40 L22 4 L-22 4 L-30 -40 Z" fill="url(#body)" ${rim(ctx)}/><path d="M-26 -94 L26 -94 L20 -66 L-20 -66 Z" fill="url(#metal)" opacity="0.5"/><rect x="-22" y="-14" width="44" height="7" fill="url(#metal)" opacity="0.7"/><circle cx="-30" cy="-86" r="13" fill="url(#metal)" ${rim(ctx)}/><circle cx="30" cy="-86" r="13" fill="url(#metal)" ${rim(ctx)}/>`;
  const weapons: Record<string, string> = {
    guardian: `<path d="M-72 -84 L-28 -90 L-26 -18 Q-50 14 -74 -18 Z" fill="url(#metal)" ${rim(ctx)}/><path d="M-50 -76 L-50 -12 M-68 -48 L-32 -50" stroke="${hsl(hue, 80, 50)}" stroke-width="5"/>`,
    scout: `<path d="M46 -130 Q82 -62 46 6" fill="none" stroke="url(#metal)" stroke-width="5"/><line x1="46" y1="-130" x2="46" y2="6" stroke="${hsl(hue2, 90, 75, 0.8)}" stroke-width="1.5"/>`,
    agent: `<path d="M30 -44 L66 -92 L71 -88 L37 -38 Z" fill="url(#metal)" ${rim(ctx)}/><path d="M-30 -44 L-60 -80 L-64 -76 L-36 -40 Z" fill="url(#metal)" opacity="0.8"/>`,
    reclaimer: `<line x1="42" y1="-156" x2="32" y2="30" stroke="url(#metal)" stroke-width="6"/><circle cx="42" cy="-160" r="10" fill="${eye}"/><circle cx="42" cy="-160" r="26" fill="url(#glow)"/>`,
  };
  const soldierWeapons = [
    `<line x1="44" y1="-176" x2="34" y2="30" stroke="url(#metal)" stroke-width="5"/><path d="M44 -196 L53 -172 L35 -172 Z" fill="url(#metal)" ${rim(ctx)}/>`,
    `<path d="M36 -60 L44 -170 L52 -60 Z" fill="url(#metal)" ${rim(ctx)}/><rect x="28" y="-62" width="32" height="7" rx="3" fill="url(#body)" ${rim(ctx)}/>`,
    `<line x1="40" y1="-150" x2="36" y2="20" stroke="url(#metal)" stroke-width="6"/><path d="M40 -150 Q76 -150 70 -112 Q56 -124 40 -118 Z" fill="url(#metal)" ${rim(ctx)}/>`,
    `<line x1="42" y1="-190" x2="36" y2="30" stroke="url(#metal)" stroke-width="4"/><path d="M42 -188 L96 -176 L42 -150 Z" fill="${hsl(hue, 80, 45)}" ${rim(ctx)}/>`,
  ];
  const gear =
    weapons[role] ?? soldierWeapons[Math.floor(rand() * soldierWeapons.length)];
  return `${aura(ctx, x, 190, 110)}<g transform="translate(${x} 222) rotate(${lean})">${cape}${gear}${torso}${head}</g>`;
}

function beast(ctx: Ctx): string {
  const { rand, hue2 } = ctx;
  const x = n(between(rand, 150, 200));
  const flip = rand() < 0.5 ? -1 : 1;
  return `${aura(ctx, 200, 200, 120)}<g transform="translate(${x + (flip < 0 ? 110 : 0)} 250) scale(${flip} 1)">
<path d="M0 0 Q-6 -46 30 -60 Q70 -76 110 -62 Q140 -100 166 -92 Q182 -86 176 -66 Q170 -48 150 -44 Q150 -20 138 0 L122 0 L118 -30 Q80 -24 50 -30 L40 0 L24 0 L22 -30 Q10 -20 12 0 Z" fill="url(#body)" ${rim(ctx)}/>
<circle cx="160" cy="-76" r="3.2" fill="${hsl(hue2, 100, 72)}"/>
<path d="M150 -90 L146 -112 L158 -94 Z M164 -92 L168 -114 L172 -90 Z" fill="url(#metal)"/>
</g>`;
}

function tower(ctx: Ctx, scale: number): string {
  const { rand, hue2, style } = ctx;
  const x = n(between(rand, 170, 230));
  if (style === "scifi")
    return `${aura(ctx, x, 150, 120)}<g transform="translate(${x} 262) scale(${scale})">
<path d="M-60 0 L-50 -60 L50 -60 L60 0 Z" fill="url(#body)" ${rim(ctx)}/>
<path d="M-50 -60 A50 50 0 0 1 50 -60 Z" fill="url(#metal)" opacity="0.8"/>
<rect x="-6" y="-170" width="12" height="70" fill="url(#body)" ${rim(ctx)}/>
<circle cy="-176" r="8" fill="${hsl(hue2, 95, 70)}"/><circle cy="-176" r="26" fill="url(#glow)"/>
<rect x="-40" y="-40" width="80" height="4" fill="${hsl(hue2, 95, 65, 0.8)}"/>
</g>`;
  const turret = (dx: number, h: number) =>
    `<rect x="${dx - 14}" y="${-h}" width="28" height="${h}" fill="url(#body)" ${rim(ctx)}/><path d="M${dx - 18} ${-h} L${dx} ${-h - 30} L${dx + 18} ${-h} Z" fill="url(#metal)"/><rect x="${dx - 4}" y="${-h + 14}" width="8" height="12" rx="4" fill="${hsl(hue2, 95, 72)}"/>`;
  return `${aura(ctx, x, 160, 120)}<g transform="translate(${x} 266) scale(${scale})">
${turret(-44, 90)}${turret(44, 100)}
<rect x="-34" y="-70" width="68" height="70" fill="url(#body)" ${rim(ctx)}/>
${turret(0, 140)}
<path d="M-12 0 L-12 -26 Q0 -40 12 -26 L12 0 Z" fill="${hsl(hue2, 95, 70, 0.9)}"/>
</g>`;
}

function portrait(ctx: Ctx): string {
  const { rand, hue, hue2, style } = ctx;
  const variant = Math.floor(rand() * 5);
  const eye = hsl(hue2, 100, 75);
  const eyes =
    style === "scifi" || variant === 4
      ? `<rect x="-30" y="-134" width="60" height="10" rx="5" fill="${eye}"/>`
      : `<path d="M-24 -128 L-8 -124 M8 -124 L24 -128" stroke="${eye}" stroke-width="4" stroke-linecap="round"/>`;
  const headwear = [
    // Crown.
    `<path d="M-40 -150 L-30 -182 L-14 -158 L0 -192 L14 -158 L30 -182 L40 -150 Z" fill="url(#metal)" ${rim(ctx)}/>`,
    // Deep hood.
    `<path d="M-62 -96 Q-70 -196 0 -206 Q70 -196 62 -96 Q40 -150 0 -154 Q-40 -150 -62 -96 Z" fill="${hsl(hue, 55, 22)}" ${rim(ctx)}/>`,
    // Horned helm.
    `<path d="M-46 -140 Q-90 -150 -84 -204 Q-66 -164 -40 -160 Z M46 -140 Q90 -150 84 -204 Q66 -164 40 -160 Z" fill="url(#metal)" ${rim(ctx)}/><path d="M-46 -112 L-46 -150 Q0 -186 46 -150 L46 -112 Z" fill="url(#metal)" opacity="0.85"/>`,
    // Circlet and long hair.
    `<path d="M-50 -110 Q-62 -40 -70 -10 L-40 -30 Q-46 -80 -44 -120 Z M50 -110 Q62 -40 70 -10 L40 -30 Q46 -80 44 -120 Z" fill="${hsl(hue2, 45, 30)}"/><path d="M-46 -148 Q0 -168 46 -148" fill="none" stroke="url(#metal)" stroke-width="6"/><circle cy="-160" r="7" fill="${hsl(hue, 90, 62)}"/>`,
    // Tall crest helm.
    `<path d="M-46 -108 L-46 -152 Q0 -196 46 -152 L46 -108 Z" fill="url(#metal)" opacity="0.9"/><path d="M-6 -176 Q30 -236 58 -210 Q24 -206 8 -168 Z" fill="${hsl(hue, 85, 50)}"/>`,
  ][variant];
  const shoulders = [
    `<path d="M-120 0 Q-110 -80 -52 -92 L52 -92 Q110 -80 120 0 Z" fill="url(#body)" ${rim(ctx)}/>`,
    `<path d="M-128 0 Q-120 -70 -60 -94 L60 -94 Q120 -70 128 0 Z" fill="url(#body)" ${rim(ctx)}/><path d="M-118 -46 Q-100 -104 -44 -92 L-60 -52 Z M118 -46 Q100 -104 44 -92 L60 -52 Z" fill="url(#metal)" ${rim(ctx)}/>`,
    `<path d="M-112 0 Q-104 -84 -50 -92 L50 -92 Q104 -84 112 0 Z" fill="${hsl(hue, 60, 24)}" ${rim(ctx)}/><path d="M-30 -92 L0 0 L30 -92" fill="url(#body)"/>`,
  ][Math.floor(rand() * 3)];
  const ringHalo = rand() < 0.5;
  const halo = ringHalo
    ? `<circle cy="-128" r="96" fill="none" stroke="${hsl(hue2, 90, 75, 0.55)}" stroke-width="5"/><circle cy="-128" r="112" fill="none" stroke="${hsl(hue2, 90, 75, 0.25)}" stroke-width="2" stroke-dasharray="3 9"/>`
    : Array.from({ length: 14 }, (_, index) => {
        const angle = (index / 14) * Math.PI * 2;
        return `<line x1="${n(Math.cos(angle) * 70)}" y1="${n(-120 + Math.sin(angle) * 70)}" x2="${n(Math.cos(angle) * 125)}" y2="${n(-120 + Math.sin(angle) * 125)}" stroke="${hsl(hue2, 90, 75, 0.35)}" stroke-width="3"/>`;
      }).join("");
  const face = `<path d="M-46 -112 Q-50 -170 0 -176 Q50 -170 46 -112 Q40 -84 0 -80 Q-40 -84 -46 -112 Z" fill="url(#body)" ${rim(ctx)}/>`;
  const hoodFirst = variant === 1;
  return `${aura(ctx, 200, 150, 150)}<g transform="translate(200 300)">
${halo}${shoulders}
<path d="M-52 -92 L0 -40 L52 -92" fill="none" stroke="url(#metal)" stroke-width="6"/>
${hoodFirst ? headwear : ""}${face}${eyes}${hoodFirst ? "" : headwear}
<circle cy="-64" r="10" fill="${hsl(hue, 90, 60)}" ${rim(ctx)}/>
</g>`;
}

function burst(ctx: Ctx): string {
  const { rand, hue, hue2 } = ctx;
  const cx = n(between(rand, 170, 230));
  const cy = n(between(rand, 130, 170));
  const spikes = 9 + Math.floor(rand() * 5);
  const points: string[] = [];
  for (let index = 0; index < spikes * 2; index += 1) {
    const angle = (index / (spikes * 2)) * Math.PI * 2 + rand() * 0.1;
    const radius = index % 2 ? between(rand, 20, 34) : between(rand, 70, 110);
    points.push(
      `${n(cx + Math.cos(angle) * radius)},${n(cy + Math.sin(angle) * radius)}`,
    );
  }
  const arcs = Array.from({ length: 3 }, (_, index) => {
    const r = 90 + index * 26;
    const start = between(rand, 180, 260);
    const end = start + between(rand, 60, 110);
    const a = (start * Math.PI) / 180;
    const b = (end * Math.PI) / 180;
    return `<path d="M${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)} A${r} ${r} 0 0 1 ${n(cx + Math.cos(b) * r)} ${n(cy + Math.sin(b) * r)}" fill="none" stroke="${hsl(index % 2 ? hue : hue2, 95, 72, 0.8)}" stroke-width="${5 - index}" stroke-linecap="round"/>`;
  }).join("");
  return `<circle cx="${cx}" cy="${cy}" r="140" fill="url(#aura)"/>${arcs}<polygon points="${points.join(" ")}" fill="${hsl(hue2, 95, 70, 0.9)}"/><circle cx="${cx}" cy="${cy}" r="26" fill="${hsl(hue2, 100, 92)}"/><circle cx="${cx}" cy="${cy}" r="60" fill="url(#glow)"/>`;
}

function ward(ctx: Ctx): string {
  const { rand, hue2 } = ctx;
  const cx = n(between(rand, 180, 220));
  return `${aura(ctx, cx, 150, 130)}<g transform="translate(${cx} 150)">
<circle r="92" fill="none" stroke="${hsl(hue2, 90, 70, 0.45)}" stroke-width="2" stroke-dasharray="6 6"/>
<path d="M0 -90 L70 -64 Q72 20 0 88 Q-72 20 -70 -64 Z" fill="url(#body)" ${rim(ctx)}/>
<path d="M0 -70 L52 -50 Q52 12 0 66 Q-52 12 -52 -50 Z" fill="url(#metal)" opacity="0.35"/>
<path d="M12 -58 L-20 6 L4 6 L-12 58 L26 -12 L2 -12 L18 -58 Z" fill="${hsl(hue2, 100, 78)}"/>
</g>`;
}

function blade(ctx: Ctx): string {
  const { rand, hue2 } = ctx;
  const angle = n(between(rand, -35, -15));
  return `${aura(ctx, 200, 150, 130)}<circle cx="200" cy="150" r="84" fill="none" stroke="${hsl(hue2, 90, 70, 0.5)}" stroke-width="3" stroke-dasharray="2 10"/><g transform="translate(200 150) rotate(${angle})">
<path d="M-8 -130 L8 -130 L10 40 L0 58 L-10 40 Z" fill="url(#metal)" ${rim(ctx)}/>
<rect x="-44" y="40" width="88" height="12" rx="6" fill="url(#body)" ${rim(ctx)}/>
<rect x="-7" y="52" width="14" height="46" rx="4" fill="url(#body)"/>
<circle cy="104" r="10" fill="${hsl(hue2, 95, 68)}"/>
</g>`;
}

function gem(ctx: Ctx): string {
  const { rand, hue, hue2 } = ctx;
  const y = n(between(rand, 118, 140));
  return `${aura(ctx, 200, y, 130)}<path d="M150 262 L170 226 L230 226 L250 262 Z" fill="url(#body)" ${rim(ctx)}/>
<g transform="translate(200 ${y})">
<path d="M0 -70 L44 -22 L28 58 L-28 58 L-44 -22 Z" fill="${hsl(hue, 80, 45)}" ${rim(ctx)}/>
<path d="M0 -70 L16 -18 L0 58 L-16 -18 Z" fill="${hsl(hue2, 90, 75, 0.8)}"/>
<path d="M-44 -22 L44 -22" stroke="${hsl(hue2, 90, 85, 0.7)}" stroke-width="2"/>
<circle r="80" fill="url(#glow)" opacity="0.5"/>
</g>`;
}
