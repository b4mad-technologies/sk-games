# `apps/classic/` — agent context

The classic player app: point-and-click, step-by-step hero creation, a
clickable world. Epic `sk-jay0.1.76`. It is a second client next to
`apps/play` on the same server, SDK, session and PLAYER tools.

> **Two shells, side by side (owner decisions, 2026-11-15).** The owner had
> this app's interface and architecture designed anew, on mocks, without the
> shared Spellkave components (epic `sk-jay0.1.76.19`): the stage shell,
> `stage.html`, wired to the live world the same day. The old shell
> (`index.html`) stays: asked whether it should be removed, the owner said it
> is one more client, and many clients are a feature of Spellkave. Which of
> the two the bare address shows is not decided. The rules below marked with
> the owner exception hold for the old shell; the stage shell follows
> [`DESIGN.md`](DESIGN.md). The stage shell is **desktop only** (owner
> decision, 2026-11-15, `sk-jay0.1.76.19.7`): it has no phone layout, and none
> is to be added without a new decision.

## What the owner decided (2026-11-14)

The full rule set, with what is built, is
[`ledger/designs/classic-interaction-rules.md`](../../ledger/designs/classic-interaction-rules.md).
Read it before any interaction work here. In short:

- **Clicks act.** The player clicks a token, a cell or a way out and picks from
  a menu. This is the opposite of Play's axiom A1
  ([`ledger/designs/play-interaction-axioms.md`](../../ledger/designs/play-interaction-axioms.md)),
  which stays binding for `apps/play` and does not apply here.
- **Offer, then let the world answer.** The app may offer an action the world
  then refuses. ADR-0141 stays: no eligibility read; the client pairs "my
  actions" with "targets I see". A refusal is shown and remembered.
- **Coupled to the SRD ruleset, not to an adventure.** `srd/*` ids, SRD class,
  species and background names and SRD art
  (`packages/spellkave-srd-cc/assets/srd-art`) may be used directly. No
  adventure id, place name or NPC name may appear in app code.
- **The creation wizard talks to the DM NPC under the hood.** The order of the
  steps is data in the DM's duty document (`creation.guide`); the Rust DM walks
  it (`crates/spellkave-npc-host/src/guide.rs`, `dm/engine/creation_dialog.rs`)
  and sends, with every question, where the dialogue stands
  (`presentation.guide`; contract in
  [`ledger/designs/guided-dialogue-tree.md`](../../ledger/designs/guided-dialogue-tree.md)).
  The wizard is another view on that dialogue. The old shell's wizard
  (`src/creation/`) does not read the outline and still keeps its own answer
  list; the stage shell shows the DM's outline and keeps no answer list
  (`src/stage/session/talk-from-view.ts`). It remembers only the definition
  ids that were answered, as a ranking signal for a caster's spells
  (`src/stage/session/world.svelte.ts`, stop-gap for `sk-jay0.1.76.19.14`).
- **Show what the world gives.** Where the world sends no position inside a
  place, tokens get a stable client-side spot (`src/lib/placement.ts`).
- **Typing stays for speech and the hero's name only.** Free speech is typed
  in the talk panel, to one person or to everyone here; a click menu offers
  "Talk" instead of listing the speech acts once per target.

## Layout

| Path | What |
|---|---|
| `index.html`, `src/App.svelte` | The app: a live world through the PLAYER tools. |
| `stage.html`, `src/stage/` | **The fresh start** (`sk-jay0.1.76.19`): new shell and its own design layer. Design and owner exception: [`DESIGN.md`](DESIGN.md). `src/stage/model.ts` is the port the shell reads and acts through. With a staged world it plays live; without one, or with `?mock`, on the fixture world (`src/stage/mock/`). |
| `src/stage/session/` | The live world behind the port: `stage-from-view.ts` maps a `PlayView` to a `Stage` (pure), `talk-from-view.ts` maps open questions and the DM's guide to the talk panel's `Round` (pure), `fight-from-view.ts` puts the turn session and its grid on the floor (pure), `atlas.ts` keeps every place the hero has seen, per area, from the map plates and the ways out (pure), `map-from-view.ts` lays the atlas out as the map panel's sheets (pure), `world.svelte.ts` holds the session and what the client remembers (refusals, click results, pictures), `deps.ts` is its real outside. `fixtures/` holds views recorded from a local world. |
| `demo.html`, `src/demo/` | Clickable mock-up on fixture data (wizard, world, fight, sheet). "Show gaps" marks what it fakes. No world connection. |
| `src/lib/placement.ts` | Stage coordinates for occupants and exits. |
| `src/lib/ClickMenu.svelte` | The click menu. |
| `src/lib/menu.ts` | Which actions lead a menu and which fold away: fight or journey, niche fit, weapon-bound attacks, the weapon's mastery attack (a copy of the SRD weapon table), foe or ally by faction, the adventure's own deeds, a crowd of one family. |
| `src/lib/travel.ts` | The area map as a graph: route to a clicked place, remembered places, gate hints. |
| `src/lib/fight.ts` | Fight tokens from the turn roster, the turn budget, steps left. |
| `src/lib/Sheet.svelte` | Hero sheet and pack: item sprite, item actions. |
| `src/lib/world-art.ts` | The world's own pictures (ADR-0073) through the gateway, hash-checked; needs `VITE_SPELLKAVE_GATEWAY_URL`. |
| `src/lib/srd-art.ts` | SRD sprites by definition id, bundled with the app. |
| `src/lib/talk.ts`, `src/lib/TalkPanel.svelte` | The talk panel: what was said, open questions with bound answers, one field for free speech. |
| `src/creation/` | The hero creation wizard, a view on the DM's dialogue. |
| `src/lib/ReferenceHelp.svelte` | The "?" beside a definition id: the reference preview of `apps/play`, by exact id from the public reference list. |

## Binding rules

- World reads and actions go through the PLAYER tools, as in `apps/play`. No
  generated bindings, subscription SQL or raw table reads.
- The session library is still imported from `apps/play/src/lib`
  (`play-session.ts`, `play-view.ts`). That is a known debt, bead
  `sk-jay0.1.76.7`: extract it into a package. Since 2026-11-15 the reference
  preview (`components/ReferencePreview.svelte`, `lib/reference-vocabulary.ts`)
  is imported the same way by `src/lib/ReferenceHelp.svelte` and belongs to the
  same debt; the stage shell reads that preview's loader
  (`lib/reference-preview.ts`) in `src/stage/session/deps.ts` for the short
  text under an answer. So is `lib/play-trail.ts`, read by `src/stage/session/deps.ts` to
  learn whether the last attempt was refused (the handle returns only the
  sentence). Do not add a further deep import; extend the extraction instead.
- Colours, type and controls come from `@spellkave/ui` tokens and primitives
  ([`DESIGN.md`](../../DESIGN.md)). Targets are at least 44 px. **Owner
  exception (2026-11-15):** `src/stage/**` has its own design layer and uses
  no `@spellkave/ui`, `@spellkave/ui-widgets` or Play component
  ([`DESIGN.md`](DESIGN.md)).
- No sign-in yet. In dev the app plays the world `just play-stage` staged
  (`vite.config.ts` `readStagedProfile`); a production build has no world to
  open. Sign-in, world choice and seats come with the extraction.

## Local play

```bash
just play-host                                # node + world + Rust NPC host + candidate hero
pnpm --filter @spellkave/classic run dev      # http://127.0.0.1:5173/
```

`just play-host` wipes this worktree's world; see
[`docs/development.md`](../../docs/development.md#hand-play-with-the-cast-just-play-host).
`just play-stage kavemouth` alone also works, but then nobody answers: the DM
and the cast need the host.

Step-by-step play, the playtest record and the known issues:
[`PLAYTEST.md`](PLAYTEST.md).

## Verification

```bash
pnpm --filter @spellkave/classic run typecheck
pnpm --filter @spellkave/classic run test
pnpm --filter @spellkave/classic run build
```
