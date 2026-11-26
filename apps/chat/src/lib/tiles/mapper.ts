import type {
	HeroProps,
	Occupant,
	OccupantsProps,
	PackItem,
	PackProps,
	PlaceMapProps,
	SceneProps,
} from "@spellkave/ui-widgets";
import { sanitiseSvg } from "@spellkave/ui-widgets";
import type { McpToolEvent } from "../mcp/tool-events.ts";
import { unwrapToolResult } from "./unwrap.ts";

export const TILE_NAMES = ["Hero", "Scene", "Pack", "Occupants", "Map"] as const;
export type TileName = (typeof TILE_NAMES)[number];

export type TileSeen = { at: number; tool: string };

export type TilesView = {
	hero: HeroProps | undefined;
	scene: SceneProps | undefined;
	pack: PackProps | undefined;
	occupants: OccupantsProps | undefined;
	map: PlaceMapProps | undefined;
	mapSvg: string | undefined;
	seen: Record<TileName, TileSeen | undefined>;
};

export function emptyTiles(): TilesView {
	return {
		hero: undefined,
		scene: undefined,
		pack: undefined,
		occupants: undefined,
		map: undefined,
		mapSvg: undefined,
		seen: {
			Hero: undefined,
			Scene: undefined,
			Pack: undefined,
			Occupants: undefined,
			Map: undefined,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function collectionItems(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (isRecord(value) && Array.isArray(value.items)) return value.items;
	return [];
}

function stem(id: string): string {
	const part = id.split("/").pop() ?? id;
	return part.toLowerCase();
}

function humaniseId(id: string): string {
	const last = id.split("/").pop() ?? id;
	const spaced = last.replace(/[_-]+/g, " ").trim();
	if (spaced === "") return id;
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function vitalNumber(vitals: unknown[], key: "hp" | "ac" | "level" | "xp"): number {
	for (const entry of vitals) {
		if (!isRecord(entry)) continue;
		const id = asString(entry.state_id);
		if (id === undefined || stem(id) !== key) continue;
		const parsed = Number.parseFloat(String(entry.value ?? ""));
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function mapHero(payload: unknown): HeroProps | undefined {
	if (!isRecord(payload)) return undefined;
	const self = isRecord(payload.self) ? payload.self : payload;
	const name = asString(self.entity_name);
	if (name === undefined) return undefined;
	const vitals = collectionItems(self.vitals);
	const conditions = collectionItems(self.conditions).flatMap((row) => {
		if (!isRecord(row)) return [];
		const id = asString(row.condition_definition_id);
		return id === undefined ? [] : [id];
	});
	return {
		self: {
			name,
			hp: vitalNumber(vitals, "hp"),
			ac: vitalNumber(vitals, "ac"),
			level: vitalNumber(vitals, "level"),
			xp: vitalNumber(vitals, "xp"),
			conditions,
		},
	};
}

function mapExits(items: unknown[]): SceneProps["place"]["exits"] {
	const exits: SceneProps["place"]["exits"] = [];
	for (const item of items) {
		if (!isRecord(item) || item.kind !== "exit") continue;
		const exitLabel = asString(item.label) ?? "exit";
		const target = asString(item.to);
		exits.push({
			id: asString(item.handle) ?? asString(item.id) ?? exitLabel,
			label: target !== undefined ? humaniseId(target) : exitLabel,
			direction: exitLabel,
		});
	}
	return exits;
}

function orientExits(exits: unknown[]): SceneProps["place"]["exits"] {
	const out: SceneProps["place"]["exits"] = [];
	for (const item of exits) {
		if (!isRecord(item)) continue;
		const exitLabel = asString(item.label) ?? "exit";
		const target = asString(item.to);
		out.push({
			id: asString(item.handle) ?? asString(item.id) ?? exitLabel,
			label: target !== undefined ? humaniseId(target) : exitLabel,
			direction: exitLabel,
		});
	}
	return out;
}

function mapSceneFromScene(payload: Record<string, unknown>): SceneProps | undefined {
	if (payload.scene_resolved === false) return undefined;
	const nodeId = asString(payload.node_id);
	const description = asString(payload.node_description) ?? asString(payload.nodeDescription) ?? "";
	const items = collectionItems(payload.items);
	const dedicatedExits = items.filter((row) => isRecord(row) && row.kind === "exit");
	const orientExitList = Array.isArray(payload.exits) ? payload.exits : undefined;
	if (
		nodeId === undefined &&
		description === "" &&
		dedicatedExits.length === 0 &&
		!orientExitList
	) {
		return undefined;
	}
	const exits = orientExitList !== undefined ? orientExits(orientExitList) : mapExits(items);
	return {
		place: {
			id: nodeId ?? "here",
			name: nodeId !== undefined ? humaniseId(nodeId) : "Here",
			description,
			exits,
		},
	};
}

function mapOccupantsFromScene(payload: Record<string, unknown>): OccupantsProps | undefined {
	if (payload.scene_resolved === false) return undefined;
	const source = collectionItems(payload.items);
	const occupants: Occupant[] = [];
	for (const item of source) {
		if (!isRecord(item)) continue;
		const kind = asString(item.kind);
		if (kind !== "actor" && kind !== "entity") continue;
		const label = asString(item.label) ?? asString(item.id);
		if (label === undefined) continue;
		occupants.push({
			id: asString(item.handle) ?? asString(item.id) ?? label,
			name: label,
			kind: kind === "actor" ? "person" : "thing",
			note: label,
		});
	}
	return { occupants };
}

function flattenInventory(nodes: unknown[], depth = 0): PackItem[] {
	const items: PackItem[] = [];
	for (const node of nodes) {
		if (!isRecord(node)) continue;
		const name = asString(node.name);
		if (name === undefined) continue;
		const quantity = typeof node.quantity === "number" ? node.quantity : 1;
		const marker = depth > 0 ? `${"·".repeat(depth)} ` : "";
		const qty = quantity !== 1 ? ` ×${quantity}` : "";
		const kind = asString(node.kind) ?? "item";
		const slot = asString(node.equipped_slot);
		const detail = slot !== undefined ? `${kind} · ${slot}` : kind;
		items.push({
			id: asString(node.handle) ?? asString(node.id) ?? `${name}-${depth}-${items.length}`,
			name: `${marker}${name}${qty}`,
			detail,
		});
		if (Array.isArray(node.contents)) {
			items.push(...flattenInventory(node.contents, depth + 1));
		}
	}
	return items;
}

function mapPack(payload: unknown): PackProps | undefined {
	if (!isRecord(payload)) return undefined;
	if (!Array.isArray(payload.items)) return undefined;
	return { items: flattenInventory(payload.items) };
}

function mapPlaceMap(
	payload: unknown,
): { map: PlaceMapProps; mapSvg: string | undefined } | undefined {
	if (!isRecord(payload)) return undefined;
	const graph = asString(payload.graph);
	const inventory = asString(payload.inventory);
	const places = typeof payload.places === "number" ? payload.places : undefined;
	const routes = typeof payload.routes === "number" ? payload.routes : undefined;
	if (graph === undefined && inventory === undefined && places === undefined) return undefined;
	const placeName = graph !== undefined ? humaniseId(graph) : "Map";
	const caption =
		inventory ??
		(places !== undefined && routes !== undefined
			? `${places} places, ${routes} routes`
			: "Known map");
	return {
		map: { frame: { mode: "full", placeName, caption } },
		mapSvg: sanitiseSvg(payload.svg),
	};
}

function mark(prev: TilesView, names: TileName[], event: McpToolEvent): TilesView["seen"] {
	const seen = { ...prev.seen };
	for (const name of names) {
		seen[name] = { at: event.at, tool: event.tool };
	}
	return seen;
}

function applyScene(
	prev: TilesView,
	payload: Record<string, unknown>,
	event: McpToolEvent,
): TilesView {
	const scene = mapSceneFromScene(payload);
	const occupants = mapOccupantsFromScene(payload);
	if (scene === undefined && occupants === undefined) return prev;
	const names: TileName[] = [];
	if (scene !== undefined) names.push("Scene");
	if (occupants !== undefined) names.push("Occupants");
	return {
		...prev,
		scene: scene ?? prev.scene,
		occupants: occupants ?? prev.occupants,
		seen: mark(prev, names, event),
	};
}

function applyHero(prev: TilesView, payload: unknown, event: McpToolEvent): TilesView {
	const hero = mapHero(payload);
	if (hero === undefined) return prev;
	return { ...prev, hero, seen: mark(prev, ["Hero"], event) };
}

function applyPack(prev: TilesView, payload: unknown, event: McpToolEvent): TilesView {
	const pack = mapPack(payload);
	if (pack === undefined) return prev;
	return { ...prev, pack, seen: mark(prev, ["Pack"], event) };
}

function applyPlaceMap(prev: TilesView, payload: unknown, event: McpToolEvent): TilesView {
	const mapped = mapPlaceMap(payload);
	if (mapped === undefined) return prev;
	return {
		...prev,
		map: mapped.map,
		mapSvg: mapped.mapSvg,
		seen: mark(prev, ["Map"], event),
	};
}

function applyOrient(prev: TilesView, payload: unknown, event: McpToolEvent): TilesView {
	if (!isRecord(payload)) return prev;
	const view = isRecord(payload.view) ? payload.view : undefined;
	if (asString(view?.kind) === "reaction") return prev;
	let next = prev;
	const selfSummary = view?.selfSummary ?? payload.selfSummary;
	next = applyHero(next, selfSummary, event);
	const scene = isRecord(view?.scene)
		? view.scene
		: isRecord(payload.scene)
			? payload.scene
			: undefined;
	if (scene !== undefined) {
		const nodeId = asString(isRecord(selfSummary) ? selfSummary.current_node_id : undefined);
		next = applyScene(
			next,
			nodeId !== undefined && scene.node_id === undefined ? { ...scene, node_id: nodeId } : scene,
			event,
		);
	}
	if (payload.inventory !== undefined) {
		next = applyPack(next, payload.inventory, event);
	}
	return next;
}

export function applyToolEvent(prev: TilesView, event: McpToolEvent): TilesView {
	try {
		const payload = unwrapToolResult(event.result);
		if (payload === undefined) return prev;
		switch (event.tool) {
			case "spellkave_orient":
				return applyOrient(prev, payload, event);
			case "spellkave_self_summary":
				return applyHero(prev, payload, event);
			case "spellkave_scene":
				return isRecord(payload) ? applyScene(prev, payload, event) : prev;
			case "spellkave_inventory":
				return applyPack(prev, payload, event);
			case "spellkave_map":
				return applyPlaceMap(prev, payload, event);
			default:
				return prev;
		}
	} catch {
		return prev;
	}
}

export { mapPack, mapHero, mapPlaceMap, mapOccupantsFromScene, mapSceneFromScene };
