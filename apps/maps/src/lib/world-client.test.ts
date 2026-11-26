import { asActorId, asEntityId } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";

import {
	openWorld,
	projectActorPlaces,
	WORLD_SEAT_READER_MANIFESTS,
	WORLD_WATCH_TOPUP_TABLES,
} from "./world-client";

const ACTOR_ID = asActorId("1");
const BODY_ID = asEntityId("10");

describe("world-client", () => {
	it("connects seats and capability first; watch tables are a later top-up", () => {
		const seats = WORLD_SEAT_READER_MANIFESTS.flatMap((m) => [...m.requiredTables]);
		expect(seats).toContain("visible_actor_spatial_location");
		expect(seats).toContain("visible_actor_identity");
		expect(seats).toContain("visible_capability");
		expect(seats).not.toContain("visible_object_state");
		expect(seats).not.toContain("visible_world_event");
		expect(WORLD_WATCH_TOPUP_TABLES).toContain("visible_object_state");
		expect(WORLD_WATCH_TOPUP_TABLES).toContain("visible_world_event");
		expect(WORLD_WATCH_TOPUP_TABLES.some((t) => String(t) === "world_event")).toBe(false);
		expect(WORLD_WATCH_TOPUP_TABLES.some((t) => String(t) === "object_state")).toBe(false);
	});

	it("projectActorPlaces normalizes camel/snake rows", () => {
		const db = {
			visible_actor_spatial_location: {
				iter: () => [
					{ entityId: 1n, placeNodeId: "a/b" },
					{ entity_id: "2", place_node_id: "c/d" },
					{ entityId: "3", placeNodeId: "" },
				],
			},
		};
		expect(projectActorPlaces(db as never)).toEqual([
			{ entityId: "1", placeNodeId: "a/b" },
			{ entityId: "2", placeNodeId: "c/d" },
		]);
	});

	it("openWorld wires claim/release, actorPlaces, and a watch buffer", async () => {
		const claim = vi.fn(async () => {});
		const release = vi.fn(async () => {});
		const disconnect = vi.fn();
		const handle = await openWorld(
			{
				url: "ws://127.0.0.1:9",
				db: "db",
				token: "t",
				onUpdate: () => {},
			},
			{
				connect: vi.fn(async () => ({
					ready: Promise.resolve(),
					disconnect,
					conn: {
						db: {},
						reducers: {
							rClaimActor: claim,
							rReleaseActor: release,
						},
					},
				})) as never,
				readSeats: () => [
					{
						actor_id: ACTOR_ID,
						entity_id: BODY_ID,
						name: "Hero",
						embodied: true,
						claimed: true,
					},
				],
				readBindings: () => [
					{
						key: "1",
						actor_id: ACTOR_ID,
						identity: "me",
						role: "primary",
						provenance: "person",
						bound_at_tick: 0,
						connection_id: null,
					},
				],
				readActorPlaces: () => [{ entityId: BODY_ID, placeNodeId: "place/1" }],
			},
		);
		expect(handle.seats()[0]?.mine).toBe(true);
		expect(handle.actorPlaces()).toEqual([{ entityId: "10", placeNodeId: "place/1" }]);
		expect(handle.overlayAdmitted()).toBe(false);
		expect(handle.watch.cursor()).toEqual({ kind: "live" });
		await handle.whenReady;
		expect(handle.watch.frameAtCursor()).toBeNull();
		await handle.claim(ACTOR_ID);
		expect(claim).toHaveBeenCalled();
		await handle.release();
		expect(release).toHaveBeenCalled();
		handle.disconnect();
		expect(disconnect).toHaveBeenCalled();
	});

	it("openWorld subscribes only seat tables until overlay is admitted", async () => {
		let manifests: { requiredTables: string[] }[] = [];
		const subscribe = vi.fn();
		await openWorld(
			{
				url: "ws://127.0.0.1:9",
				db: "db",
				token: "t",
				onUpdate: () => {},
			},
			{
				connect: vi.fn(async (args) => {
					manifests = args.readerManifests as { requiredTables: string[] }[];
					return {
						ready: Promise.resolve(),
						disconnect: vi.fn(),
						conn: {
							db: {},
							reducers: {
								rClaimActor: vi.fn(),
								rReleaseActor: vi.fn(),
							},
							subscriptionBuilder: () => ({
								onApplied(fn: () => void) {
									fn();
									return this;
								},
								onError() {
									return this;
								},
								subscribe,
							}),
						},
					};
				}) as never,
				readSeats: () => [],
				readBindings: () => [],
				readActorPlaces: () => [],
			},
		);
		const tables = manifests.flatMap((m) => m.requiredTables);
		expect(tables).toContain("visible_capability");
		expect(tables).not.toContain("visible_object_state");
		expect(subscribe).not.toHaveBeenCalled();
	});

	it("openWorld tops up WatchBuffer tables after an oversight grant", async () => {
		const subscribe = vi.fn();
		const builder = {
			onApplied(fn: () => void) {
				fn();
				return builder;
			},
			onError() {
				return builder;
			},
			subscribe,
		};
		const handle = await openWorld(
			{
				url: "ws://127.0.0.1:9",
				db: "db",
				token: "t",
				onUpdate: () => {},
			},
			{
				connect: vi.fn(async () => ({
					ready: Promise.resolve(),
					disconnect: vi.fn(),
					conn: {
						db: {
							visible_entity_tag: { iter: () => [] },
							visible_entity_tag_coverage: {
								iter: () => [{ status: "complete", projectionVersion: 1 }],
							},
							actor: { iter: () => [{ actorId: 1n, currentBody: 7n }] },
							visible_actor_identity: { iter: () => [{ actorId: 1n }] },
							visible_capability: {
								iter: () => [{ entityId: 7n, extentRef: "see-as", elevationClass: "internal" }],
							},
						},
						reducers: {
							rClaimActor: vi.fn(),
							rReleaseActor: vi.fn(),
						},
						subscriptionBuilder: () => builder,
					},
				})) as never,
				readSeats: () => [],
				readBindings: () => [],
				readActorPlaces: () => [],
			},
		);
		await handle.whenReady;
		expect(subscribe).toHaveBeenCalled();
		const queries = subscribe.mock.calls[0]?.[0] as string[];
		expect(queries.some((q) => q.includes("visible_object_state"))).toBe(true);
		expect(queries.some((q) => q.includes("visible_world_event"))).toBe(true);
		expect(queries.some((q) => q.endsWith("visible_entity_tag"))).toBe(true);
		expect(queries.some((q) => q.endsWith("visible_entity_tag_coverage"))).toBe(true);
		expect(handle.watch.frameAtCursor()).toBeDefined();
		expect(queries.some((q) => q.includes("visible_capability"))).toBe(false);
	});
});
