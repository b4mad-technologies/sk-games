import { describe, expect, it } from "vitest";
import { exitsOnWalls, spreadOnStage, unitHash } from "./placement";

describe("spreadOnStage", () => {
	const items = ["b", "a", "d", "c", "e", "f", "g"].map((id) => ({ id }));

	it("gives the same ids the same spots, whatever order they arrive in", () => {
		const first = spreadOnStage(items);
		const second = spreadOnStage([...items].reverse());
		expect(second).toEqual(first);
	});

	it("keeps every token inside the stage", () => {
		for (const spot of spreadOnStage(items)) {
			expect(spot.x).toBeGreaterThan(0);
			expect(spot.x).toBeLessThan(100);
			expect(spot.y).toBeGreaterThan(0);
			expect(spot.y).toBeLessThan(100);
		}
	});

	it("never puts two tokens on the same point", () => {
		const points = spreadOnStage(items).map((spot) => `${spot.x.toFixed(3)},${spot.y.toFixed(3)}`);
		expect(new Set(points).size).toBe(items.length);
	});

	it("handles an empty place", () => {
		expect(spreadOnStage([])).toEqual([]);
	});
});

describe("exitsOnWalls", () => {
	it("puts a compass exit on its wall", () => {
		const [north, east] = exitsOnWalls([{ label: "north" }, { label: "East" }]);
		expect(north).toMatchObject({ known: true, x: 50, y: 6 });
		expect(east).toMatchObject({ known: true, x: 94, y: 50 });
	});

	it("fans out two exits on the same wall", () => {
		const [first, second] = exitsOnWalls([{ label: "north" }, { label: "north" }]);
		expect(first?.x).not.toBe(second?.x);
		expect(first?.y).toBe(second?.y);
	});

	it("fans out corner and side-wall exits downwards", () => {
		const [first, second] = exitsOnWalls([{ label: "northwest" }, { label: "northwest" }]);
		expect(first?.x).toBe(second?.x);
		expect(first?.y).not.toBe(second?.y);
	});

	it("marks a label that is no compass word", () => {
		const [stairs] = exitsOnWalls([{ label: "up the stairs" }]);
		expect(stairs).toMatchObject({ known: false, y: 94 });
	});
});

describe("unitHash", () => {
	it("is stable and within 0..1", () => {
		expect(unitHash("entity:158")).toBe(unitHash("entity:158"));
		expect(unitHash("entity:158")).toBeGreaterThanOrEqual(0);
		expect(unitHash("entity:158")).toBeLessThanOrEqual(1);
	});
});
