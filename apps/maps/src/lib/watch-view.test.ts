import type { WatchActor, WatchItem } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import {
	carriedFromWatch,
	entityDetailFromWatch,
	occupancyFromWatch,
	occupantsFromWatch,
	offMapNotice,
	retainSelection,
	thingsFromWatch,
} from "./watch-view";

const renn: WatchActor = {
	entityId: "10",
	actorId: "1",
	name: "Renn",
	placeNodeId: "elven_mini/inn/loft",
	faction: "heroes",
	description: "A candidate in the loft.",
	conditions: [{ id: "srd/poisoned", stack_count: 1 }],
	states: [{ state_id: "srd/hp", display_name: "srd/hp", value: "12" }],
	art: null,
};

describe("watch-view", () => {
	it("marks mine occupancy and maps occupants + read-only detail", () => {
		expect(occupancyFromWatch([renn], ["10"])[0]?.mine).toBe(true);
		expect(occupantsFromWatch([renn])[0]).toMatchObject({
			id: "10",
			name: "Renn",
			sceneKind: "actor",
		});
		const detail = entityDetailFromWatch(renn);
		expect(detail?.facts.map((f) => f.label)).toEqual(["Place", "Faction", "Condition"]);
		expect(detail?.facts.find((f) => f.id === "place")?.value).toBe("Inn · Loft");
		expect(detail?.facts.find((f) => f.id === "condition:srd/poisoned")?.value).toBe("poisoned");
	});

	it("drops quest and dm internals from inspect facts", () => {
		const aldwin: WatchActor = {
			...renn,
			name: "Aldwin",
			states: [
				{ state_id: "srd/hp", display_name: "srd/hp", value: "12" },
				{
					state_id: "elven_mini/quest/Q1/accepted",
					display_name: "elven_mini/quest/Q1/accepted",
					value: "0",
				},
				{ state_id: "dm/dialog/open", display_name: "dm/dialog/open", value: "0" },
			],
		};
		expect(entityDetailFromWatch(aldwin)?.facts.map((f) => f.id)).toEqual([
			"place",
			"faction",
			"condition:srd/poisoned",
		]);
	});

	it("pins ground items and skips gear carried by someone", () => {
		expect(thingsFromWatch([])).toEqual([]);
		expect(
			thingsFromWatch([
				{
					entityId: "155",
					name: "Longsword (+1)",
					placeNodeId: "elven_mini/mill/altar",
					holderEntityId: "41",
					holderName: "Sister Maelis",
					slotId: "",
					description: null,
					states: [],
					tags: [],
					art: null,
				},
				{
					entityId: "152",
					name: "Moonpetal",
					placeNodeId: "elven_mini/hamlet/crypt_path",
					holderEntityId: null,
					holderName: null,
					slotId: "",
					description: null,
					states: [],
					tags: [],
					art: null,
				},
			]),
		).toEqual([
			{
				entityId: "152",
				placeNodeId: "elven_mini/hamlet/crypt_path",
				name: "Moonpetal",
			},
		]);
	});
});

describe("offMapNotice", () => {
	it("returns no notice for a drawable node", () => {
		expect(offMapNotice("elven_mini/inn/bar", new Set(["elven_mini/inn/bar"]))).toBeNull();
	});

	it("notices an undrawn graph node with its humanized name", () => {
		const notice = offMapNotice(
			"elven_mini/creation_limbo/station",
			new Set(["elven_mini/inn/bar"]),
		);
		expect(notice).toContain("Creation limbo · Station");
		expect(notice).toContain("not drawn on this map");
	});

	it("returns no notice without a place node", () => {
		expect(offMapNotice("", new Set())).toBeNull();
	});
});

describe("carriedFromWatch", () => {
	const href = (id: string): string => `/w/elven-mini/thing/${id}`;
	const item = (over: Partial<WatchItem> & { entityId: string; name: string }): WatchItem => ({
		placeNodeId: "inn/loft",
		holderEntityId: "1",
		holderName: "Torvald",
		slotId: "",
		description: null,
		states: [],
		tags: [],
		art: null,
		...over,
	});

	it("filters to the holder and stacks same-name items with a stable id", () => {
		const rows = carriedFromWatch(
			[
				item({ entityId: "30", name: "Javelin" }),
				item({ entityId: "24", name: "Javelin" }),
				item({ entityId: "31", name: "Javelin" }),
				item({ entityId: "12", name: "Chain Mail", slotId: "core/torso" }),
				item({
					entityId: "99",
					name: "Lantern",
					placeNodeId: "inn/bar",
					holderEntityId: "2",
					holderName: "Someone else",
				}),
				item({
					entityId: "98",
					name: "Moonpetal",
					placeNodeId: "hamlet/crypt_path",
					holderEntityId: null,
					holderName: null,
				}),
			],
			"1",
			href,
		);
		const javelin = rows.find((row) => row.name === "Javelin");
		expect(javelin).toMatchObject({ id: "24", quantity: 3, href: "/w/elven-mini/thing/24" });
		expect(rows.find((row) => row.name === "Lantern")).toBeUndefined();
		expect(rows.find((row) => row.name === "Moonpetal")).toBeUndefined();
	});

	it("fills the equipped label from the containment slot leaf", () => {
		const rows = carriedFromWatch(
			[item({ entityId: "12", name: "Chain Mail", slotId: "core/main_hand" })],
			"1",
			href,
		);
		expect(rows[0]?.equipped).toBe("main hand");
	});
});

describe("retainSelection", () => {
	it("keeps the selection through the seat-less null emission", () => {
		// SeatBoard's FIRST emission is onMinePlace(null) — view.mine is null
		// until the seat resolves; it must not touch the boot selection.
		expect(retainSelection("2", null, false)).toBe("2");
		expect(retainSelection("2", null, true)).toBe("2");
	});

	it("keeps the selection pending through an unpopulated first frame", () => {
		// SeatBoard's first emission arrives before the overlay top-up.
		expect(retainSelection("2", [], false)).toBe("2");
	});

	it("keeps the selection pending through an empty-actors frame, even populated", () => {
		// The empty-snapshot bootstrap creates a frame with actors === [] before
		// the top-up rows land — that frame cannot vouch either way.
		expect(retainSelection("2", [], true)).toBe("2");
	});

	it("clears the selection when a populated frame lacks the id", () => {
		expect(retainSelection("999", [renn], true)).toBeNull();
	});

	it("keeps the selection when a populated frame carries the id", () => {
		expect(retainSelection("10", [renn], true)).toBe("10");
	});

	it("has nothing to retain without a selection", () => {
		expect(retainSelection(null, [renn], true)).toBeNull();
	});
});
