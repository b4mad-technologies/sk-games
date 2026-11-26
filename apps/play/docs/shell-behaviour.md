# Shell behaviour and reviewing the shell without a world

Paths in this file are relative to `apps/play/` unless they are links.
Split out of [`../CLAUDE.md`](../CLAUDE.md), which lists when to read it.

Ongoing activity details are read through the participant-scoped
`spellkave_session_status` detail mode. `ActivityStatus` is a display-only
shared widget: it opens a `FieldDetail` reader and renders reported world-tick
estimates without inferring completion or globally blocking the page. The
selected detail remains attached to its observed session id through terminal
phases; an admitted travel receipt can select the supplied new id. Ongoing
pages and selection use only ids/cursors returned by the authorized tool.
Selection generations discard superseded reads. Cache events refresh first;
a five-second fallback polls pending/failed activity reads when no recent view
refresh arrived, resets stale cursors, and stops on disconnect. A failed detail
read remains visibly unavailable rather than becoming an empty successful read.

The compact turn selection has its own authorized detail, independent of which
activity reader the player selected. Live Fight/tactical framing requires that
detail to describe a non-timed Sequential session and a current authored combat
offer. A world-timed or unclassified session stays in the generic activity
surface; it does not acquire an End turn button. Combat-group offers without
that live session stay in Explore or Talk with their own target identities;
availability is not a fight, hostility, or a one-hit outcome. This does not
establish global action admission, paused-clock status or a wall-clock arrival
time. Existing PLAYER offers remain the action source. Model, transport and shared reader
tests cover precision, terminal tracking, selection boundaries and timer cleanup.
Activity presentation telemetry records bounded lifecycle categories, mounted state
and displayed progress, without session identifiers or prose. Mounted state does
not establish viewport visibility; elapsed estimates do not establish completion.
The detail reader labels participant identity independently of action admission,
including after a session ends.
For a pending world-timed activity, repeated successful reads of the same tick
for at least ten seconds show that no newer world time has been observed. A new
tick, failed detail read, changed activity or terminal phase resets that observation.
This notice does not diagnose an explicit server pause or turn elapsed browser
time into progress. It has a bounded RUM flag separate from lifecycle.

Play remembers a refused attempt against its observed manipulation revision,
turn (session, lifecycle, current actor and own-turn flag), and effort spends
and budgets. An identical refresh retains that refusal; a changed turn or effort
window permits the same draft to reach the authoritative action tool again.
This comparison is local to the Play session. It does not evaluate admission
or use the advancing world tick as a retry timer. `play-session.test.ts` covers
spent-effort refusal followed by the next own turn, including a fast cycle
whose intervening opponent turn was not observed.

The Chronicle tile has folded into the Table stream (sk-jay0.1.8.63.4.1).
The mosaic has five tiles. All, Fight, Conditions, Speech, Comings and goings, and Things
filters sit above the stream; the reader's choice survives scene transitions.
All clears both category and speaker filters. Complete speech text is inline,
so the former folded-burst reader and cross-tile navigation are retired.
The stream admits every authorized retained speech line, including backfill
from departed speakers, at its original tick. It retains the existing bounded
visit history (up to 1,000 speech lines, local activities, dividers and observed
events per kind); this is not a persistent history API. World-event categories
still come from CHRONICLE_KIND_RULES. The Conditions chip uses only the
self_condition_changed and dealt_condition event kinds. Local speech belongs to Speech, other
local acts to Things, and place dividers to Comings and goings.
App.smoke.test.ts proves retained absent-speaker text, filter round trips,
five-tile rendering and world-event retention across fight transitions.

Event lines are Play's own sentences, built from the event's structured
fields (`chronicleSentence`, `src/lib/play-chronicle.ts`); they show no entity
id and no template id. Actor names are resolved once, when the event is
ingested, from the scene and roster of the same refresh; the hero reads "you",
an actor no read of that refresh names reads "someone" or "something". One
exception fills that gap for a hit taken: a `self_hit` event may carry
`attacker_name`, the name its producer resolved when the hit happened
(optional, owner decision 2026-11-12, sk-jay0.1.8.96). A name the refresh's
own reads disclose wins; the event's name is used only when they have none,
and an event without it still reads "from something". Play keeps its own
damage sentence ("You take 4 damage from Cellar Rat — 7 HP left."); the shared
renderer's line is not shown. An
entry without structured fields (a fixture or an older recording) keeps its
supplied summary. `play-chronicle.test.ts` pins this over every non-speech
event kind.

A heard speech line that arrives without a speaker name keeps the name Play
learned for that speaker earlier this visit (owner decision 2026-11-12,
sk-jay0.1.8.96). Names are learned only from named `speech_heard` events, in
one per-visit map in `play-session.ts`, and applied at ingest in one pass in
event order (`speechFromEventsRemembering`), so a name only ever reaches a
later line, never an earlier line of the same batch; the world's own name always wins
and the fallback stays "Someone". The memory serves speakers only: it does
not name actors in other event lines or backfilled trace lines, and a
reconnect drops it. `play-view.test.ts` and `play-session.test.ts` cover it.

Two local stream entries on one tick keep the order they were recorded in
(owner decision 2026-11-12, sk-jay0.1.8.96): an own attempt made before
leaving reads above the divider of the place then entered. `PlayTable.svelte`
stamps every place divider and every own activity row from one shared record
counter (`recordSeq`), and `exploreStreamFromView` uses it for local against
local ties only. Only the own entry recorded before a divider of its tick
moves: it goes directly above that divider. World lines (heard speech, world
events) are never re-sequenced: they keep their order and stay below the
divider of their tick, so a line heard on arrival never reads above the place
it was heard in, and an own entry recorded after the arrival stays below
them. Play has no recorded order between a local entry and a world line on
one tick; the attempt made before leaving reads above that tick's world
lines only because the tie order already files those under the place
entered. `play-table.test.ts` covers the rule, `App.smoke.test.ts` the shared
counter.

The stream does not tell the session machinery of a walk (owner ruling
2026-11-12, sk-jay0.1.8.96). A session whose only participant is the hero (a
long move) shows no open, turn or close line: `appendPlayChronicle` drops
them at ingest. Play remembers the session id from the open row, because the
close row names no participants, and `play-session.ts` carries that set
across refreshes. A session already running when the page connects (a
reconnect or reload during a walk) has no open row here: `play-session.ts`
remembers it once, from its first read, when that read's roster is the hero
alone. A session with anyone else, or with one participant who is
not the hero, keeps its lines. When someone joins a remembered session later
(the world sends no second open row), the first turn line that names anyone
but the hero ends the hiding: that line and every later one show, the lines
already dropped do not come back. A hero-only session that opened before the
page connected is not recognised, so its turn and close lines still show.
`play-chronicle.test.ts` and `play-session.test.ts` cover the rule.

The hero's own condition changes of one refresh and one tick fold into one
line ("You are now affected by Poisoned and Prone."). Applied and removed
conditions fold separately; other ticks, other refreshes and conditions the
hero dealt stay separate lines. Only a run folds: any other event between two
condition rows (a second hit of the same tick) starts a new line, so a
condition never reads ahead of the blow that caused it. The line leads with
the first row the world delivered in that run, and the folded entry lists
every id in `fields.conditionIds`. The stream's event order inside one drain is the SDK
builder's and Play does not re-sort it: hit, spend, xp and condition events
come oldest first by event id, and a session's close line comes last (owner
decision 2026-11-12, recorded in
`ledger/designs/unified-world-event-stream.md`, private monorepo).
A spend whose source names another entity is not delivered at all, so it has no line (a radius-applied
change carries the hero's own id as its source and keeps its line). Going down reads as one plain sentence instead of the
list (owner decision 2026-11-12, sk-jay0.1.8.102): an applied group whose ids
include `srd/condition/unconscious` (`DOWNED_CONDITION_IDS`, an exact id, no
label parsing) reads "You fall unconscious." (`playCopy.stream.fellUnconscious`).
A single unconscious row counts as a group of one. A removed group and every
group without that id keep the list sentence. `play-chronicle.test.ts`
covers the fold and the sentence; `App.smoke.test.ts` covers only how an
already folded entry renders as one stream line (its fixture is folded by
hand).

The Table head names one scene, by priority: Reaction, Fight, Down, Talk,
Activity, Explore. Down holds while the hero's condition list carries
`srd/condition/unconscious` (`heroDownedFromView`, `src/lib/play-table.ts`:
an exact id, no label parsing, no hit-point check). It sets the scene label,
the head glyph and the card's summary line, and the composer's help line
reads "You are down and cannot act right now." in place of its "press Enter"
hints, and in the empty box when no question is open. A world answer, a
blocker ("choose a target"), a "fill in" hint, a default-suggestion line and
an open question keep their place ahead of it. The text box stays usable and an attempt is still sent, because only
the world decides what a downed hero may do. Going down adds no dock notice.
A fight or a reaction window still outranks Down in the head; the composer
line shows in every scene. `play-table.test.ts` covers the fact,
`FactShellComposer.test.ts` the help line, `App.smoke.test.ts` the head and
the dock together (the card summary line has no test).

An attempt that carries input-field values is an activity row, not speech:
its heading is the action's label and its body lists the entered values as
"Label: value" ("Name: Brannoch"), followed on a second line by a refusal or
other outcome. The values travel as `utteranceFromInputValues` shapes them
(one utterance field as its bare text, several as one JSON object); that
transport text is never shown, and the world's own echo of it is dropped.
Free speech keeps its bubble. `play-table.test.ts` covers the row,
`App.smoke.test.ts` the dispatch and the stream.

Play stops an incomplete attempt in two places, and neither sends anything.

The composer stops it first (`attemptBlock` in
`src/components/FactShellComposer.svelte`). Enter or Attempt does nothing but
show one sentence from `playCopy.attemptBlock` in the help line; the text in
the box is kept. The composer-side stops are: a word that is typed but not
picked, no action or no target, a required field without a value (the
sentence names the field by its label and shows its `name:"…"` spelling,
`fieldMissing`), a loose word beside a form action (`strayForField`; a
number field echoes the word only when it is a number), and
words outside quotes beside a speech action (`quoteWords`; `oneQuote` when a
quoted part is already there or there are two, because only one is sent). Words outside
quotes are never wrapped or sent by Play, and because Enter stops in the
composer this case never reaches the session's repeat-refusal check.
`FactShellComposer.test.ts` covers each stop; `App.smoke.test.ts` proves that
unquoted speech makes no world call and quoted speech makes one.

The session is the backstop for a caller that bypasses the composer. An
attempt it stops (a required field is empty, the composer's own check fails,
or the same refused attempt is repeated with nothing changed) throws
`PlayAttemptBlockedError` from `src/lib/play-session.ts`
with a sentence from `playCopy.session` (`src/lib/player-copy.ts`). `App.svelte`
maps it to the status kind `blocked`: the composer's status line shows the
sentence followed by "Not sent — your words are kept.", and the stream gets no
line, because nothing reached the world. Any other thrown error keeps the kind
`failed` and reads "Result unknown — …". `play-session.test.ts` covers the
thrown sentences, `App.smoke.test.ts` both status lines.

All player input goes into the one composer text box (owner ruling
2026-11-12; axioms in `ledger/designs/play-interaction-axioms.md`). An explicit
completion (a picked suggestion, grey text taken with Right, a Place Insert, a
way-out click) may append one empty template at the end and put the caret in
it: `name:""` or `str:` for the first missing required field of a form action,
`""` for a speech action once its target is in the sentence. Typing alone
never inserts, and Play never fills a value. While a form action is in the
sentence its unfilled fields are listed first under "Fill in" and the next one
is the grey text after a space.

The finder does not list a generic answer slot ("Answer 2") on its own (owner
ruling 2026-11-12, sk-jay0.1.8.94). An action that carries the authored
response-slot marker (`responseSlot`) is a row only as the named answer of an
open, unconsumed question. The filter sits where `FactShellComposer.svelte`
builds its candidates and reads only the marker, never a label or an action
id; `composerActions` still returns every action. It is presentation, not an
eligibility check. A hand-typed `/answer-2` with no open question matches
nothing and sends nothing. `FactShellComposer.test.ts` and
`App.smoke.test.ts` cover both states.

The command text of a prompt answer row is capped near 24 characters at a
word boundary (owner decision 2026-11-12, sk-jay0.1.8.94); the row keeps the
full label. Two capped answers of one prompt that would read the same get a
number suffix (`-1`, `-2`), so a capped text can reach about 27 characters.
Actions and ways out are not capped. `promptAnswerShellTexts`
(`src/lib/fact-composer.ts`) builds the texts; `fact-composer.test.ts` and
`FactShellComposer.test.ts` cover them. The uncut spelling stays findable: a
capped answer row carries it as `searchText`, which the finder matches but
never shows or inserts, so typing on past the cut (the way to tell two capped
answers apart) still finds the row and Tab inserts the capped text
(`shell-finder.test.ts`).

A bare trigger character (`/`, `@`, `#`) is not a token the player wrote. The
help line then asks for the pick ("What do you do? ...", "Pick an answer: ...",
or the target question) and does not say that `"/"` is not picked yet; the
"is not picked yet" sentence is kept for a token with at least one character
after the trigger. A click-filled name behind a bare `/` also drops the grey
suggestion, so the box never shows a complete-looking command that is not
there (owner ruling 2026-11-12; `FactShellComposer.test.ts`, "drops the grey
suggestion when a clicked name lands behind a bare slash").

Grey text inside empty quotes is drawn only while the caret waits between
them: the drawing shifts every later letter, and the real caret would no
longer sit where the letters appear.

The right side of the help line is a key legend. Its states: something
is still to pick (`Tab pick · → take grey text · ↑/↓ browse`), the list is open
(`↑/↓ move · Enter or Tab put it in · Esc close`), nothing blocks
(`Enter send · Tab more choices`), written words are missing or misplaced
(`↑/↓ browse`, led by `→ take grey text` while a field is ghosted), the
caret is inside quotes or a field value and nothing blocks (`Enter send`),
and the caret is inside a value while the sentence is blocked (no legend at
all; owner ruling 2026-11-13). The last three name no picking key:
`FactShellComposer` passes the state (`legend`), and inside a value no
completion is offered (no list, no grey text, no arrow browse) and Tab stays
native, as it does with no candidates. A blocked sentence sends nothing on
Enter either, so the legend there is empty and the blocker on the left speaks
alone. This holds for every blocker inside a value (a pick still missing, an
empty needed detail, a quote rule), not only a missing pick. The browse,
put-in and send labels come
from the active keymap; Tab and → are fixed text. The legend only describes
keys; it never changes what a key does. Picking never
sends. `ShellComposer.test.ts` covers the states and a rebound key;
`FactShellComposer.test.ts` covers which blocker picks which state.

Both stream containers (`.table-explore-stream` at stage, `.table-card-stream`
at card level) scroll through `@spellkave/ui`'s `.sk-stream-scroll`, which
supplies the end padding that keeps the scrollbar off the bubbles and a
bottom inset; `src/styles.css` only sizes them. The scrollport has no top
padding (sk-jay0.1.8.110): a scrollport clips at its padding box, so a top
padding left a band right under the filter bar in which scrolled rows stayed
visible. The gap between the filter bar and the stream is a margin on the
host (`.table-explore-shell` at stage, `.table-card-stream` at card level),
outside the clip. `@spellkave/ui`'s `styles.test.ts` pins the bottom-only
inset and `App.smoke.test.ts` pins that neither Play container adds padding;
no test lays the stream out, so the scrolled picture needs a browser check.

A tile's head button opens the tile to fill the mosaic; on a filling tile it
reads "Shrink" and returns to the overview (owner decision 2026-11-12,
sk-jay0.1.8.102). The overview is the last arrangement that had no filling
tile, a dragged one included, or the rest layout when there is none. Opening
a second tile from a zoomed one does not replace it, so one Shrink never
lands on another zoomed tile. Reset layout and a breakpoint change forget it.
`App.smoke.test.ts` covers the round trip.

While the hero is still being drafted, HP, AC and XP are hidden instead of
reading 0 (owner decision 2026-11-12, sk-jay0.1.8.102): the You tile's head
falls back to the hero's name, the card and the stage sheet leave the three
figures out, and the dock's You status shows conditions only. The signal is
the world's drafting condition id `dm/creation/drafting`
(`HERO_DRAFTING_CONDITION_ID`, `hideDraftVitals` in `src/lib/play-view.ts`),
never a label; a level-up draft hides nothing. This is temporary until
sk-jay0.1.8.108 gives the world its own signal. `play-view.test.ts` and
`play-session.test.ts` cover the rule, `PlayDock.test.ts` the dock and
`App.smoke.test.ts` the tile and the sheet.

The shared `ActivityFeed` readable option bounds transcripts to a left-aligned
46rem column at card and stage densities. `SpeechBubble` fits supplied text,
with outgoing lines aligned to the right. Consecutive speech hides the repeated
speaker heading only when the structured speaker id and direction agree;
unknown identity or any intervening entry starts a new heading. Reloaded own
speech retains its supplied text as the bubble body. The synthetic
`stream-detail` demo and App render tests cover renamed/equal-name speakers,
consecutive lines, outgoing speech and event interruption. Place headers
scroll in normal flow with speech (owner decision 2026-11-04, "1 A, 2 A, 3 A").
The current place remains visible in the dock status. The isolated headless
scroll check verifies static positioning and matching scroll displacement.

Play feedback always requests the standard diagnostic report and attaches its
bounded client trail, viewport and layout, plus the RUM run id and whether the
SDK sampled the session (`playRumProducer.diagnostics()`). The GitHub issue
renders both and, for a sampled run, a `bin/sko11y @otel rum timeline` command with an
absolute window around the submission time. `FeedbackDialog` explains this before
Send and has no attachment toggle. `submitFeedback` stops before submission if
client diagnostics cannot be collected, and checks the gateway's
`include_report` success field before showing success. The shared MCP tool
still accepts an optional report for its other callers. Collection failures,
gateway failures and an unconfirmed attachment remain visible in the dialog;
the last case tells the player not to resend an already recorded message.
Contract and UI coverage live in `feedback.test.ts` and `FeedbackDialog.test.ts`.

Authored explanations use shared readers from `@spellkave/ui-widgets`.
Pack selection keeps the inventory handle separate from the authorized item
entity id. Its detail read joins current locally composed candidates for Item
and Entity targets, plus independently disclosed participant bindings. Superseded or
cancelled selections discard late responses. A global combat offer is not
evidence that the selected item participates, so it does not create an
item-specific Table link. Other-target routing requires an authorized concrete
item relationship; do not infer one from names, action groups or provenance
strings. `play-item-selection.test.ts` and the Pack smoke tests cover these
identity and selection boundaries.
Async map and item updates retain the latest published view before notifying
the app. A delayed map response cannot clear completed item details or restore
a cleared selection; controlled map-completion tests cover both orderings.
The map tile keeps showing its current picture while the same graph and mode
are read again; it shows loading only when the graph or mode changes or no
ready map exists, and a failed re-read still shows the failed state.
A place selection whose node becomes the hero's current place is dropped on
that place change (`selectionAfterArrival`); a later click on the current
place selects it as before. Text already inserted into the composer is not
removed by this.
Opening or zooming the Map tile selects nothing and writes nothing into the
composer (owner ruling 2026-11-12, sk-jay0.1.8.99). The canvas opens at the
hero's place and reports that boot selection like a click, and it boots again
when its token, slug or gateway origin changes (a token renewal while the tile
is open). `MapTile.svelte` passes a report on only after a player gesture on
the canvas: a pointer press, a click or a key inside the canvas mount arms one
report, and the next report uses it up. The canvas reports one click twice (at
once and after its lookup); the second report is dropped. A new boot disarms.
Not told apart: a gesture that reports nothing (a pan, a key in the search
box) while a boot lookup is still in flight lets that boot report through.
`MapTile.test.ts` and `App.smoke.test.ts` cover it
(`src/test/FakeMapCanvas.svelte` reports its boot place on mount and on every
token, slug or origin change).
A way out is spelled by its destination: `/go-<destination slug>`, for
example `/go-stairs` or `/go-common-room` (owner ruling 2026-11-12,
sk-jay0.1.8.95). The direction stays in the row label ("Go — Stairs (north)").
When two ways out of the place give the same slug, both take the direction as
a suffix (`/go-stairs-north`, `/go-stairs-east`); a way out with no
destination name is spelled by its direction. Accents are folded ("Café"
gives `/go-cafe`); a destination with no letter the shell can spell falls
back to its direction too. There are no aliases: a typed
`/go-north` finds the way out only through the label match. `exitShellTexts`
(`src/lib/fact-composer.ts`) is the one place that builds the spelling, from
the whole list of ways out.
A click on a way out fills the composer with that go sentence (no place target
is added) and focuses the box; Enter sends it, and no click moves. The five
surfaces are the dock's ways-out menu, a Place way-out row at stage level
(only the click that marks the row; unmarking and arrow browsing write
nothing), a way-out name on the Place card (sk-jay0.1.8.99: the card lists
each way out as "<destination> (<direction>)", up to five in full, with more
than five the first four and a "+N more" note; the count line stays; the
widget only reports the click and Play takes the dock menu's path,
`chooseExit`), the card map, and the stage map when the clicked place is the destination of exactly
one current way out (any other place only selects). The go sentence replaces
an empty box, an earlier go sentence (also one whose way out has gone), a box
holding only picked names, or a picked sentence whose appended template
(`""`, `name:""`, `str:`) is still empty;
typed words are kept and the help line says why ("You have unsent words in
the box…"). That note goes with the next Enter, so the blocker or the outcome
of that attempt shows. After a refused click on a Place way-out row the row
is already marked; the next click on it asks again instead of unmarking.
The same keep rule applies to a Place Insert. Legacy recordings
have no composer and keep the selection row's "Travel to <place>" slot.
`App.smoke.test.ts` covers every surface, `FactShellComposer.test.ts` the
replace and keep rule.

A route sentence takes no name. The composer's direct routes are a go
sentence, a look or sense route and the end of the turn. While one stands in
the box, a click on a name or on a map only selects: the disclosed-target
prefill is skipped and the box stays as it is (owner ruling 2026-11-13). The
skipped name is not added later when the route is removed; the next
different selection prefills as usual. A second click on the name that is
already selected does nothing, with or without a route: the prefill fires
only when the selected target changes, so the player selects something else
first or types the name (`App.smoke.test.ts` pins this). Only an armed route
skips the prefill: beside a route the world has withdrawn ("That is no longer
possible here") a click prefills again. Without a route sentence the prefill
is unchanged. A name the player completes himself beside a route keeps the
route armed, and the help line says that the route takes nothing else; a
way-out click still replaces such a sentence. `FactShellComposer.test.ts`
("owner decisions of 2026-11-13, batch 7") covers the composer;
`App.smoke.test.ts` ("beside a go sentence a name or map click only
selects") covers a stream name and the stage map through the app.
The documentation snippet under an item or occupant detail
(`PlaceReference`) leaves out the definition's description when the detail
already shows the same text, which happens whenever an item has no prose of
its own; the documentation link stays. A Pack item without a description has
no lead line (or "carried inside" for a nested item), never its kind.
Item prose starts expanded in `Description`; action prose starts collapsed
with a separately focusable summary. Hero identity, vital, ability and quest
fields and condition labels use `FieldDetail`, backed by the UI package's accessible Dialog.
Opening either reader never invokes an action. General actions, inventory verbs and conversation chips retain optional authored descriptions returned by PLAYER factual
tools. Quest prose joins `self_states kind=state` to the summary-selected ids;
`ui.self_summary` still controls quest membership and order. Only descriptions present
in the returned state page can be joined. Field dialogs explicitly say
"No description available." when prose is absent; action disclosures omit
empty controls. Condition explanations join `self_states kind=condition` onto
the condition ids the sheet lists. The summary controls that list while its
conditions page is complete. When the summary marks the page as a bounded
sample (`listing: "examples"`), a ready `self_states kind=condition` page is
the list instead, so a downed hero shows Unconscious and not only the first
few implied rows; a failed detail read keeps the summary's sample
(`heroFromSelfSummary`, covered in `play-view.test.ts`). Condition dialogs
retain supplied stack and expiry metadata and distinguish missing prose from a
failed read.
The DM's workflow conditions (the `dm/` namespace and the ids in
`DM_INTERNAL_CONDITION_IDS`, `isDmInternalCondition` in `src/lib/play-view.ts`)
are bookkeeping, not player facts: the You tile, occupant notes and details,
roster chips and the stream leave them out.
The sheet also retains resource descriptions for configured vitals, abilities
and the existing proficiency supplement. Identity explanations join the
summary-selected species/class/background tags to `self_states kind=identity`;
the app does not recover missing prose from tag names. These use the same
keyboard/touch field dialog at stage; compact cards retain their
value-only layout. Capability and item fact detail reads expose optional authored
prose (sk-jay0.1.8.30); condition persistence is owned by sk-jay0.1.8.31.
The source-to-widget inventory is in
`ledger/designs/play-ergonomics-september.md`.
Descriptions render as plain text, never HTML. Vital, quest and item prose contributes
to the existing supplied/represented/disclosed field counts. Portalled field
descriptions have a structural marker at their owning field: represented
counts include the available dialog prose, while disclosed counts follow its
open state. Condition stack/expiry fields use the same structural observation
through the shared reader's optional metadata marker, so moving them into a
portal does not lose their counts. Neither count proves viewport visibility or reading. Action explanations
have separate `description_scope=table|item` observations: available palette
rows, mounted explanations, reachable summaries, and expanded prose. A closed
parent menu makes its nested explanation unreachable. Filters, the selected
speech target and compact layout can intentionally narrow the source palette;
different available/mounted counts alone do not prove a dropped description.
Opening an explanation emits presentation evidence with interaction 0, not a
world-action intent. No description content or action identity is exported.

`playground.html` is the interactive, separately built mock entry point.
It mounts the production `App.svelte` / `PlayTable` / shared widgets through
an explicit in-memory `PlaySandbox`, without reading or replacing the player's
session credentials, loading an account, or opening a world connection.
The live entry never supplies this dependency; a URL flag cannot enable it.
Creation is the default. The collapsible overlay selects Creation,
Conversation, Exploration, Combat, or Reaction, resets the mounted shell,
and exposes the action log and current view. `?scene=creation&step=name`
links to a starting checkpoint, not a saved running session.

Playground scenes use the same versioned recording envelope and Play parser as
the live seat-menu export. Checked-in recordings carry provenance; the older
illustrative scenes are explicitly marked as migrated fixtures, not live proof.
An optional data-only scenario overlay references recording/frame IDs and maps
exact inputs to existing frames. It cannot execute code, patch a view, calculate
damage, or invent a reply. Unrecorded inputs leave the view unchanged.
`src/playground/scenes.ts` owns the catalog; the recording controller owns the
in-memory session adapter. See `docs/recordings.md` for capture, review, migration,
and overlay authoring. Do not hand-maintain duplicate PlayView JSON models.
`src/playground/fixtures.ts` remains the synthetic unit/layout-test fixture
source (tests re-export it through `src/test/sample-view.ts`), not the Playground
runtime's source of scenes. Page reload/reset loses local frame selection.
The entry is included in the production asset build for later hosted demos;
building it does not deploy it. It does not control real sessions.

`demo.html` remains the development-only layout regression entry, mounting
`App.svelte` on the same authored `PlayView` examples:
`?beat=explore|talk|fight|reaction|brawl`
selects the fixture, explore (the common room) by default — talk opens
Aldwin's dialogue, fight the cellar rats in a turn-based session, reaction a
held reaction window, and brawl sessionless combat-group offers in Explore
(no fight frame; every offered handle stays reachable). It is the
legacy visual review path and shares its fixture with the smoke
tests, so what the tests assert is what a reviewer sees.

`scripts/no-scroll.sh` (`pnpm run check:no-scroll`) is the real-browser half
of that check: jsdom does not lay out, so it drives `demo.html` with
`agent-browser` at 1280×720 and 390×844 for every beat in its list (the
layout-stress beats `place-long`, `hero-drafting` and `stream-detail`
included), plus one more explore
combination at both viewports with the map tile opened to its stage level
(`@spellkave/map-canvas` mounted, sk-jay0.1.8.9), and `place-long` and
`hero-drafting` with their Place and You tile opened — and asserts
`document.scrollingElement` never exceeds the viewport. For the layout-stress
beats this proves page-level no-scroll only: a clipped way-out row, stream
text under the filter bar or a vitals row on a drafting hero are invisible to
it. The evidence for those is the `ok layout` rows of `check:tile-clip` below.

`scripts/tile-clip.sh` (`pnpm run check:tile-clip`) checks each card's own
`.tile-body` in six stress beats (`fight`, `fight-conditions`, `fight-crowd`,
`talk-burst`, `place-long`, `hero-drafting`; `sweepBeats` in
[the selector](../scripts/tile-clip-selection.ts)) at those same two
viewports. It builds `demo.html` once in a temporary directory using
development mode, then loads all twelve combinations concurrently as
independent viewport frames in one named agent-browser session.
The temporary fixture assets are separate from the deployable app build.
[The browser sweep](../scripts/tile-clip-browser.ts) retains the original
scroll-height assertion: overflow requires a visible `[data-tile-remainder]`
marker whose bottom lies within the body's bottom plus one pixel. It excludes
the stage tile's intentional internal scroll. Phone rest-layout card bodies
remain hidden (0/0) in this sweep; the layout probes below cover phone-width
Place and You cards.
Every run also probes real card geometry with visible, hidden, invisible,
below-fold and absent remainder markers, plus an unclipped body.

After the sweep, [the layout probes](../scripts/tile-clip-layout.ts) load one
fresh frame per probe and viewport (1280×720 and 390×844) and print
`ok layout {...}` or `FAIL layout {...}`:

- `place-card-rows` (`?beat=place-long`, Place card): every row outside the
  description (place name, occupants, the five way-out rows, the "N ways out"
  line) lies inside every clipping box up to the tile body, all five way-out
  rows render with no "+N more", and the description overflows, shows at
  least one line and scrolls.
- `stream-under-filter` (`?beat=stream-detail`, Table stage): with the stream
  scrolled to its middle, the stream clips its overflow, its clip edge lies
  below the filter bar and it has no top padding (the gap is a margin outside
  the scrollport, sk-jay0.1.8.110). A hit test on points inside the bar adds
  that the stream is not stacked over it; it tests hit targets, not paint.
- `hero-drafting-vitals` (`?beat=hero-drafting`, You card): the drafting
  hero's name shows and the card has no vitals row and no HP/AC/XP term.

At 390×844 the Place and You probes first open their tile with its own
"Open <tile>" button and then drag the divider below it up until the tile is
a card, through synthetic pointer events on the same `PlayTable` handlers (no
hit testing); a setup that does not end on a card fails the run instead of
measuring another level. The phone card is measured at one size, 0.675, the
tallest a card can be: an `ok` row at 390×844 does not cover a card dragged
smaller. A narrowed card selection runs only the probes of its cards.

Successful PR/merge-group selection may narrow measured cards for direct edits
to the Hero, Pack or Place widget. All twelve beat/viewport combinations still
render the complete app. Shared dependencies, layout, fixtures, unknown paths,
missing Git evidence and an empty changed-file set retain the full sweep;
main and manual invocations default to full. The small attribution map and
fallback contract live in [the selector](../scripts/tile-clip-selection.ts)
and [its tests](../tile-clip.test.ts). The log prints selection, build, browser
startup, sweep and total clocks alongside every measured card. Browser/tool
and system package downloads use the runner's existing per-slot cache; a fresh
container still installs its dependencies, using local package archives when
its OS/package inventory and tool pin match.
