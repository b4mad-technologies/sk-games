/**
 * Browser world session for seats + occupancy (no SVG map rows).
 * "My seat" fly-to uses visible_actor_spatial_location → Overpass lat/lon.
 * Observer overlay is identity-shaped visible_* on this same connection.
 */

import type { ActorPlace } from "@spellkave/map-canvas";
import type { SnapshotDb } from "@spellkave/sdk";
import {
	connect,
	readActorIdentityBindings,
	readSeats,
	readWatchOwnBodies,
	readWatchTick,
	WATCH_BUFFER_REQUIRED_TABLES,
	WatchBuffer,
	watchOverlayAdmitted,
} from "@spellkave/sdk";
import { readSeatsRequiredTables } from "@spellkave/sdk/readers";
import { playConnectUrl, yieldToBrowser } from "./play";
import { annotateSeats, type PlaySeat } from "./seats";

export interface WorldHandle {
	seats(): PlaySeat[];
	/** Occupancy rows for the caller's visible actors. */
	actorPlaces(): ActorPlace[];
	watch: WatchBuffer;
	overlayAdmitted(): boolean;
	/** Resolves when the seat subscription (and optional watch top-up) is applied. */
	whenReady: Promise<void>;
	claim(actorId: string): Promise<void>;
	release(): Promise<void>;
	disconnect(): void;
}

export interface OpenWorldArgs {
	url: string;
	db: string;
	token: string;
	onUpdate: () => void;
	onError?: (err: Error) => void;
}

type ConnectFn = typeof connect;
type ReadSeatsFn = typeof readSeats;
type ReadBindingsFn = typeof readActorIdentityBindings;
type ReadPlacesFn = (db: SnapshotDb) => ActorPlace[];

export interface WorldClientDeps {
	connect: ConnectFn;
	readSeats: ReadSeatsFn;
	readBindings: ReadBindingsFn;
	readActorPlaces: ReadPlacesFn;
}

export function projectActorPlaces(db: SnapshotDb): ActorPlace[] {
	const handle = db.visible_actor_spatial_location;
	if (!handle) return [];
	const out: ActorPlace[] = [];
	for (const row of handle.iter() as Iterable<Record<string, unknown>>) {
		const place =
			row.placeNodeId !== undefined && row.placeNodeId !== null
				? String(row.placeNodeId)
				: row.place_node_id !== undefined && row.place_node_id !== null
					? String(row.place_node_id)
					: "";
		if (place === "") continue;
		const entity =
			row.entityId !== undefined && row.entityId !== null
				? String(row.entityId)
				: row.entity_id !== undefined && row.entity_id !== null
					? String(row.entity_id)
					: "";
		out.push({ placeNodeId: place, entityId: entity });
	}
	return out;
}

export const WORLD_SEAT_READER_MANIFESTS = [
	{ requiredTables: [...readSeatsRequiredTables] },
	{ requiredTables: ["visible_actor_identity", "actor", "world_time"] as const },
	{ requiredTables: ["visible_actor_spatial_location"] as const },
	{ requiredTables: ["visible_capability"] as const },
] as const;

export const WORLD_WATCH_READER_MANIFESTS = [
	...WORLD_SEAT_READER_MANIFESTS,
	{ requiredTables: [...WATCH_BUFFER_REQUIRED_TABLES] },
] as const;

const SEAT_TABLES = new Set<string>(
	WORLD_SEAT_READER_MANIFESTS.flatMap((manifest) => [...manifest.requiredTables]),
);

/** WatchBuffer tables not already on the seat connection. */
export const WORLD_WATCH_TOPUP_TABLES = WATCH_BUFFER_REQUIRED_TABLES.filter(
	(table) => !SEAT_TABLES.has(table),
);

function subscribeTables(
	conn: {
		subscriptionBuilder: () => {
			onApplied: (fn: () => void) => {
				onError: (fn: (ctx: unknown, err?: unknown) => void) => {
					subscribe: (queries: string[]) => unknown;
				};
			};
		};
	},
	tables: readonly string[],
): Promise<void> {
	if (tables.length === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		conn
			.subscriptionBuilder()
			.onApplied(() => resolve())
			.onError((_ctx: unknown, err?: unknown) => {
				reject(
					err instanceof Error ? err : new Error(String(err ?? _ctx ?? "subscription failed")),
				);
			})
			// ci-allow(raw-sql): same SELECT * FROM <table> shape connect() uses for readerManifests.
			.subscribe(tables.map((table) => `SELECT * FROM ${table}`));
	});
}

const defaultDeps: WorldClientDeps = {
	connect,
	readSeats,
	readBindings: readActorIdentityBindings,
	readActorPlaces: projectActorPlaces,
};

function asSnapshot(db: object): SnapshotDb {
	const record = db as Record<string, SnapshotDb[string]>;
	return {
		...record,
		seat: record.seat,
		visible_actor_identity: record.visible_actor_identity ?? record.visibleActorIdentity,
		visible_actor_spatial_location:
			record.visible_actor_spatial_location ?? record.visibleActorSpatialLocation,
		visible_entity_tag: record.visible_entity_tag ?? record.visibleEntityTag,
		visible_entity_tag_coverage:
			record.visible_entity_tag_coverage ?? record.visibleEntityTagCoverage,
		visible_object_state: record.visible_object_state ?? record.visibleObjectState,
		visible_target_condition: record.visible_target_condition ?? record.visibleTargetCondition,
		visible_world_event: record.visible_world_event ?? record.visibleWorldEvent,
		visible_capability: record.visible_capability ?? record.visibleCapability,
	};
}

export async function openWorld(
	args: OpenWorldArgs,
	deps: WorldClientDeps = defaultDeps,
): Promise<WorldHandle> {
	const watch = new WatchBuffer();
	let session: Awaited<ReturnType<ConnectFn>>;
	const snapshot = (): SnapshotDb => asSnapshot(session.conn.db as object);
	session = await deps.connect(
		{
			url: playConnectUrl(args.url),
			db: args.db,
			token: args.token,
			connectedActorId: "",
			onDiagnostic: (line) => {
				// Default SDK path JSON.stringifies every additive table/reducer
				// onto the main thread and freezes the map; keep only the
				// shape-check mismatches (sk-jay0.7.389.3). Maps has no RUM.
				if ((line as { kind?: unknown }).kind === "contract_shape_mismatch") {
					console.warn(JSON.stringify(line));
				}
			},
			readerManifests: WORLD_SEAT_READER_MANIFESTS.map((m) => ({
				requiredTables: [...m.requiredTables],
			})),
		},
		{
			onError: (err) => args.onError?.(err),
			onDisconnect: (err) => {
				if (err) args.onError?.(err);
			},
			onUpdate: () => {
				try {
					const snap = snapshot();
					watch.observe(snap, readWatchTick(snap));
				} catch {
					// Empty db during first apply; overlay stays quiet.
				}
				args.onUpdate();
			},
		},
	);
	const whenReady = session.ready.then(async () => {
		await yieldToBrowser();
		try {
			if (
				watchOverlayAdmitted(snapshot(), readWatchOwnBodies(snapshot())) &&
				WORLD_WATCH_TOPUP_TABLES.length > 0
			) {
				const conn = session.conn as {
					subscriptionBuilder?: () => {
						onApplied: (fn: () => void) => {
							onError: (fn: (ctx: unknown, err?: unknown) => void) => {
								subscribe: (queries: string[]) => unknown;
							};
						};
					};
				};
				if (typeof conn.subscriptionBuilder === "function") {
					await subscribeTables(
						{ subscriptionBuilder: conn.subscriptionBuilder },
						WORLD_WATCH_TOPUP_TABLES,
					);
				}
			}
		} catch {
			// Seat connection already live; overlay stays quiet if the top-up fails.
		}
		try {
			const snap = snapshot();
			watch.bootstrap(snap, readWatchTick(snap));
		} catch {
			// Keep the watch empty until real admitted tag coverage arrives.
		}
	});

	const reducers = (): {
		rClaimActor(args: { actorId: bigint; role: string }): Promise<unknown>;
		rReleaseActor(args?: Record<string, never>): Promise<unknown>;
	} =>
		session.conn.reducers as {
			rClaimActor(args: { actorId: bigint; role: string }): Promise<unknown>;
			rReleaseActor(args?: Record<string, never>): Promise<unknown>;
		};

	return {
		watch,
		whenReady,
		seats() {
			try {
				const snap = snapshot();
				const rows = deps.readSeats(snap);
				const mine = deps.readBindings(snap).map((binding) => String(binding.actor_id));
				return annotateSeats(rows, mine);
			} catch {
				return [];
			}
		},
		actorPlaces() {
			try {
				return deps.readActorPlaces(snapshot());
			} catch {
				return [];
			}
		},
		overlayAdmitted() {
			try {
				return watchOverlayAdmitted(snapshot(), readWatchOwnBodies(snapshot()));
			} catch {
				return false;
			}
		},
		async claim(actorId: string) {
			await whenReady;
			await reducers().rClaimActor({ actorId: BigInt(actorId), role: "primary" });
		},
		async release() {
			await whenReady;
			await reducers().rReleaseActor();
		},
		disconnect() {
			session.disconnect();
		},
	};
}
