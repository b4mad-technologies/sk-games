import { describe, expect, it } from "vitest";
import type { PlayView } from "../../../play/src/lib/play-view";
import {
	actionsOnFighter,
	cellClick,
	fightTokens,
	gridTokens,
	movementLeft,
	observedStepCost,
	turnBudget,
} from "./fight";

// Shapes copied from a live cellar fight (2026-11-14): hero 168, rat 137 and
// swarm 139 in the roster, no occupants in the scene.
function view(overrides: Partial<PlayView> = {}): PlayView {
	return {
		hero: { actorId: "168", name: "Borin" },
		occupants: [],
		actions: [
			{
				id: "factored:srd/speak-to:t:entity:137",
				actionId: "srd/speak-to",
				targetRef: "entity:137",
			},
			{
				id: "factored:srd/speak-to:t:entity:139",
				actionId: "srd/speak-to",
				targetRef: "entity:139",
			},
		],
		session: {
			inSession: true,
			myTurn: true,
			lifecycle: "active",
			currentActor: "139",
			currentActorName: "Cellar Rat Swarm",
			roster: [
				{ actorId: "137", name: "Cellar Rat 1", ordinal: 0, isMe: false, isCurrent: false },
				{ actorId: "168", name: "Borin", ordinal: 1, isMe: true, isCurrent: false },
				{ actorId: "139", name: "Cellar Rat Swarm", ordinal: 2, isMe: false, isCurrent: true },
			],
		},
		manipulationContext: {
			status: "ready",
			schemaVersion: 1,
			revision: 1,
			actions: [
				{
					actionId: "srd/attack/melee",
					displayName: "Melee Attack",
					groups: ["combat"],
					tags: [],
					templateIds: [],
					nicheRequirements: [],
					selfOnly: false,
					selfEligible: false,
				},
				{
					actionId: "srd/second-wind",
					displayName: "Second Wind",
					groups: [],
					tags: [],
					templateIds: [],
					nicheRequirements: [],
					selfOnly: true,
					selfEligible: true,
				},
			],
			targets: [
				{
					targetFactId: "t:entity:137",
					targetRef: "entity:137",
					targetName: "Someone here",
					tags: [],
					nicheIds: ["core/creature", "srd/creature/giant-rat", "srd/niche/communicable"],
				},
				{
					targetFactId: "t:entity:139",
					targetRef: "entity:139",
					targetName: "Someone here",
					tags: [],
					nicheIds: ["core/creature"],
				},
			],
			participants: [],
			prompts: [],
		},
		...overrides,
	} as unknown as PlayView;
}

describe("fightTokens", () => {
	it("makes a token for every other fighter in the roster", () => {
		const tokens = fightTokens(view());
		expect(tokens.map((token) => [token.id, token.name, token.kind])).toEqual([
			["137", "Cellar Rat 1", "creature"],
			["139", "Cellar Rat Swarm", "creature"],
		]);
		expect(tokens[1]?.note).toBe("In the fight. Acting now.");
	});

	it("takes the definition id from the disclosed creature niche", () => {
		const [rat, swarm] = fightTokens(view());
		expect(rat?.defId).toBe("srd/creature/giant-rat");
		expect(swarm?.defId).toBeUndefined();
	});

	it("leaves a fighter the scene already lists to the scene", () => {
		const occupants = [{ id: "137", name: "Cellar Rat 1", kind: "creature" }];
		expect(fightTokens(view({ occupants } as Partial<PlayView>)).map((token) => token.id)).toEqual([
			"139",
		]);
	});

	it("has no tokens on a journey or outside a session", () => {
		const alone = view();
		alone.session.roster = alone.session.roster.filter((entry) => entry.isMe);
		expect(fightTokens(alone)).toEqual([]);
		const quiet = view();
		quiet.session.inSession = false;
		expect(fightTokens(quiet)).toEqual([]);
	});
});

describe("actionsOnFighter", () => {
	it("joins the disclosed actions with the pairings already made, each once", () => {
		const ids = actionsOnFighter(view(), "137").map((action) => action.actionId);
		expect(ids).toContain("srd/attack/melee");
		expect(ids).toContain("srd/speak-to");
		expect(ids).not.toContain("srd/second-wind");
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("turnBudget", () => {
	const channel = (channelId: string, label: string, remainingMs: number, poolMs = 6000) => ({
		channelId,
		label,
		poolMs,
		remainingMs,
		spentMs: poolMs - remainingMs,
		status: "ok",
		offTurnEligible: false,
	});
	const budget = (channels: ReturnType<typeof channel>[]) =>
		({ channels, unavailable: false }) as unknown as PlayView["economyBudget"];

	// Numbers copied from a live fight (2026-11-14) after one step north.
	it("reads the ruleset's channels and leaves the kernel's doubles out", () => {
		const chips = turnBudget(
			view({
				economyBudget: budget([
					channel("core/action_class/movement", "Move", 6000),
					channel("srd/economy_channel/movement", "Move", 4999),
					channel("srd/economy_channel/primary", "Action", 6000),
					channel("srd/economy_channel/bonus", "Bonus", 0),
				]),
			}),
		);
		expect(chips.map((chip) => `${chip.label}: ${chip.left}`)).toEqual([
			"Move: 83% left",
			"Action: ready",
			"Bonus: spent",
		]);
	});

	it("is empty outside a fight and when the world reports no budget", () => {
		expect(turnBudget(view({ economyBudget: null }))).toEqual([]);
		expect(
			turnBudget(
				view({
					session: {
						inSession: false,
						myTurn: false,
						roster: [],
					} as unknown as PlayView["session"],
					economyBudget: budget([channel("srd/economy_channel/primary", "Action", 6000)]),
				}),
			),
		).toEqual([]);
	});

	// Live fight 2026-11-14: a step took 6000 -> 4999, and with 995 left the
	// world answered "You have no movement left."
	it("counts whole steps of the cost the last step was seen to have", () => {
		const at = (remainingMs: number) =>
			turnBudget(
				view({
					economyBudget: budget([channel("srd/economy_channel/movement", "Move", remainingMs)]),
				}),
				1001,
			);
		expect(at(6000)).toEqual([
			{ id: "srd/economy_channel/movement", label: "Move", state: "ready", left: "5 steps left" },
		]);
		expect(at(1996)[0]).toMatchObject({ state: "partly", left: "1 step left" });
		expect(at(995)[0]).toMatchObject({ state: "spent", left: "0 steps left" });
	});

	it("keeps the share while no step cost has been seen, and never counts steps for another channel", () => {
		const chips = turnBudget(
			view({
				economyBudget: budget([
					channel("srd/economy_channel/movement", "Move", 4999),
					channel("srd/economy_channel/primary", "Action", 3000),
				]),
			}),
			null,
		);
		expect(chips.map((chip) => chip.left)).toEqual(["83% left", "50% left"]);
		const counted = turnBudget(
			view({ economyBudget: budget([channel("srd/economy_channel/primary", "Action", 3000)]) }),
			1001,
		);
		expect(counted[0]?.left).toBe("50% left");
	});
});

describe("observedStepCost", () => {
	const budget = (remainingMs: number | null) =>
		({
			channels: [
				{
					channelId: "srd/economy_channel/movement",
					label: "Move",
					poolMs: 6000,
					remainingMs,
					spentMs: 0,
					status: "ok",
					offTurnEligible: false,
				},
			],
			unavailable: false,
		}) as unknown as PlayView["economyBudget"];

	it("reads the movement left from the ruleset's own channel", () => {
		expect(movementLeft(view({ economyBudget: budget(4999) }))).toBe(4999);
		expect(movementLeft(view({ economyBudget: budget(null) }))).toBeNull();
		expect(movementLeft(view({ economyBudget: { channels: [], unavailable: true } }))).toBeNull();
	});

	it("is what a step took, and nothing when the numbers show no cost", () => {
		expect(observedStepCost(6000, 4999)).toBe(1001);
		expect(observedStepCost(4999, 4999)).toBeNull();
		expect(observedStepCost(995, 6000)).toBeNull();
		expect(observedStepCost(null, 4999)).toBeNull();
	});
});

// Shapes copied from the live cellar fight after the map fix (2026-11-14).
describe("the fight on the grid", () => {
	const onGrid = () =>
		view({
			place: {
				id: "session_grid_7/c_0_4",
				name: "Cell 0,4",
				description: "",
				exits: [
					{
						handle: "s:exit:1",
						rev: "1",
						label: "east",
						to: "c_1_4",
						toNodeId: "session_grid_7/c_1_4",
						toName: "Cell 1,4",
						gates: ["srd/affordance/grid-step"],
					},
					{
						handle: "s:exit:2",
						rev: "1",
						label: "south",
						to: "c_0_3",
						toNodeId: "session_grid_7/c_0_3",
						toName: "Cell 0,3",
						gates: ["srd/affordance/grid-step"],
					},
				],
			},
			sessionTokens: [
				{ nodeId: "session_grid_7/c_0_4", actorId: "168", name: "Borin", isMe: true },
				{ nodeId: "session_grid_7/c_0_3", actorId: "139", name: "Cellar Rat Swarm", isMe: false },
				{ nodeId: "session_grid_7/c_1_1", actorId: "137", name: "Cellar Rat 1", isMe: false },
			],
		} as Partial<PlayView>);

	it("draws every placed fighter, the hero as the hero and a resolved picture where there is one", () => {
		expect(gridTokens(onGrid(), { "137": "/art/giant-rat.webp" })).toEqual([
			{ nodeId: "session_grid_7/c_0_4", actorId: "168", name: "Borin", isMe: true },
			{ nodeId: "session_grid_7/c_0_3", actorId: "139", name: "Cellar Rat Swarm", tone: "foe" },
			{
				nodeId: "session_grid_7/c_1_1",
				actorId: "137",
				name: "Cellar Rat 1",
				tone: "foe",
				image: "/art/giant-rat.webp",
			},
		]);
	});

	it("reads a click on a fighter's cell as that fighter, even when a way out leads there", () => {
		const click = cellClick(onGrid(), "session_grid_7/c_0_3");
		expect(click.kind).toBe("fighter");
		expect(click.kind === "fighter" && click.fighter.id).toBe("139");
		expect(cellClick(onGrid(), "session_grid_7/c_1_1")).toMatchObject({
			kind: "fighter",
			fighter: { id: "137" },
		});
	});

	it("reads a click on a free neighbour cell as a step, and anything else as nothing", () => {
		expect(cellClick(onGrid(), "session_grid_7/c_1_4")).toMatchObject({
			kind: "step",
			exit: { handle: "s:exit:1" },
		});
		expect(cellClick(onGrid(), "session_grid_7/c_0_4")).toEqual({ kind: "nothing" });
		expect(cellClick(onGrid(), "session_grid_7/c_5_5")).toEqual({ kind: "nothing" });
	});
});
