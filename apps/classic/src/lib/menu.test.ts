import { describe, expect, it } from "vitest";
import type { PlayAction, PlayManipulationContext } from "../../../play/src/lib/play-view";
import {
	boundActions,
	classFeature,
	inFight,
	masteredAttacks,
	menuFor,
	nicheFit,
	onePerAction,
	sameSide,
} from "./menu";

function action(actionId: string, extra: Partial<PlayAction> = {}): PlayAction {
	return {
		id: `factored:${actionId}:entity:6`,
		actionId,
		descriptor: actionId,
		label: `${actionId} — Someone`,
		name: actionId,
		verb: "manipulate",
		targetName: "Someone",
		targetRef: "entity:6",
		acceptsUtterance: false,
		...extra,
	};
}

const offered = [
	action("srd/speak-to", { name: "Say" }),
	action("srd/check/arcana", { name: "Check: Arcana" }),
	action("srd/check/athletics", { name: "Check: Athletics" }),
	action("srd/attack/melee", { name: "Melee Attack", group: "combat" }),
	action("srd/attack/ranged", { name: "Ranged Attack", groups: ["combat"] }),
	action("dm/dialog/choice/1", { name: "Answer 1", slot: 1 }),
	action("dm/creation/discard", { name: "Discard the drafted character" }),
	action("srd/look", { name: "Look" }),
];

const names = (list: PlayAction[]) => list.map((entry) => entry.name);

describe("menuFor", () => {
	it("keeps the first level short outside a fight", () => {
		const menu = menuFor(offered, { inFight: false });
		expect(names(menu.primary)).toEqual(["Look", "Say"]);
		expect(menu.groups.map((group) => [group.label, names(group.actions)])).toEqual([
			["Attack", ["Melee Attack", "Ranged Attack"]],
			["Checks", ["Check: Arcana", "Check: Athletics"]],
		]);
	});

	it("folds what belongs to a fight away outside one", () => {
		const peaceful = [
			...offered,
			action("srd/claim-victory", { name: "Claim Victory" }),
			action("srd/help", { name: "Help" }),
		];
		const menu = menuFor(peaceful, { inFight: false });
		expect(names(menu.primary)).toEqual(["Look", "Say"]);
		expect(names(menu.groups[0]?.actions ?? [])).toEqual([
			"Claim Victory",
			"Help",
			"Melee Attack",
			"Ranged Attack",
		]);
		// In a fight they stand on the first level, after the attacks.
		expect(names(menuFor(peaceful, { inFight: true }).primary)).toEqual([
			"Melee Attack",
			"Ranged Attack",
			"Claim Victory",
			"Help",
			"Look",
			"Say",
		]);
	});

	it("puts combat verbs first in a fight", () => {
		const menu = menuFor(offered, { inFight: true });
		expect(names(menu.primary)).toEqual(["Melee Attack", "Ranged Attack", "Look", "Say"]);
		expect(menu.groups.map((group) => group.label)).toEqual(["Checks"]);
	});

	it("leads a fight with the attacks a weapon is bound to", () => {
		const menu = menuFor(offered, {
			inFight: true,
			bound: (entry) => entry.actionId === "srd/attack/melee",
		});
		expect(names(menu.primary)).toEqual(["Melee Attack", "Look", "Say"]);
		expect(menu.groups.map((group) => [group.label, names(group.actions)])).toEqual([
			["More attacks", ["Ranged Attack"]],
			["Checks", ["Check: Arcana", "Check: Athletics"]],
		]);
	});

	it("does not lead with a reaction or a swing at nothing, though a weapon is bound to them", () => {
		const fight = [
			...offered,
			action("srd/attack/opportunity-attack", { name: "Opportunity Attack", group: "combat" }),
			action("srd/attack/melee/swing", { name: "Swing (no target)", group: "combat" }),
		];
		const menu = menuFor(fight, {
			inFight: true,
			bound: (entry) => (entry.actionId ?? "").startsWith("srd/attack/"),
		});
		expect(names(menu.primary)).toEqual(["Melee Attack", "Ranged Attack", "Look", "Say"]);
		expect(names(menu.groups[0]?.actions ?? [])).toEqual([
			"Opportunity Attack",
			"Swing (no target)",
		]);
	});

	it("keeps every attack first when no weapon is bound", () => {
		const menu = menuFor(offered, { inFight: true, bound: () => false });
		expect(names(menu.primary)).toEqual(["Melee Attack", "Ranged Attack", "Look", "Say"]);
	});

	it("folds a caster's spells into their own group, in and out of a fight", () => {
		const caster = [
			...offered,
			action("srd/spell/fire-bolt/cast", { name: "Cast Fire Bolt" }),
			action("srd/spell/bless/cast", { name: "Cast Bless" }),
		];
		for (const inFight of [false, true]) {
			const menu = menuFor(caster, { inFight });
			expect(names(menu.primary)).not.toContain("Cast Bless");
			expect(names(menu.groups.find((group) => group.id === "spells")?.actions ?? [])).toEqual([
				"Cast Bless",
				"Cast Fire Bolt",
			]);
		}
	});

	it("leaves answer slots to the talk panel and creation to the wizard", () => {
		const menu = menuFor(offered, { inFight: false });
		const all = [...menu.primary, ...menu.groups.flatMap((group) => group.actions)].map(
			(entry) => entry.actionId,
		);
		expect(all).not.toContain("dm/dialog/choice/1");
		expect(all).not.toContain("dm/creation/discard");
	});

	it("drops a repeated pairing", () => {
		const menu = menuFor([offered[0] as PlayAction, offered[0] as PlayAction], { inFight: false });
		expect(menu.primary).toHaveLength(1);
	});

	it("offers no empty group", () => {
		expect(menuFor([action("srd/look", { name: "Look" })], { inFight: false }).groups).toEqual([]);
	});
});

describe("nicheFit", () => {
	const requirement = (niche_id: string, admits = false) => ({
		niche_id,
		requires_spatial_attachment: false,
		admits_targets_without_membership: admits,
	});
	const context = {
		status: "ready",
		schemaVersion: 1,
		revision: 1,
		participants: [],
		actions: [
			{
				actionId: "srd/pickup",
				displayName: "Pick Up",
				tags: [],
				selfOnly: false,
				selfEligible: false,
				nicheRequirements: [requirement("srd/item")],
			},
			{
				actionId: "srd/speak-to",
				displayName: "Speak To",
				tags: [],
				selfOnly: false,
				selfEligible: false,
				nicheRequirements: [requirement("srd/niche/communicable")],
			},
			{
				actionId: "srd/look",
				displayName: "Look",
				tags: [],
				selfOnly: false,
				selfEligible: false,
				nicheRequirements: [],
			},
			{
				actionId: "srd/anywhere",
				displayName: "Anywhere",
				tags: [],
				selfOnly: false,
				selfEligible: false,
				nicheRequirements: [requirement("srd/far", true)],
			},
		],
		targets: [
			{
				targetFactId: "t1",
				targetRef: "entity:6",
				targetName: "Chest",
				tags: [],
				nicheIds: ["srd/item", "srd/item/chest"],
			},
		],
	} as unknown as PlayManipulationContext;
	const fits = nicheFit(context);

	it("fits an action whose niche the target stands in", () => {
		expect(fits(action("srd/pickup"))).toBe(true);
	});

	it("does not fit an action asking for another niche", () => {
		expect(fits(action("srd/speak-to"))).toBe(false);
	});

	it("fits an action with no requirement or one that admits any target", () => {
		expect(fits(action("srd/look"))).toBe(true);
		expect(fits(action("srd/anywhere"))).toBe(true);
	});

	it("stays undecided when the facts are missing", () => {
		expect(fits(action("srd/unknown"))).toBeUndefined();
		expect(fits(action("srd/pickup", { targetRef: "entity:99" }))).toBeUndefined();
		expect(nicheFit({ status: "unavailable" })(action("srd/pickup"))).toBeUndefined();
	});

	it("moves misfits to the Other fold, still reachable", () => {
		const menu = menuFor(
			[action("srd/pickup", { name: "Pick Up" }), action("srd/speak-to", { name: "Speak To" })],
			{ inFight: false, fits },
		);
		expect(names(menu.primary)).toEqual(["Pick Up"]);
		expect(menu.groups.map((group) => [group.label, names(group.actions)])).toEqual([
			["Other", ["Speak To"]],
		]);
	});
});

describe("onePerAction", () => {
	const self = action("srd/speak-aloud", { id: "a:self", targetRef: "entity:168" });
	const place = action("srd/speak-aloud", { id: "a:place", targetRef: "place_node:loft" });

	it("keeps one pairing per action", () => {
		expect(onePerAction([self, place, action("srd/dash")]).map((entry) => entry.id)).toEqual([
			"a:self",
			"factored:srd/dash:entity:6",
		]);
	});

	it("prefers the pairing whose target fits", () => {
		const fits = (entry: typeof self) => entry.targetRef.startsWith("place_node:");
		expect(onePerAction([self, place], fits).map((entry) => entry.id)).toEqual(["a:place"]);
	});
});

describe("inFight", () => {
	const session = (others: number) => ({
		inSession: true,
		myTurn: true,
		lifecycle: "active",
		currentActor: "1",
		currentActorName: "Hero",
		roster: [
			{ actorId: "1", name: "Hero", ordinal: 0, isMe: true, isCurrent: true },
			...Array.from({ length: others }, (_, index) => ({
				actorId: `foe${index}`,
				name: "Foe",
				ordinal: index + 1,
				isMe: false,
				isCurrent: false,
			})),
		],
	});

	it("is a fight when someone else takes turns", () => {
		expect(inFight(session(2))).toBe(true);
	});

	it("is not a fight on a journey, where the hero walks alone", () => {
		expect(inFight(session(0))).toBe(false);
	});

	it("is not a fight without a session", () => {
		expect(inFight({ ...session(1), inSession: false })).toBe(false);
		expect(inFight(undefined)).toBe(false);
	});
});

describe("boundActions", () => {
	it("knows the actions the world bound a thing to", () => {
		const bound = boundActions({
			status: "ready",
			actions: [],
			targets: [],
			prompts: [],
			participants: [
				{
					contextId: "mpc:1",
					actionId: "srd/attack/melee",
					bindingCount: 1,
					bindings: [{ roleId: "srd/instrument", entityId: "170" }],
				},
				{ contextId: "mpc:2", actionId: "srd/attack/ranged", bindingCount: 0, bindings: [] },
			],
		} as unknown as PlayManipulationContext);
		expect(bound(action("srd/attack/melee"))).toBe(true);
		expect(bound(action("srd/attack/ranged"))).toBe(false);
		expect(bound(action("srd/help"))).toBe(false);
	});

	it("binds nothing while the facts are unavailable", () => {
		expect(boundActions({ status: "unavailable" } as PlayManipulationContext)(action("x"))).toBe(
			false,
		);
	});
});

describe("weapon masteries in a fight", () => {
	const fight = [
		...offered,
		action("srd/attack/melee-graze", { name: "Melee Attack (Graze)", group: "combat" }),
		action("srd/attack/melee-topple", { name: "Melee Attack (Topple)", group: "combat" }),
		action("srd/attack/unarmed-strike/damage", { name: "Unarmed Strike", group: "combat" }),
	];
	const bound = (entry: PlayAction) => entry.actionId === "srd/attack/melee";

	it("leads with the mastery that fits the weapon in hand, before the plain attack", () => {
		const menu = menuFor(fight, {
			inFight: true,
			bound,
			mastered: (entry) => entry.actionId === "srd/attack/melee-graze",
		});
		expect(names(menu.primary)).toEqual(["Melee Attack (Graze)", "Melee Attack", "Look", "Say"]);
		expect(menu.groups.map((group) => [group.label, names(group.actions)])).toEqual([
			["Weapon masteries", ["Melee Attack (Topple)"]],
			["More attacks", ["Ranged Attack", "Unarmed Strike"]],
			["Checks", ["Check: Arcana", "Check: Athletics"]],
		]);
	});

	it("gives the masteries a fold of their own when none is known to fit", () => {
		const menu = menuFor(fight, { inFight: true, bound });
		expect(names(menu.primary)).toEqual(["Melee Attack", "Look", "Say"]);
		expect(menu.groups[0]).toMatchObject({ label: "Weapon masteries" });
		expect(names(menu.groups[0]?.actions ?? [])).toEqual([
			"Melee Attack (Graze)",
			"Melee Attack (Topple)",
		]);
	});

	it("leaves the masteries with the other attacks outside a fight", () => {
		const menu = menuFor(fight, { inFight: false, bound, mastered: () => true });
		expect(menu.groups[0]?.label).toBe("Attack");
		expect(names(menu.groups[0]?.actions ?? [])).toContain("Melee Attack (Graze)");
	});
});

describe("masteredAttacks", () => {
	const context = {
		status: "ready",
		actions: [],
		targets: [],
		participants: [
			{
				contextId: "mpc:1",
				actionId: "srd/attack/melee",
				bindingCount: 1,
				bindings: [{ roleId: "srd/instrument", entityId: "170" }],
			},
		],
	} as unknown as PlayManipulationContext;
	const weaponOf = (entityId: string) => (entityId === "170" ? "Greatsword" : undefined);

	it("knows the mastery of the bound weapon when the hero chose that weapon", () => {
		const mastered = masteredAttacks(context, weaponOf, ["greatsword", "handaxe"]);
		expect(mastered(action("srd/attack/melee-graze"))).toBe(true);
		expect(mastered(action("srd/attack/melee-topple"))).toBe(false);
		expect(mastered(action("srd/attack/melee"))).toBe(false);
	});

	it("knows none for a weapon the hero did not choose, or one it cannot name", () => {
		expect(masteredAttacks(context, weaponOf, ["flail"])(action("srd/attack/melee-graze"))).toBe(
			false,
		);
		expect(
			masteredAttacks(context, () => undefined, ["greatsword"])(action("srd/attack/melee-graze")),
		).toBe(false);
		expect(masteredAttacks(context, weaponOf, [])(action("srd/attack/melee-graze"))).toBe(false);
	});

	it("reads a weapon of two words", () => {
		const mastered = masteredAttacks(context, () => "Light Crossbow", ["light-crossbow"]);
		expect(mastered(action("srd/attack/melee-slow"))).toBe(true);
	});
});

describe("sameSide and Help", () => {
	const target = (targetRef: string, nicheIds: string[]) => ({
		targetFactId: targetRef,
		targetRef,
		targetName: "Someone here",
		tags: [],
		nicheIds,
	});
	const context = {
		status: "ready",
		actions: [],
		participants: [],
		targets: [
			target("entity:1", ["srd.creature", "srd.faction.party"]),
			target("entity:6", ["srd.creature", "srd.faction.monsters"]),
			target("entity:7", ["srd.creature", "srd.faction.party"]),
			target("entity:8", ["srd.creature"]),
		],
	} as unknown as PlayManipulationContext;
	const ally = sameSide(context, "1");

	it("tells a foe from an ally by the side the world names", () => {
		expect(ally(action("srd/help"))).toBe(false);
		expect(ally(action("srd/help", { targetRef: "entity:7" }))).toBe(true);
		expect(ally(action("srd/help", { targetRef: "entity:8" }))).toBeUndefined();
	});

	it("folds Help away on a foe in a fight, and keeps it on an ally", () => {
		const help = action("srd/help", { name: "Help" });
		const onFoe = menuFor([...offered, help], { inFight: true, ally });
		expect(names(onFoe.primary)).not.toContain("Help");
		expect(names(onFoe.groups.at(-1)?.actions ?? [])).toEqual(["Help"]);
		const onAlly = menuFor([{ ...help, targetRef: "entity:7" }], { inFight: true, ally });
		expect(names(onAlly.primary)).toEqual(["Help"]);
	});
});

describe("classFeature", () => {
	it("knows an action that asks for a class feature of whoever does it", () => {
		const requirement = (niche_id: string) => ({
			niche_id,
			requires_spatial_attachment: false,
			admits_targets_without_membership: true,
		});
		const feature = classFeature({
			status: "ready",
			targets: [],
			participants: [],
			actions: [
				{
					actionId: "srd/fighter/second-wind",
					nicheRequirements: [requirement("capability:srd/class-feature/fighter/second-wind")],
				},
				{ actionId: "srd/dodge", nicheRequirements: [requirement("capability:srd/action/dodge")] },
			],
		} as unknown as PlayManipulationContext);
		expect(feature(action("srd/fighter/second-wind"))).toBe(true);
		expect(feature(action("srd/dodge"))).toBe(false);
	});
});

describe("a crowd of loose tags", () => {
	const keeper = [
		action("srd/speak-to", { name: "Say" }),
		action("srd/look", { name: "Look" }),
		action("dm/ask-about-advancement", { name: "Ask About Advancement" }),
		action("srd/advancement/level-up", { name: "Level Up" }),
		action("dm/level-up/accept-offer", { name: "Accept the offer" }),
		action("dm/level-up/confirm", { name: "Confirm the level-up" }),
		action("dm/level-up/steady-advance", { name: "Take the average Hit Points" }),
		action("dm/level-up/discard", { name: "Discard the drafted choice" }),
	];

	it("folds a family of three and more when the first level is crowded", () => {
		const menu = menuFor(keeper, { inFight: false });
		expect(names(menu.primary)).toEqual(["Ask About Advancement", "Level Up", "Look", "Say"]);
		expect(menu.groups[0]).toMatchObject({ id: "dm/level-up", label: "Level up" });
		expect(names(menu.groups[0]?.actions ?? [])).toEqual([
			"Accept the offer",
			"Confirm the level-up",
			"Discard the drafted choice",
			"Take the average Hit Points",
		]);
	});

	it("leaves a short first level as it is", () => {
		const menu = menuFor(keeper.slice(2), { inFight: false });
		expect(menu.primary).toHaveLength(6);
		expect(menu.groups).toEqual([]);
	});

	it("folds nothing by family in a fight", () => {
		expect(menuFor(keeper, { inFight: true }).primary).toHaveLength(8);
	});
});

describe("a foe outside a fight", () => {
	const foe = (entry: PlayAction) => (entry.targetRef === "entity:6" ? false : undefined);
	const bound = (entry: PlayAction) => entry.actionId === "srd/attack/melee";

	it("leads with the attacks on somebody of another side, as in a fight", () => {
		const menu = menuFor(offered, { inFight: false, bound, ally: foe });
		expect(names(menu.primary)).toEqual(["Melee Attack", "Look", "Say"]);
		expect(menu.groups[0]).toMatchObject({ label: "More attacks" });
	});

	it("keeps the attacks folded on a friend and on somebody whose side is unknown", () => {
		for (const ally of [() => true, () => undefined]) {
			const menu = menuFor(offered, { inFight: false, bound, ally });
			expect(names(menu.primary)).toEqual(["Look", "Say"]);
			expect(menu.groups[0]?.label).toBe("Attack");
		}
	});
});

describe("the adventure's own deeds", () => {
	const deed = action("elven_mini/quest/relight-the-altar", { name: "Relight the altar" });
	const other = action("elven_mini/quest/burn-the-camp", { name: "Set the camp alight" });
	const check = action("srd/pickup", { name: "Pick Up" });
	const fits = (entry: PlayAction) =>
		entry === check || entry === deed || entry === other ? false : undefined;

	it("gives a deed whose target does not fit yet a fold of its own, not the Other fold", () => {
		const menu = menuFor([...offered, deed, other, check], { inFight: false, fits });
		expect(menu.groups.map((group) => [group.label, names(group.actions)])).toEqual([
			["Quest", ["Relight the altar", "Set the camp alight"]],
			["Attack", ["Melee Attack", "Ranged Attack"]],
			["Checks", ["Check: Arcana", "Check: Athletics"]],
			["Other", ["Pick Up"]],
		]);
	});

	it("leaves a deed that fits on the first level", () => {
		const menu = menuFor([deed], { inFight: false, fits: () => true });
		expect(names(menu.primary)).toEqual(["Relight the altar"]);
	});
});
