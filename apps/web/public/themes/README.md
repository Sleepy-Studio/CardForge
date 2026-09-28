# Theme asset drop-in

Production art is optional. Each Theme Pack may ship files under
`public/themes/<themeId>/` with an `assets.json` index (see
`apps/web/lib/assets.ts` for the format). Supported kinds: `cardArt`,
`leaderPortrait`, `board`, `cardBack`, `frame`, `icon`, `vfx`, `audio`,
`music`.

Anything a theme does not ship falls back to generated art: every card gets a
deterministic SVG illustration from `lib/card-art.ts`, served at
`/art/<themeId>/<cardId>.svg` (plus `board.svg` and `card-back.svg`). The
illustration style follows the theme (see `artStyleFor`); a theme without a
registered style gets a neutral one coloured by each card's aspects.
