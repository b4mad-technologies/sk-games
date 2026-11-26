// The atlas: every place the hero has seen, kept by the client.
//
// What the world gives (read 2026-11-15, packages/spellkave-tool-player and
// server/src/spatial/visibility.rs): the map plate is a picture of ONE graph,
// the one the hero stands in. It draws the places the hero has stood in, the
// place they stand in now and its direct neighbours, fitted anew to whatever
// it draws: pixel positions and scale differ from plate to plate. A way into
// another graph (a door from the street into a house) is not on it; the
// place's own ways out name it. The set of places the hero knows is not sent
// as data to a player.
//
// So the atlas keeps, per area (graph), what every plate has shown, in one
// frame per area: a new plate is laid over the remembered places it shares
// with the frame, and brings the others along. Ways out join the areas.
// A remembered route is a plan, never a promise; the world answers each way.

import type { PlateGraph } from "../../lib/travel";

export type AtlasPlace = {
	name: string;
	area: string;
	/** Position in the area's frame; unset for a place no plate has drawn. */
	x?: number;
	y?: number;
	/** The hero has stood here. Otherwise it is known by name only. */
	visited: boolean;
};

export type AtlasRoute = {
	from: string;
	to: string;
	/** The direction of the way out from `from`, when a place named one. */
	direction?: string;
};

export type Atlas = {
	/** Area id -> the title its plate carries. */
	areas: Record<string, { title: string }>;
	places: Record<string, AtlasPlace>;
	routes: AtlasRoute[];
};

export type Plate = {
	area: string;
	title: string;
	nodes: { id: string; name: string; x: number; y: number }[];
	edges: { from: string; to: string }[];
};

export function emptyAtlas(): Atlas {
	return { areas: {}, places: {}, routes: [] };
}

/** `adv/inn/cellar` -> `adv/inn`: a place belongs to the graph its id names. */
export function areaOf(placeId: string): string {
	const cut = placeId.lastIndexOf("/");
	return cut > 0 ? placeId.slice(0, cut) : "";
}

/** `adv/old_inn` -> "Old Inn", for an area no plate has titled yet. */
function titleFromId(area: string): string {
	const last = area.split("/").pop() ?? "";
	const words = last.replaceAll(/[-_]+/g, " ").trim();
	return words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) || "Elsewhere";
}

/** Read one map plate. Null when it draws no place. */
export function readPlate(svg: string | null | undefined): Plate | null {
	if (!svg) return null;
	const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
	const nodes: Plate["nodes"] = [];
	for (const node of Array.from(doc.querySelectorAll("[data-node-id]"))) {
		const id = node.getAttribute("data-node-id") ?? "";
		const dot = node.querySelector("circle.place");
		const x = Number(dot?.getAttribute("cx"));
		const y = Number(dot?.getAttribute("cy"));
		if (id === "" || !dot || !Number.isFinite(x) || !Number.isFinite(y)) continue;
		const label = node.querySelector("text.label");
		// The floor suffix ("(z=-3)") rides in its own tspan; the name is the rest.
		const name = label
			? Array.from(label.childNodes)
					.filter((child) => child.nodeType === 3)
					.map((child) => child.textContent ?? "")
					.join("")
					.trim()
			: "";
		nodes.push({ id, name: name || id, x, y });
	}
	const first = nodes[0];
	if (!first) return null;
	const drawn = new Set(nodes.map((node) => node.id));
	const edges: Plate["edges"] = [];
	for (const edge of Array.from(doc.querySelectorAll("[data-from][data-to]"))) {
		const from = edge.getAttribute("data-from") ?? "";
		const to = edge.getAttribute("data-to") ?? "";
		if (drawn.has(from) && drawn.has(to) && from !== to) edges.push({ from, to });
	}
	const area = areaOf(first.id);
	const title = doc.querySelector("text.title-main")?.textContent?.trim();
	return { area, title: title || titleFromId(area), nodes, edges };
}

function withRoute(routes: readonly AtlasRoute[], route: AtlasRoute): AtlasRoute[] {
	const same = routes.findIndex(
		(known) =>
			(known.from === route.from && known.to === route.to) ||
			(known.from === route.to && known.to === route.from),
	);
	const known = routes[same];
	if (!known) return [...routes, route];
	// A way out says which direction it leaves in; a plate's line does not.
	if (!route.direction || (known.from === route.from && known.direction === route.direction))
		return [...routes];
	return routes.map((entry, index) => (index === same ? route : entry));
}

type Fit = { scale: number; dx: number; dy: number };

/**
 * How a plate lies over the area's frame: one scale and a shift, by least
 * squares over the places both draw. With one shared place the plate keeps
 * its size; with none it is put down to the right of what is there.
 */
function fit(plate: Plate, places: Readonly<Record<string, AtlasPlace>>): Fit {
	const shared = plate.nodes.flatMap((node) => {
		const known = places[node.id];
		return known?.x !== undefined && known.y !== undefined
			? [{ px: node.x, py: node.y, qx: known.x, qy: known.y }]
			: [];
	});
	const count = shared.length;
	if (count === 0) {
		const framed = Object.values(places).filter(
			(place) => place.area === plate.area && place.x !== undefined,
		);
		if (framed.length === 0) return { scale: 1, dx: 0, dy: 0 };
		const right = Math.max(...framed.map((place) => place.x ?? 0));
		const left = Math.min(...plate.nodes.map((node) => node.x));
		return { scale: 1, dx: right + 120 - left, dy: 0 };
	}
	const mean = (pick: (pair: (typeof shared)[number]) => number) =>
		shared.reduce((sum, pair) => sum + pick(pair), 0) / count;
	const [px, py, qx, qy] = [
		mean((pair) => pair.px),
		mean((pair) => pair.py),
		mean((pair) => pair.qx),
		mean((pair) => pair.qy),
	];
	let across = 0;
	let spread = 0;
	for (const pair of shared) {
		across += (pair.px - px) * (pair.qx - qx) + (pair.py - py) * (pair.qy - qy);
		spread += (pair.px - px) ** 2 + (pair.py - py) ** 2;
	}
	const scale = spread > 0 && across > 0 ? across / spread : 1;
	return { scale, dx: qx - scale * px, dy: qy - scale * py };
}

/**
 * Take in what a plate draws. `here` is the hero's place and `frontier` the
 * places its ways out lead to: the plate draws those two kinds and, beyond
 * them, only places the world remembers the hero stood in. So every other
 * place on it counts as visited, also in a browser that never saw the visit.
 */
export function withPlate(
	atlas: Atlas,
	plate: Plate,
	here?: string,
	frontier: ReadonlySet<string> = new Set(),
): Atlas {
	const { scale, dx, dy } = fit(plate, atlas.places);
	const places = { ...atlas.places };
	for (const node of plate.nodes) {
		const known = places[node.id];
		const stoodIn = here !== undefined && node.id !== here && !frontier.has(node.id);
		places[node.id] = {
			name: node.name,
			area: plate.area,
			x: Math.round((node.x * scale + dx) * 100) / 100,
			y: Math.round((node.y * scale + dy) * 100) / 100,
			visited: (known?.visited ?? false) || stoodIn || node.id === here,
		};
	}
	let routes = atlas.routes;
	for (const edge of plate.edges) routes = withRoute(routes, edge);
	return {
		areas: { ...atlas.areas, [plate.area]: { title: plate.title } },
		places,
		routes,
	};
}

/** The hero stands in a place: it is visited, and its ways out are routes. */
export function withPlace(
	atlas: Atlas,
	place: {
		id: string;
		name: string;
		exits: readonly { toNodeId?: string | null; toName: string; label: string }[];
	},
): Atlas {
	const places = { ...atlas.places };
	const areas = { ...atlas.areas };
	const note = (id: string, name: string, visited: boolean) => {
		const known = places[id];
		const area = known?.area ?? areaOf(id);
		places[id] = { ...known, name, area, visited: (known?.visited ?? false) || visited };
		areas[area] ??= { title: titleFromId(area) };
	};
	note(place.id, place.name, true);
	let routes = atlas.routes;
	for (const exit of place.exits) {
		if (!exit.toNodeId || exit.toNodeId === place.id) continue;
		note(exit.toNodeId, exit.toName, false);
		routes = withRoute(routes, { from: place.id, to: exit.toNodeId, direction: exit.label });
	}
	return { areas, places, routes };
}

/** The atlas as the graph `routeTo` walks: every route counts both ways. */
export function atlasGraph(atlas: Atlas): PlateGraph {
	const names = new Map(Object.entries(atlas.places).map(([id, place]) => [id, place.name]));
	const neighbours = new Map<string, string[]>();
	const link = (from: string, to: string) => {
		const list = neighbours.get(from) ?? [];
		if (!list.includes(to)) list.push(to);
		neighbours.set(from, list);
	};
	for (const route of atlas.routes) {
		if (!names.has(route.from) || !names.has(route.to)) continue;
		link(route.from, route.to);
		link(route.to, route.from);
	}
	return { names, neighbours };
}

export function sameAtlas(a: Atlas, b: Atlas): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** Anything unreadable is an empty atlas. */
export function atlasFromJson(text: string | null | undefined): Atlas {
	try {
		const data = JSON.parse(text ?? "") as Partial<Atlas>;
		if (
			data.areas &&
			data.places &&
			Array.isArray(data.routes) &&
			typeof data.areas === "object" &&
			typeof data.places === "object"
		) {
			return { areas: data.areas, places: data.places, routes: data.routes };
		}
	} catch {
		// Nothing stored, or not ours.
	}
	return emptyAtlas();
}
