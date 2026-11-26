# `apps/maps/` — agent context

MapLibre client for `maps.spellkave.com`. Svelte 5 + Vite + Tailwind 4.
Consumes the gateway OSM/MVT surface; does not re-implement place-graph drawing.
Prefer the small shared `@spellkave/ui` kit for generic controls used by website,
maps, or future apps; keep map-specific composition local.

The page shell is a Google Maps frame: no `ProductMasthead`, a seat-seal menu,
search pill, left results rail, place preview card (`MapsTable.svelte`).
Occupancy pins, People chip, inspect-on-the-same-card, and the bottom radar
timeline mount only when `overlayAdmitted()` is true. Connect only the selected
world. Play mosaic is not this app.

## Binding invariants

- **Static SPA, no Worker backend.** Cloudflare Worker serves assets only.
  Never add `routes` / `custom_domain` to `wrangler.jsonc` — the custom-domain
  binding lives in `infra/cloudflare`.
- **Gateway is the map API.** `VITE_SPELLKAVE_GATEWAY_URL` required.
  `transformRequest` must attach Bearer for style, tiles, glyphs, **and image**
  sources on the gateway origin only.
- **AuthKit client-only PKCE**. DEV token path dead in production builds.
- **Shared primitive controls live in `@spellkave/ui`.** Do not revive
  `archive/packages/spellkave-web`; only keep map-only controls local.
- **No `@spellkave/map-view`.** That package is archived.
- **English** in files.

## Verification

```
pnpm --filter @spellkave/maps run typecheck
pnpm --filter @spellkave/maps run test
pnpm --filter @spellkave/maps run build
```
