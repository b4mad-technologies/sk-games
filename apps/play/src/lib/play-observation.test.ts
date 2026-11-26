import { describe, expect, it } from "vitest";
import { sampleView, talkView } from "../test/sample-view";
import { readLocalRumConfig } from "./local-rum-config";
import {
	activityObservation,
	CONNECT_STALLED_MS,
	createConnectionObserver,
	createPlayObservation,
	observationView,
	type PlayObservation,
	projectObservation,
	viewHasData,
} from "./play-observation";
import { operationsFromPayload } from "./play-operations";

describe("diagnostic boundaries", () => {
	it("records activity lifecycle without inferring completion or exporting private fields", () => {
		const operations = operationsFromPayload({
			status: "session_detail",
			session: {
				session_id: "12345",
				label: "Private activity",
				lifecycle: "waiting-on-external",
				timing: { basis: "world_ticks", duration_ticks: "4", estimated_remaining_ticks: "0" },
			},
		});
		expect(projectObservation(activityObservation(operations, true))).toEqual({
			spellkave_phase: "presentation",
			spellkave_interaction: 0,
			spellkave_activity_state: "waiting",
			spellkave_activity_mounted: true,
			spellkave_activity_progress: 100,
		});
		expect(projectObservation(activityObservation(operations, false))).not.toHaveProperty(
			"spellkave_activity_progress",
		);
		expect(activityObservation(operationsFromPayload({}), false).activity_state).toBe(
			"unavailable",
		);
		expect(activityObservation(undefined, false).activity_state).toBe("absent");
		for (const activity_progress of [-1, 101, Infinity, NaN])
			expect(
				projectObservation({ phase: "presentation", interaction: 0, activity_progress }),
			).not.toHaveProperty("spellkave_activity_progress");
	});

	it("exports only the closed action-origin vocabulary", () => {
		expect(
			projectObservation({ phase: "intent", interaction: 1, action_surface: "pack" }),
		).toMatchObject({ spellkave_action_surface: "pack" });
		expect(
			projectObservation({
				phase: "intent",
				interaction: 1,
				action_surface: "private item name",
			} as unknown as PlayObservation),
		).not.toHaveProperty("spellkave_action_surface");
	});
	it("exports presentation counts without conversation content", () => {
		expect(
			projectObservation({
				phase: "presentation",
				interaction: 0,
				conversation_mounted: true,
				conversation_lines: 3,
				text: "private words",
			} as unknown as PlayObservation),
		).toEqual({
			spellkave_phase: "presentation",
			spellkave_interaction: 0,
			spellkave_conversation_mounted: true,
			spellkave_conversation_lines: 3,
		});
	});
	it("exports the economy strip's own mounted flag and channel count, counts only (S4, sk-jay0.1.8.40 mount step)", () => {
		expect(
			projectObservation({
				phase: "presentation",
				interaction: 0,
				economy_mounted: true,
				economy_lines: 4,
			}),
		).toEqual({
			spellkave_phase: "presentation",
			spellkave_interaction: 0,
			spellkave_economy_mounted: true,
			spellkave_economy_lines: 4,
		});
		expect(
			projectObservation({
				phase: "presentation",
				interaction: 0,
				economy_mounted: false,
				economy_lines: 0,
			}),
		).toEqual({
			spellkave_phase: "presentation",
			spellkave_interaction: 0,
			spellkave_economy_mounted: false,
			spellkave_economy_lines: 0,
		});
	});
	it("distinguishes conversation disappearance without exporting its words", () => {
		const before = observationView(talkView);
		const after = observationView({ ...sampleView, speech: [] });
		expect(before.speech_count).toBeGreaterThan(0);
		expect(before.dialogue).toBe(true);
		expect(after.speech_count).toBe(0);
		expect(after.thread_count).toBe(0);
		expect(after.dialogue).toBe(false);
		const projected = projectObservation({ ...before, phase: "view", interaction: 0 });
		for (const line of talkView.speech) expect(JSON.stringify(projected)).not.toContain(line.text);
	});
	it("retains typed rejection and feedback states but drops arbitrary reasons", () => {
		const projected = projectObservation({
			phase: "feedback",
			interaction: 0,
			feedback_state: "unavailable",
			admission: "unobserved",
			result_kind: "rejected",
			reason: "private server detail",
		} as unknown as PlayObservation);
		expect(projected.spellkave_feedback_state).toBe("unavailable");
		expect(projected.spellkave_admission).toBe("unobserved");
		expect(JSON.stringify(projected)).not.toContain("private server detail");
	});
	const env = {
		SPELLKAVE_RUM_DIAGNOSTIC: "1",
		VITE_SPELLKAVE_RUM_APPLICATION_ID: "app",
		VITE_SPELLKAVE_RUM_CLIENT_TOKEN: "public",
		VITE_SPELLKAVE_RUM_VERSION: "revision",
		OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=local-play-it",
		SPELLKAVE_WORLD_SLUG: "kavemouth-local-play-it",
	};
	it("requires opt-in and a staged dev profile, never production or tests", () => {
		expect(readLocalRumConfig(env, "development", true)?.environment).toBe("local-play-it");
		for (const mode of ["production", "test"])
			expect(readLocalRumConfig(env, mode, true)).toBeNull();
		expect(readLocalRumConfig(env, "development", false)).toBeNull();
		expect(
			readLocalRumConfig({ ...env, SPELLKAVE_RUM_DIAGNOSTIC: "" }, "development", true),
		).toBeNull();
		expect(
			readLocalRumConfig(
				{ ...env, OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=prod" },
				"development",
				true,
			),
		).toBeNull();
	});
	it("rejects unknown fields, arbitrary strings and non-finite numbers", () => {
		const result = projectObservation({
			phase: "intent",
			interaction: 1,
			intent: "say",
			choice: Number.NaN,
			feedback: true,
			words: "private",
			outcome: "Bearer secret",
			duration_ms: Infinity,
		} as unknown as PlayObservation);
		expect(result).toEqual({
			spellkave_phase: "intent",
			spellkave_interaction: 1,
			spellkave_intent: "say",
			spellkave_feedback: true,
		});
	});
	it("keeps concurrent interactions distinct even when the older one finishes last", () => {
		const recorder = createPlayObservation();
		const events: PlayObservation[] = [];
		recorder.subscribe((event) => events.push(event));
		const first = recorder.begin("act");
		const second = recorder.begin("inspect_item");
		recorder.finish(second, { feedback: true });
		recorder.finish(first, { feedback: true });
		expect(events.map((e) => e.interaction)).toEqual([first, second, second, first]);
		expect(first).not.toBe(second);
	});
	it("does not affect gameplay if the exporter throws", () => {
		const recorder = createPlayObservation();
		recorder.subscribe(() => {
			throw new Error("offline");
		});
		expect(() => recorder.finish(recorder.begin("move"), {})).not.toThrow();
	});
	it("exports the new play_connection terminal states", () => {
		for (const state of [
			"connected",
			"stalled",
			"first_data",
			"no_seat",
			"world_not_ready",
			"world_starting",
			"world_start_timeout",
		] as const) {
			expect(projectObservation({ phase: "connection", interaction: 0, state })).toEqual({
				spellkave_phase: "connection",
				spellkave_interaction: 0,
				spellkave_state: state,
			});
		}
	});
	it("exports connect_phase only from the closed openSession phase vocabulary", () => {
		expect(
			projectObservation({
				phase: "connection",
				interaction: 0,
				state: "error",
				connect_phase: "factual_context",
			}),
		).toEqual({
			spellkave_phase: "connection",
			spellkave_interaction: 0,
			spellkave_state: "error",
			spellkave_connect_phase: "factual_context",
		});
		expect(
			projectObservation({
				phase: "connection",
				interaction: 0,
				state: "error",
				connect_phase: "not-a-real-phase",
			} as unknown as PlayObservation),
		).not.toHaveProperty("spellkave_connect_phase");
	});
});

describe("viewHasData (sk-jay0.1.1.14)", () => {
	// sampleView.place is a real place in the fixture; narrow it once so the
	// spreads below don't fight PlayView's `place: PlayPlace | null` typing.
	const nonNullPlace = sampleView.place as NonNullable<typeof sampleView.place>;
	const placeWithNoExits = { ...nonNullPlace, exits: [] };
	const emptyExceptPlace = {
		...sampleView,
		place: placeWithNoExits,
		occupants: [],
		pack: [],
		events: [],
		speech: [],
	};

	it("is true when sampleView's actions/exits/occupants/pack/events/speech are already populated", () => {
		expect(viewHasData(sampleView)).toBe(true);
	});
	it("is true when only one of the six counts is non-zero", () => {
		expect(viewHasData({ ...emptyExceptPlace, actions: [] })).toBe(false);
		expect(viewHasData({ ...emptyExceptPlace, actions: sampleView.actions })).toBe(true);
		expect(
			viewHasData({
				...emptyExceptPlace,
				place: { ...nonNullPlace, exits: nonNullPlace.exits },
			}),
		).toBe(true);
		expect(viewHasData({ ...emptyExceptPlace, occupants: sampleView.occupants })).toBe(true);
		expect(viewHasData({ ...emptyExceptPlace, pack: sampleView.pack })).toBe(true);
		expect(viewHasData({ ...emptyExceptPlace, events: sampleView.events })).toBe(true);
		expect(viewHasData({ ...emptyExceptPlace, speech: sampleView.speech })).toBe(true);
	});
	it("is false for a quiet actor in an empty scene — the creation-limbo shape #3487 found", () => {
		expect(
			viewHasData({
				...emptyExceptPlace,
				actions: [],
			}),
		).toBe(false);
	});
	it("is false when place itself is null (scene not yet resolved)", () => {
		expect(
			viewHasData({
				...emptyExceptPlace,
				place: null,
				actions: [],
			}),
		).toBe(false);
	});
});

// sk-jay0.6.38.25: #3464 showed `play_connection{state:loading}` with no
// terminal event — `createConnectionObserver` is the pure state machine that
// closes that gap. A fake clock/timer pair (test seam on the deps) keeps this
// deterministic and offline, the same pattern `play-rum.test.ts` uses for its
// own injected SDK fake.
describe("createConnectionObserver (sk-jay0.6.38.25)", () => {
	function fakeClock() {
		let time = 0;
		let nextId = 1;
		const timers = new Map<number, { fn: () => void; at: number }>();
		return {
			now: () => time,
			setTimer: (fn: () => void, ms: number): number => {
				const id = nextId++;
				timers.set(id, { fn, at: time + ms });
				return id;
			},
			clearTimer: (handle: unknown): void => {
				timers.delete(handle as number);
			},
			advance(ms: number): void {
				time += ms;
				for (const [id, timer] of [...timers]) {
					if (timer.at <= time && timers.has(id)) {
						timers.delete(id);
						timer.fn();
					}
				}
			},
		};
	}

	it("records connected with elapsed ms since start() on the factual_context phase", () => {
		const events: PlayObservation[] = [];
		const clock = fakeClock();
		const observer = createConnectionObserver({
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			record: (event) => events.push(event),
		});
		const attempt = observer.start();
		clock.advance(120);
		attempt.onPhase("ready", 10);
		attempt.onPhase("resolve_actor", 5);
		attempt.onPhase("factual_context", 3);
		expect(events).toEqual([
			{ phase: "connection", interaction: 0, state: "connected", duration_ms: 120 },
		]);
	});

	it("fires connected at most once per attempt", () => {
		const events: PlayObservation[] = [];
		const observer = createConnectionObserver({ record: (event) => events.push(event) });
		const attempt = observer.start();
		attempt.onPhase("factual_context", 1);
		attempt.onPhase("factual_context", 1);
		expect(events).toHaveLength(1);
	});

	// sk-jay0.1.1.14: #3487 found a connected, correctly-subscribed session
	// for a quiet actor showing nothing, with no RUM signal telling that apart
	// from a stall. `first_data` closes that gap; these pin its once-only,
	// after-`connected`-only, and stop/supersession-scoped rules.
	describe("firstData() (sk-jay0.1.1.14)", () => {
		it("records first_data with duration_ms since loading, the same baseline connected uses", () => {
			const events: PlayObservation[] = [];
			const clock = fakeClock();
			const observer = createConnectionObserver({
				now: clock.now,
				setTimer: clock.setTimer,
				clearTimer: clock.clearTimer,
				record: (event) => events.push(event),
			});
			const attempt = observer.start();
			clock.advance(120);
			attempt.onPhase("factual_context", 1);
			clock.advance(30);
			attempt.firstData();
			expect(events).toEqual([
				{ phase: "connection", interaction: 0, state: "connected", duration_ms: 120 },
				{ phase: "connection", interaction: 0, state: "first_data", duration_ms: 150 },
			]);
		});

		it("is a no-op before connected has fired for this attempt", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.firstData();
			expect(events).toEqual([]);
		});

		it("fires at most once per attempt even if the view keeps arriving non-empty", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.onPhase("factual_context", 1);
			attempt.firstData();
			attempt.firstData();
			attempt.firstData();
			expect(events.filter((e) => e.state === "first_data")).toHaveLength(1);
		});

		it("is a no-op once the attempt has been stop()ped", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.onPhase("factual_context", 1);
			attempt.stop();
			attempt.firstData();
			expect(events.filter((e) => e.state === "first_data")).toHaveLength(0);
		});

		it("is a no-op once a later start() has superseded this attempt", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const stale = observer.start();
			stale.onPhase("factual_context", 1);
			observer.start();
			stale.firstData();
			expect(events.filter((e) => e.state === "first_data")).toHaveLength(0);
		});

		it("never fires for a settle()d terminal that never called openSession", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.settle("no_seat");
			attempt.firstData();
			expect(events.filter((e) => e.state === "first_data")).toHaveLength(0);
		});
	});

	it("records error with the failed phase read off a tagged Error", () => {
		const events: PlayObservation[] = [];
		const observer = createConnectionObserver({ record: (event) => events.push(event) });
		const attempt = observer.start();
		const failure = new Error("openSession: session.ready timed out after 30ms");
		(failure as Error & { phase?: string }).phase = "ready";
		attempt.onError(failure);
		expect(events).toEqual([
			{ phase: "connection", interaction: 0, state: "error", connect_phase: "ready" },
		]);
	});

	it("records error with no connect_phase when the failure carried none, and never a raw message", () => {
		const events: PlayObservation[] = [];
		const observer = createConnectionObserver({ record: (event) => events.push(event) });
		const attempt = observer.start();
		attempt.onError(new Error("some private detail: token abc123"));
		expect(events).toEqual([{ phase: "connection", interaction: 0, state: "error" }]);
	});

	it("drops an unrecognized phase value instead of exporting it", () => {
		const events: PlayObservation[] = [];
		const observer = createConnectionObserver({ record: (event) => events.push(event) });
		const attempt = observer.start();
		const failure = new Error("boom");
		(failure as Error & { phase?: string }).phase = "not-a-real-phase";
		attempt.onError(failure);
		expect(events).toEqual([{ phase: "connection", interaction: 0, state: "error" }]);
	});

	it("defaults stalledMs to CONNECT_STALLED_MS (10s — must fire before either 30s openSession phase bound)", () => {
		expect(CONNECT_STALLED_MS).toBe(10_000);
	});

	it("emits stalled once after stalledMs with neither connected nor error, and a later connected still fires", () => {
		const events: PlayObservation[] = [];
		const clock = fakeClock();
		const observer = createConnectionObserver({
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			stalledMs: CONNECT_STALLED_MS,
			record: (event) => events.push(event),
		});
		const attempt = observer.start();
		clock.advance(CONNECT_STALLED_MS);
		expect(events).toEqual([{ phase: "connection", interaction: 0, state: "stalled" }]);
		clock.advance(500);
		attempt.onPhase("factual_context", 1);
		expect(events).toEqual([
			{ phase: "connection", interaction: 0, state: "stalled" },
			{
				phase: "connection",
				interaction: 0,
				state: "connected",
				duration_ms: CONNECT_STALLED_MS + 500,
			},
		]);
	});

	it("does not fire a stale stalled timer once already connected", () => {
		const events: PlayObservation[] = [];
		const clock = fakeClock();
		const observer = createConnectionObserver({
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			stalledMs: CONNECT_STALLED_MS,
			record: (event) => events.push(event),
		});
		const attempt = observer.start();
		attempt.onPhase("factual_context", 1);
		clock.advance(CONNECT_STALLED_MS + 5_000);
		expect(events).toEqual([
			{ phase: "connection", interaction: 0, state: "connected", duration_ms: 0 },
		]);
	});

	it("start() rearms the stalled timer for a fresh reconnect attempt", () => {
		const events: PlayObservation[] = [];
		const clock = fakeClock();
		const observer = createConnectionObserver({
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			stalledMs: CONNECT_STALLED_MS,
			record: (event) => events.push(event),
		});
		const first = observer.start();
		first.onPhase("factual_context", 1);
		observer.start();
		clock.advance(CONNECT_STALLED_MS);
		expect(events.at(-1)).toEqual({ phase: "connection", interaction: 0, state: "stalled" });
	});

	it("stop() cancels a pending stalled timer", () => {
		const events: PlayObservation[] = [];
		const clock = fakeClock();
		const observer = createConnectionObserver({
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			stalledMs: CONNECT_STALLED_MS,
			record: (event) => events.push(event),
		});
		const attempt = observer.start();
		attempt.stop();
		clock.advance(CONNECT_STALLED_MS + 10_000);
		expect(events).toEqual([]);
	});

	it("settle() closes the attempt with no_seat/world_not_ready and cancels its stall timer", () => {
		const events: PlayObservation[] = [];
		const clock = fakeClock();
		const observer = createConnectionObserver({
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			stalledMs: CONNECT_STALLED_MS,
			record: (event) => events.push(event),
		});
		const attempt = observer.start();
		attempt.settle("no_seat");
		clock.advance(CONNECT_STALLED_MS + 10_000);
		expect(events).toEqual([{ phase: "connection", interaction: 0, state: "no_seat" }]);
	});

	it("settle() is a no-op once already settled or superseded", () => {
		const events: PlayObservation[] = [];
		// Fake clock: `connected` records the elapsed attempt time, so a real
		// clock made this assertion depend on scheduling (sk-jay0.7.250).
		const clock = fakeClock();
		const observer = createConnectionObserver({
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			stalledMs: CONNECT_STALLED_MS,
			record: (event) => events.push(event),
		});
		const settledAttempt = observer.start();
		clock.advance(25);
		settledAttempt.onPhase("factual_context", 1);
		settledAttempt.settle("no_seat");
		const stale = observer.start();
		observer.start();
		stale.settle("world_not_ready");
		expect(events).toEqual([
			{ phase: "connection", interaction: 0, state: "connected", duration_ms: 25 },
		]);
	});

	// #3482 re-review of #3477: a cancelled attempt that nothing has superseded
	// yet (component teardown, or a new destination that ends in
	// `no_seat`/`world_not_ready` so a later `start()` never runs) must not be
	// able to record a late terminal of its own — `stop()` has to disable the
	// handle permanently, not just clear its timer.
	describe("stop() permanently disables the handle (#3482 re-review of #3477)", () => {
		it("a late onPhase/onError/settle after stop() records nothing, even without a superseding start()", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.stop();
			attempt.onPhase("factual_context", 1);
			attempt.onError(new Error("late failure after stop()"));
			attempt.settle("no_seat");
			expect(events).toEqual([]);
		});

		it("stop() on the old attempt then a new attempt ending no_seat yields exactly one terminal", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const old = observer.start();
			old.stop();
			const next = observer.start();
			next.settle("no_seat");
			// A late callback from the stopped, non-superseded old attempt must
			// still record nothing even though a new attempt now exists.
			old.onError(new Error("late failure from the stopped attempt"));
			old.onPhase("factual_context", 1);
			expect(events).toEqual([{ phase: "connection", interaction: 0, state: "no_seat" }]);
		});
	});

	// #3482 re-review of #3477 nit: `stop()` must disable its handle the
	// instant it runs, before its caller can know whether a later `start()` is
	// coming — so a genuinely abandoned attempt (nothing ever supersedes it)
	// would otherwise leave "loading" with no terminal forever. `abandon()` is
	// the other half of that fix: a code path that itself starts no new
	// attempt (e.g. `App.svelte`'s `token === undefined` bail-out) calls it to
	// close out whatever `stop()` left dangling.
	describe("abandon() closes a stop()ed attempt nothing has superseded (#3482 re-review of #3477 nit)", () => {
		it("records error for a stopped attempt with no later start()", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.stop();
			observer.abandon();
			expect(events).toEqual([{ phase: "connection", interaction: 0, state: "error" }]);
		});

		it("is a no-op once a later start() has superseded the stopped attempt", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const stale = observer.start();
			stale.stop();
			observer.start();
			observer.abandon();
			expect(events).toEqual([]);
		});

		it("is a no-op when the attempt already settled before stop()", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.settle("no_seat");
			attempt.stop();
			observer.abandon();
			expect(events).toEqual([{ phase: "connection", interaction: 0, state: "no_seat" }]);
		});

		it("is a no-op when no attempt was ever started", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			observer.abandon();
			expect(events).toEqual([]);
		});

		it("is idempotent: a second abandon() call records nothing more", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const attempt = observer.start();
			attempt.stop();
			observer.abandon();
			observer.abandon();
			expect(events).toEqual([{ phase: "connection", interaction: 0, state: "error" }]);
		});
	});

	// #3477 RUM-lane review: a token renewal or world switch can start a new
	// attempt while an old `openSession` call is still in flight. Before this
	// fix, a shared `onPhase`/`onError` pair had no way to tell the two
	// attempts apart, so the OLD attempt's late callback could settle the NEW
	// attempt as `connected`/`error` (with the wrong `startedAt`) and silently
	// suppress the new attempt's own `stalled` warning.
	describe("overlapping attempts (superseded attempt's callbacks are dropped)", () => {
		it("a stale attempt's onPhase and onError after a new start() emit nothing", () => {
			const events: PlayObservation[] = [];
			const observer = createConnectionObserver({ record: (event) => events.push(event) });
			const stale = observer.start();
			observer.start();
			stale.onPhase("factual_context", 1);
			stale.onError(new Error("late failure from the superseded attempt"));
			expect(events).toEqual([]);
		});

		it("a fresh attempt still settles normally after an older attempt was superseded", () => {
			const events: PlayObservation[] = [];
			const clock = fakeClock();
			const observer = createConnectionObserver({
				now: clock.now,
				setTimer: clock.setTimer,
				clearTimer: clock.clearTimer,
				record: (event) => events.push(event),
			});
			const stale = observer.start();
			clock.advance(50);
			const fresh = observer.start();
			stale.onPhase("factual_context", 1);
			clock.advance(200);
			fresh.onPhase("factual_context", 1);
			expect(events).toEqual([
				{ phase: "connection", interaction: 0, state: "connected", duration_ms: 200 },
			]);
		});

		it("a stale attempt's late onError does not suppress the new attempt's own stalled warning", () => {
			const events: PlayObservation[] = [];
			const clock = fakeClock();
			const observer = createConnectionObserver({
				now: clock.now,
				setTimer: clock.setTimer,
				clearTimer: clock.clearTimer,
				stalledMs: CONNECT_STALLED_MS,
				record: (event) => events.push(event),
			});
			const stale = observer.start();
			const fresh = observer.start();
			stale.onError(new Error("late failure from the superseded attempt"));
			clock.advance(CONNECT_STALLED_MS);
			expect(events).toEqual([{ phase: "connection", interaction: 0, state: "stalled" }]);
			void fresh;
		});

		it("a stale attempt's stop() does not cancel the new attempt's stalled timer", () => {
			const events: PlayObservation[] = [];
			const clock = fakeClock();
			const observer = createConnectionObserver({
				now: clock.now,
				setTimer: clock.setTimer,
				clearTimer: clock.clearTimer,
				stalledMs: CONNECT_STALLED_MS,
				record: (event) => events.push(event),
			});
			const stale = observer.start();
			observer.start();
			stale.stop();
			clock.advance(CONNECT_STALLED_MS);
			expect(events).toEqual([{ phase: "connection", interaction: 0, state: "stalled" }]);
		});
	});
});
