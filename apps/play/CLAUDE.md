# `apps/play/` — agent context

Authenticated player's room for `play.spellkave.com`. Build the visual shell
from `@spellkave/ui` and the shared play widgets (`@spellkave/ui-widgets`);
world reads and actions go through the PLAYER tools, never generated bindings,
hand-written subscription SQL, or raw table reads.

**Before any interaction or layout work, read
`ledger/designs/play-interaction-axioms.md` (private monorepo).**
Its eight axioms are binding: maps and names select, a way-out click fills the
composer, the dock acts, the stream
tells, info cards explain; the app never changes the layout on its own; digits
live only in the dock. While a route sentence (a way out, a look, the end of
the turn) stands in the composer, a name or map click only selects (owner
ruling 2026-11-13); a route the world has withdrawn is no longer armed, so a
click beside it prefills again. A change that needs an exception changes the axiom in
that file first.

## One transport for every surface

`src/lib/play-session.ts` is the page's only seam to the world, and it is the
same seam the MCP gateway and the Pi extension use. `world_time` is always
subscribed — it is in `@spellkave/sdk`'s `CONNECTION_BASELINE`, unioned into
every session's subscribe set regardless of `readerManifests` — so the seal
cluster's live tick readout (sk-jay0.1.1.14, `App.svelte`'s `sealButton`
snippet and `@spellkave/ui`'s `DockTick`) reads
`live.session.currentWorldTick()` directly:
a synchronous accessor over the already-subscribed cache, wired through its
own `onWorldTick` callback on `world_time` mutations. The status button opens a panel with connection, current or last action,
and the world tick. Escape closes and restores focus; an outside click closes.
Disconnected (from the session socket callback), reconnecting, and an action
pending over two seconds take priority over the running tick and stale help
messages. Shape, text, and motion supplement semantic status colors; reduced
motion disables animation. No running tick is shown before the callback.
It does not issue a `readView()` call or use `latestTick()` below (a client
artifact over `view.events`/
`view.speech` that stays 0 for a quiet actor however far the world has
actually ticked — #3487's root cause; keep using it to stamp trail entries,
just not to answer "is the world alive").

- `openSession` from `@spellkave/session` opens the connection, resolves the
  controlled actor, builds the one `ActorClient` (with `successOnProvenance`)
  and waits for the actor-scoped factual context to become ready.
- `createLiveBrowserRoleTools` binds `createPlayerFacingTools` /
  `createDmExtensionTools` from `@spellkave/tool-player` over that session —
  the registry the gateway serves as `spellkave_*` tools.
- `session.worldEvents` is the world-event cursor Pi and the daemon drain;
  `speech_heard` feeds the dialogue, the rest the chronicle.

Every field of `PlayView` (`src/lib/play-view.ts`) is the answer of a tool:
`spellkave_self_summary`, `spellkave_scene`, `spellkave_manipulation_context`,
`spellkave_sense_context`,
`spellkave_session_status`, `spellkave_reaction_options`,
`spellkave_intervention_windows`, `spellkave_inventory`, `spellkave_traces` +
`spellkave_trace_detail` (speech said before the page connected), and
`spellkave_map` (`output_type: "svg"`). Writes are `spellkave_move`
(scene-handle mode), `spellkave_manipulate`, `spellkave_communicate`,
`spellkave_sense`, `spellkave_end_turn`, and
`spellkave_react_option`. A fix in a tool reaches Play, MCP and Pi alike; a
read the page cannot make through a tool is a tool gap to file, not a reason
to reach for `snapshotDb`.

## Binding invariants

- A browser session uses the same WorkOS AuthKit public client and MCP resource
  audience as the website. Tokens stay in `sessionStorage`; never put them in a
  URL, cookie, asset, log, or Worker binding.
  App owns `startSessionRenewal` from shared AuthKit. Recover stored credentials
  before sign-in fallback; let the shared lifecycle schedule and retry renewal.
  Assets and HTTP calls use the current session token. SpacetimeDB checks the
  JWT only when a socket opens, so a renewal for the same issuer/subject keeps
  the open world connection and only swaps the bearer for later HTTP calls and
  the next connect (sk-jay0.1.24). A lapsed access token whose refresh grant is
  still renewable (a throttled hidden tab) keeps the session and view while
  renewal runs; only a sign-out (rejected/missing grant, Web Lock denial, or
  the login site's `sk_signed_in` marker cookie vanishing after this tab saw it)
  closes the world connection and shows the auth gate. There is no silent
  login: the gate's "Sign in" goes through the Spellkave login site (one
  "Continue" click while its session lives). Sign-out clears the tab and POSTs
  a form to `<VITE_SPELLKAVE_LOGIN_ORIGIN>/logout` (required for every non-dev build)
  (`endAuthSession`), which ends the login session for every app. A subject change waits for an ongoing action, then resets the
  world. A dropped socket reconnects once per 30 s with the current (renewed if
  lapsed) token under the mounted mosaic; a second drop inside that window
  shows the error gate. The new handle advances the item-detail reader
  generation after it becomes available. Pack retains its selected row and re-reads through that reader
  using current authorized inventory handles/revisions; a removed item falls
  back to the first available row. Ordinary view refreshes do not repeat reads.
  `App.auth.test.ts` covers startup, same-subject renewal (no reconnect),
  drop reconnects, selected-detail recovery (including changed/removed
  selections), subject change after an action, and focus renewal of a lapsed
  token without the auth gate.
- The person picks among their held seats; the module authorizes (ADR-0161
  D-6). One identity may hold up to three seats per world. `GET /v1/account`
  reports every held seat in `seats[]` (ACTOR ids, the ids the seat board and
  the claim/release routes use; the legacy `seat` carries a BODY id and stays
  for older clients). Bootstrap and `refreshHeldSeats` take the held set from
  `seats[]` filtered by slug, without reading the world's board for it; they
  fall back to the `mine` rows of the board (`GET /v1/worlds/{slug}/seats`)
  when `seats` is absent (older API) or the world is in `seats_unread`. Board
  reads after connect only supply hero names (`seats[]` has none) and the
  current world's free heroes, and never block opening. The tab's chosen hero
  is `<slug>/<actor_id>` in `sessionStorage` key `spellkave.play.seat`
  (`src/lib/seats.ts`), also taken from `?actor=<id>` next to `?world=`.
  Bootstrap opens the chosen hero if it is still held, else the first held
  seat (legacy path: the account's seat, then the first `mine` row), else the
  hero chooser. The seat menu's "Switch hero" is shown whenever the session is
  ready: its dialog lists the held heroes ("Switch to") and, when the current
  world has claimable rows, a "Free heroes in <world>" `SeatBoard` ("Claim").
  Claiming calls the claim route, remembers the seat and reopens the session
  as that hero on the same token (no new login); a 409 `seat_cap_reached`
  shows "You already play the most heroes this world allows." inside the
  dialog and keeps the current hero. Any switch reopens the session for the
  chosen actor on the same token, in this or another world, after any
  in-flight action. The hero chooser's claim reconciles a failed claim against
  `seats[]` (the claim landed when it lists `{slug, actor_id}`; other held
  heroes are no error) and only without `seats[]` against the legacy `seat`.
  The choice is a preference, never authority: every world call names the
  actor and SpacetimeDB checks the binding. The app may use navigation
  capabilities to choose a destination. The Worker proxies only the
  `PROXY_ROUTES` allowlist in `src/worker.ts` (account, seat board, claim,
  release-all) so the browser bootstrap stays same-origin; Play does not call
  the per-seat release route. `App.seats.test.ts` covers the choice, the
  switch and the claim.
- Only what the PLAYER tools answer may shape the player view (they read the
  actor-visible `visible_*` projections). No operator catalog, raw world
  table, or god-view fallback.
- Public reference links are a display-only reading aid, not world-derived
  facts: Play may load the static `/compendium/docs/references.json`
  vocabulary from the configured docs origin and annotate matching prose.
  This feed never enters the world session, mock transport, or action path;
  an unavailable feed leaves the original prose unchanged. Sandbox/Creation
  keeps its no world/account/auth network isolation while using the same
  renderer. Reference popovers may additionally fetch the existing public
  `/compendium/docs/catalogue/*.json` artifacts on first opening, without
  credentials or referrer; results are cached for the page lifetime. These
  static reference requests never call a world/account/auth endpoint.
  **The Table stream and the dock read this feed through ONE seam,
  `src/lib/reference-adapter.ts`** (sk-jay0.1.8.63.10): it re-exports what
  `reference-vocabulary.ts`/`reference-preview.ts` already do (the term
  matcher, exact lookup by ref, the catalogue preview fetch) as the
  temporary source behind a `def:<entityDefId>` info card — a stand-in until
  the world grows its own entity/definition read (sk-jay0.1.8.63.11). No
  other file backing the stream or the dock imports
  `reference-vocabulary.ts`/`ReferencePreview` directly any more:
  `DefLinkText.svelte` annotates prose, `info-cards.ts` resolves `def:` cards,
  and `PlaceReference.svelte` reads exact occupant/item refs for detail snippets
  and documentation links. Missing refs show no documentation.
  Other tiles are unaffected and keep the direct path: `Thread.svelte`'s own
  card-level quote (mounted only at Talk/Fight's card density) still uses
  `ReferenceText`/`ReferencePreview` straight against
  `reference-vocabulary.ts`, exactly as before.
- **Table-stream and dock information links are `InfoCardProvider`/
  `InfoLink` from `@spellkave/ui`** (sk-jay0.1.8.63.10), not the older
  `EntityReaderDialog`/`EntityReference` pair (retired — the Place tile's own
  roster still reads world detail through `EntityDetail`/`PlacePanel`
  directly). Place stage uses one keyboard-browsable list and a detail pane;
  its real verb buttons insert a bound sentence and focus the composer without
  dispatching. Arrow browsing and marking an occupant leave the shell draft intact; a click on a
  way out (ways-out menu, Place row, card map, stage map on a place exactly one
  current way out leads to) inserts its bound go
  sentence and never replaces typed words (owner ruling 2026-11-12); map, stream-name,
  turn-order and Pack selection retain their disclosed-target prefill, except
  while a route sentence (a go sentence, a look or sense route, the end of the
  turn) stands in the composer: then the click only selects and the box stays
  unchanged (owner ruling 2026-11-13; `FactShellComposer.test.ts`, "owner
  decisions of 2026-11-13, batch 7"). The key legend names no key while the
  caret is inside a written value and the sentence is blocked (same ruling).
  Opening or
  zooming a map tile never writes to the composer: the canvas boot position is
  not a click (owner ruling 2026-11-12). One
  `InfoCardProvider` mounts at `PlayTable.svelte`'s
  own root, covering both the stream and `PlayDock`; its `resolve` is
  `info-cards.ts`'s `resolveInfoCard`, dispatching on a ref's own kind
  (`occupant:<id>`, `def:<entityDefId>`, `condition:<id>`, `place:<id>`,
  `action:<id>`) — cards are information only, by design (no verb ever lives
  inside one; the composer is the act surface, axiom A1,
  `ledger/designs/play-interaction-axioms.md`). A present occupant's name is
  an `InfoLink` with a visually-hidden "details" word appended (accessible
  name "<name> details") to disambiguate it from `TalkParticipants`' own
  button for the same occupant while Talk is open — `InfoLink` takes no
  accessible-name prop of its own. `PlayTable.svelte`'s `entityNameNode`
  additionally wraps every such name so a click OR a keyboard activation ALSO
  SELECTS that occupant globally (W5: `selection = { kind: "actor", actorId
  }`) — opening the card and selecting are the same gesture; a click inside
  an already-open card never reaches this handler (`InfoCardProvider` portals
  a card's content elsewhere in the DOM). The old per-name `ActionMenu` ("⋯")
  is gone: selection supplies the disclosed target to the shell composer. The
  historical SELECTION hotbar remains for legacy recordings; live detail
  buttons insert a bound sentence instead of dispatching beside a name.
  Opening a card is presentation, not a world-action intent: it emits no RUM
  field of its own (interaction 0, nothing exported) — separate from the
  existing `description_scope=table|item` action-explanation telemetry
  ([`docs/shell-behaviour.md`](docs/shell-behaviour.md)), which observes the Actions palette's own `Description` disclosures,
  never an info card's portalled content.
- `play.spellkave.com` and `world.spellkave.com` are separate origins
  (ADR-0136): `play.spellkave.com` is a plain `WorkersCustomDomain` serving
  the Play SPA from `/` (no `/app` prefix, alias, or redirect), and
  `world.spellkave.com` is the public SpacetimeDB origin the browser connects
  to (`VITE_SPELLKAVE_WORLD_URL`, resolved by `readWorldUrl` in
  `src/lib/play-session.ts`). The Cloudflare Worker owns the whole
  `play.spellkave.com` root — static assets plus the `/api/*` Account-API
  proxy — and never sees database traffic; that goes straight from the
  browser to `world.spellkave.com` over the tunnel, cross-origin (no CORS
  change needed, ADR-0136 D-5).
- Player actions go through the bound PLAYER tools; do not call generated
  reducers or `ActorClient` methods directly here.
- The map tile's card level, and its stage level during a fight, are the
  world's own picture (`spellkave_map`), sanitised by `sanitiseSvg` before it
  is inlined. Outside combat the app requests the current canonical node's
  parent graph; combat leaves graph selection to the tool's tactical-grid
  default (ADR-0052). Play's own read arguments also name the hero's current
  level (`z`, from the scene's elevation; the slice stays the tool's own
  choice), so the card shows the floor the hero stands on; the tool's
  defaults stay unchanged (owner ruling 2026-11-12, sk-jay0.1.8.111). The card
  centres its supplied current-place mark and
  nearby admitted exits. The card shows a place label without its floor
  suffix ("Cellar", not "Cellar (z=-3)"): the renderer writes the suffix as
  `tspan.label-floor` and `PlaceMap` hides that class at card density, so no
  widget parses label text; the stage plate keeps the suffix (sk-jay0.4.21;
  `PlaceMap.test.ts`, `spatial-graph.test.ts` in `@spellkave/world-map`). The
  hosted player MCP renders that SVG, so the card drops the suffix only after
  the MCP is rolled with the new renderer; until then it keeps it, harmlessly. The Place card lists its ways out with direction
  (up to five in full; with more than five, the first four and a "+N more"
  note); a click fills the composer like the dock
  menu, the widget only reports it (owner ruling 2026-11-12, sk-jay0.1.8.99).
  Prompt-answer command text is capped near 24 characters at a word boundary,
  the full label stays in the row (sk-jay0.1.8.94). The map card's SVG plate supports local pan, wheel/button zoom,
  and reset only — those presentation controls neither add a map data source
  nor act or select. Loading/missing/failed maps show the authorized place
  prose and exit names. `PlaceMap.test.ts`, `map-preview.test.ts` and the Play
  map-frame test cover fallback, framing and tactical-mode preservation.
- **Every map only selects or fills the composer; only the composer acts**
  (sk-jay0.1.8.63.13, user ruling 2026-09-19; amended by owner ruling
  2026-11-12, sk-jay0.1.8.99). `BattleMap` runs in `ui-widgets`' own selection mode
  (`onSelectCell`/`selectedNodeId`/`tokens`) — a click, Enter, or Space on any
  cell (own, offered, occupied, out of reach) only sets `PlayTable.svelte`'s
  one shared `selection` (`apps/play/src/lib/selection.ts`); `onStep` never
  fires. `PlaceMap`'s `onTravel`, the MapLibre canvas's `onPlaceClick` on a
  place that exactly one current way out leads to (several: select only,
  confirmed by owner ruling 2026-11-13) and
  the dock's ways-out menu highlight the destination
  place when the exit names one; a Place way-out row marks that exit. Each
  inserts its go sentence into the composer (`detailInsertion`); none calls
  `move`. Enter in the composer sends it. The
  fight turn bar (`Combat` with `selectionMode`) mirrors this: every roster
  chip selects `{kind: "actor"}` instead of opening an inline verb row.
  The hotbar is mounted only for legacy recordings (`legacyActionFallback`),
  a pre-composer answer replay, and the urgent reaction row
  (`PlayDock.svelte`'s `play-dock__row2` branches). For that path,
  `selectionRowFromView` turns the current `Selection` plus the view
  into one `SelectionRow` — occupant(s) on a cell, a free reachable cell
  ("Move here"), a neighbouring place ("Travel to <place>"), the player's own
  cell ("You"), or an honest "Nothing is offered from here."
  `../lib/dock-hotbar.ts`'s `hotbarFromView` is the one further step (axioms
  A1/A4/A6, `ledger/designs/play-interaction-axioms.md`): with a selection,
  the dock's first row shows only that selection's own group; without one,
  HERE and ME. `PlayDock.svelte` renders it via `@spellkave/ui`'s
  `DockHotbar` — never the retired `SelectionRow` widget, and never inside the
  Table stream itself (A3: the stream only tells). In that legacy path,
  pressing a slot calls the existing `act`/`move` paths (`PlayTable.svelte`'s
  `pressSlot`/`selectionAct`), so the outcome lands in the stream exactly as
  any other action's does. In a live session the composer is the act path.
  A selection
  whose row goes stale (the fight ends, the place changes, the actor leaves)
  clears itself. `selection.test.ts` covers the row shapes;
  `dock-hotbar.test.ts` covers the hotbar model; `DockHotbar.test.ts`
  (`@spellkave/ui`) covers the widget; `App.smoke.test.ts` covers the wiring.
- **Exception: the map tile's stage level embeds MapLibre.** Exploring at
  stage level mounts `@spellkave/map-canvas` (the maps app's own canvas,
  extracted as a widget, `MapTile.svelte`) instead of the SVG plate — the one
  deliberate crack in the perception-scoped rule above. The gateway's
  `/w/<slug>/…` style and tile routes authenticate with a bare bearer check
  and serve the whole world (`packages/spellkave-mcp/src/gateway.ts`, "Bearer,
  no seat"), so this one tile is whole-world while every other tile on the
  page stays perception-scoped. Accepted explicitly (operator ruling
  2026-09-02, decision `sk-jay0.1.8.1`) because the player already sees the
  same whole world at `maps.spellkave.com` with the same login — the tile
  reveals nothing new — and the tile carries its own "whole world" sentence
  while the exception holds. That sentence and the tile's "Open the full map"
  link name the site from `VITE_SPELLKAVE_MAPS_URL` (`tryReadMapsUrl`), which
  has three states: unset is the hosted `https://maps.spellkave.com`, an origin
  names another maps site, and `off` shows no link and no site name (local
  worlds; [`docs/local-play.md`](docs/local-play.md)). Owner ruling
  2026-11-12 (sk-jay0.1.8.100): the canvas always draws the hero's own place
  marker and opens at the hero's place; one owner moves the camera, and it
  follows `placeNodeId` reactively (Play turns on the canvas's opt-in
  `followPlace`; a follow is not reported as a pick, and the maps app leaves
  it off). Play shows no "Substrate" control: the
  canvas offers it only through an opt-in prop that Play leaves off, while the
  maps app keeps it. The gateway answers a glyph range it does not have with
  an empty 200 PBF rather than a 404 (cached for minutes; a read error is a 500). Load time is measured, not optimised, in
  that change. Ends when `sk-adr8.15` (seat-scoped tiles) lands;
  `sk-ubx` carries this play-side rule and must be revisited then. Nothing
  else may widen this exception. `VITE_SPELLKAVE_GATEWAY_URL` (`.env.example`)
  gives the canvas its gateway origin, read the same way
  `apps/maps/src/lib/env.ts` reads its own copy of that var
  (`src/lib/env.ts`'s `tryReadGatewayUrl`); unlike `apps/maps`, a missing or
  invalid origin degrades to the tile's own blocked state instead of failing
  the whole app closed — this one tile is one of five, not the entire page.
  The staged profile TOML carries the world connection, not the gateway.
  Local co-play must point this variable at its local gateway; a hosted default
  does not serve the staged database. See the local gateway recipe in [`docs/local-play.md`](docs/local-play.md). The same
  variable is also the origin `src/lib/feedback.ts` posts `tools/call
  spellkave_feedback` to (`<gatewayOrigin>/mcp`) — unset, the seat menu's Send
  feedback opens an explanation that nothing was sent. Setting
  `VITE_SPELLKAVE_FEEDBACK_ENABLED=false` also selects this state while retaining
  the gateway for maps/art (`App.smoke.test.ts` covers the separate capability).
  The unavailable state
  is readable after a click, rather than hidden in a disabled button's tooltip.
  `.github/workflows/play.yml`'s hosted Build step sets it from the repo
  variable `SPELLKAVE_GATEWAY_URL`, defaulting to `https://mcp.spellkave.com`
  (sk-jay0.7.45; same pattern `maps.yml` already used) — the gateway's
  `allowedOriginHostnames` (`infra/phobos-player-mcp/workloads.ts`) already
  lists `play.spellkave.com`, so no infra change was needed to accept it.

## On-demand references

Read the matching file before you touch its area; each is a verbatim move
out of this file.

| Before you touch… | Read |
|---|---|
| `play-dev-local`, `play-gateway-local`, `play-rum-local`, `src/lib/dev-local.ts`, local maps/subject art | [`docs/local-play.md`](docs/local-play.md) |
| `src/lib/play-telemetry.ts`, RUM (`play-rum.ts`, `_rumdata`), the connect lifecycle, any new telemetry field | [`docs/telemetry.md`](docs/telemetry.md) |
| Activity/turn detail, the Table stream filters, feedback, item/field readers, `playground.html`, `demo.html`, `check:no-scroll` | [`docs/shell-behaviour.md`](docs/shell-behaviour.md) |
| Playground recordings | [`docs/recordings.md`](docs/recordings.md) |

## The client action trail

`src/lib/play-trail.ts` keeps a bounded (~100 entries), redacted ring buffer
of what the client did and saw — one entry per player-issued write (`act`),
per completed view refresh the player's own action asked for (`read`), per
view refresh the world pushed unprompted (`world_pull`), per mosaic tile
settling on a new level (`layout`, recorded only from `PlayTable.svelte`'s
own layout-mutation sites, never a drag's or a pinch's in-flight frames),
and per failed tool call (`tool_error`). `play-session.ts` and
`PlayTable.svelte` both record onto the one module-level `playTrail`
singleton, so `window.__spellkavePlayTrail` (a read-only getter; nothing
external can write through it) always reads the same trail no matter which
file caused an entry. Every free-text field is scrubbed of bearer strings,
JWTs and other opaque long tokens before it ever reaches the buffer —
`redactTrailText`'s own unit test is the proof, not a review checklist item.
`console.debug` mirrors each entry under a `"play"` prefix only when
`import.meta.env.DEV` is true, so a production build never logs the trail;
the trail itself still exists in production, since it is the client half of
the feedback report (the feedback-button bead reads
`window.__spellkavePlayTrail`, sk-jay0.1.13).

## Verification

```bash
pnpm --filter @spellkave/play run typecheck
pnpm --filter @spellkave/play run test
pnpm --filter @spellkave/play run build
pnpm --filter @spellkave/play run check:no-scroll
```
