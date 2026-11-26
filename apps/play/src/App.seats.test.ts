import { PKCE_STORAGE_KEY, SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import { AccountApiError, type AccountGetResponse } from "./lib/account-api";
import type { OpenPlaySessionArgs } from "./lib/play-session";
import { SELECTED_SEAT_KEY } from "./lib/seats";
import { fakeHandle, sampleView } from "./test/sample-view";

/**
 * In-app seat choice (ADR-0161 D-6). One identity may hold several seats in a
 * world; the SPA picks the hero, names it on every world call, and the module
 * checks the binding. There is no select-seat reducer and no new login.
 */

const startLogin = vi.hoisted(() => vi.fn());
vi.mock("@spellkave/authkit", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@spellkave/authkit")>();
	return { ...actual, startLogin };
});

const account: AccountGetResponse = {
	sub: "user_a",
	capabilities: [],
	worlds: [
		{
			slug: "demo1",
			display_name: "The Woven Marches",
			role: "member",
			capabilities: ["world.play"],
		},
		{
			slug: "demo2",
			display_name: "The Salt Reach",
			role: "member",
			capabilities: ["world.play"],
		},
	],
	seat: { slug: "demo1", actor_id: "7", role: "primary" },
};

const boards: Record<
	string,
	{ actor_id: string; name: string; claimed: boolean; mine: boolean }[]
> = {
	demo1: [
		{ actor_id: "7", name: "Renn", claimed: true, mine: true },
		{ actor_id: "9", name: "Mara", claimed: true, mine: true },
		{ actor_id: "11", name: "Other", claimed: true, mine: false },
	],
	demo2: [{ actor_id: "3", name: "Tolly", claimed: true, mine: true }],
};

function signIn(): void {
	sessionStorage.setItem(
		SESSION_STORAGE_KEY,
		JSON.stringify({
			access_token: "test-token",
			id_token: "",
			expires_at: Date.now() + 60_000,
			display_name: "Test Player",
		}),
	);
}

const heldSeatsOf = (...ids: string[]): NonNullable<AccountGetResponse["seats"]> =>
	ids.map((id) => ({ slug: "demo1", actor_id: id, body_id: `b${id}`, role: "primary" }));

function renderPlay(
	options: {
		account?: AccountGetResponse;
		accountLoader?: () => Promise<AccountGetResponse>;
		board?: typeof boards;
	} = {},
) {
	const disconnect = vi.fn();
	const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
		args.onView(sampleView);
		return fakeHandle({ disconnect });
	});
	const seatsLoader = vi.fn(
		async (_url: string, _token: string, slug: string) => (options.board ?? boards)[slug] ?? [],
	);
	const seatClaimer = vi.fn(
		async (_url: string, _token: string, slug: string, actorId: string) => ({
			seat: { slug, actor_id: actorId, role: "primary" },
		}),
	);
	const accountLoader = vi.fn(options.accountLoader ?? (async () => options.account ?? account));
	render(App, {
		accountLoader,
		seatClaimer,
		catalogLoader: vi.fn(async () => [
			{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
			{ slug: "demo2", name: "The Salt Reach", db: "spellkave-demo2" },
		]),
		seatsLoader,
		worldOpener,
	});
	return { worldOpener, disconnect, seatsLoader, seatClaimer, accountLoader };
}

async function openSwitchHero(): Promise<void> {
	const seal = await screen.findByRole("button", { name: /seat menu/ });
	await fireEvent.keyDown(seal, { key: "Enter" });
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Switch hero" }));
}

afterEach(async () => {
	cleanup();
	sessionStorage.clear();
	startLogin.mockClear();
	window.history.replaceState({}, "", "/");
	await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("choosing among held seats", () => {
	it("opens the stored hero when two seats are mine", async () => {
		signIn();
		sessionStorage.setItem(SELECTED_SEAT_KEY, "demo1/9");
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		expect(r.worldOpener.mock.calls[0]?.[0].actorId).toBe("9");
	});

	it("falls back to the account's seat when the stored hero is not held", async () => {
		signIn();
		sessionStorage.setItem(SELECTED_SEAT_KEY, "demo1/11");
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		expect(r.worldOpener.mock.calls[0]?.[0].actorId).toBe("7");
	});

	it("takes the hero from ?actor= next to ?world= and remembers it", async () => {
		signIn();
		window.history.replaceState({}, "", "/?world=demo1&actor=9");
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		expect(r.worldOpener.mock.calls[0]?.[0].actorId).toBe("9");
		expect(sessionStorage.getItem(SELECTED_SEAT_KEY)).toBe("demo1/9");
	});

	it("opens the account's seat when nothing was chosen", async () => {
		signIn();
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		expect(r.worldOpener.mock.calls[0]?.[0].actorId).toBe("7");
	});
});

describe("Switch hero", () => {
	it("is offered with one seat, and lists the free heroes of this world to claim", async () => {
		signIn();
		const r = renderPlay({
			board: {
				demo1: [
					{ actor_id: "7", name: "Renn", claimed: true, mine: true },
					{ actor_id: "11", name: "Other", claimed: true, mine: false },
					{ actor_id: "12", name: "Fresh", claimed: false, mine: false },
				],
			},
		});
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await openSwitchHero();
		const boardsShown = await screen.findAllByTestId("seat-board");
		await waitFor(() => expect(screen.getAllByTestId("seat-board")).toHaveLength(2));
		const free = screen.getAllByTestId("seat-board")[1] as HTMLElement;
		expect(within(free).getByText("Free heroes in The Woven Marches")).toBeTruthy();
		expect(
			within(free).getByRole("button", { name: "Claim Fresh in The Woven Marches" }),
		).toBeTruthy();
		expect(within(free).queryByText("Other")).toBeNull();
		expect(boardsShown.length).toBeGreaterThan(0);
	});

	it("hides the free-heroes board when nothing is claimable", async () => {
		signIn();
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await openSwitchHero();
		await screen.findByTestId("seat-board");
		await waitFor(() => expect(r.seatsLoader).toHaveBeenCalled());
		expect(screen.queryByText(/Free heroes in/)).toBeNull();
	});

	it("claims another hero from the dialog and plays it on the same token", async () => {
		signIn();
		const withFree = {
			demo1: [
				{ actor_id: "7", name: "Renn", claimed: true, mine: true },
				{ actor_id: "12", name: "Fresh", claimed: false, mine: false },
			],
		};
		const r = renderPlay({ board: withFree });
		// The claim lands: the board now lists the new hero as mine.
		r.seatClaimer.mockImplementation(async (_url, _token, slug, actorId) => {
			const row = withFree.demo1.find((candidate) => candidate.actor_id === actorId);
			if (row) Object.assign(row, { claimed: true, mine: true });
			return { seat: { slug, actor_id: actorId, role: "primary" } };
		});
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await openSwitchHero();
		await fireEvent.click(
			await screen.findByRole("button", { name: "Claim Fresh in The Woven Marches" }),
		);

		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
		expect(r.seatClaimer).toHaveBeenCalledOnce();
		expect(r.seatClaimer.mock.calls[0]?.slice(1)).toEqual(["test-token", "demo1", "12"]);
		expect(r.worldOpener.mock.calls[1]?.[0]).toMatchObject({
			actorId: "12",
			db: "spellkave-demo1",
			token: "test-token",
		});
		expect(sessionStorage.getItem(SELECTED_SEAT_KEY)).toBe("demo1/12");
		expect(startLogin).not.toHaveBeenCalled();
	});

	it("says so inside the dialog when the world's seat cap refuses the claim", async () => {
		signIn();
		const r = renderPlay({
			board: {
				demo1: [
					{ actor_id: "7", name: "Renn", claimed: true, mine: true },
					{ actor_id: "12", name: "Fresh", claimed: false, mine: false },
				],
			},
		});
		r.seatClaimer.mockRejectedValue(
			new AccountApiError("sender already holds 3 seat(s)", 409, "seat_cap_reached"),
		);
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await openSwitchHero();
		await fireEvent.click(
			await screen.findByRole("button", { name: "Claim Fresh in The Woven Marches" }),
		);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("You already play the most heroes this world allows.");
		expect(r.worldOpener).toHaveBeenCalledOnce();
		expect(r.disconnect).not.toHaveBeenCalled();
		expect(sessionStorage.getItem(SELECTED_SEAT_KEY)).not.toBe("demo1/12");
	});

	it("reopens the session as the other hero in the same world without a new login", async () => {
		signIn();
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await openSwitchHero();
		const board = await screen.findByTestId("seat-board");
		expect(within(board).getByText("Tolly")).toBeTruthy();
		await fireEvent.click(
			within(board).getByRole("button", { name: "Switch to Mara in The Woven Marches" }),
		);

		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
		expect(r.worldOpener.mock.calls[1]?.[0].actorId).toBe("9");
		expect(r.worldOpener.mock.calls[1]?.[0].db).toBe("spellkave-demo1");
		expect(r.worldOpener.mock.calls[1]?.[0].token).toBe("test-token");
		expect(r.disconnect).toHaveBeenCalledOnce();
		expect(sessionStorage.getItem(SELECTED_SEAT_KEY)).toBe("demo1/9");
		expect(startLogin).not.toHaveBeenCalled();
		expect(sessionStorage.getItem(PKCE_STORAGE_KEY)).toBeNull();
	});

	it("lists a seat claimed after connect when the view opens", async () => {
		signIn();
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await waitFor(() => expect(r.seatsLoader).toHaveBeenCalled());
		// Later calls (the refresh on opening the view) see a newly claimed seat.
		r.seatsLoader.mockImplementation(async (_url, _token, slug) =>
			slug === "demo1"
				? [
						...(boards.demo1 ?? []),
						{ actor_id: "13", name: "Newly Claimed", claimed: true, mine: true },
					]
				: (boards[slug] ?? []),
		);
		const calls = r.seatsLoader.mock.calls.length;
		await openSwitchHero();
		const board = await screen.findByTestId("seat-board");
		await waitFor(() => expect(within(board).getByText("Newly Claimed")).toBeTruthy());
		expect(r.seatsLoader.mock.calls.length).toBeGreaterThan(calls);
		expect(r.seatsLoader.mock.calls.at(-1)?.[1]).toBe("test-token");
		expect(within(board).getByText("Tolly")).toBeTruthy();
	});

	it("opens a hero of another world on the same token", async () => {
		signIn();
		const r = renderPlay();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await openSwitchHero();
		const board = await screen.findByTestId("seat-board");
		await fireEvent.click(
			within(board).getByRole("button", { name: "Switch to Tolly in The Salt Reach" }),
		);

		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
		expect(r.worldOpener.mock.calls[1]?.[0]).toMatchObject({
			actorId: "3",
			db: "spellkave-demo2",
			token: "test-token",
		});
		expect(startLogin).not.toHaveBeenCalled();
	});
});

describe("account.seats", () => {
	it("chooses the hero without reading the world's board", async () => {
		signIn();
		sessionStorage.setItem(SELECTED_SEAT_KEY, "demo1/9");
		// A board that never answers would hang a bootstrap that waited on it.
		const r = renderPlay({
			account: { ...account, seats: heldSeatsOf("7", "9") },
			board: undefined,
		});
		r.seatsLoader.mockImplementation(() => new Promise(() => {}));
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		// The selection names actor 9; the world session resolves its subject by
		// BODY id, which seats[] carries (live staging run, 2026-10-16: actor id
		// 85 failed with "actor '85' not found in live actor_spatial_location").
		expect(r.worldOpener.mock.calls[0]?.[0].actorId).toBe("b9");
	});

	it("falls back to the board when the world is in seats_unread", async () => {
		signIn();
		sessionStorage.setItem(SELECTED_SEAT_KEY, "demo1/9");
		const r = renderPlay({
			account: { ...account, seats: [], seats_unread: ["demo1"] },
		});
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		expect(r.worldOpener.mock.calls[0]?.[0].actorId).toBe("9");
		expect(r.seatsLoader).toHaveBeenCalled();
	});

	it("reconciles a failed claim when seats[] lists the claimed seat next to others", async () => {
		signIn();
		const seatless: AccountGetResponse = { ...account, seat: null, seats: [] };
		const claimed: AccountGetResponse = {
			...account,
			seats: heldSeatsOf("5", "12"),
		};
		let calls = 0;
		const r = renderPlay({
			accountLoader: async () => (calls++ === 0 ? seatless : claimed),
			board: {
				demo1: [{ actor_id: "12", name: "Fresh", claimed: false, mine: false }],
			},
		});
		r.seatClaimer.mockRejectedValue(new AccountApiError("boom", 502));
		await fireEvent.click(await screen.findByRole("button", { name: "Play as Fresh" }));

		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		expect(r.worldOpener.mock.calls[0]?.[0].actorId).toBe("b5");
		expect(screen.queryByText(/already holds another hero/)).toBeNull();
	});
});
