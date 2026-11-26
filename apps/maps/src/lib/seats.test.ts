import { describe, expect, it } from "vitest";

import { annotateSeats, heroesFromWorld, projectPlayErrors, seatBoardView } from "./seats";

const renn = { actor_id: "1", name: "Renn", embodied: true, claimed: true };
const free = { actor_id: "2", name: "Candidate", embodied: false, claimed: false };

describe("seat annotation", () => {
	it("marks only the caller's visible bindings as mine", () => {
		const seats = annotateSeats([renn, free], ["1"]);
		expect(seats[0]).toMatchObject({ name: "Renn", mine: true, claimed: true });
		expect(seats[1]).toMatchObject({ name: "Candidate", mine: false, claimed: false });
	});

	it("aggregates my heroes from one world", () => {
		const seats = annotateSeats([renn, free], new Set(["1"]));
		expect(heroesFromWorld("demo1", "Demo world 1", seats)).toEqual([
			{ worldSlug: "demo1", worldName: "Demo world 1", actor_id: "1", name: "Renn" },
		]);
	});
});

describe("seat board view", () => {
	const world = { slug: "demo1", name: "Demo world 1" };
	const handle = {
		seats: () => annotateSeats([{ ...renn, entity_id: "77" }, free], ["1"]),
		actorPlaces: () => [{ entityId: "77", placeNodeId: "demo/inn/foyer" }],
	};

	it("projects heroes, seats and my map position from a connected world", () => {
		const view = seatBoardView([world], new Map([["demo1", handle]]), "demo1");
		expect(view.heroes.map((h) => h.name)).toEqual(["Renn"]);
		expect(view.seats.map((s) => s.name)).toEqual(["Renn", "Candidate"]);
		expect(view.mine).toEqual({
			slug: "demo1",
			places: [{ entityId: "77", placeNodeId: "demo/inn/foyer" }],
			mineEntityIds: ["77"],
		});
	});

	it("keeps heroes but reports nothing for the map while the selected world is not connected", () => {
		const view = seatBoardView([world], new Map([["demo1", handle]]), "demo2");
		expect(view.heroes).toHaveLength(1);
		expect(view.seats).toEqual([]);
		expect(view.mine).toBeNull();
	});
});

describe("projectPlayErrors", () => {
	const status = new Map([
		["elven-mini-1", "Schema fetch failed: 404"],
		["srd-cc", "Please log in again."],
	]);

	it("shows only the selected world's error in the section", () => {
		expect(projectPlayErrors(status, "elven-mini-1")).toEqual({
			selected: "Schema fetch failed: 404",
			othersCount: 1,
			othersTitle: "srd-cc: Please log in again.",
		});
	});

	it("lists other worlds in the unavailable note title", () => {
		const note = projectPlayErrors(status, "phandelver");
		expect(note.selected).toBeNull();
		expect(note.othersCount).toBe(2);
		expect(note.othersTitle).toContain("elven-mini-1: Schema fetch failed: 404");
		expect(note.othersTitle).toContain("srd-cc: Please log in again.");
	});

	it("is empty when no world has an error", () => {
		expect(projectPlayErrors(new Map(), "elven-mini-1")).toEqual({
			selected: null,
			othersCount: 0,
			othersTitle: "",
		});
	});
});
