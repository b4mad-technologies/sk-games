import { describe, expect, it } from "vitest";
import type { PlayView } from "../../../../play/src/lib/play-view";
import type { Stage } from "../model";
import { emptyAtlas } from "./atlas";
import recorded from "./fixtures/common-room.view.json";
import recordedFight from "./fixtures/fight-my-turn.view.json";
import {
	attemptFor,
	chosenMasteries,
	conditionSentence,
	conditionsOf,
	DOWN,
	distanceNote,
	emptyStage,
	GIVE_UP,
	GO,
	HERE,
	type LiveMemory,
	OUT,
	OWN,
	REST,
	resourceLabel,
	SPELLS_HERE,
	stacked,
	stageFromView,
	wantedArt,
	YOURS,
} from "./stage-from-view";
import { TALK } from "./talk-from-view";

// Recorded from a local world on 2026-11-15 (`just play-host`, a fresh
// fighter in the inn's common room): two persons, one thing, four ways out
// and one open question. The actions paired with carried items are left out;
// the world pairs every action with every item, which is 900 rows of the same.
const view = recorded as unknown as PlayView;
const HERO = view.hero.actorId;

function memory(overrides: Partial<LiveMemory> = {}): LiveMemory {
	const ids = new Map<string, number>();
	return {
		refusals: {},
		results: [],
		art: () => undefined,
		lineId: (key) => {
			if (!ids.has(key)) ids.set(key, ids.size + 1);
			return ids.get(key) as number;
		},
		busy: null,
		stepCostMs: null,
		hpSeen: 0,
		atlas: emptyAtlas(),
		ground: null,
		flashes: [],
		partnerId: null,
		guide: undefined,
		waiting: false,
		href: () => undefined,
		about: () => undefined,
		...overrides,
	};
}

const stage = stageFromView(view, memory());
const named = (name: string) => {
	const thing = stage.things.find((entry) => entry.name.startsWith(name));
	if (!thing) throw new Error(`no ${name} on the stage`);
	return thing;
};

describe("stageFromView", () => {
	it("names the place as the world describes it", () => {
		expect(stage.place).toMatchObject({ id: view.place?.id, name: "Common Room" });
		expect(stage.place.description).toBe(view.place?.description);
		expect(stage.place.art).toBeUndefined();
	});

	it("puts the hero, every occupant and every way out on the stage", () => {
		expect(stage.things.map((thing) => [thing.kind, thing.name])).toEqual([
			["self", "Borin"],
			["person", "Brother Caddoc"],
			["person", "Aldwin, keeper of the hearth-ledger"],
			["thing", "Hearth"],
			["way", "Creation Limbo"],
			["way", "Foyer"],
			["way", "Bar"],
			["way", "Stairs"],
		]);
	});

	it("gives every thing its own spot inside the stage", () => {
		const spots = stage.things.map((thing) => `${thing.x}:${thing.y}`);
		expect(new Set(spots).size).toBe(spots.length);
		for (const thing of stage.things) {
			expect(thing.x).toBeGreaterThan(0);
			expect(thing.x).toBeLessThan(480);
			expect(thing.y).toBeGreaterThan(0);
			expect(thing.y).toBeLessThanOrEqual(270);
		}
	});

	it("offers one click on a way out, and names what stands on it", () => {
		const limbo = named("Creation Limbo");
		expect(limbo.offers).toEqual([
			{ id: GO, label: "Go", sentence: "Go southwest to Creation Limbo", lead: true },
		]);
		expect(limbo.way).toEqual({
			direction: "southwest",
			toName: "Creation Limbo",
			gate: "dm threshold",
		});
		expect(named("Bar").way?.gate).toBeUndefined();
	});

	it("leads with the few offers that are about this person and folds the rest", () => {
		const aldwin = named("Aldwin");
		expect(aldwin.offers.filter((offer) => offer.lead).map((offer) => offer.label)).toEqual([
			"Answer",
			"Ask Aldwin About Advancement",
			"Level Up",
		]);
		const folded = aldwin.offers.filter((offer) => !offer.lead);
		// What belongs to a fight folds away with the attacks while there is none.
		expect(folded.find((offer) => offer.label === "Claim Victory")?.group).toBe("Attack");
		expect(folded.length).toBeGreaterThan(20);
		expect(folded.some((offer) => offer.label.startsWith("Melee Attack"))).toBe(true);
		// Every folded offer says which fold it belongs to; the tags group by it.
		expect(folded.every((offer) => offer.group)).toBe(true);
		expect(folded.find((offer) => offer.label.startsWith("Melee Attack"))?.group).toBe("Attack");
		expect(new Set(folded.map((offer) => offer.group)).has("Checks")).toBe(true);
	});

	it("names the offer that takes up the question of somebody who asks", () => {
		const aldwin = named("Aldwin");
		expect(aldwin.asks).toBe(true);
		expect(aldwin.offers.find((offer) => offer.id === aldwin.answerWith)?.label).toBe("Answer");
		// Nobody else is answered by a click.
		const others = stage.things.filter((thing) => thing !== aldwin);
		expect(others.every((thing) => thing.answerWith === undefined)).toBe(true);
	});

	it("keeps free speech and numbered answers out of the tags", () => {
		for (const thing of stage.things) {
			for (const offer of thing.offers) {
				expect(offer.id).not.toMatch(/srd\/speak-(to|aloud|to-room)[:/]/);
				expect(offer.id).not.toContain("dm/dialog/choice/");
			}
		}
	});

	it("marks who asks the hero something, and offers to turn to whoever can be spoken to", () => {
		expect(named("Aldwin").asks).toBe(true);
		expect(named("Brother Caddoc").asks).toBeUndefined();
		expect(named("Aldwin").offers[0]).toMatchObject({ id: TALK, label: "Answer", lead: true });
		expect(named("Brother Caddoc").offers[0]).toMatchObject({ id: TALK, label: "Talk" });
		expect(named("Hearth").offers.some((offer) => offer.id === TALK)).toBe(false);
		expect(stage.talk).toBeNull();
	});

	it("folds what the hero can do anywhere behind the shell's own offers", () => {
		const hero = named("Borin");
		expect(hero.kind).toBe("self");
		expect(hero.offers.length).toBeGreaterThan(0);
		expect(hero.offers.every((offer) => !offer.lead)).toBe(true);
		expect(hero.hp).toEqual({ now: 11, max: 11 });
	});

	it("puts equal things of the pack on one row and keeps how deep they lie", () => {
		const row = (name: string, depth: number, equipped?: string) => ({
			id: `i:${name}:${depth}:${Math.random()}`,
			name,
			detail: "",
			quantity: 1,
			depth,
			handle: "h",
			rev: "r",
			...(equipped ? { equipped } : {}),
		});
		const pack = [
			row("Mace", 0, "Main Hand"),
			row("Backpack", 1),
			row("Rations", 1),
			row("Rations", 1),
			row("Rations", 1),
			row("Robe", 1),
			row("Rations", 0),
		];
		const rows = stacked(pack as PlayView["pack"]);
		expect(rows.map((item) => [item.name, item.quantity, item.depth])).toEqual([
			["Mace", 1, 0],
			["Backpack", 1, 1],
			["Rations", 3, 1],
			["Robe", 1, 1],
			["Rations", 1, 0],
		]);
		// The stack is looked at through its first thing.
		expect(rows[2]?.id).toBe(pack[2]?.id);
		const shown = stageFromView({ ...view, pack: pack as PlayView["pack"] }, memory()).pack;
		expect(shown.map((item) => [item.name, item.quantity, item.depth, item.worn])).toEqual([
			["Mace", 1, undefined, "Main Hand"],
			["Backpack", 1, 1, undefined],
			["Rations", 3, 1, undefined],
			["Robe", 1, 1, undefined],
			["Rations", 1, undefined, undefined],
		]);
	});

	it("puts the world's filler note on nobody's tags", () => {
		// Seen live 2026-11-16: "Here with you" under a name whose one condition
		// is one the stage leaves out.
		const quiet = {
			...view,
			occupants: view.occupants.map((occupant) => ({
				...occupant,
				note: "Here with you",
				conditions: [],
			})),
		};
		for (const thing of stageFromView(quiet, memory()).things) expect(thing.note).toBeUndefined();
	});

	it("names a condition once, by the whole, not by its parts", () => {
		expect(
			conditionsOf([
				"srd/condition/dead",
				"srd/condition/incapacitated",
				"srd/condition/incapacitated/no-action",
				"srd/condition/incapacitated/no-reaction",
			]),
		).toEqual(["dead", "incapacitated"]);
	});

	it("tells a change of the hero's conditions by the whole, not by its parts", () => {
		const fields = {
			conditionId: "srd/condition/incapacitated",
			conditionIds: [
				"srd/condition/incapacitated",
				"srd/condition/incapacitated/no-action",
				"srd/condition/incapacitated/no-reaction",
				"srd/condition/unconscious",
				"srd/condition/stable",
			],
		};
		const changed = (applied: boolean) =>
			conditionSentence({ kind: "self_condition_changed", fields: { ...fields, applied } });
		expect(changed(false)).toBe("You are no longer incapacitated, unconscious and stable.");
		expect(changed(true)).toBe("You are now incapacitated, unconscious and stable.");
		// Without ids, and for any other event, the world's own words stay.
		expect(conditionSentence({ kind: "self_condition_changed", fields: {} })).toBeUndefined();
		expect(conditionSentence({ kind: "damage_taken", fields })).toBeUndefined();
	});

	it("says in the sentence line whom an offer is about, by name", () => {
		const aldwin = named("Aldwin");
		const level = aldwin.offers.find((offer) => offer.label === "Level Up");
		expect(level?.sentence).toBe(`Level Up: ${aldwin.name}`);
		// What the hero does anywhere is about nobody else, and folds as "Actions".
		const hero = stage.things.find((thing) => thing.kind === "self");
		expect(hero?.offers.every((offer) => offer.group)).toBe(true);
		expect(hero?.offers.some((offer) => offer.group === "Actions")).toBe(true);
		expect(hero?.offers.every((offer) => !offer.sentence.includes("here"))).toBe(true);
	});

	it("lays a hero down who is unconscious, and keeps them clickable", () => {
		const self = (of: Stage) => of.things.find((thing) => thing.kind === "self");
		expect(self(stage)?.down).toBeUndefined();
		const fallen = stageFromView(
			{
				...view,
				hero: {
					...view.hero,
					hp: 0,
					conditions: ["srd/condition/incapacitated", "srd/condition/unconscious"],
				},
			},
			memory(),
		);
		expect(self(fallen)).toMatchObject({
			down: true,
			conditions: ["incapacitated", "unconscious"],
		});
		expect(self(fallen)?.offers.length).toBeGreaterThan(0);
	});

	it("reads the hero from the world", () => {
		expect(stage.hero).toMatchObject({
			name: "Borin",
			calling: "Dwarf Fighter, Soldier",
			hp: 11,
			hpMax: 11,
			ac: 12,
			level: 1,
			drafting: false,
		});
		expect(stage.hero.abilities).toHaveLength(6);
		// The SRD table: level 2 asks for 300 experience.
		expect(stage.hero.xpNext).toBe(300);
	});

	it("shows a remembered refusal on the offer it was about", () => {
		const aldwin = named("Aldwin");
		const offer = aldwin.offers[1];
		const way = named("Bar");
		const again = stageFromView(
			view,
			memory({
				refusals: {
					[`${aldwin.id}:${offer?.id}`]: "Not now.",
					[`${way.id}:${GO}`]: "The door is barred.",
				},
			}),
		);
		expect(again.things.find((thing) => thing.id === aldwin.id)?.offers[1]?.refused).toBe(
			"Not now.",
		);
		expect(again.things.find((thing) => thing.id === way.id)?.offers[0]?.refused).toBe(
			"The door is barred.",
		);
		expect(
			again.things.find((thing) => thing.id === aldwin.id)?.offers[2]?.refused,
		).toBeUndefined();
	});

	it("tells the story in world order, with a click's result after the line it followed", () => {
		const spoken = stage.lines.at(-1);
		expect(spoken).toMatchObject({ kind: "speech", thingId: named("Aldwin").id });
		expect(spoken?.who).toContain("Aldwin");

		const told = stageFromView(
			view,
			memory({
				results: [
					{ id: 1, after: null, text: "You arrive.", refused: false },
					{
						id: 2,
						after: view.speech.at(-1)?.id ?? null,
						text: "No.",
						refused: true,
						thingId: "6",
					},
				],
			}),
		);
		expect(told.lines.map((line) => line.kind)).toEqual(["result", "speech", "refusal"]);
		expect(told.lines.at(-1)).toMatchObject({ text: "No.", thingId: "6" });
		expect(new Set(told.lines.map((line) => line.id)).size).toBe(3);
	});

	it("uses a loaded picture: the world's own before the SRD sprite", () => {
		const wanted = wantedArt(view);
		expect(wanted.srd).toContain("srd/class/fighter");
		expect(wanted.srd).toContain("srd/creature/commoner");
		expect(wanted.world).toHaveLength(2);

		const caddoc = view.occupants.find((occupant) => occupant.name === "Brother Caddoc");
		const pictured = stageFromView(
			view,
			memory({
				art: (key) =>
					key === caddoc?.art?.hash
						? "blob:own"
						: key.startsWith("srd/")
							? `sprite:${key}`
							: undefined,
			}),
		);
		const art = (name: string) => pictured.things.find((thing) => thing.name.startsWith(name))?.art;
		expect(art("Brother Caddoc")).toEqual({ url: "blob:own", pixel: false });
		expect(art("Aldwin")).toEqual({ url: "sprite:srd/creature/commoner", pixel: true });
		expect(art("Hearth")).toBeUndefined();
		expect(pictured.hero.art).toEqual({ url: "sprite:srd/class/fighter", pixel: true });
	});

	it("passes the busy hint through and names what is not wired yet", () => {
		const busy = { text: "On the way…", stoppable: false };
		expect(stageFromView(view, memory({ busy })).busy).toEqual(busy);
		expect(stage.fight).toBeNull();
		expect(stage.gaps.map((gap) => gap.bead)).toContain("sk-jay0.1.76.19.12");
	});
});

describe("what the world says about an action", () => {
	const hero = stage.things.find((thing) => thing.kind === "self");
	const own = hero?.offers.filter((offer) => offer.group === OWN) ?? [];
	const idOf = (offerId: string) => view.actions.find((action) => action.id === offerId)?.actionId;
	const kept = own[0];
	const context = view.manipulationContext;
	if (context.status !== "ready" || !kept) throw new Error("the recording has no context");
	// The same view, with a description per action and one action the hero
	// can be the target of.
	const told: PlayView = {
		...view,
		manipulationContext: {
			...context,
			actions: context.actions.map((action) => ({
				...action,
				description: `About ${action.actionId}.`,
				selfEligible: action.actionId === idOf(kept.id),
			})),
		},
	};
	const toldStage = stageFromView(told, memory());
	const self = toldStage.things.find((thing) => thing.kind === "self");

	it("carries the world's description on every offer", () => {
		expect(self?.offers.find((offer) => offer.id === kept.id)?.about).toBe(
			`About ${idOf(kept.id)}.`,
		);
		const aldwin = toldStage.things.find((thing) => thing.name.startsWith("Aldwin"));
		const worlds = aldwin?.offers.filter((offer) => offer.id !== TALK) ?? [];
		expect(worlds.length).toBeGreaterThan(0);
		expect(worlds.every((offer) => offer.about)).toBe(true);
	});

	it("keeps under the hero's own actions only what the hero can be the target of", () => {
		const known = new Set(context.actions.map((action) => action.actionId));
		const kinds = (group: string) =>
			(self?.offers ?? []).filter((offer) => offer.group === group).map((offer) => idOf(offer.id));
		// An action the world says nothing about stays with the hero.
		expect(kinds(OWN).filter((id) => id && known.has(id))).toEqual([idOf(kept.id)]);
		// What the world pairs with the floor instead stands apart.
		expect(kinds(HERE).length).toBeGreaterThan(0);
		expect(kinds(HERE)).not.toContain(idOf(kept.id));
	});

	it("opens the hero's own actions at once only when down or in a fight", () => {
		expect(self?.opens).toBeUndefined();
		const down = { ...view, hero: { ...view.hero, conditions: ["srd/condition/unconscious"] } };
		expect(stageFromView(down, memory()).things[0]?.opens).toBe(DOWN);
	});

	it("keeps the rests in a fold of their own", () => {
		const rests = (hero?.offers ?? []).filter((offer) => idOf(offer.id)?.startsWith("srd/rest/"));
		expect(rests.length).toBeGreaterThan(0);
		expect(rests.every((offer) => offer.group === REST && !offer.lead)).toBe(true);
	});

	it("leads a fallen hero with the death saving throw and the adventure's way out", () => {
		// Three of the ruleset's own, so that nothing else decides where they go.
		const [save, wake, other] = own.filter((offer) => idOf(offer.id)?.startsWith("srd/"));
		if (!save || !wake || !other) throw new Error("the recording has too few own actions");
		const renamed = (id: string) => ({ actionId: id, descriptor: id });
		const actions = view.actions.map((action) =>
			action.id === save.id
				? { ...action, ...renamed("srd/death_save/roll") }
				: action.id === wake.id
					? { ...action, ...renamed("some_adventure/respawn/wake") }
					: action,
		);
		const standing = stageFromView({ ...view, actions }, memory()).things[0];
		expect(standing?.offers.some((offer) => offer.group === DOWN)).toBe(false);
		const fallen = stageFromView(
			{ ...view, actions, hero: { ...view.hero, conditions: ["srd/condition/unconscious"] } },
			memory(),
		).things[0];
		const down = fallen?.offers.filter((offer) => offer.group === DOWN).map((offer) => offer.id);
		expect(down).toEqual(expect.arrayContaining([save.id, wake.id]));
		expect(down).not.toContain(other.id);
		// The fold of the fallen comes first; a dodge or a rest stays where it was.
		expect(fallen?.offers[0]?.group).toBe(DOWN);
		expect(fallen?.offers.find((offer) => offer.id === other.id)?.group).toBe(OWN);
	});

	it("lists the quests the world marks as such on the sheet", () => {
		expect(stage.hero.quests).toEqual([]);
		const quest = [
			{ id: "story/q2", label: "Road Watch", value: "1", description: "Bring Jory to the gate." },
			{ id: "story/q3", label: "The Basket", value: "0" },
		];
		const sheet = stageFromView({ ...view, hero: { ...view.hero, quest } }, memory()).hero;
		expect(sheet.quests).toEqual([
			{ label: "Road Watch", value: "1", about: "Bring Jory to the gate." },
			{ label: "The Basket", value: "0" },
		]);
	});

	it("puts the proficiency bonus and what the hero is on the sheet", () => {
		const sheet = stageFromView(
			{
				...view,
				hero: {
					...view.hero,
					proficiency: 2,
					identityDetails: [
						{ id: "srd.class.fighter", label: "Fighter", description: "A martial class." },
					],
				},
			},
			memory(),
		).hero;
		expect(sheet.proficiency).toBe(2);
		expect(sheet.identity).toEqual([{ label: "Fighter", about: "A martial class." }]);
	});
});

describe("attemptFor", () => {
	it("finds the exit behind a way", () => {
		const bar = named("Bar");
		const attempt = attemptFor(view, bar.id, GO);
		expect(attempt).toMatchObject({ kind: "move", sentence: "Go east to Bar" });
		expect(attempt?.kind === "move" && attempt.exit.toName).toBe("Bar");
	});

	it("finds the action behind every offer on the stage", () => {
		for (const thing of stage.things.filter((entry) => entry.kind !== "way")) {
			for (const offer of thing.offers) {
				// "Talk" is the shell's own: it turns the hero, it sends nothing.
				if (offer.id === TALK) continue;
				const attempt = attemptFor(view, thing.id, offer.id);
				expect(attempt?.kind, `${thing.name}: ${offer.label}`).toBe("act");
				if (attempt?.kind !== "act") continue;
				expect(attempt.action.id).toBe(offer.id);
				if (thing.id !== HERO) expect(attempt.action.targetRef).toBe(`entity:${thing.id}`);
			}
		}
	});

	it("is undefined for what the world no longer discloses", () => {
		expect(attemptFor(view, "way:gone", GO)).toBeUndefined();
		expect(attemptFor(view, "6", "factored:nothing")).toBeUndefined();
	});
});

describe("emptyStage", () => {
	it("is a bare stage that says where the connection stands", () => {
		const empty = emptyStage("Connecting…");
		expect(empty.place.name).toBe("Connecting…");
		expect(empty.things).toEqual([]);
		expect(empty.hero.drafting).toBe(true);
	});
});

describe("a caster's spells", () => {
	const context = view.manipulationContext;
	if (context.status !== "ready") throw new Error("the recording has no context");
	const foe = view.occupants.find((occupant) => occupant.kind !== "thing");
	const paired = view.actions.find((action) => action.targetRef === `entity:${foe?.id}`);
	const onSelf = view.actions.find((action) => action.targetRef === `entity:${HERO}`);
	if (!foe || !paired || !onSelf) throw new Error("the recording pairs nothing");
	// The recorded fighter knows no spell. Three are added the way the world
	// lists them: two on somebody else, one the hero can be the target of.
	const spell = (base: typeof paired, name: string) => ({
		...base,
		id: `factored:srd/spell/${name}/cast:${base.targetRef}`,
		actionId: `srd/spell/${name}/cast`,
		descriptor: `srd/spell/${name}/cast`,
		name: `Cast ${name}`,
		label: `Cast ${name}`,
		group: undefined,
		groups: [],
		slot: undefined,
	});
	const known = (name: string, selfEligible: boolean) => ({
		...(context.actions[0] as (typeof context.actions)[number]),
		actionId: `srd/spell/${name}/cast`,
		displayName: `Cast ${name}`,
		nicheRequirements: [],
		selfOnly: false,
		selfEligible,
	});
	const caster: PlayView = {
		...view,
		actions: [
			...view.actions,
			spell(paired, "fire-bolt"),
			spell(paired, "bless"),
			spell(onSelf, "fire-bolt"),
			spell(onSelf, "false-life"),
		],
		manipulationContext: {
			...context,
			actions: [
				...context.actions,
				known("fire-bolt", false),
				known("bless", false),
				known("false-life", true),
			],
		},
	};
	const picks = ["srd/class/wizard", "srd/spell/fire-bolt", "srd/spell/false-life"];
	const on = (stage: Stage, id: string) =>
		stage.things.find((thing) => thing.id === id)?.offers ?? [];
	const groupOf = (offers: Stage["things"][number]["offers"], label: string) =>
		offers.find((offer) => offer.label === label)?.group;

	it("folds the spells the hero picked before the rest of the ruleset's", () => {
		const offers = on(stageFromView(caster, memory({ picks })), foe.id);
		expect(groupOf(offers, "Cast fire-bolt")).toBe(YOURS);
		expect(groupOf(offers, "Cast bless")).toBe("Spells");
		const folds = [...new Set(offers.flatMap((offer) => (offer.group ? [offer.group] : [])))];
		expect(folds.indexOf(YOURS)).toBeLessThan(folds.indexOf("Spells"));
		// Without a memory of the picks every spell is one of many.
		expect(groupOf(on(stageFromView(caster, memory()), foe.id), "Cast fire-bolt")).toBe("Spells");
	});

	it("leads with the picked spells in a fight, like a bound weapon", () => {
		const other = { actorId: foe.id, name: foe.name, ordinal: 1, isMe: false, isCurrent: false };
		const fighting = {
			...caster,
			session: { ...caster.session, inSession: true, roster: [...caster.session.roster, other] },
		} as PlayView;
		const offers = on(stageFromView(fighting, memory({ picks })), foe.id);
		expect(offers.find((offer) => offer.label === "Cast fire-bolt")).toMatchObject({ lead: true });
		expect(offers.find((offer) => offer.label === "Cast bless")).toMatchObject({ lead: false });
		// On the hero, the picked spell the hero can be the target of leads too,
		// before every fold; one cast on somebody else stays where it was.
		const own = on(stageFromView(fighting, memory({ picks })), HERO);
		expect(own[0]).toMatchObject({ label: "Cast false-life", lead: true });
		expect(own[0]?.group).toBeUndefined();
		expect(groupOf(own, "Cast fire-bolt")).toBe(SPELLS_HERE);
	});

	it("keeps on the hero only the spells the hero can be the target of", () => {
		const offers = on(stageFromView(caster, memory({ picks })), HERO);
		expect(groupOf(offers, "Cast false-life")).toBe(YOURS);
		expect(groupOf(offers, "Cast fire-bolt")).toBe(SPELLS_HERE);
	});

	it("shows what a spend event last left, by a name for the resource", () => {
		expect(resourceLabel("srd/spell_slot_1")).toBe("Level 1 spell slots");
		expect(resourceLabel("srd/fighter/second_wind_uses")).toBe("Second wind uses");
		const hero = stageFromView(view, memory({ left: { "srd/spell_slot_1": 1 } })).hero;
		expect(hero.left).toEqual([{ label: "Level 1 spell slots", left: 1 }]);
		// The count of death saving throws is no resource a player has left.
		const fallen = {
			"srd/death_save_successes": 0,
			"srd/death_save_last_roll": 0,
			"dm/level-up/pending-hp-choice": 0,
		};
		expect(stageFromView(view, memory({ left: fallen })).hero.left).toEqual([]);
	});
});

// Recorded on 2026-11-15: a fighter with a greatsword in hand, on their turn,
// against a giant rat and a swarm.
describe("a fighter's turn in a fight", () => {
	const fight = recordedFight as unknown as PlayView;
	const picks = [
		"srd/class/fighter",
		"srd/advancement-choice-option/fighter/1/weapon/greatsword",
		"srd/advancement-choice-option/fighter/1/weapon/handaxe",
	];
	const rat = (stage: Stage) => {
		const thing = stage.things.find((entry) => entry.name === "Cellar Rat 1");
		if (!thing) throw new Error("no rat on the stage");
		return thing;
	};

	it("reads the chosen weapon masteries from the creation picks", () => {
		expect(chosenMasteries(picks)).toEqual(["greatsword", "handaxe"]);
		expect(chosenMasteries(undefined)).toEqual([]);
	});

	it("leads on a foe with the mastery of the weapon in hand", () => {
		const leading = rat(stageFromView(fight, memory({ picks })))
			.offers.filter((offer) => offer.lead)
			.map((offer) => offer.label);
		expect(leading.slice(0, 2)).toEqual(["Melee Attack (Graze)", "Melee Attack"]);
		// Help is for an ally.
		expect(leading).not.toContain("Help");
	});

	it("folds the masteries together when the picks are not known in this browser", () => {
		const offers = rat(stageFromView(fight, memory())).offers;
		expect(offers.find((offer) => offer.lead)?.label).toBe("Melee Attack");
		expect(
			offers.filter((offer) => offer.group === "Weapon masteries").map((offer) => offer.label),
		).toContain("Melee Attack (Graze)");
	});

	it("leads on the hero with what the class gives, and folds giving up away", () => {
		const hero = stageFromView(fight, memory()).things.find((thing) => thing.kind === "self");
		const leading = hero?.offers.filter((offer) => offer.lead).map((offer) => offer.label);
		expect(leading).toEqual(["Use Second Wind"]);
		const own = hero?.offers.filter((offer) => offer.group === OWN).map((offer) => offer.label);
		expect(own).toContain("Dodge");
		expect(own?.some((label) => label.startsWith("Give up"))).toBe(false);
		expect(hero?.offers.filter((offer) => offer.group === GIVE_UP)).toHaveLength(3);
		expect(hero?.offers.at(-1)?.group).toBe(GIVE_UP);
	});

	it("says on a foe's tags how far it stands", () => {
		// The swarm two columns and one row off: two steps, one of them diagonal.
		const apart: PlayView = {
			...fight,
			sessionTokens: (fight.sessionTokens ?? []).map((token) =>
				token.name === "Cellar Rat Swarm"
					? { ...token, nodeId: token.nodeId.replace(/c_\d+_\d+$/, "c_2_1") }
					: token,
			),
		};
		const stage = stageFromView(apart, memory());
		expect(rat(stage).note).toBe("Next to you.");
		expect(stage.things.find((entry) => entry.name === "Cellar Rat Swarm")?.note).toBe(
			"2 steps away.",
		);
		expect(distanceNote(0)).toBe("Next to you.");
	});

	it("says under a fighter's name that the turn order passes them over", () => {
		const hero = fight.hero.actorId;
		const turn = (to: string, index: number) => ({
			id: `turn:${index}`,
			tick: 300 + index,
			kind: "turn_transition",
			summary: "The turn passes.",
			fields: { sessionId: fight.session.id, fromActor: { id: "x" }, toActor: { id: to } },
		});
		// The swarm (139) keeps its turns; the rat (137) has none any more.
		const later = {
			...fight,
			events: [hero, "137", "139", hero, "139", hero].map(turn),
		} as unknown as PlayView;
		const thing = rat(stageFromView(later, memory()));
		expect(thing.out).toBe(true);
		expect(thing.conditions).toEqual([OUT]);
		expect(rat(stageFromView(fight, memory())).out).toBeUndefined();
	});

	it("names the foe in the sentence of an attempt", () => {
		const stage = stageFromView(fight, memory());
		const thing = rat(stage);
		const offer = thing.offers.find((entry) => entry.label === "Melee Attack");
		const attempt = attemptFor(fight, thing.id, offer?.id ?? "");
		expect(attempt?.sentence).toBe("Melee Attack: Cellar Rat 1");
	});
});
