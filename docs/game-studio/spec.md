# CardForge procedural presentation specification

CardForge proves rebrandability with two complete presentation packs over one
immutable TempoFront gameplay pack. Presentation may read semantic events and
projected state; it never controls engine resolution or animation timing.

## Shared readability contract

- The DOM owns rules text, card inspection, timers, menus, forms, and screen-reader state.
- Pixi owns board geometry, movement traces, target rings, particles, and Front emphasis.
- Aspect identity always combines color with a stable icon/shape.
- Every animation recipe declares a reduced-motion substitute.
- A reconnect may accelerate or skip the entire visual queue without changing state.
- Card art remains below the title, costs, type line, rules text, and combat stats in visual priority.

## Aetherfront

Aetherfront is restrained tactical fantasy: dark slate chambers, mint rune
lines, cold cyan wayfinding, and brief violet magical accents. It avoids ornate
parchment and excessive gold. The visual recipe is etched geometry plus soft
volumetric pulses, keeping six board slots per side legible.

- Deployment: a rune aperture expands once, then resolves to a slot pulse.
- Shift: a thin wisp follows the actual source-to-target vector.
- Strike: one controlled blade arc; no persistent screen obstruction.
- Barrier: a faceted ward cracks outward from the target.
- Front control: a low banner line rises along the captured Realm boundary.
- Dominion: a crown-shaped line motif resolves near the score, never over cards.

## Orbital Conflict

Orbital Conflict is precision fleet telemetry: near-black space, cyan grid
geometry, magenta command accents, and amber warnings. UI surfaces resemble
quiet instrument glass rather than noisy science-fiction dashboards.

- Deployment: a drop-vector reticle contracts into the destination Sector.
- Shift: a short ion trail follows the authoritative movement vector.
- Strike: target-lock brackets close before the existing impact trace.
- Barrier: a hex shield collapses into the target center.
- Front control: a Sector uplink scans once along the lane boundary.
- Dominion: a control-lock glyph resolves beside Sector Control.

## Theme-pack boundary

Each Theme Manifest owns terminology, palette, card frame, board scene, icon
set, animation map, audio map, semantic event recipes, emphasis, and
reduced-motion alternatives. The content compiler rejects a theme missing any
required mapping. Gameplay hashes exclude theme data; presentation hashes
include the resolved themed card views.
