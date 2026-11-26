import { describe, expect, it } from "vitest";
import { channelLabel, resourcePipsFromBudget } from "./play-economy";
import type { PlayEconomyBudget, PlayEconomyBudgetChannel } from "./play-view";

function channel(overrides: Partial<PlayEconomyBudgetChannel> = {}): PlayEconomyBudgetChannel {
	const channelId = overrides.channelId ?? "srd/economy_channel/primary";
	return {
		channelId,
		label: channelLabel(channelId),
		poolMs: 6000,
		remainingMs: 6000,
		spentMs: 0,
		status: "ok",
		offTurnEligible: false,
		...overrides,
	};
}

function budget(channels: PlayEconomyBudgetChannel[], unavailable = false): PlayEconomyBudget {
	return { channels, unavailable };
}

describe("channelLabel", () => {
	it("maps the four authored SRD channels and a future movement channel to short labels", () => {
		expect(channelLabel("srd/economy_channel/primary")).toBe("Action");
		expect(channelLabel("srd/economy_channel/bonus")).toBe("Bonus");
		expect(channelLabel("srd/economy_channel/reaction")).toBe("Reaction");
		expect(channelLabel("srd/economy_channel/object_interaction")).toBe("Object");
		expect(channelLabel("srd/economy_channel/movement")).toBe("Move");
	});

	it("title-cases an unrecognized channel segment rather than showing the raw id", () => {
		expect(channelLabel("srd/economy_channel/spell_slot_1")).toBe("Spell Slot 1");
		expect(channelLabel("legacy_gate")).toBe("Legacy Gate");
	});
});

describe("resourcePipsFromBudget", () => {
	it("orders pips primary, bonus, reaction, object_interaction, then others by id", () => {
		const pips = resourcePipsFromBudget(
			budget([
				channel({ channelId: "srd/economy_channel/object_interaction" }),
				channel({ channelId: "srd/economy_channel/reaction" }),
				channel({ channelId: "zzz/economy_channel/aux" }),
				channel({ channelId: "srd/economy_channel/bonus" }),
				channel({ channelId: "srd/economy_channel/primary" }),
				channel({ channelId: "aaa/economy_channel/aux" }),
			]),
		);
		expect(pips.map((pip) => pip.id)).toEqual([
			"srd/economy_channel/primary",
			"srd/economy_channel/bonus",
			"srd/economy_channel/reaction",
			"srd/economy_channel/object_interaction",
			"aaa/economy_channel/aux",
			"zzz/economy_channel/aux",
		]);
	});

	it("labels each pip from its channel id's last segment", () => {
		const pips = resourcePipsFromBudget(
			budget([
				channel({ channelId: "srd/economy_channel/primary" }),
				channel({ channelId: "srd/economy_channel/bonus" }),
			]),
		);
		expect(pips.map((pip) => pip.label)).toEqual(["Action", "Bonus"]);
	});

	it("reads available (full), partial and spent (empty) fractions from remaining/pool", () => {
		const pips = resourcePipsFromBudget(
			budget([
				channel({ channelId: "srd/economy_channel/primary", poolMs: 6000, remainingMs: 6000 }),
				channel({
					channelId: "srd/economy_channel/movement",
					poolMs: 6000,
					remainingMs: 2400,
				}),
				channel({ channelId: "srd/economy_channel/bonus", poolMs: 6000, remainingMs: 0 }),
			]),
		);
		expect(pips).toEqual([
			expect.objectContaining({
				id: "srd/economy_channel/primary",
				state: "available",
				fraction: 1,
			}),
			expect.objectContaining({
				id: "srd/economy_channel/bonus",
				state: "spent",
				fraction: 0,
			}),
			expect.objectContaining({
				id: "srd/economy_channel/movement",
				state: "partial",
				fraction: 0.4,
			}),
		]);
	});

	it("renders a pending_boundary channel as pending with no fraction", () => {
		const pips = resourcePipsFromBudget(
			budget([
				channel({
					channelId: "srd/economy_channel/reaction",
					status: "pending_boundary",
					poolMs: null,
					remainingMs: null,
				}),
			]),
		);
		expect(pips).toEqual([
			{ id: "srd/economy_channel/reaction", label: "Reaction", state: "pending", fraction: null },
		]);
	});

	it("renders an unknown_channel row as unknown with no fraction", () => {
		const pips = resourcePipsFromBudget(
			budget([
				channel({
					channelId: "srd/economy_channel/object_interaction",
					status: "unknown_channel",
					poolMs: null,
					remainingMs: null,
				}),
			]),
		);
		expect(pips).toEqual([
			{
				id: "srd/economy_channel/object_interaction",
				label: "Object",
				state: "unknown",
				fraction: null,
			},
		]);
	});

	it("answers no pips for a null, undefined or unavailable budget", () => {
		expect(resourcePipsFromBudget(null)).toEqual([]);
		expect(resourcePipsFromBudget(undefined)).toEqual([]);
		expect(resourcePipsFromBudget(budget([channel()], true))).toEqual([]);
	});
});
