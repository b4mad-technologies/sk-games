# Playing a staged world locally

Paths in this file are relative to `apps/play/` unless they are links.
Split out of [`../CLAUDE.md`](../CLAUDE.md), which lists when to read it.

`play-dev` alone renders "The way into this world is closed": with no WorkOS
config the app fails closed by design, and with it the Account API resolves
HOSTED worlds — never a node on `127.0.0.1`. To click through a beat you just
staged, use the DEV-only local path instead:

```bash
just spacetime-start
just play-stage elven-mini
# The NPC cast runs in the Rust NPC host; no standalone local recipe starts it yet (sk-jay0.1.55.60.41).
just play-dev-local elven-mini
```

For local maps and subject art, install the adventure OCI assets into an overlay
`<root>/elven-mini/<asset-module>/...`, then run the read-only gateway separately:

```bash
just play-gateway-local elven-mini /absolute/path/to/installed-world-assets
# Use the origin printed by the gateway (node port + 20000 by default):
VITE_SPELLKAVE_GATEWAY_URL=http://127.0.0.1:29450 just play-rum-local elven-mini
```

`play-rum-local` relays diagnostic RUM only when `SPELLKAVE_RUM_DIAGNOSTIC_UPSTREAM`
names an https RUM endpoint; unset, the relay and the browser producer stay off.

`SPELLKAVE_LOCAL_GATEWAY_PORT` can override the gateway port. Bind defaults to
loopback (`SPELLKAVE_LOCAL_GATEWAY_BIND`). When bind is a Tailscale address,
style.json / backdrops.json bake `http://<bind>:<port>` (`publicBaseUrl`) so a
laptop MapLibre client does not fetch `127.0.0.1` image URLs; override with
`SPELLKAVE_LOCAL_GATEWAY_PUBLIC_URL`. CORS allows Tailscale CGNAT (`100.*`) and
`*.ts.net`. The gateway checks the local staged player's credential, and reads
live topology through the same OSM cache and tile handlers as the hosted gateway.
Its publisher credential stays server-side. Assets come only from the installed
overlay; a missing file does not fall back to the repository. This helper serves
maps/art, not feedback or MCP actions. Play's world actions still use its normal
PLAYER session. `play-dev-local` (also used by `play-rum-local`) defaults
`VITE_SPELLKAVE_FEEDBACK_ENABLED=false`, so the feedback dialog explains that
nothing was sent before offering a form. Override with `true` only when the
configured gateway supports feedback for the staged seat. Hosted builds retain
the existing default. The whole-world map exception in [`../CLAUDE.md`](../CLAUDE.md) continues to apply.
The map tile's "Open the full map" link and the site named in its whole-world
sentence come from `VITE_SPELLKAVE_MAPS_URL` (`src/lib/env.ts`
`tryReadMapsUrl`, documented in `.env.example`). Unset, it is the hosted
`https://maps.spellkave.com`, which is what the hosted build uses. The hosted
maps site shows a different world than a locally staged one, so for local play
set the variable to `off` (no link, no site name) or to a local Maps origin.
`play-dev-local` does not set it yet.
The zoomed map always draws the hero's own place marker and opens at the
hero's place (sk-jay0.1.8.100): `MapTile.svelte` passes the current place as
the canvas's seat in both modes and turns on the canvas's `followPlace`, so
the canvas flies once per place change. A follow is not a pick: the canvas
does not call `onPlaceClick` for it, so arriving never selects the place on
the player's behalf. The canvas still reports the place it boots at, but
`MapTile.svelte` `reportPlacePick` passes a report on only after a pointer
press, click or key inside the canvas armed it (owner ruling 2026-11-12,
sk-jay0.1.8.99), so opening or zooming the tile writes nothing into the
composer; the known gap is a gesture that reports nothing while a boot lookup
is still in flight ([`shell-behaviour.md`](shell-behaviour.md)). `MapTile.test.ts` covers the seat and the `followPlace`
wiring; `MapCanvas.camera.svelte.test.ts` in `@spellkave/map-canvas` covers
the follow itself.
Other actors' pins and the radar need the observer overlay. Play passes no
`substrateControl`, so the canvas shows no Substrate buttons. A glyph range
the gateway's vendored font stack lacks answers an empty 200 PBF, so a local
gateway logs no 404 for it; an unknown font stack still answers 404. Map load
time is only measured: `map_state` records loading and ready in RUM.
MapCanvas accepts optional `notices` copy overrides; Play supplies recovery text
for blocked/failed states without changing the underlying status or diagnostics.
Its optional `onNotice` callback lets Play record only the lifecycle kind in RUM.
`map_state` covers closed/loading/blocked/ready/no-art/failed. Subject images
record art_surface, ordinal art_slot and absent/loading/ready/error; ready follows
the browser image load event after the authenticated bytes pass the authored hash
check. Paths, hashes, labels and diagnostic text are not exported. Neither image
nor map readiness proves viewport visibility. The generic Artwork widget accepts
only display inputs and callbacks, including bounded failure copy. The shared
map-canvas WorldArtwork component owns object URL lifetime; WorldArt adapts its
state callback into Play RUM. The framework-free map-canvas/world-assets loader
shares Maps gateway URL/auth helpers and verifies the authored image hash.
Missing assets, access denial, transport errors and integrity failures have
distinct player-facing explanations. No response body or URL is included.
Subject resolution still uses the SDK attachment reader; absent art stays absent.

`play-dev-local` exports `SPELLKAVE_DEV_PROFILE`, pointing at the profile TOML
`play-stage` already wrote; `vite.config.ts` reads the node url, module, staged
hero and credential out of that one file and serves them as the virtual module
`virtual:spellkave-dev-local`. `src/lib/dev-local.ts` turns that into the
`App.svelte` loader props.

Three invariants keep this honest:

- **It replaces auth and the Account API, nothing else.** The world session, the
  SDK and every reducer stay the shipped ones, so a beat clicked here is a beat
  a hosted player can click. `App.svelte` has no dev branch.
- **It is inert in production.** `vite.config.ts` skips the profile entirely
  when `mode === "production"`, so the virtual module resolves to `null` and no
  credential can reach a built bundle.
- **Do not use `define` for it.** Vite 8 does not text-substitute a
  bare-identifier `define` into the dev-served module — verified 2026-08-27,
  with the config logging success while the browser got the unreplaced
  identifier. The virtual module behaves the same in dev, build and vitest.

One unit trap worth naming: `AuthSession.expires_at` is **milliseconds**
(matching `completeLogin`). A seconds-shaped value makes `readSession` clear the
session, and the app fails closed with no error anywhere.
`src/lib/dev-local.test.ts` round-trips the seeded session through `readSession`
so that cannot regress.
