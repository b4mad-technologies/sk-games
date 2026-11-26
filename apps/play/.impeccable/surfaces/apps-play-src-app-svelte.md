# The Player's Table (app shell)

- Primary target: `apps/play/src/App.svelte`
- Related targets: `apps/play/src/components/PlayTable.svelte` (to be replaced by the mosaic), `apps/play/src/styles.css`, `packages/spellkave-ui-widgets/src/*.svelte`
- Mode: operate
- Audience: an authenticated player or DM at their seat in the one active world, evening, laptop or phone
- Job: see what the world wants of them right now, act, and see what followed — without leaving the table

## Approved direction

"The zoomed table" (2026-09-02, supersedes "The table" of the same morning;
rationale and evidence in `ledger/designs/play-zoomed-table.md`). Play is an
app: no product masthead, no page scroll, the world owns the screen.

**One fixed mosaic of six tiles that grow in place.** Table in the centre;
map above place on the left; you, pack, chronicle stacked on the right. A
tile never changes its place. Every tile has three levels — strip, card,
stage — and the change between them is continuous: pull an edge or pinch,
release to snap; tap the head to jump. When a tile grows, its neighbours
retreat toward their own edge, cards first, then strips; a column of strips
becomes an icon rail. On phones the mosaic is a single stack in the order
table, map, place, you, pack, chronicle; the strips are the tab bar.

**The world chooses the table's content; the player chooses the focus.** The
table tile shows one of four scenes, from what the PLAYER tools answer, in
this priority: an open reaction or intervention window, the fight frame while
a session is open (or the brawl roster when the fight is sessionless), the
speaker's dialogue (their line on paper, the numbered answers, one say field
with a target chip), else the offered actions with the long tail behind a
disclosure. A reaction window or "your turn" pulls the table to stage at once;
speech and world events only badge it.

**At rest the table is already open.** Desktop: table at stage in the centre,
sides as cards. Phone: table at stage, the rest as strips.

**Resize semantics (target, after the prototype):** window-style. The head
edge resizes vertically, side edges horizontally, corners both, so the map can
grow taller without wider and only the tile below it yields. A later option
floats one tile above the mosaic so it can grow without shrinking the others.

**The map tile is the maps app's canvas.** At card level the world's map
plate; at stage level the MapLibre canvas from the maps app, mounted lazily,
resized by its container: pan, zoom, floors, tap a place; in a fight the
tactical grid with positions. *Accepted exception (operator, 2026-09-02):* the
gateway's tile routes are not yet seat-scoped, so this tile is whole-world
while every other tile is perception-scoped. The exception ends with
sk-adr8.15 (seat-scoped tiles) and sk-ubx; until then the tile carries the
same "whole world" note the maps app shows.

**Density.** Controls 28 px visual using the `sm` variant of `@spellkave/ui`
(its pseudo-element keeps the 44 px hit target the design system requires);
rows 32 px; body 0.8125 rem sans on a fixed rem scale. Serif only for world
meaning: place name, speaker, hero name. Widget titles are labels. Gold marks
the tile in focus, the current turn and the primary action — nothing else.

**Account without a header.** A seat seal (the hero's initial, the one
sanctioned circular control) opens a small menu: account, theme, sign out,
spellkave.com.

**Motion.** One authored moment: the grid-track transition of a focus change,
240 ms, ease-out; none under reduced motion. No entrance choreography.

## Fidelity inventory

`ReactionPrompt` and `Chronicle` are local to `src/components/`; every other
named widget is `@spellkave/ui-widgets` and gains a `density` prop
(`strip | card | stage`) rather than a fork.

| Approved element | Implementation |
| --- | --- |
| The mosaic and its levels | `App.svelte` shell: a CSS grid whose column and row shares derive from one size per tile; `100dvh`, `overflow: hidden`; the stage tile's body is the only scroller |
| Continuous resize with snap | pointer drag on tile edges, pinch on touch, tap on the head; snap to strip / card / stage |
| The table's scene | `view.reaction` → `combatFromView` → `dialogueFromView` → `partitionActions` (all in `apps/play/src/lib/play-table.ts`, unchanged) |
| One say field | `Speech` / `Actions`: a single field with a target chip; `takesWords` actions collapse into it |
| The world pulls | reaction and `myTurn` set focus to the table; `speech_heard` and events increment the table badge |
| Map at stage | maps canvas package (sk-adr8 lane) mounted with the session's access token; `PlaceMap` SVG at card level |
| You at stage | `Hero` plus `spellkave_self_states` for abilities; only what the world reports (no invented HP maximum) |
| Pack at stage | `Pack` plus `spellkave_item_detail` for the selected item |
| Seat seal | `<dialog>` menu anchored to the seal; escapes the tiles' overflow |
| Living Grammar | Midnight ground, raised tiles with the double gold rule, paper for speech and reaction, square loom controls |

`demo.html?beat=<explore|talk|fight|reaction>` renders one recorded fixture
per scene credential-free; the smoke tests assert the chosen scene and focus,
and a browser script under `apps/play/scripts/` asserts no page scroll at
1280×720 and 390×844 on every beat.
