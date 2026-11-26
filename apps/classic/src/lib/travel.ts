// Travel by a click on the area map.
//
// The world's own map picture (`spellkave_map`, an SVG plate) names every
// place it draws (`data-node-id`) and every route between two of them
// (`data-from` / `data-to`). This module reads that picture as a graph and
// finds a way from the hero's place to a clicked one.
//
// A route is a plan, not a promise. The app walks it one offered way out at
// a time and stops at the first step the world refuses or does not offer
// (ledger/designs/classic-interaction-rules.md, C2 and C7). The picture says
// nothing about gates or one-way routes, so every drawn route counts both
// ways here and the world decides.

import type { PlayExit, PlayPlace } from "../../../play/src/lib/play-view";

export type PlateGraph = {
	/** Place id -> the name the plate writes next to it (the id when it writes none). */
	names: Map<string, string>;
	/** Place id -> the places a drawn route leads to. */
	neighbours: Map<string, string[]>;
};

/** Read the places and routes a map plate draws. An unreadable plate is an empty graph. */
export function plateGraph(svg: string | undefined): PlateGraph {
	const names = new Map<string, string>();
	const neighbours = new Map<string, string[]>();
	if (!svg) return { names, neighbours };
	const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
	for (const node of Array.from(doc.querySelectorAll("[data-node-id]"))) {
		const id = node.getAttribute("data-node-id") ?? "";
		if (id === "") continue;
		const label = node.querySelector("text.label");
		// The floor suffix ("(z=-3)") rides in its own tspan; the name is the rest.
		const name = label
			? Array.from(label.childNodes)
					.filter((child) => child.nodeType === 3)
					.map((child) => child.textContent ?? "")
					.join("")
					.trim()
			: "";
		names.set(id, name || id);
	}
	const link = (from: string, to: string) => {
		const list = neighbours.get(from) ?? [];
		if (!list.includes(to)) list.push(to);
		neighbours.set(from, list);
	};
	for (const edge of Array.from(doc.querySelectorAll("[data-from][data-to]"))) {
		const from = edge.getAttribute("data-from") ?? "";
		const to = edge.getAttribute("data-to") ?? "";
		if (!names.has(from) || !names.has(to) || from === to) continue;
		link(from, to);
		link(to, from);
	}
	return { names, neighbours };
}

/**
 * Everything two graphs draw. The world's plate shows what the hero perceives
 * now (seen live 2026-11-14: the own place and its neighbours), so the app
 * keeps what earlier plates showed to plan a walk back. A remembered route
 * is only a plan; each step still needs a way out the world offers then.
 */
export function mergeGraphs(known: PlateGraph, seen: PlateGraph): PlateGraph {
	const names = new Map(known.names);
	for (const [id, name] of seen.names) names.set(id, name);
	const neighbours = new Map([...known.neighbours].map(([id, list]) => [id, [...list]]));
	for (const [id, list] of seen.neighbours) {
		const merged = neighbours.get(id) ?? [];
		for (const next of list) if (!merged.includes(next)) merged.push(next);
		neighbours.set(id, merged);
	}
	return { names, neighbours };
}

/** A graph as plain data, for session storage. */
export function graphToJson(graph: PlateGraph): string {
	return JSON.stringify({ names: [...graph.names], neighbours: [...graph.neighbours] });
}

/** The reverse of `graphToJson`; anything unreadable is an empty graph. */
export function graphFromJson(text: string | null): PlateGraph {
	try {
		const data = JSON.parse(text ?? "") as {
			names?: [string, string][];
			neighbours?: [string, string[]][];
		};
		if (Array.isArray(data.names) && Array.isArray(data.neighbours))
			return { names: new Map(data.names), neighbours: new Map(data.neighbours) };
	} catch {
		// Not a stored graph.
	}
	return { names: new Map(), neighbours: new Map() };
}

/**
 * The shortest drawn way from one place to another: the places to step
 * through, ending with the goal. Empty when there is none, or when the hero
 * already stands there.
 */
export function routeTo(graph: PlateGraph, from: string, to: string): string[] {
	if (from === to || !graph.names.has(from) || !graph.names.has(to)) return [];
	const cameFrom = new Map<string, string>();
	const queue = [from];
	for (let index = 0; index < queue.length; index += 1) {
		const here = queue[index] as string;
		if (here === to) break;
		for (const next of graph.neighbours.get(here) ?? []) {
			if (next === from || cameFrom.has(next)) continue;
			cameFrom.set(next, here);
			queue.push(next);
		}
	}
	if (!cameFrom.has(to)) return [];
	const route = [to];
	while (cameFrom.get(route[0] as string) !== from)
		route.unshift(cameFrom.get(route[0] as string) as string);
	return route;
}

/** One place on the plate the hero can set out for. */
export type MapTarget = { nodeId: string; name: string; hops: number };

/** Every drawn place a route leads to from here, nearest first. */
export function mapTargets(graph: PlateGraph, from: string | undefined): MapTarget[] {
	if (from === undefined) return [];
	const targets: MapTarget[] = [];
	for (const [nodeId, name] of graph.names) {
		const hops = routeTo(graph, from, nodeId).length;
		if (hops > 0) targets.push({ nodeId, name, hops });
	}
	return targets.sort((a, b) => a.hops - b.hops || a.name.localeCompare(b.name));
}

/** The way out the world offers from this place to that neighbour, if any. */
export function exitTo(place: PlayPlace | null | undefined, nodeId: string): PlayExit | undefined {
	return place?.exits.find((exit) => exit.toNodeId === nodeId);
}

/** `adv/gate/locked-door` -> "locked door". The world sends the gate's id, not a sentence. */
export function gateName(gate: string): string {
	const last = gate.split("/").pop() ?? gate;
	return last.replaceAll(/[-_]+/g, " ").trim() || gate;
}

/** What stands on a way out, in words, before the click. Undefined for an open way. */
export function gateHint(exit: PlayExit): string | undefined {
	if (exit.gates.length === 0) return undefined;
	return `Gated: ${exit.gates.map(gateName).join(", ")}. The world decides when you try.`;
}
