# Classic app: its own design

Status: **accepted by the owner on mocks, 2026-11-15** (epic
`sk-jay0.1.76.19`, mock `stage.html?mock`). The live wiring is beads
`sk-jay0.1.76.19.1` to `.19.5`; the first four (place, things, ways, offers,
story; talk and hero creation as rounds; the fight on the floor; hero sheet,
pack and map) are built in `src/stage/session/`. Open: make the stage shell
the app (`.19.5`).

## Owner exception (2026-11-15)

The classic app does **not** build its interface from `@spellkave/ui`
primitives, `@spellkave/ui-widgets` or Play's components, and does not take
its colours and type from the `@spellkave/ui` tokens. It has its own design
layer, `src/stage/stage.css`. This overrides the sk-sites [`DESIGN.md`](https://github.com/b4mad-technologies/sk-sites/blob/main/DESIGN.md)
for `apps/classic/src/stage/**` only. The stack stays Svelte 5, bits-ui
(unstyled behaviour: popover, dialog) and Vite. Reason: built from the shared
parts the app read as a second Play; a point-and-click client needs a look
made for a scene.

The old shell (`index.html`, `src/App.svelte`, `demo.html`) still follows the
old rule until the new shell replaces it.

## The idea

The world offers things; a thing affords actions; the hero tries one; the
world answers, also with a no (Gibson, ADR-0021; no eligibility read,
ADR-0141). So the interface shows **things, not lists**:

- **The scene gets the room.** One line on top (where am I; in a fight, whose
  turn), one narrow line at the foot (what I am about to do; my hero).
- **Offers hang on the thing.** A click on a thing opens its offers as paper
  tags beside it. Lead offers show at once, the rest fold behind "more",
  each family under its own heading ("Attack", "Checks", "Spells") that
  opens on a click. Nothing is hidden because it "would not work". A tag
  that is pointed at shows the world's own description of its action beside
  the list.
- **A caster's own spells come first.** The world lists every spell of the
  ruleset. The spells the hero picked in the creation talk lead on a foe in
  a fight and are the fold "Your spells" elsewhere; in a fight the ones the
  hero can be the target of (a healing word) lead on the hero as well. The
  stage knows them only from that talk, in this browser
  (`sk-jay0.1.76.19.14`).
- **In a fight the best blow leads.** The world offers an attack per weapon
  mastery and refuses the ones the weapon in hand does not have. The one
  that fits the bound weapon and a mastery chosen in the creation talk leads
  on a foe, before the plain attack; the others are the fold "Weapon
  masteries". Which mastery a weapon has is a copy of the SRD weapon table
  (`src/lib/menu.ts`), as the experience thresholds are: the hero's own
  masteries come empty (`sk-jay0.1.76.15.6`). On the hero, what the class
  gives (Second Wind) leads; the ways to give up are a fold of their own at
  the end.
- **A foe is for the attack, also before a fight.** On a target whose
  faction is not the hero's (`srd.faction.*`, tags the world discloses) the
  attacks lead after "Talk", and "Help" folds away. A ranking: the world
  answers the blow.
- **The adventure's own deeds have a fold.** An action whose id is outside
  the ruleset's and the keeper's (`srd/`, `core/`, `dm/`) and whose target
  does not stand in its niche yet is no misfit among the skill checks: it
  gets a fold named after its id family ("Quest"). A ranking by id family,
  like the fold "While you are down".
- **A crowd of loose tags folds by family.** Outside a fight, when a thing
  carries more than six first-level tags, a family of three and more (the
  keeper's `dm/level-up/...`) becomes a fold named after the family.
- **A way out acts on one click.** It has one meaning. Ways stand where their
  direction says, the same in every place.
- **The sentence line says the intent** before the click: "Open the chest".
- **The world answers in the scene.** Speech is a bubble on the speaker. A
  refusal is a cool-blue bubble on the thing, and the tag remembers it
  ("Last time: …"). Everything else is a caption over the scene. All of it
  is kept in order under "Story". An answer that says nothing about what was
  tried ("That did not work.") is told with the attempt in front, and
  silence is told too: "<name> has not answered." A speaker out of sight
  keeps the name the hero knows them by.
- **A talk keeps the reply.** A bubble is gone after seconds. The talk panel
  shows what the partner said since the hero last did something, and the
  sentence said right before an open question stands above it.
- **"Look around"** (or Space) lights up everything that can be acted on.
- **A question is perceivable on the person:** a "?" over whoever waits for
  an answer. A click on them opens the talk at once; in the talk, the next
  click opens their other offers. A question asked in words only ("... 1: Take the companion. 2:
  Walk alone a while longer.") counts for as long as the hero has said
  nothing after it; this reads a sentence and is a stop-gap
  (`sk-jay0.1.76.19.13`).
- **An answer says what it is.** Its picture is the SRD sprite of its
  definition id; its text and link come from the public reference guide by
  that id. Up to five such answers stand as tall cards with the text on
  them; more stay small cards with one line for the answer pointed at. For
  a class choice the DM names the option, not what it grants
  (`srd/advancement-choice-option/fighter/1/feat/archery`); the stage reads
  the granted definition out of that id (`grantedDefinition` in
  `src/lib/srd-art.ts`), a stop-gap until the host sends it
  (`sk-jay0.1.76.19.20`).
- **Talk is one panel for everything.** Hero creation is a guided talk with
  whoever keeps the threshold, in a scene, in the same panel as a talk with an
  innkeeper. A guided talk also has an outline on the top line and back and
  forward; its last step lists every answer, uncut. Free speech is typed on
  the foot line.
- **A fight happens in the same scene.** The floor shows its cells, the top
  line the turn order, the foot line the turn budget and "End turn". When
  the turn comes back the foot line tells what the others did and ends with
  "Your turn." Harm, a miss and experience float from the figure they
  belong to, read from the kind and the numbers of world events.
- **The turn order says who is out of a fight.** The world does not say who
  is dead while a fight lasts (`sk-jay0.1.76.19.12`). Whoever is on the
  roster and had no turn in the last full round on record reads "out of the
  fight", is drawn grey and is marked on the turn order; they can still be
  clicked. What put them out, the world does not say. A fighter's tags say
  how far they stand ("2 steps away."): the world sends no reach
  (`sk-jay0.1.76.15.3`). Several on one cell stand side by side.
- **A waiting reaction has the foot line.** When the world waits for the
  hero's reaction (an opportunity attack), the line asks it with "React" and
  "Let it pass". The fight does not go on before.
- **The hero is a thing too.** A click on it offers the sheet and the pack;
  what the hero can be the target of folds behind them as "Actions" (and
  "Your spells"), the SRD's rests as "Rest", what the place offers as
  "Here". In a fight "Actions" is open at once.
- **A hero who is down lies down.** The figure says its state under its
  name, the foot line says that the hero is down, and a click on the hero
  opens the fold "While you are down" at once: the SRD's death saving throw
  and whatever the adventure puts on the hero (an action id outside `srd/`
  and `core/`). That is a ranking by id family, not a reading of what would
  work.
- **The world's answer comes before a hint.** A new line takes the sentence
  line back from whatever the pointer left there. A question the talk panel
  shows is not said again on the foot line or in a bubble, and the numbered
  answers the world appends to a question are cut from the sentence: the
  cards are the answers.
- **What runs in world time shows on the foot line** with the world's own
  progress (a long rest, a journey): "Complete a Long Rest… 40%". A walk by
  the map over several places counts them instead, since the world's percent
  is of one leg: "On the way to Hamlet Gate: 5 places to go, now to
  Crossroads…".
- **A place can be read whole.** The top line cuts a long description;
  pointing at it or a click shows it on a card under the line.
- **One letter opens a sheet** (desktop): S story, M map, P pack, H hero.
- **The story outlives a reload.** The world replays what was said, not
  what happened; the stage keeps the story in `localStorage`, per world, hero
  and staging, like the map. Old lines are never played on the stage again.
- **The pack leads with what is made for a thing.** The world pairs a thing
  with the hero's whole action set; only an action that asks for a niche the
  thing stands in is a button, the rest folds behind "more". The sheet has
  two panes, the list and the picked thing. The list carries no definition
  id, so a picture appears once a thing was looked at and is then kept by
  the thing's name, in this browser.
- **The sheet keeps what the hero answered.** Nothing lists what the hero
  took on (`sk-jay0.1.76.19.16`). The stage keeps its own notes of the talk:
  the answer given when somebody asked and the asker's next sentence, under
  "What you answered", in `localStorage` like the story. It is a record of
  what was said, not a quest state; the "Quests" block stays what the world
  marks.
- **Only the figure takes the click.** A sprite is a square with the figure
  in its middle third; the middle is the click area (`.st-hit`), so somebody
  half behind another can be clicked. Figures spread over the floor a way at
  the right edge leaves free.
- **No picture, no pretending.** A thing the world sends no picture for is a
  plain marker stone with its initial, and its name stays on.
- **Desktop only (owner decision, 2026-11-15).** The stage is made for a
  desktop window. There is no phone layout: the pan of an upright phone and
  the narrow-screen rules of the first mock were removed
  (`sk-jay0.1.76.19.7`). A window narrower than 760 px says so instead of
  breaking.

## Look

Dark only: the room is dark so the scene glows. Ink and night blues for the
frame, warm paper for words, ember for everything that can be acted on, cool
frost for the world's "no", moss and blood for gain and harm. One typeface
(Newsreader), small caps for controls. Pixel art is never smoothed. The stage
is a fixed 480 x 270 grid scaled to the window, so sprites keep whole pixels.
Targets are at least 44 px; motion respects `prefers-reduced-motion`.

## Architecture

```
shell (src/stage/*.svelte)  --reads-->  Stage   (src/stage/model.ts)
                            --acts--->  World   (the one port)
World = MockWorld (src/stage/mock/)            fixture world, stage.html?mock
      = LiveWorld (src/stage/session/)            a staged world: PlayView -> Stage with
                                               src/lib/{menu,talk,fight,travel,story}.ts
```

Live wiring lands bead by bead (`sk-jay0.1.76.19.1` to `.5`). The live stage
lists what is not wired yet in the same place the mock lists what it fakes.

The shell knows neither the PLAYER tools nor `PlayView`. Every call on the
port is an attempt; the answer comes back as a changed `Stage`.

## A fight on a grid of another size

The floor is drawn for 9 x 4 cells. The world's session grid can be larger
(10 x 10 in the cellar fight, seen live 2026-11-15). Decided with the live
wiring (`sk-jay0.1.76.19.3`): the floor shows a window of at most 9 x 4 cells
and figures keep their size. The window sits around the middle of the fight
and moves only as far as needed to keep the hero in it; a smaller grid is
centred; a fighter the window cannot hold is on the turn order only. North is
further back. Nothing is shaded as reachable: the world sends no reach
(`sk-jay0.1.76.15.3`), a click on a cell asks for the steps one by one.

## The map panel: everything the hero has seen

The owner asked for a view of everything the hero has already seen
(`sk-jay0.1.76.19.7`). What the world gives a player (read in code and seen
live 2026-11-15, evidence in `sk-jay0.1.76.19.8`): a map plate
(`spellkave_map`, an SVG) of one area, the one the hero stands in. It draws
the places the hero has stood in, the place they stand in now and its direct
neighbours, fitted anew to whatever it draws. A way into another area (a door
from the street into a house) is not on it. The set of known places is not
sent as data.

So the panel is the app's own drawing, from the app's own memory, the atlas
(`src/stage/session/atlas.ts`):

- **One sheet per area**, with the plate's title ("Hamlet", "Inn"). The sheet
  the hero stands on opens first; tabs turn to the others.
- **Places stand where the plate put them.** A later plate is laid over the
  places it shares with the earlier ones (one scale and a shift, least
  squares), so a place does not jump when the world redraws. Each axis of a
  sheet fills the panel, so the tags have room; order and direction between
  two places stay the world's.
- **Ways out join the sheets.** A place the hero stood in adds its ways out
  as routes, also the ones into another area. Such a place carries a small
  "⇄ Inn" that turns to that sheet. A place only a way out has named stands
  beside its neighbour, in the direction the way leaves.
- **Been there or only seen.** A solid tag is a place the hero stood in, a
  dashed one a place seen from next door. A place on the plate that is
  neither the hero's nor a neighbour counts as visited: the world draws only
  those from its own memory.
- **It is kept across a browser restart**, in `localStorage`, per world,
  hero and staging of the world. A hero still being made has seen nothing:
  what is kept under their id is dropped.
- **A click walks there**, one offered way after the other, also across a
  door, and can be stopped between two. A route is a plan; the world answers
  each way. A place no chain of known ways leads to from where the hero
  stands (seen through a door of the creation room, say) is dotted and no
  walk target: "You know no way to ... from here yet."

The limit: the memory is this browser's. Another browser starts with what
the current plate shows. A data read of the known places would end that
(`sk-jay0.1.76.19.8`).

## What the mock fakes, what the world leaves out

Listed in the app itself (top line: "Mock" on the fixture world, "Gaps" on a
live world), each with its bead. That list is the one place they are kept:
`LIVE_GAPS` in `src/stage/session/stage-from-view.ts` for a live world, the
mock's own list for the fixture world. On the mock each is also marked in
place with a dashed "≈"; on a live world the marks are off until switched on
in that panel. `stage.html?world`
skips hero creation with a ready-made hero.
