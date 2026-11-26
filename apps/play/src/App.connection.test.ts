import { SESSION_STORAGE_KEY, type SessionRenewalState } from "@spellkave/authkit";
import { render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import type { AccountGetResponse } from "./lib/account-api";
import { type PlayObservation, playObservation } from "./lib/play-observation";
import type { OpenPlaySessionArgs } from "./lib/play-session";
import type { PlayView } from "./lib/play-view";
import { fakeHandle, sampleView } from "./test/sample-view";

/**
 * App-level coverage for the `play_connection` attempt lifecycle (#3482
 * re-review of #3477): `world_not_ready` and `no_seat` never call
 * `openSession` at all, and a throw between "loading" and `openSession`
 * (e.g. `rememberWorld` hitting blocked/quota storage) must still close
 * through the outer `.catch`. Each case must record EXACTLY ONE
 * `phase: "connection"` observation for the attempt — never zero (a
 * dangling "loading"), never two.
 */

// jsdom's `Storage` is a legacy-platform-object Proxy where an arbitrary
// property SET (including `vi.spyOn`'s own-property assignment) is itself
// interpreted as a `setItem` call, so spying on `sessionStorage.setItem`
// directly does not intercept real calls. Mocking `rememberWorld` itself is
// the reliable seam for forcing the one throw this suite needs.
const rememberWorldControl = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("./lib/pending-world", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./lib/pending-world")>();
	return {
		...actual,
		rememberWorld: (storage: Storage, slug: string | null) => {
			if (rememberWorldControl.error) throw rememberWorldControl.error;
			return actual.rememberWorld(storage, slug);
		},
	};
});

// `App.svelte` only ever nulls `session` (and, through it, `connectionSubject`)
// through `startSessionRenewal`'s `onChange` or the OAuth callback path —
// there is no logout affordance reachable from this suite's already-signed-in
// render. `readAuthConfig` returns `null` with no `VITE_WORKOS_*` env (true
// in every other test here, so `startSessionRenewal` is never even called),
// so this fake config plus a captured `onChange` is the only seam that can
// force the "cancelled with no follow-up attempt" case the #3482 re-review
// nit describes — e.g. a failed silent session renewal while a connect
// attempt is in flight.
const sessionRenewalControl = vi.hoisted(() => ({
	onChange: null as ((state: SessionRenewalState) => void) | null,
}));
vi.mock("@spellkave/authkit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@spellkave/authkit")>();
	return {
		...actual,
		readAuthConfig: () => ({ clientId: "test-client", issuer: "https://test.workos.app" }),
		startSessionRenewal: (options: { onChange: (state: SessionRenewalState) => void }) => {
			sessionRenewalControl.onChange = options.onChange;
			return { ready: Promise.resolve(null), check: async () => null, stop: () => {} };
		},
	};
});

const seatedAccount: AccountGetResponse = {
	sub: "user_a",
	capabilities: [],
	worlds: [
		{
			slug: "demo1",
			display_name: "The Woven Marches",
			role: "member",
			capabilities: ["world.play"],
		},
	],
	seat: { slug: "demo1", actor_id: "7", role: "primary" },
};

const joinOnlyAccount: AccountGetResponse = {
	sub: "user_b",
	capabilities: [],
	worlds: [
		{
			slug: "demo1",
			display_name: "The Woven Marches",
			role: "open",
			capabilities: ["world.join"],
		},
	],
	seat: null,
};

function signIn(): void {
	window.sessionStorage.setItem(
		SESSION_STORAGE_KEY,
		JSON.stringify({
			access_token: "test-token",
			id_token: "",
			expires_at: Date.now() + 60_000,
			display_name: "Test Player",
		}),
	);
}

function connectionEvents(all: PlayObservation[]): PlayObservation[] {
	return all.filter((event) => event.phase === "connection");
}

afterEach(async () => {
	window.sessionStorage.clear();
	rememberWorldControl.error = null;
	sessionRenewalControl.onChange = null;
	vi.restoreAllMocks();
	await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("play_connection attempt lifecycle (#3482 re-review of #3477)", () => {
	it("records exactly one world_not_ready terminal and never calls openSession", async () => {
		signIn();
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		render(App, {
			accountLoader: vi.fn(async () => seatedAccount),
			// The catalog carries no `db` for this world, so `App.svelte` treats
			// it as not yet playable in the browser — the same shape as a world
			// the catalog has not published a browser-reachable database for.
			catalogLoader: vi.fn(async () => [{ slug: "demo1", name: "The Woven Marches" }]),
			seatsLoader: vi.fn(async () => []),
			worldOpener,
		});

		await waitFor(() => expect(screen.getByText(/not ready for browser play yet/)).toBeTruthy());
		expect(worldOpener).not.toHaveBeenCalled();
		expect(connectionEvents(events)).toEqual([
			{ phase: "connection", interaction: 0, state: "world_not_ready" },
		]);
	});

	it("records exactly one no_seat terminal and never calls openSession", async () => {
		signIn();
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		render(App, {
			accountLoader: vi.fn(async () => joinOnlyAccount),
			catalogLoader: vi.fn(async () => [
				{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			]),
			seatsLoader: vi.fn(async () => [
				{ actor_id: "7", name: "Renn", claimed: false, mine: false },
			]),
			worldOpener,
		});

		await waitFor(() => expect(screen.getByTestId("hero-choices")).toBeTruthy());
		expect(worldOpener).not.toHaveBeenCalled();
		expect(connectionEvents(events)).toEqual([
			{ phase: "connection", interaction: 0, state: "no_seat" },
		]);
	});

	it("closes a throw between loading and openSession through the outer catch as error", async () => {
		signIn();
		// `rememberWorld` (called right after the attempt handle is created,
		// still before `openSession`) hits blocked/quota storage — the gap the
		// #3477 review flagged as still dangling "loading". The outer `.catch`
		// must close it as a plain `error` via `attempt.onError`.
		rememberWorldControl.error = new DOMException(
			"The quota has been exceeded.",
			"QuotaExceededError",
		);
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		render(App, {
			accountLoader: vi.fn(async () => seatedAccount),
			catalogLoader: vi.fn(async () => [
				{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			]),
			seatsLoader: vi.fn(async () => []),
			worldOpener,
		});

		await waitFor(() => expect(screen.getByText(/quota has been exceeded/)).toBeTruthy());
		expect(worldOpener).not.toHaveBeenCalled();
		expect(connectionEvents(events)).toEqual([
			{ phase: "connection", interaction: 0, state: "error" },
		]);
	});

	it("records world_starting, then connected once the account reports the world running (sk-jay0.1.1.13)", async () => {
		signIn();
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		const startingSeat = {
			slug: "demo1",
			actor_id: "7",
			role: "primary",
			world_status: "scheduling",
		};
		const runningSeat = { ...startingSeat, world_status: "running" };
		const accountLoader = vi
			.fn<() => Promise<AccountGetResponse>>()
			.mockResolvedValueOnce({ ...seatedAccount, seat: startingSeat })
			.mockResolvedValue({ ...seatedAccount, seat: runningSeat });
		// Unlike the other cases in this suite, this attempt DOES reach
		// `openSession` (on the later, "running" attempt) — call `onPhase` so
		// the resulting `connected` milestone is exercised too, not just the
		// `world_starting` one that never calls `openSession` at all.
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onPhase?.("factual_context", 1);
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		render(App, {
			accountLoader,
			catalogLoader: vi.fn(async () => [
				{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			]),
			worldOpener,
			worldStartingRetryMs: 5,
		});

		await waitFor(() => expect(screen.getByText(/starting up/)).toBeTruthy());
		await waitFor(() => expect(worldOpener).toHaveBeenCalledTimes(1));
		// Three rows, not two: `sampleView` (what this mock's `onView` delivers)
		// is non-empty, so `connected` is immediately followed by `first_data`
		// (sk-jay0.1.1.14) — `App.svelte`'s `onView` wiring calls
		// `thisAttempt.firstData()` the moment a non-empty view arrives.
		await waitFor(() => expect(connectionEvents(events)).toHaveLength(3));
		expect(connectionEvents(events)).toEqual([
			{ phase: "connection", interaction: 0, state: "world_starting" },
			{
				phase: "connection",
				interaction: 0,
				state: "connected",
				duration_ms: expect.any(Number),
			},
			{
				phase: "connection",
				interaction: 0,
				state: "first_data",
				duration_ms: expect.any(Number),
			},
		]);
	});

	it("closes a cancelled attempt through abandon() when nothing supersedes it (#3482 re-review of #3477 nit)", async () => {
		// A failed silent session renewal (or any other event that nulls
		// `session`) can null `connectionSubject` while a connect attempt is still
		// in flight, with no later attempt ever starting to supersede it. Before
		// this fix, `stop()` in the effect's own cleanup permanently disabled
		// the attempt handle with nothing left to record a terminal for it, so
		// "loading" dangled forever. Hang `worldOpener` so the attempt is
		// genuinely still open (no `onPhase`/`onError` yet) when the renewal
		// fires.
		signIn();
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		const worldOpener = vi.fn(
			() =>
				new Promise<ReturnType<typeof fakeHandle>>(() => {
					/* never resolves: the attempt must still be open */
				}),
		);
		render(App, {
			accountLoader: vi.fn(async () => seatedAccount),
			catalogLoader: vi.fn(async () => [
				{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			]),
			seatsLoader: vi.fn(async () => []),
			worldOpener,
		});

		await waitFor(() => expect(worldOpener).toHaveBeenCalledTimes(1));
		expect(connectionEvents(events)).toEqual([]);
		expect(sessionRenewalControl.onChange).not.toBeNull();
		sessionRenewalControl.onChange?.({ session: null, status: "signed-out" });

		await waitFor(() =>
			expect(connectionEvents(events)).toEqual([
				{ phase: "connection", interaction: 0, state: "error" },
			]),
		);
		expect(worldOpener).toHaveBeenCalledTimes(1);
	});
});

/**
 * sk-jay0.1.1.14: `first_data` closes the gap #3487 found — a connected,
 * correctly-subscribed session for a quiet actor showed nothing, with no RUM
 * signal telling that apart from a stall. These pin `App.svelte`'s own
 * once-per-attempt wiring in `onView` (the observer's own once-only/
 * after-connected rules are `play-observation.test.ts`'s job).
 */
describe("first_data (sk-jay0.1.1.14)", () => {
	const emptyView: PlayView = {
		...sampleView,
		place: sampleView.place === null ? null : { ...sampleView.place, exits: [] },
		actions: [],
		occupants: [],
		pack: [],
		events: [],
		speech: [],
	};

	function renderConnecting(worldOpener: ReturnType<typeof vi.fn>) {
		signIn();
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		render(App, {
			accountLoader: vi.fn(async () => seatedAccount),
			catalogLoader: vi.fn(async () => [
				{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			]),
			seatsLoader: vi.fn(async () => []),
			worldOpener,
		});
		return events;
	}

	it("fires once, right after connected, when the first view already carries data", async () => {
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onPhase?.("factual_context", 1);
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		const events = renderConnecting(worldOpener);

		await waitFor(() =>
			expect(connectionEvents(events).map((event) => event.state)).toEqual([
				"connected",
				"first_data",
			]),
		);
	});

	it("does not fire while the view stays empty, and fires exactly once once real data arrives", async () => {
		let deliverView: ((view: PlayView) => void) | undefined;
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onPhase?.("factual_context", 1);
			deliverView = args.onView;
			args.onView(emptyView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		const events = renderConnecting(worldOpener);

		await waitFor(() =>
			expect(connectionEvents(events).map((event) => event.state)).toEqual(["connected"]),
		);
		// A quiet actor in an empty scene (creation limbo, #3487) must not be
		// mistaken for first_data — repeated empty views record nothing new.
		deliverView?.(emptyView);
		expect(connectionEvents(events).map((event) => event.state)).toEqual(["connected"]);

		deliverView?.(sampleView);
		await waitFor(() =>
			expect(connectionEvents(events).map((event) => event.state)).toEqual([
				"connected",
				"first_data",
			]),
		);
		// Once-only: a later non-empty view must not record a second row.
		deliverView?.(sampleView);
		expect(connectionEvents(events).map((event) => event.state)).toEqual([
			"connected",
			"first_data",
		]);
	});
});

/**
 * sk-jay0.1.1.14: the live `world_time` tick readout attached to the seal
 * cluster (extending the existing round seat button, never an overlay —
 * `App.svelte`'s `sealButton` snippet, `DockTick`).
 */
describe("world tick readout (sk-jay0.1.1.14)", () => {
	it("stays hidden until the session reports a tick, then renders and updates it", async () => {
		let deliverTick: ((tick: number) => void) | undefined;
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onPhase?.("factual_context", 1);
			args.onView(sampleView);
			deliverTick = args.onWorldTick;
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		signIn();
		render(App, {
			accountLoader: vi.fn(async () => seatedAccount),
			catalogLoader: vi.fn(async () => [
				{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			]),
			seatsLoader: vi.fn(async () => []),
			worldOpener,
		});

		await waitFor(() => expect(worldOpener).toHaveBeenCalledTimes(1));
		// No `openPlaySession` call has reported a tick yet — no misleading 0.
		expect(screen.queryByTestId("world-tick")).toBeNull();

		deliverTick?.(2030);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Game status: 2030" })).toBeTruthy(),
		);

		deliverTick?.(2031);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Game status: 2031" })).toBeTruthy(),
		);
	});
});
