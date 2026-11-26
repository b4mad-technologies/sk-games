import { describe, expect, it } from "vitest";
import type { PlayExit, PlayPlace } from "../../../play/src/lib/play-view";
import {
	exitTo,
	gateHint,
	gateName,
	graphFromJson,
	graphToJson,
	mapTargets,
	mergeGraphs,
	plateGraph,
	routeTo,
} from "./travel";

const node = (id: string, label: string) =>
	`<g data-node-id="${id}"><circle class="place" cx="0" cy="0" r="7" /><text class="label">${label}</text></g>`;
const edge = (from: string, to: string) =>
	`<line data-from="${from}" data-to="${to}" class="route" />`;

// loft - room - stairs - cellar, a yard off the room, and a tower nothing leads to.
const plate = `<svg xmlns="http://www.w3.org/2000/svg">${[
	edge("inn/loft", "inn/room"),
	edge("inn/room", "inn/stairs"),
	edge("inn/stairs", "inn/cellar"),
	edge("inn/room", "inn/yard"),
	edge("inn/room", "elsewhere/not-drawn"),
	node("inn/loft", "Guest Loft"),
	node("inn/room", "Common Room"),
	node("inn/stairs", "Stairs"),
	node("inn/cellar", 'Cellar <tspan class="label-floor">(z=-3)</tspan>'),
	node("inn/yard", "Yard"),
	node("inn/tower", "Tower"),
].join("")}</svg>`;

const exit = (toNodeId: string, gates: string[] = []): PlayExit => ({
	handle: `s:exit:${toNodeId}`,
	rev: "1",
	label: "east",
	to: toNodeId,
	toNodeId,
	toName: toNodeId,
	gates,
});

describe("plateGraph", () => {
	it("reads the drawn places with their names, without the floor suffix", () => {
		const graph = plateGraph(plate);
		expect([...graph.names.keys()]).toHaveLength(6);
		expect(graph.names.get("inn/cellar")).toBe("Cellar");
	});

	it("counts a drawn route both ways and ignores a route to a place it does not draw", () => {
		const graph = plateGraph(plate);
		expect(graph.neighbours.get("inn/room")?.sort()).toEqual([
			"inn/loft",
			"inn/stairs",
			"inn/yard",
		]);
		expect(graph.neighbours.get("inn/loft")).toEqual(["inn/room"]);
	});

	it("gives an empty graph for no plate", () => {
		expect(plateGraph(undefined).names.size).toBe(0);
	});
});

describe("routeTo", () => {
	const graph = plateGraph(plate);

	it("lists the places to step through, ending with the goal", () => {
		expect(routeTo(graph, "inn/loft", "inn/cellar")).toEqual([
			"inn/room",
			"inn/stairs",
			"inn/cellar",
		]);
		expect(routeTo(graph, "inn/room", "inn/yard")).toEqual(["inn/yard"]);
	});

	it("is empty for the hero's own place, an unknown place and a place nothing leads to", () => {
		expect(routeTo(graph, "inn/loft", "inn/loft")).toEqual([]);
		expect(routeTo(graph, "inn/loft", "inn/nowhere")).toEqual([]);
		expect(routeTo(graph, "inn/loft", "inn/tower")).toEqual([]);
	});
});

describe("mapTargets", () => {
	it("offers every place a route leads to, nearest first, never the hero's own", () => {
		expect(mapTargets(plateGraph(plate), "inn/loft")).toEqual([
			{ nodeId: "inn/room", name: "Common Room", hops: 1 },
			{ nodeId: "inn/stairs", name: "Stairs", hops: 2 },
			{ nodeId: "inn/yard", name: "Yard", hops: 2 },
			{ nodeId: "inn/cellar", name: "Cellar", hops: 3 },
		]);
	});

	it("offers nothing while the hero's place is unknown or not on the plate", () => {
		expect(mapTargets(plateGraph(plate), undefined)).toEqual([]);
		expect(mapTargets(plateGraph(plate), "other/place")).toEqual([]);
	});
});

describe("exitTo", () => {
	it("finds the offered way out by its destination, not by its label", () => {
		const place = {
			id: "inn/room",
			name: "Common Room",
			description: "",
			exits: [exit("inn/loft"), exit("inn/stairs")],
		} as PlayPlace;
		expect(exitTo(place, "inn/stairs")?.handle).toBe("s:exit:inn/stairs");
		expect(exitTo(place, "inn/cellar")).toBeUndefined();
		expect(exitTo(null, "inn/stairs")).toBeUndefined();
	});
});

describe("gate hints", () => {
	it("names a gate by the last part of its id", () => {
		expect(gateName("adventure/gate/locked-door")).toBe("locked door");
	});

	it("says nothing for an open way and names every gate on a gated one", () => {
		expect(gateHint(exit("inn/yard"))).toBeUndefined();
		expect(gateHint(exit("inn/cellar", ["x/gate/locked-door", "x/gate/guard_watch"]))).toBe(
			"Gated: locked door, guard watch. The world decides when you try.",
		);
	});
});

describe("remembered places", () => {
	const atLoft = plateGraph(
		`<svg xmlns="http://www.w3.org/2000/svg">${edge("inn/loft", "inn/stairs")}${node("inn/loft", "Guest Loft")}${node("inn/stairs", "Stairs")}</svg>`,
	);
	const atRoom = plateGraph(
		`<svg xmlns="http://www.w3.org/2000/svg">${edge("inn/stairs", "inn/room")}${edge("inn/room", "inn/bar")}${node("inn/stairs", "Stairs")}${node("inn/room", "Common Room")}${node("inn/bar", "Bar")}</svg>`,
	);

	it("joins what two plates drew, so a walk back over a place no longer drawn can be planned", () => {
		const known = mergeGraphs(atLoft, atRoom);
		expect(routeTo(atRoom, "inn/room", "inn/loft")).toEqual([]);
		expect(routeTo(known, "inn/room", "inn/loft")).toEqual(["inn/stairs", "inn/loft"]);
		expect(routeTo(known, "inn/bar", "inn/loft")).toEqual(["inn/room", "inn/stairs", "inn/loft"]);
	});

	it("does not change the graphs it joins", () => {
		mergeGraphs(atLoft, atRoom);
		expect(atLoft.names.size).toBe(2);
		expect(atLoft.neighbours.get("inn/stairs")).toEqual(["inn/loft"]);
	});

	it("survives storage and reads anything else as an empty graph", () => {
		const back = graphFromJson(graphToJson(mergeGraphs(atLoft, atRoom)));
		expect(routeTo(back, "inn/room", "inn/loft")).toEqual(["inn/stairs", "inn/loft"]);
		expect(graphFromJson(null).names.size).toBe(0);
		expect(graphFromJson('{"names":3}').names.size).toBe(0);
	});
});
