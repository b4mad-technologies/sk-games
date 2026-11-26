// What a click on something offers.
//
// The world lists "my actions" and "targets I see" separately (ADR-0141), so
// the paired list for one target is long: every skill check, every answer
// slot, every attack. This module sorts that list into a short first level
// and a few folded groups. It decides presentation only. Nothing here hides
// an action because it "would not work": the world answers the attempt.
//
// The rules use authored, structured facts: the descriptor family
// (`srd/check/...`), the authored group (`ui.affordance_group`), the response
// slot and the cue rank. They never read a label.

import type {
	PlayAction,
	PlayManipulationContext,
	PlaySessionState,
} from "../../../play/src/lib/play-view";

export type MenuGroup = { id: string; label: string; actions: PlayAction[] };
export type ActionMenu = { primary: PlayAction[]; groups: MenuGroup[] };

/** `srd/check/acrobatics` -> `srd/check`. */
function family(action: PlayAction): string {
	return (action.actionId ?? action.descriptor).split("/").slice(0, 2).join("/");
}

function byLabel(a: PlayAction, b: PlayAction): number {
	return (a.name ?? a.label).localeCompare(b.name ?? b.label);
}

/**
 * Does the target stand in a niche the action asks for? Both sides are facts
 * the world discloses (`niche_requirements` on the action, `niche_ids` on the
 * target). `undefined` means the facts are missing, which counts as fitting.
 *
 * A misfit is a ranking signal, not a verdict: the action moves to the
 * "Other" fold and can still be tried.
 */
export function nicheFit(
	context: PlayManipulationContext,
): (action: PlayAction) => boolean | undefined {
	if (context.status !== "ready") return () => undefined;
	const requirements = new Map(
		context.actions.map((action) => [action.actionId, action.nicheRequirements]),
	);
	const niches = new Map(context.targets.map((target) => [target.targetRef, target.nicheIds]));
	return (action) => {
		const asked = requirements.get(action.actionId ?? action.descriptor);
		const offered = niches.get(action.targetRef);
		if (asked === undefined || offered === undefined) return undefined;
		if (asked.length === 0) return true;
		return asked.some(
			(requirement) =>
				requirement.admits_targets_without_membership || offered.includes(requirement.niche_id),
		);
	};
}

/**
 * Is this turn session a fight? The world also opens a session with the hero
 * as its only participant for a long walk (ADR-0092 travel). That is a
 * journey, not a fight, and must not pull the attack verbs to the front.
 */
export function inFight(session: PlaySessionState | undefined): boolean {
	return session?.inSession === true && session.roster.some((entry) => !entry.isMe);
}

/**
 * Which actions did the world already bind one of the hero's things to (a
 * weapon as `srd/instrument`, say)? A binding is a ranking signal only: an
 * action without one (an unarmed strike) can still be tried from the fold.
 */
export function boundActions(context: PlayManipulationContext): (action: PlayAction) => boolean {
	if (context.status !== "ready") return () => false;
	const bound = new Set(
		context.participants
			.filter((participant) => participant.bindings.length > 0)
			.map((participant) => participant.actionId),
	);
	return (action) => bound.has(action.actionId ?? action.descriptor);
}

/**
 * Can the hero be the target of this action (`selfEligible`, a fact the world
 * discloses per action)? What the hero does to or with themselves hangs on
 * the hero; an attack paired with the floor they stand on does not.
 */
export function selfEligible(context: PlayManipulationContext): (action: PlayAction) => boolean {
	if (context.status !== "ready") return () => true;
	const eligible = new Map(
		context.actions.map((action) => [action.actionId, action.selfEligible !== false]),
	);
	return (action) => eligible.get(action.actionId ?? action.descriptor) ?? true;
}

/** The world's own description of an action, by action id. */
export function describedActions(
	context: PlayManipulationContext,
): (action: PlayAction) => string | undefined {
	if (context.status !== "ready") return () => undefined;
	const texts = new Map(context.actions.map((action) => [action.actionId, action.description]));
	return (action) => texts.get(action.actionId ?? action.descriptor) || undefined;
}

/**
 * One pairing per action, for a row that is about "here and me" rather than
 * one clicked target. The same action is paired with the hero and with the
 * place; keep the pairing whose target fits the action's niche, and among
 * equals the first one listed.
 */
export function onePerAction(
	actions: readonly PlayAction[],
	fits?: (action: PlayAction) => boolean | undefined,
): PlayAction[] {
	const kept = new Map<string, PlayAction>();
	for (const action of actions) {
		const id = action.actionId ?? action.descriptor;
		const known = kept.get(id);
		if (!known || (fits?.(known) === false && fits(action) !== false)) kept.set(id, action);
	}
	return [...kept.values()];
}

/**
 * SRD attacks the world binds to the weapon like any other, but that are no
 * answer to "what do I do to this foe now": an opportunity attack is a
 * reaction to somebody leaving, a swing has no target. They stay offered,
 * one level down.
 */
const NOT_A_CLICK_ON_A_FOE = new Set(["srd/attack/opportunity-attack", "srd/attack/melee/swing"]);

/**
 * SRD actions that belong to a fight although the world does not group them
 * with the attacks: claiming a dead creature's experience, and the Help
 * action. Outside a fight they led the tags of every innkeeper; there they
 * fold away with the attacks.
 */
const FOR_A_FIGHT = new Set(["srd/claim-victory", "srd/help"]);

/** The SRD's Help action: a hand for an ally, not something done to a foe. */
const HELP = "srd/help";

/** The tag that names a creature's side ("srd.faction.party"). */
const FACTION = /^srd\.faction\./;

/**
 * Does the target of this action stand on the hero's side? Both sides are
 * tags the world discloses on a target (`srd.faction.party` on the hero,
 * `srd.faction.monsters` on a rat). `undefined` when either side names none.
 */
export function sameSide(
	context: PlayManipulationContext,
	heroId: string,
): (action: PlayAction) => boolean | undefined {
	if (context.status !== "ready") return () => undefined;
	const sides = new Map(
		context.targets.map((target) => [
			target.targetRef,
			(target.nicheIds ?? []).filter((niche) => FACTION.test(niche)),
		]),
	);
	const mine = sides.get(`entity:${heroId}`) ?? [];
	return (action) => {
		const theirs = sides.get(action.targetRef) ?? [];
		if (mine.length === 0 || theirs.length === 0) return undefined;
		return theirs.some((side) => mine.includes(side));
	};
}

/**
 * Is this action a feature of the hero's class (Second Wind)? The world says
 * so in what the action asks of whoever does it: a capability niche under
 * `srd/class-feature/`.
 */
export function classFeature(context: PlayManipulationContext): (action: PlayAction) => boolean {
	if (context.status !== "ready") return () => false;
	const features = new Set(
		context.actions
			.filter((action) =>
				(action.nicheRequirements ?? []).some((requirement) =>
					requirement.niche_id.startsWith("capability:srd/class-feature/"),
				),
			)
			.map((action) => action.actionId),
	);
	return (action) => features.has(action.actionId ?? action.descriptor);
}

/**
 * The SRD 5.2 weapon table's mastery column, by weapon ("greatsword" ->
 * "graze"). The world offers an attack per mastery ("Melee Attack (Graze)")
 * to everybody and refuses the ones the weapon in hand does not have; it
 * does not say which one that is (the hero's masteries come empty,
 * sk-jay0.1.76.15.6). A copy of the ruleset's own table, like the experience
 * thresholds in `srd-advancement.ts`.
 */
const SRD_WEAPON_MASTERY: Readonly<Record<string, string>> = {
	club: "slow",
	dagger: "nick",
	greatclub: "push",
	handaxe: "vex",
	javelin: "slow",
	"light-hammer": "nick",
	mace: "sap",
	quarterstaff: "topple",
	sickle: "nick",
	spear: "sap",
	dart: "vex",
	"light-crossbow": "slow",
	shortbow: "vex",
	sling: "slow",
	battleaxe: "topple",
	flail: "sap",
	glaive: "graze",
	greataxe: "cleave",
	greatsword: "graze",
	halberd: "cleave",
	lance: "topple",
	longsword: "sap",
	maul: "topple",
	morningstar: "sap",
	pike: "push",
	rapier: "vex",
	scimitar: "nick",
	shortsword: "vex",
	trident: "topple",
	warhammer: "push",
	"war-pick": "sap",
	whip: "slow",
	blowgun: "vex",
	"hand-crossbow": "vex",
	"heavy-crossbow": "push",
	longbow: "slow",
	musket: "slow",
	pistol: "vex",
};

/** "Light Crossbow" -> "light-crossbow". */
function weaponSlug(name: string): string {
	return name.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

/**
 * Which mastery attacks fit the weapon the world bound to the plain attack,
 * for a hero who chose that weapon's mastery? `weaponOf` names the bound
 * thing (the pack knows it), `chosen` are the weapons whose mastery the hero
 * picked ("greatsword"). A ranking signal: the action leads, the world still
 * answers the attempt.
 */
export function masteredAttacks(
	context: PlayManipulationContext,
	weaponOf: (entityId: string) => string | undefined,
	chosen: readonly string[],
): (action: PlayAction) => boolean {
	if (context.status !== "ready" || chosen.length === 0) return () => false;
	const fitting = new Set<string>();
	for (const participant of context.participants) {
		for (const binding of participant.bindings) {
			const weapon = weaponSlug(weaponOf(binding.entityId) ?? "");
			const mastery = chosen.includes(weapon) ? SRD_WEAPON_MASTERY[weapon] : undefined;
			if (mastery) fitting.add(`${participant.actionId}-${mastery}`);
		}
	}
	return (action) => fitting.has(action.actionId ?? action.descriptor);
}

/** From this many first-level tags on, a thing's tags are a crowd. */
const CROWD = 6;
/** A family with at least this many actions in a crowd gets a fold. */
const FAMILY = 3;

/** `dm/level-up` -> "Level up": a fold named after the family's own id. */
function familyLabel(id: string): string {
	const words = (id.split("/").pop() ?? id).replaceAll(/[_-]+/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Many loose tags of one family become a fold. A keeper who can raise the
 * hero a level carried nine first-level tags in the order of the alphabet
 * (seen live 2026-11-16: six of them `dm/level-up/...`, steps of one talk).
 * The actions leave `primary`; the folds come back, named after the family.
 */
function crowdsOf(primary: PlayAction[]): MenuGroup[] {
	if (primary.length <= CROWD) return [];
	const families = new Map<string, PlayAction[]>();
	for (const action of primary) {
		const key = family(action);
		families.set(key, [...(families.get(key) ?? []), action]);
	}
	const crowds = [...families].filter(([, actions]) => actions.length >= FAMILY);
	for (const [, actions] of crowds) {
		for (const action of actions) primary.splice(primary.indexOf(action), 1);
	}
	return crowds.map(([key, actions]) => ({ id: key, label: familyLabel(key), actions }));
}

export function menuFor(
	actions: readonly PlayAction[],
	situation: {
		inFight: boolean;
		fits?: (action: PlayAction) => boolean | undefined;
		bound?: (action: PlayAction) => boolean;
		/** A mastery attack that fits the weapon in hand and the hero's training. */
		mastered?: (action: PlayAction) => boolean;
		/** Does the target stand on the hero's side? Undefined when unknown. */
		ally?: (action: PlayAction) => boolean | undefined;
	},
): ActionMenu {
	const primary: PlayAction[] = [];
	const checks: PlayAction[] = [];
	const combat: PlayAction[] = [];
	const spells: PlayAction[] = [];
	const misfits: PlayAction[] = [];
	const deeds: PlayAction[] = [];
	const id = (action: PlayAction) => action.actionId ?? action.descriptor;
	const seen = new Set<string>();
	for (const action of actions) {
		if (seen.has(action.id)) continue;
		seen.add(action.id);
		// A numbered answer belongs to the open question it answers; the talk
		// panel shows it there, bound to that question.
		if (action.slot !== undefined) continue;
		// Creation is the wizard's job while the hero is drafted.
		if (family(action) === "dm/creation") continue;
		// What the adventure itself put into the world (an id outside the
		// ruleset's and the keeper's) is a deed of a quest: "Relight the
		// altar", "Call on Sister Maelis to yield". Where the target does not
		// stand in its niche yet it lay in "Other" among thirty skill checks.
		// It gets a fold named after its family; the world still answers.
		if (situation.fits?.(action) === false && !/^(srd|core|dm)\//.test(id(action)))
			deeds.push(action);
		else if (situation.fits?.(action) === false) misfits.push(action);
		// Help is for an ally; on a foe it led the tags beside the attacks.
		else if (
			(action.actionId ?? action.descriptor) === HELP &&
			situation.inFight &&
			situation.ally?.(action) === false
		)
			misfits.push(action);
		else if (family(action) === "srd/check") checks.push(action);
		// The ruleset discloses every spell to a caster (119 on a level-1
		// wizard, seen live 2026-11-14), prepared or not. They get their own fold.
		else if (family(action) === "srd/spell") spells.push(action);
		else if (action.group === "combat" || action.groups?.includes("combat")) combat.push(action);
		else if (!situation.inFight && FOR_A_FIGHT.has(action.actionId ?? action.descriptor))
			combat.push(action);
		else primary.push(action);
	}
	primary.sort(byLabel);
	const crowds = situation.inFight ? [] : crowdsOf(primary);
	checks.sort(byLabel);
	combat.sort(byLabel);
	spells.sort(byLabel);
	misfits.sort(byLabel);

	const groups: MenuGroup[] = [...crowds];
	deeds.sort(byLabel);
	for (const key of new Set(deeds.map(family)))
		groups.push({
			id: key,
			label: familyLabel(key),
			actions: deeds.filter((action) => family(action) === key),
		});
	// In a fight the combat verbs are what the click is for; outside one they
	// fold away so that talking and looking come first.
	// Somebody of another side can be struck before any fight has opened
	// (seen live 2026-11-16: three blows ended a slime that never had a turn);
	// the attack sat two folds deep behind "Talk". On such a target the
	// attacks lead as in a fight.
	const foe = combat.some((action) => situation.ally?.(action) === false);
	if (situation.inFight || foe) {
		// Every weapon-mastery variant and every throwable is offered, so the
		// list is long. The attacks the world bound a weapon to lead; the rest
		// sit one level down. With no binding at all, nothing can be ranked and
		// all of them lead.
		const ready = (situation.bound ? combat.filter(situation.bound) : []).filter(
			(action) => !NOT_A_CLICK_ON_A_FOE.has(action.actionId ?? action.descriptor),
		);
		// A weapon mastery is an attack of its own ("Melee Attack (Graze)": a
		// miss still harms). It sat three clicks deep among twelve. The one that
		// fits the weapon in hand leads, before the plain attack; the other
		// masteries of a bound attack get a fold of their own.
		const masteries = combat.filter((action) =>
			ready.some((plain) => id(action).startsWith(`${id(plain)}-`)),
		);
		const mastered = masteries.filter((action) => situation.mastered?.(action) === true);
		const unproven = masteries.filter((action) => !mastered.includes(action));
		const first = [...mastered, ...ready];
		const rest =
			ready.length > 0
				? combat.filter((action) => !first.includes(action) && !unproven.includes(action))
				: [];
		primary.unshift(...(ready.length > 0 ? first : combat));
		if (unproven.length > 0)
			groups.push({ id: "masteries", label: "Weapon masteries", actions: unproven });
		if (rest.length > 0) groups.push({ id: "combat", label: "More attacks", actions: rest });
	} else if (combat.length > 0) groups.push({ id: "combat", label: "Attack", actions: combat });
	if (spells.length > 0) groups.push({ id: "spells", label: "Spells", actions: spells });
	if (checks.length > 0) groups.push({ id: "checks", label: "Checks", actions: checks });
	if (misfits.length > 0) groups.push({ id: "other", label: "Other", actions: misfits });
	return { primary, groups };
}
