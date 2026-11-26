import { SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import { AccountApiError, type AccountGetResponse } from "./lib/account-api";
import type { OpenPlaySessionArgs } from "./lib/play-session";
import type { PlayView } from "./lib/play-view";
import { fakeHandle, sampleView as recordedView } from "./test/sample-view";

/**
 * The join journey (sk-jay0.5.1.5.1). Shapes mirror what the live API returned
 * for sim1 on 2026-08-26: world.join with no seat on some worlds, world.play
 * with a seat on another. Play used to filter to world.play only, so every
 * join-only world was invisible and a seatless player was bounced to the
 * website.
 */

const joinOnly: AccountGetResponse = {
	sub: "user_sim",
	capabilities: [],
	worlds: [
		{
			slug: "demo1",
			display_name: "The Woven Marches",
			role: "open",
			capabilities: ["world.join"],
		},
		{ slug: "demo2", display_name: "The Salt Reach", role: "open", capabilities: ["world.join"] },
	],
	seat: null,
};

const seated: AccountGetResponse = {
	...joinOnly,
	worlds: [
		{
			slug: "demo1",
			display_name: "The Woven Marches",
			role: "member",
			capabilities: ["world.join", "world.play"],
		},
		joinOnly.worlds[1] as AccountGetResponse["worlds"][number],
	],
	seat: { slug: "demo1", actor_id: "7", role: "primary" },
};

const sampleView: PlayView = recordedView;

const board = [
	{ actor_id: "7", name: "Renn", claimed: false, mine: false },
	{ actor_id: "8", name: "Mara", claimed: true, mine: false },
];

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

function renderPlay(overrides: {
	accountLoader?: () => Promise<AccountGetResponse>;
	seatsLoader?: ReturnType<typeof vi.fn>;
	seatClaimer?: ReturnType<typeof vi.fn>;
	seatReleaser?: ReturnType<typeof vi.fn>;
	account?: AccountGetResponse;
}) {
	const seatsLoader = overrides.seatsLoader ?? vi.fn(async () => board);
	const seatClaimer =
		overrides.seatClaimer ??
		vi.fn(async () => ({ seat: { slug: "demo1", actor_id: "7", role: "primary" } }));
	const seatReleaser = overrides.seatReleaser ?? vi.fn(async () => undefined);
	render(App, {
		accountLoader: overrides.accountLoader ?? vi.fn(async () => overrides.account ?? joinOnly),
		catalogLoader: vi.fn(async () => [
			{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			{ slug: "demo2", name: "The Salt Reach", db: "spellkave-demo2" },
		]),
		seatsLoader,
		seatClaimer,
		seatReleaser,
		worldOpener: vi.fn(async (args: OpenPlaySessionArgs) => {
			args.onView(sampleView);
			return fakeHandle({ move: vi.fn(), act: vi.fn(), disconnect: vi.fn() });
		}),
	});
	return { seatsLoader, seatClaimer, seatReleaser };
}

afterEach(async () => {
	window.sessionStorage.clear();
	vi.restoreAllMocks();
	await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("claiming a hero inside Play", () => {
	it("offers the heroes of a join-only world instead of sending the player away", async () => {
		signIn();
		const { seatsLoader } = renderPlay({});

		await waitFor(() => expect(screen.getByTestId("hero-choices")).toBeTruthy());
		expect(seatsLoader).toHaveBeenCalledWith(expect.anything(), "test-token", "demo1");
		// The free seat is offered; the taken one is shown but not offered.
		expect(screen.getByRole("button", { name: /Play as Renn/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Play as Mara/ })).toBeNull();
		expect(screen.getByText("taken")).toBeTruthy();
		// The old dead end must be gone.
		expect(screen.queryByText(/before entering Play/)).toBeNull();
	});

	it("enters the world after a successful claim, without a manual reload", async () => {
		signIn();
		const accountLoader = vi
			.fn<() => Promise<AccountGetResponse>>()
			.mockResolvedValueOnce(joinOnly)
			.mockResolvedValue(seated);
		const { seatClaimer } = renderPlay({ accountLoader });

		await waitFor(() => expect(screen.getByTestId("hero-choices")).toBeTruthy());
		await fireEvent.click(screen.getByRole("button", { name: /Play as Renn/ }));

		await waitFor(() =>
			expect(seatClaimer).toHaveBeenCalledWith(expect.anything(), "test-token", "demo1", "7"),
		);
		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
		);
	});

	it("says so and re-reads the board when another player wins the race", async () => {
		signIn();
		const seatClaimer = vi.fn(async () => {
			throw new AccountApiError("actor 7 already has identity binding(s)", 409);
		});
		const seatsLoader = vi
			.fn()
			.mockResolvedValueOnce(board)
			.mockResolvedValue([{ actor_id: "7", name: "Renn", claimed: true, mine: false }]);
		renderPlay({ seatClaimer, seatsLoader });

		await waitFor(() => expect(screen.getByTestId("hero-choices")).toBeTruthy());
		await fireEvent.click(screen.getByRole("button", { name: /Play as Renn/ }));

		await waitFor(() => expect(screen.getByText(/took that hero first/)).toBeTruthy());
		// Re-read, not stranded: Renn is now shown as taken rather than offered.
		await waitFor(() => expect(seatsLoader).toHaveBeenCalledTimes(2));
		expect(screen.queryByRole("button", { name: /Play as Renn/ })).toBeNull();
	});

	it("opens an owned hero after the claim response times out without claiming again", async () => {
		signIn();
		const accountLoader = vi.fn().mockResolvedValueOnce(joinOnly).mockResolvedValue(seated);
		const seatClaimer = vi.fn().mockRejectedValue(new AccountApiError("Claim timed out", 524));
		renderPlay({ accountLoader, seatClaimer });
		await fireEvent.click(await screen.findByRole("button", { name: /Play as Renn/ }));
		await screen.findByRole("heading", { level: 3, name: "Common Room" });
		expect(seatClaimer).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("Claim timed out")).toBeNull();
	});

	it("keeps an unknown claim outcome away from another write and retries the account read", async () => {
		signIn();
		const accountLoader = vi
			.fn()
			.mockResolvedValueOnce(joinOnly)
			.mockRejectedValueOnce(new Error("Account unavailable"))
			.mockResolvedValue(seated);
		const seatClaimer = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
		renderPlay({ accountLoader, seatClaimer });
		await fireEvent.click(await screen.findByRole("button", { name: /Play as Renn/ }));
		await screen.findByText(/could not confirm whether this hero is yours/);
		expect(screen.queryByRole("button", { name: /Play as Renn/ })).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
		await screen.findByRole("heading", { level: 3, name: "Common Room" });
		expect(seatClaimer).toHaveBeenCalledTimes(1);
	});

	it("retains a definite rejection after checking current ownership", async () => {
		signIn();
		const seatClaimer = vi.fn().mockRejectedValue(new AccountApiError("Claim not allowed", 403));
		renderPlay({ seatClaimer });
		await fireEvent.click(await screen.findByRole("button", { name: /Play as Renn/ }));
		await screen.findByText("Claim not allowed");
		expect(screen.getByRole("button", { name: /Play as Renn/ }).hasAttribute("disabled")).toBe(
			false,
		);
		expect(seatClaimer).toHaveBeenCalledTimes(1);
	});

	it("does not present an empty account read as proof that a timed-out write cannot finish", async () => {
		signIn();
		const seatClaimer = vi.fn().mockRejectedValue(new AccountApiError("Claim timed out", 524));
		renderPlay({ seatClaimer });
		await fireEvent.click(await screen.findByRole("button", { name: /Play as Renn/ }));
		await screen.findByText(/could not confirm whether this hero is yours/);
		expect(screen.queryByRole("button", { name: /Play as Renn/ })).toBeNull();
		await fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
		await screen.findByRole("button", { name: /Play as Renn/ });
		expect(screen.queryByText(/Checking whether this hero is yours/)).toBeNull();
		expect(seatClaimer).toHaveBeenCalledTimes(1);
	});

	it("does not switch worlds when reconciliation finds another owned hero", async () => {
		signIn();
		const accountLoader = vi
			.fn()
			.mockResolvedValueOnce(joinOnly)
			.mockResolvedValue({
				...seated,
				seat: { slug: "demo2", actor_id: "9", role: "primary" },
			});
		const seatClaimer = vi.fn().mockRejectedValue(new AccountApiError("Claim timed out", 524));
		renderPlay({ accountLoader, seatClaimer });
		await fireEvent.click(await screen.findByRole("button", { name: /Play as Renn/ }));
		await screen.findByText(/already holds another hero/);
		expect(screen.queryByRole("heading", { level: 3, name: "Common Room" })).toBeNull();
		expect(seatClaimer).toHaveBeenCalledTimes(1);
	});

	it("tells the player when the claim was not written to the catalog", async () => {
		signIn();
		const accountLoader = vi
			.fn<() => Promise<AccountGetResponse>>()
			.mockResolvedValueOnce(joinOnly)
			.mockResolvedValue(seated);
		const seatClaimer = vi.fn(async () => ({
			seat: { slug: "demo1", actor_id: "7", role: "primary" },
			membership_not_persisted: true as const,
		}));
		renderPlay({ accountLoader, seatClaimer });

		await waitFor(() => expect(screen.getByTestId("hero-choices")).toBeTruthy());
		await fireEvent.click(screen.getByRole("button", { name: /Play as Renn/ }));

		// A claim the catalog could not record is still a claim: the player enters.
		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
		);
		expect(screen.getByText(/not\s+written to the world catalog/)).toBeTruthy();
	});

	it("opens a hero the seat board says is mine even when the account reports no seat", async () => {
		// ADR-0161 D-6: the account reports at most one seat; the board lists all
		// that the person holds. A board `mine` row is enough to play.
		signIn();
		const seatsLoader = vi.fn(async () => [
			{ actor_id: "7", name: "Renn", claimed: true, mine: true },
		]);
		renderPlay({ seatsLoader });

		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
		);
		expect(screen.queryByTestId("hero-choices")).toBeNull();
	});

	it("stays honest when no world is open to the account", async () => {
		signIn();
		renderPlay({
			account: { sub: "user_new", capabilities: [], worlds: [], seat: null },
		});

		await waitFor(() =>
			expect(screen.getByText(/No world is open to this account yet/)).toBeTruthy(),
		);
		expect(screen.queryByTestId("hero-choices")).toBeNull();
		// No button may promise a hero that cannot be claimed.
		expect(screen.queryByRole("button", { name: /Play as/ })).toBeNull();
	});
});
