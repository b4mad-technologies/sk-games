import { listToolEvents, type McpToolEvent, subscribeToolEvents } from "../mcp/tool-events.ts";
import { applyToolEvent, emptyTiles, type TilesView } from "./mapper.ts";

export const tiles: TilesView = $state(emptyTiles());

function replace(next: TilesView): void {
	tiles.hero = next.hero;
	tiles.scene = next.scene;
	tiles.pack = next.pack;
	tiles.occupants = next.occupants;
	tiles.map = next.map;
	tiles.mapSvg = next.mapSvg;
	tiles.seen = next.seen;
}

export function resetTiles(): void {
	replace(emptyTiles());
}

function apply(event: McpToolEvent): void {
	replace(applyToolEvent({ ...tiles, seen: { ...tiles.seen } }, event));
}

export function startTileStore(): () => void {
	for (const event of listToolEvents()) apply(event);
	return subscribeToolEvents(apply);
}
