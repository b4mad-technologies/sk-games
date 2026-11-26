import { describe, expect, it } from "vitest";
import { coversWay, floorSpots, STAGE, waySide, waySpot } from "./layout";

describe("waySpot", () => {
	it("keeps every way on the stage, also several in one direction", () => {
		for (const direction of [
			"north",
			"south",
			"east",
			"west",
			"northeast",
			"southwest",
			"up",
			"down",
		]) {
			const spots = [0, 1, 2].map((before) => waySpot(direction, before, 0));
			for (const spot of spots) {
				expect(spot.x, direction).toBeGreaterThanOrEqual(0);
				expect(spot.x, direction).toBeLessThanOrEqual(STAGE.width);
				expect(spot.y, direction).toBeGreaterThanOrEqual(STAGE.horizon);
				expect(spot.y, direction).toBeLessThanOrEqual(STAGE.height);
			}
			// No two of them on one spot.
			expect(new Set(spots.map((spot) => `${spot.x},${spot.y}`)).size).toBe(3);
		}
	});

	it("hangs a way at the side on that edge", () => {
		expect(waySide(waySpot("east", 0, 0))).toBe("right");
		expect(waySide(waySpot("west", 0, 0))).toBe("left");
		expect(waySide(waySpot("north", 0, 0))).toBe("middle");
	});
});

describe("floorSpots", () => {
	const ids = ["a", "b", "c", "d", "e", "f"];

	it("gives every thing a spot on the floor, the same every time", () => {
		const spots = floorSpots(ids);
		expect([...spots.keys()].sort()).toEqual(ids);
		for (const spot of spots.values()) {
			expect(spot.x).toBeGreaterThan(0);
			expect(spot.x).toBeLessThan(STAGE.width);
			expect(spot.y).toBeGreaterThan(STAGE.horizon);
			expect(spot.y).toBeLessThan(STAGE.height);
		}
		expect(floorSpots([...ids].reverse())).toEqual(spots);
	});

	it("lets no figure stand on the tag of a way out", () => {
		const ways = ["north", "northeast", "east", "up", "northwest"].map((direction) =>
			waySpot(direction, 0, 0),
		);
		// Without the ways somebody stands on a tag: the case is a real one.
		const plain = [...floorSpots(ids).values()];
		expect(plain.some((spot) => ways.some((way) => coversWay(spot, way)))).toBe(true);
		const aside = [...floorSpots(ids, ways).values()];
		for (const spot of aside)
			for (const way of ways) expect(coversWay(spot, way), `${spot.x},${spot.y}`).toBe(false);
	});

	it("lets nobody step aside onto somebody else", () => {
		// Seen live 2026-11-16: four in a room with a way east; the one who
		// made room for its tag stood half on the companion.
		const four = ["137", "14", "216", "6"];
		const spots = [
			...floorSpots(four, [waySpot("east", 0, 0), waySpot("northwest", 0, 0)]).values(),
		];
		for (const [index, a] of spots.entries())
			for (const b of spots.slice(index + 1))
				expect(
					Math.abs(a.x - b.x) >= 44 || Math.abs(a.y - b.y) >= 60,
					`${a.x},${a.y} ${b.x},${b.y}`,
				).toBe(true);
	});

	it("moves nobody when no way is near", () => {
		expect(floorSpots(ids, [waySpot("south", 0, 0)])).toEqual(floorSpots(ids));
	});
});
