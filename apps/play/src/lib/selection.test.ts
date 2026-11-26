import { describe, expect, it } from "vitest";
import { sampleView } from "../test/sample-view";
import type { PlayAction, PlaySessionToken } from "./play-view";
import {
	type Selection,
	type SelectionContext,
	selectionAfterArrival,
	selectionRing,
	selectionRowFromView,
	stepSelection,
} from "./selection";

function action(overrides: Partial<PlayAction> & Pick<PlayAction, "id" | "label">): PlayAction {
	return {
		verb: "manipulate",
		descriptor: "srd/generic",
		targetName: "",
		targetRef: "",
		acceptsUtterance: false,
		...overrides,
	};
}

function token(
	overrides: Partial<PlaySessionToken> & Pick<PlaySessionToken, "nodeId" | "actorId" | "name">,
): PlaySessionToken {
	return { isMe: false, ...overrides };
}

/** A context whose every read is a stub the test controls directly — the
 * pure function under test never reaches into `PlayView` itself except for
 * `hero.actorId`, so this stays deliberately independent of any live fixture. */
function makeCtx(overrides: Partial<SelectionContext> = {}): SelectionContext {
	return {
		knownNodeIds: new Set(["own", "free", "foe-cell"]),
		ownNodeId: "own",
		tokensByNode: new Map(),
		exitTo: () => null,
		actionsForActor: () => [],
		selfActions: () => [],
		isReadableOccupant: () => false,
		isReadablePlace: () => false,
		actorExists: () => true,
		nameForActor: () => null,
		nodeOfActor: () => null,
		...overrides,
	};
}

const view = sampleView;

describe("selectionRowFromView", () => {
	it.each([
		undefined,
		"destination",
	])("selects an exit by its exact handle with destination %s", (toNodeId) => {
		const place = view.place;
		if (place == null) throw new Error("sample view needs a place");
		const exit = place.exits[0];
		if (exit === undefined) throw new Error("sample place needs an exit");
		const selectedExit = { ...exit, toNodeId };
		const selected: Selection = { kind: "exit", handle: selectedExit.handle };
		const current = { ...view, place: { ...place, exits: [selectedExit] } };
		expect(selectionRowFromView(current, selected, makeCtx())?.subjects[0]?.primary).toEqual([
			{ id: `move:${selectedExit.handle}`, label: `Travel to ${selectedExit.toName}` },
		]);
		expect(
			selectionRowFromView(
				{ ...current, place: { ...current.place, exits: [] } },
				selected,
				makeCtx(),
			),
		).toBeNull();
	});
	it("keeps inventory selection identity separate from its authorized entity offers", () => {
		const item = view.pack[0];
		if (item === undefined) throw new Error("sample view needs a pack item");
		const own = action({ id: "h:own", label: "Polish", targetRef: "entity:42" });
		const unrelated = action({ id: "h:other", label: "Attack", targetRef: "entity:99" });
		const selected: Selection = { kind: "item", itemId: item.id };
		const current = {
			...view,
			actions: [own, unrelated],
			itemDetail: {
				id: item.id,
				entityId: "42",
				kind: "item",
				slot: null,
				facts: [],
				verbs: [],
			},
		};
		expect(selectionRowFromView(current, selected, makeCtx())?.subjects[0]?.itemActions).toEqual([
			own,
		]);
		expect(
			selectionRowFromView(
				{ ...current, itemDetail: { ...current.itemDetail, id: "stale" } },
				selected,
				makeCtx(),
			),
		).toMatchObject({ note: "Loading actions on this item…", subjects: [{ itemActions: [] }] });
		expect(selectionRowFromView({ ...current, pack: [] }, selected, makeCtx())).toBeNull();
	});
	it("returns null for no selection", () => {
		expect(selectionRowFromView(view, null, makeCtx())).toBeNull();
	});

	it("goes stale (null) when the cell no longer exists in the current context", () => {
		const selection: Selection = { kind: "cell", nodeId: "gone" };
		expect(selectionRowFromView(view, selection, makeCtx())).toBeNull();
	});

	it("one subject per occupant token, never collapsed when several share a cell", () => {
		const ctx = makeCtx({
			tokensByNode: new Map([
				[
					"foe-cell",
					[
						token({ nodeId: "foe-cell", actorId: "rat-1", name: "Cellar Rat 1" }),
						token({ nodeId: "foe-cell", actorId: "rat-2", name: "Cellar Rat 2" }),
					],
				],
			]),
			actionsForActor: (id) =>
				id === "rat-1" ? [action({ id: "act:swing", label: "Swing" })] : [],
			isReadableOccupant: (id) => id === "rat-1",
		});
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "foe-cell" }, ctx);
		expect(row?.subjects).toHaveLength(2);
		expect(row?.subjects[0]).toMatchObject({
			id: "rat-1",
			name: "Cellar Rat 1",
			infoRef: "occupant:rat-1",
		});
		expect(row?.subjects[0]?.primary).toEqual([{ id: "act:swing", label: "Swing" }]);
		expect(row?.subjects[1]).toMatchObject({ id: "rat-2", name: "Cellar Rat 2" });
		expect(row?.subjects[1]?.infoRef).toBeUndefined();
		expect(row?.note).toBeUndefined();
	});

	it("names the player's own token 'You' and draws its actions from selfActions, not actionsForActor", () => {
		const ctx = makeCtx({
			tokensByNode: new Map([
				["own", [token({ nodeId: "own", actorId: "7", name: "Renn the Roadwarden", isMe: true })]],
			]),
			selfActions: () => [action({ id: "act:dodge", label: "Dodge" })],
			actionsForActor: () => [action({ id: "act:wrong", label: "Should not appear" })],
		});
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "own" }, ctx);
		expect(row?.subjects).toEqual([
			{ id: "7", name: "You", primary: [{ id: "act:dodge", label: "Dodge" }], more: [] },
		]);
	});

	it("a free cell offering a step becomes 'Move here', carrying the exit handle", () => {
		const ctx = makeCtx({
			exitTo: (nodeId) =>
				nodeId === "free" ? { handle: "s:exit:1", label: "east", name: "Cell 2,1" } : null,
		});
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "free" }, ctx);
		expect(row?.subtitle).toBe("east");
		expect(row?.subjects).toEqual([
			{
				id: "exit:s:exit:1",
				name: "Free cell",
				primary: [{ id: "move:s:exit:1", label: "Move here" }],
				more: [],
			},
		]);
	});

	it("an occupied or free cell offering nothing gets an honest note", () => {
		const ctx = makeCtx({
			tokensByNode: new Map([
				["foe-cell", [token({ nodeId: "foe-cell", actorId: "rat-1", name: "Cellar Rat 1" })]],
			]),
		});
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "foe-cell" }, ctx);
		expect(row?.note).toBe("Nothing is offered from here.");

		const freeRow = selectionRowFromView(view, { kind: "cell", nodeId: "free" }, makeCtx());
		expect(freeRow?.note).toBe("Nothing is offered from here.");
	});

	it("own cell with no token still folds into 'You'", () => {
		const ctx = makeCtx({ selfActions: () => [action({ id: "act:dodge", label: "Dodge" })] });
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "own" }, ctx);
		expect(row?.subjects).toEqual([
			{ id: "self", name: "You", primary: [{ id: "act:dodge", label: "Dodge" }], more: [] },
		]);
	});

	it("classifies actions: generic checks always fold into one 'Checks' submenu, the first three others lead", () => {
		const actions = [
			action({ id: "a1", label: "Strike", descriptor: "srd/attack/melee" }),
			action({ id: "a2", label: "Shove", descriptor: "srd/attack/melee" }),
			action({ id: "a3", label: "Grapple", descriptor: "srd/attack/melee" }),
			action({ id: "a4", label: "Trip", descriptor: "srd/attack/melee" }),
			action({ id: "c1", label: "Check: Athletics", descriptor: "srd/check/athletics" }),
			action({ id: "c2", label: "Check: Acrobatics", descriptor: "srd/check/acrobatics" }),
		];
		const ctx = makeCtx({
			tokensByNode: new Map([
				["foe-cell", [token({ nodeId: "foe-cell", actorId: "rat-1", name: "Cellar Rat 1" })]],
			]),
			actionsForActor: () => actions,
		});
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "foe-cell" }, ctx);
		const subject = row?.subjects[0];
		expect(subject?.primary.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
		expect(subject?.more).toEqual([
			{ id: "a4", label: "Trip" },
			{
				id: "checks",
				label: "Checks",
				submenu: [
					{ id: "c1", label: "Check: Athletics" },
					{ id: "c2", label: "Check: Acrobatics" },
				],
			},
		]);
	});

	it("carries the world's own full label as accessibleLabel when it differs from the stripped verb — two subjects can otherwise offer an identical visible pill label", () => {
		const ctx = makeCtx({
			tokensByNode: new Map([
				["foe-cell", [token({ nodeId: "foe-cell", actorId: "rat-1", name: "Cellar Rat 1" })]],
			]),
			actionsForActor: () => [
				action({
					id: "h:melee",
					label: "Melee Attack — Cellar Rat 1",
					targetName: "Cellar Rat 1",
					targetRef: "entity:rat-1",
				}),
			],
		});
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "foe-cell" }, ctx);
		expect(row?.subjects[0]?.primary).toEqual([
			{ id: "h:melee", label: "Melee Attack", accessibleLabel: "Melee Attack — Cellar Rat 1" },
		]);
	});

	it("omits accessibleLabel when the visible label is already unambiguous (an untargeted action)", () => {
		const ctx = makeCtx({ selfActions: () => [action({ id: "act:dodge", label: "Dodge" })] });
		const row = selectionRowFromView(view, { kind: "cell", nodeId: "own" }, ctx);
		expect(row?.subjects[0]?.primary[0]).toEqual({ id: "act:dodge", label: "Dodge" });
		expect(row?.subjects[0]?.primary[0]).not.toHaveProperty("accessibleLabel");
	});

	it("an actor selection resolves its cell and delegates to the same cell row", () => {
		const ctx = makeCtx({
			nodeOfActor: (id) => (id === "rat-1" ? "foe-cell" : null),
			tokensByNode: new Map([
				["foe-cell", [token({ nodeId: "foe-cell", actorId: "rat-1", name: "Cellar Rat 1" })]],
			]),
			actionsForActor: () => [action({ id: "act:swing", label: "Swing" })],
		});
		const cellRow = selectionRowFromView(view, { kind: "cell", nodeId: "foe-cell" }, ctx);
		const actorRow = selectionRowFromView(view, { kind: "actor", actorId: "rat-1" }, ctx);
		expect(actorRow).toEqual(cellRow);
	});

	it("an actor with no token this map still gets a direct subject", () => {
		const ctx = makeCtx({
			nodeOfActor: () => null,
			nameForActor: (id) => (id === "npc-9" ? "Aldwin" : null),
			actionsForActor: (id) => (id === "npc-9" ? [action({ id: "act:talk", label: "Talk" })] : []),
			isReadableOccupant: (id) => id === "npc-9",
		});
		const row = selectionRowFromView(view, { kind: "actor", actorId: "npc-9" }, ctx);
		expect(row?.subjects).toEqual([
			{
				id: "npc-9",
				name: "Aldwin",
				infoRef: "occupant:npc-9",
				primary: [{ id: "act:talk", label: "Talk" }],
				more: [],
			},
		]);
	});

	it("an actor selection goes stale once the actor no longer exists", () => {
		const ctx = makeCtx({ actorExists: () => false });
		expect(selectionRowFromView(view, { kind: "actor", actorId: "gone" }, ctx)).toBeNull();
	});

	it("place selection: the player's own place says so instead of offering to travel to itself", () => {
		const row = selectionRowFromView(view, { kind: "place", nodeId: "own" }, makeCtx());
		expect(row?.note).toBe("You are here.");
	});

	it("place selection: a neighbour with an offered step becomes 'Travel to <place>'", () => {
		const ctx = makeCtx({
			exitTo: (nodeId) =>
				nodeId === "free" ? { handle: "s:exit:north", label: "north", name: "North Road" } : null,
		});
		const row = selectionRowFromView(view, { kind: "place", nodeId: "free" }, ctx);
		expect(row?.subjects).toEqual([
			{
				id: "place:free",
				name: "North Road",
				primary: [{ id: "move:s:exit:north", label: "Travel to North Road" }],
				more: [],
			},
		]);
	});

	it("place selection: a neighbour with no offered step gets an honest refusal note", () => {
		const row = selectionRowFromView(view, { kind: "place", nodeId: "free" }, makeCtx());
		expect(row?.note).toBe("No direct move to this place is currently offered.");
	});
});

describe("selectionRing / stepSelection (axiom A8)", () => {
	const ring = selectionRing({
		actorIds: ["7", "3"],
		exits: [
			{ handle: "s:exit:3", toNodeId: "cellar", direction: "down" },
			{ handle: "s:exit:1", toNodeId: "road", direction: "West" },
			{ handle: "s:exit:9", toNodeId: "loft", direction: "ladder" },
			{ handle: "s:exit:2", toNodeId: "yard", direction: "north" },
		],
	});

	it("orders actors as given, then exits clockwise from north, unknown directions last", () => {
		expect(ring).toEqual([
			{ kind: "actor", actorId: "7" },
			{ kind: "actor", actorId: "3" },
			{ kind: "place", nodeId: "yard", exitHandle: "s:exit:2" },
			{ kind: "place", nodeId: "road", exitHandle: "s:exit:1" },
			{ kind: "place", nodeId: "cellar", exitHandle: "s:exit:3" },
			{ kind: "place", nodeId: "loft", exitHandle: "s:exit:9" },
		]);
	});

	it("starts at the first entry going forward and the last going back", () => {
		expect(stepSelection(ring, null, 1)).toEqual(ring[0]);
		expect(stepSelection(ring, null, -1)).toEqual(ring[ring.length - 1]);
	});

	it("wraps in both directions", () => {
		expect(stepSelection(ring, ring[ring.length - 1] ?? null, 1)).toEqual(ring[0]);
		expect(stepSelection(ring, ring[0] ?? null, -1)).toEqual(ring[ring.length - 1]);
	});

	it("enters the ring from a selection it does not hold (a grid cell)", () => {
		expect(stepSelection(ring, { kind: "cell", nodeId: "c_1_1" }, 1)).toEqual(ring[0]);
	});

	it("leaves the selection alone when there is nothing to walk", () => {
		expect(stepSelection([], null, 1)).toBeNull();
	});
});

describe("selectionAfterArrival (sk-jay0.1.8.99)", () => {
	it("drops a place selection whose node became the hero's current place", () => {
		expect(
			selectionAfterArrival(
				{ kind: "place", nodeId: "inn/stairs", exitHandle: "s:exit:54" },
				"inn/stairs",
			),
		).toBeNull();
	});

	it("keeps a place selection that names another place", () => {
		const selection: Selection = { kind: "place", nodeId: "inn/loft" };
		expect(selectionAfterArrival(selection, "inn/stairs")).toBe(selection);
	});

	it("keeps every other kind of selection, even one whose id equals the place id", () => {
		const cell: Selection = { kind: "cell", nodeId: "inn/stairs" };
		const actor: Selection = { kind: "actor", actorId: "4" };
		expect(selectionAfterArrival(cell, "inn/stairs")).toBe(cell);
		expect(selectionAfterArrival(actor, "inn/stairs")).toBe(actor);
		expect(selectionAfterArrival(null, "inn/stairs")).toBeNull();
	});

	it("keeps the selection when no place is known", () => {
		const selection: Selection = { kind: "place", nodeId: "inn/stairs" };
		expect(selectionAfterArrival(selection, null)).toBe(selection);
	});
});
