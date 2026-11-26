# Play telemetry: local run-events and hosted RUM

Paths in this file are relative to `apps/play/` unless they are links.
Split out of [`../CLAUDE.md`](../CLAUDE.md), which lists when to read it.

## Local run-events telemetry (`world_actor_run_events`)

`src/lib/play-telemetry.ts` (sk-jay0.6.39) is the browser producer that turns
every `play-trail.ts` entry into one `agent-run-events/v1` line and posts it
as OTLP/HTTP logs — the same stream, envelope shape and disclosure
discipline the NPC/actor hosts and the MCP gateway already write
(`.agents/skills/sk-o11y/references/instrumentation.md`).
`play-trail.ts`'s singleton wires the producer on via one generic `onEntry`
callback option (`createPlayTrail`'s exporter hook), so `play-trail.ts`
itself stays framework-free — only the singleton at the bottom of that file
touches Vite/env config, matching the pattern its `debug` flag already used.

Local/dev only, off by default: `enabled` requires
`VITE_SPELLKAVE_RUN_EVENTS=otlp` (or the non-prefixed `SPELLKAVE_RUN_EVENTS`),
a configured `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT`, a non-empty
`SPELLKAVE_WORLD_SLUG`, and `mode !== "production"` — all resolved server-side
by `vite.config.ts` and handed to the browser as `{enabled, worldSlug}`
through the `virtual:spellkave-run-events-config` module (the same "real
module, not `define`" idiom `virtual:spellkave-dev-local` uses, for the same
reason: Vite 8 does not text-substitute a bare-identifier `define`). The
collector endpoint itself never reaches the client bundle — the browser only
ever POSTs to the relative `/otlp` path, which `vite.config.ts`'s
`server.proxy` forwards to `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT`, so this is a
dev-server-only path with no production route. Hosted Play uses the separate
RUM producer below; the two transports never share tokens or endpoints.

Play does not reuse `@spellkave/agent-observability`'s
`OTEL_SAFE_EVENT_DATA_FIELDS`/`createOtlpHttpSink` — those are a fixed
allowlist that doesn't carry Play's own fields (`tile`, `level`, `trigger`,
`client_kind`). `play-telemetry.ts` projects through its own local,
scalar-only allowlist instead (with a second, independent redaction pass on
every string field — belt-and-suspenders on top of `play-trail.ts`'s own
`redactTrailText`), and reuses only `toOtlpPayload` (the resource/scope
wrapper, which never touches event data) so the exported `service.name`
matches every other producer. Local recipe + a copy-paste `sko11y` query:
[`../../docs/development.md`](../../../docs/development.md#local-play-run-events-browser-producer).
Schema card: [`../../.agents/skills/sk-o11y/references/querying.md`](../../../.agents/skills/sk-o11y/references/querying.md#plays-own-local-co-play-rows-driver--play-web-sk-jay0639).

## Hosted browser RUM (`_rumdata`)

`src/lib/play-rum.ts` (sk-jay0.6.40) initializes the OpenObserve browser RUM
SDK in a production build with all three build inputs present:
`VITE_SPELLKAVE_RUM_APPLICATION_ID`, the public
`VITE_SPELLKAVE_RUM_CLIENT_TOKEN`, and `VITE_SPELLKAVE_RUM_VERSION`. It starts
with tracking consent withheld. After the Account API has resolved a user and
world, `App.svelte` passes that context to the producer, which sends only
`sha256(sub)[:16]` plus the validated world slug to the SDK and then grants
consent; logout withdraws consent and clears that context.
Ordinary dev-local and tests remain silent even if their shell inherits the
public build variables. `just play-rum-local` is the explicit local exception:
a staged profile and diagnostic flag enable the same SDK through a loopback
relay with `local-*` labels and 100% sampling; production uses
`VITE_SPELLKAVE_RUM_SESSION_SAMPLE_RATE` (unset ⇒ 100% during beta).

Every finalized Trail entry becomes one custom RUM action, and every
`play-observation.ts` UI milestone becomes another — mechanics (the single
`emit()` call site, what fields it adds, the closed-scalar allowlist, and the
same-PR checklist for adding a new phase/state) are in
[`../../../.agents/skills/sk-o11y/references/instrument-play-rum.md`](../../../.agents/skills/sk-o11y/references/instrument-play-rum.md);
this section covers only what is Play-UI-specific. `App.svelte` records intent
before dispatch and feedback presence after Svelte's `tick()`; `play-session.ts`
records tool results before awaiting the view refresh. Interaction numbers
are passed explicitly, so a concurrent inventory selection cannot steal a
write's correlation. Counts and selection ordinals describe structure, not
the wording of the selected option. Conversation counts and the derived dialogue
flag distinguish a shrinking transcript from a switch out of Talk. The
`presentation` milestone is emitted by
PlayTable: `conversation_mounted` and `conversation_lines` report whether a
transcript is showing (an open dialogue, or a fight with thread lines) and
its current card/filter window, including while Fight is active — at card
OUTSIDE a fight this is still `Thread.svelte`'s own last-two-lines/filter
window; at stage, and now at card DURING a fight too (sk-jay0.1.8.63.13:
`Thread` no longer mounts there — the fight's own turn bar, the SAME shared
stream, and the one live selection row do), Talk, Explore and Fight all mount
the SAME Table stream (`exploreStreamFromView` + `PlayTable.svelte`'s
`ActivityFeed`), so `conversation_lines` there counts that stream's own
speech entries under the active speaker filter, not a separate Thread
transcript — `thread.lines.length` remains the truth PROXY for
`conversation_mounted` even where its own lines no longer render directly,
exactly as stage's pre-existing approach already worked. They do not report
viewport intersection or whether the player read a line. Typed result
classification, admission and awaiting-response fields preserve diagnostic
meaning without error text. Feedback has separate opened/unavailable/sending/
sent/failed/rate-limited/closed milestones; the boolean feedback field on a
move/act/react/end-turn milestone means only that the Table stream is mounted
or the dock's one notice (`DockNotice`) is — never that the player read it. An
act's outcome, a refusal included, is a stream line in every scene
(sk-jay0.1.8.63.13; a quiet outcome inside an open dialogue is skipped, the
world's own speech lines carry it); the notice reports only a reconnect and a
slow world. The dock notice sits
fixed above the composer, outside the Table's own scroll body, so expanding
actions cannot push it below the fold. One catch-up control — the Explore
stream's own pill — now serves every scene at stage (sk-jay0.1.8.63.1 Part B:
entering or leaving a conversation never swaps the list renderer or the pill),
occupying its own row outside that scroll body so it cannot cover an answer
button. Pin/unread bookkeeping lives in one shared controller,
`src/lib/follow-scroll.svelte.ts` (`createFollowScroll`): PlayTable's own
instance drives the one stage stream in every scene now; `Thread.svelte`
keeps its own instance too, but PlayTable mounts `Thread` at `density="card"`
only (card never scrolls, so that instance is inert there), and its
`density="stage"` auto-follow shape is exercised directly by `Thread.test.ts`
rather than through the live Table tile (`follow-scroll.svelte.test.ts`
covers the controller itself).

Non-speech world events are stream lines too, in every scene, not only a
fight (sk-jay0.1.8.63.2) — the Table stream is no longer speech-plus-own-acts
only: the stream shows hits,
conditions, session lifecycle, turn transitions, xp or reaction windows.
Two ingest rules narrow that (`appendPlayChronicle`; details in
[`shell-behaviour.md`](shell-behaviour.md)): the lifecycle and turn lines of
a session whose only participant is the hero (travel) are dropped, and the
hero's own condition changes of one refresh and tick fold into one entry
that lists its ids in `fields.conditionIds`. Neither adds a telemetry field
or a RUM milestone. The order of the events inside one drain is the SDK
builder's (hit, spend, xp and condition events oldest first, a session close
last, owner decision 2026-11-12); Play does not re-sort it, and a spend
whose `source_entity_ref` names another entity is no longer delivered (a
radius-applied change carries the hero's own id as source and stays, see
[`unified-world-event-stream.md`](../../../ledger/designs/unified-world-event-stream.md)).
`exploreStreamFromView`'s own `"event"` entries reuse the Chronicle's own
classification (`chronicleFactsFromEvents`, play-chronicle.ts) for a chip and
an importance flag — one table, never a second copy of it. The line itself
is Play's own sentence from the entry's structured fields
(`chronicleSentence`), with names resolved at ingest; no link is wired on a
named actor (see [`shell-behaviour.md`](shell-behaviour.md)). Because
`view.events` is only a bounded 40-entry ring (`PLAY_CHRONICLE_LIMIT`),
`PlayTable.svelte` accumulates every event it has seen this visit into its
own bounded visit array, and retains speech text the same way rather than
depending on the transport's 40-line speech ring; it passes these arrays in. The derivation
itself stays pure and never reads `view.events` directly. Ordering on a tied
tick is a place divider, then speech, then an event, then a local activity.
The one narrowing is local against local: two local entries on one tick that
both carry `recordSeq` (a place divider, an own activity row) keep their
recorded order. Only an own entry recorded before a divider of its tick
moves, to directly above that divider; the divider, speech and events of the
tick keep the order above ([`shell-behaviour.md`](shell-behaviour.md)).
An own act's local activity line drops its own outcome body — keeping only
its heading — when a `dealt_hit`/`dealt_condition` world event on the same
tick already narrates the same target: the event line carries the real
numbers, so it wins, and the two never repeat the same fact twice. A refused
act is exempt: its own reason always stays, and a refusal never produces a
matching event anyway. A live tactical session mints a fresh place id per
grid cell (`hasTacticalSession`, play-table.ts), so no place-arrival divider
is recorded while it holds — the session's own `session_lifecycle` event
line already reads as the fight's opening moment, for free, once step 1's
event entries exist at all.

Conversation compaction only suppresses handles actually represented by a
visible chip or the main composer's targets. Unanchored choices, filtered-out
chips and alternate speech handles remain in the central action fallback
(`App.smoke.test.ts`), using the same action transport and authored handles.
`rum timeline` reports missing milestones
as unknown; a DOM commit does not prove a player saw pixels.
Full-detail field measurements use the same `presentation` phase, with a
closed `surface` enum for hero vitals, quests, conditions and selected item
detail. `supplied_fields` is captured before mapping (plus explicit SRD sheet
supplements); `represented_fields` counts the widget's rendered value slots,
and `disclosed_fields` excludes content behind closed disclosures. The full
detail measurement is `closed` outside stage even if a compact card shows a
subset. Missing source counts remain `unknown`, not an empty successful read.
Item state distinguishes loading, ready, empty and failed combined detail/action
reads. Counts are deduplicated until structure, disclosure, state or selection
ordinal changes; no value changes or DOM content are exported. This covers
specified field groups, not every hero field or physical viewport visibility
(closed-scalar rules for all of the above: the instrumentation reference
linked above). Production session sampling defaults to 100% during beta;
replay, profiling, automatic click/resource capture and SDK error rows are
off. Input privacy remains `mask-user-input`, URLs lose their query/fragment,
and the SDK session exists only in memory.

The public-token and edge decision is binding in [`../../SECURITY.md`](../../../SECURITY.md#public-play-rum-decision-sk-jay0640):
`/rum/*` is the only anonymous telemetry path, restricted to the hosted Play
Origin and a per-IP Cloudflare rate limit before OpenObserve validates the RUM
token. Do not substitute an OTLP/Access/service credential. Query card:
[`../../.agents/skills/sk-o11y/references/querying.md`](../../../.agents/skills/sk-o11y/references/querying.md#hosted-play-rum-custom-actions-sk-jay0640).

### Connect lifecycle (`play_connection`, sk-jay0.6.38.25, hardened by the #3477 and #3482 RUM-lane reviews)

`play-observation.ts`'s `createConnectionObserver` gives each connect attempt
one `ConnectAttempt` handle from `loading` to exactly one terminal
(`connected`, `error`, `no_seat`, `world_not_ready`, `world_starting`,
`world_start_timeout`), with `stalled` a non-terminal warning and `first_data`
(sk-jay0.1.1.14) a one-shot milestone that can only follow `connected` — the
first non-empty `PlayView` this attempt's session delivers (`viewHasData`:
any of actions/exits/occupants/pack/events/speech > 0), closing the gap
between "transport connected" and "world data visible" that #3487 found.
`App.svelte`'s `onView` calls `thisAttempt.firstData()` once per attempt; the
full contract — the terminal list, `stop()`/`abandon()`, and the two remaining
documented gaps (a superseded attempt, and a tab/browser close mid-attempt) —
is
[`../../.agents/skills/sk-o11y/references/instrument-play-rum.md`](../../../.agents/skills/sk-o11y/references/instrument-play-rum.md#connection-lifecycle-contract).
Milestone sequences and `bin/sko11y` query recipes:
[`../../.agents/skills/sk-o11y/workflows/hosted-play-rum.md`](../../../.agents/skills/sk-o11y/workflows/hosted-play-rum.md#connect-lifecycle-play_connection-sk-jay063825).

`connected` is driven by `@spellkave/session`'s `openSession` `onPhase` hook
(`packages/spellkave-session/src/session.ts`), not by the first rendered
view: it fires on the `factual_context` phase, the last of `ready` → `setup`?
→ `resolve_actor` → `factual_context`. `ready` and `factual_context` are
each bounded at 30s (`PLAY_CONNECT_PHASE_TIMEOUT_MS`) for Play specifically —
**opt-in**, not a package-wide default: every other `openSession` caller (the
Pi/MCP session daemon, npc-brains' drive loop, `orient-adventure`, the NPC
seat) keeps these two awaits unbounded unless it passes its own value,
exactly as it did before sk-jay0.6.38.25 first shipped (the #3477 review
caught that the original bead had made 30s the default for every caller, not
just Play — a cold or throttled world, e.g. right after a roll plus world
re-load, would have turned their previously-patient awaits into a hard
startup failure). A live hosted connect measured ~10s wall-clock end to end,
well under Play's 30s bound, with headroom for the NPC host's cold/CPU-throttled
connects too if it ever opts in; `setup`/`resolve_actor` stay at the existing
4s default for every caller (unchanged by either bead). A phase timeout
throws `OpenSessionTimeoutError` with a `.phase` field; `play-session.ts`
wraps the top-level `openSession(...)` call in its own try/catch so a
pre-`live` failure still reaches `OpenPlaySessionArgs.onError` — previously
it propagated straight past `onError` with no RUM trace at all. No numeric
WebSocket close code is exported: the vendored SpacetimeDB SDK's
`onDisconnect`/`onConnectError` callbacks only ever receive a normalized
`Error`, never a close code.
