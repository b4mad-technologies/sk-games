import { describe, expect, it } from "vitest";
import inventoryFixture from "./fixtures/inventory.json";
import mapFixture from "./fixtures/map.json";
import orientFixture from "./fixtures/orient.json";
import sceneFixture from "./fixtures/scene.json";
import selfSummaryFixture from "./fixtures/self_summary.json";
import { applyToolEvent, emptyTiles, mapHero, mapPack, mapPlaceMap } from "./mapper.ts";

describe("mapHero", () => {
	it("maps self_summary vitals and conditions", () => {
		const hero = mapHero(selfSummaryFixture);
		expect(hero?.self).toEqual({
			name: "Regdar",
			hp: 12,
			ac: 16,
			level: 0,
			xp: 0,
			conditions: ["srd/poisoned"],
		});
	});

	it("returns undefined for garbage", () => {
		expect(mapHero({ nope: true })).toBeUndefined();
	});
});

describe("mapPack", () => {
	it("flattens nested inventory with a depth marker", () => {
		const pack = mapPack(inventoryFixture);
		expect(pack?.items).toEqual([
			{ id: "i:1", name: "Longsword", detail: "item · main_hand" },
			{ id: "i:2", name: "Field kit", detail: "item" },
			{ id: "i:3", name: "· Torch ×3", detail: "item" },
		]);
	});
});

describe("mapPlaceMap", () => {
	it("uses graph as placeName and keeps sanitised svg aside", () => {
		const mapped = mapPlaceMap(mapFixture);
		expect(mapped?.map.frame.placeName).toBe("Inn");
		expect(mapped?.map.frame.mode).toBe("full");
		expect(mapped?.mapSvg).toContain("<svg");
	});
});

describe("applyToolEvent", () => {
	it("uses orient as the primary source for Hero, Scene, Occupants, Pack", () => {
		const next = applyToolEvent(emptyTiles(), {
			tool: "spellkave_orient",
			args: {},
			result: orientFixture,
			at: 1_700_000_000_000,
		});
		expect(next.hero?.self.name).toBe("Regdar");
		expect(next.hero?.self.hp).toBe(12);
		expect(next.scene?.place.name).toBe("Loft");
		expect(next.scene?.place.exits[0]).toEqual({
			id: "s:exit:1",
			label: "Stairs",
			direction: "north",
		});
		expect(next.occupants?.occupants).toEqual([
			{ id: "s:entity:8", name: "Straw pallet", kind: "thing", note: "Straw pallet" },
		]);
		expect(next.pack?.items[0]?.name).toBe("Clothes");
		expect(next.seen.Hero?.tool).toBe("spellkave_orient");
	});

	it("lets dedicated tools overwrite their tile", () => {
		const afterOrient = applyToolEvent(emptyTiles(), {
			tool: "spellkave_orient",
			args: {},
			result: { structuredContent: orientFixture, content: [] },
			at: 10,
		});
		const afterScene = applyToolEvent(afterOrient, {
			tool: "spellkave_scene",
			args: {},
			result: sceneFixture,
			at: 20,
		});
		expect(afterScene.scene?.place.name).toBe("Common room");
		expect(afterScene.scene?.place.exits.map((exit) => exit.direction)).toEqual([
			"west",
			"southeast",
		]);
		expect(afterScene.occupants?.occupants.map((row) => row.kind)).toEqual(["person", "thing"]);
		expect(afterScene.occupants?.occupants.some((row) => row.name === "footsteps")).toBe(false);
		expect(afterScene.hero?.self.name).toBe("Regdar");
		expect(afterScene.seen.Scene?.tool).toBe("spellkave_scene");
		expect(afterScene.seen.Hero?.tool).toBe("spellkave_orient");
	});

	it("does not throw or wipe tiles on unknown payloads", () => {
		const prev = applyToolEvent(emptyTiles(), {
			tool: "spellkave_self_summary",
			args: {},
			result: selfSummaryFixture,
			at: 1,
		});
		const next = applyToolEvent(prev, {
			tool: "spellkave_self_summary",
			args: {},
			result: { content: [{ type: "text", text: "not-json" }] },
			at: 2,
		});
		expect(next.hero?.self.name).toBe("Regdar");
	});

	it("ignores a reaction-shaped orient", () => {
		const next = applyToolEvent(emptyTiles(), {
			tool: "spellkave_orient",
			args: {},
			result: {
				actorId: "hero-1",
				view: { kind: "reaction", actorId: "hero-1", pending: {}, events: [] },
				inventory: inventoryFixture,
			},
			at: 1,
		});
		expect(next.hero).toBeUndefined();
		expect(next.pack).toBeUndefined();
	});
});
