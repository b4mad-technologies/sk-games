import { describe, expect, it } from "vitest";
import type { Atlas } from "./atlas";
import { areaMap, CANVAS } from "./map-from-view";

/** A town of three drawn places, a door into a house nobody has drawn. */
function atlas(): Atlas {
	return {
		areas: { "adv/town": { title: "Town" }, "adv/inn": { title: "Inn" } },
		places: {
			"adv/town/square": { name: "Square", area: "adv/town", x: 300, y: 300, visited: true },
			"adv/town/gate": { name: "Gate", area: "adv/town", x: 100, y: 300, visited: false },
			"adv/town/front": { name: "Inn Front", area: "adv/town", x: 400, y: 200, visited: true },
			"adv/town/alley": { name: "Alley", area: "adv/town", visited: false },
			"adv/inn/foyer": { name: "Foyer", area: "adv/inn", visited: false },
		},
		routes: [
			{ from: "adv/town/square", to: "adv/town/gate" },
			{ from: "adv/town/square", to: "adv/town/front" },
			{ from: "adv/town/front", to: "adv/inn/foyer", direction: "north" },
			{ from: "adv/town/square", to: "adv/town/alley", direction: "south" },
		],
	};
}

describe("areaMap", () => {
	const map = areaMap(atlas(), "adv/town/square");
	const town = map.sheets[0];
	const at = (id: string) => town?.places.find((place) => place.id === id);

	it("marks a place no known way leads to from here", () => {
		expect(town?.places.some((place) => place.cut)).toBe(false);
		// A cellar seen once through a hatch, with no way drawn to it.
		const withCellar = atlas();
		withCellar.places["adv/inn/cellar"] = { name: "Cellar", area: "adv/inn", visited: false };
		const inn = areaMap(withCellar, "adv/town/square").sheets.find(
			(sheet) => sheet.title === "Inn",
		);
		expect(inn?.places.find((place) => place.name === "Cellar")?.cut).toBe(true);
		expect(inn?.places.find((place) => place.name === "Foyer")?.cut).toBeUndefined();
	});

	it("gives one sheet per area, the hero's own first", () => {
		expect(map.here).toBe("adv/town/square");
		expect(map.sheets.map((sheet) => sheet.title)).toEqual(["Town", "Inn"]);
		expect(areaMap(atlas(), "adv/inn/foyer").sheets[0]?.title).toBe("Inn");
	});

	it("draws the places where the plate put them, in one scale, inside the canvas", () => {
		const square = at("adv/town/square");
		const gate = at("adv/town/gate");
		const front = at("adv/town/front");
		if (!square || !gate || !front) throw new Error("a drawn place is missing");
		// West of the square, on its height; the inn front north-east of it.
		expect(gate.x).toBeLessThan(square.x);
		expect(gate.y).toBe(square.y);
		expect(front.x).toBeGreaterThan(square.x);
		expect(front.y).toBeLessThan(square.y);
		// 200 units west and 100 east of the square: the distances keep their ratio.
		expect((square.x - gate.x) / (front.x - square.x)).toBeCloseTo(2, 1);
		// The drawn places use the canvas left to right and top to bottom, less
		// a rim for the place no plate drew.
		expect(gate.x).toBe(CANVAS.edgeX + 17);
		expect(front.x).toBe(CANVAS.width - CANVAS.edgeX - 17);
		expect(front.y).toBe(CANVAS.edgeY + 17);
		for (const place of town?.places ?? []) {
			expect(place.x).toBeGreaterThanOrEqual(CANVAS.edgeX);
			expect(place.x).toBeLessThanOrEqual(CANVAS.width - CANVAS.edgeX);
			expect(place.y).toBeGreaterThanOrEqual(CANVAS.edgeY);
			expect(place.y).toBeLessThanOrEqual(CANVAS.height - CANVAS.edgeY);
		}
	});

	it("stands a place no plate drew beside its neighbour, where the way points", () => {
		const square = at("adv/town/square");
		const alley = at("adv/town/alley");
		expect(alley?.x).toBe(square?.x);
		expect(alley?.y).toBeGreaterThan(square?.y ?? Number.NaN);
	});

	it("tells the places the hero stood in from the ones only seen", () => {
		expect(at("adv/town/square")?.known).toBe(true);
		expect(at("adv/town/gate")?.known).toBe(false);
	});

	it("draws the routes of a sheet and hangs a door on a place that leads elsewhere", () => {
		expect(town?.routes).toHaveLength(3);
		expect(at("adv/town/front")?.doors).toEqual([{ sheet: "adv/inn", title: "Inn" }]);
		expect(at("adv/town/square")?.doors).toBeUndefined();
		const inn = map.sheets[1];
		expect(inn?.places).toHaveLength(1);
		expect(inn?.places[0]?.doors).toEqual([{ sheet: "adv/town", title: "Town" }]);
		// Alone on its sheet: in the middle.
		expect(inn?.places[0]?.x).toBe(CANVAS.width / 2);
	});

	it("keeps two tags from covering each other", () => {
		const close = atlas();
		close.places["adv/town/gate"] = {
			name: "Gate",
			area: "adv/town",
			x: 301,
			y: 301,
			visited: false,
		};
		const sheet = areaMap(close, "adv/town/square").sheets[0];
		const square = sheet?.places.find((place) => place.id === "adv/town/square");
		const gate = sheet?.places.find((place) => place.id === "adv/town/gate");
		expect(Math.abs((square?.y ?? 0) - (gate?.y ?? 0))).toBeGreaterThanOrEqual(12);
	});

	it("is empty before the hero has seen a place", () => {
		expect(areaMap({ areas: {}, places: {}, routes: [] }, undefined)).toEqual({
			here: "",
			sheets: [],
		});
	});
});
