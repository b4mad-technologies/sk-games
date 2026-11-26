// PlayView -> Stage: what the live world discloses, in the shape the shell draws.
//
// Pure mapping, no session and no clock. `LiveWorld` (world.svelte.ts) holds
// the session and the client-side memory (refusals, click results, loaded
// pictures) and hands both in here. The rules about which offers lead, in
// which order lines stand and what a gate is called live in `src/lib`; this
// module only joins them.
//
// The directory is not called `live/`: the repository reserves that name for
// tests that need a running node (scripts/ci/nx-ci-dispatch-workflow.test.mjs).
//
// Wired so far: place, things, ways, offers, story (sk-jay0.1.76.19.1), talk
// and hero creation as rounds (19.2, `talk-from-view.ts`), the fight on the
// floor (19.3, `fight-from-view.ts`). Sheet, pack and map (19.4) are named
// in `LIVE_GAPS` until they land.

import {
	conditionLabel,
	isDmInternalCondition,
	type PlayAction,
	type PlayExit,
	type PlayOccupant,
	type PlayView,
} from "../../../../play/src/lib/play-view";
import { actionsOnFighter, fightTokens } from "../../lib/fight";
import {
	boundActions,
	classFeature,
	describedActions,
	inFight,
	masteredAttacks,
	menuFor,
	nicheFit,
	onePerAction,
	sameSide,
	selfEligible,
} from "../../lib/menu";
import { xpForLevel } from "../../lib/srd-advancement";
import { type ClickResult, inTickOrder, type StoryLine, withResults } from "../../lib/story";
import { canAddress, spokenLines, withoutFreeSpeech } from "../../lib/talk";
import { gateName } from "../../lib/travel";
import { floorSpots, HERO_SPOT, type Spot, wayPlaced, waySpot } from "../layout";
import type { Art, Gap, Hero, Line, Offer, PackItem, Stage, Thing } from "../model";
import type { Atlas } from "./atlas";
import {
	fighterSpots,
	fightFrom,
	fightSentence,
	gridWindow,
	passedOver,
	stepsAway,
} from "./fight-from-view";
import { areaMap } from "./map-from-view";
import { answerRefs, questionsOf, roundFrom, TALK, type TalkMemory } from "./talk-from-view";

/** What a click came to, kept by the client until the story window drops it. */
export type LiveResult = ClickResult & {
	refused: boolean;
	/** The thing the click was on, for a bubble there. */
	thingId?: string;
};

/** The client-side memory the mapping reads beside the view. */
export type LiveMemory = TalkMemory & {
	/** `thingId:offerId` -> the world's sentence from its last refusal. */
	refusals: Readonly<Record<string, string>>;
	results: readonly LiveResult[];
	// `art` (from `TalkMemory`): a loaded picture by key, a world-art content
	// hash or an SRD definition id.
	/** A stable number per story line key, rising in order of arrival. */
	lineId(key: string): number;
	busy: Stage["busy"];
	/** What a step on the fight grid was last seen to cost; null until measured. */
	stepCostMs: number | null;
	/** The most hit points the hero was seen with since the app opened. */
	hpSeen: number;
	/**
	 * Definition ids the hero answered with in the creation talk ("srd/spell/
	 * fire-bolt"), as this browser saw them. A ranking signal only.
	 */
	picks?: readonly string[];
	/** What a spend event last said is left, by resource id. */
	left?: Readonly<Record<string, number>>;
	/** The names of everybody the hero has stood beside, by entity id. */
	met?: Readonly<Record<string, string>>;
	/** What the hero answered when asked, and the reply; oldest first. */
	said?: readonly { who: string; said: string; reply?: string }[];
	/**
	 * What a thing of the pack is, by its name: the definition id its detail
	 * named when it was looked at. Keeps its picture in the list afterwards.
	 */
	kinds?: Readonly<Record<string, string>>;
	/** Every place the hero has seen, and the routes between them. */
	atlas: Atlas;
	/** Marks that float up from a thing for a moment: harm taken, health won back. */
	flashes: Stage["flashes"];
	/** The place the hero last stood in outside a session grid: where a fight is. */
	ground: { name: string; description: string } | null;
};

/** One attempt the port can send: a walk through an exit, or an action. */
export type Attempt =
	| { kind: "move"; exit: PlayExit; sentence: string }
	| { kind: "act"; action: PlayAction; sentence: string };

export const GO = "go";
const STORY_WINDOW = 60;

export const LIVE_GAPS: Gap[] = [
	{
		id: "words",
		where: "Not wired yet",
		text: "Typing stays for speech and the hero's name. Ability scores are set by clicks beside the DM's own offer. Appearance and backstory are forms the DM takes; they are not on the stage. An offer that needs words says so and sends nothing.",
	},
	{
		id: "reach",
		where: "Fight",
		text: "The world sends no reachable cells and no weapon reach. The app shades nothing; a click asks, the world answers. A fighter's tags say how many steps away they stand. A grid larger than the floor shows 9 x 4 cells around the hero.",
		bead: "sk-jay0.1.76.15.3",
	},
	{
		id: "fight",
		where: "Not wired yet",
		text: "In a fight: the hero's own harm floats up from the hero (the world sends those hit points); harm the hero deals floats from the figure of that name; the world does not say who is down or dead while the fight lasts, so a dead foe stands as before and the fight ends with End turn. The stage reads the turn order instead: whoever had no turn in the last full round is marked as out of the fight.",
		bead: "sk-jay0.1.76.19.12",
	},
	{
		id: "spells",
		where: "Spells",
		text: "The world lists every spell of the ruleset on a caster and says neither which ones the hero prepared nor how many slots are left. The stage remembers what the hero picked in the creation talk, in this browser, and puts those first; what is left of a slot or a feature is read from the last time it was spent, and forgotten after a rest.",
		bead: "sk-jay0.1.76.19.14",
	},
	{
		id: "quests",
		where: "Hero",
		text: "The hero sheet lists the quests the world marks as such. This adventure marks none. Below them the stage keeps its own notes of the talk, in this browser: what the hero answered when somebody asked, and what was said to that.",
		bead: "sk-jay0.1.76.19.16",
	},
	{
		id: "pack-art",
		where: "Pack",
		text: "The pack list carries names only. What a thing is, its picture and what it affords arrive when it is picked, one thing at a time.",
	},
	{
		id: "map",
		where: "Map",
		text: "The world draws one area at a time: the places the hero stood in, the place they stand in now and its neighbours, fitted anew each time. It sends no list of the places the hero knows. The panel keeps what every plate has shown in this browser, per world and hero; a place it has only heard of from a way out stands beside its neighbour.",
		bead: "sk-jay0.1.76.19.8",
	},
	{
		id: "picture",
		where: "Scene",
		text: "A place picture shows when the world sends one (place.art) and a gateway is set. No adventure sends one yet; the app draws the plain stage.",
		bead: "sk-jay0.1.76.14.8",
	},
	{
		id: "hp",
		where: "Hero",
		text: "The world sends the hero's hit points, not their maximum. The bar is measured against the most this browser has seen the hero with.",
		bead: "sk-jay0.1.76.19.6",
	},
	{
		id: "position",
		where: "Scene",
		text: "The world sends no position inside a place and no hotspot on a picture. The app puts ways out where their direction says and spreads everything else over the floor.",
	},
	{
		id: "journey",
		where: "Walking",
		text: "A walk to a neighbour place opens a journey of several ticks; the hero arrives a while after the click.",
		bead: "sk-jay0.1.76.14.9",
	},
];

export function wayId(exit: PlayExit): string {
	return `way:${exit.handle}`;
}

/**
 * The conditions worth a word. A condition the rules split into parts
 * (`.../incapacitated/no-action` beside `.../incapacitated`) is named once,
 * by the whole.
 */
export function conditionsOf(ids: readonly string[]): string[] {
	return ids
		.filter((id) => !isDmInternalCondition(id))
		.filter((id) => !ids.some((other) => other !== id && id.startsWith(`${other}/`)))
		.map((id) => conditionLabel(id).toLowerCase());
}

/**
 * The actions the client pairs with one occupant (ADR-0141: no eligibility
 * read). The world's disclosed facts are joined directly, as for a fighter
 * from the turn roster: the plain action list pairs a thing with little more
 * than the speech acts (seen live 2026-11-15, a chest).
 */
function actionsOn(view: PlayView, occupant: PlayOccupant): PlayAction[] {
	return actionsOnFighter(view, occupant.id);
}

/**
 * What the hero carries everywhere and what the place itself offers: every
 * action that is not about another entity or an item, one pairing each.
 */
function actionsHereAndMe(view: PlayView): PlayAction[] {
	const self = `entity:${view.hero.actorId}`;
	return onePerAction(
		withoutFreeSpeech(view.actions).filter(
			(action) => !/^(entity|item):/.test(action.targetRef) || action.targetRef === self,
		),
		nicheFit(view.manipulationContext),
	);
}

/**
 * The weapons whose mastery the hero chose in the creation talk: the picks
 * that end in "/weapon/<name>" ("srd/advancement-choice-option/fighter/1/
 * weapon/greatsword"). The world's own read of them comes empty
 * (sk-jay0.1.76.15.6).
 */
export function chosenMasteries(picks: readonly string[] | undefined): string[] {
	return (picks ?? []).flatMap((ref) => {
		const weapon = /\/weapon\/([^/]+)$/.exec(ref)?.[1];
		return weapon ? [weapon] : [];
	});
}

function sorted(view: PlayView, actions: readonly PlayAction[], picks?: readonly string[]) {
	return menuFor(withoutFreeSpeech(actions), {
		inFight: inFight(view.session),
		fits: nicheFit(view.manipulationContext),
		bound: boundActions(view.manipulationContext),
		mastered: masteredAttacks(
			view.manipulationContext,
			// A binding names the thing by its entity; the pack row is `i:<entity>`.
			(entityId) => view.pack.find((item) => item.id === `i:${entityId}`)?.name,
			chosenMasteries(picks),
		),
		ally: sameSide(view.manipulationContext, view.hero.actorId),
	});
}

function offersFrom(
	view: PlayView,
	thingId: string,
	actions: readonly PlayAction[],
	memory: Pick<LiveMemory, "refusals" | "picks">,
	lead = true,
	/** The thing's name, for the sentence line; the world's own label says "Someone here". */
	about = "",
): Offer[] {
	const menu = sorted(view, actions, memory.picks);
	const picked = pickedActions(memory.picks);
	const fighting = inFight(view.session);
	const described = describedActions(view.manipulationContext);
	const offer = (action: PlayAction, leads: boolean, group?: string): Offer => {
		const refused = memory.refusals[`${thingId}:${action.id}`];
		const text = described(action);
		return {
			id: action.id,
			label: action.name ?? action.label,
			sentence: action.name && about ? `${action.name}: ${about}` : (action.name ?? action.label),
			lead: leads,
			...(group ? { group } : {}),
			...(refused ? { refused } : {}),
			...(text ? { about: text } : {}),
		};
	};
	// The ruleset lists every spell on a caster (119 on a level-1 wizard).
	// The ones the hero picked come first: in a fight they lead like a bound
	// weapon, elsewhere they have a fold of their own before the rest.
	const mine = (group: { id: string }, action: PlayAction) =>
		group.id === "spells" && picked(action);
	return [
		...menu.primary.map((action) => offer(action, lead)),
		...menu.groups.flatMap((group) =>
			group.actions
				.filter((action) => mine(group, action))
				.map((action) => (fighting && lead ? offer(action, true) : offer(action, false, YOURS))),
		),
		...menu.groups.flatMap((group) =>
			group.actions
				.filter((action) => !mine(group, action))
				.map((action) => offer(action, false, group.label)),
		),
	];
}

/** The fold of the spells the hero picked. */
export const YOURS = "Your spells";
/** The fold, on the hero, of the spells the hero cannot be the target of. */
export const SPELLS_HERE = "Spells at this place";
const SPELLS = "Spells";

/**
 * Was this action picked in the creation talk? A pick is a definition id
 * ("srd/spell/fire-bolt"); the actions of that definition extend it
 * ("srd/spell/fire-bolt/cast").
 */
function pickedActions(picks: readonly string[] | undefined): (action: PlayAction) => boolean {
	const refs = (picks ?? []).map((ref) => `${ref}/`);
	return (action) => {
		const id = action.actionId ?? action.descriptor;
		return refs.some((ref) => id.startsWith(ref));
	};
}

/** `srd/spell_slot_1` -> "Level 1 spell slots"; anything else by its last word. */
export function resourceLabel(resourceId: string): string {
	const slot = /^srd\/spell_slot_(\d+)$/.exec(resourceId);
	if (slot) return `Level ${slot[1]} spell slots`;
	const words = (resourceId.split("/").pop() ?? resourceId).replaceAll(/[_-]+/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The fold of what the hero does to or with themselves. */
export const OWN = "Actions";
/** The fold of what the place they stand in offers. */
export const HERE = "Here";
/** The fold of the attacks by a weapon mastery (`menu.ts`). */
const MASTERIES = "Weapon masteries";
/** The fold of the SRD's rests: never the next thing to do in a fight. */
export const REST = "Rest";
/** The fold, while the hero is down, of what is meant for that hour. */
export const DOWN = "While you are down";
/** The fold, while the hero stands in a fight, of the ways to end it by losing. */
export const GIVE_UP = "Give up";

/**
 * Is this action meant for a hero who is down? The ruleset's own answer is
 * the death saving throw. Whatever else the hero carries that is not the
 * ruleset's (`srd/`, `core/`) was put there by the adventure: its way out of
 * a lost fight. A dodge, a dash or a rest is neither.
 */
function forTheFallen(action: PlayAction): boolean {
	const id = action.actionId ?? action.descriptor;
	// A sense ("look") carries no definition id; it is nobody's way out.
	return id.startsWith("srd/death_save/") || (id.includes("/") && !/^(srd|core)\//.test(id));
}

/**
 * The hero's own tags. What the hero carries everywhere folds behind "more"
 * (the shell leads with its own two, the sheet and the pack); they are a
 * dozen and more, so they get folds of their own. "Actions" holds what the
 * hero can be the target of (a second wind, a dodge, a rest). What the world
 * pairs with the floor instead stands apart: an attack on the hero's own
 * cell joins the other attacks, the rest is "Here".
 */
function heroOffers(view: PlayView, memory: Pick<LiveMemory, "refusals" | "picks">): Offer[] {
	const actions = actionsHereAndMe(view);
	const byId = new Map(actions.map((action) => [action.id, action]));
	const own = selfEligible(view.manipulationContext);
	const attacks = inFight(view.session) ? "More attacks" : "Attack";
	// The folds in the order a player reaches for them: what I do, my spells,
	// then the long lists.
	const order = [DOWN, OWN, YOURS, attacks, MASTERIES, SPELLS, SPELLS_HERE, HERE, REST];
	const rank = (offer: Offer) => {
		// Giving up is the last thing to reach for, after every other fold.
		if (offer.group === GIVE_UP) return order.length + 1;
		const at = order.indexOf(offer.group ?? "");
		return at < 0 ? order.length : at;
	};
	// Among what leads: a spell of the hero's own before a feature of the class.
	const featured = new Set<string>();
	const down = heroDown(view);
	const fighting = inFight(view.session);
	const feature = classFeature(view.manipulationContext);
	return regrouped(view, memory, actions, byId, own, attacks)
		.map((offer) => {
			const action = byId.get(offer.id);
			// Down, fifteen tags in a row hid the two that matter.
			if (down && offer.group === OWN && action && forTheFallen(action))
				return { ...offer, group: DOWN };
			// Standing in a fight, three ways to give up stood in the middle of
			// what to do now, between Dodge and Second Wind.
			if (fighting && !down && offer.group === OWN && action && forTheFallen(action))
				return { ...offer, group: GIVE_UP };
			// What the hero's class gives them (Second Wind) leads in a fight
			// like a caster's own spells: it was the last of twelve.
			if (fighting && !down && offer.group === OWN && action && feature(action)) {
				const { group: _, ...leading } = offer;
				featured.add(offer.id);
				return { ...leading, lead: true };
			}
			// The rests stood first in the list of what to do in a fight.
			if (offer.group === OWN && (action?.actionId ?? action?.descriptor)?.startsWith("srd/rest/"))
				return { ...offer, group: REST };
			// In a fight a caster's own spells on themselves (a healing word)
			// lead like a bound weapon on a foe; the open fold of thirteen
			// actions had pushed them below the edge of the stage.
			if (fighting && !down && offer.group === YOURS) {
				const { group: _, ...leading } = offer;
				return { ...leading, lead: true };
			}
			return offer;
		})
		.sort(
			(a, b) =>
				Number(b.lead) - Number(a.lead) ||
				Number(featured.has(a.id)) - Number(featured.has(b.id)) ||
				rank(a) - rank(b),
		);
}

function regrouped(
	view: PlayView,
	memory: Pick<LiveMemory, "refusals" | "picks">,
	actions: readonly PlayAction[],
	byId: ReadonlyMap<string, PlayAction>,
	own: (action: PlayAction) => boolean,
	attacks: string,
): Offer[] {
	return offersFrom(view, view.hero.actorId, actions, memory, false).map((offer) => {
		const action = byId.get(offer.id);
		// A spell the hero cannot be the target of is cast on somebody: it hangs
		// on them. Here it is paired with the place, and stands apart.
		if ((offer.group === SPELLS || offer.group === YOURS) && action && !own(action))
			return { ...offer, group: SPELLS_HERE };
		if (offer.group) return offer;
		if (!action || own(action)) return { ...offer, group: OWN };
		const combat = action.group === "combat" || action.groups?.includes("combat");
		return { ...offer, group: combat ? attacks : HERE };
	});
}

function goSentence(exit: PlayExit): string {
	return `Go ${exit.label} to ${exit.toName}`;
}

/** The SRD's word for a body that is down but alive. */
const UNCONSCIOUS = "srd/condition/unconscious";

/** Is the hero down: unconscious by the SRD's condition, not yet being made? */
export function heroDown(view: PlayView): boolean {
	return view.hero.drafting !== true && view.hero.conditions.includes(UNCONSCIOUS);
}

/** The world's picture of an occupant, else its SRD sprite, else none. */
function occupantArt(occupant: PlayOccupant, memory: Pick<LiveMemory, "art">): Art | undefined {
	const own = occupant.art ? memory.art(occupant.art.hash) : undefined;
	if (own) return { url: own, pixel: false };
	const sprite = occupant.defId ? memory.art(occupant.defId) : undefined;
	return sprite ? { url: sprite, pixel: true } : undefined;
}

/** `Fighter` -> `srd/class/fighter`: the hero's portrait is the SRD class sprite. */
export function heroArtKey(view: PlayView): string | undefined {
	const name = view.hero.className?.trim().toLowerCase().replaceAll(/\s+/g, "-");
	return name ? `srd/class/${name}` : undefined;
}

/** Every picture key the stage wants loaded for this view. */
export function wantedArt(view: PlayView): {
	world: { path: string; hash: string }[];
	srd: string[];
} {
	const occupants = [...view.occupants, ...fightTokens(view)];
	const world = [
		view.place?.art,
		...occupants.map((occupant) => occupant.art),
		view.itemDetail?.art,
	].filter((art) => art !== undefined);
	const srd = [
		heroArtKey(view),
		...occupants.map((occupant) => occupant.defId),
		view.itemDetail?.definitionRef,
		...answerRefs(view),
	].filter((id) => id !== undefined);
	return { world, srd };
}

/** "12" or "12/14" -> the number after the slash, when the vital carries one. */
function maxFromVital(value: string | undefined): number | undefined {
	const match = /\/\s*(\d+)/.exec(value ?? "");
	return match ? Number(match[1]) : undefined;
}

function heroFrom(
	view: PlayView,
	memory: Pick<LiveMemory, "art" | "hpSeen" | "left" | "said" | "picks">,
): Hero {
	const hero = view.hero;
	const hp = hero.hp ?? 0;
	const hpVital = hero.vitals.find((vital) => /(^|\/)hp$/.test(vital.id));
	// A hero still being made has no class in the world yet. The class they
	// answered with in the creation talk gives the figure its picture.
	const key =
		heroArtKey(view) ??
		(hero.drafting ? memory.picks?.find((ref) => ref.startsWith("srd/class/")) : undefined);
	const portrait = key ? memory.art(key) : undefined;
	const calling = [[hero.species, hero.className].filter(Boolean).join(" "), hero.background]
		.filter(Boolean)
		.join(", ");
	return {
		name: hero.name,
		calling,
		...(portrait ? { art: { url: portrait, pixel: true } } : {}),
		hp,
		// The world sends the hit points the hero has, not how many they can
		// have (sk-jay0.1.76.19.6). Until it does, the bar is measured against
		// the most the app has seen.
		hpMax: Math.max(maxFromVital(hpVital?.value) ?? hp, memory.hpSeen, hp, 1),
		ac: hero.ac ?? 0,
		xp: hero.xp ?? 0,
		...(xpForLevel((hero.level ?? 1) + 1) !== undefined
			? { xpNext: xpForLevel((hero.level ?? 1) + 1) }
			: {}),
		level: hero.level ?? 1,
		abilities: hero.abilities.map((ability) => ({
			id: ability.id,
			label: ability.label,
			score: ability.score,
			modifier: ability.modifier,
			...(ability.description ? { about: ability.description } : {}),
		})),
		skills: hero.skills.map((skill) => skill.label),
		...(hero.proficiency !== undefined ? { proficiency: hero.proficiency } : {}),
		// The death saving throws keep their count as a resource that is
		// "spent", and the DM's level-up talk keeps a pending choice the same
		// way (`dm/level-up/pending-hp-choice`): book-keeping, not something
		// the hero has left. Only the ruleset's own resources are shown.
		left: Object.entries(memory.left ?? {})
			.filter(([id]) => id.startsWith("srd/") && !/death[_-]save/.test(id))
			.map(([id, left]) => ({
				label: resourceLabel(id),
				left,
			})),
		quests: (hero.quest ?? []).map((entry) => ({
			label: entry.label,
			value: entry.value,
			...(entry.description ? { about: entry.description } : {}),
		})),
		said: [...(memory.said ?? [])].reverse(),
		identity: (hero.identityDetails ?? []).flatMap((entry) =>
			entry.description ? [{ label: entry.label, about: entry.description }] : [],
		),
		conditions: conditionsOf(hero.conditions),
		drafting: hero.drafting === true,
	};
}

function thingsFrom(view: PlayView, memory: LiveMemory, hero: Hero): Thing[] {
	const things: Thing[] = [];
	const heroId = view.hero.actorId;
	// On a session grid everybody stands on their cell, and the ways out of
	// the hero's cell are steps: the cells take the clicks, not way tags.
	const grid = gridWindow(view);
	const onCell = grid ? fighterSpots(view, grid) : null;
	const away = grid ? stepsAway(view, grid) : null;
	const out = passedOver(view);
	things.push({
		id: heroId,
		kind: "self",
		name: hero.name,
		...(hero.art ? { art: hero.art } : {}),
		...(onCell?.get(heroId) ?? HERO_SPOT),
		conditions: hero.conditions,
		offers: hero.drafting ? [] : heroOffers(view, memory),
		hp: { now: hero.hp, max: hero.hpMax },
		...(heroDown(view) ? { down: true } : {}),
		// Down or in a fight the click on the hero is for what they can do now,
		// not for the sheet: that fold is open at once.
		...(!hero.drafting && heroDown(view)
			? { opens: DOWN }
			: !hero.drafting && inFight(view.session)
				? { opens: OWN }
				: {}),
	});

	const asking = new Set(questionsOf(view).map((question) => question.askerId));
	const occupants = [...view.occupants, ...fightTokens(view)].filter(
		// A fighter outside the part of the grid the floor shows is on the roster only.
		(occupant) => occupant.id !== heroId && (!onCell || onCell.has(occupant.id)),
	);
	// Where the ways out stand, first: no figure is to stand on a way's tag.
	const exits = grid ? [] : (view.place?.exits ?? []);
	const waySpots = placedWays(exits);
	const spots = floorSpots(
		occupants.map((occupant) => occupant.id),
		waySpots,
	);
	for (const occupant of occupants) {
		const art = occupantArt(occupant, memory);
		// While the hero is being made the guided talk is the whole interaction
		// (DESIGN.md): nobody carries tags then.
		const offers = hero.drafting
			? []
			: offersFrom(view, occupant.id, actionsOn(view, occupant), memory, true, occupant.name);
		// Free speech and the numbered answers are not tags of their own: one
		// "Talk" turns the hero to them, and the talk panel does the rest.
		// Only somebody is talked to; the world pairs the speech acts with things too.
		const somebody = occupant.kind !== "thing";
		if (!hero.drafting && somebody && (asking.has(occupant.id) || canAddress(view, occupant.id))) {
			const talk: Offer = {
				id: TALK,
				label: asking.has(occupant.id) ? "Answer" : "Talk",
				sentence: `Talk to ${occupant.name}`,
				lead: true,
			};
			// In a fight the click is for the attack; talking comes after.
			if (inFight(view.session)) offers.push(talk);
			else offers.unshift(talk);
		}
		things.push({
			id: occupant.id,
			kind: occupant.kind,
			name: occupant.name,
			// The world's note is the thing's state in words, or a filler ("Here
			// with you"); only the state is worth a line on the tags.
			// A condition the stage does not show (the seat's own book-keeping) is no state.
			...(occupant.note && conditionsOf(occupant.conditions).length > 0
				? { note: occupant.note }
				: away?.has(occupant.id)
					? { note: distanceNote(away.get(occupant.id) ?? 0) }
					: {}),
			...(art ? { art } : {}),
			...(onCell?.get(occupant.id) ?? spots.get(occupant.id) ?? HERO_SPOT),
			conditions: out.has(occupant.id) ? [OUT] : conditionsOf(occupant.conditions),
			offers,
			...(out.has(occupant.id) ? { out: true } : {}),
			...(asking.has(occupant.id) ? { asks: true, answerWith: TALK } : {}),
		});
	}

	exits.forEach((exit, index) => {
		const id = wayId(exit);
		const refused = memory.refusals[`${id}:${GO}`];
		const gate = exit.gates.map(gateName).join(", ");
		const spot = waySpots[index] ?? HERO_SPOT;
		things.push({
			id,
			kind: "way",
			name: exit.toName,
			...spot,
			conditions: [],
			offers: [
				{
					id: GO,
					label: "Go",
					sentence: goSentence(exit),
					lead: true,
					...(refused ? { refused } : {}),
				},
			],
			way: { direction: exit.label, toName: exit.toName, ...(gate ? { gate } : {}) },
		});
	});
	return things;
}

/** What stands under the name of a fighter the turn order passes over. */
export const OUT = "out of the fight";

/** How far a fighter stands, in the words of the grid. */
export function distanceNote(steps: number): string {
	if (steps <= 1) return "Next to you.";
	return `${steps} steps away.`;
}

/** The spot of every way out, in the order the world lists them. */
function placedWays(exits: readonly PlayExit[]): Spot[] {
	const perDirection = new Map<string, number>();
	let loose = 0;
	return exits.map((exit) => {
		const direction = exit.label.toLowerCase().replace(/[^a-z]/g, "");
		const before = perDirection.get(direction) ?? 0;
		perDirection.set(direction, before + 1);
		const spot = waySpot(exit.label, before, loose);
		// Ways the app cannot place line up along the front, one slot each.
		if (!wayPlaced(exit.label)) loose += 1;
		return spot;
	});
}

/**
 * A change of the hero's own conditions, each named once by the whole. The
 * world's sentence lists the parts too ("... Incapacitated, No Action, No
 * Bonus Action, No Reaction, Dead, Unconscious and Stable."). Anything else,
 * or a change without ids, keeps the world's words.
 */
export function conditionSentence(entry: {
	kind: string;
	fields?: { applied?: unknown; conditionIds?: unknown };
}): string | undefined {
	if (entry.kind !== "self_condition_changed") return undefined;
	const ids = entry.fields?.conditionIds;
	if (!Array.isArray(ids) || typeof entry.fields?.applied !== "boolean") return undefined;
	const names = conditionsOf(ids.filter((id): id is string => typeof id === "string"));
	if (names.length === 0) return undefined;
	const list =
		names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
	return entry.fields.applied ? `You are now ${list}.` : `You are no longer ${list}.`;
}

/** The story in world order, with what the hero's clicks came to in between. */
export function worldLines(
	view: PlayView,
	met: Readonly<Record<string, string>> = {},
): StoryLine[] {
	return inTickOrder([
		...spokenLines(view, met),
		...view.events.map((entry) => ({
			key: `e${entry.id}`,
			tick: entry.tick,
			who: "",
			text: fightSentence(entry, view.events) ?? conditionSentence(entry) ?? entry.summary,
			mine: false,
		})),
	]);
}

/**
 * Not every row is a line of the story. The world echoes a numbered answer
 * as the hero's own words without any words, and it can deliver one reply
 * as two rows (seen live 2026-11-16: "Lead the way. ..." twice).
 */
function worthALine(line: StoryLine, index: number, lines: readonly StoryLine[]): boolean {
	if (line.text.trim() === "") return false;
	const before = lines[index - 1];
	const said = !line.result && line.who !== "";
	return !(
		said &&
		before &&
		!before.result &&
		before.who === line.who &&
		before.text === line.text
	);
}

function linesFrom(view: PlayView, memory: LiveMemory): Line[] {
	const results = new Map(memory.results.map((result) => [`r${result.id}`, result]));
	const speakers = new Map(
		view.speech.map((row) => [row.id, (row.speakerId ?? "").replace(/^entity:/, "")]),
	);
	return withResults(worldLines(view, memory.met), memory.results)
		.filter(worthALine)
		.slice(-STORY_WINDOW)
		.map((line): Line => {
			const id = memory.lineId(line.key);
			const result = line.result ? results.get(line.key) : undefined;
			if (result) {
				return {
					id,
					kind: result.refused ? "refusal" : "result",
					text: line.text,
					...(result.thingId ? { thingId: result.thingId } : {}),
				};
			}
			const speaker = speakers.get(line.key);
			if (speaker !== undefined) {
				return {
					id,
					kind: line.mine ? "mine" : "speech",
					text: line.text,
					who: line.who,
					thingId: line.mine ? view.hero.actorId : speaker,
				};
			}
			return { id, kind: "story", text: line.text };
		});
}

/**
 * The open reaction window, named after the action it would be ("Opportunity
 * Attack"), with the world's description of that action.
 */
export function reactionFrom(view: PlayView): Stage["reaction"] {
	const open = view.reaction;
	if (!open) return undefined;
	const context = view.manipulationContext;
	const action =
		context.status === "ready"
			? context.actions.find((entry) => entry.actionId === open.originatingActionId)
			: undefined;
	return {
		name: action?.displayName ?? "a reaction",
		...(action?.description ? { about: action.description } : {}),
	};
}

export function stageFromView(view: PlayView, memory: LiveMemory): Stage {
	const hero = heroFrom(view, memory);
	const backdrop = view.place?.art ? memory.art(view.place.art.hash) : undefined;
	const grid = gridWindow(view) !== null;
	const reaction = reactionFrom(view);
	return {
		place: {
			id: view.place?.id ?? "",
			// In a fight the hero's place is a cell of the session grid ("Cell
			// 0,0"); the top line names the place the fight is in.
			name: (grid ? memory.ground?.name : view.place?.name) ?? (grid ? "A fight" : "Nowhere yet"),
			description: (grid ? memory.ground?.description : view.place?.description) ?? "",
			...(backdrop ? { art: { url: backdrop, pixel: false } } : {}),
		},
		things: thingsFrom(view, memory, hero),
		hero,
		talk: roundFrom(view, memory),
		lines: linesFrom(view, memory),
		flashes: memory.flashes,
		fight: fightFrom(view, {
			art: memory.art,
			stepCostMs: memory.stepCostMs,
			...(hero.art ? { heroArt: hero.art } : {}),
		}),
		busy: memory.busy,
		pack: stacked(view.pack).map((item) => packItem(view, item, memory)),
		// In a fight the hero's place is a grid cell; the area map is no way out of it.
		map: grid ? { here: view.place?.id ?? "", sheets: [] } : areaMap(memory.atlas, view.place?.id),
		gaps: LIVE_GAPS,
		...(reaction ? { reaction } : {}),
	};
}

/**
 * The pack with equal things on one row: the world lists seven rations as
 * seven rows. Rows stack when they follow each other with the same name, at
 * the same depth, worn the same way; the row keeps the first one's id, so a
 * look at the stack is a look at that one.
 */
export function stacked(pack: PlayView["pack"]): PlayView["pack"] {
	const rows: PlayView["pack"][number][] = [];
	for (const item of pack) {
		const last = rows.at(-1);
		if (
			last &&
			last.name === item.name &&
			(last.depth ?? 0) === (item.depth ?? 0) &&
			(last.equipped ?? "") === (item.equipped ?? "")
		)
			rows[rows.length - 1] = { ...last, quantity: last.quantity + item.quantity };
		else rows.push(item);
	}
	return rows;
}

/** One thing of the pack; the one that was looked at carries its detail. */
function packItem(view: PlayView, item: PlayView["pack"][number], memory: LiveMemory): PackItem {
	const detail = view.itemDetail && view.itemDetail.id === item.id ? view.itemDetail : undefined;
	const own = detail?.art ? memory.art(detail.art.hash) : undefined;
	// The list carries no definition id; one seen in a detail is remembered by name.
	const kind = detail?.definitionRef ?? memory.kinds?.[item.name];
	const sprite = kind ? memory.art(kind) : undefined;
	const art: Art | undefined = own
		? { url: own, pixel: false }
		: sprite
			? { url: sprite, pixel: true }
			: undefined;
	return {
		id: item.id,
		name: item.name,
		quantity: item.quantity,
		...(item.equipped ? { worn: item.equipped } : {}),
		...(item.depth ? { depth: item.depth } : {}),
		...(art ? { art } : {}),
		...(detail?.description ? { description: detail.description } : {}),
		offers: detail ? itemOffers(view, item, detail, memory) : [],
	};
}

/**
 * What the pack shows for a thing that was looked at. The world pairs the
 * thing with the hero's whole action set (a mace: every attack, every check,
 * "Sneak Attack", each with the mace as its target). Only an action that asks
 * for a niche the thing stands in leads; the rest folds, and can still be
 * tried.
 */
function itemOffers(
	view: PlayView,
	item: PlayView["pack"][number],
	detail: NonNullable<PlayView["itemDetail"]>,
	memory: Pick<LiveMemory, "refusals" | "picks">,
): Offer[] {
	const actions = itemActions(detail);
	const fits = nicheFit(view.manipulationContext);
	const made = new Set(
		actions.filter((action) => fits(action) === true).map((action) => action.id),
	);
	return offersFrom(view, item.id, actions, memory, true, item.name).map((offer) =>
		offer.lead && made.has(offer.id)
			? offer
			: { ...offer, lead: false, group: offer.group ?? "Other" },
	);
}

/**
 * What can be done with the thing itself. Its detail also lists every action
 * it takes part in, paired with every target in view (a sword: each attack
 * on each fighter, 107 rows seen live 2026-11-15); those hang on the target.
 */
function itemActions(detail: NonNullable<PlayView["itemDetail"]>): PlayAction[] {
	// The detail's id is the pack row's (`i:170`); actions name the entity (`item:170`).
	const entity = detail.entityId ?? detail.id.replace(/^i:/, "");
	const own = new Set([`item:${entity}`, `entity:${entity}`]);
	return detail.verbs.filter((action) => own.has(action.targetRef));
}

/** The stage before the world has answered once, or when it cannot be opened. */
export function emptyStage(status: string, busy: Stage["busy"] = null): Stage {
	return {
		place: { id: "", name: status, description: "" },
		things: [],
		hero: {
			name: "",
			calling: "",
			hp: 0,
			hpMax: 1,
			ac: 0,
			xp: 0,
			level: 1,
			abilities: [],
			skills: [],
			conditions: [],
			drafting: true,
		},
		talk: null,
		lines: [],
		flashes: [],
		fight: null,
		busy,
		pack: [],
		map: { here: "", sheets: [] },
		gaps: LIVE_GAPS,
	};
}

/**
 * Which attempt an offer on the stage stands for, read from the view as it
 * is now. Undefined when the world no longer discloses it.
 */
export function attemptFor(view: PlayView, thingId: string, offerId: string): Attempt | undefined {
	if (thingId.startsWith("way:")) {
		const exit = view.place?.exits.find((entry) => wayId(entry) === thingId);
		return exit && offerId === GO ? { kind: "move", exit, sentence: goSentence(exit) } : undefined;
	}
	const pool =
		thingId === view.hero.actorId
			? actionsHereAndMe(view)
			: [
					...actionsOnFighter(view, thingId),
					// A thing of the pack: what its detail lists.
					...(view.itemDetail?.id === thingId ? itemActions(view.itemDetail) : []),
					...view.actions,
				];
	const action = pool.find((entry) => entry.id === offerId);
	if (!action) return undefined;
	// The world's own label names the target "Someone here"; the stage knows
	// whom the click was on.
	const about =
		thingId === view.hero.actorId
			? undefined
			: ([...view.occupants, ...fightTokens(view)].find((occupant) => occupant.id === thingId)
					?.name ?? view.pack.find((item) => item.id === thingId)?.name);
	const sentence = action.name && about ? `${action.name}: ${about}` : action.label;
	return { kind: "act", action, sentence };
}

/** Does an action ask for words or a form before it can be sent? */
export function needsInput(action: PlayAction): boolean {
	return action.acceptsUtterance || (action.input?.fields.length ?? 0) > 0;
}
