// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { routeTo } from "../../lib/travel";
import {
	areaOf,
	atlasFromJson,
	atlasGraph,
	emptyAtlas,
	readPlate,
	withPlace,
	withPlate,
} from "./atlas";

type Node = [id: string, name: string, x: number, y: number];

/** A map plate as the world draws one: a title, lines, a dot and a label per place. */
function plate(title: string, nodes: Node[], edges: [string, string][]): string {
	const lines = edges.map(
		([from, to]) => `<line data-from="${from}" data-to="${to}" class="route" />`,
	);
	const groups = nodes.map(
		([id, name, x, y]) =>
			`<g data-node-id="${id}"><circle cx="${x}" cy="${y}" r="30" class="place-extent" /><circle cx="${x}" cy="${y}" r="7" class="place" /><text x="${x}" y="${y + 20}" class="label">${name}<tspan> (z=0)</tspan></text></g>`,
	);
	return [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 700">',
		`<text class="title-main" x="16" y="22">${title}</text>`,
		...lines,
		...groups,
		"</svg>",
	].join("\n");
}

const SQUARE = "adv/town/square";
const GATE = "adv/town/gate";
const WELL = "adv/town/well";
const FRONT = "adv/town/inn_front";
const FOYER = "adv/inn/foyer";

// From the square the world draws the whole town around it.
const fromSquare = plate(
	"Town",
	[
		[SQUARE, "Square", 300, 300],
		[GATE, "Gate", 100, 300],
		[WELL, "Well", 300, 500],
		[FRONT, "Inn Front", 400, 200],
	],
	[
		[SQUARE, GATE],
		[SQUARE, WELL],
		[SQUARE, FRONT],
	],
);
// From the inn front it draws two places, twice as large and somewhere else.
const fromFront = plate(
	"Town",
	[
		[FRONT, "Inn Front", 700, 100],
		[SQUARE, "Square", 500, 300],
	],
	[[SQUARE, FRONT]],
);

describe("readPlate", () => {
	it("reads the area, its title, the places with their spots and the routes", () => {
		const read = readPlate(fromSquare);
		expect(read?.area).toBe("adv/town");
		expect(read?.title).toBe("Town");
		expect(read?.nodes.find((node) => node.id === WELL)).toEqual({
			id: WELL,
			name: "Well",
			x: 300,
			y: 500,
		});
		expect(read?.edges).toHaveLength(3);
	});

	it("is null for no plate and for a plate without a place", () => {
		expect(readPlate(null)).toBeNull();
		expect(readPlate("<svg xmlns='http://www.w3.org/2000/svg'></svg>")).toBeNull();
		expect(areaOf("lonely")).toBe("");
	});
});

describe("the atlas", () => {
	const first = readPlate(fromSquare);
	const second = readPlate(fromFront);
	if (!first || !second) throw new Error("the test plates must be readable");

	it("keeps the places an earlier plate drew when a later one draws fewer", () => {
		const atlas = withPlate(withPlate(emptyAtlas(), first, SQUARE), second, FRONT);
		expect(Object.keys(atlas.places).sort()).toEqual([GATE, FRONT, SQUARE, WELL].sort());
		expect(atlas.areas["adv/town"]?.title).toBe("Town");
	});

	it("lays a later plate over the places it shares, so nothing jumps", () => {
		const before = withPlate(emptyAtlas(), first, SQUARE);
		const after = withPlate(before, second, FRONT);
		for (const id of [SQUARE, FRONT, GATE, WELL]) {
			expect(after.places[id]?.x).toBeCloseTo(before.places[id]?.x ?? Number.NaN, 5);
			expect(after.places[id]?.y).toBeCloseTo(before.places[id]?.y ?? Number.NaN, 5);
		}
	});

	it("puts a place only the later plate draws into the frame of the first", () => {
		const shed = "adv/town/shed";
		const wider = readPlate(
			plate(
				"Town",
				[
					[FRONT, "Inn Front", 700, 100],
					[SQUARE, "Square", 500, 300],
					[shed, "Shed", 900, 100],
				],
				[[FRONT, shed]],
			),
		);
		if (!wider) throw new Error("unreadable");
		const atlas = withPlate(withPlate(emptyAtlas(), first, SQUARE), wider, FRONT);
		// The later plate is twice as large: 200 of its units east are 100 here.
		expect(atlas.places[shed]?.x).toBeCloseTo(500, 5);
		expect(atlas.places[shed]?.y).toBeCloseTo(200, 5);
	});

	it("marks where the hero stood, and takes a place beyond the frontier as visited", () => {
		const atlas = withPlate(emptyAtlas(), first, SQUARE, new Set([GATE, FRONT]));
		expect(atlas.places[SQUARE]?.visited).toBe(true);
		expect(atlas.places[GATE]?.visited).toBe(false);
		// Neither here nor a neighbour by a way out: the world drew it from memory.
		expect(atlas.places[WELL]?.visited).toBe(true);
	});

	it("joins two areas by a way out and routes across the door", () => {
		let atlas = withPlate(emptyAtlas(), first, SQUARE);
		atlas = withPlace(atlas, {
			id: FRONT,
			name: "Inn Front",
			exits: [
				{ toNodeId: FOYER, toName: "Foyer", label: "north" },
				{ toNodeId: SQUARE, toName: "Square", label: "southwest" },
			],
		});
		expect(atlas.places[FOYER]).toEqual({ name: "Foyer", area: "adv/inn", visited: false });
		expect(atlas.areas["adv/inn"]?.title).toBe("Inn");
		expect(atlas.places[FRONT]?.visited).toBe(true);
		expect(routeTo(atlasGraph(atlas), WELL, FOYER)).toEqual([SQUARE, FRONT, FOYER]);
		// The plate's line had no direction; the way out gave it one.
		expect(atlas.routes.filter((route) => route.direction === "southwest")).toHaveLength(1);
		expect(atlas.routes).toHaveLength(4);
	});

	it("survives storage, and reads rubbish as an empty atlas", () => {
		const atlas = withPlate(emptyAtlas(), first, SQUARE);
		expect(atlasFromJson(JSON.stringify(atlas))).toEqual(atlas);
		expect(atlasFromJson("{")).toEqual(emptyAtlas());
		expect(atlasFromJson(null)).toEqual(emptyAtlas());
	});
});
