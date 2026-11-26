import type { ActorPlace } from "@spellkave/map-canvas";

export interface CatalogSeat {
	actor_id: string;
	/** Body entity id — used to label map occupancy badges. */
	entity_id?: string;
	name: string;
	embodied: boolean;
	claimed: boolean;
	/** Instance entity_tag values (when the session subscribed entity_tag). */
	tags?: string[];
}

export interface PlaySeat extends CatalogSeat {
	mine: boolean;
}

export interface WorldHero {
	worldSlug: string;
	worldName: string;
	actor_id: string;
	name: string;
}

export function annotateSeats(seats: CatalogSeat[], myActorIds: Iterable<string>): PlaySeat[] {
	const mine = new Set([...myActorIds].map(String));
	return seats.map((seat) => ({
		...seat,
		mine: mine.has(String(seat.actor_id)),
	}));
}

export function heroesFromWorld(
	worldSlug: string,
	worldName: string,
	seats: PlaySeat[],
): WorldHero[] {
	return seats
		.filter((seat) => seat.mine)
		.map((seat) => ({
			worldSlug,
			worldName,
			actor_id: seat.actor_id,
			name: seat.name,
		}));
}

/** The slice of a world handle the seat board reads (structural, so tests need no SDK). */
export interface SeatSource {
	seats(): PlaySeat[];
	actorPlaces(): ActorPlace[];
}

export interface MineOnMap {
	slug: string;
	places: ActorPlace[];
	mineEntityIds: string[];
}

export interface SeatBoardView {
	/** My claimed heroes across every connected world. */
	heroes: WorldHero[];
	/** Seats of the selected world (empty until its handle is connected). */
	seats: PlaySeat[];
	/** What the map needs to place "my seat"; null when the selected world is not connected. */
	mine: MineOnMap | null;
}

export interface PlayErrorNote {
	/** Error for the selected world, if any. */
	selected: string | null;
	/** How many *other* worlds reported an error. */
	othersCount: number;
	/** `slug: message` lines for the other-worlds note `title`. */
	othersTitle: string;
}

/** Project a per-world status map into the selected error + a one-line others note. */
export function projectPlayErrors(
	statusByWorld: ReadonlyMap<string, string>,
	selectedSlug: string | null,
): PlayErrorNote {
	const selected = selectedSlug === null ? null : (statusByWorld.get(selectedSlug) ?? null);
	const others: string[] = [];
	for (const [slug, message] of statusByWorld) {
		if (slug === selectedSlug) continue;
		others.push(`${slug}: ${message}`);
	}
	return {
		selected,
		othersCount: others.length,
		othersTitle: others.join("\n"),
	};
}

/**
 * Pure projection of connected world handles into what the seat board renders.
 * Lives outside the component so it can be a `$derived` there: the previous
 * `$effect` wrote `seats` and read it back in the same run, which Svelte 5
 * re-runs until it trips `effect_update_depth_exceeded` (sk-jay0.4.1).
 */
export function seatBoardView(
	worlds: ReadonlyArray<{ slug: string; name: string }>,
	handles: ReadonlyMap<string, SeatSource>,
	slug: string | null,
): SeatBoardView {
	const heroes: WorldHero[] = [];
	for (const world of worlds) {
		const handle = handles.get(world.slug);
		if (handle === undefined) continue;
		heroes.push(...heroesFromWorld(world.slug, world.name, handle.seats()));
	}
	const current = slug === null ? undefined : handles.get(slug);
	if (current === undefined || slug === null) {
		return { heroes, seats: [], mine: null };
	}
	const seats = current.seats();
	const mineEntityIds = seats
		.filter((seat) => seat.mine)
		.map((seat) => (seat.entity_id !== undefined ? String(seat.entity_id) : ""))
		.filter((id) => id !== "");
	return { heroes, seats, mine: { slug, places: current.actorPlaces(), mineEntityIds } };
}
