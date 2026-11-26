/** Structured UI milestones. No labels, speech, arguments, or error text. */

import type { SessionPhase } from "@spellkave/session";
import type { PlayOperations } from "./play-operations";
import { combatFromView, dialogueFromView, threadFromView } from "./play-table";
import type { PlayView } from "./play-view";

export type PlayIntent =
	| "move"
	| "act"
	| "dialog_choice"
	| "say"
	| "end_turn"
	| "react"
	| "inspect_item";
export type PlayMilestone =
	| "intent"
	| "tool_result"
	| "rendered"
	| "view"
	| "presentation"
	| "connection"
	| "feedback"
	| "logout";
export interface PlayObservation {
	phase: PlayMilestone;
	interaction: number;
	intent?: PlayIntent;
	action_surface?: "table" | "pack" | "place" | "map";
	origin_feedback?: "pending" | "shown" | "hidden";
	art_surface?: "table" | "pack" | "place";
	art_slot?: number;
	art_state?: "absent" | "loading" | "ready" | "error";
	map_state?: "closed" | "loading" | "blocked" | "ready" | "no-art" | "failed";
	outcome?: "returned" | "error" | "unavailable" | "happened" | "rejected" | "unknown";
	/** `play_connection` lifecycle (phase "connection"). `loading` starts the
	 * attempt; every terminal value below closes it so `loading` never dangles
	 * silently for a non-superseded attempt (sk-jay0.6.38.25, hardened by the
	 * #3477 RUM-lane review): `connected`/`error` end an actual `openSession`
	 * attempt, `stalled` is a non-terminal progress warning (a later
	 * `connected`/`error` still follows), `no_seat` closes the attempt when the
	 * account has no seat in the destination world — `App.svelte` routes to
	 * hero selection instead of ever calling `openSession` —, `world_not_ready`
	 * closes it the same way when the destination world itself is not yet
	 * playable in the browser (also no `openSession` call), and
	 * `world_starting` (sk-jay0.1.1.13) closes it the same way again when the
	 * seat exists but its world's catalog status is not yet "running" —
	 * `App.svelte` polls the account on a short backoff instead of ever
	 * calling `openSession`, and a LATER attempt for the same destination
	 * records its own `loading` → terminal pair once the poll finds it
	 * running. `world_start_timeout` (sk-jay0.1.1.13) closes it the same way
	 * once more when that poll has run for `worldStartingMaxMs` (default 5
	 * minutes) without the world ever reporting "running" — `App.svelte` gives
	 * up polling and shows the error gate with a manual retry instead. A
	 * superseded attempt (a dropped-socket reconnect or world switch that starts a new
	 * attempt while an old one is still in flight) is the one case that gets
	 * no terminal row of its own: its late callbacks are dropped so they
	 * cannot settle or suppress a DIFFERENT, newer attempt — see
	 * `createConnectionObserver`. `first_data` (sk-jay0.1.1.14) is a one-shot
	 * milestone that can only follow `connected` (never precedes or replaces
	 * it): the FIRST non-empty `PlayView` this attempt's session delivers
	 * (`viewHasData` below — any of actions/exits/occupants/pack/events/speech
	 * > 0), closing the gap between "transport connected" and "world data
	 * visible" that #3487 found (a connected, correctly-subscribed session for
	 * a quiet actor showed nothing, with no RUM signal distinguishing that from
	 * a stall). It shares `connected`'s attempt-scoping: dropped like every
	 * other late callback once the attempt is stopped or superseded, and never
	 * fires for an attempt that closed via `error`/`no_seat`/`world_not_ready`/
	 * `world_paused`/`world_starting`/`world_start_timeout` (none of those ever call
	 * `openSession`, so no view can arrive). */
	state?:
		| "loading"
		| "ready"
		| "error"
		| "disconnected"
		| "connected"
		| "stalled"
		| "first_data"
		| "no_seat"
		| "world_not_ready"
		| "world_paused"
		| "world_starting"
		| "world_start_timeout";
	/** `openSession` phase a connection `error` failed in (sk-jay0.6.38.25).
	 * Absent when the failure carried no phase (e.g. it happened before
	 * `connect()` returned a session at all). */
	connect_phase?: SessionPhase;
	/** `brawl` remains in the closed RUM vocabulary for historical events; Play no longer derives it from offer availability. */
	scene?: "explore" | "talk" | "fight" | "brawl" | "reaction" | "activity";
	activity_state?:
		| "active"
		| "waiting"
		| "completed"
		| "failed"
		| "abandoned"
		| "unknown"
		| "unavailable"
		| "absent";
	activity_mounted?: boolean;
	activity_clock_unchanged?: boolean;
	activity_progress?: number;
	choice?: number;
	selection?: number;
	tick?: number;
	duration_ms?: number;
	actions?: number;
	exits?: number;
	occupants?: number;
	pack?: number;
	feedback?: boolean;
	receipt?: boolean;
	my_turn?: boolean;
	speech_count?: number;
	thread_count?: number;
	dialogue?: boolean;
	conversation_mounted?: boolean;
	conversation_lines?: number;
	/** The turn bar's own economy strip mounted (S4, sk-jay0.1.8.40 mount
	 * step), the same bounded-count pattern as `conversation_mounted`. */
	economy_mounted?: boolean;
	/** Channels drawn in that strip — a count only, never a channel id. */
	economy_lines?: number;
	surface?: "hero_vitals" | "hero_quest" | "hero_conditions" | "item_detail";
	detail_state?: "closed" | "loading" | "ready" | "empty" | "error" | "unknown";
	supplied_fields?: number;
	represented_fields?: number;
	disclosed_fields?: number;
	description_scope?: "table" | "item";
	available_descriptions?: number;
	mounted_descriptions?: number;
	reachable_descriptions?: number;
	expanded_descriptions?: number;
	awaiting_response?: boolean;
	admission?: "rejected" | "unobserved" | "not_offered" | "in_flight";
	result_kind?: "happened" | "rejected" | "quiet" | "undescribable";
	feedback_state?:
		| "opened"
		| "unavailable"
		| "sending"
		| "sent"
		| "failed"
		| "rate_limited"
		| "closed";
}

/**
 * "Non-empty" for the `first_data` milestone (sk-jay0.1.1.14): any of
 * actions/exits/occupants/pack/events/speech carries at least one row. A
 * connected session for a quiet actor in an empty scene (nothing to act on,
 * nobody present, no history yet) can legitimately answer every read with
 * zero rows for a while — that is not evidence of a stall, so this check
 * intentionally ignores `hero`/`session`/`place` presence and every other
 * `PlayView` field. Exported so `App.svelte` and this module's own tests
 * share one definition instead of two hand-copied field lists drifting apart.
 */
export function viewHasData(view: PlayView): boolean {
	return (
		view.actions.length > 0 ||
		(view.place?.exits.length ?? 0) > 0 ||
		view.occupants.length > 0 ||
		view.pack.length > 0 ||
		view.events.length > 0 ||
		view.speech.length > 0
	);
}

export function observationView(view: PlayView | null): Partial<PlayObservation> {
	if (view === null) return {};
	const combat = combatFromView(view);
	return {
		scene:
			view.reaction !== null
				? "reaction"
				: combat !== null
					? "fight"
					: dialogueFromView(view) !== null
						? "talk"
						: view.operations?.selected && !view.operations.selected.terminal
							? "activity"
							: "explore",
		tick: Math.max(0, ...view.events.map((e) => e.tick), ...view.speech.map((s) => s.tick)),
		actions: view.actions.length,
		exits: view.place?.exits.length ?? 0,
		occupants: view.occupants.length,
		pack: view.pack.length,
		my_turn: view.session.myTurn,
		speech_count: view.speech.length,
		thread_count: threadFromView(view).lines.length,
		dialogue: dialogueFromView(view) !== null,
	};
}

/** Bounded presentation facts only; never export operation identifiers or prose. */
export function activityObservation(
	operations: PlayOperations | undefined,
	mounted: boolean,
): PlayObservation {
	const phase = operations?.selected?.phase;
	const state: PlayObservation["activity_state"] =
		operations?.state === "failed"
			? "unavailable"
			: !operations?.selected
				? "absent"
				: phase === "waiting-on-external"
					? "waiting"
					: phase === "active" ||
							phase === "completed" ||
							phase === "failed" ||
							phase === "abandoned"
						? phase
						: "unknown";
	return {
		phase: "presentation",
		interaction: 0,
		activity_state: state,
		activity_mounted: mounted,
		...(mounted && operations?.selected?.clockUnchanged !== undefined
			? { activity_clock_unchanged: operations.selected.clockUnchanged }
			: {}),
		...(mounted && operations?.selected?.progress != null
			? { activity_progress: operations.selected.progress }
			: {}),
	};
}

export function createPlayObservation() {
	let next = 0;
	let sink: ((event: PlayObservation) => void) | undefined;
	function record(event: PlayObservation) {
		try {
			sink?.(event);
		} catch {
			/* Observability cannot interrupt play. */
		}
	}
	return {
		subscribe(nextSink: (event: PlayObservation) => void) {
			sink = nextSink;
		},
		begin(intent: PlayIntent, context: Partial<PlayObservation> = {}) {
			const interaction = ++next;
			record({ ...context, phase: "intent", interaction, intent });
			return interaction;
		},
		finish(interaction: number, context: Partial<PlayObservation>) {
			record({ ...context, phase: "rendered", interaction });
		},
		record,
	};
}

export const playObservation = createPlayObservation();

/**
 * How long a connect attempt may sit with no `connected`/`error` milestone
 * before Play records a `stalled` one (sk-jay0.6.38.25 / #3464: the client
 * stalled silently after "Connecting to SpacetimeDB WS…" for 80s+ with no
 * terminal RUM event). 10s must fire before either `openSession` phase bound
 * (`PLAY_CONNECT_PHASE_TIMEOUT_MS`, 30s each, Play-only, in
 * `packages/spellkave-session/src/session.ts`) so a slow connect is never
 * silent for the whole 30s+ a phase timeout can legitimately take — the
 * intended sequence is `loading` → `stalled` (10s) → `connected`/`error`
 * (≤30s per phase). A live hosted connect measured ~10s wall-clock end to
 * end during review, so this is a warning threshold, not a "something is
 * wrong" one.
 */
export const CONNECT_STALLED_MS = 10_000;

export interface ConnectionObserverDeps {
	/** Monotonic-enough clock; overridden in tests. Defaults to `Date.now()`. */
	now?: () => number;
	/** Overrides `CONNECT_STALLED_MS`; test seam only. */
	stalledMs?: number;
	/** Defaults to `playObservation.record`; test seam. */
	record?: (event: PlayObservation) => void;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

/** One connect attempt's callbacks, scoped to that attempt (returned by
 * `createConnectionObserver().start()`). Wire `onPhase`/`onError` straight
 * from `openPlaySession`'s `OpenPlaySessionArgs`. */
export interface ConnectAttempt {
	/** Forward verbatim from `OpenPlaySessionArgs.onPhase`; the elapsed-ms
	 * argument that hook carries is per-phase and not used here — `connected`
	 * reports elapsed time for the whole attempt, from `start()`. A no-op once
	 * a LATER `start()` call has superseded this attempt. */
	onPhase(phase: SessionPhase, elapsedMs?: number): void;
	/** Forward from a failed connect (`OpenPlaySessionArgs.onError`, or a
	 * rejected `worldOpener(...)` call). Idempotent after `onPhase` already
	 * settled this attempt as connected, and a no-op once superseded. Safe to
	 * call speculatively (e.g. from an outer `.catch` that does not know
	 * whether this attempt already settled through `onError`/`onPhase`
	 * elsewhere). */
	onError(error: unknown): void;
	/** Close this attempt as a terminal state that never involves an
	 * `openSession` call at all — `no_seat` (no seat in the destination
	 * world), `world_not_ready` (the destination itself is not yet playable
	 * in the browser), `world_paused` (the operator intentionally stopped the
	 * destination's NPC host), `world_starting` (sk-jay0.1.1.13: the seat exists but
	 * its world's catalog status is not yet "running" — `App.svelte` polls
	 * the account on a short backoff and a LATER attempt records its own
	 * terminal row once it finds the world running), or `world_start_timeout`
	 * (sk-jay0.1.1.13: that poll ran for `worldStartingMaxMs` without the
	 * world ever reporting "running", so `App.svelte` gives up and shows the
	 * error gate instead of polling forever). Same idempotency and
	 * generation-scoping as `onError`: a no-op once this attempt already
	 * settled or was superseded. Callers should create the attempt handle
	 * right where "loading" is emitted and route every terminal branch —
	 * including these five — through it, so a throw anywhere after "loading"
	 * still closes the right attempt (#3482 re-review of #3477). */
	settle(
		state:
			| "no_seat"
			| "world_not_ready"
			| "world_paused"
			| "world_starting"
			| "world_start_timeout",
	): void;
	/** Cancel this attempt's pending stall timer and permanently disable it
	 * (component teardown / cancellation). Unlike `onPhase`/`onError`, this
	 * takes effect immediately even if no later `start()` ever runs — a
	 * cancelled attempt that nothing has superseded yet must not record a
	 * late `connected`/`error`/`no_seat`/`world_not_ready` of its own (#3482
	 * re-review of #3477). This disables the HANDLE, not the underlying
	 * generation's chance of a terminal: if no later `start()` ever supersedes
	 * it, the observer's own `abandon()` still closes it out (#3482 re-review
	 * of #3477 nit) — see `createConnectionObserver`. */
	stop(): void;
	/**
	 * Record the `first_data` milestone (sk-jay0.1.1.14): call once, from
	 * `App.svelte`'s `onView`, the first time this attempt's session delivers
	 * a non-empty `PlayView` (`viewHasData` above). A no-op before `connected`
	 * has fired for this same attempt (an attempt that never reaches
	 * `openSession`'s `factual_context` phase has nothing to call this from —
	 * `App.svelte` only wires `onView` to a live `worldOpener` session), after
	 * it has already fired once for this attempt, or once this attempt is
	 * stopped/superseded — the same `current()` scoping every other method on
	 * this interface uses.
	 */
	firstData(): void;
}

/**
 * Turns connect attempts' `onPhase`/error callbacks into the `play_connection`
 * `connected`/`error`/`stalled` milestones (sk-jay0.6.38.25). Framework-free
 * so it can be unit tested without mounting `App.svelte`.
 *
 * One observer instance is reused across reconnects; `start()` returns a
 * handle SCOPED TO THAT ATTEMPT (an internal generation counter). This
 * matters because a dropped-socket reconnect or world switch can start a new attempt
 * while an old `openSession` call is still in flight (#3477 RUM-lane review):
 * before this, a shared `onPhase`/`onError` pair had no way to tell which
 * attempt a late callback belonged to, so the OLD attempt's late
 * `factual_context`/error could record `connected`/`error` against the NEW
 * attempt's `startedAt` and mark it settled, silently suppressing the new
 * attempt's own `stalled` warning too. Once a later `start()` has run, an
 * earlier handle's `onPhase`/`onError`/`settle`/`stop` are permanent no-ops —
 * the superseded attempt gets no terminal row of its own (see
 * `hosted-play-rum.md`'s "Connect lifecycle" section for how a `rum timeline`
 * read should account for that). Separately, a handle's own `stop()` also
 * makes it permanently dead even with no later `start()` — a cancelled
 * attempt that nothing has superseded yet (component teardown, or the new
 * destination ending in `no_seat`/`world_not_ready` so no NEW `start()` ever
 * runs) must not record a late `connected`/`error` of its own either (#3482
 * re-review of #3477).
 *
 * `connected` fires once per attempt, on the LAST `openSession` phase
 * (`factual_context`) — reaching it means the WS opened, the actor
 * resolved, and the actor's factual context became ready, i.e. the exact stall this
 * bead exists to make visible. A `stalled` firing does not stop a LATER
 * `connected`/`error` from being recorded — both a stall and its eventual
 * resolution stay visible in the timeline.
 *
 * `stop()` must disable its handle the instant it is called — before its
 * caller can know whether a LATER `start()` is coming — so a genuinely
 * abandoned attempt (nothing ever supersedes it: e.g. `App.svelte`'s connect
 * effect bails out at `subject === undefined` with no new attempt this cycle)
 * would otherwise leave "loading" with no terminal forever. `abandon()` is
 * the other half of that fix (#3482 re-review of #3477 nit): called from a
 * code path that itself starts no new attempt, it closes the current
 * generation with a phase-less `error` if `stop()` was the last thing to
 * touch it, and is a no-op if a later `start()` already superseded it or it
 * already settled on its own.
 */
export function createConnectionObserver(deps: ConnectionObserverDeps = {}) {
	const now = deps.now ?? (() => Date.now());
	const stalledMs = deps.stalledMs ?? CONNECT_STALLED_MS;
	const record = deps.record ?? playObservation.record;
	const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
	const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as number));

	let generation = 0;
	let startedAt = 0;
	let settled = false;
	/** Set once `connected` has recorded for the CURRENT generation; `null`
	 * before that (or after a fresh `start()` reset it). `firstData()` gates
	 * on this rather than on `settled` alone, since `settled` also becomes
	 * true for every other terminal (`error`/`no_seat`/…) that `first_data`
	 * must never follow. */
	let connectedAt: number | null = null;
	/** `first_data` fires at most once per attempt (sk-jay0.1.1.14) — reset by
	 * every `start()`, same shape as `settled`. */
	let firstDataRecorded = false;
	let timer: unknown;
	/** True once the CURRENT generation's handle has been `stop()`ed. Reset by
	 * every `start()`. `stop()` itself must disable its handle immediately —
	 * before its caller can know whether a later attempt will supersede it —
	 * so this is the only place that memory survives past `stop()`, letting
	 * `abandon()` tell "stopped, nothing has superseded it" apart from "still
	 * live" or "already superseded" (#3482 re-review of #3477 nit). */
	let stoppedCurrent = false;

	function clear(): void {
		if (timer !== undefined) {
			clearTimer(timer);
			timer = undefined;
		}
	}

	return {
		/** Call once, right as a NEW connect attempt begins (alongside
		 * "loading"). Supersedes any handle returned by an earlier `start()`. */
		start(): ConnectAttempt {
			generation += 1;
			const myGeneration = generation;
			/** Set by THIS handle's own `stop()`. Distinct from generation
			 * scoping: `stop()` must disable the handle even if no later
			 * `start()` ever supersedes it (a cancelled attempt that nothing
			 * has superseded yet — #3482 re-review). */
			let dead = false;
			const current = (): boolean => myGeneration === generation && !dead;
			startedAt = now();
			settled = false;
			connectedAt = null;
			firstDataRecorded = false;
			stoppedCurrent = false;
			clear();
			timer = setTimer(() => {
				if (!current() || settled) return;
				record({ phase: "connection", interaction: 0, state: "stalled" });
			}, stalledMs);
			return {
				onPhase(phase, _elapsedMs) {
					if (!current() || phase !== "factual_context" || settled) return;
					settled = true;
					connectedAt = now();
					clear();
					record({
						phase: "connection",
						interaction: 0,
						state: "connected",
						duration_ms: connectedAt - startedAt,
					});
				},
				onError(error) {
					if (!current() || settled) return;
					settled = true;
					clear();
					const phase =
						error instanceof Error ? (error as Error & { phase?: unknown }).phase : undefined;
					const knownPhase: SessionPhase[] = ["ready", "setup", "resolve_actor", "factual_context"];
					record({
						phase: "connection",
						interaction: 0,
						state: "error",
						...(typeof phase === "string" && (knownPhase as string[]).includes(phase)
							? { connect_phase: phase as SessionPhase }
							: {}),
					});
				},
				settle(state) {
					if (!current() || settled) return;
					settled = true;
					clear();
					record({ phase: "connection", interaction: 0, state });
				},
				stop() {
					dead = true;
					if (myGeneration === generation) {
						clear();
						stoppedCurrent = true;
					}
				},
				firstData() {
					if (!current() || connectedAt === null || firstDataRecorded) return;
					firstDataRecorded = true;
					record({
						phase: "connection",
						interaction: 0,
						state: "first_data",
						// Same baseline as `connected`'s own `duration_ms` (wall-clock
						// since `loading`) — comparable across the two rows in a
						// `rum timeline` read rather than a second, differently-anchored
						// clock.
						duration_ms: now() - startedAt,
					});
				},
			};
		},
		/** Call from a code path that itself calls no `start()` this cycle and
		 * so knows no attempt will supersede whatever is current (e.g.
		 * `App.svelte`'s connect effect, at its own `subject === undefined`
		 * bail-out, right after the previous attempt's cleanup already ran
		 * `stop()`). A no-op unless the current generation was `stop()`ed but
		 * never itself settled: closes it with a phase-less `error` so a
		 * cancellation with no follow-up attempt does not leave "loading" with
		 * nothing after it forever (#3482 re-review of #3477 nit). Does
		 * nothing to an attempt that already settled, or one a later `start()`
		 * has superseded (that `start()` already reset `stoppedCurrent`) —
		 * both keep their existing, correct behavior. */
		abandon(): void {
			if (!stoppedCurrent || settled) return;
			settled = true;
			record({ phase: "connection", interaction: 0, state: "error" });
		},
	};
}

/** Closed projection is re-applied at the exporter boundary. */
export function projectObservation(
	event: PlayObservation,
): Record<string, string | number | boolean> {
	const result: Record<string, string | number | boolean> = {};
	const enums: Record<string, readonly string[]> = {
		action_surface: ["table", "pack", "place", "map"],
		origin_feedback: ["pending", "shown", "hidden"],
		art_surface: ["table", "pack", "place"],
		art_state: ["absent", "loading", "ready", "error"],
		map_state: ["closed", "loading", "blocked", "ready", "no-art", "failed"],
		description_scope: ["table", "item"],
		surface: ["hero_vitals", "hero_quest", "hero_conditions", "item_detail"],
		detail_state: ["closed", "loading", "ready", "empty", "error", "unknown"],
		phase: [
			"intent",
			"tool_result",
			"rendered",
			"view",
			"presentation",
			"connection",
			"logout",
			"feedback",
		],
		intent: ["move", "act", "dialog_choice", "say", "end_turn", "react", "inspect_item"],
		outcome: ["returned", "error", "unavailable", "happened", "rejected", "unknown"],
		state: [
			"loading",
			"ready",
			"error",
			"disconnected",
			"connected",
			"stalled",
			"first_data",
			"no_seat",
			"world_not_ready",
			"world_paused",
			"world_starting",
			"world_start_timeout",
		],
		connect_phase: ["ready", "setup", "resolve_actor", "factual_context"],
		scene: ["explore", "talk", "fight", "brawl", "reaction", "activity"],
		activity_state: [
			"active",
			"waiting",
			"completed",
			"failed",
			"abandoned",
			"unknown",
			"unavailable",
			"absent",
		],
		admission: ["rejected", "unobserved", "not_offered", "in_flight"],
		result_kind: ["happened", "rejected", "quiet", "undescribable"],
		feedback_state: [
			"opened",
			"unavailable",
			"sending",
			"sent",
			"failed",
			"rate_limited",
			"closed",
		],
	};
	for (const [key, values] of Object.entries(enums)) {
		const value = (event as unknown as Record<string, unknown>)[key];
		if (typeof value === "string" && values.includes(value)) result[`spellkave_${key}`] = value;
	}
	for (const key of [
		"interaction",
		"choice",
		"selection",
		"art_slot",
		"tick",
		"duration_ms",
		"actions",
		"exits",
		"occupants",
		"pack",
		"speech_count",
		"thread_count",
		"conversation_lines",
		"economy_lines",
		"supplied_fields",
		"represented_fields",
		"disclosed_fields",
		"available_descriptions",
		"mounted_descriptions",
		"reachable_descriptions",
		"expanded_descriptions",
	] as const) {
		const value = event[key];
		if (
			typeof value === "number" &&
			Number.isFinite(value) &&
			value >= 0 &&
			value <= Number.MAX_SAFE_INTEGER
		)
			result[`spellkave_${key}`] = Math.round(value);
	}
	if (
		typeof event.activity_progress === "number" &&
		Number.isFinite(event.activity_progress) &&
		event.activity_progress >= 0 &&
		event.activity_progress <= 100
	)
		result.spellkave_activity_progress = Math.round(event.activity_progress);
	for (const key of [
		"activity_mounted",
		"activity_clock_unchanged",
		"feedback",
		"receipt",
		"my_turn",
		"dialogue",
		"awaiting_response",
		"conversation_mounted",
		"economy_mounted",
	] as const) {
		if (typeof event[key] === "boolean") result[`spellkave_${key}`] = event[key];
	}
	return result;
}
