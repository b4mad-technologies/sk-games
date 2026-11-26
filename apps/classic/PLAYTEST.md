# Playing the classic app locally

How to start the classic app against the Kavemouth adventure on your own
machine, what a first session looks like, and what the playtests of
2026-11-14 found. Epic `sk-jay0.1.76`.

## Start

All commands run at the repository root.

```bash
sk config set --project dev.backend local    # once per worktree: use a local node
just play-host                               # node + Kavemouth + Rust NPC host + a blank hero
cd apps/classic && node_modules/.bin/vite --host 0.0.0.0 --port 5320 --strictPort
```

Then open <http://127.0.0.1:5320/>.

- `just play-host` **wipes this worktree's local world** and takes about three
  minutes. Use it for a new hero. `just play-host status` shows the running
  host; `just play-host start` restarts the host on the world as it is.
- There is no sign-in. The app plays the hero that `just play-host` staged
  (`.local/profiles/kavemouth-candidate.toml`). After every `just play-host`,
  save `apps/classic/vite.config.ts` once (or restart the dev server) so the
  app picks up the new hero.
- The first connection can take more than ten seconds.
- **Portraits (optional).** The adventure's own pictures of people come
  through a local gateway. Without it the app shows SRD sprites and glyphs.

  ```bash
  just world-assets-link kavemouth
  just play-gateway-local kavemouth "$PWD/.local/world-assets"   # prints its origin
  cd apps/classic && VITE_SPELLKAVE_GATEWAY_URL=<that origin> node_modules/.bin/vite --host 0.0.0.0 --port 5320 --strictPort
  ```
- The dev server must outlive the terminal that started it. Start it detached
  (`nohup … &`) or in a pane that stays open; on 2026-11-14 it died with the
  agent session that owned it.
- A second world for destructive tests: run `just play-host` in a second
  worktree, then start another dev server here with
  `SPELLKAVE_URL=<that node's url> SPELLKAVE_DEV_PROFILE=<that worktree>/.local/profiles/kavemouth-candidate.toml`
  on another port. Both servers show the same source.

## A first session

1. **Make the hero.** The wizard asks one question at a time: class,
   background, species, skills and the class's own picks, starting kit, ability
   scores. Click a card to answer. Open "Name your character" at any time, type
   a name, send it, then click "Adopt the name" and "Confirm character
   creation". The "?" on a card opens a short text from the reference guide
   and a link to the full entry. "← Back" shows the question before again;
   your answer stands until you click another card. "Forward →" leaves it as
   it was. "Discard the drafted character" still empties the whole draft.
2. **Look around.** You start in the Guest Loft. Click a red way-out label to
   walk. A walk takes a few seconds of world time. A way out with a dashed
   frame is gated; its label and the line above the stage name the gate.
3. **Use the map.** The "Area map" on the right shows the places the hero
   sees now, on every floor. Click a place to walk there, also over several
   places: the status line at the top says "walking to …" and offers "Stop
   here". Places you saw before but that the map no longer draws are listed
   below it as "Places you have seen", with the number of steps.
4. **Talk.** In the Common Room, Aldwin asks about the cellar. His question
   shows in the panel at the bottom left; click an answer. To say something of
   your own, click a person and pick "Talk", or type in the field and press
   Enter.
5. **Fight.** Go to the Stairs, then the Cellar. The fight is drawn on a
   grid: your hero is the disc with initials, the rats show their pictures.
   On your turn, click a rat, pick "Melee Attack", then click "End turn". A
   click on a shaded neighbour cell walks one cell. (If the world sends no
   grid, the rats stand on the stage and "Step north" and its siblings walk.)
   Next to the turn line you see what the turn still holds (action, bonus,
   move, reaction). After your first step the Move chip counts the steps
   left.
   While a foe acts, the talk panel says who is thinking.
6. **Your hero.** "Hero and pack" next to the hit points opens the sheet:
   abilities, skills, conditions, the pack and what is worn. Click an item to
   see its picture and read about it. Under "Do with …" stand the actions the
   world lists for that item; a click tries one and the answer shows on the
   sheet.
7. **If you fall.** A banner says you are down. Under "Here and you", click
   "Give up and wake at the inn". You wake in the Guest Loft with full hit
   points.
8. **Collect.** With the cellar quiet, go back to Aldwin; he pays the quest.

## Playtests of 2026-11-14

Both runs drove the app in a browser by clicks, on a fresh `just play-host`
world each. The wizard driver's step log was incomplete in both runs (the
automation ran its script twice), so the wizard steps are confirmed by the
finished hero, not by a per-step record. Screenshots:
`~/vega-briefs/classic-playtest-2026-11-14/` on ganymede.

| | Run 1 | Run 2 |
|---|---|---|
| Hero | Elira Moonwhisper, Dragonborn Wizard, Acolyte, HP 7, AC 11 | Torvald Ironbrow, Dragonborn Fighter, Acolyte, HP 11, AC 12 |
| Wizard | finished by clicks | finished by clicks |
| Walk to the Common Room | worked | worked |
| Take Aldwin's quest by a click | worked | worked |
| Cellar fight | fell to 0 HP before her first turn | killed Cellar Rat 1 by clicks (25 XP), then fell to the swarm |
| Wake at the inn | worked, HP 7 | worked, HP 11 |

An earlier hand-driven session the same day (Borin Stonehand, Fighter) won the
cellar fight with 4 HP left and was paid by Aldwin (175 XP).

### Fixed during the playtests

- A caster's 119 spell actions flooded "Here and you"; they now sit in a
  "Spells" fold.
- A hero at 0 HP got no sign of it; a banner now says so.
- In a fight the stage was empty; the fighters are now clickable tokens, with
  a turn line and an "End turn" button.
- A result line named the target "Someone here"; it now names whom you
  clicked. Result lines are sorted into the story instead of piling up below.
- "End turn" answered with a fighter's number ("139 acts next").

### Third run, the same evening

A third browser run on a second fresh world (Hilda Oakshield, Dragonborn
Fighter, Soldier, chain mail kit, HP 11) checked the fixes above in two
fights and found:

- **Fixed:** "You end your turn." stood below the foe's counter-attack. A
  result now stays right after the line that was last on screen at the click.
- **New:** a line that says who is thinking, in a fight and after the hero
  spoke.
- **New:** the hero sheet and pack ("Hero and pack").
- **New:** "Step" buttons and the turn budget in a fight. A step onto a free
  cell worked, and the hero killed Cellar Rat 1 from there (25 XP).
- The hero fell in the second round again (5, 4 and 2 damage), woke at the
  inn and was at 4 HP after the first hit of the second try.

### Wave 2, the same night

A fourth browser run on a fresh world on a second stack (Greta Flintlock,
Dragonborn Fighter, Acolyte, kit A, HP 11) checked the new sheet, the area
map and the fight steps. Screenshots:
`~/vega-briefs/classic-playtest-2026-11-14/wave2/` on ganymede.

- **New:** item pictures and item actions on the sheet. The Greatsword
  showed its sprite; "Use a Consumable" on it answered "That cannot be done
  right now." on the sheet.
- **New:** travel by the area map. One click walked Bar → Common Room →
  Stairs, and one click in "Places you have seen" walked Guest Loft → Stairs
  → Foyer. The way from the Common Room to Creation Limbo showed "(gated: dm
  threshold)".
- **New:** "Move · 4 steps left" after the first step of a turn. The result
  line of a step says "Step north".
- **Found:** a hero gets five steps a turn, not six: a step costs 1001 of
  6000 movement (`sk-jay0.1.76.15.9`).
- **New, after the map fix `d697d7a1c1` (`sk-jay0.1.76.15.8`):** the fight
  is played on the grid. Seen live: 100 cells, the hero and both rats on
  their cells, the rats with their SRD pictures; a click on a free neighbour
  cell stepped there, a click on the swarm opened its menu, "Melee Attack"
  answered "Your Melee Attack misses Cellar Rat Swarm."
- **New:** the people's own portraits. With the local gateway running,
  Aldwin and Brother Caddoc showed their authored pictures in the Common
  Room (2 of 2 loaded, hash-checked); the Hearth has none and stays a glyph.
- **Found and fixed on the way:** the first version of the place memory made
  the app stop reacting to clicks (a reactive loop). Not in the pushed code.

## The stage shell on a live world, 2026-11-15

`stage.html` is the fresh-start shell (epic `sk-jay0.1.76.19`). Start it like
the old one and open <http://127.0.0.1:5320/stage.html>; `stage.html?mock`
plays the fixture world instead. Played by the building agent on a fresh
local world (`just play-host`, host with the guided-dialogue machine side),
through the browser:

- **Hero creation** as a guided talk in the scene: class, background,
  species, two skills, fighting style, three weapon masteries, starting kit,
  recommended scores, the name typed, the name adopted, confirmation. The
  steps on the top line are the DM's own outline. Back from the kit question
  reopened an earlier one with Forward enabled.
- **Walking**: Guest Loft, Stairs, Common Room, Cellar by the way tags; from
  the map panel Cellar to Common Room over the Stairs in 46 seconds, with
  "On the way to ..." and Stop on the foot line.
- **Things and refusals**: "Pick Up" on a chest was refused ("That cannot be
  done right now."); the sentence showed on the chest and stayed on the tag.
- **Talking**: "Answer" on the asker opened his question; an answer was taken
  at once. Free words were sent and came back as the hero's line.
- **Two fights** in the cellar on a 10 x 10 grid: turn order, budget chips,
  an attack that killed a rat, steps by a click on a cell (Steps 6 to 2 of 6,
  an opportunity attack on the way), End turn. The first fight was lost (the
  hero fell and woke at the inn through his own tag), the second won.
- **Pack**: a click on the greatsword brought its picture, description and
  tags.

What does not work there, and why:

- **Nobody answers free words** on the local host; see the known issues
  below (`sk-jay0.1.76.14.7`).
- **The hit point bar has no maximum from the world** (`sk-jay0.1.76.19.6`).
  It is measured against the most hit points seen since the page opened, so
  a wounded hero looks whole after a reload.
- **Ability scores by hand, appearance and backstory** are not on the stage
  (typing stays for speech and the name). The old shell has them.
- **In a fight**: the world does not say who is down, and a dead foe
  stands as before (`sk-jay0.1.76.19.12`). Marks for harm and misses and
  the reaction window came with polish round 2 below; since polish round 4
  a fighter the turn order passes over reads "out of the fight".
- **Seen then, fixed in the night run below**: a long speech bubble cut at
  the top of the scene, a way tag on a figure, "Cell 0,0" as the place of a
  fight.

## Night run on the stage shell, 2026-11-15

Played by an agent on `stage.html`, on a fresh local world (`just play-host`),
with real input through agent-browser (Chrome for Testing, 1440 x 900), each
hero from creation to the first level-up. Bead `sk-jay0.1.76.19.7`. Desktop
only: the owner took the phone layout out of scope the same day.

**The first level-up asks for 300 experience**, not 75. The two cellar rats
give 75 by themselves; the quest pays 100 more. The way to level 2 in Kavemouth
 is quest 1 (rats, 175) and quest 2 (escort Jory past a wolf, 300), then
"Level Up" on the ledger keeper.

### Hero 1: Maren, human cleric (level 2 reached)

Creation (class, background, species, two skills, divine order, three
cantrips, four prepared spells, starting kit, scores, name, confirmation),
the guest loft, the common room, quest 1, the cellar fight (Guiding Bolt on
the giant rat, Healing Word, the mace on the swarm), a long rest, the walk to
the hamlet gate, quest 2, the bridge (two Guiding Bolts for the wolf), a word
to Jory, back to the gate by one click on the map, level 2 at the ledger
keeper: 5 to 10 hit points.

Every stumble, and what became of it:

| Stumble | Outcome |
|---|---|
| The map showed only places a remembered route led to, in columns by distance, and forgot them with the tab. | **Fixed.** One sheet per area, places where the world's plate puts them, been-there against only-seen, doors between sheets, kept in `localStorage`. One click walked from the bridge approach to the hamlet gate across three areas in 56 s. |
| A question repeated its numbered answers ("Which prepared spell? 1 Bane, 2 Bless, ..." took four lines over the cards); the foot line said it a third time. | **Fixed.** The sentence is cut before the list; the cards are the list. |
| The speaker's bubble stayed over an open talk panel, was cut at the top and repeated the question. | **Fixed.** Opening the talk takes the bubble away; a bubble is at most four lines (two beside a talk panel). |
| The name step read "Aldwin listens." with a bare field. | **Fixed.** It reads "asks:" and the field's own label. |
| Folded tags were one flat list of 110 and more. | **Fixed.** Folds with headings ("Attack", "Spells", "Checks", "Other"; the hero's own: "Actions"), one open at a time. |
| After a click on a tag the sentence line kept the hover hint instead of the world's answer; in a fight it kept "Step here". | **Fixed.** A new line takes the sentence line. |
| The sentence line read "Melee Attack — Someone here". | **Fixed.** It names the thing: "Melee Attack: Cellar Rat 1". |
| In a fight the top line read "Cell 0,0". | **Fixed.** It names the place the fight is in. |
| Five budget chips in the world's order (Bonus, Move, Object, Action, Reaction). | **Fixed.** Move, Action, Bonus, Object, Reaction. |
| No names on the fighters; a hit for 7 of 9 hit points left no mark. | **Fixed.** Names stay on in a fight; the change of the hero's hit points floats up from the hero. Harm to a foe is still a story line only (the world sends no hit points of others). |
| Dead rats were also "no action", "no bonus action", "no reaction". | **Fixed.** A condition is named once, by the whole. |
| A way tag lay on a figure. | **Fixed.** A figure steps aside or forward. |
| On the East Road a second way east stood beyond the right edge (no way to the ford); long names at the side were cut. | **Fixed.** Ways in one direction stand beside each other towards the middle; a tag at the side grows inwards. |
| Seven rations were seven pack rows; worn things looked like the rest. | **Fixed.** Equal things stack; a worn thing says where; a thing inside another has a dashed frame. |
| "Mock 9" and "Mock: Scene" on a live world. | **Fixed.** "Gaps" there. |
| "Level Up" answered "That cannot be done right now." at 75 experience. | **Eased** in the client: the sheet says "XP 75 of 300 for level 2". The world's answer is `sk-jay0.1.76.19.9`. |
| A long rest answered "Nothing you notice changes."; the next click was refused; a walk seemed lost. | **Eased**: the rest runs 20 world ticks, and the foot line now shows what runs with the world's progress ("Complete a Long Rest… 40%"). Noted on `sk-jay0.1.23.36.17`. |
| The foot line still said "You set off ..." or the arrival before. | **Fixed.** Every change of place says "You arrive: ...". |
| After a reload a wounded hero looked whole (4/4). | **Eased**: the most hit points seen are kept in the browser. The world still sends no maximum (`sk-jay0.1.76.19.6`). |
| Jory did not follow after quest 2 was accepted. | World. He follows once he is spoken to in free words; nothing says so. Noted on `sk-jay0.3.27.10`. |
| "World Operator" stands in the creation limbo. | World, fixed on main by PR #4925 (`sk-jay0.1.76.9`); this branch's world is older. |
| The Common Room shows a way "Creation Limbo" (gate "dm threshold") to a finished hero; the place lands on the map as its own sheet. | World: `sk-jay0.1.76.19.10`. |
| A level-1 cleric's "Spells" fold lists 69 spells, a level-2 one 119. | World: `sk-jay0.1.76.14.4`. |
| The cleric in a chain shirt with a shield reads Armor 9. | World: `sk-jay0.1.76.15.7`. |
| The turn order does not say who is down. | World: gap of `sk-jay0.1.76.19.3`. |
| A sentence heard from the next room is from "Someone". | World. Not filed. |
| The chest in the loft offers only "Pick Up", which is refused. | Content. Not filed. |
| In a fight a foe's first tags include "Opportunity Attack" and "Swing (no target)". | Open. The world binds them to the weapon like the attack itself (`src/lib/menu.ts`). |

### Hero 2: Silas, elf rogue (level 2 reached, after three falls)

Creation (class, background, species, four skills, two expertise picks, two
weapon masteries, starting kit, scores, name, confirmation), quest 1, quest
2, level 2 at the ledger keeper. He fell three times: to the cellar rats
before his first turn, and twice to the wolf on the bridge. Each time he
woke at the inn through his own tag and walked back; the wolf kept its
wounds, so the third meeting ended it. One click on the map walked him from
the guest loft to the bridge, eleven places across four areas, in 104 s.

| Stumble | Outcome |
|---|---|
| Struck to 0 hit points, the hero stood there as before; the foot line read "The session closes."; nothing said what to do. | **Fixed.** The hero lies down, the figure says "incapacitated, unconscious" under its name, the foot line says that the hero is down, and a click on the hero opens what can still be done (death saving throw, wake at the inn). |
| "Opportunity Attack" and "Swing (no target)" led a foe's tags. | **Fixed.** They sit under "More attacks". |
| A pack item's tags were the hero's whole action set (a mace: 113 buttons). | **Fixed.** Only what is made for the thing leads; the rest folds behind "more". |
| A key held down flickered a sheet open and shut until the page froze. | **Fixed** (found by the new shortcuts S, M, P, H themselves). |
| The running long rest did not show on the foot line the second time. | **Fixed.** The world lists what is ongoing; the foot line reads that list ("Complete a Long Rest… 40%"). |
| A creation question names at most 16 answers: no Stealth expertise, no weapon mastery after "Lance" (no Rapier, Shortbow, Shortsword). | World: `sk-jay0.1.76.19.11`. |
| In all seven fights of the night the foe had the first turn; a level-1 hero with 9 hit points can be down before acting. | World: `sk-jay0.1.76.15.6`. |
| Waking at the inn says "You spend 9 Death Save Last Roll — 0 left." and "You are no longer affected by Incapacitated, No Action, No Bonus Action, No Reaction, Dead, Unconscious and Stable." | World wording. Not filed. |
| After level 2 the health bar reads 8/9: the app only knows the most hit points it has seen. | World: `sk-jay0.1.76.19.6`. |

### What the stage gained that night, beyond the fixes

- The map of everything seen, with sheets per area and walks across doors.
- One letter opens a sheet: S story, M map, P pack, H hero. The story opens
  at its newest line.
- The hero sheet says how far the next level is.

A trap for whoever plays next with agent-browser: after `open` or `reload`
set the viewport again (`set viewport 1440 900`), else clicks land at doubled
coordinates and nothing reacts. Do not `press` a letter key: the key stays
down and repeats. In the shared Chromium a tab that another
agent pushed to the back takes no clicks and hangs a screenshot.

## Polish round 2 on the stage shell, 2026-11-16

Played by an agent on `stage.html`, on fresh local worlds (`just play-host`),
with real input through agent-browser (Chrome for Testing, 1440 x 900). Bead
`sk-jay0.1.76.19.7`. The two classes the night run left out: a fighter and a
wizard. Screenshots: `~/spellkave-evidence/classic-polish-2/` on proteus.

### Hero 3: Thrain, dwarf fighter (level 2 reached, and on to 700 experience)

Creation (class, background, species, two skills, fighting style, three
weapon masteries, starting kit, scores, name, confirmation), quest 1 (one
fall to the cellar rats, woke at the inn through his own tag, won the second
try), a long rest, quest 2 (the wolf fell to one blow, Jory followed after
free words), level 2 at the ledger keeper: 11 to 17 hit points. Then on: the
keeper's companion, Mira's barrow quest at the bar, Tomb Hill, the Slime
Scout, and the Crypt Warden in the Lower Crypt.

| Stumble | Outcome |
|---|---|
| A tag said only its name. Three "Give up and wake at the inn" tags could not be told apart; nothing said that Second Wind is a bonus action. | **Fixed.** A tag shows the world's own description of its action beside the list while it is pointed at. |
| When the turn came back the foot line read "The turn passes from Cellar Rat Swarm to you." What the rats had done was in the story only. | **Fixed.** The foot line tells what the others did since the hero's turn and ends with "Your turn." |
| A blow that missed the hero left no mark; harm the hero dealt was a story line. | **Fixed.** "miss" floats from the hero, the harm dealt floats from the figure of that name, experience won floats from the hero. All are read from the kind and the numbers of world events. |
| In a fight, a click on the hero led with "Hero" and "Pack"; Second Wind sat in a fold of 16 between "Melee Attack" (on the hero's own cell) and "Complete a Long Rest". | **Fixed.** The fold "Actions" holds only what the hero can be the target of and is open at once when down or in a fight; an attack on the own cell joins the other attacks; what the place offers is "Here". |
| An open fold lost its label under the pointer (ember on ember); a long list ran over the top line and the foot line. | **Fixed.** |
| "Which skill (2 more)?" was followed by "(2 to pick)". | **Fixed.** The count is said once. |
| The story read "A session opens (3 participants)." and "The session closes." | **Fixed.** "A fight begins: 3 fighters." and "The fight is over." A journey of one keeps the world's words. |
| A long rest ended without a word. | **Fixed.** "Complete a Long Rest: done." |
| A page reload emptied the story: the world replays what was said, not what happened. | **Fixed.** The story is kept in the browser per world, hero and staging, like the map. Old lines are never played on the stage again. |
| Jory's reply came as two equal rows. | **Fixed.** One reply is told once. |
| After the level-up the keeper offered a companion ("1: Take the companion. 2: Walk alone a while longer."). No prompt was open, so the stage showed no answer; free words were not taken for one. Mira at the bar asks the same way. | **Eased.** The newest numbered sentence of a speaker is a question for as long as the hero has said nothing after it; its answers go out as the numbered answer acts, which the world takes. The world's side is `sk-jay0.1.76.19.13`. |
| The fight with the Crypt Warden hung: the world waited for the hero's reaction (an opportunity attack), the stage read "Crypt Warden is thinking…" for minutes and offered no way to answer. | **Fixed.** The foot line asks "You can react now: Opportunity Attack." with "React" and "Let it pass". React hit for 9; the fight went on. |
| A thing's description in the pack was cut at one line. | **Fixed.** |
| The hero sheet had no proficiency bonus and did not say what a class, a species or a background is. | **Fixed.** Both are on the sheet, in the world's words; an ability explains itself on hover. |
| Cellar Rat 1 was dead and stood on the grid as before, in the turn order too. The fight stayed open after the last foe died until "End turn". | World: `sk-jay0.1.76.19.12`. |
| "Use Second Wind" at no uses left answered "That cannot be done right now." | World: the uses are known only from the spend event (`sk-jay0.1.76.19.14`). |
| Armor 12 in chain mail; no weapon masteries on the sheet; the foe moves first. | World, known: `sk-jay0.1.76.15.7`, `sk-jay0.1.76.15.6`. |
| The name is asked twice in creation (typed, then "Adopt the name"). After a quest is accepted the keeper first says "Nothing to record yet, friend." | World wording. Not filed. |
| The companion stood outside the Crypt Warden fight. Every foe died of the first or second blow for 2 to 4 damage. | World. Not filed. |

### Hero 4: Nim, gnome wizard (quest 1 done)

Creation (class, background, species, two skills, three cantrips, four
prepared spells, starting kit, scores, name, confirmation), quest 1: down
before her first turn once (7 damage against 7 hit points), then Fire Bolt
(a miss) and Burning Hands, which ended both rats.

| Stumble | Outcome |
|---|---|
| A level-1 wizard's "Spells" fold lists 119 spells, among them spells of other classes. Casting Fire Bolt at a rat took a click on the rat, "more… (108)", "Spells", and a search through the list. | **Eased.** The stage remembers what the hero answered in the creation talk (in this browser) and puts those spells first: in a fight they lead on a foe like a bound weapon, elsewhere they are the fold "Your spells". The read is missing in the world: `sk-jay0.1.76.19.14`. |
| On the hero the fold held every spell, also those that are cast on somebody else. | **Fixed.** On the hero "Spells" holds what the hero can be the target of; the rest is "Spells at this place". |
| Nothing shows the spell slots. | **Eased.** The hero sheet says what a spend event last left ("Level 1 spell slots 1") and forgets it after a rest. `sk-jay0.1.76.19.14`. |
| "Cast False Life" on herself answered "That did not work." | World: `sk-jay0.1.76.19.14`. |
| Burning Hands killed both rats and paid 100 experience (the quest), not 175: a kill by a spell pays no kill experience, and no harm mark arrives for it. | World: `sk-jay0.1.76.19.15`. |
| The creation talk named 16 spells: no Magic Missile, Mage Armor, Shield or Sleep. | World, known: `sk-jay0.1.76.19.11`. |
| The spell cards in creation have a picture and "Read more", but no word about the spell. | World: the guide sends no description for a spell. Not filed. |

### Hero 5: Vex, elf wizard (level 2 reached, with spells only)

A second wizard on a fresh world, to prove the spell fixes with a real
creation. The stage kept her picks (`srd/spell/fire-bolt` and the rest); on
a rat in a fight her spells stood on the first level of tags, two clicks to
cast. Quest 1 with Chromatic Orb and Fire Bolt (175 experience, one fall),
quest 2 (the wolf struck her down twice before her first turn; the third
meeting ended it with Fire Bolt), Jory, the gate, level 2 at the ledger
keeper. She then answered the keeper's companion offer by a click on its
card. An attack-roll spell pays the kill and reports its harm; only Burning
Hands on hero 4 did not (`sk-jay0.1.76.19.15`).

| Stumble | Outcome |
|---|---|
| The level-up read "Hit Points: 3 → 7" and the bar then showed 7/7: the app only knows the most hit points it has seen. | World, known: `sk-jay0.1.76.19.6`. |
| A wizard with 7 hit points was down before her first turn in three of five fights. | World, known: `sk-jay0.1.76.15.6`. |
| In a fight the foot line's recap is cut when it is long; the budget chips take the room. | Open. The whole text is in the story (S). |

## Polish round 3 on the stage shell, 2026-11-16

Played by an agent on `stage.html`, on fresh local worlds (`just play-host`),
with real input through agent-browser (Chrome for Testing, 1440 x 900). Bead
`sk-jay0.1.76.19.7`. Screenshots: `~/spellkave-evidence/classic-polish-3/` on
proteus.

**The content offers four classes** (Fighter, Rogue, Cleric, Wizard); a
ranger, a bard, a warlock or a paladin cannot be made. This round varies
species, background and build instead, and looks at what the rounds before
left out: the pack, rests, quests beyond the second. **Kavemouth has no
shop**, and a player has no action to equip, unequip or drop
(`sk-jay0.1.76.19.17`); there was nothing to buy and nothing to change.

### Hero 6: Pip, halfling fighter with a bow (level 2 reached, quests 4 and 5 taken)

Creation (class, background Criminal, species, two skills, fighting style
Archery, three weapon masteries, starting kit B with a longbow, scores, name,
confirmation), quest 1 (three falls to the cellar rats, won on the fourth
try), quest 2 (Jory followed after free words, the wolf fell to one blow),
level 2 at the ledger keeper: 11 to 17 hit points. Then the keeper's
companion, a short and a long rest, and quests 4 and 5 from the captain at
the gate.

| Stumble | Outcome |
|---|---|
| With 17 things in the pack, the picked thing's description and buttons lay below the fold of the sheet. | **Fixed.** The pack sheet is wide and has two panes: the list, and the picked thing beside it. |
| A thing showed its picture only while it was the picked one. | **Fixed.** The definition id a detail names is remembered by the thing's name (in the browser); the picture stays in the list. The list itself carries no id (gap "Pack"). |
| The last creation step read "Which confirmation?" over an empty panel; the top line cut the starting kit and the scores. | **Fixed.** The last step of a guided talk lists every answer, uncut. |
| The world writes some step names small ("fighting style", "weapon mastery"). | **Fixed.** A step name starts with a capital. |
| After an answer the talk panel read "listens." over nothing: the reply was a bubble for five seconds, and of two replies in a row only the second was seen. | **Fixed.** The panel keeps what the partner said since the hero last did something. |
| The captain answered a taken quest and asked the next question in the same breath; what quest 4 asks for was never on the screen. | **Fixed.** The sentence said right before an open question stands above it. |
| Down, the death saving throw and "wake at the inn" stood in a row of fifteen tags between Dash, Dodge and a long rest. | **Fixed.** A fold "While you are down" leads: the SRD's death saving throw and whatever the adventure (an id outside `srd/` and `core/`) puts on the hero. A ranking by id family, not a verdict. |
| Waking read "You are no longer affected by Incapacitated, No Action, No Bonus Action, No Reaction, Dead, Unconscious and Stable." | **Fixed.** A change of the hero's conditions is told by the whole, from the event's condition ids. |
| Free words to Brother Caddoc: "is thinking…" for 20 seconds, then nothing. | **Fixed.** The story says "Brother Caddoc has not answered." That he never answers is the world's (`sk-jay0.1.76.14.7`). |
| "Claim Victory" and "Help" led the tags of every innkeeper. | **Fixed.** Outside a fight they fold away with the attacks. |
| The top line cut a place's description; at the hamlet gate it cut the watch board that names the open troubles. | **Fixed.** Pointing at the description or a click shows it whole. |
| A walk over six places read "On the way to Hamlet Gate… 75%", then 0%, then 50%. | **Fixed.** "On the way to Hamlet Gate: 5 places to go, now to Crossroads…" |
| A walk broke with "actor '168' did not reach 'kavemouth/inn/foyer' within 11800ms" on the foot line, a moment after the arrival. | **Fixed.** A walk the move tool stopped watching is no refusal; the stage waits for the arrival as before. |
| "That did not work." and "The outcome could not be confirmed." stood alone in the story. | **Fixed.** A bare answer names what was tried: "Complete a Short Rest: The outcome could not be confirmed." |
| The keeper, calling from the inn, spoke as "6". | **Fixed.** The stage keeps the names of everybody the hero has stood beside; an unknown voice is "Someone". |
| The recap of a fight was cut on the foot line (left open by round 2). | **Fixed.** A long sentence takes two lines. |
| The longbow of kit B can never be used: no action equips it, "Ranged Attack" answers "That cannot be done right now." | World: `sk-jay0.1.76.19.17`. |
| Nothing lists the quests. Quest 2 running, quests 4 and 5 taken: the self summary's quest section stays empty. | World: `sk-jay0.1.76.19.16`. The hero sheet has the block and says that none are listed. |
| Three falls to the cellar rats: 11 damage before the first turn against 11 hit points. | World, known: `sk-jay0.1.76.15.6`. |
| Cellar Rat 1 was dead and took a second blow like a living foe. | World, known: `sk-jay0.1.76.19.12`. |
| A short rest answers "The outcome could not be confirmed."; "Ask Aldwin About Advancement" answers "That did not work."; the keeper says "Nothing to record yet, friend." before each real reply. | World wording. Not filed. |
| The halfling archer is drawn as a tall swordsman; Mira and Aldwin share one picture. | Art. Not filed. |
| The captain gives no directions to the mill and does not answer free words about the way. | World. Noted on `sk-jay0.1.76.19.16`. |

### Hero 7: Ugra, orc cleric (level 2 reached, with a natural 20 on the way)

Creation (class, background Soldier, species, two skills, divine order
Protector, three cantrips, four prepared spells, starting kit, scores, name,
confirmation), quest 1 (down before her first turn; a natural 20 on the
death saving throw put her back on her feet at 1 hit point; Healing Word on
herself, Guiding Bolt for the giant rat; down again to the swarm; a long
rest; Guiding Bolt for the swarm), Cure Wounds outside a fight, quest 2 (one
more fall to the wolf, then Guiding Bolt), level 2 at the ledger keeper by
the keeper's own way: "Roll for Hit Points", then "Confirm the level-up".

| Stumble | Outcome |
|---|---|
| In the loft the map offered "Common Room" (seen from the creation room); a click answered "From Guest Loft the world offers no way on towards Common Room." | **Fixed.** A place no chain of known ways leads to from here is dotted, dimmed and no walk target; its tag says "You know no way to ... from here yet." |
| A click on somebody who asks opened tags with "Answer" on top. | **Fixed.** The click opens the talk; in the talk, the next click opens the other offers. |
| At 1 hit point in a fight, a click on the hero opened "Actions (13)" from "Complete a Long Rest" to "Stand Up"; "Your spells" with the healing lay below the edge of the stage. | **Fixed.** In a fight the picked spells the hero can be the target of lead on the hero, before every fold. The rests have a fold of their own. |
| After a death saving throw the sheet read "Left when last spent: Death save successes 0 · Death save last roll 0"; after the level-up "Pending hp choice 0". | **Fixed.** Only the ruleset's own resources are shown, and not the count of death saving throws. |
| "Complete a Long Rest — You (Ugra): Nothing you notice changes." | **Fixed.** "Complete a Long Rest: Nothing you notice changes." |
| The browser of the test rig restarted by itself; the app opened in the middle of a fight with an empty foot line. | **Fixed.** Opened in a fight on the hero's turn, the foot line says "Your turn." |
| The same restart emptied `localStorage`: the map lost the hamlet and the road, and the stage no longer knew which spells are the hero's (they were back among 119). | World: the map and the spells live in the browser because no read gives them (`sk-jay0.1.76.19.8`, `sk-jay0.1.76.19.14`). A real browser keeps its store. |
| After a reload the keeper, calling from the inn, was "Someone" again. | **Fixed.** The names of everybody the hero has stood beside are kept in the browser like the map. |
| The level-up tags on the keeper explain themselves in the author's words: "Execute the drafted level-up choice: srd/level +1, srd/hp += hp_per_level", "zeroes the consent latch". "Roll for Hit Points (1d10)" for a cleric with an eight-sided die. | World wording. Not filed. |
| The story reads "You spend 20 Death Save Last Roll — 0 left." and "You spend 2 Pending Hp Choice — 0 left." | World wording. Not filed. |
| Waking at the inn takes a gold piece without a word; the pack count just drops. | World. Not filed. |
| Guiding Bolt "hits for 3 damage" and "for 4 damage" and kills; every foe of the round died of its first hit. | World, seen before. Not filed. |
| Armor 9 in a chain shirt with a shield; 5/9 hit points after the level-up. | World, known: `sk-jay0.1.76.15.7`, `sk-jay0.1.76.19.6`. |

### What the stage gained in round 3, beyond the fixes

- The pack sheet with two panes and pictures that stay.
- A summary of the hero at the last step of creation.
- A place's whole description on a card; a map that says where it knows no
  way; a walk that counts its places.
- A "Quests" block on the hero sheet, empty until the world marks quests
  (`sk-jay0.1.76.19.16`).

A trap for whoever plays next with agent-browser: without `--profile <dir>`
the browser can restart on its own and come back at `about:blank` with an
empty store. Reopen the page, set the viewport again, and expect the map and
the spell memory to start over.

## Polish round 4 on the stage shell, 2026-11-16

Played by an agent on `stage.html`, on a fresh local world (`just play-host`),
with real input through agent-browser (Chrome for Testing, 1440 x 900, a
persistent `--profile`). Bead `sk-jay0.1.76.19.7`. Screenshots:
`~/spellkave-evidence/classic-polish-4/` on proteus (300 to 398).

The round had four questions: what round 3 left rough, why level-1 heroes
keep dying (does the client hide options?), the whole quest chain, and map
and travel. One hero was taken as far as the content went in the time: past
level 2 to level 3, through five quests.

### Does the client hide options? Yes, four

| Hidden | Outcome |
|---|---|
| **The weapon mastery attack.** The world offers one attack per mastery ("Melee Attack (Graze)": a miss still does the Strength modifier in damage) and refuses the ones the weapon in hand does not have ("Melee Attack (Topple)" with a greatsword: "That cannot be done right now."). They sat three clicks deep, among twelve "More attacks". | **Fixed.** The one that fits the bound weapon and a mastery chosen in the creation talk leads, before the plain attack; the others have a fold "Weapon masteries". Which mastery a weapon has is a copy of the SRD weapon table: the hero's own masteries come empty (`sk-jay0.1.76.15.6`). |
| **Second Wind.** In a fight a click on the hero opened twelve tags by the alphabet; three "Give up and wake at the inn" stood before "Use Second Wind", the last one. | **Fixed.** What the class gives leads on the hero in a fight; giving up has a fold of its own at the end. |
| **The first blow.** A creature that has not opened a fight can be struck (three blows ended a Slime Scout that never had a turn). The attack lay behind "more" and "Attack (16)", after "Talk". | **Fixed.** On a target whose faction is not the hero's the attacks lead as in a fight, after "Talk". That most foes never answer a first blow is the world's (`sk-jay0.3.27.4`). |
| **The quest's own actions.** "Relight the altar", "Set the camp alight", "Call on Sister Maelis to yield" exist as actions. Until their target stands in their niche the client ranked them as misfits: into "Other", behind thirty skill checks. | **Fixed.** An action of the adventure (an id outside `srd/`, `core/`, `dm/`) whose target does not fit yet gets a fold named after its family ("Quest"). Two quests were finished through that fold. |

What the client cannot give: in all the fights that opened by themselves the
foe moved first, as before (`sk-jay0.1.76.15.6`). This hero was lucky in the
cellar (the rats missed every time, against chain mail and the Defense
style) and fell later, to four cultists.

### Hero 8: Korga, goliath fighter (level 3 reached, five quests)

Creation (class, background Sage, species, two skills, fighting style
Defense, masteries Greatsword Handaxe Javelin, kit A, scores, name,
confirmation), quest 1 (rats, no fall, 175 experience), quest 2 (the wolf,
Jory, 300), level 2 by the keeper's "Take the average Hit Points" and
"Confirm", the companion, Mira's barrow (Slime Scout, Crypt Warden with an
opportunity attack, 700), quests 4 and 5 from the captain, the mill: a fall
to four cultists at 750, woke at the inn, back by one click on the map over
17 places. Sister Maelis cannot be ended (see below). The forest shrine: the
specter and three shadows, the altar relit, Brother Caddoc's quest paid at
once and he joined (1500). Level 3 by the plain "Level Up": 23 hit points.
The war camp set alight from the cookfire (1750).

| Stumble | Outcome |
|---|---|
| A dead cultist stood as before; a whole turn went into the body. | **Eased.** Whoever is on the roster and had no turn in the last full round on record reads "out of the fight" under the name, is drawn grey and is marked on the turn order. The world still does not say who is dead (`sk-jay0.1.76.19.12`); the turn order does. |
| A living cultist stepped onto the dead one's cell, and the body on top took every click. | **Fixed.** Fighters on one cell stand side by side; one who is out of the fight stands at the back. |
| A blow at somebody two cells off: "That cannot be done right now." | **Eased.** A fighter's tags say what the grid shows: "Next to you." or "2 steps away." The world sends no reach (`sk-jay0.1.76.15.3`). |
| "Help" led the tags of every foe. | **Fixed.** On a target of another faction it folds away. |
| The companion stood half behind the keeper, and a click on it opened the keeper's tags. | **Fixed.** A sprite is a square with the figure in its middle third; only the middle takes clicks. Figures spread over the floor that a way at the right edge leaves free, and a step aside does not end on somebody else. |
| At 300 experience the keeper carried nine first-level tags in the order of the alphabet: accept, ask, confirm, decline, discard, level up, roll, take the average. | **Eased.** Outside a fight, a family of three and more on a crowded first level becomes a fold named after the family ("Level up (6)"). The plain "Level Up" stays in front. The order of the steps is the keeper's to say (see below). |
| A refused attempt read "Melee Attack (Topple) - Someone here: That cannot be done right now." | **Fixed.** It names the foe. |
| A dead body read "incapacitated" under its name. | **Fixed.** "dead". |
| "Here with you" stood on the tags of Sister Maelis. | **Fixed.** The world's filler note shows only with a condition the stage names. |
| Opened in the middle of a fight, the top line read "A fight". | **Fixed.** The place the hero last stood in is kept in the browser. |
| Three quests taken and nothing lists them. | **Eased.** The hero sheet keeps "What you answered": the answer the hero gave when somebody asked, and the asker's next sentence. A record of the talk, kept in the browser; no quest state. The world's side is `sk-jay0.1.76.19.16`. |
| Sister Maelis took over 44 damage in sixteen free blows and never fought, died or yielded; free words got no reply; no surrender is offered. Quest 4 cannot be finished. | World: evidence on `sk-jay0.3.27.19` and `sk-jay0.3.27.4`. The NPC host logs her as down (`wait/combat-self-down`) while she stands. |
| The Slime Scout, the Shrine Specter, three Shadows and three Hobgoblin Warriors never opened a fight; the first five died to free blows. | World, known: `sk-jay0.3.27.4`. |
| The companion arrives a few seconds after the hero and is on no fight's roster. Four cultists met the hero alone. | World. Noted on `sk-jay0.1.76.19.7`; not filed. |
| A way "south" leads from the bridge's south end to its north end; from the loft the stairs are "north" and from the stairs the loft is "south". | World, known: `sk-jay0.1.55.20`. |
| Every foe has few hit points (a giant rat 3, a wolf 4, a cultist 7); the last blow reports the damage capped ("for 1 damage"). A Graze reads "Your Melee Attack (Graze) misses ..." and then "You hit ... for 2 damage." | World wording. Not filed. |
| The relit altar answers "The shrine altar burns again is now 1." Brother Caddoc offers his quest only after free words, then pays it at once. | World wording. Not filed. |
| Second Wind healed to 17 of "13": the bar knows only the most hit points it has seen. | World, known: `sk-jay0.1.76.19.6`. |
| The level-up tags of the keeper explain themselves in the author's words, and nothing says in which order they go. | World wording, seen in round 3. Not filed. |

### Map and travel

One click on the map walked 17 places across five areas (loft to the cult
tunnels) and 12 places back from the shrine; a leg between two places takes
a few seconds now. Ten sheets after this run (Inn, Hamlet, Region, River
Crossing, Tomb, Deep Tomb, Mill, Shrine, Hesper's Lodge, Creation Limbo), in
the order of the alphabet after the hero's own. Nothing broke. Rough edges
left: a door tag can lie under a neighbour place's name, and the sheet
"Creation Limbo" stays for a finished hero (`sk-jay0.1.76.19.10`).

### Not played

The mine and its Ironfold key, the deep tomb, the goblin warren and the
truce, Old Tamsin's moonpetal, Ghorza herself. No second class in this
round: one hero was taken deep instead of two shallow.

A trap for whoever plays next with agent-browser: a key can get stuck and
repeat by itself (here "Minus", 40 000 key events a second; every command
took 5 to 12 s and some timed out). `agent-browser close` and `open` again
ends it; with `--profile <dir>` the map and the notes survive. Type into the
field with `fill`, send with a click on "Say".

## Live playthrough with the owner, 2026-11-16

A fresh world (`just play-host`), the owner at the mouse from hero creation
on, an agent watching the same browser session and fixing as they go
(`sk-jay0.1.76.19.7`).

- **Start trap.** This worktree has no `.envrc`, so `just play-host` failed at
  `node-start` with `command 'sk' not found`. `PATH="$PWD/bin:$PATH" just
  play-host` works.
- **"What does a class do?" Fixed.** Pointing at a class card showed only
  "Fighter. Read more" on one dim, cut line at the foot of the panel: the DM
  sends no description for a class. The stage now reads the reference guide's
  short text for the answer's definition id (the same preview Play shows) and
  prints it in full right under the cards, with the link. The DM's own
  description still wins where it sends one.
- **Much empty room under four cards. Fixed.** A guided talk's panel is
  always 46 % of the scene, whatever it holds. Up to five answers that say
  what they are now stand as tall cards side by side: picture, name and the
  text on the card, "Read more" under it. Nothing has to be pointed at. A
  crowd (skills, spells) stays small cards with the one line described above.
- **The hero stayed a pale arch after the class was chosen. Fixed.** A hero
  still being made has no class in the world. The figure now takes the
  picture of the class answered in the creation talk.
- **The outline on the top line was all text, and too much of it. Fixed.**
  A step shows the picture of its answer where there is one, the first answer
  and "+3" for the rest ("Skill Deception +3"); the whole stands in the
  tooltip. A long value is cut with "…".
- **No way to begin the hero again. Fixed.** With answers given, the talk
  panel shows "Start over" beside "Back" and "Forward". The first click asks
  ("Really start over?"), the second sends the DM's own discard command,
  which empties the whole draft. Not yet clicked on a live world.
- **Fighting style, weapon mastery and divine order had no picture and no
  text. Fixed (stop-gap).** An audit of every creation step found that the DM
  sends a reference for nearly all answers, but for a class choice it is the
  option's id, five parts long, and the stage only understood three. The
  stage now reads the granted definition out of it: fighting styles and
  weapons get sprite, text and link, divine orders text and link.
- **Skills and expertise say nothing about themselves. Open
  (`sk-jay0.1.76.19.20`).** Their text exists in the ruleset and on the
  public site, but skills are no link targets in the guide's reference list.
  Elf and Orc have a page, but a filter for short names drops them from that
  list. Species, backgrounds, skills and divine orders have no sprite at all:
  the SRD art set holds class portraits, creatures, items, spells and 17
  feats. Content, guide export and host, not the client.
- **Ability scores: only "Adopt the recommended array". Built, not yet seen
  live.** The world offers a form for six scores (8 to 15). At the step of
  that name the panel now shows it beside the DM's offer: one row per score
  with "−" and "+", the points spent by the SRD's cost table ("9 of 27"), and
  the form's own button. No typing. The DM's budget decides; a refusal shows
  as its sentence. Which form belongs to which step is read from the DM's
  names (the step's title is the last part of the form's action id).
- **The name field flashed up between two questions. Fixed.** For a moment
  after an answer no question is open, and the panel fell back to the name
  form, which stands open through the whole talk; the owner read it as the
  DM asking two things at once. The field now waits until its own step is
  next in the outline. It also shows when the outline names no such step, or
  when nothing was asked for eight seconds, so a name can always be given.
- **"Ability scores" stayed empty on the top line after the array was
  adopted. Fixed.** The DM sends its outline only with a question, so
  between two questions the outline is one answer behind. The stage now
  writes what was just answered into the open step and marks the next step
  as the current one.
- **The score rows started at 8 whatever the hero had. Fixed.** A row starts
  from the hero's own score where the world names one within the bounds.
- **A page reload between two questions lost the outline. Fixed.** The last
  guide was kept in memory only, so the top line was empty until the next
  question. It is kept in the browser now, with the answer given since, and
  dropped when the hero is finished.
- **The help text could vanish again. Fixed.** The panel kept the pointed-at
  answer as an object and dropped it when the round was read anew. It keeps
  the answer's id now, so the text stays, and text that arrives late shows.
- **Two "≈" bubbles in the top left corner. Hidden.** They mark what the app
  shows that the world does not send. On a live world they are off until
  switched on in the "Gaps" panel; the mock still shows them. The list is kept
  in one place, `LIVE_GAPS` in `src/stage/session/stage-from-view.ts`.
- **Owner questions passed on to the coordinator:** one app or several, where
  the source lives, and whether anybody should be able to deploy a client of
  their own (re-architecture and code organisation).

## Container inspection investigation, 2026-11-16

Client bead `sk-jay0.1.76.19.23`; content peer `sk-jay0.1.76.19.22`.
Read-only snapshot of the owner's `classic-live` browser showed Honk and
Chest in the Guest Loft, with 17 pack entries. No clicks or world writes
were performed. The content peer reported adding open/close actions for
the chest; opening and pickup were not tested by this client session.

The client fix is blocked on PLAYER disclosure (`sk-jay0.1.76.19.24`):

- `src/stage/session/stage-from-view.ts` projects occupants and fighters,
  so manipulation-only targets have no stage surface.
- The SDK's `ManipulationObservedTarget` carries refs, tags and niches,
  but no parent container or item name. `core/contained` alone cannot
  associate a target with a particular chest.
- `packages/spellkave-sdk/src/core/readers/scene.ts` builds entity targets
  from spatial location; scene detail returns those targets without contents.
  Inventory and item detail are scoped to the actor's own carried items
  (`inventory_query.ts`, `item_detail.ts` and the PLAYER tool wrappers).

The content peer's knowledge of two potions is not a PLAYER read. No loot
list was inferred from it, and no client feature was added. The follow-up
requests authorized contents with parent identity and explicit completeness,
then a fresh read after pickup. Lid-state disclosure policy is separate:
the peer reports that its content delta leaves `core/contained` unchanged.
Resume the client work after that contract is available; the owner still
needs to verify opening, inspecting and taking an item on the live stage.

## Live playthrough of 2026-11-15

The owner played from hero creation on a fresh world; an agent watched the
tab and built what came up. Epic `sk-jay0.1.76`.

- **New: help on every answer card.** The owner asked for help texts. A card
  whose answer the keeper names by definition id now has a "?". It opens the
  reference preview of `apps/play`: a short text from the public reference
  guide and a link to the full entry. The app holds no help text of its own.
  A definition the guide's list does not carry gets no "?"; on this day that
  was every species (`sk-jay0.1.76.13.6`).
- **New: back and forward in the wizard.** The owner picked Fighter and could
  not return to the class question; the only way was to discard the draft.
  The keeper now takes two more commands, `dm/creation/back` and
  `dm/creation/forward`, and the wizard shows them as buttons
  (`sk-jay0.1.76.13.5`). Back reopens the question before the open one and
  clears nothing. A new answer replaces the old one; a new class also drops
  what hung on the old class, as before. A question that takes several picks
  (skills) is reopened whole. Checked in a browser: Fighter, Acolyte, back
  twice to the class question, forward once, Sage; the list then read
  Fighter, Sage and the species question was open again.
- **Fixed: answers of a wiped world.** After `just play-host` the open tab
  still listed "Fighter" from the world before and counted "Step 2" on the
  class question: the fresh hero has the same id, so the tab found the old
  list. Each answer now remembers the prompt occurrence it was given to; a
  list with an answer that is not older than the open question is dropped.
  A list saved before this fix carries no occurrence and stays until
  "Discard the drafted character" is clicked once.
- **Fixed: the browser's own confirm box.** "Discard the drafted character"
  asked through the browser's native box. It now asks in the app's dialog,
  with the action's own description as the text.
- **Limit:** the "So far" list is still the wizard's own memory. After a
  reopened starting kit it can show an old item until the world sends the
  draft (`sk-jay0.1.76.13.1`).
- **Layout tried twice, then a fresh start decided.** The owner found the
  world view too close to Play: framed panes beside and below a small stage.
  Two passes the same day put the scene over the whole width, one line on
  top, and at last one narrow foot line (Do, Talk, the sentence line, Pack)
  whose panels open over the scene; map and fact list open over the scene
  too. Checked by screenshot of the owner's tab only; the panels behind the
  foot line's buttons were not opened. The owner then decided to design the
  interface and the app's architecture anew in a separate session, on mocks,
  without the shared Spellkave components (`sk-jay0.1.76.19`). These two
  passes are a sketch for that work.
- **No scene picture for any place.** The adventure has portraits, creature
  and item art and top-down maps, but no view of a place
  (`sk-jay0.1.76.14.8`).
- **Every walk is a journey.** A step longer than the hero's walk reach opens
  the long-running move session; the owner wants neighbour walks without it,
  by moving the place graphs, later (`sk-jay0.1.76.14.9`).
- **Decision asked:** turn the keeper's fixed chain of questions into data,
  with a machine contract per round, for every guided talk with a person in
  the world, not only hero creation (`sk-jay0.1.76.13.7`).

### Known issues

- **Nothing to equip or use.** The world lists no equip, unequip or use
  action that fits an item, and things inside the backpack get no actions at
  all. The sheet shows whatever the world lists, so for now that is attacks
  and checks in folds (`sk-jay0.1.76.16.1`). Needs game content.
- **The old shell's map draws only what the hero sees now.** A place two
  rooms back is not on it. The old shell remembers such places for the
  browser tab and lists them; after closing the tab the list starts empty.
  The stage shell keeps an atlas of everything seen (night run above).
- **No picture of the place.** The stage is still a plain surface: Kavemouth
   authors no place picture. The app draws one as the stage backdrop as
  soon as the world sends it (`sk-jay0.1.76.14.1`).
- **A gate has no sentence.** The world sends a gate's id; the app shows its
  last part ("dm threshold").
- **Five steps a turn** instead of six (`sk-jay0.1.76.15.9`).

- **The cellar fight is hard.** A level-1 wizard cannot survive it and a
  level-1 fighter lost it in two of three tries (`sk-jay0.1.76.15.6`). One
  rat hit does 4 to 8 damage against 11 hit points.
- **The shown Armor Class is too low for a hero in armour.** A fighter in
  chain mail reads AC 12. The armour is worn (see the sheet); the world
  reports the stored number, while the rules, by the code, defend with 16
  (`sk-jay0.1.76.15.7`). Not an app bug; the app shows what the world says.
- **Nobody answers free words.** Aldwin answers his quest question at once,
  but typed sentences get no reply on the local host. The line "… is
  thinking" then ends by itself after 20 seconds (`sk-jay0.1.76.14.7`).
- **The sheet shows no weapon masteries** although three were picked in the
  wizard (`sk-jay0.1.76.15.6`), and no spells or spell slots.
- **No reach or range on the grid.** Only the neighbour cells are marked.
  Which cells the hero can still reach this turn, and what a weapon reaches,
  is not shown (`sk-jay0.1.76.15.3`). The stage shell says on a fighter's
  tags how many steps away they stand. You walk cell by cell; a step onto a
  foe's cell answers "The way is closed to you right now."
- **Three "wake at the inn" buttons** with nearly the same label; they are
  three authored actions. The stage shell shows each one's description
  while it is pointed at.
- **The spell list is the whole ruleset**, not what the hero prepared, and
  nothing shows spell slots (`sk-jay0.1.76.14.4`, `sk-jay0.1.76.19.14`). The
  stage shell puts the spells picked in the creation talk first and shows
  what a spend last left; both live in the browser only.
- **Free words to everyone** arrive as several rows from the world; the app
  folds them into one line (`sk-jay0.1.76.14.6`).
- **Every closed way gives the same sentence** ("The way is closed to you
  right now.") (`sk-jay0.1.76.14.5`).
- The side panel "What the world gave" is a developer read-out.
