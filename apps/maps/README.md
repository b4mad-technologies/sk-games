# `@spellkave/maps` — maps.spellkave.com

Thin MapLibre GL client for the Spellkave gateway OSM / MVT surface
([ADR-0123](../../specifications/adr/0123-osm-projection-of-the-place-graph.md)).
Replaces the retired `@spellkave/map-view` SVG widget and the website
`MapPanel` / `AdminMapPanel`.

## What it does

1. WorkOS AuthKit login (same public SPA client as `apps/website`).
   No product masthead: a seat-seal menu on a full-viewport Google Maps frame (search pill, results rail, preview card).
2. World picker from the public-site catalog (`index.json`), filtered to
   account-reachable worlds when GET `/v1/account` succeeds.
3. Loads `${VITE_SPELLKAVE_GATEWAY_URL}/w/<slug>/style.json` with a MapLibre
   `transformRequest` that adds `Authorization: Bearer …` on **every**
   gateway origin request (style, tiles, glyphs, **image** backdrops).
4. Floor picker from `tiles.json` `levels` → `setFilter` on indoor layers.
   `backdrops.json` is read before the map is built: `loaded:false` strips the
   image sources (they would only 404) and shows the no-art notice; a single
   missing backdrop image never marks the map as failed.
5. Overpass name search → left results rail; picking a hit or clicking a
   node/room opens a preview card on the map (`name`, `description`, `level`,
   `spellkave:*` behind More). Hover shows an infobox at the pointer. Indoor
   floors switch from a picker bottom-right when `tiles.json` has multiple levels.
6. Seat claim/release; "my seat" marker via
   `visible_actor_spatial_location` + Overpass
   `node["spellkave:node_id"=…]` (live on subscription updates).
7. Deep link `/w/<slug>` opens a world; `/w/<slug>/place|<person>|<thing>/<id>`
   opens that resource (History API). Unknown ids are ignored.
8. One AuthKit login, one SpacetimeDB connection to the selected world.
   Overlay grant (`overlayAdmitted()`): People chip / occupancy pins, inspect
   facts on the same preview card, and a bottom radar timeline (client
   WatchBuffer since connect; pause still records live). Player login never
   mounts those surfaces.

Full-world map geometry this iteration — the map tile states fog-of-war comes later.
Observer internals stay grant-gated.

## Local run (against local gateway + node)

Start order, Tailscale bind, token restart, and BindingDrift traps:
[sk-playtest `maps-local`](../../.agents/skills/sk-playtest/workflows/maps-local.md).
Do not point Vite at `https://mcp.spellkave.com` while Play URL is the worktree node.

DEV token path is **dead in production builds** (`vite` `mode === "production"`
skips the define inject; `isDevAuthEnabled()` is `import.meta.env.DEV` only).

## Env

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SPELLKAVE_GATEWAY_URL` | yes | Gateway origin (`https://mcp.spellkave.com` or local) |
| `VITE_SPELLKAVE_PUBLIC_SITE_URL` | no | Catalog `index.json` base; unset → `public/demo-data` |
| `VITE_SPELLKAVE_API_URL` | no | Account API origin; unset → `https://api.spellkave.com` |
| `VITE_SPELLKAVE_PLAY_URL` | no | SpacetimeDB WS for seats / my-seat marker |
| `VITE_WORKOS_CLIENT_ID` / `VITE_WORKOS_ISSUER` | prod login | AuthKit public SPA |
| `VITE_SPELLKAVE_DEV_TOKEN_FILE` | local only | Play-stage token auto-seed |
| `VITE_SPELLKAVE_DEV_DB` | local only | Pin catalog world `db` to the worktree node |

## Deploy

Cloudflare Worker **assets only** (`wrangler.jsonc`: `workers_dev: false`,
SPA `not_found_handling`). CI: `.github/workflows/maps.yml` (mirrors
`website.yml`).

```bash
pnpm --filter @spellkave/maps run deploy
```

### DNS / custom domain (operator — not done by the app)

The `spellkave-maps` Worker and its assets are deployed by Wrangler. The
`maps.spellkave.com` custom-domain binding is owned by
[`infra/cloudflare/worker.ts`](../../infra/cloudflare/worker.ts) in the
`spellkave-cloudflare` Pulumi stack. Do **not** put `routes` or `custom_domain`
in this `wrangler.jsonc`; that would create a second writer for the binding.

CI uses the shared `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository
secrets. The credential contract and rotation procedure live in
[`infra/cloudflare/README.md`](../../infra/cloudflare/README.md#deployment-credential).

## Tests / gates

```bash
pnpm --filter @spellkave/maps typecheck
pnpm --filter @spellkave/maps test
pnpm --filter @spellkave/maps build
```

MapLibre is exercised through pure helpers in unit tests (`transformRequest`,
level filter, Overpass query, place rows, backdrop stripping, seat-board view,
seat fly-to). The GL runtime is not
booted under jsdom.
