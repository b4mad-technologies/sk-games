/**
 * Shared, authored PlayView examples for the playground and smoke tests.
 * These are illustrative snapshots, not recordings of a current live world.
 */
import type { PlaySessionHandle } from "../lib/play-session";
import type { PlayView } from "../lib/play-view";
import { heroFromSelfSummary } from "../lib/play-view";

/**
 * A tiny synthetic tactical-grid plate (S2, sk-jay0.1.8.38): a 3×2 lattice
 * of composed grid cells, each `<g data-node-id="…">` wrapping a
 * `class="grid-cell"` `<rect>` — the exact marker `hasGridCells`
 * (`@spellkave/ui-widgets/battle-map.ts`) looks for and `BattleMap.svelte`
 * queries. Hand-written rather than run through
 * `@spellkave/world-map`'s `renderSpatialGraphSvg` (`packages/spellkave-world-map/src/svg/render-svg.ts`):
 * that renderer takes a laid-out `SpatialGraphModel`, not a bare list of
 * cell ids, so building one here would mean standing up the whole layout
 * pipeline for a fixture that only needs to exercise `data-node-id`
 * hit-testing. Mirrors `render-svg.ts`'s own shape closely enough
 * (`<g data-node-id>` → `<rect class="grid-cell">`) that `hasGridCells` and
 * `BattleMap`'s cell-decoration effect both treat it exactly like the
 * world's own drawing.
 */
function battleGridSvg(ownCellId: string, offeredCellIds: readonly string[]): string {
	const cols = 3;
	const rows = 2;
	const cellPx = 40;
	const ids = [ownCellId, ...offeredCellIds];
	let extra = 0;
	const cells: string[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			const id = ids[row * cols + col] ?? `session_grid_58/c_filler_${extra++}`;
			const x = col * cellPx;
			const y = row * cellPx;
			cells.push(
				`<g data-node-id="${id}"><rect x="${x}" y="${y}" width="${cellPx}" height="${cellPx}" class="grid-cell" /></g>`,
			);
		}
	}
	return `<svg viewBox="0 0 ${cols * cellPx} ${rows * cellPx}" xmlns="http://www.w3.org/2000/svg">${cells.join("")}</svg>`;
}

export const sampleView: PlayView = {
	// This hand-authored snapshot powers historical playback and old interaction
	// walkthroughs. Live session adapters never set this marker.
	interactionOrigin: "legacy-recording",
	hero: {
		actorId: "7",
		name: "Renn the Roadwarden",
		species: "Human",
		className: "Fighter",
		background: "Soldier",
		level: 1,
		hp: 11,
		ac: 16,
		xp: 0,
		proficiency: 2,
		vitals: [
			{ id: "srd/hp", label: "Hit Points", value: "11" },
			{ id: "srd/ac", label: "Armor Class", value: "16" },
			{ id: "srd/level", label: "Character Level", value: "1" },
		],
		abilities: [
			{ id: "srd/str", label: "STR", score: 16, modifier: 3 },
			{ id: "srd/dex", label: "DEX", score: 12, modifier: 1 },
			{ id: "srd/con", label: "CON", score: 14, modifier: 2 },
			{ id: "srd/int", label: "INT", score: 10, modifier: 0 },
			{ id: "srd/wis", label: "WIS", score: 11, modifier: 0 },
			{ id: "srd/cha", label: "CHA", score: 9, modifier: -1 },
		],
		skills: [
			{ id: "srd/skill/athletics", label: "Athletics" },
			{ id: "srd/skill/perception", label: "Perception" },
		],
		masteries: [],
		conditions: [],
		appearance: "Human fighter, a soldier's bearing",
		backstory: "A roadwarden out of the Ashwold garrison, six years on the King's highways.",
		placeId: "inn/common_room",
	},
	place: {
		id: "inn/common_room",
		name: "Common Room",
		description:
			"Long trestle tables share the room with a low fire, the smell of woodsmoke and last night's stew going cold on the hearth.",
		exits: [
			{
				handle: "s:exit:1",
				rev: "r1",
				label: "southeast",
				to: "inn/stairs",
				toName: "Stairs",
				gates: [],
			},
			{ handle: "s:exit:2", rev: "r2", label: "north", to: "inn/bar", toName: "Bar", gates: [] },
			{
				handle: "s:exit:3",
				rev: "r3",
				label: "west",
				to: "inn/foyer",
				toName: "Foyer",
				gates: ["kavemouth/affordance/dm_threshold"],
			},
		],
	},
	occupants: [
		{
			id: "4",
			handle: "s:actor:4",
			rev: "a4",
			kind: "person",
			sceneKind: "actor",
			name: "Aldwin, keeper of the hearth-ledger",
			conditions: [],
			note: "Here with you",
		},
		{
			id: "9",
			handle: "s:actor:9",
			rev: "a9",
			kind: "person",
			sceneKind: "actor",
			name: "Brother Caddoc",
			conditions: [],
			note: "Here with you",
		},
		{
			id: "31",
			handle: "s:entity:31",
			rev: "e31",
			kind: "thing",
			sceneKind: "entity",
			name: "Hearth",
			conditions: [],
			note: "Something here",
		},
	],
	actions: [
		{
			id: "h:talk",
			label: "Speak To — Aldwin, keeper of the hearth-ledger",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: true,
		},
		{
			id: "h:ask",
			label: "Ask Aldwin About Advancement",
			verb: "communicate",
			descriptor: "dm/dialog/ask-advancement",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
		},
		{
			id: "h:arcana",
			label: "Check: Arcana",
			verb: "manipulate",
			descriptor: "srd/check/arcana",
			targetName: "",
			targetRef: "entity:7",
			acceptsUtterance: false,
		},
		{
			id: "h:look",
			label: "Look around",
			verb: "sensing",
			descriptor: "srd/sense/look",
			targetName: "",
			targetRef: "entity:7",
			acceptsUtterance: false,
		},
	],
	actionCount: 4,
	manipulationContext: { status: "unavailable" },
	session: {
		inSession: false,
		myTurn: false,
		lifecycle: null,
		currentActor: null,
		currentActorName: null,
		roster: [],
	},
	reaction: null,
	pack: [
		{
			id: "12",
			name: "Longsword",
			detail: "Weapon",
			quantity: 1,
			equipped: "main hand",
			handle: "i:12",
			rev: "p12",
		},
		{
			id: "13",
			name: "Rations",
			detail: "Provisions",
			quantity: 3,
			equipped: null,
			handle: "i:13",
			rev: "p13",
		},
		{
			id: "14",
			name: "Torch",
			detail: "Light",
			quantity: 1,
			equipped: null,
			handle: "i:14",
			rev: "p14",
		},
	],
	// The Pack stage's on-demand selection — the Longsword's own detail, so a
	// stage-opened Pack tile shows a real item without a live session (demo.html,
	// the smoke tests). play-view.test.ts covers the mappers that build this
	// shape from the raw tool payloads.
	itemDetail: {
		id: "12",
		kind: "Weapon",
		slot: "Main Hand",
		facts: [
			{ id: "srd/damage", label: "Damage", value: "1d8" },
			// Pre-formatted the way `itemDetailFromPayload` would render it from
			// the raw tool row ({ state_id: "srd/weight_g", value: "1360" }) —
			// this fixture hand-builds the already-mapped `PlayView` shape, so
			// it carries the mapper's own output rather than running through it.
			{ id: "srd/weight_g", label: "Weight", value: "1,360 g" },
		],
		verbs: [
			{
				id: "h:unequip-longsword",
				label: "Unequip",
				verb: "manipulate",
				descriptor: "srd/unequip",
				targetName: "Longsword",
				targetRef: "item:12",
				acceptsUtterance: false,
			},
			{
				id: "h:drop-longsword",
				label: "Drop",
				verb: "manipulate",
				descriptor: "srd/drop",
				targetName: "Longsword",
				targetRef: "item:12",
				acceptsUtterance: false,
			},
		],
	},
	speech: [
		{
			id: "speech:1",
			tick: 40,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "Morning. The cellar has been loud since before dawn — rats, by the sound of it.",
			mine: false,
		},
	],
	// Demo-only placeholder kinds outside today's real `WorldEvent` union
	// (`passage_opened`/`promise_made` — the substrate has no arrival/
	// departure event to stand in for yet, see `CHRONICLE_KIND_RULES`,
	// play-view.ts) — deliberately kept to exercise the Chronicle's
	// unrecognized-kind fallback (visible at stage under "Things", never at
	// card: sk-jay0.1.8.13).
	events: [
		{ id: "event-1", tick: 42, kind: "passage_opened", summary: "The eastern road opened." },
		{
			id: "event-2",
			tick: 39,
			kind: "promise_made",
			summary: "Mira promised to return before dusk.",
		},
	],
	mapSvg: null,
	economy: null,
};

/** Synthetic second-system fixture: tests presentation, not world rules. */
export const configuredSheetView: PlayView = {
	...sampleView,
	actions: sampleView.actions.map((action) =>
		action.id === "h:look"
			? {
					...action,
					description: "Study the visible surroundings.\nThis is a synthetic presentation example.",
				}
			: action,
	),
	hero: heroFromSelfSummary(
		"7",
		{
			self: {
				entity_name: "Pilot",
				quest: {
					items: [
						{ state_id: "other/beacons", display_name: "Beacons restored", value: "0" },
						{
							state_id: "other/mission",
							display_name: "Current assignment",
							value: "Return to the orbital station",
						},
					],
				},
				conditions: {
					items: [
						{ condition_definition_id: "other/fatigue", stack_count: 3, expires_at_tick: 1200 },
					],
				},
				vitals: {
					items: [
						{ state_id: "other/stress", display_name: "Stress", value: "0" },
						{ state_id: "other/rank", display_name: "Clearance", value: "Amber" },
						{ state_id: "other/supply", display_name: "Emergency supplies", value: "12" },
						{ state_id: "other/reserve", display_name: "Reserve", value: "3" },
						{ state_id: "other/contact", display_name: "Contact", value: "Available" },
						{ state_id: "other/reputation", display_name: "Reputation", value: "Trusted" },
					],
				},
			},
		},
		{
			items: [
				{
					state_id: "other/beacons",
					description: "Restore the distant beacons to reconnect the station.",
				},
			],
		},
	),
};

/** The fight beat's own cell (S2, sk-jay0.1.8.38): `place.id` doubles as the
 * grid's own node id once a tactical session is open (ADR-0052), matching a
 * cell `battleGridSvg` draws. */
const FIGHT_OWN_CELL = "session_grid_58/c_1_0";
/** The one adjacent cell the fight offers a step onto — `northwest`'s own
 * `toNodeId`, matching another cell `battleGridSvg` draws. */
const FIGHT_OFFERED_CELL = "session_grid_58/c_0_0";

export const fightView: PlayView = {
	...sampleView,
	mapSvg: battleGridSvg(FIGHT_OWN_CELL, [FIGHT_OFFERED_CELL]),
	place: {
		id: FIGHT_OWN_CELL,
		name: "Cellar",
		description: "Barrels, damp stone, and a scuffle of claws in the dark.",
		exits: [
			{
				handle: "s:exit:9",
				rev: "r9",
				label: "northwest",
				to: "inn/stairs",
				toNodeId: FIGHT_OFFERED_CELL,
				toName: "Stairs",
				gates: [],
			},
		],
	},
	occupants: [
		{
			id: "123",
			handle: "s:actor:123",
			rev: "c1",
			kind: "creature",
			sceneKind: "actor",
			name: "Cellar Rat 1",
			conditions: [],
			note: "Here with you",
		},
		{
			id: "125",
			handle: "s:actor:125",
			rev: "c2",
			kind: "creature",
			sceneKind: "actor",
			name: "Cellar Rat 2",
			conditions: ["srd/condition/dead"],
			note: "Dead",
		},
	],
	actions: [
		{
			id: "h:melee",
			label: "Melee Attack — Cellar Rat 1",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Cellar Rat 1",
			targetRef: "entity:123",
			acceptsUtterance: false,
			group: "combat",
		},
		{
			id: "h:dodge",
			label: "Dodge",
			verb: "manipulate",
			descriptor: "srd/action/dodge",
			targetName: "",
			targetRef: "entity:7",
			acceptsUtterance: false,
		},
		// Featured only inside a live fight (sk-jay0.1.8.11 item 5,
		// `isFeaturedAction`'s `inCombat` gate) — carried here so the demo
		// beats and `check:no-scroll` exercise that gate through a real
		// scene, not only the synthetic actions `play-table.test.ts`
		// constructs (sk-jay0.1.8.16 task 2). Combined with the Melee
		// Attack combat-group action above purely to prove the mechanism;
		// the world never actually offers both at once (a wielded weapon
		// crowds out Unarmed Strike's own affordance).
		{
			id: "h:unarmed-strike",
			label: "Unarmed strike: damage — Cellar Rat 1",
			verb: "manipulate",
			descriptor: "srd/attack/unarmed-strike/damage",
			targetName: "Cellar Rat 1",
			targetRef: "entity:123",
			acceptsUtterance: false,
		},
	],
	actionCount: 3,
	session: {
		inSession: true,
		myTurn: true,
		lifecycle: "open",
		currentActor: "7",
		currentActorName: "Renn the Roadwarden",
		roster: [
			{ actorId: "7", name: "Renn the Roadwarden", ordinal: 0, isMe: true, isCurrent: true },
			{ actorId: "123", name: "Cellar Rat 1", ordinal: 1, isMe: false, isCurrent: false },
		],
	},
	speech: [],
	// The cellar brawl's own Chronicle facts (sk-jay0.1.8.13 task 6, "a brawl
	// with damage and a session opening"): the session opening, then a hit
	// taken and a hit dealt — both `fight`-chip, both important, so the card
	// lists them alongside the session opening instead of the empty "Nothing
	// visible has changed" the co-play finding reported.
	events: [
		{
			id: "event-9",
			tick: 58,
			kind: "session_lifecycle",
			summary: "A session opens (2 participants).",
		},
		{
			id: "event-10",
			tick: 59,
			kind: "self_hit",
			summary: "You take 3 srd/hp damage (bite) — now at 8.",
		},
		{ id: "event-11", tick: 60, kind: "dealt_hit", summary: "You hit Cellar Rat 1 for 5 damage." },
	],
	// The fight beat's own action economy (sk-jay0.1.8.40, S4): the melee
	// attack above already spent the primary channel this round; bonus,
	// reaction and object interaction stay unspent — exercises every one of
	// `Economy.svelte`'s two states in one fixture.
	economy: [
		{ channelId: "srd/economy_channel/primary", spentMs: 1000, windowStartMs: 0 },
		{ channelId: "srd/economy_channel/bonus", spentMs: 0, windowStartMs: 0 },
		{ channelId: "srd/economy_channel/reaction", spentMs: 0, windowStartMs: 0 },
		{ channelId: "srd/economy_channel/object_interaction", spentMs: 0, windowStartMs: 0 },
	],
	// sk-jay0.4.2: the roster's own drawn cells — the SAME two named cells
	// `battleGridSvg` draws above (FIGHT_OWN_CELL/FIGHT_OFFERED_CELL), so a
	// later map widget can join this fixture's tokens to its own SVG without
	// inventing a third cell no picture ever draws.
	sessionTokens: [
		{ nodeId: FIGHT_OWN_CELL, actorId: "7", name: "Renn the Roadwarden", isMe: true },
		{ nodeId: FIGHT_OFFERED_CELL, actorId: "123", name: "Cellar Rat 1", isMe: false },
	],
};

/**
 * `fightView` with Cellar Rat 2 (already a dead `spellkave_scene` occupant
 * in `fightView.occupants`) restored to the session roster, and Cellar Rat 1
 * given an extra disclosed condition (S5, sk-jay0.1.8.41, design doc §9/§10
 * row S5) — exercises the tracker's own struck-through dead chip and its
 * condition-token row in one fixture, without perturbing `fightView`
 * (`beat=fight`) itself: that beat's own card-density budget at 390×844 is
 * already the tightest S1/S3 tuned it to (`check:tile-clip`), and a third
 * tracker chip goes over it.
 */
export const fightWithConditionsView: PlayView = {
	...fightView,
	occupants: fightView.occupants.map((occupant) =>
		occupant.id === "123" ? { ...occupant, conditions: ["srd/condition/prone"] } : occupant,
	),
	session: {
		...fightView.session,
		roster: [
			...fightView.session.roster,
			{ actorId: "125", name: "Cellar Rat 2", ordinal: 2, isMe: false, isCurrent: false },
		],
	},
};

/**
 * `fightView`'s roster extended to six members (Renn plus five rats) —
 * stresses the tracker strip's own single-row scroll budget at card density
 * (sk-jay0.1.8.37 follow-up, §10 row S1): the dossier never bounds roster
 * size, so the fixed-height card tile must not depend on it either. Reuses
 * `fightView`'s own actions/session/occupants shape; the four extra roster
 * members have no matching `spellkave_scene` occupant — no condition/dead
 * claim is made about them, they exist only to fill out the tracker.
 */
export const fightCrowdView: PlayView = {
	...fightView,
	session: {
		...fightView.session,
		roster: [
			...fightView.session.roster,
			{ actorId: "126", name: "Cellar Rat 3", ordinal: 2, isMe: false, isCurrent: false },
			{ actorId: "127", name: "Cellar Rat 4", ordinal: 3, isMe: false, isCurrent: false },
			{ actorId: "128", name: "Cellar Rat 5", ordinal: 4, isMe: false, isCurrent: false },
			{ actorId: "129", name: "Cellar Rat 6", ordinal: 5, isMe: false, isCurrent: false },
		],
	},
};

export const talkView: PlayView = {
	...sampleView,
	speech: [
		{
			id: "speech:2",
			tick: 41,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "Which class calls to you? 1 Fighter, 2 Wizard, 3 Rogue",
			mine: false,
		},
	],
	actions: [
		{
			id: "h:answer-1",
			label: "Answer — Fighter",
			verb: "communicate",
			descriptor: "dm/dialog/answer",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot: 1,
		},
		{
			id: "h:answer-2",
			label: "Answer — Wizard",
			verb: "communicate",
			descriptor: "dm/dialog/answer",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot: 2,
		},
		{
			id: "h:answer-3",
			label: "Answer — Rogue",
			verb: "communicate",
			descriptor: "dm/dialog/answer",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot: 3,
		},
		{
			id: "h:talk",
			label: "Speak To — Aldwin, keeper of the hearth-ledger",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: true,
		},
	],
	actionCount: 4,
};

/**
 * Aldwin's four-line burst with an open species prompt AND a line-bound
 * offered action (sk-jay0.1.8.12 task 8, the bead's own acceptance
 * scenario): "Adopt the recommended array" belongs to the SECOND line (the
 * one that actually mentions an array), the numbered species answers belong
 * to the LAST line (the one that actually asks) — `Thread`'s own
 * keyword-matching heuristic (`play-table.ts`'s `lineForAction`) is
 * deliberately exercised here, not sidestepped.
 */
export const talkBurstView: PlayView = {
	...sampleView,
	// One tick for the whole burst (the live rig's own shape: "all these
	// traces share a tick") and trace ids crossing a digit boundary
	// (8, 9, 10, 11) — the id tie-break must sort these NUMERICALLY, not as
	// strings ("speech:10" < "speech:8" lexically), the ordering defect
	// found on the live rig after this bead's first pass (mergeSpeech's
	// comparator, play-view.ts).
	speech: [
		{
			id: "speech:8",
			tick: 50,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "Welcome back to the hearth-ledger, traveller.",
			mine: false,
		},
		{
			id: "speech:9",
			tick: 50,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "You could also just adopt the recommended array for a fresh start.",
			mine: false,
		},
		{
			id: "speech:10",
			tick: 50,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "Take your time; there is no wrong answer here.",
			mine: false,
		},
		{
			id: "speech:11",
			tick: 50,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "So — which species calls to you? 1 Human, 2 Elf, 3 Dwarf, 4 Halfling.",
			mine: false,
			addresseeName: "Renn the Roadwarden",
		},
	],
	actions: [
		{
			id: "h:species-1",
			label: "Answer — Human",
			verb: "communicate",
			descriptor: "dm/dialog/choice/1",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot: 1,
		},
		{
			id: "h:species-2",
			label: "Answer — Elf",
			verb: "communicate",
			descriptor: "dm/dialog/choice/2",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot: 2,
		},
		{
			id: "h:species-3",
			label: "Answer — Dwarf",
			verb: "communicate",
			descriptor: "dm/dialog/choice/3",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot: 3,
		},
		{
			id: "h:species-4",
			label: "Answer — Halfling",
			verb: "communicate",
			descriptor: "dm/dialog/choice/4",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot: 4,
		},
		{
			id: "h:adopt-array",
			label: "Adopt the recommended array — Aldwin, keeper of the hearth-ledger",
			verb: "communicate",
			descriptor: "srd/adopt-recommended-array",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
		},
		{
			id: "h:talk",
			label: "Speak To — Aldwin, keeper of the hearth-ledger",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: true,
		},
	],
	actionCount: 6,
	// The creation dialogue's own Chronicle fact (sk-jay0.1.8.13 task 6, "a
	// creation dialogue — reuse talkBurstView"): the character-creation
	// session opening, before Aldwin's own burst (tick 50-53) — the
	// substrate has no `arrived` event kind yet (`CHRONICLE_KIND_RULES`,
	// play-view.ts), so `session_lifecycle` stands in for the candidate's own
	// arrival at the table. Overrides `sampleView.events` entirely (no
	// `passage_opened`/`promise_made` placeholder noise in this one).
	events: [
		{
			id: "event-20",
			tick: 49,
			kind: "session_lifecycle",
			summary: "A session opens (2 participants).",
		},
	],
};

/**
 * A group exchange: three speakers at the place, one line each addressed to
 * someone else present (`addresseeName`) — the "to <name>" suffix and the
 * participant head's multiple names, both exercised (sk-jay0.1.8.12 task 8).
 */
export const talkGroupView: PlayView = {
	...sampleView,
	occupants: [
		...sampleView.occupants,
		{
			id: "40",
			handle: "s:actor:40",
			rev: "a40",
			kind: "person",
			sceneKind: "actor",
			name: "Mira",
			conditions: [],
			note: "Here with you",
		},
	],
	speech: [
		{
			id: "speech:30",
			tick: 60,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "The cellar has been loud since before dawn.",
			mine: false,
			addresseeName: "Brother Caddoc",
		},
		{
			id: "speech:31",
			tick: 61,
			speakerId: "9",
			speaker: "Brother Caddoc",
			text: "Rats, if I had to wager — I can bless the threshold before anyone goes down.",
			mine: false,
			addresseeName: "Aldwin, keeper of the hearth-ledger",
		},
		{
			id: "speech:32",
			tick: 62,
			speakerId: "40",
			speaker: "Mira",
			text: "I'll come along, if the roadwarden will have me.",
			mine: false,
			addresseeName: "Renn the Roadwarden",
		},
	],
	actions: [
		{
			id: "h:talk",
			label: "Speak To — Aldwin, keeper of the hearth-ledger",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: true,
		},
		{
			id: "h:talk-caddoc",
			label: "Speak To — Brother Caddoc",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Brother Caddoc",
			targetRef: "entity:9",
			acceptsUtterance: true,
		},
		{
			id: "h:talk-mira",
			label: "Speak To — Mira",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Mira",
			targetRef: "entity:40",
			acceptsUtterance: true,
		},
	],
	actionCount: 3,
};

export const reactionView: PlayView = {
	...fightView,
	session: {
		...fightView.session,
		myTurn: false,
		currentActor: "123",
		currentActorName: "Cellar Rat 1",
	},
	reaction: {
		windowKind: "reaction",
		handle: "s:reaction:1",
		rev: "r1",
		originatingActionId: "srd/attack/melee",
		originatingActor: "123",
		originatingActorName: "Cellar Rat 1",
		remainingMs: 6000,
		faces: [],
	},
};

/**
 * Sessionless combat-group offers: the cellar rat is here and melee is
 * offered, but no turn-based session is open. Availability is not a fight
 * (sk-jay0.1.8.34.19) — Explore keeps every offered handle reachable with
 * its own target identity.
 */
export const brawlView: PlayView = {
	...fightView,
	// No session: only the live rat is here (fightView's second, already-dead
	// rat belongs to an in-progress fight's own snapshot).
	occupants: fightView.occupants.filter((occupant) => occupant.id === "123"),
	// fightView's Melee Attack (combat group) plus Unarmed strike and an
	// armed weapon row against that same target. All three stay in the
	// ordinary catalog; nothing is collapsed into a one-click fight frame.
	actions: [
		...fightView.actions,
		{
			id: "h:longsword-strike",
			label: "Longsword: damage — Cellar Rat 1",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Cellar Rat 1",
			targetRef: "entity:123",
			acceptsUtterance: false,
		},
	],
	actionCount: 4,
	session: {
		inSession: false,
		myTurn: false,
		lifecycle: null,
		currentActor: null,
		currentActorName: null,
		roster: [],
	},
	reaction: null,
};

/**
 * A three-rat fight: the same cellar as `fightView`, but with three live
 * targets and two attack verbs each, plus the hero's own untargeted Dodge —
 * `play-table.test.ts`'s S3 fixture (sk-jay0.1.8.39) for `targetsFromView`,
 * standing in for the "cross product of buttons" the flat action list would
 * otherwise show (three targets × two verbs = six buttons, collapsed to
 * three chips of two verbs each).
 */
export const threeRatsView: PlayView = {
	...fightView,
	occupants: [
		{
			id: "201",
			handle: "s:actor:201",
			rev: "c1",
			kind: "creature",
			sceneKind: "actor",
			name: "Cellar Rat 1",
			conditions: [],
			note: "Here with you",
		},
		{
			id: "202",
			handle: "s:actor:202",
			rev: "c2",
			kind: "creature",
			sceneKind: "actor",
			name: "Cellar Rat 2",
			conditions: [],
			note: "Here with you",
		},
		{
			id: "203",
			handle: "s:actor:203",
			rev: "c3",
			kind: "creature",
			sceneKind: "actor",
			name: "Cellar Rat 3",
			conditions: [],
			note: "Here with you",
		},
	],
	actions: [
		{
			id: "h:melee-201",
			label: "Melee Attack — Cellar Rat 1",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Cellar Rat 1",
			targetRef: "entity:201",
			acceptsUtterance: false,
			group: "combat",
		},
		{
			id: "h:unarmed-201",
			label: "Unarmed strike: damage — Cellar Rat 1",
			verb: "manipulate",
			descriptor: "srd/attack/unarmed-strike/damage",
			targetName: "Cellar Rat 1",
			targetRef: "entity:201",
			acceptsUtterance: false,
		},
		{
			id: "h:melee-202",
			label: "Melee Attack — Cellar Rat 2",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Cellar Rat 2",
			targetRef: "entity:202",
			acceptsUtterance: false,
			group: "combat",
		},
		{
			id: "h:unarmed-202",
			label: "Unarmed strike: damage — Cellar Rat 2",
			verb: "manipulate",
			descriptor: "srd/attack/unarmed-strike/damage",
			targetName: "Cellar Rat 2",
			targetRef: "entity:202",
			acceptsUtterance: false,
		},
		{
			id: "h:melee-203",
			label: "Melee Attack — Cellar Rat 3",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Cellar Rat 3",
			targetRef: "entity:203",
			acceptsUtterance: false,
			group: "combat",
		},
		{
			id: "h:unarmed-203",
			label: "Unarmed strike: damage — Cellar Rat 3",
			verb: "manipulate",
			descriptor: "srd/attack/unarmed-strike/damage",
			targetName: "Cellar Rat 3",
			targetRef: "entity:203",
			acceptsUtterance: false,
		},
		{
			id: "h:dodge",
			label: "Dodge",
			verb: "manipulate",
			descriptor: "srd/action/dodge",
			targetName: "",
			targetRef: "entity:7",
			acceptsUtterance: false,
		},
	],
	actionCount: 7,
	session: {
		inSession: true,
		myTurn: true,
		lifecycle: "open",
		currentActor: "7",
		currentActorName: "Renn the Roadwarden",
		roster: [
			{ actorId: "7", name: "Renn the Roadwarden", ordinal: 0, isMe: true, isCurrent: true },
			{ actorId: "201", name: "Cellar Rat 1", ordinal: 1, isMe: false, isCurrent: false },
			{ actorId: "202", name: "Cellar Rat 2", ordinal: 2, isMe: false, isCurrent: false },
			{ actorId: "203", name: "Cellar Rat 3", ordinal: 3, isMe: false, isCurrent: false },
		],
	},
};

export function fakeHandle(overrides: Partial<PlaySessionHandle> = {}): PlaySessionHandle {
	return {
		roleTools: { authorizedRoles: [], tools: [], byName: new Map() },
		move: async (exit) => `You arrive at ${exit.toName}.`,
		act: async (action) => `You ${action.label.toLowerCase()}.`,
		endTurn: async () => "Your turn is over.",
		react: async () => "You react.",
		selectItem: async () => {},
		selectOccupant: async () => {},
		refresh: async () => {},
		disconnect() {},
		...overrides,
	};
}

/** Structured presentation fixture for the Place list/detail and composer seam. */
export const placeDetailView: PlayView = {
	...sampleView,
	interactionOrigin: undefined,
	actions: [
		{
			id: "fixture:inspect:4",
			actionId: "fixture/inspect",
			label: "Inspect",
			verb: "manipulate",
			descriptor: "fixture/inspect",
			targetRef: "entity:4",
			targetName: sampleView.occupants[0]!.name,
			acceptsUtterance: false,
		},
	],
	manipulationContext: {
		status: "ready",
		schemaVersion: 1,
		revision: 1,
		actions: [
			{
				actionId: "fixture/inspect",
				displayName: "Inspect",
				tags: [],
				selfOnly: false,
				selfEligible: false,
			},
		],
		targets: sampleView.occupants.map((occupant) => ({
			targetFactId: occupant.id,
			targetRef: `entity:${occupant.id}`,
			targetName: occupant.name,
			tags: [],
		})),
		participants: [],
	},
	occupantDetail: {
		id: "4",
		handle: "s:actor:4",
		rev: "a4",
		description: "A supplied description of the visitor.",
		facts: [],
		verbs: [
			{
				id: "fixture:inspect:4",
				actionId: "fixture/inspect",
				label: "Inspect",
				verb: "manipulate",
				descriptor: "fixture/inspect",
				targetRef: "entity:4",
				targetName: sampleView.occupants[0]!.name,
				acceptsUtterance: false,
			},
		],
	},
	hero: {
		...sampleView.hero,
		conditions: ["fixture/drafting"],
		conditionDetails: [
			{ id: "fixture/drafting", label: "Drafting", description: "A supplied condition label." },
		],
	},
};

/** Consecutive identities and intervening entries prove stream grouping without label matching. */
export const streamDetailView: PlayView = {
	...placeDetailView,
	speech: [
		{
			id: "stream:first",
			tick: 20,
			speakerId: "4",
			speaker: "Visitor",
			mine: false,
			text: "First short line.",
		},
		{
			id: "stream:second",
			tick: 21,
			speakerId: "4",
			speaker: "Changed display name",
			mine: false,
			text: "Same speaker continues.",
		},
		{
			id: "stream:twin",
			tick: 22,
			speakerId: "9",
			speaker: "Visitor",
			mine: false,
			text: "Same name, different person.",
		},
		{
			id: "stream:own",
			tick: 23,
			speakerId: "7",
			speaker: "Renn",
			mine: true,
			text: "A short answer.",
		},
		{
			id: "stream:third",
			tick: 24,
			speakerId: "9",
			speaker: "Visitor",
			mine: false,
			text: "Before another event.",
		},
		{
			id: "stream:fourth",
			tick: 26,
			speakerId: "9",
			speaker: "Visitor",
			mine: false,
			text: "After another event.",
		},
		...Array.from({ length: 18 }, (_, i) => ({
			id: `stream:long:${i}`,
			tick: 27 + i,
			speakerId: i % 2 ? "4" : "9",
			speaker: i % 2 ? "Visitor" : "Companion",
			mine: false,
			text: `A longer line ${i}. ` + "The supplied words wrap within a readable column. ".repeat(3),
		})),
	],
	events: [
		{ id: "stream:event", tick: 25, kind: "fixture", summary: "An intervening world event." },
	],
};

/**
 * A downed hero (sk-jay0.1.8.101): knocked to 0 HP by a rat in the cellar
 * fight. Exercises three things together —
 *
 * - `hero.conditions` carries Unconscious WITH its implied rows, the full
 *   list a live read now gets from the condition detail page when the
 *   summary's own page is only a bounded sample;
 * - the DM's workflow conditions are absent (`isDmInternalCondition`);
 * - `events` are in the ingested shape: structured `fields` with the
 *   attacker's name resolved at ingest, and a `summary` free of entity and
 *   template ids (sk-jay0.1.8.96).
 */
export const downedHeroView: PlayView = {
	...fightView,
	hero: {
		...fightView.hero,
		hp: 0,
		vitals: fightView.hero.vitals.map((vital) =>
			vital.id === "srd/hp" ? { ...vital, value: "0" } : vital,
		),
		conditions: [
			"srd/condition/incapacitated",
			"srd/condition/no-action",
			"srd/condition/no-bonus-action",
			"srd/condition/no-reaction",
			"srd/condition/unconscious",
		],
		conditionDetails: [
			{ id: "srd/condition/incapacitated", label: "Incapacitated" },
			{ id: "srd/condition/no-action", label: "No Action" },
			{ id: "srd/condition/no-bonus-action", label: "No Bonus Action" },
			{ id: "srd/condition/no-reaction", label: "No Reaction" },
			{
				id: "srd/condition/unconscious",
				label: "Unconscious",
				description: "A synthetic presentation example: you are out cold and cannot act.",
			},
		],
	},
	events: [
		{
			id: "session_lifecycle:58:0",
			tick: 58,
			kind: "session_lifecycle",
			summary: "A session opens (2 participants).",
			fields: {
				sessionId: "58",
				phase: "opened",
				participants: ["7", "123"],
				openedBy: "123",
			},
		},
		{
			id: "turn_transition:58:1",
			tick: 58,
			kind: "turn_transition",
			summary: "The turn opens with Cellar Rat 1.",
			fields: {
				sessionId: "58",
				fromActor: null,
				toActor: { id: "123", name: "Cellar Rat 1" },
			},
		},
		{
			id: "self_hit:59:2",
			tick: 59,
			kind: "self_hit",
			summary: "You take 11 damage from Cellar Rat 1 — 0 HP left.",
			fields: {
				resourceId: "srd/hp",
				amount: 11,
				newValue: 0,
				attackKind: "srd/attack/melee/success",
				attacker: { id: "123", name: "Cellar Rat 1" },
			},
		},
		{
			id: "self_condition_changed:59:3",
			tick: 59,
			kind: "self_condition_changed",
			summary: "You fall unconscious.",
			// One drain applied Unconscious and its implied rows: folded into one
			// entry at ingest (sk-jay0.1.8.96 s7). The group holds the world's
			// unconscious condition id, so it reads as one plain sentence
			// (sk-jay0.1.8.102).
			fields: {
				conditionId: "srd/condition/unconscious",
				conditionIds: [
					"srd/condition/unconscious",
					"srd/condition/incapacitated",
					"srd/condition/no-action",
					"srd/condition/no-bonus-action",
					"srd/condition/no-reaction",
				],
				applied: true,
				sourceEntityId: "123",
			},
		},
		{
			id: "turn_transition:60:4",
			tick: 60,
			kind: "turn_transition",
			summary: "The turn passes from Cellar Rat 1 to you.",
			fields: {
				sessionId: "58",
				fromActor: { id: "123", name: "Cellar Rat 1" },
				toActor: { id: "7", self: true },
			},
		},
	],
};
