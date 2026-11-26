// The atlas as the map panel draws it: one sheet per area.
//
// A sheet shows its places where the world's plate put them (`atlas.ts`
// keeps one frame per area), scaled to the panel's canvas. A place no plate
// has drawn (the far side of a door, named by a way out) stands beside the
// place that leads to it, in the direction that way leaves. A route is a
// plan, never a promise; the world answers each way.

import type { AreaMap, MapPlace, MapSheet } from "../model";
import type { Atlas, AtlasPlace } from "./atlas";

/** The panel's own canvas, in its units (see `.st-map` in stage.css). */
export const CANVAS = { width: 200, height: 120, edgeX: 26, edgeY: 14 } as const;
/** How far from its neighbour a place without a drawn position stands. */
const REACH = 34;

const TOWARD: Record<string, readonly [number, number]> = {
	north: [0, -1],
	south: [0, 1],
	east: [1, 0],
	west: [-1, 0],
	northeast: [0.7, -0.7],
	northwest: [-0.7, -0.7],
	southeast: [0.7, 0.7],
	southwest: [-0.7, 0.7],
	up: [0.4, -0.9],
	down: [0.4, 0.9],
};

function toward(direction: string | undefined): readonly [number, number] | undefined {
	return TOWARD[(direction ?? "").toLowerCase().replace(/[^a-z]/g, "")];
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/** A tag is about this wide and high on the canvas; two may not cover each other. */
const TAG = { width: 36, height: 13 } as const;

/** Push spots that would cover each other apart, up and down, inside the canvas. */
function apart(spots: { x: number; y: number }[]): void {
	for (let round = 0; round < 12; round += 1) {
		let moved = false;
		for (const a of spots) {
			for (const b of spots) {
				if (a === b || Math.abs(a.x - b.x) >= TAG.width) continue;
				const gap = Math.abs(a.y - b.y);
				if (gap >= TAG.height) continue;
				const [upper, lower] = a.y < b.y || (a.y === b.y && a.x <= b.x) ? [a, b] : [b, a];
				const push = (TAG.height - gap) / 2;
				upper.y = clamp(upper.y - push, CANVAS.edgeY, CANVAS.height - CANVAS.edgeY);
				lower.y = clamp(lower.y + push, CANVAS.edgeY, CANVAS.height - CANVAS.edgeY);
				moved = true;
			}
		}
		if (!moved) return;
	}
}

function sheetFor(atlas: Atlas, area: string, reach: ReadonlySet<string> | null): MapSheet {
	const mine = Object.entries(atlas.places).filter(([, place]) => place.area === area);
	const drawn = mine.filter(
		(entry): entry is [string, AtlasPlace & { x: number; y: number }] =>
			entry[1].x !== undefined && entry[1].y !== undefined,
	);
	const spots = new Map<string, { x: number; y: number }>();
	// Places no plate drew stand beside a drawn one: leave them a rim.
	const rim = drawn.length > 0 && drawn.length < mine.length ? REACH / 2 : 0;
	const innerW = CANVAS.width - 2 * (CANVAS.edgeX + rim);
	const innerH = CANVAS.height - 2 * (CANVAS.edgeY + rim);
	if (drawn.length > 0) {
		const xs = drawn.map(([, place]) => place.x);
		const ys = drawn.map(([, place]) => place.y);
		const [minX, maxX, minY, maxY] = [
			Math.min(...xs),
			Math.max(...xs),
			Math.min(...ys),
			Math.max(...ys),
		];
		// Each axis fills the canvas by itself. A plate is fitted to its own
		// sheet (a house with a cellar is tall and narrow); the tags need the
		// room more than the area needs its true shape. Order and direction
		// between any two places stay as the world drew them.
		const scaleX = maxX > minX ? innerW / (maxX - minX) : 0;
		const scaleY = maxY > minY ? innerH / (maxY - minY) : 0;
		for (const [id, place] of drawn) {
			spots.set(id, {
				x: CANVAS.width / 2 + (place.x - (minX + maxX) / 2) * scaleX,
				y: CANVAS.height / 2 + (place.y - (minY + maxY) / 2) * scaleY,
			});
		}
	}
	// Places no plate drew: beside a placed neighbour, where the way points.
	const loose = mine.filter(([id]) => !spots.has(id)).sort(([a], [b]) => a.localeCompare(b));
	for (let pass = 0; pass < loose.length; pass += 1) {
		for (const [id] of loose) {
			if (spots.has(id)) continue;
			for (const route of atlas.routes) {
				const other = route.from === id ? route.to : route.to === id ? route.from : undefined;
				const anchor = other === undefined ? undefined : spots.get(other);
				const way = toward(route.direction);
				if (!anchor || !way) continue;
				// The direction is the one the way leaves `route.from` in.
				const sign = route.to === id ? 1 : -1;
				spots.set(id, {
					x: clamp(anchor.x + sign * way[0] * REACH, CANVAS.edgeX, CANVAS.width - CANVAS.edgeX),
					y: clamp(anchor.y + sign * way[1] * REACH, CANVAS.edgeY, CANVAS.height - CANVAS.edgeY),
				});
				break;
			}
		}
	}
	// Still without a spot: a row along the lower edge (or the middle, alone).
	const rest = loose.filter(([id]) => !spots.has(id));
	rest.forEach(([id], index) => {
		spots.set(id, {
			x: CANVAS.edgeX + ((index + 0.5) / rest.length) * (CANVAS.width - 2 * CANVAS.edgeX),
			y: spots.size === index ? CANVAS.height / 2 : CANVAS.height - CANVAS.edgeY,
		});
	});

	apart([...spots.values()]);

	const places: MapPlace[] = mine
		.map(([id, place]): MapPlace => {
			const spot = spots.get(id) ?? { x: CANVAS.width / 2, y: CANVAS.height / 2 };
			const doors: NonNullable<MapPlace["doors"]> = [];
			for (const route of atlas.routes) {
				const other = route.from === id ? route.to : route.to === id ? route.from : undefined;
				const far = other === undefined ? undefined : atlas.places[other];
				if (!far || far.area === area || doors.some((door) => door.sheet === far.area)) continue;
				doors.push({ sheet: far.area, title: atlas.areas[far.area]?.title ?? far.area });
			}
			return {
				id,
				name: place.name,
				x: Math.round(spot.x),
				y: Math.round(spot.y),
				known: place.visited,
				...(reach && !reach.has(id) ? { cut: true } : {}),
				...(doors.length > 0 ? { doors } : {}),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	const shown = new Set(places.map((place) => place.id));
	const routes = atlas.routes
		.filter((route) => shown.has(route.from) && shown.has(route.to))
		.map((route) => ({ from: route.from, to: route.to }));
	return { id: area, title: atlas.areas[area]?.title ?? area, places, routes };
}

/** Every place a chain of known ways leads to from here, and here itself. */
function reachFrom(atlas: Atlas, here: string): Set<string> {
	const reach = new Set([here]);
	const queue = [here];
	for (let index = 0; index < queue.length; index += 1) {
		const at = queue[index];
		for (const route of atlas.routes) {
			const next = route.from === at ? route.to : route.to === at ? route.from : undefined;
			if (next === undefined || reach.has(next) || !atlas.places[next]) continue;
			reach.add(next);
			queue.push(next);
		}
	}
	return reach;
}

/** Every area the hero has seen a place of, as sheets; the hero's own first. */
export function areaMap(atlas: Atlas, here: string | undefined): AreaMap {
	const mine = here === undefined ? undefined : atlas.places[here]?.area;
	const areas = [...new Set(Object.values(atlas.places).map((place) => place.area))];
	const reach = here === undefined || !atlas.places[here] ? null : reachFrom(atlas, here);
	const sheets = areas
		.map((area) => sheetFor(atlas, area, reach))
		.sort(
			(a, b) => Number(b.id === mine) - Number(a.id === mine) || a.title.localeCompare(b.title),
		);
	return { here: here ?? "", sheets };
}
