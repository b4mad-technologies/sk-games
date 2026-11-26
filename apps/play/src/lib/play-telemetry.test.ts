import { describe, expect, it, vi } from "vitest";
import {
	createPlayTelemetryProducer,
	mapTrailEntryToEmit,
	projectPlayEventData,
	toPlayLogRecord,
} from "./play-telemetry";
import type { PlayTrailActEntry, PlayTrailLayoutEntry, PlayTrailReadEntry } from "./play-trail";

/** A `Window`-shaped stub with a no-op `addEventListener` — real jsdom
 * `window` works fine too, but a stub keeps this suite from attaching a
 * live `pagehide` listener across test runs. */
const fakeWindow = { addEventListener: () => {} } as unknown as Window;

const ACT_ENTRY: PlayTrailActEntry = {
	id: 1,
	at: 1000,
	tick: 5,
	kind: "act",
	tool: "spellkave_manipulate",
	actionId: "h:1",
	targetRef: "item:7",
	words: "I open the chest.",
	outcome: "happened",
	observation: "The chest creaks open.",
	durationMs: 120,
	refusalCode: null,
	refusalDetail: null,
};

function readAttributes(record: Record<string, unknown>): Record<string, unknown> {
	const attributes = record.attributes as Array<{ key: string; value: Record<string, unknown> }>;
	return Object.fromEntries(attributes.map((attribute) => [attribute.key, attribute.value]));
}

describe("projectPlayEventData", () => {
	it("keeps only the allowlisted scalar fields", () => {
		expect(
			projectPlayEventData({
				world_slug: "elven-mini-local-x",
				tool_name: "spellkave_manipulate",
				duration_ms: 42,
				is_error: false,
				// Not on the allowlist — must be dropped even though it is a
				// perfectly ordinary-looking string.
				message: "the player said something",
				words: "I attack the rat.",
				unknown_field: 123,
			}),
		).toEqual({
			world_slug: "elven-mini-local-x",
			tool_name: "spellkave_manipulate",
			duration_ms: 42,
			is_error: false,
		});
	});

	it("redacts a secret-shaped value even inside an allowlisted field", () => {
		const opaque = `sk_live_${"a".repeat(40)}`;
		expect(projectPlayEventData({ action_id: opaque })).toEqual({ action_id: "[redacted]" });
	});

	it("drops nested/object values entirely rather than stringifying them", () => {
		expect(projectPlayEventData({ world_slug: { nested: true } as unknown as string })).toEqual({});
	});

	it("never redacts a long world_slug as an opaque token — regression, sk-jay0.6.39 live proof", () => {
		// A branch-derived slug routinely crosses the 32-char opaque-token
		// threshold (this exact value is 36 chars) and is never player/session
		// input — the join key itself must survive, not become "[redacted]".
		const slug = "elven-mini-local-feat-play-telemetry";
		expect(projectPlayEventData({ world_slug: slug })).toEqual({ world_slug: slug });
	});

	it("still redacts a bearer token or JWT even inside world_slug", () => {
		expect(
			projectPlayEventData({ world_slug: "Authorization: Bearer abc123def456ghi789" }),
		).toEqual({ world_slug: "Authorization: [redacted]" });
	});
});

describe("mapTrailEntryToEmit", () => {
	it("maps an act entry to tool_call with tool_name/duration/outcome/action_id/target_ref", () => {
		const mapped = mapTrailEntryToEmit(ACT_ENTRY, "elven-mini-local-x");
		expect(mapped.type).toBe("tool_call");
		expect(mapped.data).toMatchObject({
			world_slug: "elven-mini-local-x",
			tool_name: "spellkave_manipulate",
			duration_ms: 120,
			outcome: "happened",
			action_id: "h:1",
			target_ref: "item:7",
			is_error: false,
		});
		// Free text never crosses into the emitted payload.
		expect(mapped.data).not.toHaveProperty("words");
		expect(mapped.data).not.toHaveProperty("observation");
	});

	it("maps a tool_error entry to tool_call with is_error true and never the message", () => {
		const mapped = mapTrailEntryToEmit(
			{
				id: 2,
				at: 1000,
				tick: 1,
				kind: "tool_error",
				tool: "spellkave_move",
				message: "The world refused: some detail that must never leave the client.",
			},
			"elven-mini-local-x",
		);
		expect(mapped.type).toBe("tool_call");
		expect(mapped.data).toMatchObject({
			world_slug: "elven-mini-local-x",
			tool_name: "spellkave_move",
			is_error: true,
		});
		expect(mapped.data).not.toHaveProperty("message");
	});

	it("maps read and world_pull entries to the Play-only play_client_event type", () => {
		const readEntry: PlayTrailReadEntry = {
			id: 3,
			at: 1000,
			tick: 1,
			kind: "read",
			tool: "spellkave_scene",
			counts: { npcs: 2 },
		};
		const mapped = mapTrailEntryToEmit(readEntry, "elven-mini-local-x");
		expect(mapped.type).toBe("play_client_event");
		expect(mapped.data).toMatchObject({
			world_slug: "elven-mini-local-x",
			tool_name: "spellkave_scene",
			client_kind: "read",
		});

		const worldPull = mapTrailEntryToEmit({ ...readEntry, kind: "world_pull" }, "w");
		expect(worldPull.type).toBe("play_client_event");
		expect(worldPull.data).toMatchObject({ client_kind: "world_pull" });
	});

	it("maps a layout entry to play_client_event with tile/level/trigger", () => {
		const layoutEntry: PlayTrailLayoutEntry = {
			id: 4,
			at: 1000,
			tick: 1,
			kind: "layout",
			tile: "table",
			level: "stage",
			trigger: "tap",
		};
		const mapped = mapTrailEntryToEmit(layoutEntry, "elven-mini-local-x");
		expect(mapped.type).toBe("play_client_event");
		expect(mapped.data).toMatchObject({
			world_slug: "elven-mini-local-x",
			client_kind: "layout",
			tile: "table",
			level: "stage",
			trigger: "tap",
		});
	});
});

describe("toPlayLogRecord", () => {
	it("emits bare envelope attributes and spellkave.-prefixed data attributes", () => {
		const record = toPlayLogRecord({
			v: "agent-run-events/v1",
			run_id: "run-1",
			run_kind: "campaign_playthrough",
			actor_id: "play-client",
			role: "PLAYER",
			controller_kind: "human",
			driver: "play-web",
			seed: "",
			ts: "2026-01-01T00:00:00.000Z",
			type: "tool_call",
			data: { world_slug: "elven-mini-local-x", tool_name: "spellkave_manipulate" },
		});
		const attributes = readAttributes(record);
		expect(attributes.event_type).toEqual({ stringValue: "tool_call" });
		expect(attributes.driver).toEqual({ stringValue: "play-web" });
		expect(attributes.role).toEqual({ stringValue: "PLAYER" });
		expect(attributes["spellkave.world_slug"]).toEqual({ stringValue: "elven-mini-local-x" });
		expect(attributes["spellkave.tool_name"]).toEqual({
			stringValue: "spellkave_manipulate",
		});
	});
});

describe("createPlayTelemetryProducer — disabled", () => {
	it("never touches the network when the config is disabled (nothing sent when the flag is unset)", () => {
		const fetchFn = vi.fn();
		const producer = createPlayTelemetryProducer(
			{ enabled: false, worldSlug: "" },
			{ fetchFn, windowRef: fakeWindow },
		);
		producer.record(ACT_ENTRY);
		producer.flush();
		expect(fetchFn).not.toHaveBeenCalled();
	});
});

describe("createPlayTelemetryProducer — enabled", () => {
	it("posts a queued act entry to the endpoint as an OTLP logs payload on flush", async () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
		const producer = createPlayTelemetryProducer(
			{ enabled: true, worldSlug: "elven-mini-local-x" },
			{
				fetchFn,
				windowRef: fakeWindow,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
				runId: "run-1",
				actorId: "actor-1",
			},
		);

		producer.record(ACT_ENTRY);
		producer.flush();

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("/otlp");
		expect((init.headers as Record<string, string>)["stream-name"]).toBe("world_actor_run_events");
		const payload = JSON.parse(init.body as string);
		const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
		expect(payload.resourceLogs[0].resource.attributes).toContainEqual({
			key: "service.name",
			value: { stringValue: "spellkave-world-actors" },
		});
		const attributes = readAttributes(record);
		expect(attributes.event_type).toEqual({ stringValue: "tool_call" });
		expect(attributes.run_id).toEqual({ stringValue: "run-1" });
		expect(attributes["spellkave.tool_name"]).toEqual({
			stringValue: "spellkave_manipulate",
		});
		expect(attributes["spellkave.world_slug"]).toEqual({ stringValue: "elven-mini-local-x" });
		expect(attributes["spellkave.outcome"]).toEqual({ stringValue: "happened" });
	});

	it("batches every entry recorded before flush into one POST", () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
		const producer = createPlayTelemetryProducer(
			{ enabled: true, worldSlug: "w" },
			{ fetchFn, windowRef: fakeWindow },
		);
		producer.record(ACT_ENTRY);
		producer.record({ ...ACT_ENTRY, id: 2 });
		producer.flush();

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		const payload = JSON.parse(init.body as string);
		expect(payload.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(2);
	});

	it("never leaks a secret-shaped value that reached a forwarded field", () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
		const producer = createPlayTelemetryProducer(
			{ enabled: true, worldSlug: "w" },
			{ fetchFn, windowRef: fakeWindow },
		);
		const opaque = `sk_live_${"a".repeat(40)}`;
		producer.record({ ...ACT_ENTRY, actionId: opaque, targetRef: `Bearer ${opaque}` });
		producer.flush();

		const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(init.body as string).not.toContain(opaque);
	});

	it("reports a non-2xx response through onError", async () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "err" });
		const onError = vi.fn();
		const producer = createPlayTelemetryProducer(
			{ enabled: true, worldSlug: "w" },
			{ fetchFn, windowRef: fakeWindow, onError },
		);
		producer.record(ACT_ENTRY);
		producer.flush();
		await Promise.resolve();
		await Promise.resolve();
		expect(onError).toHaveBeenCalledTimes(1);
	});
});
