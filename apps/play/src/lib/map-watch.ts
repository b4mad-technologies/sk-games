import type { ActorPlace, OccupancyPlace } from "@spellkave/map-canvas";
import type { WatchActor, WatchEvent } from "@spellkave/sdk";

export type PlayMapWatch = {
	overlay: boolean;
	places: ActorPlace[];
	mineEntityIds: string[];
	occupancy: OccupancyPlace[];
	actors: WatchActor[];
	events: WatchEvent[];
	oldestTick: number;
	latestTick: number;
	cursorTick: number;
	live: boolean;
	pause: () => void;
	play: () => void;
	scrub: (tick: number) => void;
};

export function occupancyFromWatch(
	actors: readonly WatchActor[],
	mineEntityIds: Iterable<string>,
): OccupancyPlace[] {
	const mine = new Set([...mineEntityIds].map(String));
	return actors.map((actor) => ({
		entityId: actor.entityId,
		placeNodeId: actor.placeNodeId,
		name: actor.name,
		mine: mine.has(actor.entityId),
	}));
}

export function placesFromWatch(
	actors: readonly WatchActor[],
	mineEntityIds: Iterable<string>,
): ActorPlace[] {
	const mine = new Set([...mineEntityIds].map(String));
	return actors
		.filter((actor) => mine.has(actor.entityId))
		.map((actor) => ({
			placeNodeId: actor.placeNodeId,
			entityId: actor.entityId,
		}));
}
