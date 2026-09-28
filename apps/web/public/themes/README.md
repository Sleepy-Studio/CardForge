# Theme asset drop-in

Production art is optional. Each Theme Pack may ship files under
`public/themes/<themeId>/` with an `assets.json` index; anything missing
falls back to procedural art. See `apps/web/lib/assets.ts` for the format.
Supported kinds: `cardArt`, `leaderPortrait`, `board`, `cardBack`, `frame`,
`icon`, `vfx`, `audio`, `music`.
