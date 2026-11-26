import { SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import type { AccountGetResponse } from "./lib/account-api";
import type { OpenPlaySessionArgs } from "./lib/play-session";
import type { PlayView } from "./lib/play-view";
import { fakeHandle, sampleView as recordedView } from "./test/sample-view";

/**
 * sk-jay0.1.1.13: a seat claimed in a world whose catalog status is not yet
 * "running" (idle npc-host still scheduling) must show a "world is starting"
 * state — never the hero chooser, since the account already holds this seat
 * — and open the world once /v1/account reports it running.
 */

const sampleView: PlayView = recordedView;

const worldOf = (worldStatus: string, worldPaused = false): AccountGetResponse => ({
	sub: "user_sim1",
	capabilities: [],
	worlds: [
		{
			slug: "elven-mini-4",
			display_name: "Elven Mini 4",
			role: "member",
			capabilities: ["world.join", "world.play"],
		},
	],
	seat: {
		slug: "elven-mini-4",
		actor_id: "9",
		role: "primary",
		world_status: worldStatus,
		world_paused: worldPaused,
	},
});

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

afterEach(async () => {
	window.sessionStorage.clear();
	vi.restoreAllMocks();
	await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("a seat in a world that is not running yet", () => {
	it("shows an intentional pause instead of polling a world that cannot start", async () => {
		signIn();
		const accountLoader = vi.fn(async () => worldOf("scheduling", true));
		const worldOpener = vi.fn();
		render(App, {
			accountLoader,
			catalogLoader: vi.fn(async () => [
				{ slug: "elven-mini-4", name: "Elven Mini 4", db: "spellkave-elven-mini-4" },
			]),
			worldOpener,
			worldStartingRetryMs: 5,
		});

		await waitFor(() => expect(screen.getByText(/paused by its operator/)).toBeTruthy());
		expect(worldOpener).not.toHaveBeenCalled();
		const callsAtPause = accountLoader.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(accountLoader.mock.calls.length).toBe(callsAtPause);
	});

	it("shows a starting state instead of the hero chooser, and never opens a session", async () => {
		signIn();
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		render(App, {
			accountLoader: vi.fn(async () => worldOf("scheduling")),
			catalogLoader: vi.fn(async () => [
				{ slug: "elven-mini-4", name: "Elven Mini 4", db: "spellkave-elven-mini-4" },
			]),
			worldOpener,
			// Real timer, kept tiny so the test does not wait on production backoff.
			worldStartingRetryMs: 1_000_000,
		});

		await waitFor(() => expect(screen.getByText(/starting up/)).toBeTruthy());
		expect(screen.queryByTestId("hero-choices")).toBeNull();
		expect(worldOpener).not.toHaveBeenCalled();
	});

	it("retries the account and opens the world once it reports running", async () => {
		signIn();
		const accountLoader = vi
			.fn<() => Promise<AccountGetResponse>>()
			.mockResolvedValueOnce(worldOf("scheduling"))
			.mockResolvedValue(worldOf("running"));
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		render(App, {
			accountLoader,
			catalogLoader: vi.fn(async () => [
				{ slug: "elven-mini-4", name: "Elven Mini 4", db: "spellkave-elven-mini-4" },
			]),
			worldOpener,
			worldStartingRetryMs: 5,
		});

		await waitFor(() => expect(screen.getByText(/starting up/)).toBeTruthy());
		await waitFor(() => expect(worldOpener).toHaveBeenCalledTimes(1));
		expect(worldOpener).toHaveBeenCalledWith(expect.objectContaining({ actorId: "9" }));
		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
		);
	});

	/**
	 * sk-jay0.1.1.13: a world that never reports "running" must not poll
	 * `/v1/account` forever — after `worldStartingMaxMs` of wall-clock time
	 * Play gives up, shows the existing error gate (with its "Try again"
	 * retry), and stops polling.
	 */
	it("gives up after the bound and shows the error gate instead of polling forever", async () => {
		signIn();
		const accountLoader = vi.fn(async () => worldOf("scheduling"));
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		render(App, {
			accountLoader,
			catalogLoader: vi.fn(async () => [
				{ slug: "elven-mini-4", name: "Elven Mini 4", db: "spellkave-elven-mini-4" },
			]),
			worldOpener,
			worldStartingRetryMs: 5,
			worldStartingMaxMs: 15,
		});

		await waitFor(() =>
			expect(screen.getByText(/taking longer than expected to start/)).toBeTruthy(),
		);
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
		expect(worldOpener).not.toHaveBeenCalled();

		// No further polls once the bound is reached.
		const callsAtTimeout = accountLoader.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(accountLoader.mock.calls.length).toBe(callsAtTimeout);
	});

	it("cancels the pending poll on unmount", async () => {
		signIn();
		const accountLoader = vi.fn(async () => worldOf("scheduling"));
		const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		});
		const { unmount } = render(App, {
			accountLoader,
			catalogLoader: vi.fn(async () => [
				{ slug: "elven-mini-4", name: "Elven Mini 4", db: "spellkave-elven-mini-4" },
			]),
			worldOpener,
			worldStartingRetryMs: 5,
		});

		await waitFor(() => expect(screen.getByText(/starting up/)).toBeTruthy());
		const callsBeforeUnmount = accountLoader.mock.calls.length;
		await unmount();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(accountLoader.mock.calls.length).toBe(callsBeforeUnmount);
	});
});
