/**
 * The browser producer for `world_actor_run_events` (sk-jay0.6.39) — co-play
 * 2026-09-03 found `apps/play` emitting no telemetry at all, so a local
 * co-play was invisible to `/telemetry-query`. This module turns every
 * `play-trail.ts` entry (`act`, `read`, `world_pull`, `layout`, `tool_error`)
 * into one `agent-run-events/v1` line and posts it as OTLP/HTTP logs, using
 * the same envelope shape and `world_actor_run_events` stream the NPC/actor
 * hosts and the MCP gateway already write
 * (`.agents/skills/sk-o11y/references/instrumentation.md`,
 * `packages/spellkave-agent-observability/src/otel.ts`).
 *
 * Two producers were on the table for this bead (operator ruling
 * 2026-09-03, this bead's notes). This module is producer (1) only:
 * local/dev, through the vite dev-server proxy, off by default. Producer
 * (2) — a public RUM SDK for deployed browsers — is its own bead behind a
 * security gate; nothing here is reachable from a deployed page (see
 * `readRunEvents` in `../../vite.config.ts`, which hard-disables this
 * outside `mode !== "production"`).
 *
 * Deliberately does NOT reuse `createOtlpHttpSink`/`toOtlpLogRecord` from
 * `@spellkave/agent-observability`: those build on `OTEL_SAFE_EVENT_DATA_FIELDS`,
 * a fixed allowlist this bead's lane does not include editing. Play's own
 * fields (`tile`, `level`, `trigger`, `client_kind`) are therefore projected
 * by a small LOCAL allowlist (`PLAY_SAFE_EVENT_DATA_FIELDS` below) instead —
 * `toOtlpPayload` (the resource/scope wrapper, which does not touch event
 * data) is still reused so the exported resource shape
 * (`service.name: "spellkave-world-actors"`) matches every other producer
 * byte for byte.
 */

import runEventsConfigRaw from "virtual:spellkave-run-events-config";
import {
	type AgentRunEvent,
	type AgentRunEventType,
	createRunEmitter,
	OTEL_STREAM_NAME,
	toOtlpPayload,
} from "@spellkave/agent-observability";
import type { PlayTrailEntry } from "./play-trail";

/** Resolved server-side by `vite.config.ts` from shell env (never a browser
 * knob the operator has to set separately): `enabled` requires
 * `VITE_SPELLKAVE_RUN_EVENTS=otlp` (or `SPELLKAVE_RUN_EVENTS=otlp`) AND a
 * configured `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT` AND a non-empty
 * `SPELLKAVE_WORLD_SLUG` AND `mode !== "production"`. The collector address
 * itself never reaches this config — only the vite dev-server proxy
 * (`/otlp`) knows it. */
export interface PlayRunEventsConfig {
	enabled: boolean;
	worldSlug: string;
}

function parseRunEventsConfig(raw: unknown): PlayRunEventsConfig {
	if (typeof raw !== "string" || raw.trim() === "" || raw.trim() === "null") {
		return { enabled: false, worldSlug: "" };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { enabled: false, worldSlug: "" };
	}
	if (typeof value !== "object" || value === null) return { enabled: false, worldSlug: "" };
	const record = value as Record<string, unknown>;
	const worldSlug = typeof record.worldSlug === "string" ? record.worldSlug.trim() : "";
	return { enabled: record.enabled === true && worldSlug !== "", worldSlug };
}

/** The config this dev/build resolved to. Parsed once at module load, same
 * pattern `dev-local.ts` uses for its own virtual module. */
export const playRunEventsConfig: PlayRunEventsConfig = parseRunEventsConfig(runEventsConfigRaw);

// ── Redaction (defense in depth) ────────────────────────────────────────
//
// `play-trail.ts` already redacts every free-text field before an entry
// ever reaches the ring buffer (`redactTrailText`), and this producer only
// ever forwards short id/enum-shaped fields, never `words`/`observation`/
// `message` (ADR-0002 discipline: never copy speech, arguments, or result
// text into shared telemetry). This module re-applies the same class of
// scrub independently rather than importing `redactTrailText` from
// `./play-trail`, so: (a) this file stays a fully independent safety net —
// its own unit test proves no secret survives even if the trail's own
// redaction ever regressed — and (b) `play-trail.ts` (which wires this
// module's singleton at the bottom) never gains a reverse runtime import
// back into this one.
const BEARER_PATTERN = /\bBearer\s+\S+/gi;
const JWT_PATTERN = /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
// A bare 32+ character alphanumeric/hyphen/underscore run reads as an opaque
// secret (session id, API key) with no recognizable shape — EXCEPT
// `world_slug`, which is exempted below: it is derived server-side from a
// branch name (`vite.config.ts`'s `readRunEvents`, never player/session
// input) and routinely crosses 32 characters on a long branch name
// (`elven-mini-local-feat-play-telemetry` is 36 — confirmed live,
// sk-jay0.6.39: an early version of this file redacted the join key itself
// away, "[redacted]", turning every row silently unqueryable by slug).
const OPAQUE_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;
const REDACTED = "[redacted]";
const MAX_FIELD_LENGTH = 256;
const OPAQUE_CHECK_EXEMPT_FIELDS = new Set<string>(["world_slug"]);

function redactScalarText(value: string, key: string): string {
	const skipOpaqueCheck = OPAQUE_CHECK_EXEMPT_FIELDS.has(key);
	let scrubbed = value.replace(BEARER_PATTERN, REDACTED).replace(JWT_PATTERN, REDACTED);
	if (!skipOpaqueCheck) scrubbed = scrubbed.replace(OPAQUE_TOKEN_PATTERN, REDACTED);
	return scrubbed.slice(0, MAX_FIELD_LENGTH);
}

// ── Play's own OTLP disclosure boundary ─────────────────────────────────
//
// Scalar-only, closed list — the shared package's `OTEL_SAFE_EVENT_DATA_FIELDS`
// plus the Play-only fields this bead adds (`client_kind`, `tile`, `level`,
// `trigger`). Never `words`, `observation`, or `message` (arbitrary
// player/tool text).
const PLAY_SAFE_EVENT_DATA_FIELDS = [
	"world_slug",
	"tool_name",
	"duration_ms",
	"outcome",
	"is_error",
	"action_id",
	"target_ref",
	"client_kind",
	"tile",
	"level",
	"trigger",
] as const;

type PlaySafeEventDataField = (typeof PLAY_SAFE_EVENT_DATA_FIELDS)[number];
type PlaySafeScalar = string | number | boolean;

function safeScalar(value: unknown, key: string): PlaySafeScalar | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") return redactScalarText(value, key);
	return undefined;
}

/** Central, allowlisted projection — unknown/nested/content-bearing fields
 * are dropped even when a caller supplies them. This is the function this
 * bead's "no secret can enter a row" unit test proves directly. */
export function projectPlayEventData(
	data: Readonly<Record<string, unknown>>,
): Partial<Record<PlaySafeEventDataField, PlaySafeScalar>> {
	const projected: Partial<Record<PlaySafeEventDataField, PlaySafeScalar>> = {};
	for (const key of PLAY_SAFE_EVENT_DATA_FIELDS) {
		const value = safeScalar(data[key], key);
		if (value !== undefined) projected[key] = value;
	}
	return projected;
}

function otlpAttribute(key: string, value: PlaySafeScalar): Record<string, unknown> {
	if (typeof value === "boolean") return { key, value: { boolValue: value } };
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { key, value: { intValue: String(value) } }
			: { key, value: { doubleValue: value } };
	}
	return { key, value: { stringValue: value } };
}

/** Maps one emitted event to an OTLP LogRecord using only
 * `projectPlayEventData`. Mirrors `toOtlpLogRecord` in
 * `@spellkave/agent-observability` (bare envelope attributes, `spellkave.`
 * prefixed data attributes) so a query written against the host producers'
 * rows (`event_type`, `driver`, `spellkave_world_slug`, ...) reads Play's
 * rows the same way — see
 * `.agents/skills/sk-o11y/references/querying.md`. */
export function toPlayLogRecord(event: AgentRunEvent): Record<string, unknown> {
	const envelope = {
		run_id: event.run_id,
		run_kind: event.run_kind,
		actor_id: event.actor_id,
		role: event.role,
		controller_kind: event.controller_kind,
		driver: event.driver,
		seed: event.seed,
		event_type: event.type,
	};
	const data = projectPlayEventData(event.data);
	const attributes = [
		...Object.entries(envelope).map(([key, value]) =>
			otlpAttribute(key, String(value).slice(0, MAX_FIELD_LENGTH)),
		),
		...Object.entries(data).map(([key, value]) => otlpAttribute(`spellkave.${key}`, value)),
	];
	return {
		timeUnixNano: `${Date.parse(event.ts)}000000`,
		severityText: "INFO",
		body: { stringValue: JSON.stringify({ type: event.type, data }) },
		attributes,
	};
}

/** `play-web` distinguishes this producer's rows from `remote-mcp`,
 * `sk-daemon`, `srd-cc-npc-host-<adventure>`, and every other `driver`
 * value already on the stream. */
export const PLAY_RUN_EVENTS_DRIVER = "play-web";

/**
 * `AgentRunEventType` (`events.ts`) is a closed literal union, unlike
 * `RunKind`/`ControllerKind` in the same file, which stay open via
 * `(string & {})` specifically so producers can add vocabulary. The
 * module's own doc says new event types ARE meant to be additive — "readers
 * are unknown-type-tolerant by contract" — so this cast documents an
 * intentional, reader-safe extension rather than working around a real type
 * error; widening the union itself is a change to `events.ts`, out of this
 * bead's lane.
 */
const PLAY_CLIENT_EVENT_TYPE = "play_client_event" as AgentRunEventType;

/**
 * Maps one trail entry to an `(type, data)` pair for `RunEmitter.emit`.
 *
 * - `act` → `tool_call` (`tool_name`/`duration_ms`/`outcome`/`action_id`/
 *   `target_ref`), the shape this bead's acceptance queries for.
 * - `tool_error` → `tool_call` with `is_error: true` (never the error
 *   `message` — arbitrary text).
 * - `read`/`world_pull`/`layout` → one Play-only `play_client_event` type,
 *   distinguished by `client_kind` (per the bead's design: "a Play-only
 *   event type for layout changes and reads").
 */
export function mapTrailEntryToEmit(
	entry: PlayTrailEntry,
	worldSlug: string,
): { type: AgentRunEventType; data: Record<string, unknown> } {
	const worldData = { world_slug: worldSlug };
	switch (entry.kind) {
		case "act":
			return {
				type: "tool_call",
				data: {
					...worldData,
					tool_name: entry.tool,
					duration_ms: entry.durationMs,
					outcome: entry.outcome ?? undefined,
					action_id: entry.actionId ?? undefined,
					target_ref: entry.targetRef ?? undefined,
					is_error: false,
				},
			};
		case "tool_error":
			return {
				type: "tool_call",
				data: { ...worldData, tool_name: entry.tool, is_error: true },
			};
		case "read":
			return {
				type: PLAY_CLIENT_EVENT_TYPE,
				data: { ...worldData, tool_name: entry.tool, client_kind: "read" },
			};
		case "world_pull":
			return {
				type: PLAY_CLIENT_EVENT_TYPE,
				data: { ...worldData, tool_name: entry.tool, client_kind: "world_pull" },
			};
		case "layout":
			return {
				type: PLAY_CLIENT_EVENT_TYPE,
				data: {
					...worldData,
					client_kind: "layout",
					tile: entry.tile,
					level: entry.level,
					trigger: entry.trigger,
				},
			};
	}
}

export interface PlayTelemetryProducer {
	/** Feeds one trail entry in. A no-op (never touches the network) when
	 * the resolved config was `enabled: false`. */
	record(entry: PlayTrailEntry): void;
	/** Flushes the pending batch immediately — also called on `pagehide` so
	 * the last click before navigation is not lost in the flush delay. */
	flush(): void;
}

export interface CreatePlayTelemetryProducerOptions {
	/** Relative path the vite dev-server proxy intercepts. Never a full
	 * collector URL — that address lives only in the proxy config
	 * (`vite.config.ts`), server-side. */
	endpoint?: string;
	fetchFn?: typeof fetch;
	onError?: (error: unknown) => void;
	now?: () => Date;
	runId?: string;
	actorId?: string;
	/** Debounce window before a batch POSTs. Default 250ms. */
	flushDelayMs?: number;
	windowRef?: Window;
}

const NO_OP_PRODUCER: PlayTelemetryProducer = {
	record() {},
	flush() {},
};

/**
 * Builds one producer. Returns the shared `NO_OP_PRODUCER` when
 * `config.enabled` is false — the shape this bead's "nothing is sent when
 * the flag is unset" unit test proves (no emitter, no sink, no timer, no
 * fetch is ever constructed).
 */
export function createPlayTelemetryProducer(
	config: PlayRunEventsConfig,
	options: CreatePlayTelemetryProducerOptions = {},
): PlayTelemetryProducer {
	if (!config.enabled) return NO_OP_PRODUCER;

	const endpoint = options.endpoint ?? "/otlp";
	const doFetch = options.fetchFn ?? (typeof fetch === "undefined" ? undefined : fetch);
	const now = options.now ?? (() => new Date());
	const runId =
		options.runId ??
		(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: `play-${Date.now()}`);
	// No per-player actor id is available at this module's construction time
	// (the trail singleton wires this producer before any session opens, and
	// trail entries carry no actor identity) — this producer's join key is
	// `spellkave_world_slug` + `spellkave_tool_name`, not `actor_id`.
	const actorId = options.actorId ?? "play-client";
	const flushDelayMs = options.flushDelayMs ?? 250;

	let queue: Record<string, unknown>[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;

	function flush(): void {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (queue.length === 0 || doFetch === undefined) {
			queue = [];
			return;
		}
		const records = queue;
		queue = [];
		const payload = toOtlpPayload(records);
		try {
			const request = doFetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json", "stream-name": OTEL_STREAM_NAME },
				body: JSON.stringify(payload),
				keepalive: true,
			});
			Promise.resolve(request)
				.then((response) => {
					if (!response.ok) {
						throw new Error(
							`play run-events export failed: ${response.status} ${response.statusText}`,
						);
					}
				})
				.catch((error) => options.onError?.(error));
		} catch (error) {
			options.onError?.(error);
		}
	}

	function scheduleFlush(): void {
		if (timer !== undefined) return;
		timer = setTimeout(flush, flushDelayMs);
	}

	const emitter = createRunEmitter(
		{
			run_id: runId,
			run_kind: "campaign_playthrough",
			actor_id: actorId,
			role: "PLAYER",
			controller_kind: "human",
			driver: PLAY_RUN_EVENTS_DRIVER,
			seed: "",
			now,
		},
		[
			{
				write(event) {
					queue.push(toPlayLogRecord(event));
					scheduleFlush();
				},
			},
		],
	);

	const windowRef = options.windowRef ?? (typeof window === "undefined" ? undefined : window);
	windowRef?.addEventListener("pagehide", flush);

	return {
		record(entry) {
			const mapped = mapTrailEntryToEmit(entry, config.worldSlug);
			emitter.emit(mapped.type, mapped.data);
		},
		flush,
	};
}

/**
 * The one producer the running app shares, wired onto the `playTrail`
 * singleton from `play-trail.ts`. `MODE !== "test"` keeps every vitest run
 * network-free even if a stray env var made `playRunEventsConfig.enabled`
 * true — the same defensive pattern `play-trail.ts` uses for its own
 * `console.debug` mirror.
 */
export const playTelemetryProducer: PlayTelemetryProducer =
	import.meta.env.MODE === "test"
		? NO_OP_PRODUCER
		: createPlayTelemetryProducer(playRunEventsConfig);
