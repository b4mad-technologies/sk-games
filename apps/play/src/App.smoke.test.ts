import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PKCE_STORAGE_KEY, SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import type { AccountGetResponse } from "./lib/account-api";
import { type PlayObservation, playObservation } from "./lib/play-observation";
import { operationsFromPayload } from "./lib/play-operations";
import { type OpenPlaySessionArgs, PlayAttemptBlockedError } from "./lib/play-session";
import { playTrail } from "./lib/play-trail";
import { hideDraftVitals, type PlayView } from "./lib/play-view";
import { playCopy } from "./lib/player-copy";
import { clearReferenceVocabularyCache } from "./lib/reference-vocabulary";
import { downedHeroView } from "./playground/fixtures";
import {
	brawlView,
	configuredSheetView,
	fakeHandle,
	fightView,
	fightWithConditionsView,
	placeDetailView,
	reactionView,
	sampleView,
	streamDetailView,
	talkBurstView,
	talkGroupView,
	talkView,
	threeRatsView,
} from "./test/sample-view";

/**
 * `@spellkave/map-canvas` pulls in MapLibre (~207 KB gzipped) via its own
 * runtime dynamic `import()`, which jsdom has no business loading. `FakeMapCanvas`
 * stands in and echoes every prop `MapTile.svelte` forwards onto a `data-*`
 * attribute; `mapCanvasImported` proves the map tile only imports the real
 * package once it is actually opened (`vi.hoisted`: `vi.mock` factories run
 * before this file's own top-level code, so the flag must be created that way
 * to be visible inside the factory closure).
 */
const mapCanvasImportTracker = vi.hoisted(() => ({ imported: false }));
vi.mock("@spellkave/map-canvas", async () => {
	mapCanvasImportTracker.imported = true;
	const mod = await import("./test/FakeMapCanvas.svelte");
	return { MapCanvas: mod.default };
});

const playerAccount: AccountGetResponse = {
	sub: "user_a",
	capabilities: [],
	worlds: [
		{
			slug: "demo1",
			display_name: "The Woven Marches",
			role: "member",
			capabilities: ["world.observe", "world.play"],
		},
	],
	seat: { slug: "demo1", actor_id: "7", role: "primary" },
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

function renderPlay(
	options: {
		account?: AccountGetResponse;
		view?: PlayView;
		accountLoader?: () => Promise<AccountGetResponse>;
		seatsLoader?: () => Promise<
			{ actor_id: string; name: string; claimed: boolean; mine: boolean }[]
		>;
		/** Overrides the fake session handle's own `act` outcome — the text
		 * `PlayTable`'s explore stream records as the activity's `body`
		 * (sk-jay0.1.8.63.6: proving a reference term inside it links). */
		actResult?: string;
	} = {},
): {
	move: ReturnType<typeof vi.fn>;
	act: ReturnType<typeof vi.fn>;
	endTurn: ReturnType<typeof vi.fn>;
	selectItem: ReturnType<typeof vi.fn>;
	selectOccupant: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	worldOpener: ReturnType<typeof vi.fn>;
} {
	const move = vi.fn(async () => "You arrive at Stairs.");
	const act = vi.fn(async () => options.actResult ?? "You strike the rat.");
	const endTurn = vi.fn(async () => "Your turn is over.");
	const selectItem = vi.fn(async () => {});
	const selectOccupant = vi.fn(async () => {});
	const disconnect = vi.fn();
	const handle = fakeHandle({ move, act, endTurn, selectItem, selectOccupant, disconnect });
	const account = options.account ?? playerAccount;
	const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
		args.onView(options.view ?? sampleView);
		return handle;
	});
	render(App, {
		accountLoader: options.accountLoader ?? vi.fn(async () => account),
		catalogLoader: vi.fn(async () => [
			{ slug: "demo1", name: "The Woven Marches", db: "spellkave-demo1" },
		]),
		seatsLoader: options.seatsLoader ?? vi.fn(async () => []),
		worldOpener,
	});
	return { move, act, endTurn, selectItem, selectOccupant, disconnect, worldOpener };
}

afterEach(async () => {
	window.sessionStorage.clear();
	vi.restoreAllMocks();
	await new Promise((resolve) => setTimeout(resolve, 50));
});

/**
 * `element.textContent` collapsed to one line, with anything visually
 * hidden dropped first — an occupant `InfoLink`'s own "details" suffix
 * (sk-jay0.1.8.63.10, a visually-hidden `sr-only` span) and an `ActionMenu`
 * trigger's `aria-hidden` glyph both live in ordinary text content, so a
 * prose assertion against the visible sentence needs this rather than a raw
 * `textContent` read.
 */
function visibleText(element: Element): string {
	const clone = element.cloneNode(true) as Element;
	for (const node of Array.from(clone.querySelectorAll(".sr-only, [aria-hidden='true']")))
		node.remove();
	return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The layout belongs to the player (axiom A2,
 * `ledger/designs/play-interaction-axioms.md`): a fight only OFFERS its
 * map-first layout in the dock's notice slot. Tests that look at the fight's
 * card-level Table take the offer the way a player would. */
async function takeFightLayoutOffer(): Promise<void> {
	await fireEvent.click(await screen.findByRole("button", { name: "Map view" }));
	await waitFor(() =>
		expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).toBe("card"),
	);
}

describe("play App (smoke)", () => {
	it("reads a timed activity without presenting a fight or executing an action", async () => {
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		signIn();
		const operations = operationsFromPayload({
			status: "session_detail",
			session: {
				session_id: "42",
				label: "Attune the beacon",
				lifecycle: "waiting-on-external",
				turn_rule: "Sequential",
				timing: { basis: "world_ticks", duration_ticks: "4", estimated_remaining_ticks: "0" },
			},
			ongoing: {
				items: [{ session_id: "42", label: "Attune the beacon", lifecycle: "waiting-on-external" }],
				matched: 1,
				next_cursor: null,
			},
		});
		const { act, move, endTurn } = renderPlay({
			view: {
				...fightView,
				session: { ...fightView.session, id: "42" },
				operations,
				turnSession: operations.selected,
			},
		});
		const reader = await screen.findByRole("button", {
			name: "Attune the beacon: waiting-on-external",
		});
		expect(screen.queryByRole("button", { name: "End turn" })).toBeNull();
		expect(document.querySelector('[data-slot="play-combat"]')).toBeNull();
		const activity = document.querySelector('[data-slot="activity-status"]');
		const stream = document.querySelector(".table-explore-stream");
		expect(activity).not.toBeNull();
		expect(stream?.contains(activity)).toBe(true);
		expect(stream?.lastElementChild?.contains(activity ?? null)).toBe(true);
		await waitFor(() =>
			expect(events).toContainEqual(
				expect.objectContaining({
					phase: "presentation",
					activity_mounted: true,
					activity_state: "waiting",
					activity_progress: 100,
				}),
			),
		);
		await fireEvent.click(reader);
		expect(await screen.findByRole("dialog", { name: "Attune the beacon" })).toBeTruthy();
		expect(screen.getByText("Estimated remaining world ticks")).toBeTruthy();
		expect(act).not.toHaveBeenCalled();
		expect(move).not.toHaveBeenCalled();
		expect(endTurn).not.toHaveBeenCalled();
	});

	it("keeps numbered offers reachable before their conversation anchor arrives (round 3: the dock's own answers row, anchor-independent)", async () => {
		signIn();
		const { act } = renderPlay({
			view: {
				...talkView,
				speech: [],
				// A dialog slot is carried by a communication act in the live
				// world, so it may truthfully advertise text carriage. The dock
				// must nevertheless invoke the numbered choice directly.
				actions: talkView.actions.map((action) =>
					action.id === "h:answer-1" ? { ...action, acceptsUtterance: true } : action,
				),
			},
		});
		// No speech at all: the dialogue opens on the offered numbered answers
		// alone, and with no prompt line to read a word from, each choice falls
		// back to its own authored action label ("Answer — Fighter") — the
		// dock's own primary row still renders it directly, never behind a
		// disclosure (`talkDockFromView`'s `answers` reads `dialogue.choiceActions`
		// itself, not the thread's anchor-bound chips).
		await fireEvent.click(await screen.findByRole("button", { name: "1 Answer — Fighter" }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:answer-1" });
	});

	it("keeps an alternate speech handle for the same target reachable as its own words-taking hotbar slot", async () => {
		signIn();
		const alternate = {
			id: "h:whisper",
			label: "Whisper",
			verb: "communicate",
			descriptor: "demo/whisper",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: true,
		};
		const { act } = renderPlay({
			view: { ...talkView, actions: [...talkView.actions, alternate] },
		});
		// A second acceptsUtterance handle to the same target does not become the
		// composer's own DEFAULT (that stays the first one, deduped by
		// target) — it still joins HERE (Aldwin is the open dialogue's own
		// speaker) as its own slot; pressing it sets the composer's mode
		// instead of acting (axiom A4, "the composer follows the selection").
		await fireEvent.click(await screen.findByRole("button", { name: /Whisper/ }));
		await fireEvent.input(screen.getByLabelText(/Say or do something — Whisper/), {
			target: { value: "quietly" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: alternate.id });
		expect(act.mock.calls[0]?.[1]).toBe("quietly");
	});

	it("keeps the dialogue's own answers reachable in the dock even while the transcript is filtered to someone else", async () => {
		signIn();
		const otherSpeaker = {
			id: "h:caddoc",
			label: "Speak To — Brother Caddoc",
			verb: "communicate",
			descriptor: "demo/speak",
			targetName: "Brother Caddoc",
			targetRef: "entity:9",
			acceptsUtterance: true,
		};
		const { act } = renderPlay({
			view: { ...talkView, actions: [...talkView.actions, otherSpeaker] },
		});
		const participant = await waitFor(() => {
			const element = document.querySelector(
				'[data-slot="talk-participants"] button[aria-label="Brother Caddoc"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLButtonElement;
		});
		// A second tap on the already-targeted participant filters the
		// transcript to him — Aldwin's own line, and the thread chips it would
		// have carried, drop out of view. The dock's own answers row does not
		// depend on the transcript filter (or an anchor line) at all, so
		// Aldwin's numbered answer stays reachable regardless.
		await fireEvent.click(participant);
		await fireEvent.click(screen.getByRole("button", { name: "1 Answer — Fighter" }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:answer-1" });
	});

	it("shows only currently addressable occupants in the Table conversation head", async () => {
		signIn();
		renderPlay({
			view: {
				...talkView,
				occupants: [
					...talkView.occupants,
					{
						id: "18",
						handle: "s:actor:18",
						rev: "operator",
						name: "World Operator",
						kind: "person",
						sceneKind: "actor",
						note: "",
						conditions: [],
					},
				],
			},
		});
		const head = await waitFor(() => {
			const element = document.querySelector('[data-slot="talk-participants"]');
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(
			within(head).getByRole("button", { name: "Aldwin, keeper of the hearth-ledger" }),
		).toBeTruthy();
		expect(within(head).queryByRole("button", { name: "World Operator" })).toBeNull();
	});

	it("mounts the SAME stream element instance across Explore→Talk, keeping earlier rows (sk-jay0.1.8.63.1 Part B)", async () => {
		signIn();
		// sampleView opens on Explore with two stream rows already: the opening
		// place-arrival divider ("Common Room") and Aldwin's seeded line.
		const { worldOpener } = renderPlay();
		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 4, name: "Common Room" })).toBeTruthy(),
		);
		expect(screen.getAllByText(/rats, by the sound of it/).length).toBeGreaterThan(0);
		const streamBefore = document.querySelector(
			'[data-tile="table"] ol[data-slot="activity-feed"]',
		);
		expect(streamBefore).not.toBeNull();

		// A dialogue opens (a numbered answer arrives) without the world ever
		// dropping the earlier line from `view.speech` — the realistic shape of
		// a view push, unlike swapping to an entirely different fixture.
		const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
		args.onView({
			...sampleView,
			actions: [
				...sampleView.actions,
				{
					id: "h:answer-1",
					label: "Answer — Fighter",
					verb: "communicate",
					descriptor: "dm/dialog/answer",
					targetName: "Aldwin, keeper of the hearth-ledger",
					targetRef: "entity:4",
					acceptsUtterance: false,
					slot: 1,
				},
			],
		});

		// Talk is open now (the participant head mounts above the stream), yet
		// the Table tile still mounts the SAME `ActivityFeed` element instance
		// — entering a conversation never swaps the list renderer — and both
		// earlier rows are still there.
		await waitFor(() =>
			expect(document.querySelector('[data-slot="talk-participants"]')).not.toBeNull(),
		);
		const streamAfter = document.querySelector('[data-tile="table"] ol[data-slot="activity-feed"]');
		expect(streamAfter).toBe(streamBefore);
		expect(screen.getByRole("heading", { level: 4, name: "Common Room" })).toBeTruthy();
		expect(screen.getAllByText(/rats, by the sound of it/).length).toBeGreaterThan(0);
	});

	it("does not carry a selected speaker or transcript filter into a new place", async () => {
		signIn();
		const { act, worldOpener } = renderPlay({ view: talkGroupView });
		const aldwin = await waitFor(() => {
			const element = document.querySelector(
				'[data-slot="talk-participants"] button[aria-label="Aldwin, keeper of the hearth-ledger"]',
			);
			expect(element).not.toBeNull();
			return element as HTMLButtonElement;
		});
		// First tap SELECTS Aldwin (axiom A4) and arms the composer at his own
		// "Speak To" slot; the second intentionally filters the local
		// transcript to him.
		await fireEvent.click(aldwin);
		await fireEvent.input(screen.getByLabelText(/Say or do something/), {
			target: { value: "hail" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:talk" });
		act.mockClear();
		await fireEvent.click(aldwin);
		expect(aldwin.getAttribute("aria-pressed")).toBe("true");

		// A realistic move hands back a NEW occupant/action list scoped to the
		// new place — Aldwin is simply not there any more, so the stale-
		// selection effect (`selection.ts`) drops him rather than leaving the
		// composer aimed at someone who left.
		const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
		args.onView({
			...talkGroupView,
			hero: { ...talkGroupView.hero, placeId: "inn/bar" },
			// biome-ignore lint/style/noNonNullAssertion: fixed sample fixture supplies a place
			place: { ...talkGroupView.place!, id: "inn/bar", name: "Bar" },
			occupants: talkGroupView.occupants.filter((occupant) => occupant.id === "40"),
			actions: talkGroupView.actions.filter((action) => action.id === "h:talk-mira"),
			speech: [
				...talkGroupView.speech,
				{
					id: "speech:33",
					tick: 63,
					speakerId: "40",
					speaker: "Mira",
					text: "The bar is quieter here.",
					mine: false,
				},
			],
		});

		// The fresh place's own last speaker is Mira — the old Aldwin filter
		// and selection are both gone, so the group channel and composer
		// follow her instead.
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Aldwin, keeper of the hearth-ledger" }),
			).toBeNull(),
		);
		await fireEvent.input(screen.getByLabelText(/Say or do something/), {
			target: { value: "hi" },
		});
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:talk-mira" });
	});

	it("records intent before a stalled action and rendered only after feedback commits", async () => {
		signIn();
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		const { move } = renderPlay();
		let complete: (value: string) => void = () => {};
		move.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					complete = resolve;
				}),
		);
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		await fireEvent.click(await screen.findByRole("button", { name: /^Stairs \(southeast\)/ }));
		expect(move).not.toHaveBeenCalled();
		await fireEvent.click(
			within(screen.getByTestId("play-dock")).getByRole("button", { name: /Travel to Stairs/ }),
		);
		const intent = events.find((e) => e.phase === "intent");
		expect(intent?.intent).toBe("move");
		expect(events.some((e) => e.phase === "rendered")).toBe(false);
		expect(move.mock.calls[0]?.[1]).toBe(intent?.interaction);
		complete("You arrive at Stairs.");
		await waitFor(() => expect(events.some((e) => e.phase === "rendered")).toBe(true));
		expect(events.find((e) => e.phase === "rendered")?.feedback).toBe(false);
		await fireEvent.click(screen.getByRole("button", { name: "Open Table" }));
		expect(document.querySelector('[data-tile="table"]')?.textContent).toContain(
			"You arrive at Stairs.",
		);
		expect(events.find((e) => e.phase === "rendered")?.interaction).toBe(intent?.interaction);
		expect(intent?.action_surface).toBe("table");
		playObservation.subscribe(() => {});
	});
	it("does not claim feedback mounted when the table was collapsed during the call", async () => {
		signIn();
		const events: PlayObservation[] = [];
		playObservation.subscribe((event) => events.push(event));
		const { move } = renderPlay();
		let complete: (value: string) => void = () => {};
		move.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					complete = resolve;
				}),
		);
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		await fireEvent.click(await screen.findByRole("button", { name: /^Stairs \(southeast\)/ }));
		await fireEvent.click(
			within(screen.getByTestId("play-dock")).getByRole("button", { name: /Travel to Stairs/ }),
		);
		await fireEvent.click(screen.getByRole("button", { name: "Open You" }));
		complete("You arrive at Stairs.");
		await waitFor(() => expect(events.some((e) => e.phase === "rendered")).toBe(true));
		expect(events.find((e) => e.phase === "rendered")?.feedback).toBe(false);
		playObservation.subscribe(() => {});
	});
	it("seats the claimed hero at the table: place, company, dialogue, self, chronicle", async () => {
		signIn();
		renderPlay();

		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
		);
		// Where you stand, and who is here — at rest the Place tile is a card:
		// name, a bounded description, presence/exit counts, not movement
		// buttons or the interactive occupant list. The dock's own "3 ways
		// out" menu trigger repeats the same text, so this scopes to the
		// Place tile itself.
		expect(screen.queryByRole("button", { name: /Go to Stairs/ })).toBeNull();
		const placeTile = document.querySelector('[data-slot="play-place"]');
		expect(placeTile).toBeTruthy();
		expect(within(placeTile as HTMLElement).getByText("3 ways out")).toBeTruthy();
		expect(placeTile?.textContent).toContain(
			"3 here: Aldwin, keeper of the hearth-ledger · Brother Caddoc · Hearth",
		);
		// What Aldwin said (explore: the table is stale on his last line, not a
		// stuck Talk — sk-jay0.1.8.5 finding 3), with one say field to answer.
		expect(screen.getAllByText(/rats, by the sound of it/).length).toBeGreaterThan(0);
		expect(screen.getByLabelText(/^Say or do something/)).toBeTruthy();
		// Who you are — the Hero tile is also a card at rest: name, level line,
		// HP/AC/XP with the short term (sk-jay0.1.8.5 finding 2).
		expect(screen.getByRole("heading", { level: 3, name: "Renn the Roadwarden" })).toBeTruthy();
		expect(screen.getByText("Level 1")).toBeTruthy();
		expect(screen.getByText("HP")).toBeTruthy();
		expect(screen.getByText("11")).toBeTruthy();
		expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
		// The Pack tile is also a card at rest: equipped chips plus an item
		// count, not the reachable pack list (sk-jay0.1.8.5 finding 2).
		expect(screen.getByText("Longsword")).toBeTruthy();
		expect(screen.getByText("3 kinds · 5 pieces")).toBeTruthy();
		expect(document.querySelector('[data-tile="chronicle"]')).toBeNull();
		expect(document.querySelectorAll("[data-tile]")).toHaveLength(5);
		expect(screen.getByText("The eastern road opened.")).toBeTruthy();

		expect(screen.queryByText(/world understands what you mean/i)).toBeNull();
	});

	it("selects visible Place and Pack card subjects into the dock", async () => {
		signIn();
		renderPlay({ view: sampleView });
		await screen.findByRole("heading", { level: 3, name: "Common Room" });

		const dock = within(screen.getByTestId("play-dock"));
		const placeTile = document.querySelector('[data-tile="place"]') as HTMLElement;
		await fireEvent.click(
			within(placeTile).getByRole("button", { name: "Aldwin, keeper of the hearth-ledger" }),
		);
		expect(dock.getByRole("button", { name: /Ask Aldwin About Advancement/ })).toBeTruthy();

		const packTile = document.querySelector('[data-tile="pack"]') as HTMLElement;
		await fireEvent.click(within(packTile).getByRole("button", { name: "Longsword" }));
		expect(dock.getByRole("button", { name: /Unequip/ })).toBeTruthy();
	});

	it("passes account-authorized tool roles into the one shared world session", async () => {
		signIn();
		const { worldOpener } = renderPlay();
		await waitFor(() => expect(worldOpener).toHaveBeenCalledOnce());
		expect(worldOpener.mock.calls[0]?.[0]).toMatchObject({
			db: "spellkave-demo1",
			actorId: "7",
			token: "test-token",
			authorizedToolRoles: ["PLAYER"],
		});
	});

	it("walks through an exit by its scene handle and reports the arrival", async () => {
		signIn();
		const { move } = renderPlay();
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const exit = await screen.findByRole("button", { name: /^Stairs \(southeast\)/ });
		await fireEvent.click(exit);
		expect(move).not.toHaveBeenCalled();
		await fireEvent.keyDown(exit, { key: "1" });
		await waitFor(() => expect(move).toHaveBeenCalledOnce());
		expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: "s:exit:1", rev: "r1" });
		await fireEvent.click(screen.getByRole("button", { name: "Open Table" }));
		expect(document.querySelector('[data-tile="table"]')?.textContent).toContain(
			"You arrive at Stairs.",
		);
	});

	it("keeps beat-relevant actions in the bottom dock and the long tail behind its disclosure", async () => {
		signIn();
		const { act } = renderPlay();
		const dock = within(await screen.findByTestId("play-dock"));
		// Nothing is selected: the compact row shows ME (there is no HERE —
		// sampleView authors no untargeted/place-scoped action). A generic
		// check collapses into ME's own "Checks" menu; "Look around" stays a
		// direct slot.
		const look = dock.getByRole("button", { name: /Look around/ });
		expect(dock.queryByRole("button", { name: "Check: Arcana" })).toBeNull();
		await fireEvent.keyDown(dock.getByRole("button", { name: "More for Me" }), { key: "Enter" });
		const moreMenu = await screen.findByRole("menu");
		await fireEvent.keyDown(within(moreMenu).getByRole("menuitem", { name: "Checks" }), {
			key: "Enter",
		});
		expect(await screen.findByRole("menuitem", { name: "Check: Arcana" })).toBeTruthy();
		await fireEvent.keyDown(moreMenu, { key: "Escape" });

		// The Table tile itself is a pure stream now — the dock is the only
		// composer and the only next-step surface.
		expect(document.querySelector('[data-tile="table"] footer')).toBeNull();

		await fireEvent.click(look);
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:look" });
		expect(act.mock.calls[0]?.[1]).toBeUndefined();
		// Explore does not discard a returned action outcome behind the next
		// status line. Its shared ActivityFeed holds it in reader order instead
		// — the one list every scene shares (sk-jay0.1.8.63.1 Part B), so it
		// carries the same accessible name Talk's transcript always used.
		const activityFeed = screen.getByRole("list", { name: "What has been said" });
		expect(activityFeed.textContent).toContain("You strike the rat.");

		// Aldwin's own action needs him selected first (axiom A1: the
		// SELECTION group is what the chosen thing offers) — his company
		// mention is already an `InfoLink` in the stream's newest place row.
		await fireEvent.click(
			(
				await screen.findAllByRole("button", {
					name: "Aldwin, keeper of the hearth-ledger details",
				})
			)[0] as HTMLElement,
		);
		const ask = await dock.findByRole("button", { name: /Ask Aldwin About Advancement/ });
		await fireEvent.click(ask);
		await waitFor(() => expect(act).toHaveBeenCalledTimes(2));
		expect(act.mock.calls[1]?.[0]).toMatchObject({ id: "h:ask" });
		// The later result adds a second row; it cannot overwrite the first
		// receipt as `localFeedback` used to do. One continuous journal
		// (sk-jay0.1.8, sk-jay0.1.8.60): the feed also carries sampleView's own
		// seeded speech line from Aldwin, the opening place-arrival divider,
		// and (sk-jay0.1.8.63.2) sampleView's own two non-speech world events
		// ("The eastern road opened.", "Mira promised to return before dusk."),
		// so two local outcomes plus that one heard line plus the divider plus
		// two events is six rows.
		expect(activityFeed.querySelectorAll("[data-activity-id]")).toHaveLength(6);
	});

	it("shows the current place as the Explore stream's own section-header row, not a separate fixed header (P3, sk-jay0.1.8.63.5)", async () => {
		signIn();
		renderPlay();
		const placeHeading = await screen.findByRole("heading", { level: 4, name: "Common Room" });
		// The stage level no longer renders a fixed `.table-context` header
		// above the stream — the current place's own divider row carries that
		// job now (`ActivityFeed`'s `isSectionHeader`).
		expect(document.querySelector(".table-explore-shell > .table-context")).toBeNull();
		const sectionRow = placeHeading.closest("[data-slot='activity-feed-header']");
		if (sectionRow === null)
			throw new Error("expected the place heading inside a section-header row");
		// The company sentence is now structured (sk-jay0.1.8.63.7): Aldwin's
		// own name renders as its own `InfoLink`, so the sentence is no longer
		// one text node — `visibleText` collapses incidental whitespace and
		// drops the link's own visually-hidden "details" suffix rather than
		// chasing an exact byte match.
		expect(visibleText(sectionRow)).toContain("Aldwin, keeper of the hearth-ledger is nearby");
	});

	it("opens Aldwin's own name in the Explore stream's place row as an information-only card, without forcing the Place tile open, and the SAME click selects him so his own verb reaches the dock (sk-jay0.1.8.63.7/.10, W5)", async () => {
		signIn();
		const helpAldwin = {
			id: "h:help-aldwin",
			label: "Help",
			verb: "manipulate",
			descriptor: "srd/help",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
		};
		const view = {
			...sampleView,
			// Aldwin's seeded speech line would ALSO turn his own speech-burst
			// heading into a second, separate name button (a valid but unrelated
			// case this test does not need) — dropped so only the company
			// mention's button exists to query unambiguously.
			speech: [],
			actions: [...sampleView.actions, helpAldwin],
			occupantDetail: {
				id: "4",
				handle: "s:actor:4",
				rev: "a4",
				entityId: "4",
				description: "The hearth-keeper, watchful and dry-humoured.",
				facts: [],
				verbs: [helpAldwin],
			},
		};
		const { act, selectOccupant } = renderPlay({ view });
		const nameButton = await screen.findByRole("button", {
			name: "Aldwin, keeper of the hearth-ledger details",
		});
		// Requirement 6: the stream's own selection never forces the Place
		// tile open or changes the mosaic layout — that side effect belongs
		// only to the Place roster's own `selectPlaceOccupant`.
		expect(document.querySelector('[data-tile="place"]')?.getAttribute("data-zoom")).not.toBe(
			"stage",
		);
		await fireEvent.click(nameButton);
		await waitFor(() =>
			expect(selectOccupant).toHaveBeenCalledWith(
				expect.objectContaining({ id: "4", handle: "s:actor:4" }),
			),
		);
		const card = await screen.findByRole("dialog", { name: "Aldwin, keeper of the hearth-ledger" });
		expect(document.querySelector('[data-tile="place"]')?.getAttribute("data-zoom")).not.toBe(
			"stage",
		);
		expect(within(card).getByText("The hearth-keeper, watchful and dry-humoured.")).toBeTruthy();
		// Cards show information only (sk-jay0.1.8.63.10 design contract) — no
		// verb lives inside one, not even a single offered action. The ⋯
		// action menu that used to sit next to a name is gone (axiom A1): the
		// SAME click that opened the card also SELECTED Aldwin, so his own
		// verb reaches the dock's SELECTION group instead.
		expect(within(card).queryByRole("button", { name: "Help" })).toBeNull();
		await fireEvent.click(await screen.findByRole("button", { name: /Help/ }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:help-aldwin" });
	});

	it("does not turn a departed speaker's own heading in the Explore stream into a button", async () => {
		signIn();
		const mira = {
			id: "40",
			handle: "s:actor:40",
			rev: "a40",
			kind: "person" as const,
			sceneKind: "actor",
			name: "Mira",
			conditions: [],
			note: "Here with you",
		};
		const miraLine = {
			id: "speech:mira",
			tick: 30,
			speakerId: "40",
			speaker: "Mira",
			text: "I'll wait by the door.",
			mine: false,
		};
		// Mira starts present (admitted into the journal by that presence, the
		// reload rule), then leaves; her already-admitted line stays in the
		// journal ("speech never disappears") but her heading loses its world
		// handle the moment she is no longer among `view.occupants`
		// (sk-jay0.1.8.63.7, "a speaker who is no longer present has no
		// handle") — no live `Speak To` offer targets her, so this scenario
		// stays in Explore rather than opening Talk.
		const { worldOpener } = renderPlay({
			view: { ...sampleView, occupants: [...sampleView.occupants, mira], speech: [miraLine] },
		});
		// While present, her heading is an `InfoLink` — accessible name
		// "Mira details" (the same disambiguating suffix every occupant
		// `InfoLink` carries, sk-jay0.1.8.63.10).
		await screen.findByRole("heading", { level: 3, name: "Mira details" });

		const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
		args.onView({ ...sampleView, speech: [miraLine] });

		const heading = await screen.findByRole("heading", { level: 3, name: "Mira" });
		expect(heading.querySelector("button")).toBeNull();
		expect(screen.queryByRole("button", { name: /Mira details/ })).toBeNull();
	});

	it("sends free words through the table's one say field, targeting the only offered speaker", async () => {
		signIn();
		const { act } = renderPlay();
		// One field for the whole tile (sk-jay0.1.7 item 3), not one per
		// speaker/room affordance; sampleView offers exactly one acceptsUtterance
		// action (Speak To Aldwin). It is not "here" (no live dialogue), so
		// the composer follows him only once he is SELECTED (axiom A4) — his
		// own name in the stream's company row does that. Anchored exactly:
		// the Chronicle card (sk-jay0.1.8.13) also renders a button whose own
		// text merely CONTAINS his name (the folded burst row), which a loose
		// substring match would collide with.
		// biome-ignore lint/style/noNonNullAssertion: queried fixture always contains Aldwin
		const aldwin = (
			await screen.findAllByRole("button", {
				name: /^Aldwin, keeper of the hearth-ledger( details)?$/,
			})
		)[0]!;
		await fireEvent.click(aldwin);
		const field = screen.getByLabelText(/^Say or do something/);
		await fireEvent.input(field, { target: { value: "name=Renn the Roadwarden" } });
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:talk" });
		expect(act.mock.calls[0]?.[1]).toBe("name=Renn the Roadwarden");
	});

	it("renders a successful say once, folding the world's own echo into the local line (one chronology, no duplicate 'Said here' list)", async () => {
		signIn();
		const { act, worldOpener } = renderPlay();
		act.mockResolvedValueOnce('You say: "hallo welt"');
		// Aldwin is not "here" (no live dialogue): select him so the composer
		// follows him (axiom A4).
		// biome-ignore lint/style/noNonNullAssertion: queried fixture always contains Aldwin
		const aldwin = (
			await screen.findAllByRole("button", {
				name: /^Aldwin, keeper of the hearth-ledger( details)?$/,
			})
		)[0]!;
		await fireEvent.click(aldwin);
		const field = screen.getByLabelText(/^Say or do something/);
		await fireEvent.input(field, { target: { value: "hallo welt" } });
		await fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		// The world's own reconciled view later carries the same words back as a
		// `mine` speech line (the live rig's actual shape) — it must not become
		// a second rendering of the same words.
		const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
		args.onView({
			...sampleView,
			speech: [
				...sampleView.speech,
				{
					id: "speech:99",
					tick: 43,
					speakerId: sampleView.hero.actorId,
					speaker: sampleView.hero.name,
					text: "hallo welt",
					mine: true,
				},
			],
		});
		await waitFor(() => {
			const tableTile = document.querySelector("[data-tile='table']");
			if (tableTile === null) throw new Error("expected the table tile");
			const leafMatches = Array.from(tableTile.querySelectorAll("*")).filter((element) => {
				if (!element.textContent?.includes("hallo welt")) return false;
				return !Array.from(element.children).some((child) =>
					child.textContent?.includes("hallo welt"),
				);
			});
			expect(leafMatches).toHaveLength(1);
			const outgoing = tableTile.querySelector('[data-speech-direction="outgoing"]');
			expect(outgoing?.textContent).toContain("You");
			expect(outgoing?.textContent).toContain("to Aldwin, keeper of the hearth-ledger");
		});
		expect(document.querySelector(".play-said")).toBeNull();
	});

	it("opens the fight frame on your turn with the roster and an end-turn control", async () => {
		signIn();
		const { endTurn, act } = renderPlay({ view: fightView });
		// Combat goes bare inside the Table tile (sk-jay0.1.8.5 finding 7): the
		// tile head carries the mode word, the roster carries who is fighting,
		// with no separate enemy-name title duplicating either.
		const order = await screen.findByRole("list", { name: "Turn order" });
		expect(screen.getByText(/Your turn/)).toBeTruthy();
		expect(within(order).getByText("You")).toBeTruthy();
		expect(within(order).getByText("Cellar Rat 1")).toBeTruthy();
		// Select-then-act now (sk-jay0.1.8.63.13): the turn bar's own verb row
		// is gone — selecting the rat's chip surfaces its offered actions in
		// the Table's selection row, and pressing one acts. The pill's own
		// accessible name stays the full, unambiguous "Melee Attack — Cellar
		// Rat 1" (its visible text is the short "Melee Attack").
		await fireEvent.click(within(order).getByRole("button", { name: /Cellar Rat 1/ }));
		await fireEvent.click(
			await screen.findByRole("button", { name: "1 Melee Attack — Cellar Rat 1" }),
		);
		await waitFor(() => expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:melee" }));
		// The dock's own "End turn" sits on the hotbar's first row (Dock
		// anatomy: "End turn sits on the right, shown only in a tactical
		// session") — `Combat`'s own tracker also keeps its pre-existing End
		// turn button (out of this bead's lane, left alone per its own
		// brief), so this scopes to the dock's to press exactly one.
		const dock = within(await screen.findByTestId("play-dock"));
		await fireEvent.click(dock.getByRole("button", { name: "End turn" }));
		// Round 4 (refusals into the stream): the transient "Your turn is
		// over." line no longer gets its own top-line status paragraph —
		// Combat's own status line already carries the fight's current state
		// from the refreshed view, and this end turn is not a refusal.
		await waitFor(() => expect(endTurn).toHaveBeenCalledOnce());
	});

	it("shows the actor's remaining action economy as the dock's resource pips, not in the turn bar (axioms A1, A6)", async () => {
		signIn();
		renderPlay({
			view: {
				...fightView,
				economyBudget: {
					unavailable: false,
					channels: [
						{
							channelId: "srd/economy_channel/primary",
							label: "Action",
							poolMs: 6000,
							remainingMs: 0,
							spentMs: 6000,
							status: "ok",
							offTurnEligible: false,
						},
						{
							channelId: "srd/economy_channel/bonus",
							label: "Bonus",
							poolMs: 6000,
							remainingMs: 6000,
							spentMs: 0,
							status: "ok",
							offTurnEligible: false,
						},
					],
				},
			},
		});
		await screen.findByRole("list", { name: "Turn order" });
		const pips = within(screen.getByTestId("play-dock")).getByRole("list", { name: "Resources" });
		expect(within(pips).getByRole("listitem", { name: "Action: spent" })).toBeTruthy();
		expect(within(pips).getByRole("listitem", { name: "Bonus: available" })).toBeTruthy();
		expect(screen.queryByRole("list", { name: "Action economy" })).toBeNull();
	});

	it("shows the fixture's dead rat struck through in the turn bar, not merely as a name (S5, sk-jay0.1.8.41)", async () => {
		signIn();
		renderPlay({ view: fightWithConditionsView });
		const order = await screen.findByRole("list", { name: "Turn order" });
		const deadChip = within(order).getByText("Cellar Rat 2").closest("li");
		expect(deadChip).not.toBeNull();
		expect(within(deadChip as HTMLElement).getByText("Cellar Rat 2").classList).toContain(
			"sk-play-roster-dead",
		);
		expect(within(deadChip as HTMLElement).getByText("Dead")).toBeTruthy();
		// The live rat next to it carries neither.
		const liveChip = within(order).getByText("Cellar Rat 1").closest("li");
		expect(within(liveChip as HTMLElement).queryByText("Dead")).toBeNull();
	});

	it("select-then-act turn bar (sk-jay0.1.8.63.13): every roster chip selects; actions surface in the Table's selection row, never doubled into the Actions palette or a verb row of the turn bar's own", async () => {
		signIn();
		const { act } = renderPlay({ view: threeRatsView });
		const table = await screen.findByRole("region", { name: "Table" });
		const order = within(table).getByRole("list", { name: "Turn order" });
		// Every roster member — hero included — now carries a stable
		// targetRef and is selectable: `selectionMode` drops the old "only a
		// chip `targets` currently offers a live verb group for" gate, since
		// picking someone (even the hero, even with nothing offered) is a
		// legitimate selection now, never only an attack-target shortlist.
		const rosterChips = within(order).getAllByRole("button");
		expect(rosterChips).toHaveLength(4);
		// The turn bar's own verb row and standalone target chip are gone —
		// acting happens through the selection row now — and the Actions
		// palette never mounts at card either (fightLayout keeps the table
		// at card for the whole fight).
		expect(within(table).queryByRole("button", { name: "No target" })).toBeNull();
		expect(within(table).queryByRole("list", { name: "No target actions" })).toBeNull();
		expect(within(table).queryByRole("list", { name: "Offered actions" })).toBeNull();

		// Selecting a rat's chip surfaces its own offered actions as
		// numbered pills in the dock's SELECTION group — every fight action
		// stays reachable, one target at a time.
		const targetLabels = ["Cellar Rat 1", "Cellar Rat 2", "Cellar Rat 3"];
		const reachableIds = new Set<string>();
		for (const label of targetLabels) {
			const chip = within(order).getByRole("button", { name: new RegExp(label) });
			await fireEvent.click(chip);
			const row = await screen.findByRole("group", { name: label });
			for (const pill of within(row).getAllByRole("button")) {
				const match = /^\d+ (.+)$/.exec(pill.getAttribute("aria-label") ?? "");
				// biome-ignore lint/style/noNonNullAssertion: regex has a required capture group
				if (match) reachableIds.add(match[1]!);
			}
		}
		// Selecting the hero's own chip surfaces the untargeted group
		// (Dodge) as "You" — the fold this bead's design calls for, never a
		// bare "No target" chip on the tracker any more.
		await fireEvent.click(within(order).getByRole("button", { name: /Renn the Roadwarden/ }));
		const selfRow = await screen.findByRole("group", { name: "You" });
		for (const pill of within(selfRow).getAllByRole("button")) {
			const match = /^\d+ (.+)$/.exec(pill.getAttribute("aria-label") ?? "");
			// biome-ignore lint/style/noNonNullAssertion: regex has a required capture group
			if (match) reachableIds.add(match[1]!);
		}
		// The pill's ACCESSIBLE name stays the world's own full, unambiguous
		// label (two rats' "Melee Attack" pills would otherwise collide) —
		// exactly `threeRatsView.actions`' own `label` field, unchanged.
		expect(reachableIds).toEqual(new Set(threeRatsView.actions.map((action) => action.label)));

		await fireEvent.click(within(selfRow).getByRole("button", { name: "1 Dodge" }));
		await waitFor(() => expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:dodge" }));
		expect(act.mock.calls[0]?.[1]).toBeUndefined();
	});

	describe("the selection row's keyboard (sk-jay0.1.8.63.13 review)", () => {
		function battleMapCell(nodeId: string): HTMLElement {
			const mapTile = document.querySelector('[data-tile="map"]') as HTMLElement;
			const cell = within(mapTile)
				.getByRole("group", { name: "Battle map" })
				.querySelector(`[data-node-id="${nodeId}"]`);
			if (cell === null) throw new Error(`expected a battle map cell for ${nodeId}`);
			return cell as HTMLElement;
		}

		it("digit n presses pill n", async () => {
			signIn();
			const { act } = renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			await fireEvent.click(battleMapCell("session_grid_58/c_0_0"));
			await screen.findByRole("button", { name: "1 Melee Attack — Cellar Rat 1" });
			fireEvent.keyDown(document.body, { key: "2" });
			await waitFor(() => expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:unarmed-strike" }));
		});

		it("a digit typed into the dock composer does not act", async () => {
			signIn();
			const { act } = renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			await fireEvent.click(battleMapCell("session_grid_58/c_0_0"));
			await screen.findByRole("button", { name: "1 Melee Attack — Cellar Rat 1" });
			const composer = screen.getByLabelText(/^Say or do something/);
			fireEvent.keyDown(composer, { key: "1" });
			expect(act).not.toHaveBeenCalled();
		});

		it("Esc clears the selection when a row is shown", async () => {
			signIn();
			renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			await fireEvent.click(battleMapCell("session_grid_58/c_0_0"));
			await screen.findByRole("group", { name: "Cellar Rat 1" });
			fireEvent.keyDown(document.body, { key: "Escape" });
			await waitFor(() => expect(screen.queryByRole("group", { name: "Cellar Rat 1" })).toBeNull());
		});

		it("select.next ('.') walks the turn order from nothing; select.prev (',') walks it back (axiom A8)", async () => {
			signIn();
			renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			expect(screen.queryByRole("group", { name: "Cellar Rat 1" })).toBeNull();
			fireEvent.keyDown(document.body, { key: "." });
			await screen.findByRole("group", { name: "Cellar Rat 1" });
			// One other actor in this fight: the ring wraps onto the same one.
			fireEvent.keyDown(document.body, { key: "," });
			expect(screen.getByRole("group", { name: "Cellar Rat 1" })).toBeTruthy();
		});

		it("never walks the selection from inside the dock composer", async () => {
			signIn();
			renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			fireEvent.keyDown(screen.getByLabelText(/^Say or do something/), { key: "." });
			expect(screen.queryByRole("group", { name: "Cellar Rat 1" })).toBeNull();
		});

		it("a stored keymap override rebinds a command and frees its old key", async () => {
			// This environment has no working `localStorage`; the page only ever
			// calls `getItem` on it (`loadKeymap`).
			vi.stubGlobal("localStorage", {
				getItem: (key: string) =>
					key === "spellkave.play.keymap" ? JSON.stringify({ "select.next": ["n"] }) : null,
			});
			try {
				signIn();
				renderPlay({ view: fightView });
				await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
				fireEvent.keyDown(document.body, { key: "." });
				expect(screen.queryByRole("group", { name: "Cellar Rat 1" })).toBeNull();
				fireEvent.keyDown(document.body, { key: "n" });
				await screen.findByRole("group", { name: "Cellar Rat 1" });
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("Esc closes an open menu first, never stealing it to clear the selection underneath", async () => {
			signIn();
			renderPlay({
				view: {
					...fightView,
					actions: [
						...fightView.actions,
						{
							id: "h:athletics",
							label: "Check: Athletics — Cellar Rat 1",
							verb: "manipulate",
							descriptor: "srd/check/athletics",
							targetName: "Cellar Rat 1",
							targetRef: "entity:123",
							acceptsUtterance: false,
						},
					],
				},
			});
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			await fireEvent.click(battleMapCell("session_grid_58/c_0_0"));
			const row = await screen.findByRole("group", { name: "Cellar Rat 1" });
			await fireEvent.keyDown(within(row).getByRole("button", { name: "More for Cellar Rat 1" }), {
				key: "Enter",
			});
			await screen.findByRole("menu");
			fireEvent.keyDown(document.body, { key: "Escape" });
			// The selection itself must still be standing — only the menu closed.
			await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
			expect(screen.getByRole("group", { name: "Cellar Rat 1" })).toBeTruthy();
		});

		it("clicking the already-selected cell clears it", async () => {
			signIn();
			renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			const cell = battleMapCell("session_grid_58/c_0_0");
			await fireEvent.click(cell);
			await screen.findByRole("group", { name: "Cellar Rat 1" });
			await fireEvent.click(cell);
			await waitFor(() => expect(screen.queryByRole("group", { name: "Cellar Rat 1" })).toBeNull());
		});
	});

	describe("the selection row's two-way sync with the turn order (sk-jay0.1.8.63.13 review)", () => {
		it("selecting a cell with exactly one occupant highlights that occupant's turn-order chip", async () => {
			signIn();
			renderPlay({ view: fightView });
			const order = await screen.findByRole("list", { name: "Turn order" });
			const mapTile = document.querySelector('[data-tile="map"]') as HTMLElement;
			const cell = within(mapTile)
				.getByRole("group", { name: "Battle map" })
				.querySelector('[data-node-id="session_grid_58/c_0_0"]') as HTMLElement;
			await fireEvent.click(cell);
			const chip = within(order).getByRole("button", { name: /Cellar Rat 1/ });
			await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));
		});
	});

	describe("self-scoped actions in a fight surface the same union as outside one (sk-jay0.1.8.63.13 review)", () => {
		it("selecting your own cell in a fight offers the own-cell and world-scoped groups, not just the untargeted one", async () => {
			signIn();
			const { act } = renderPlay({
				view: {
					...fightView,
					actions: [
						...fightView.actions,
						{
							id: "h:search",
							label: "Search the cellar",
							verb: "sensing",
							descriptor: "srd/generic",
							targetName: "Cell 1,0",
							targetRef: `place_node:${fightView.place?.id}`,
							acceptsUtterance: false,
						},
						{
							id: "h:listen",
							label: "Check: Perception",
							verb: "sensing",
							descriptor: "srd/check/perception",
							targetName: "world",
							targetRef: "world",
							acceptsUtterance: false,
						},
					],
				},
			});
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			const mapTile = document.querySelector('[data-tile="map"]') as HTMLElement;
			const ownCell = within(mapTile)
				.getByRole("group", { name: "Battle map" })
				.querySelector(`[data-node-id="${fightView.place?.id}"]`) as HTMLElement;
			await fireEvent.click(ownCell);
			const row = await screen.findByRole("group", { name: "You" });
			// The untargeted group (Dodge) and the own-cell group ("Search the
			// cellar") both lead as primary pills; the world-scoped check
			// (`targetRef: "world"`, never a lower-cased label match) folds
			// into the usual "Checks" submenu, same as any other generic check.
			expect(within(row).getByRole("button", { name: /Dodge/ })).toBeTruthy();
			expect(within(row).getByRole("button", { name: /Search the cellar/ })).toBeTruthy();
			expect(screen.queryByText("Nothing is offered from here.")).toBeNull();
			await fireEvent.keyDown(within(row).getByRole("button", { name: "More for You" }), {
				key: "Enter",
			});
			await fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Checks" }), {
				key: "Enter",
			});
			expect(await screen.findByRole("menuitem", { name: "Check: Perception" })).toBeTruthy();

			await fireEvent.click(within(row).getByRole("button", { name: "1 Dodge" }));
			await waitFor(() => expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:dodge" }));
		});
	});

	it("shows a dead occupant as such instead of a name alone", async () => {
		signIn();
		renderPlay({ view: fightView });
		const zoom = await screen.findByRole("button", { name: "Open Place" });
		await fireEvent.click(zoom);
		const here = await screen.findByRole("list", { name: "Characters" });
		expect(within(here).getByText("Dead")).toBeTruthy();
		expect(screen.queryByText("creature")).toBeNull();
	});

	it("selecting and cancelling a non-addressable occupant never dispatches gameplay", async () => {
		signIn();
		const { act, move, selectOccupant } = renderPlay({
			view: {
				...sampleView,
				actions: sampleView.actions.filter((action) => !action.acceptsUtterance),
			},
		});
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		// Remove the current speech offer: an occupant who is merely present
		// stays in Place and can still be selected/deselected for inspection.
		await fireEvent.click(
			within(document.querySelector(".place-lists") as HTMLElement).getByRole("button", {
				name: /Aldwin/,
			}),
		);
		await waitFor(() =>
			expect(selectOccupant).toHaveBeenCalledWith(expect.objectContaining({ id: "4" })),
		);
		await fireEvent.click(
			within(document.querySelector(".place-lists") as HTMLElement).getByRole("button", {
				name: /Aldwin/,
			}),
		);
		await waitFor(() => expect(selectOccupant).toHaveBeenCalledWith(null));
		expect(act).not.toHaveBeenCalled();
		expect(move).not.toHaveBeenCalled();
	});

	it("keeps listing combat classification off Place when targeted verbs omit groups", async () => {
		signIn();
		const view = {
			...sampleView,
			actions: [
				...sampleView.actions,
				{
					id: "h:opp",
					label: "Opportunity attack",
					verb: "manipulate",
					descriptor: "srd/attack/opportunity-attack",
					targetName: "Aldwin, keeper of the hearth-ledger",
					targetRef: "entity:4",
					acceptsUtterance: false,
					group: "combat",
					groups: ["combat"],
				},
				{
					id: "h:unarmed",
					label: "Unarmed strike: damage",
					verb: "manipulate",
					descriptor: "srd/attack/unarmed-strike/damage",
					targetName: "Aldwin, keeper of the hearth-ledger",
					targetRef: "entity:4",
					acceptsUtterance: false,
					group: "combat",
					groups: ["combat"],
				},
				{
					id: "h:help-aldwin",
					label: "Help — Aldwin, keeper of the hearth-ledger",
					verb: "manipulate",
					descriptor: "srd/help",
					targetName: "Aldwin, keeper of the hearth-ledger",
					targetRef: "entity:4",
					acceptsUtterance: false,
				},
			],
			occupantDetail: {
				id: "4",
				handle: "s:actor:4",
				rev: "a4",
				entityId: "4",
				facts: [],
				verbs: [
					{
						id: "h:opp",
						label: "Opportunity attack",
						verb: "manipulate",
						descriptor: "srd/attack/opportunity-attack",
						targetName: "Aldwin, keeper of the hearth-ledger",
						targetRef: "entity:4",
						acceptsUtterance: false,
					},
					{
						id: "h:unarmed",
						label: "Unarmed strike: damage",
						verb: "manipulate",
						descriptor: "srd/attack/unarmed-strike/damage",
						targetName: "Aldwin, keeper of the hearth-ledger",
						targetRef: "entity:4",
						acceptsUtterance: false,
					},
					{
						id: "h:help-aldwin",
						label: "Help — Aldwin, keeper of the hearth-ledger",
						verb: "manipulate",
						descriptor: "srd/help",
						targetName: "Aldwin, keeper of the hearth-ledger",
						targetRef: "entity:4",
						acceptsUtterance: false,
					},
				],
			},
		};
		const { act } = renderPlay({ view });
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
		await fireEvent.click(
			within(document.querySelector(".place-lists") as HTMLElement).getByRole("button", {
				name: /Aldwin/,
			}),
		);
		expect(place.queryByRole("button", { name: /Opportunity attack/i })).toBeNull();
		expect(place.queryByRole("button", { name: /Unarmed strike/i })).toBeNull();
		// Selecting an addressable NPC (he offers a words-taking act) also
		// SELECTS him globally (axiom A4) — his non-combat affordance reaches
		// the dock's own SELECTION group rather than disappearing with the
		// folded Place tile.
		const dock = within(await screen.findByTestId("play-dock"));
		expect(await dock.findByRole("button", { name: /Help/ })).toBeTruthy();
		expect(act).not.toHaveBeenCalled();
	});

	it("lists combat and speech verbs in Place details, keeps answers with the prompt, and only inserts", async () => {
		signIn();
		const base = {
			verb: "manipulate",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
		};
		const view = {
			...sampleView,
			interactionOrigin: undefined,
			occupantDetail: {
				id: "4",
				handle: "s:actor:4",
				rev: "a4",
				entityId: "4",
				facts: [],
				verbs: [
					{
						...base,
						id: "h:melee",
						name: "Melee Attack",
						label: "Melee Attack — Aldwin, keeper of the hearth-ledger",
						descriptor: "srd/attack/melee",
						group: "combat",
						groups: ["combat"],
					},
					{
						...base,
						id: "h:speak",
						name: "Speak To",
						label: "Speak To — Aldwin, keeper of the hearth-ledger",
						verb: "communicate",
						descriptor: "srd/speak",
						acceptsUtterance: true,
					},
					{
						...base,
						id: "h:answer",
						label: "Answer 3",
						verb: "communicate",
						descriptor: "dm/dialog/choice/3",
						slot: 3,
					},
				],
			},
		};
		const { act } = renderPlay({ view });
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
		await fireEvent.click(
			within(document.querySelector(".place-lists") as HTMLElement).getByRole("button", {
				name: /Aldwin/,
			}),
		);
		const melee = await place.findByRole("button", { name: "Melee Attack" });
		expect(place.getAllByRole("button", { name: "Speak To" }).length).toBeGreaterThan(0);
		expect(place.queryByRole("button", { name: /Answer 3/ })).toBeNull();
		await fireEvent.click(melee);
		expect(act).not.toHaveBeenCalled();
	});

	it("routes Talk by target identity when two occupants share a name", async () => {
		signIn();
		const aldwin = sampleView.occupants[0];
		const hearth = sampleView.occupants[2];
		if (aldwin === undefined || hearth === undefined) throw new Error("sample occupants");
		const view = {
			...sampleView,
			occupants: [
				{ ...aldwin, id: "4", handle: "s:actor:4", name: "Twin" },
				{ ...aldwin, id: "44", handle: "s:actor:44", rev: "a44", name: "Twin" },
				hearth,
			],
			actions: [
				{
					id: "h:talk-4",
					label: "Speak To — Twin",
					verb: "communicate",
					descriptor: "srd/speak-to",
					targetName: "Twin",
					targetRef: "entity:4",
					acceptsUtterance: true,
				},
				{
					id: "h:talk-44",
					label: "Speak To — Twin",
					verb: "communicate",
					descriptor: "srd/speak-to",
					targetName: "Twin",
					targetRef: "entity:44",
					acceptsUtterance: true,
				},
			],
		};
		const { act, selectOccupant } = renderPlay({ view });
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
		const twins = place.getAllByRole("button", { name: /Twin/ });
		const secondTwin = twins[1];
		if (secondTwin === undefined) throw new Error("expected two Twin buttons");
		await fireEvent.click(secondTwin);
		await waitFor(() =>
			expect(selectOccupant).toHaveBeenCalledWith(expect.objectContaining({ id: "44" })),
		);
		// Selecting never resizes a tile (axiom A2): Place stays the focused
		// tile, and the dock's composer is where the words go.
		expect(document.querySelector('[data-tile="place"]')?.getAttribute("data-zoom")).toBe("stage");
		expect(act).not.toHaveBeenCalled();
		const input = screen.getByLabelText(/^Say or do something/) as HTMLInputElement;
		await fireEvent.input(input, { target: { value: "Twin, are you there?" } });
		await fireEvent.submit(input.closest("form") as HTMLFormElement);
		await waitFor(() => expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:talk-44" }));
	});

	it("groups consecutive speech only by speaker identity and resets across other entries", async () => {
		signIn();
		renderPlay({ view: streamDetailView });
		await screen.findByText("First short line.");
		const line = (text: string) =>
			screen.getByText(text).closest('[data-slot="explore-speech-line"]')!;
		expect(line("First short line.").querySelector("h3")).toBeTruthy();
		expect(line("Same speaker continues.").querySelector("h3")).toBeNull();
		expect(line("Same name, different person.").querySelector("h3")).toBeTruthy();
		expect(line("A short answer.").querySelector('[data-direction="outgoing"]')).toBeTruthy();
		expect(line("After another event.").querySelector("h3")).toBeTruthy();
	});

	it.each([
		"happened",
		"quiet",
		"rejected",
		"unobserved",
		"error",
	] as const)("clears a move draft only after admission (%s)", async (outcome) => {
		signIn();
		const { move, worldOpener } = renderPlay({ view: placeDetailView });
		move.mockImplementation(async () => {
			playTrail.recordAct({ tool: "spellkave_move", outcome, durationMs: 1, tick: 0 });
			if (outcome === "happened") {
				worldOpener.mock.calls[0]?.[0].onView({
					...placeDetailView,
					place: {
						...placeDetailView.place,
						id: "arrived",
						name: "Arrival",
						description: "Arrived.",
						exits: [],
					},
				});
			}
			return "Move result.";
		});
		const input = await screen.findByRole<HTMLInputElement>("combobox");
		// A way out is spelled by its destination (sk-jay0.1.8.95): north leads to the Bar.
		await fireEvent.input(input, { target: { value: "/go-bar" } });
		await fireEvent.keyDown(input, { key: "Tab" });
		if (screen.queryByTestId("shell-finder")) await fireEvent.keyDown(input, { key: "Enter" });
		const before = input.value;
		await fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(move).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(input.value).toBe(outcome === "happened" || outcome === "quiet" ? "" : before),
		);
	});

	it("browses Place without changing a draft, then inserts an exact verb for explicit Enter", async () => {
		signIn();
		const { act, move } = renderPlay({ view: placeDetailView });
		const input = await screen.findByRole<HTMLInputElement>("combobox");
		await fireEvent.click(
			(
				await screen.findAllByRole("button", {
					name: "Aldwin, keeper of the hearth-ledger details",
				})
			)[0]!,
		);
		expect(input.value).toBe('@"Aldwin, keeper of the hearth-ledger"');
		await fireEvent.input(input, { target: { value: "unfinished words" } });
		await fireEvent.click(screen.getByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
		const person = place.getByRole("button", { name: placeDetailView.occupants[0]!.name });
		await fireEvent.click(person);
		expect(input.value).toBe("unfinished words");
		await fireEvent.click(person);
		await fireEvent.click(place.getByRole("button", { name: "Inspect" }));
		expect(input.value).toBe("unfinished words");
		// Insert never destroys typed words (owner ruling 2026-11-12): the box
		// keeps them, takes focus and says why.
		await fireEvent.click(place.getByRole("button", { name: "Insert" }));
		expect(input.value).toBe("unfinished words");
		expect(document.activeElement).toBe(input);
		expect(screen.getByTestId("play-dock").textContent).toContain(
			"You have unsent words in the box.",
		);
		expect(act).not.toHaveBeenCalled();
		await fireEvent.input(input, { target: { value: "" } });
		await fireEvent.click(place.getByRole("button", { name: "Insert" }));
		expect(input.value).toBe('/inspect @"Aldwin, keeper of the hearth-ledger"');
		expect(document.activeElement).toBe(input);
		expect(act).not.toHaveBeenCalled();
		await fireEvent.click(person);
		expect(place.getByRole("region", { name: "Place details" })).toBeTruthy();
		expect(input.value).toBe('/inspect @"Aldwin, keeper of the hearth-ledger"');
		await fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({
			actionId: "fixture/inspect",
			targetRef: "entity:4",
		});
		expect(move).not.toHaveBeenCalled();
	});

	describe("a click on a way out fills the text box; only Enter moves (sk-jay0.1.8.99)", () => {
		// The live (factored) fixture: `interactionOrigin` is undefined, so the
		// composer is the act path. Its first exit is Stairs, southeast.
		// biome-ignore lint/style/noNonNullAssertion: the fixture supplies a place
		const livePlace = placeDetailView.place!;
		const stairs = livePlace.exits[0];
		if (stairs === undefined) throw new Error("fixture supplies its first exit");
		const withStairsNode: PlayView = {
			...placeDetailView,
			mapSvg:
				`<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">` +
				`<g data-node-id="${livePlace.id}"><circle class="place" cx="20" cy="20" r="5" /></g>` +
				`<g data-node-id="inn/stairs-node"><circle class="place" cx="60" cy="20" r="5" /></g></svg>`,
			place: {
				...livePlace,
				exits: [{ ...stairs, toNodeId: "inn/stairs-node" }, ...livePlace.exits.slice(1)],
			},
		};
		async function chooseWayOut(name: string): Promise<void> {
			const dock = within(await screen.findByTestId("play-dock"));
			await fireEvent.keyDown(dock.getByRole("button", { name: /\d+ ways? out/ }), {
				key: "Enter",
			});
			const item = within(await screen.findByRole("menu"))
				.getByText(name)
				.closest('[role="menuitem"]');
			if (item === null) throw new Error(`expected the ${name} menu item`);
			await fireEvent.click(item);
		}
		const dockText = () => screen.getByTestId("play-dock").textContent ?? "";

		it("the ways-out menu writes the go sentence, focuses the box, and Enter moves once", async () => {
			signIn();
			const { move } = renderPlay({ view: withStairsNode });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await chooseWayOut("Stairs");
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			await waitFor(() => expect(document.activeElement).toBe(input));
			expect(dockText()).toContain("Go to Stairs. Press Enter to set off.");
			expect(move).not.toHaveBeenCalled();
			// No hotbar Travel slot in a live session: the composer is the act path.
			expect(screen.queryByRole("button", { name: /Travel to Stairs/ })).toBeNull();
			await fireEvent.keyDown(input, { key: "Enter" });
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
			expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: stairs.handle });
		});

		it("a second way out swaps the go sentence instead of adding to it", async () => {
			signIn();
			const { move } = renderPlay({ view: withStairsNode });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await chooseWayOut("Stairs");
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			await chooseWayOut("Bar");
			await waitFor(() => expect(input.value).toBe("/go-bar"));
			expect(move).not.toHaveBeenCalled();
		});

		it("an exit without a destination node fills the box too and no longer moves on click", async () => {
			signIn();
			const { move } = renderPlay({ view: placeDetailView });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await chooseWayOut("Stairs");
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			expect(move).not.toHaveBeenCalled();
			await fireEvent.keyDown(input, { key: "Enter" });
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
			expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: stairs.handle });
		});

		it("keeps typed words when a way out is clicked, and says why", async () => {
			signIn();
			const { move } = renderPlay({ view: withStairsNode });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await fireEvent.input(input, { target: { value: "unfinished words" } });
			await chooseWayOut("Stairs");
			await waitFor(() =>
				expect(dockText()).toContain(
					"You have unsent words in the box. Send or clear them, then choose Stairs again.",
				),
			);
			expect(input.value).toBe("unfinished words");
			await fireEvent.keyDown(input, { key: "Enter" });
			expect(move).not.toHaveBeenCalled();
			// Enter answers the note: the reason nothing was sent is no longer hidden.
			await waitFor(() => expect(dockText()).toContain("What do you do?"));
			expect(dockText()).not.toContain("You have unsent words in the box.");
		});

		it("a way-out name on the Place card fills the box like the ways-out menu, and keeps typed words", async () => {
			signIn();
			const { move } = renderPlay({ view: withStairsNode });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			const placeTile = document.querySelector<HTMLElement>('[data-tile="place"]');
			if (placeTile === null) throw new Error("expected the Place tile");
			expect(placeTile.dataset.zoom).toBe("card");
			const ways = within(within(placeTile).getByRole("list", { name: "Ways out" }));
			await fireEvent.click(ways.getByRole("button", { name: "Stairs (southeast)" }));
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			await waitFor(() => expect(document.activeElement).toBe(input));
			expect(dockText()).toContain("Go to Stairs. Press Enter to set off.");
			expect(move).not.toHaveBeenCalled();
			// The draft-keeping rule of the menu holds for the card too.
			await fireEvent.input(input, { target: { value: "unfinished words" } });
			await fireEvent.click(ways.getByRole("button", { name: "Bar (north)" }));
			await waitFor(() => expect(dockText()).toContain("then choose Bar again."));
			expect(input.value).toBe("unfinished words");
			expect(move).not.toHaveBeenCalled();
		});

		it("a Place way-out row asks again after its insertion was refused", async () => {
			signIn();
			const { move } = renderPlay({ view: withStairsNode });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
			const row = await screen.findByRole("button", { name: /^Stairs \(southeast\)/ });
			await fireEvent.input(input, { target: { value: "unfinished words" } });
			await fireEvent.click(row);
			await waitFor(() => expect(dockText()).toContain("then choose Stairs again."));
			expect(input.value).toBe("unfinished words");
			expect(row.getAttribute("aria-pressed")).toBe("true");
			// The row is already marked. Doing what the help line says must work.
			await fireEvent.input(input, { target: { value: "" } });
			await fireEvent.click(row);
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			expect(row.getAttribute("aria-pressed")).toBe("true");
			// With the sentence in the box, the next click unmarks as before.
			await fireEvent.click(row);
			await waitFor(() => expect(row.getAttribute("aria-pressed")).toBe("false"));
			expect(input.value).toBe("/go-stairs");
			expect(move).not.toHaveBeenCalled();
		});

		it.each([
			"click",
			"Enter",
			" ",
		])("the card map's travel node fills the box on %s and never moves", async (gesture) => {
			signIn();
			const { move } = renderPlay({ view: withStairsNode });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			const node = await waitFor(() => {
				const found = document.querySelector(
					'[data-tile="map"] [data-node-id="inn/stairs-node"][role="button"]',
				);
				expect(found).toBeTruthy();
				return found as HTMLElement;
			});
			if (gesture === "click") await fireEvent.click(node);
			else await fireEvent.keyDown(node, { key: gesture });
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			await waitFor(() => expect(document.activeElement).toBe(input));
			expect(move).not.toHaveBeenCalled();
			await fireEvent.keyDown(input, { key: "Enter" });
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
		});

		it("a Place way-out row fills the box when the click marks it, not when it unmarks", async () => {
			signIn();
			const { move } = renderPlay({ view: withStairsNode });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
			const row = await screen.findByRole("button", { name: /^Stairs \(southeast\)/ });
			await fireEvent.click(row);
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			await waitFor(() => expect(document.activeElement).toBe(input));
			await fireEvent.input(input, { target: { value: "" } });
			await fireEvent.click(row);
			await tick();
			expect(input.value).toBe("");
			expect(move).not.toHaveBeenCalled();
		});
	});

	describe("speech goes out only inside quotes (sk-jay0.1.8.98)", () => {
		const aldwin = placeDetailView.occupants[0];
		if (aldwin === undefined) throw new Error("fixture supplies its first occupant");
		const context = placeDetailView.manipulationContext;
		if (context?.status !== "ready") throw new Error("fixture supplies ready facts");
		const speakVerb = {
			id: "fixture:speak:4",
			actionId: "fixture/speak-to",
			label: "Speak to",
			verb: "communicate",
			descriptor: "fixture/speak-to",
			targetRef: "entity:4",
			targetName: aldwin.name,
			acceptsUtterance: true,
		};
		const speechView: PlayView = {
			...placeDetailView,
			actions: [speakVerb],
			manipulationContext: {
				...context,
				actions: [
					{
						actionId: "fixture/speak-to",
						displayName: "Speak to",
						communicationSpeechActId: "fixture/speak-to",
						tags: [],
						selfOnly: false,
						selfEligible: false,
					},
				],
			},
			// biome-ignore lint/style/noNonNullAssertion: the fixture supplies the detail
			occupantDetail: { ...placeDetailView.occupantDetail!, verbs: [speakVerb] },
		};
		const sentence = `/speak-to @"${aldwin.name}"`;

		async function insertSpeak(): Promise<HTMLInputElement> {
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await fireEvent.click(screen.getByRole("button", { name: "Open Place" }));
			const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
			await fireEvent.click(place.getByRole("button", { name: aldwin?.name }));
			await fireEvent.input(input, { target: { value: "" } });
			await fireEvent.click(await place.findByRole("button", { name: "Speak to" }));
			await fireEvent.click(place.getByRole("button", { name: "Insert" }));
			await waitFor(() => expect(input.value).toBe(`${sentence} ""`));
			return input;
		}

		it("Insert on a speak verb leaves the caret between the offered quotes", async () => {
			signIn();
			const { act } = renderPlay({ view: speechView });
			const input = await insertSpeak();
			await waitFor(() => expect(document.activeElement).toBe(input));
			await waitFor(() => expect(input.selectionStart).toBe(input.value.length - 1));
			expect(input.selectionEnd).toBe(input.value.length - 1);
			expect(act).not.toHaveBeenCalled();
		});

		it("sends nothing for words outside quotes and keeps them", async () => {
			signIn();
			const { act } = renderPlay({ view: speechView });
			const input = await insertSpeak();
			const loose = `${sentence} Good morning, brother.`;
			await fireEvent.input(input, { target: { value: loose } });
			await fireEvent.keyDown(input, { key: "Enter" });
			await tick();
			expect(act).not.toHaveBeenCalled();
			expect(input.value).toBe(loose);
			expect(screen.getByTestId("play-dock").textContent).toContain(
				'Put what you say in quotes: "Good morning, brother."',
			);
		});

		it("sends quoted words once as the utterance of the speech act", async () => {
			signIn();
			const { act } = renderPlay({ view: speechView });
			const input = await insertSpeak();
			await fireEvent.input(input, {
				target: { value: `${sentence} "Good morning, brother."` },
			});
			await fireEvent.keyDown(input, { key: "Enter" });
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			expect(act.mock.calls[0]?.[0]).toMatchObject({
				verb: "communicate",
				descriptor: "fixture/speak-to",
				targetRef: "entity:4",
			});
			expect(act.mock.calls[0]?.[1]).toBe("Good morning, brother.");
		});
	});

	it("a Place occupant's detail-only offer acts from the dock after selection", async () => {
		signIn();
		const inspect = {
			id: "h:detail-only",
			label: "Inspect",
			verb: "sensing",
			descriptor: "inspect",
			targetName: "Aldwin",
			targetRef: "item:4",
			acceptsUtterance: false,
		};
		const { act } = renderPlay({
			view: {
				...sampleView,
				actions: [],
				occupantDetail: {
					id: "4",
					handle: "s:actor:4",
					rev: "a4",
					entityId: "4",
					facts: [],
					verbs: [inspect],
				},
			},
		});
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
		const person = within(document.querySelector(".place-lists") as HTMLElement).getByRole(
			"button",
			{ name: /Aldwin/ },
		);
		await fireEvent.click(person);
		expect(act).not.toHaveBeenCalled();
		expect(place.queryByRole("button", { name: "Inspect" })).toBeNull();
		expect(
			within(screen.getByTestId("play-dock")).getByRole("button", { name: /Inspect/ }),
		).toBeTruthy();
		await fireEvent.keyDown(person, { key: "1" });
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({ id: inspect.id, targetRef: "item:4" });
	});

	it("executes a contextual Place action from the dock and retains its receipt in the stream", async () => {
		signIn();
		const observations: PlayObservation[] = [];
		playObservation.subscribe((event) => observations.push(event));
		const { act } = renderPlay();
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
		expect(place.queryByRole("button", { name: "Look around" })).toBeNull();
		await fireEvent.click(
			within(screen.getByTestId("play-dock")).getByRole("button", { name: /Look around/ }),
		);
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		await fireEvent.click(screen.getByRole("button", { name: "Open Table" }));
		await waitFor(() =>
			expect(document.querySelector('[data-tile="table"]')?.textContent).toContain(
				"You strike the rat.",
			),
		);
		expect(observations).toContainEqual(
			expect.objectContaining({ phase: "intent", intent: "act", action_surface: "table" }),
		);
	});

	async function verifyMapOfferedExit() {
		signIn();
		const observations: PlayObservation[] = [];
		playObservation.subscribe((event) => observations.push(event));
		const currentPlace = sampleView.place;
		if (currentPlace === undefined || currentPlace === null) throw new Error("sample place");
		const view = {
			...sampleView,
			place: {
				...currentPlace,
				exits: [
					{
						handle: "s:exit:test",
						rev: "exit-rev",
						label: "north",
						to: "destination",
						toNodeId: "test/destination",
						toName: "Airlock",
						gates: [],
					},
				],
			},
		};
		const { move } = renderPlay({ view });
		await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
		// Clicking the offered place on the MapLibre canvas only selects it
		// now (sk-jay0.1.8.63.13) — the in-map "Go to" control is gone; the
		// Table's own selection row carries "Travel to <place>" instead, and
		// dispatches through the same `move()` (surface "table", since the
		// row lives on the Table, not the map tile).
		await fireEvent.click(await screen.findByRole("button", { name: "Select test map place" }));
		expect(move).not.toHaveBeenCalled();
		// The map fills the whole stage (one tile at a time, unchanged
		// mosaic behaviour) and folds the Table to a strip — the row still
		// shows: `PlayDock`'s own out-of-flow `selection` slot renders it
		// whenever the Table tile itself has none to show it in.
		await fireEvent.click(await screen.findByRole("button", { name: "1 Travel to Airlock" }));
		await waitFor(() => expect(move).toHaveBeenCalledWith(view.place.exits[0], expect.any(Number)));
		expect(move).toHaveBeenCalledOnce();
		expect(observations).toContainEqual(
			expect.objectContaining({ phase: "intent", intent: "move", action_surface: "table" }),
		);
	}

	it("keeps conversation mounted alongside a fight and records its presentation", async () => {
		signIn();
		const observations: PlayObservation[] = [];
		playObservation.subscribe((event) => observations.push(event));
		const { worldOpener } = renderPlay({
			view: {
				...fightView,
				speech: talkView.speech,
				actions: [...fightView.actions, ...talkView.actions],
			},
		});
		await screen.findByRole("list", { name: "Turn order" });
		expect(await screen.findByRole("list", { name: "What has been said" })).toBeTruthy();
		await waitFor(() =>
			expect(observations).toContainEqual(
				expect.objectContaining({
					phase: "presentation",
					conversation_mounted: true,
					conversation_lines: expect.any(Number),
				}),
			),
		);
		await fireEvent.click(screen.getByRole("button", { name: "Open Pack" }));
		await waitFor(() =>
			expect(observations).toContainEqual(
				expect.objectContaining({
					phase: "presentation",
					conversation_mounted: false,
					conversation_lines: 0,
				}),
			),
		);
		worldOpener.mock.calls[0]?.[0].onView({
			...fightView,
			actions: [...fightView.actions, ...talkView.actions],
			speech: [
				...talkView.speech,
				{
					id: "new-line",
					text: "A new arrival.",
					tick: 50,
					speakerId: "4",
					speaker: "Aldwin",
					mine: false,
				},
			],
		});
		const table = screen.getByRole("region", { name: "Table" });
		await waitFor(() => expect(table.querySelector(".tile-badge")?.textContent).toBe("1"));
		await fireEvent.click(table.querySelector("header") as HTMLElement);
		await screen.findByText("A new arrival.");
		await waitFor(() => expect(table.querySelector(".tile-badge")).toBeNull());
	});

	it("records the economy strip's own mounted/lines count alongside the rest of a fight's presentation (S4, sk-jay0.1.8.40 mount step)", async () => {
		signIn();
		const observations: PlayObservation[] = [];
		playObservation.subscribe((event) => observations.push(event));
		renderPlay({ view: fightView });
		await screen.findByRole("list", { name: "Turn order" });
		await waitFor(() =>
			expect(observations).toContainEqual(
				expect.objectContaining({
					phase: "presentation",
					economy_mounted: true,
					economy_lines: fightView.economy?.length,
				}),
			),
		);
	});

	it("does not treat a social room as a fight because melee is offered (sk-jay0.1.8.34.19)", async () => {
		signIn();
		const view = {
			...sampleView,
			actions: [
				...sampleView.actions,
				{
					id: "h:melee-aldwin",
					label: "Melee Attack — Aldwin, keeper of the hearth-ledger",
					verb: "manipulate" as const,
					descriptor: "srd/attack/melee",
					targetName: "Aldwin, keeper of the hearth-ledger",
					targetRef: "entity:4",
					acceptsUtterance: false,
					group: "combat",
				},
				{
					id: "h:melee-caddoc",
					label: "Melee Attack — Brother Caddoc",
					verb: "manipulate" as const,
					descriptor: "srd/attack/melee",
					targetName: "Brother Caddoc",
					targetRef: "entity:9",
					acceptsUtterance: false,
					group: "combat",
				},
				{
					id: "h:melee-hearth",
					label: "Melee Attack — Hearth",
					verb: "manipulate" as const,
					descriptor: "srd/attack/melee",
					targetName: "Hearth",
					targetRef: "entity:31",
					acceptsUtterance: false,
					group: "combat",
				},
			],
		};
		const { act } = renderPlay({ view });
		const table = await screen.findByRole("region", { name: "Table" });
		expect(table.querySelector(".tile-mode")?.textContent).toBe("Explore");
		expect(screen.queryByRole("list", { name: "Turn order" })).toBeNull();
		expect(screen.queryByRole("button", { name: "End turn" })).toBeNull();
		expect(screen.queryByText(/fight is on/i)).toBeNull();
		expect(screen.queryByText(/one melee hit/i)).toBeNull();
		// Each target's own melee offer reaches the dock only once THAT target
		// is selected (axiom A1/A4) — never merged into one fight state, and
		// never a single flat list naming all three at once. Caddoc offers no
		// words-taking act here, so the stream's own company mention does not
		// name him (`exploreContextFromView`'s existing "addressable" gate,
		// unrelated to this bead) — Place's own roster still selects him
		// (axiom A1's fourth name-click surface, unconditional on that).
		const dock = within(await screen.findByTestId("play-dock"));
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);
		await fireEvent.click(place.getByRole("button", { name: /Brother Caddoc/ }));
		await fireEvent.click(await dock.findByRole("button", { name: /Melee Attack/ }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({
			id: "h:melee-caddoc",
			targetRef: "entity:9",
			targetName: "Brother Caddoc",
		});
	});

	it("keeps Talk when a live dialogue also has sessionless attack offers", async () => {
		signIn();
		renderPlay({
			view: {
				...talkView,
				actions: [
					...talkView.actions,
					{
						id: "h:melee-aldwin",
						label: "Melee Attack — Aldwin, keeper of the hearth-ledger",
						verb: "manipulate",
						descriptor: "srd/attack/melee",
						targetName: "Aldwin, keeper of the hearth-ledger",
						targetRef: "entity:4",
						acceptsUtterance: false,
						group: "combat",
					},
				],
			},
		});
		const table = await screen.findByRole("region", { name: "Table" });
		expect(table.querySelector(".tile-mode")?.textContent).toBe("Talk");
		expect(screen.queryByRole("list", { name: "Turn order" })).toBeNull();
		// Aldwin is the open dialogue's own speaker, so his sessionless attack
		// offer joins HERE (the additive `talkSpeakerId` fold) without needing
		// a selection at all.
		const dock = within(await screen.findByTestId("play-dock"));
		expect(await dock.findByRole("button", { name: /Melee Attack/ })).toBeTruthy();
	});

	describe("the outcome line belongs to the dock in Talk (round 3, sk-jay0.1.8)", () => {
		// `PlaySessionHandle.act` only ever resolves to an already-rendered
		// string (`messageForAct`, `@spellkave/tool-runtime`) — the real
		// `classifyActResult(result).kind` is computed and recorded onto
		// `playTrail` (`recordAct`, `play-session.ts`) before the caller ever
		// sees it, then discarded. `App.svelte` reads that same trail entry
		// back (`actStatusKindFromOutcome`, `play-table.ts`) rather than
		// re-classifying, so these tests seed the trail themselves inside the
		// mocked `act`, exactly where `play-session.ts`'s own implementation
		// would have.
		it("hides the top status for a quiet outcome — the thread already carries whatever happened", async () => {
			signIn();
			const { act } = renderPlay({ view: talkView });
			await screen.findByRole("button", { name: "1 Answer — Fighter" });
			act.mockImplementation(async () => {
				playTrail.recordAct({
					tool: "spellkave_manipulate",
					outcome: "quiet",
					durationMs: 1,
					tick: 0,
				});
				return "Nothing you notice changes.";
			});
			await fireEvent.click(screen.getByRole("button", { name: "1 Answer — Fighter" }));
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			await waitFor(() => expect(document.querySelector(".play-status")).toBeNull());
			expect(screen.queryByText("Nothing you notice changes.")).toBeNull();
			expect(document.querySelector('[data-slot="dock-notice"]')).toBeNull();
		});

		it("renders a rejected outcome once, as a stream line, never at the top and never as a dock notice", async () => {
			signIn();
			const { act } = renderPlay({ view: talkView });
			await screen.findByRole("button", { name: "1 Answer — Fighter" });
			act.mockImplementation(async () => {
				playTrail.recordAct({
					tool: "spellkave_manipulate",
					outcome: "rejected",
					durationMs: 1,
					tick: 0,
				});
				return "Aldwin isn't listening right now.";
			});
			await fireEvent.click(screen.getByRole("button", { name: "1 Answer — Fighter" }));
			await waitFor(() =>
				expect(screen.getAllByText("Aldwin isn't listening right now.")).toHaveLength(1),
			);
			expect(document.querySelector(".play-status")).toBeNull();
			// Every scene mounts the one Table stream (sk-jay0.1.8.63.13), so a
			// refusal in Talk is a stream line like anywhere else; the dock's
			// notice reports only the connection and a slow world.
			const stream = document.querySelector('[data-tile="table"] [data-slot="activity-feed"]');
			expect(stream?.textContent).toContain("Aldwin isn't listening right now.");
			expect(document.querySelector('[data-slot="dock-notice"]')).toBeNull();
		});
	});

	it("keeps sessionless combat offers reachable with their own targets, without a one-hit fight frame", async () => {
		signIn();
		const strike = brawlView.actions.find((action) => action.id === "h:melee");
		if (!strike) throw new Error("expected sessionless strike");
		const { act } = renderPlay({
			view: {
				...brawlView,
				// A real second target carries its own occupant record — axiom
				// A1's dock only shows a target's actions once THAT target is
				// selected, and a name needs a presence to select through.
				occupants: [
					...brawlView.occupants,
					{
						id: "999",
						handle: "s:actor:999",
						rev: "s999",
						kind: "creature",
						sceneKind: "actor",
						name: "Second target",
						conditions: [],
						note: "Also here",
					},
				],
				actions: [
					// The hotbar keeps one stable SLOT per descriptor ("the same
					// descriptor lands in the same place for every target",
					// `dock-hotbar.ts`) — `brawlView`'s own "Longsword: damage"
					// shares its family descriptor with "Melee Attack" on purpose
					// for OTHER fixtures; here the point is that every one of the
					// three verbs is independently reachable, so it needs its own.
					...brawlView.actions.map((action) =>
						action.id === "h:longsword-strike"
							? { ...action, descriptor: "srd/attack/melee/longsword" }
							: action,
					),
					{
						...strike,
						id: "h:second-target",
						targetRef: "entity:999",
						targetName: "Second target",
						label: "Melee Attack — Second target",
					},
				],
			},
		});
		const table = await screen.findByRole("region", { name: "Table" });
		expect(table.querySelector(".tile-mode")?.textContent).toBe("Explore");
		expect(screen.queryByRole("list", { name: "Turn order" })).toBeNull();
		expect(screen.queryByRole("button", { name: "End turn" })).toBeNull();
		expect(screen.queryByText(/one melee hit/i)).toBeNull();
		const dock = within(await screen.findByTestId("play-dock"));
		await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
		const place = within(document.querySelector('[data-tile="place"]') as HTMLElement);

		await fireEvent.click(place.getByRole("button", { name: /Second target/ }));
		expect(await dock.findByRole("button", { name: /Melee Attack — Second target/ })).toBeTruthy();

		await fireEvent.click(place.getByRole("button", { name: /Cellar Rat 1/ }));
		expect(await dock.findByRole("button", { name: /Melee Attack — Cellar Rat 1/ })).toBeTruthy();
		expect(
			await dock.findByRole("button", { name: /Unarmed strike: damage — Cellar Rat 1/ }),
		).toBeTruthy();
		await fireEvent.click(dock.getByRole("button", { name: /Longsword: damage — Cellar Rat 1/ }));
		await waitFor(() => expect(act).toHaveBeenCalledOnce());
		expect(act.mock.calls[0]?.[0]).toMatchObject({
			id: "h:longsword-strike",
			targetRef: "entity:123",
			targetName: "Cellar Rat 1",
		});
	});

	it("fails closed with the catalog when the world has no browser database yet", async () => {
		signIn();
		render(App, {
			accountLoader: vi.fn(async () => playerAccount),
			catalogLoader: vi.fn(async () => [{ slug: "demo1", name: "The Woven Marches" }]),
			worldOpener: vi.fn(),
		});
		await waitFor(() =>
			expect(screen.getByText("This world is not ready for browser play yet.")).toBeTruthy(),
		);
	});

	it("shows the sign-in gate without any automatic redirect", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		window.sessionStorage.removeItem(PKCE_STORAGE_KEY);
		render(App, { worldOpener: vi.fn() });
		await waitFor(() => expect(screen.getByText("Sign in to enter the world.")).toBeTruthy());
		expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
		// The old silent attempt wrote PKCE state before redirecting; none now.
		expect(window.sessionStorage.getItem(PKCE_STORAGE_KEY)).toBeNull();
	});

	describe("the zoomed table: no masthead, a seat seal instead", () => {
		it("carries no product masthead in the shell", async () => {
			signIn();
			renderPlay();
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);
			expect(screen.queryByRole("navigation", { name: "Spellkave product navigation" })).toBeNull();
			expect(document.querySelector('[data-slot="product-masthead"]')).toBeNull();
		});

		it("puts labelled splitters in real desktop boundaries and corners, never on tile edges", async () => {
			signIn();
			renderPlay();
			await screen.findByRole("heading", { level: 3, name: "Common Room" });
			expect(
				screen.getAllByRole("separator").map((splitter) => splitter.getAttribute("aria-label")),
			).toEqual([
				"Resize Map and Place",
				"Resize Map corner",
				"Resize Map and Table columns",
				"Resize Table and You columns",
				"Resize You and Pack",
				"Resize You corner",
			]);
		});

		it("opens the seat seal into a menu that exposes account, theme, sign out and the website", async () => {
			signIn();
			renderPlay();
			const seal = await screen.findByRole("button", { name: "Renn the Roadwarden, seat menu" });
			await fireEvent.keyDown(seal, { key: "Enter" });
			await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
			expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
			expect(screen.getByRole("menuitem", { name: "Account" })).toBeTruthy();
			expect(screen.getByRole("menuitem", { name: "spellkave.com" })).toBeTruthy();
		});

		it("signs out through the seat menu the same way the old masthead did", async () => {
			signIn();
			const { disconnect } = renderPlay();
			const seal = await screen.findByRole("button", { name: "Renn the Roadwarden, seat menu" });
			await fireEvent.keyDown(seal, { key: "Enter" });
			await fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
			expect(disconnect).toHaveBeenCalledOnce();
		});

		it("signs out by POSTing a form to the login site's /logout and clears the tab", async () => {
			vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
			vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
			vi.stubEnv("VITE_SPELLKAVE_LOGIN_ORIGIN", "http://127.0.0.1:18081");
			signIn();
			let posted: { action: string; method: string; fields: Record<string, string> } | null = null;
			vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
				this: HTMLFormElement,
			) {
				const fields: Record<string, string> = {};
				for (const input of Array.from(this.querySelectorAll("input")))
					fields[input.name] = input.value;
				posted = { action: this.action, method: this.method.toLowerCase(), fields };
			});
			renderPlay();
			const seal = await screen.findByRole("button", { name: "Renn the Roadwarden, seat menu" });
			await fireEvent.keyDown(seal, { key: "Enter" });
			await fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
			expect(posted).toEqual({
				action: "http://127.0.0.1:18081/logout",
				method: "post",
				fields: { return_to: "https://spellkave.com/", token: "test-token" },
			});
			expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
			vi.unstubAllEnvs();
		});

		it("explains unavailable feedback after a click when no gateway is configured", async () => {
			signIn();
			renderPlay();
			const seal = await screen.findByRole("button", { name: "Renn the Roadwarden, seat menu" });
			await fireEvent.keyDown(seal, { key: "Enter" });
			const row = await screen.findByRole("menuitem", { name: "Send feedback" });
			expect(row.getAttribute("aria-disabled")).toBe("false");
			await fireEvent.click(row);
			expect(screen.getByText(/Feedback is unavailable/).getAttribute("role")).toBe("status");
			expect(screen.queryByRole("textbox", { name: /message/i })).toBeNull();
		});

		it("explains unavailable feedback when a map-only gateway is configured", async () => {
			vi.stubEnv("VITE_SPELLKAVE_GATEWAY_URL", "http://127.0.0.1:26360");
			vi.stubEnv("VITE_SPELLKAVE_FEEDBACK_ENABLED", "false");
			signIn();
			renderPlay();
			await fireEvent.keyDown(
				await screen.findByRole("button", { name: "Renn the Roadwarden, seat menu" }),
				{ key: "Enter" },
			);
			await fireEvent.click(await screen.findByRole("menuitem", { name: "Send feedback" }));
			expect(screen.getByText(/Feedback is unavailable/).getAttribute("role")).toBe("status");
			const dialog = within(screen.getByRole("dialog"));
			expect(dialog.queryByRole("textbox", { name: "What happened?" })).toBeNull();
			expect(dialog.queryByRole("button", { name: "Send" })).toBeNull();
			vi.unstubAllEnvs();
		});

		it("opens the feedback dialog through the seat menu when a gateway is configured, and Cancel closes it again", async () => {
			vi.stubEnv("VITE_SPELLKAVE_GATEWAY_URL", "https://mcp.spellkave.com");
			signIn();
			renderPlay();
			const seal = await screen.findByRole("button", { name: "Renn the Roadwarden, seat menu" });
			await fireEvent.keyDown(seal, { key: "Enter" });
			await fireEvent.click(await screen.findByRole("menuitem", { name: "Send feedback" }));
			expect(screen.getByRole("heading", { name: "Send feedback" })).toBeTruthy();
			// The seat menu itself closed underneath (same as every other row).
			expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
			await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
			expect(screen.queryByRole("heading", { name: "Send feedback" })).toBeNull();
			vi.unstubAllEnvs();
		});

		it("resets the mosaic to rest through the seat menu's Reset layout row (sk-jay0.1.8.14 task a: the only way back besides toggling a head twice)", async () => {
			signIn();
			renderPlay();
			// Focus Place: it goes to stage, the table (rest's own stage tile)
			// folds to a strip alongside it.
			const openPlace = await screen.findByRole("button", { name: "Open Place" });
			await fireEvent.click(openPlace);
			expect(await screen.findByRole("button", { name: "Shrink Place" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Open Table" })).toBeTruthy();
			const seal = screen.getByRole("button", { name: "Renn the Roadwarden, seat menu" });
			await fireEvent.keyDown(seal, { key: "Enter" });
			await fireEvent.click(await screen.findByRole("menuitem", { name: "Reset layout" }));
			// Back at rest: the table reads stage again, Place a card.
			expect(await screen.findByRole("button", { name: "Open Table" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Open Place" })).toBeTruthy();
		});

		it("maximizes the default large Table, and Shrink returns to the overview even after another tile was zoomed first (sk-jay0.1.8.102)", async () => {
			signIn();
			renderPlay();
			await fireEvent.click(await screen.findByRole("button", { name: "Open Table" }));
			expect(document.querySelector('[data-tile="place"]')?.getAttribute("data-zoom")).toBe(
				"strip",
			);
			await fireEvent.click(screen.getByRole("button", { name: "Shrink Table" }));
			expect(document.querySelector('[data-tile="place"]')?.getAttribute("data-zoom")).toBe("card");
			// Zoomed Pack, then zoomed Table: one Shrink lands on the overview
			// the player had before the first zoom, never on the zoomed Pack
			// (owner decision 2026-11-12; this pin used to expect "stage").
			await fireEvent.click(screen.getByRole("button", { name: "Open Pack" }));
			expect(document.querySelector('[data-tile="pack"]')?.getAttribute("data-zoom")).toBe("stage");
			await fireEvent.click(screen.getByRole("button", { name: "Open Table" }));
			await fireEvent.click(screen.getByRole("button", { name: "Shrink Table" }));
			expect(document.querySelector('[data-tile="pack"]')?.getAttribute("data-zoom")).toBe("card");
			expect(document.querySelector('[data-tile="place"]')?.getAttribute("data-zoom")).toBe("card");
			expect(screen.queryByRole("button", { name: /^Shrink / })).toBeNull();
		});

		it("lets the Place card share its tile with the action feedback line, so the ways-out line is never clipped (sk-jay0.1.8.102)", () => {
			// jsdom has no layout, so the rule itself is pinned: the place tile
			// body at card level is a column, and the card (`.place-card`, a
			// shrinking flex item in `@spellkave/ui-widgets`' Place.svelte) gives
			// the feedback line's height up instead of overflowing the clip.
			const css = readFileSync(resolve(import.meta.dirname, "styles.css"), "utf8");
			const start = css.indexOf('\n.tile[data-tile="place"][data-zoom="card"] .tile-body {');
			expect(start).toBeGreaterThan(-1);
			const rule = css.slice(start, css.indexOf("}", start));
			expect(rule).toMatch(/display:\s*flex/);
			expect(rule).toMatch(/flex-direction:\s*column/);
			const place = readFileSync(
				resolve(import.meta.dirname, "../node_modules/@spellkave/ui-widgets/src/Place.svelte"),
				"utf8",
			);
			const card = place.match(/:global\(\.place-card\)\s*\{([^}]*)\}/)?.[1] ?? "";
			expect(card).toMatch(/flex:\s*1 1 auto/);
			expect(card).toMatch(/min-height:\s*0/);
		});

		it("puts the gap above each Table stream on its host as a margin, never as padding inside the scrollport (sk-jay0.1.8.110)", () => {
			// A top padding inside a scrollport is a band where scrolled rows
			// stay visible: text showing under the filter bar. The shared
			// `.sk-stream-scroll` therefore insets the bottom only (pinned in
			// `@spellkave/ui`'s styles.test.ts) and each host carries the gap as
			// a margin, outside the clip. Dropping the margin butts the rows
			// against the bar; padding on the scrollport brings the band back.
			const css = readFileSync(resolve(import.meta.dirname, "styles.css"), "utf8");
			const ruleOf = (selector: string): string => {
				const start = css.indexOf(`\n.${selector} {`);
				expect(start, selector).toBeGreaterThan(-1);
				return css.slice(start, css.indexOf("}", start));
			};
			for (const selector of ["table-explore-stream", "table-card-stream"])
				expect(ruleOf(selector), selector).not.toMatch(/padding/);
			// The stage stream's host is the shell under the filter bar; the card
			// stream is its own host.
			for (const selector of ["table-explore-shell", "table-card-stream"])
				expect(ruleOf(selector), selector).toMatch(/margin-top:\s*0\.375rem/);
			expect(ruleOf("table-explore-shell")).not.toMatch(/padding/);
		});

		it("keeps an own attempt above the divider of the place entered on the same tick (sk-jay0.1.8.96)", async () => {
			signIn();
			const { act, worldOpener } = renderPlay();
			const dock = within(await screen.findByTestId("play-dock"));
			await fireEvent.click(dock.getByRole("button", { name: /Look around/ }));
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			const attempt = await waitFor(() => {
				const row = document.querySelector<HTMLElement>('li[data-activity-id="local:0"]');
				if (row === null) throw new Error("no attempt row");
				return row;
			});
			// The hero arrives elsewhere with no newer world line: the attempt
			// and the new divider share one tick.
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
			args.onView({
				...sampleView,
				// biome-ignore lint/style/noNonNullAssertion: the sample view supplies a place
				place: { ...sampleView.place!, id: "test/stairs", name: "Stairs" },
			});
			const stairs = await screen.findByRole("heading", { level: 4, name: "Stairs" });
			expect(
				attempt.compareDocumentPosition(stairs) & Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		});

		it("hides HP, AC and XP on the You tile, the sheet and the dock while the hero is drafted (sk-jay0.1.8.102)", async () => {
			signIn();
			renderPlay({
				view: {
					...sampleView,
					hero: hideDraftVitals({
						...sampleView.hero,
						drafting: true,
						hp: 0,
						ac: 0,
						xp: 0,
						vitals: [
							{ id: "srd/hp", label: "Hit Points", value: "0" },
							{ id: "srd/ac", label: "Armor Class", value: "0" },
							{ id: "srd/level", label: "Character Level", value: "1" },
						],
					}),
				},
			});
			const hero = await waitFor(() => {
				const tile = document.querySelector<HTMLElement>('[data-tile="hero"]');
				if (tile === null) throw new Error("no You tile");
				return tile;
			});
			const vitalsShown = /\bHP\b|\bAC\b|\bXP\b|Hit Points|Armor Class|Experience/;
			expect(hero.textContent).not.toMatch(vitalsShown);
			expect(hero.querySelector(".tile-mode")?.textContent).toBe("Renn the Roadwarden");
			const you = within(screen.getByTestId("play-dock")).getByRole("group", {
				name: "You status",
			});
			expect(you.textContent).not.toMatch(/HP|AC/);
			await fireEvent.click(screen.getByRole("button", { name: "Open You" }));
			await screen.findByRole("button", { name: "Shrink You" });
			expect(hero.textContent).not.toMatch(vitalsShown);
			expect(hero.textContent).toContain("STR");
		});
	});

	describe("the table's focus per beat", () => {
		it("explore: rests the table at stage with the offered actions", async () => {
			signIn();
			renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);
			expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).toBe(
				"stage",
			);
			// His own action needs him selected first (axiom A1).
			await fireEvent.click(
				(
					await screen.findAllByRole("button", {
						name: "Aldwin, keeper of the hearth-ledger details",
					})
				)[0] as HTMLElement,
			);
			expect(
				await screen.findByRole("button", { name: /Ask Aldwin About Advancement/ }),
			).toBeTruthy();
		});

		it("talk: opens the speaker's dialogue with the table at stage, its answers in the dock, none in the thread (round 3)", async () => {
			signIn();
			renderPlay({ view: talkView });
			await waitFor(() =>
				expect(
					// The present speaker's own burst heading is an `InfoLink` now
					// (sk-jay0.1.8.63.10) — accessible name carries its "details"
					// disambiguating suffix.
					screen.getByRole("heading", {
						level: 3,
						name: "Aldwin, keeper of the hearth-ledger details",
					}),
				).toBeTruthy(),
			);
			expect(screen.getByRole("button", { name: "1 Answer — Fighter" })).toBeTruthy();
			// The thread itself renders no chip buttons at stage any more — the
			// dock is the one place the open prompt's answers live, and the old
			// disclosure behind the composer is gone at stage (compact-only now).
			expect(screen.queryByRole("list", { name: /Answers from/ })).toBeNull();
			expect(screen.queryByText(/\+ What you can do/)).toBeNull();
			expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).toBe(
				"stage",
			);
		});

		it("fight: leaves the layout alone and offers the map-first layout in the dock; taking it puts the table at a card and the map at stage (axiom A2)", async () => {
			signIn();
			renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			expect(screen.getByText(/Your turn/)).toBeTruthy();
			expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).toBe(
				"stage",
			);
			expect(document.querySelector('[data-tile="map"]')?.getAttribute("data-zoom")).toBe("card");
			expect(screen.getByText("Fight begins.")).toBeTruthy();
			await takeFightLayoutOffer();
			expect(document.querySelector('[data-tile="map"]')?.getAttribute("data-zoom")).toBe("stage");
			expect(screen.queryByText("Fight begins.")).toBeNull();
		});

		it("fight: a dismissed layout offer changes nothing and does not come back on a later view of the same fight", async () => {
			signIn();
			const { worldOpener } = renderPlay({ view: fightView });
			await screen.findByText("Fight begins.");
			await fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
			expect(screen.queryByText("Fight begins.")).toBeNull();
			expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).toBe(
				"stage",
			);
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
			args.onView({ ...fightView });
			await Promise.resolve();
			expect(screen.queryByText("Fight begins.")).toBeNull();
		});

		it("talk at card size: the Table only tells, the answers are the dock's (axiom A1, sk-jay0.1.8.63.29)", async () => {
			signIn();
			renderPlay({ view: talkView });
			// Put another tile on stage, so the Table drops to its card.
			await fireEvent.click(await screen.findByRole("button", { name: "Open Pack" }));
			const table = document.querySelector<HTMLElement>('[data-tile="table"]');
			expect(table?.getAttribute("data-zoom")).not.toBe("stage");
			expect(within(table as HTMLElement).queryByRole("list", { name: /Answers from/ })).toBeNull();
			expect(within(table as HTMLElement).queryByRole("button", { name: /Fighter/ })).toBeNull();
			const dock = screen.getByTestId("play-dock");
			expect(within(dock).getByRole("button", { name: "1 Answer — Fighter" })).toBeTruthy();
		});

		it("reaction: the prompt replaces the dock's action rows and is told in the stream", async () => {
			signIn();
			renderPlay({ view: reactionView });
			const row = await screen.findByRole("toolbar", { name: "A moment to react" });
			expect(within(row).getByRole("button", { name: "1 React" })).toBeTruthy();
			expect(within(row).getByRole("button", { name: "2 Let it pass" })).toBeTruthy();
			// No stale digit: the ordinary action row is gone while the window is open.
			expect(screen.queryByRole("toolbar", { name: "Actions" })).toBeNull();
			const table = document.querySelector<HTMLElement>('[data-tile="table"]');
			expect(table?.textContent).toContain("A moment to react");
			expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).toBe(
				"stage",
			);
		});

		it("shows the reaction prompt in the dock while the player is busy elsewhere, and leaves their layout alone (axioms A2, A7)", async () => {
			signIn();
			const { worldOpener } = renderPlay({ view: sampleView });
			await waitFor(() => expect(worldOpener).toHaveBeenCalledOnce());
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };

			// Open Pack to its stage — the table is no longer the focused tile.
			const packZoom = await screen.findByRole("button", { name: "Open Pack" });
			await fireEvent.click(packZoom);
			expect(document.querySelector('[data-tile="pack"]')?.getAttribute("data-zoom")).toBe("stage");

			// A reaction opens while the player is looking at the pack.
			args.onView(reactionView);
			const row = await screen.findByRole("toolbar", { name: "A moment to react" });
			expect(row.closest('[data-testid="play-dock"]')).toBeTruthy();
			expect(document.querySelector('[data-tile="pack"]')?.getAttribute("data-zoom")).toBe("stage");
			expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).not.toBe(
				"stage",
			);
		});
	});

	describe("the Explore stream gets its own catch-up pill (sk-jay0.1.8.63.1)", () => {
		it("appears when a passive arrival lands while scrolled up, and clears on jump", async () => {
			// jsdom lays out nothing: stub the scroller's geometry the way
			// `Thread.test.ts` stubs its own host, and stub `requestAnimationFrame`
			// synchronously so the shared controller's mount-time `settle()` (and
			// the pill's own jump) resolve within this test's own awaits instead
			// of a stray real timer firing later.
			const rafSpy = vi
				.spyOn(globalThis, "requestAnimationFrame")
				.mockImplementation((cb: FrameRequestCallback) => {
					cb(0);
					return 0;
				});
			signIn();
			const { worldOpener } = renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };

			const streamEl = document.querySelector(".table-explore-stream") as HTMLElement;
			expect(streamEl).toBeTruthy();
			Object.defineProperties(streamEl, {
				clientHeight: { value: 100, configurable: true },
				scrollHeight: { value: 600, configurable: true },
			});
			await tick();
			await tick();
			streamEl.scrollTop = 0;
			await fireEvent.scroll(streamEl);

			// A line the player did not just say arrives (the world pushing an
			// update) — never the player's own `local:` activity, which always
			// reveals regardless of scroll position. Tick 43, past
			// `sampleView.events`' own latest (42, sk-jay0.1.8.63.2 now folds
			// those into this same stream too): the "did the stream grow"
			// check below reads the stream's own newest entry, so the pushed
			// line must actually sort after every existing one to register.
			args.onView({
				...sampleView,
				speech: [
					...sampleView.speech,
					{
						id: "speech:new",
						tick: 43,
						speakerId: "4",
						speaker: "Aldwin, keeper of the hearth-ledger",
						text: "One more thing, traveller.",
						mine: false,
					},
				],
			});

			const pill = await screen.findByRole("button", { name: /1 new line/ });
			expect(pill.closest('[data-slot="explore-catch-up"]')).toBeTruthy();
			expect(streamEl.scrollTop).toBe(0);

			await fireEvent.click(pill);
			expect(streamEl.scrollTop).toBe(600);
			await waitFor(() => expect(screen.queryByRole("button", { name: /new line/ })).toBeNull());
			rafSpy.mockRestore();
		});
	});

	describe("card tiles never hide a capped remainder, tap-to-scroll resolves by data-activity-id (sk-jay0.1.8.18, sk-jay0.1.8.63.1 Part B)", () => {
		it("Hero: clamps its own bare-chrome name to one line at card density so the conditions row stays in the tile (sk-jay0.1.8.19)", async () => {
			// The hero ("Renn the Roadwarden", HP/AC/XP all set, conditions:
			// []) is the exact live-measured repro: the name's stage-sized
			// two-line wrap alone (64px) pushed the "Conditions: None" line
			// below the card's rest-height fold (scrollHeight 211 vs
			// clientHeight 167, apps/play at 1280x720). Uses `sampleView`
			// (rest layout, Hero at its normal card share) rather than
			// `fightView`: `fightView`'s hero is the exact same object
			// (fightView never overrides it) but `fightLayout` (S1,
			// sk-jay0.1.8.37) now folds Hero to a strip for the whole fight,
			// so a fight view no longer reaches the card density this test
			// means to exercise. Asserting the truncate class plus the
			// conditions row's presence, together, covers the fix end to end
			// through the real PlayTable → Hero wiring, not just Hero.svelte
			// in isolation (see Hero.test.ts).
			signIn();
			renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Renn the Roadwarden" })).toBeTruthy(),
			);
			const heading = screen.getByRole("heading", { level: 3, name: "Renn the Roadwarden" });
			expect(heading.className).toContain("truncate");
			expect(
				within(heading.closest('[data-tile="hero"]') as HTMLElement).getByText("Conditions"),
			).toBeTruthy();
			expect(screen.getByText("None")).toBeTruthy();
		});
	});

	describe("Chronicle folded into the stream", () => {
		it("retains complete speech, including an absent speaker, and filters without losing history", async () => {
			signIn();
			const firstSpeech = talkBurstView.speech[0];
			if (firstSpeech === undefined) throw new Error("talk burst fixture supplies speech");
			const historical = {
				...firstSpeech,
				id: "speech:absent",
				speakerId: "absent",
				speaker: "A departed traveller",
				text: "Keep this old warning.",
				tick: 1,
			};
			const { worldOpener } = renderPlay({
				view: { ...talkBurstView, speech: [historical, ...talkBurstView.speech] },
			});
			const filters = await screen.findByRole("list", { name: "Filter the stream" });
			const stream = document.querySelector(".table-explore-stream") as HTMLElement;
			expect(within(stream).getByText(historical.text)).toBeTruthy();
			for (const line of talkBurstView.speech) expect(stream.textContent).toContain(line.text);
			const before = Array.from(stream.querySelectorAll("[data-activity-id]"), (row) =>
				row.getAttribute("data-activity-id"),
			);
			await fireEvent.click(within(filters).getByRole("button", { name: "Things" }));
			expect(within(stream).queryByText(historical.text)).toBeNull();
			await fireEvent.click(within(filters).getByRole("button", { name: "Speech" }));
			expect(within(stream).getByText(historical.text)).toBeTruthy();
			await fireEvent.click(within(filters).getByRole("button", { name: "All" }));
			expect(
				Array.from(stream.querySelectorAll("[data-activity-id]"), (row) =>
					row.getAttribute("data-activity-id"),
				),
			).toEqual(before);
			expect(document.querySelector('[data-tile="chronicle"]')).toBeNull();
			// The transport ring can roll over; retained text still belongs to this visit.
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
			args.onView({ ...talkBurstView, speech: [] });
			await waitFor(() => expect(within(stream).getByText(historical.text)).toBeTruthy());
		});
		it("keeps the reader's filter across fight transitions and shows every retained fight event", async () => {
			signIn();
			const { worldOpener } = renderPlay({ view: fightView });
			const filters = await screen.findByRole("list", { name: "Filter the stream" });
			await fireEvent.click(within(filters).getByRole("button", { name: "Fight" }));
			const stream = document.querySelector(".table-explore-stream") as HTMLElement;
			for (const text of [
				"You take 3 HP damage (bite) — now at 8.",
				"You hit Cellar Rat 1 for 5 damage.",
			]) {
				expect(within(stream).getByText(text)).toBeTruthy();
			}
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
			args.onView(sampleView);
			await waitFor(() =>
				expect(
					within(filters).getByRole("button", { name: "Fight" }).getAttribute("aria-pressed"),
				).toBe("true"),
			);
			expect(within(stream).getByText("You hit Cellar Rat 1 for 5 damage.")).toBeTruthy();
		});
	});

	describe("world events reach the Table's own journal (sk-jay0.1.8.63.2)", () => {
		it("shows fightView's session/hit facts as quiet event lines in the card fight stream, never a place row for the grid cell", async () => {
			signIn();
			renderPlay({ view: fightView });
			await screen.findByRole("list", { name: "Turn order" });
			await takeFightLayoutOffer();
			const stream = document.querySelector(".table-card-stream") as HTMLElement;
			expect(stream).toBeTruthy();
			// fightView's own place is a tactical-grid cell (`hasTacticalSession`
			// is true from the very first view this test ever supplies) — no
			// place-arrival divider for it, only the three world events already
			// on `fightView.events` (sample-view.ts): the session's own opening
			// event stands in for the "entering a fight" row this bead's task 6
			// asks for, for free, once it is in `view.events` at all.
			expect(within(stream).queryByRole("heading", { level: 4 })).toBeNull();
			await waitFor(() =>
				expect(within(stream).getByText("A session opens (2 participants).")).toBeTruthy(),
			);
			expect(within(stream).getByText("You take 3 HP damage (bite) — now at 8.")).toBeTruthy();
			expect(within(stream).getByText("You hit Cellar Rat 1 for 5 damage.")).toBeTruthy();
		});

		it("a pushed self_hit event adds exactly one card-level row and follows to the bottom when pinned; scrolled up, the pill shows instead", async () => {
			// Same jsdom-geometry-stubbing technique as the stage catch-up pill
			// test above (jsdom lays out nothing): stub the card stream's own
			// scroller geometry and make `requestAnimationFrame` synchronous so
			// the shared `createFollowScroll` controller's `settle()`/reveal
			// resolve inside this test's own awaits.
			const rafSpy = vi
				.spyOn(globalThis, "requestAnimationFrame")
				.mockImplementation((cb: FrameRequestCallback) => {
					cb(0);
					return 0;
				});
			signIn();
			const { worldOpener } = renderPlay({ view: fightView });
			await screen.findByRole("list", { name: "Turn order" });
			await takeFightLayoutOffer();
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
			const stream = document.querySelector(".table-card-stream") as HTMLElement;
			expect(stream).toBeTruthy();
			Object.defineProperties(stream, {
				clientHeight: { value: 100, configurable: true },
				scrollHeight: { value: 600, configurable: true },
			});
			await tick();
			await tick();
			const rowsBefore = within(stream).getAllByRole("listitem").length;

			// Pinned (the default): a pushed `self_hit` event follows to the
			// bottom and adds exactly one row.
			args.onView({
				...fightView,
				events: [
					...fightView.events,
					{
						id: "event-12",
						tick: 61,
						kind: "self_hit",
						summary: "You take 2 srd/hp damage (claw) — now at 6.",
					},
				],
			});
			await waitFor(() =>
				expect(within(stream).getByText("You take 2 HP damage (claw) — now at 6.")).toBeTruthy(),
			);
			expect(within(stream).getAllByRole("listitem")).toHaveLength(rowsBefore + 1);
			expect(stream.scrollTop).toBe(600);

			// Scrolled up: the next pushed event only grows the catch-up pill,
			// which now shows at card level too (task 7).
			stream.scrollTop = 0;
			await fireEvent.scroll(stream);
			args.onView({
				...fightView,
				events: [
					...fightView.events,
					{
						id: "event-12",
						tick: 61,
						kind: "self_hit",
						summary: "You take 2 srd/hp damage (claw) — now at 6.",
					},
					{
						id: "event-13",
						tick: 62,
						kind: "self_hit",
						summary: "You take 1 srd/hp damage (claw) — now at 5.",
					},
				],
			});
			const pill = await screen.findByRole("button", { name: /1 new line/ });
			expect(pill.closest('[data-slot="explore-catch-up"]')).toBeTruthy();
			expect(stream.scrollTop).toBe(0);
			rafSpy.mockRestore();
		});

		it("does not record a place divider for a grid-cell-to-grid-cell move while a tactical session holds", async () => {
			signIn();
			const { worldOpener } = renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
			// Entering the fight: a real place → a grid cell. No "Cellar" place
			// row — the session's own opening event substitutes for it.
			args.onView(fightView);
			await screen.findByRole("list", { name: "Turn order" });
			await takeFightLayoutOffer();
			const stream = document.querySelector(".table-card-stream") as HTMLElement;
			expect(within(stream).queryByRole("heading", { level: 4, name: "Cellar" })).toBeNull();
			await waitFor(() =>
				expect(within(stream).getByText("A session opens (2 participants).")).toBeTruthy(),
			);
			// A further grid-cell-to-grid-cell step (still tactical): still no
			// NEW divider (the earlier "Common Room" divider from before the
			// fight remains — one continuous journal never drops a line it
			// already showed, sk-jay0.1.8.60 — only a fresh row for the cell
			// itself is what this asserts against), and no crash from the
			// place id merely changing again.
			const headingsBeforeSecondStep = within(stream).queryAllByRole("heading", {
				level: 4,
			}).length;
			// biome-ignore lint/style/noNonNullAssertion: fight fixture supplies a place
			args.onView({ ...fightView, place: { ...fightView.place!, id: "session_grid_58/c_2_0" } });
			await tick();
			expect(within(stream).queryAllByRole("heading", { level: 4 })).toHaveLength(
				headingsBeforeSecondStep,
			);
			expect(
				within(stream).queryByRole("heading", { level: 4, name: /c_2_0|session_grid/ }),
			).toBeNull();
		});
	});

	describe("the map tile: @spellkave/map-canvas, mounted lazily (sk-jay0.1.8.9)", () => {
		it("card level stays the place plate; opening the tile lazily mounts the canvas with the session's token, slug, origin and mode", async () => {
			vi.stubEnv("VITE_SPELLKAVE_GATEWAY_URL", "https://mcp.spellkave.com");
			signIn();
			renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);

			// This fixture has no SVG: readable place context, no decorative map.
			const mapTile = document.querySelector('[data-tile="map"]');
			expect(mapTile?.getAttribute("data-zoom")).toBe("card");
			expect(mapTile?.querySelector('[role="img"]')).toBeNull();
			expect(
				within(mapTile as HTMLElement).getByRole("status", { name: "Map status" }).textContent,
			).toContain("No map is drawn");
			expect(mapTile?.querySelector('[data-testid="map-tile-canvas-mount"]')).toBeNull();
			expect(mapCanvasImportTracker.imported).toBe(false);

			// Opening it to stage (a tap sends a tile to `focusedLayout`, which
			// maximises both its column and its own share — the mosaic folds
			// the other two columns to icon rails, so the tile genuinely fills
			// the viewport) triggers the dynamic import and mounts the widget
			// with the session's own token, the world's slug, the configured
			// gateway origin and "full".
			await fireEvent.click(screen.getByRole("button", { name: "Open Map" }));
			const canvas = await screen.findByTestId("fake-map-canvas");
			expect(mapCanvasImportTracker.imported).toBe(true);
			expect(canvas.dataset.gatewayOrigin).toBe("https://mcp.spellkave.com");
			expect(canvas.dataset.slug).toBe("demo1");
			expect(canvas.dataset.token).toBe("test-token");
			expect(canvas.dataset.mode).toBe("full");
			expect(canvas.dataset.placeNodeId).toBe("inn/common_room");
			expect(screen.getByText(/whole world/i)).toBeTruthy();
			vi.unstubAllEnvs();
		});

		it(
			"map selection offers only a matching canonical exit and does not move until clicked",
			verifyMapOfferedExit,
		);

		it("a fight keeps the tactical grid at every level and never mounts the canvas", async () => {
			signIn();
			renderPlay({
				view: {
					...fightView,
					mapSvg: '<svg viewBox="0 0 100 80"><rect width="100" height="80" /></svg>',
				},
			});
			// Combat goes bare inside the table tile (sk-jay0.1.8.5 finding 7):
			// the tile head carries the mode word ("Fight"), the roster carries
			// who is fighting, with no separate enemy-name heading duplicating
			// either — wait on the roster rather than a heading that no longer
			// renders.
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());

			await fireEvent.click(screen.getByRole("button", { name: "Open Map" }));
			const mapTile = document.querySelector('[data-tile="map"]');
			expect(mapTile?.getAttribute("data-zoom")).toBe("stage");
			expect(mapTile?.querySelector('[role="img"]')).toBeTruthy();
			expect(screen.queryByTestId("fake-map-canvas")).toBeNull();
			expect(mapTile?.querySelector('[data-testid="map-tile-canvas-mount"]')).toBeNull();
		});

		it("mounts the interactive BattleMap widget in selection mode; clicking the offered cell never moves — the selection row's own pill does (S2, sk-jay0.1.8.38; select-then-act, sk-jay0.1.8.63.13)", async () => {
			signIn();
			const { move, act } = renderPlay({ view: fightView });
			await waitFor(() => expect(screen.getByRole("list", { name: "Turn order" })).toBeTruthy());
			// The map-first layout is the player's to take (axiom A2).
			await takeFightLayoutOffer();
			const mapTile = document.querySelector('[data-tile="map"]');
			expect(mapTile?.getAttribute("data-zoom")).toBe("stage");
			const battleMap = within(mapTile as HTMLElement).getByRole("group", { name: "Battle map" });
			const offeredCell = battleMap.querySelector('[data-node-id="session_grid_58/c_0_0"]');
			expect(offeredCell).not.toBeNull();
			expect(offeredCell?.getAttribute("role")).toBe("button");
			// The token placed on this cell (`sessionTokens`, sk-jay0.4.2) makes
			// it read as "who" it holds — and, since that cell is occupied, it
			// is no longer tagged "reachable": a step there would be refused,
			// so `PlayTable` never hands it to `BattleMap` as an offered exit
			// (sk-jay0.1.8.63.13 review).
			expect(offeredCell?.getAttribute("aria-label")).toBe("Cellar Rat 1");
			// The own cell is marked, distinct from the offered one.
			expect(battleMap.querySelector('[data-node-id="session_grid_58/c_1_0"]')).not.toBeNull();
			await fireEvent.click(offeredCell as HTMLElement);
			// The map only ever selects now — never a move of its own.
			expect(move).not.toHaveBeenCalled();
			// The occupant's own offered actions land in the Table's selection
			// row instead; pressing one acts through the ordinary path. The
			// pill's accessible name stays the world's own unambiguous label.
			await fireEvent.click(
				await screen.findByRole("button", { name: "1 Melee Attack — Cellar Rat 1" }),
			);
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:melee" });
		});
	});

	// Kept after the lazy-mount test above: opening the Map tile loads the
	// map canvas module, which that test must see unloaded first.
	it("the stage map fills the box for a current way out and only selects any other place", async () => {
		// biome-ignore lint/style/noNonNullAssertion: the fixture supplies a place
		const livePlace = placeDetailView.place!;
		const stairs = livePlace.exits[0];
		if (stairs === undefined) throw new Error("fixture supplies its first exit");
		signIn();
		const exits = [{ ...stairs, toNodeId: "test/destination" }, ...livePlace.exits.slice(1)];
		const { move, worldOpener } = renderPlay({
			view: { ...placeDetailView, place: { ...livePlace, exits } },
		});
		const input = await screen.findByRole<HTMLInputElement>("combobox");
		await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
		const mapPlace = await screen.findByRole("button", { name: "Select test map place" });
		await fireEvent.click(mapPlace);
		await waitFor(() => expect(input.value).toBe("/go-stairs"));
		expect(move).not.toHaveBeenCalled();
		// The same node is no longer a way out: the click only selects.
		await fireEvent.input(input, { target: { value: "" } });
		worldOpener.mock.calls[0]?.[0].onView({
			...placeDetailView,
			place: { ...livePlace, exits: livePlace.exits.slice(1) },
		});
		await tick();
		await fireEvent.click(mapPlace);
		await tick();
		expect(input.value).not.toContain("/go-");
		expect(move).not.toHaveBeenCalled();
		// Two current ways out lead to the node: the click cannot name one of
		// them, so it only selects.
		await fireEvent.input(input, { target: { value: "" } });
		worldOpener.mock.calls[0]?.[0].onView({
			...placeDetailView,
			place: {
				...livePlace,
				exits: livePlace.exits.map((exit) => ({ ...exit, toNodeId: "test/destination" })),
			},
		});
		await tick();
		expect(livePlace.exits.length).toBeGreaterThan(1);
		await fireEvent.click(mapPlace);
		await tick();
		expect(input.value).not.toContain("/go-");
		expect(move).not.toHaveBeenCalled();
	});

	it("opening the Map tile writes nothing into the box; a pick of the own place still does (sk-jay0.1.8.99)", async () => {
		// biome-ignore lint/style/noNonNullAssertion: the fixture supplies a place
		const livePlace = placeDetailView.place!;
		const context = placeDetailView.manipulationContext;
		if (context?.status !== "ready") throw new Error("fixture supplies ready facts");
		signIn();
		// The hero's own place is a disclosed target, so selecting it would
		// prefill the box with its name.
		const { move } = renderPlay({
			view: {
				...placeDetailView,
				manipulationContext: {
					...context,
					targets: [
						...context.targets,
						{
							targetFactId: "fixture:own-place",
							targetRef: `place_node:${livePlace.id}`,
							targetName: livePlace.name,
							tags: [],
						},
					],
				},
			},
		});
		const input = await screen.findByRole<HTMLInputElement>("combobox");
		await fireEvent.input(input, { target: { value: "/" } });
		await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
		// The fake canvas reports its boot place (the hero's own) on mount.
		const canvas = await screen.findByTestId("fake-map-canvas");
		expect(canvas.dataset.placeNodeId).toBe(livePlace.id);
		await tick();
		await tick();
		expect(input.value).toBe("/");
		// A deliberate pick of that place selects it and fills as before.
		await fireEvent.click(screen.getByRole("button", { name: "Select own map place" }));
		await waitFor(() => expect(input.value).toContain(`"${livePlace.name}"`));
		expect(move).not.toHaveBeenCalled();
	});

	// Kept after the lazy-mount test above as well: two of these open the Map
	// tile, which loads the map canvas module.
	describe("beside a go sentence a name or map click only selects (owner ruling 2026-11-13)", () => {
		// biome-ignore lint/style/noNonNullAssertion: the fixture supplies a place
		const livePlace = placeDetailView.place!;
		const stairs = livePlace.exits[0];
		if (stairs === undefined) throw new Error("fixture supplies its first exit");
		const aldwin = placeDetailView.occupants[0];
		if (aldwin === undefined) throw new Error("fixture supplies its first occupant");
		const context = placeDetailView.manipulationContext;
		if (context?.status !== "ready") throw new Error("fixture supplies ready facts");
		// The hero's own place is a disclosed target, so a map pick of it would
		// prefill the box. Stairs has no destination node here, so the way-out
		// click itself selects nothing.
		const view: PlayView = {
			...placeDetailView,
			manipulationContext: {
				...context,
				targets: [
					...context.targets,
					{
						targetFactId: "fixture:own-place",
						targetRef: `place_node:${livePlace.id}`,
						targetName: livePlace.name,
						tags: [],
					},
				],
			},
		};
		async function armGo(): Promise<HTMLInputElement> {
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			const placeTile = document.querySelector<HTMLElement>('[data-tile="place"]');
			if (placeTile === null) throw new Error("expected the Place tile");
			const ways = within(within(placeTile).getByRole("list", { name: "Ways out" }));
			await fireEvent.click(ways.getByRole("button", { name: "Stairs (southeast)" }));
			await waitFor(() => expect(input.value).toBe("/go-stairs"));
			return input;
		}
		async function clickAldwinName(): Promise<void> {
			const names = await screen.findAllByRole("button", { name: `${aldwin?.name} details` });
			const name = names[0];
			if (name === undefined) throw new Error("the stream names the occupant");
			await fireEvent.click(name);
		}
		// A live session draws no selection row, so the selection is read from
		// the composer seam: the prefill fires only when the selected target
		// changes. If the first click had not selected, the same click on an
		// empty box would select now and fill it.
		async function expectAlreadySelected(input: HTMLInputElement, click: () => Promise<void>) {
			await fireEvent.input(input, { target: { value: "" } });
			await click();
			await tick();
			await tick();
			expect(input.value).toBe("");
		}

		it("a name click leaves the go sentence alone, and Enter still moves", async () => {
			signIn();
			const { move } = renderPlay({ view });
			const input = await armGo();
			await clickAldwinName();
			await tick();
			await tick();
			expect(input.value).toBe("/go-stairs");
			// The sentence is still the armed route: Enter moves once.
			await fireEvent.keyDown(input, { key: "Enter" });
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
			expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: stairs.handle });
		});

		it("the name click beside the go sentence did select the name", async () => {
			signIn();
			renderPlay({ view });
			const input = await armGo();
			await clickAldwinName();
			await tick();
			expect(input.value).toBe("/go-stairs");
			await expectAlreadySelected(input, clickAldwinName);
		});

		it("a stage-map click leaves the go sentence alone and selects the place", async () => {
			signIn();
			const { move } = renderPlay({ view });
			const input = await armGo();
			await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
			await screen.findByTestId("fake-map-canvas");
			await tick();
			await tick();
			await fireEvent.click(screen.getByRole("button", { name: "Select own map place" }));
			await tick();
			await tick();
			expect(input.value).toBe("/go-stairs");
			expect(move).not.toHaveBeenCalled();
			await expectAlreadySelected(input, () =>
				fireEvent
					.click(screen.getByRole("button", { name: "Select own map place" }))
					.then(() => {}),
			);
			expect(move).not.toHaveBeenCalled();
		});

		it("without a go sentence the same clicks still fill the box", async () => {
			signIn();
			renderPlay({ view });
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await clickAldwinName();
			await waitFor(() => expect(input.value).toBe(`@"${aldwin.name}"`));
			await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
			await screen.findByTestId("fake-map-canvas");
			await fireEvent.click(screen.getByRole("button", { name: "Select own map place" }));
			await waitFor(() => expect(input.value).toContain(`"${livePlace.name}"`));
			expect(input.value).not.toContain(aldwin.name);
		});
	});

	// Legacy recordings only (`interactionOrigin: "legacy-recording"`): they
	// have no composer, so the selection row keeps its Travel slot. The live
	// path is covered by "a click on a way out fills the text box" above.
	describe("legacy recordings: the map card only selects; travel dispatches from the Table's selection row (sk-jay0.1.8.63.8, sk-jay0.1.8.63.13)", () => {
		it("selecting a neighbouring place on the passive plate shows 'Travel to <place>' in the selection row, never moving on click", async () => {
			signIn();
			// biome-ignore lint/style/noNonNullAssertion: sample fixture supplies a place
			const place = sampleView.place!;
			const exit = place.exits[0];
			if (exit === undefined) throw new Error("sample fixture supplies its first exit");
			const view = {
				...sampleView,
				mapSvg:
					`<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">` +
					`<g data-node-id="${place.id}"><circle class="place" cx="20" cy="20" r="5" /></g>` +
					`<g data-node-id="inn/stairs-node"><circle class="place" cx="60" cy="20" r="5" /></g>` +
					`<g data-node-id="inn/elsewhere"><circle class="place" cx="90" cy="20" r="5" /></g></svg>`,
				place: {
					...place,
					exits: [{ ...exit, toNodeId: "inn/stairs-node" }, ...place.exits.slice(1)],
				},
			};
			const { move } = renderPlay({ view });
			const mapTile = await waitFor(() => {
				const tile = document.querySelector('[data-tile="map"]');
				expect(tile?.querySelector('[data-node-id="inn/stairs-node"][role="button"]')).toBeTruthy();
				return tile as HTMLElement;
			});
			const zoom = mapTile.getAttribute("data-zoom");
			const target = mapTile.querySelector('[data-node-id="inn/stairs-node"]') as HTMLElement;
			// Labelled by where it leads, not by the exit's direction.
			expect(target.getAttribute("aria-label")).toBe(`Go to ${place.exits[0]?.toName}`);
			expect(
				mapTile.querySelector('[data-node-id="inn/elsewhere"]')?.getAttribute("role"),
			).toBeNull();
			expect(
				mapTile.querySelector(`[data-node-id="${place.id}"]`)?.getAttribute("role"),
			).toBeNull();
			await fireEvent.click(target);
			// The click only selects — the row, not the click, carries "Travel to …".
			expect(move).not.toHaveBeenCalled();
			const travel = await screen.findByRole("button", {
				name: `1 Travel to ${place.exits[0]?.toName}`,
			});
			await fireEvent.click(travel);
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
			expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: place.exits[0]?.handle });
			expect(mapTile.getAttribute("data-zoom")).toBe(zoom);
		});

		it("'Ways out' selects the destination; only the hotbar's own Travel slot moves (axiom A1)", async () => {
			signIn();
			// biome-ignore lint/style/noNonNullAssertion: sample fixture supplies a place
			const place = sampleView.place!;
			const exit = place.exits[0];
			if (exit === undefined) throw new Error("sample fixture supplies its first exit");
			const view = {
				...sampleView,
				place: {
					...place,
					exits: [{ ...exit, toNodeId: "inn/stairs-node" }, ...place.exits.slice(1)],
				},
			};
			const { move } = renderPlay({ view });
			const dock = within(await screen.findByTestId("play-dock"));
			await fireEvent.keyDown(dock.getByRole("button", { name: /\d+ ways? out/ }), {
				key: "Enter",
			});
			const menu = await screen.findByRole("menu");
			const stairsItem = within(menu).getByText(exit.toName).closest('[role="menuitem"]');
			if (stairsItem === null) throw new Error("expected the Stairs menu item");
			await fireEvent.click(stairsItem);
			// Choosing the exit only selects — it never travels on its own.
			expect(move).not.toHaveBeenCalled();
			const travel = await dock.findByRole("button", {
				name: new RegExp(`Travel to ${exit.toName}`),
			});
			await fireEvent.click(travel);
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
			expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: exit.handle });
		});

		it("moves directly for an exit the world names with no destination node", async () => {
			signIn();
			const { move } = renderPlay();
			const dock = within(await screen.findByTestId("play-dock"));
			await fireEvent.keyDown(dock.getByRole("button", { name: /\d+ ways? out/ }), {
				key: "Enter",
			});
			const menu = await screen.findByRole("menu");
			// None of sampleView's own exits carry a `toNodeId` — every one of
			// them is this "nothing to select" case.
			// biome-ignore lint/style/noNonNullAssertion: the menu fixture has the Stairs item
			await fireEvent.click(within(menu).getByText("Stairs").closest('[role="menuitem"]')!);
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
			expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: "s:exit:1" });
		});
	});

	describe("the dock's expanded state (axiom A2: the player's own control)", () => {
		it("the keymap's dock.toggle key does what the button does", async () => {
			signIn();
			renderPlay({ view: fightView });
			await screen.findByRole("button", { name: "Show more actions" });
			await fireEvent.keyDown(window, { key: "b" });
			expect(await screen.findByRole("button", { name: "Show fewer actions" })).toBeTruthy();
			await fireEvent.keyDown(window, { key: "b" });
			expect(await screen.findByRole("button", { name: "Show more actions" })).toBeTruthy();
		});

		it("shows the resource strip in a fight and not while exploring (sk-jay0.1.8.63.27)", async () => {
			const economyBudget = {
				channels: [
					{
						channelId: "srd/economy_channel/primary",
						label: "Action",
						status: "ok",
						remainingMs: 6000,
						poolMs: 6000,
					},
				],
				unavailable: false,
			} as unknown as PlayView["economyBudget"];
			signIn();
			renderPlay({ view: { ...sampleView, economyBudget } });
			await screen.findByRole("toolbar", { name: "Actions" });
			expect(screen.queryByRole("list", { name: "Resources" })).toBeNull();

			cleanup();
			renderPlay({ view: { ...fightView, economyBudget } });
			expect(await screen.findByRole("list", { name: "Resources" })).toBeTruthy();
		});

		it("survives a remount via a storage stub, and shows HERE/ME under a selection once expanded", async () => {
			const store = new Map<string, string>();
			vi.stubGlobal("localStorage", {
				getItem: (key: string) => store.get(key) ?? null,
				setItem: (key: string, value: string) => void store.set(key, value),
				removeItem: (key: string) => void store.delete(key),
			});
			try {
				signIn();
				const { worldOpener } = renderPlay({ view: fightView });
				const toggle = await screen.findByRole("button", { name: "Show more actions" });
				await fireEvent.click(toggle);
				expect(await screen.findByRole("button", { name: "Show fewer actions" })).toBeTruthy();
				expect(store.get("spellkave.play.dock.expanded")).toBe("true");

				// A remount (a fresh `<App>`, the same shape a page reload takes)
				// reads the SAME storage — the player's own choice, never reset by
				// the app (axiom A2).
				cleanup();
				renderPlay({ view: fightView });
				expect(await screen.findByRole("button", { name: "Show fewer actions" })).toBeTruthy();

				// Expanded, with a fight selection standing, HERE and ME each get
				// their own row below the selection's.
				const order = await screen.findByRole("list", { name: "Turn order" });
				await fireEvent.click(within(order).getByRole("button", { name: /Cellar Rat 1/ }));
				expect(await screen.findByRole("group", { name: "Cellar Rat 1" })).toBeTruthy();
				expect(await screen.findByRole("group", { name: "Me" })).toBeTruthy();
				// The old `SelectionRow` widget (a `role="list"` named "Selected")
				// is gone from the Table entirely (axiom A3: the stream tells, it
				// never acts) — the hotbar's own groups replaced it.
				expect(screen.queryByRole("list", { name: "Selected" })).toBeNull();
				expect(document.querySelector('[data-slot="dock-selection-row"]')).toBeNull();
				void worldOpener;
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});

	describe('reply suggestion (Selection model, "Decided details" 3)', () => {
		it("offers to reply to the last speaker who addressed the player, and a click selects them and arms the composer", async () => {
			signIn();
			const view: PlayView = {
				...sampleView,
				speech: [
					{
						id: "speech:200",
						tick: 41,
						speakerId: "4",
						speaker: "Aldwin, keeper of the hearth-ledger",
						text: "Renn, a word before you go?",
						mine: false,
						addresseeName: "Renn the Roadwarden",
					},
				],
			};
			renderPlay({ view });
			const replyButton = await screen.findByRole("button", {
				name: "Reply to Aldwin, keeper of the hearth-ledger",
			});
			expect(
				screen.getByPlaceholderText(/^Reply to Aldwin, keeper of the hearth-ledger/),
			).toBeTruthy();
			await fireEvent.click(replyButton);
			// Accepting the suggestion SELECTS the speaker (axiom A4) and arms
			// the composer at his own "Speak To" slot.
			expect(
				await screen.findByRole("group", { name: "Aldwin, keeper of the hearth-ledger" }),
			).toBeTruthy();
			expect(
				screen.getByLabelText(
					/^Say or do something — Speak To \(Aldwin, keeper of the hearth-ledger\)$/,
				),
			).toBeTruthy();
		});
	});

	describe("the You and Pack tiles at stage: the character sheet and the item detail (sk-jay0.1.8.6)", () => {
		it("reports item loading, supplied fields, and failure independently from a closed tile", async () => {
			signIn();
			const events: PlayObservation[] = [];
			playObservation.subscribe((event) => events.push(event));
			const view = { ...sampleView, itemDetail: null };
			const { worldOpener } = renderPlay({ view });
			await fireEvent.click(await screen.findByRole("button", { name: "Open Pack" }));
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "item_detail",
						detail_state: "loading",
						represented_fields: 0,
					}),
				),
			);
			const onView = worldOpener.mock.calls[0]?.[0].onView;
			const detail = {
				id: "12",
				kind: "Weapon",
				description: "A plain blade.",
				slot: null,
				facts: [],
				verbs: [],
				suppliedFields: 1,
			};
			onView?.({ ...view, itemDetail: detail });
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "item_detail",
						detail_state: "ready",
						supplied_fields: 1,
						represented_fields: 1,
					}),
				),
			);
			onView?.({ ...view, itemDetail: { ...detail, description: undefined, suppliedFields: 0 } });
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "item_detail",
						detail_state: "empty",
						supplied_fields: 0,
						represented_fields: 0,
					}),
				),
			);
			onView?.({ ...view, itemDetail: { ...detail, failed: true } });
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "item_detail",
						detail_state: "error",
						represented_fields: 1,
					}),
				),
			);
			await fireEvent.click(screen.getByRole("button", { name: "Shrink Pack" }));
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "item_detail",
						detail_state: "closed",
						represented_fields: 0,
					}),
				),
			);
		});
		it("keeps configured non-SRD vitals visible in the full sheet", async () => {
			signIn();
			const events: PlayObservation[] = [];
			playObservation.subscribe((event) => events.push(event));
			renderPlay({ view: configuredSheetView });
			await fireEvent.click(await screen.findByRole("button", { name: "Open You" }));
			const sheet = within(document.querySelector('[data-tile="hero"]') as HTMLElement);
			expect(sheet.getByText("Stress")).toBeTruthy();
			expect(sheet.getByText("Amber")).toBeTruthy();
			expect(sheet.getByText("Beacons restored")).toBeTruthy();
			expect(sheet.getByText("Return to the orbital station")).toBeTruthy();
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "hero_quest",
						detail_state: "ready",
						supplied_fields: 3,
						represented_fields: 3,
						disclosed_fields: 2,
					}),
				),
			);
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "hero_conditions",
						supplied_fields: 3,
						represented_fields: 3,
						disclosed_fields: 1,
					}),
				),
			);
			await fireEvent.click(sheet.getByText("Fatigue"));
			await waitFor(() =>
				expect(events).toContainEqual(
					expect.objectContaining({
						surface: "hero_conditions",
						supplied_fields: 3,
						represented_fields: 3,
						disclosed_fields: 3,
					}),
				),
			);
			const conditionDialog = within(await screen.findByRole("dialog", { name: "Fatigue" }));
			expect(conditionDialog.getByText("Stacks")).toBeTruthy();
			expect(conditionDialog.getByText("3")).toBeTruthy();
			expect(conditionDialog.getByText("Expires at world tick")).toBeTruthy();
			expect(conditionDialog.getByText("1200")).toBeTruthy();
			await fireEvent.click(screen.getByRole("button", { name: "Close" }));
		});
		it("You: opens the full sheet with the six abilities and their modifiers", async () => {
			signIn();
			renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);

			await fireEvent.click(await screen.findByRole("button", { name: "Open You" }));
			const heroTile = document.querySelector('[data-tile="hero"]');
			expect(heroTile?.getAttribute("data-zoom")).toBe("stage");
			const abilities = heroTile?.querySelector('[data-testid="hero-abilities"]');
			expect(abilities).toBeTruthy();
			expect(within(abilities as HTMLElement).getByText("STR")).toBeTruthy();
			expect(within(abilities as HTMLElement).getByText("+3")).toBeTruthy();
			for (const name of ["Human", "Fighter", "Soldier"]) {
				expect(screen.getByRole("button", { name })).toBeTruthy();
			}
			expect(screen.getByText("Athletics")).toBeTruthy();
		});

		it("Pack: opens the pack list with the longsword's own detail and verbs", async () => {
			signIn();
			renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);

			await fireEvent.click(await screen.findByRole("button", { name: "Open Pack" }));
			const packTile = document.querySelector('[data-tile="pack"]');
			expect(packTile?.getAttribute("data-zoom")).toBe("stage");
			// The Longsword is the pack's first item, so it is the default
			// selection with no click needed — matching `sampleView.itemDetail`.
			expect(within(packTile as HTMLElement).getByText("Main Hand")).toBeTruthy();
			expect(within(packTile as HTMLElement).getByText("Damage")).toBeTruthy();
			expect(within(packTile as HTMLElement).queryByRole("button", { name: "Unequip" })).toBeNull();
			await fireEvent.click(
				within(packTile as HTMLElement).getByRole("button", { name: /Longsword/ }),
			);
			expect(
				within(screen.getByTestId("play-dock")).getByRole("button", { name: /Unequip/ }),
			).toBeTruthy();
		});

		it("Pack: unrelated combat offers do not create an item-specific Table link", async () => {
			signIn();
			const play = renderPlay({ view: brawlView });
			await fireEvent.click(await screen.findByRole("button", { name: "Open Pack" }));
			expect(
				screen.queryByRole("button", { name: "Actions against other targets · Table" }),
			).toBeNull();
			expect(play.act).not.toHaveBeenCalled();
		});

		it("Pack: joins contextual offers by entity identity and dispatches once", async () => {
			signIn();
			const detail = sampleView.itemDetail;
			if (!detail) throw new Error("expected sample item detail");
			const contextual = {
				id: "h:calibrate",
				label: "Calibrate",
				verb: "manipulate",
				descriptor: "orbital/calibrate",
				targetRef: "entity:authorized-item-42",
				targetName: "Longsword",
				acceptsUtterance: false,
			};
			const { act } = renderPlay({
				view: {
					...sampleView,
					itemDetail: { ...detail, entityId: "authorized-item-42" },
					actions: [...sampleView.actions, contextual, ...detail.verbs],
				},
			});
			await fireEvent.click(await screen.findByRole("button", { name: "Open Pack" }));
			const pack = within(document.querySelector('[data-tile="pack"]') as HTMLElement);
			expect(pack.queryByRole("button", { name: "Unequip" })).toBeNull();
			const sword = pack.getByRole("button", { name: /Longsword/ });
			await fireEvent.click(sword);
			expect(act).not.toHaveBeenCalled();
			const dock = within(screen.getByTestId("play-dock"));
			expect(dock.getAllByRole("button", { name: /Unequip/ })).toHaveLength(1);
			expect(dock.getByRole("button", { name: /Calibrate/ }).textContent).toContain("1");
			await fireEvent.keyDown(sword, { key: "1" });
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			expect(act.mock.calls[0]?.[0]).toMatchObject({ id: contextual.id });
			await fireEvent.click(pack.getByRole("button", { name: "Torch" }));
			expect(dock.queryByRole("button", { name: /Calibrate/ })).toBeNull();
		});

		it("Pack: opening the tile to stage requests the pre-selected first item's detail without a click (verifier finding: 'Loading…' stuck until the player clicked)", async () => {
			signIn();
			const { selectItem } = renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);

			await fireEvent.click(await screen.findByRole("button", { name: "Open Pack" }));

			// Longsword is the pack's first item and Pack.svelte's own fallback
			// selection — the read must fire for it with no click, not only once
			// the player picks a row.
			await waitFor(() => expect(selectItem).toHaveBeenCalledOnce());
			expect(selectItem).toHaveBeenCalledWith({
				id: "12",
				name: "Longsword",
				handle: "i:12",
				rev: "p12",
			});
		});

		it("Pack: selecting a different item runs the on-demand item_detail + affordance_actions read through the session (sk-jay0.1.8.6 App.svelte wiring)", async () => {
			signIn();
			const { selectItem } = renderPlay({ view: sampleView });
			await waitFor(() =>
				expect(screen.getByRole("heading", { level: 3, name: "Common Room" })).toBeTruthy(),
			);

			await fireEvent.click(await screen.findByRole("button", { name: "Open Pack" }));
			// Opening the tile already auto-requested the Longsword (the test
			// above) — wait for that first call before it is superseded.
			await waitFor(() => expect(selectItem).toHaveBeenCalledOnce());

			await fireEvent.click(await screen.findByRole("button", { name: "Torch" }));

			await waitFor(() => expect(selectItem).toHaveBeenCalledTimes(2));
			expect(selectItem).toHaveBeenNthCalledWith(2, {
				id: "14",
				name: "Torch",
				handle: "i:14",
				rev: "p14",
			});
		});
	});

	describe("the dock's selection chip caps its own width (sk-jay0.1.8.17, retargeted at the hotbar chip)", () => {
		// jsdom has no layout engine (ledger/designs/play-zoomed-table.md,
		// "Test method for 'no page scroll'": "jsdom does not lay out"), so
		// this suite can't measure the chip's actual pixel rects the way a
		// real browser can. What jsdom CAN check deterministically is the CSS
		// contract a screenshot proved correct — read from the actual
		// `.play-dock__chip`/`.play-dock__chip-name` declarations the dock's
		// row 1 ships, not a hardcoded pixel snapshot, so a future edit that
		// weakens it fails here too.
		const stylesCssPath = resolve(import.meta.dirname, "styles.css");
		const stylesCss = readFileSync(stylesCssPath, "utf8");

		function baseRule(selector: string): string {
			const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const match = stylesCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
			if (match === null) throw new Error(`styles.css: no rule found for "${selector}"`);
			return match[1] ?? "";
		}

		it("caps the chip's own width instead of letting it push its row's neighbours out of the dock", () => {
			// The bug: the chip was `flex: 0 0 auto` with no `max-width` — a
			// long name took its full intrinsic width regardless of the row's
			// own, pushing the input and Send button outside the dock.
			// `max-width` plus `overflow: hidden; text-overflow: ellipsis` on
			// both the name and its InfoLink button gives the chip an upper bound it can never cross,
			// whatever the world names it.
			const chip = baseRule(".play-dock__chip");
			// Q3 (sk-jay0.1.8, round 3): an absolute cap, not a share of the
			// row — a wide stage row's own 40% still left a long name eating a
			// third of it. `rem`, not `%`.
			const maxWidth = chip.match(/max-width:\s*([\d.]+)rem/);
			expect(maxWidth, "the chip needs an absolute max-width cap").not.toBeNull();
			expect(Number(maxWidth?.[1])).toBeLessThanOrEqual(12);
			expect(chip).toMatch(/min-width:\s*0/);
			const name = baseRule(".play-dock__chip-name");
			expect(name).toMatch(/overflow:\s*hidden/);
			expect(name).toMatch(/text-overflow:\s*ellipsis/);
			expect(name).toMatch(/white-space:\s*nowrap/);
			const link = baseRule(".play-dock__chip > .info-link");
			expect(link).toMatch(/flex:\s*1\s+1\s+auto/);
			expect(link).toMatch(/min-width:\s*0/);
			expect(link).toMatch(/overflow:\s*hidden/);
			expect(link).toMatch(/text-overflow:\s*ellipsis/);
		});

		it("keeps the long selected name in the DOM and its accessible title even though the chip truncates visually", async () => {
			// The ellipsis is CSS-only: the name span's own text content (what
			// a screen reader announces) and its `title` (what a mouse hover
			// shows) both still carry the world's full name, never a
			// client-truncated string.
			signIn();
			renderPlay({ view: talkView });
			// Aldwin is the dialogue's own speaker, not automatically the
			// dock's selection (axiom A4: the composer follows HIM without a
			// selection, but the CHIP shows the global selection) — select him
			// so his long name reaches the chip.
			await fireEvent.click(
				(
					await screen.findAllByRole("button", {
						name: "Aldwin, keeper of the hearth-ledger details",
					})
				)[0] as HTMLElement,
			);
			const name = document.querySelector(".play-dock__chip-name");
			expect(name?.textContent?.trim()).toBe("Aldwin, keeper of the hearth-ledger");
			expect(name?.getAttribute("title")).toBe("Aldwin, keeper of the hearth-ledger");
		});
	});

	describe("public reference links reach every prose line of the Table stream (sk-jay0.1.8.63.6)", () => {
		it("links a vocabulary term inside an activity's own outcome, while its heading — an action label — stays plain even for a term it also contains", async () => {
			clearReferenceVocabularyCache();
			const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(
					JSON.stringify({
						version: 1,
						targets: [
							{
								label: "Longsword",
								kind: "item",
								ref: "item/longsword",
								href: "/docs/items/longsword",
							},
							{ label: "Aldwin", kind: "npc", ref: "npc/aldwin", href: "/docs/npc/aldwin" },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			signIn();
			const { act } = renderPlay({
				actResult: "You notice the Longsword propped against the wall.",
			});
			const dock = within(await screen.findByTestId("play-dock"));
			// His own action needs him selected first (axiom A1).
			await fireEvent.click(
				(
					await screen.findAllByRole("button", {
						name: "Aldwin, keeper of the hearth-ledger details",
					})
				)[0] as HTMLElement,
			);
			const ask = await dock.findByRole("button", { name: /Ask Aldwin About Advancement/ });
			await fireEvent.click(ask);
			await waitFor(() => expect(act).toHaveBeenCalledOnce());

			const row = document.querySelector('li[data-activity-id="local:0"]') as HTMLElement;
			expect(row).toBeTruthy();
			// The body earns the reading-aid link…
			expect(await within(row).findByRole("button", { name: "Longsword" })).toBeTruthy();
			// …but the heading is the action's own label, not prose — it stays
			// plain text even though "Aldwin" is also a vocabulary term.
			expect(within(row).getByText("Ask Aldwin About Advancement").tagName).toBe("P");
			expect(within(row).queryByRole("button", { name: "Aldwin" })).toBeNull();
			fetchMock.mockRestore();
		});

		// Aldwin's own occupant card (`occupant:4`, sk-jay0.1.8.63.10) never
		// carries the public reference directly any more — that lives one
		// level deeper, behind the card's own "Full definition" link to
		// `def:<defId>`, so his occupant record needs a `defId` and an
		// on-demand detail read for the card to resolve at all (never left
		// stuck "Loading…", which is what an unset `occupantDetail` produces
		// — the on-demand read this test's `selectOccupant` mock never
		// answers on its own).
		const aldwinDetail = {
			id: "4",
			handle: "s:actor:4",
			rev: "a4",
			entityId: "4",
			defId: "npc/aldwin",
			description: "The hearth-keeper, watchful and dry-humoured.",
			facts: [],
			verbs: [],
		};

		it("opens Aldwin's own name in the place row as an occupant card, whose own 'Full definition' link opens the matching vocabulary term (sk-jay0.1.8.63.7/.10)", async () => {
			clearReferenceVocabularyCache();
			// The compendium's own title deliberately differs from the
			// occupant's in-world name — the occupant card and its nested
			// definition card are both mounted at once (the stack keeps its
			// whole open path), so a query needs to tell them apart.
			const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
				new Response(
					JSON.stringify({
						version: 1,
						targets: [
							{
								label: "Aldwin — Compendium Entry",
								kind: "npc",
								ref: "npc/aldwin",
								href: "/docs/npc/aldwin",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
			);
			signIn();
			renderPlay({ view: { ...sampleView, speech: [], occupantDetail: aldwinDetail } });
			const heading = await screen.findByRole("heading", { level: 4, name: "Common Room" });
			const row = heading.closest("li") as HTMLElement;
			expect(row).toBeTruthy();
			// One link per name: Aldwin's own name is now the entity's own
			// information card, never a second, competing reference-preview
			// trigger.
			const nameButton = await within(row).findByRole("button", {
				name: "Aldwin, keeper of the hearth-ledger details",
			});
			await fireEvent.click(nameButton);
			const occupantCard = await screen.findByRole("dialog", {
				name: "Aldwin, keeper of the hearth-ledger",
			});
			const fullDefinition = await within(occupantCard).findByRole("button", {
				name: "Full definition",
			});
			await fireEvent.click(fullDefinition);
			await screen.findByRole("dialog", { name: "Aldwin — Compendium Entry" });
			const fullReference = await screen.findByRole("link", { name: /Full reference/ });
			expect(fullReference.getAttribute("href")).toBe("https://spellkave.com/docs/npc/aldwin");
			fetchMock.mockRestore();
		});

		it("leaves the stream's prose byte-identical when the public vocabulary is unavailable", async () => {
			clearReferenceVocabularyCache();
			const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
			signIn();
			const { act } = renderPlay({
				view: { ...sampleView, occupantDetail: aldwinDetail },
				actResult: "You notice the Longsword propped against the wall.",
			});
			const dock = within(await screen.findByTestId("play-dock"));
			await fireEvent.click(
				(
					await screen.findAllByRole("button", {
						name: "Aldwin, keeper of the hearth-ledger details",
					})
				)[0] as HTMLElement,
			);
			const ask = await dock.findByRole("button", { name: /Ask Aldwin About Advancement/ });
			await fireEvent.click(ask);
			await waitFor(() => expect(act).toHaveBeenCalledOnce());

			const row = document.querySelector('li[data-activity-id="local:0"]') as HTMLElement;
			await waitFor(() =>
				expect(
					within(row).getByText("You notice the Longsword propped against the wall."),
				).toBeTruthy(),
			);
			expect(within(row).queryByRole("button")).toBeNull();

			const heading = await screen.findByRole("heading", { level: 4, name: "Common Room" });
			const placeRow = heading.closest("li") as HTMLElement;
			// Aldwin's own name still opens his occupant card even with the
			// public vocabulary feed offline (that card never depended on it —
			// it is built entirely from the on-demand scene-detail read).
			const nameButton = await within(placeRow).findByRole("button", {
				name: "Aldwin, keeper of the hearth-ledger details",
			});
			expect(visibleText(placeRow)).toContain("Aldwin, keeper of the hearth-ledger is nearby");
			await fireEvent.click(nameButton);
			const occupantCard = await screen.findByRole("dialog", {
				name: "Aldwin, keeper of the hearth-ledger",
			});
			// The occupant card still offers its "Full definition" link (a
			// world-known defId, never vocabulary-dependent) — only opening
			// THAT one, one level deeper, is what an offline feed leaves
			// not-found.
			const fullDefinition = await within(occupantCard).findByRole("button", {
				name: "Full definition",
			});
			await fireEvent.click(fullDefinition);
			await waitFor(() => expect(screen.getByText("Not found.")).toBeTruthy());
			expect(screen.queryByRole("link", { name: /Full reference/ })).toBeNull();
			fetchMock.mockRestore();
		});
	});

	describe("the Table stream's ⋯ action menu collapses generic checks behind one 'Checks' submenu (sk-jay0.1.8.63.9/.10)", () => {
		it("classifies a verb into the secondary group by its own descriptor family, never its label", async () => {
			signIn();
			const helpAldwin = {
				id: "h:help-aldwin",
				label: "Help",
				verb: "manipulate",
				descriptor: "srd/help",
				targetName: "Aldwin, keeper of the hearth-ledger",
				targetRef: "entity:4",
				acceptsUtterance: false,
			};
			// A generic-check verb whose LABEL carries no "check" wording at
			// all — only its `descriptor` family (`srd/check`) marks it as
			// one. If the split ever regressed to matching a label prefix
			// instead, this row would wrongly stay primary.
			const balanceAldwin = {
				id: "h:acrobatics-aldwin",
				label: "Balance",
				verb: "manipulate",
				descriptor: "srd/check/acrobatics",
				targetName: "Aldwin, keeper of the hearth-ledger",
				targetRef: "entity:4",
				acceptsUtterance: false,
			};
			const { act } = renderPlay({
				view: {
					...sampleView,
					speech: [],
					actions: [...sampleView.actions, helpAldwin, balanceAldwin],
				},
			});
			// His own actions need him selected first (axiom A1) — the ⋯ menu
			// that used to sit next to a name is gone; the SELECTION group's
			// own "Checks" submenu (`groupFromActions`, `../lib/dock-hotbar.ts`)
			// takes over the same classification job.
			await fireEvent.click(
				(
					await screen.findAllByRole("button", {
						name: "Aldwin, keeper of the hearth-ledger details",
					})
				)[0] as HTMLElement,
			);
			const dock = within(await screen.findByTestId("play-dock"));
			// The meaningful verb stays flat and reachable immediately…
			expect(await dock.findByRole("button", { name: /Help/ })).toBeTruthy();
			// …while the check is collapsed behind one "Checks" submenu the
			// player opts into (never a flat second entry beside it).
			expect(dock.queryByRole("button", { name: "Balance" })).toBeNull();
			await fireEvent.keyDown(
				dock.getByRole("button", { name: "More for Aldwin, keeper of the hearth-ledger" }),
				{ key: "Enter" },
			);
			await fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Checks" }), {
				key: "Enter",
			});
			await fireEvent.click(await screen.findByRole("menuitem", { name: "Balance" }));
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			expect(act.mock.calls[0]?.[0]).toMatchObject({ id: "h:acrobatics-aldwin" });
		});

		it("a name click in the stream selects and opens the card, never a second act surface of its own", async () => {
			signIn();
			renderPlay({
				view: {
					...sampleView,
					occupantDetail: {
						id: "4",
						handle: "s:actor:4",
						rev: "a4",
						entityId: "4",
						description: "The hearth-keeper, watchful and dry-humoured.",
						facts: [],
						verbs: [],
					},
				},
			});
			// Aldwin's own seeded speech line (sampleView) turns into a burst
			// heading — present, so it is an `InfoLink`, and (W5) clicking it
			// both opens his card AND selects him globally, exactly like the
			// place row's own company mention does; no name anywhere in the
			// stream carries an act surface of its own (axiom A1) — the dock
			// is the only place that acts.
			const heading = await screen.findByRole("heading", {
				level: 3,
				name: "Aldwin, keeper of the hearth-ledger details",
			});
			const burstRow = heading.closest("li");
			if (burstRow === null) throw new Error("expected the burst heading inside a stream row");
			expect(within(burstRow).queryByRole("button", { name: /^Actions for/ })).toBeNull();
			await fireEvent.click(within(burstRow).getByRole("button", { name: /Aldwin/ }));
			expect(
				await screen.findByRole("dialog", { name: "Aldwin, keeper of the hearth-ledger" }),
			).toBeTruthy();
			expect(
				await screen.findByRole("group", { name: "Aldwin, keeper of the hearth-ledger" }),
			).toBeTruthy();
		});

		it("an open info card does not swallow the digits; Escape closes the card before it clears the selection", async () => {
			// Found live 2026-09-19: a name click selects AND opens the card, and
			// the digit pressed next did nothing, because the card counted as an
			// overlay that owns the keyboard.
			signIn();
			const { act } = renderPlay({
				view: {
					...sampleView,
					occupantDetail: {
						id: "4",
						handle: "s:actor:4",
						rev: "a4",
						entityId: "4",
						description: "The hearth-keeper, watchful and dry-humoured.",
						facts: [],
						verbs: [],
					},
				},
			});
			const heading = await screen.findByRole("heading", {
				level: 3,
				name: "Aldwin, keeper of the hearth-ledger details",
			});
			await fireEvent.click(
				within(heading.closest("li") as HTMLElement).getByRole("button", { name: /Aldwin/ }),
			);
			await screen.findByRole("dialog", { name: "Aldwin, keeper of the hearth-ledger" });
			const group = await screen.findByRole("group", {
				name: "Aldwin, keeper of the hearth-ledger",
			});
			const first = within(group).getAllByRole("button")[0] as HTMLElement;
			const takesWords = first.getAttribute("aria-pressed") !== null;

			await fireEvent.keyDown(window, { key: "1" });
			if (takesWords) {
				await waitFor(() => expect(document.activeElement?.id).toBe("play-dock-say"));
			} else {
				await waitFor(() => expect(act).toHaveBeenCalled());
			}

			// Escape with the card open is the card's own: the selection stays.
			await fireEvent.keyDown(window, { key: "Escape" });
			expect(
				screen.getByRole("group", { name: "Aldwin, keeper of the hearth-ledger" }),
			).toBeTruthy();
		});
	});

	describe("the dock's own information links (sk-jay0.1.8.63.10)", () => {
		it("opens the place name and a hero condition chip as their own information cards", async () => {
			signIn();
			const view = {
				...sampleView,
				hero: {
					...sampleView.hero,
					conditions: ["srd/condition/poisoned"],
					conditionDetails: [
						{
							id: "srd/condition/poisoned",
							label: "Poisoned",
							description: "Disadvantage on attack rolls and ability checks.",
							stackCount: 1,
						},
					],
				},
			};
			renderPlay({ view });
			const dock = within(await screen.findByTestId("play-dock"));
			await fireEvent.click(await dock.findByRole("button", { name: "Common Room" }));
			const placeCard = await screen.findByRole("dialog", { name: "Common Room" });
			const placeDescription = sampleView.place?.description;
			if (placeDescription === undefined) throw new Error("sample fixture supplies a place");
			expect(within(placeCard).getByText(placeDescription)).toBeTruthy();

			await fireEvent.click(await dock.findByRole("button", { name: "Poisoned" }));
			const conditionCard = await screen.findByRole("dialog", { name: "Poisoned" });
			expect(
				within(conditionCard).getByText("Disadvantage on attack rolls and ability checks."),
			).toBeTruthy();
			expect(within(conditionCard).getByText("1")).toBeTruthy();
		});
	});
	// Last in the file on purpose: this beat ends with the map at stage
	// OUTSIDE a fight, which lazily imports `@spellkave/map-canvas` — and the
	// lazy-mount test above can only see that one-shot import happen once.
	describe("the layout offer after a fight (axiom A2)", () => {
		// Here, not beside the other A1 tests: it opens the Map at stage, and the
		// lazy-mount test above must see that one-shot import happen first.
		it("the Map tile carries no act palette; what the place offers is the dock's (axiom A1, sk-jay0.1.8.63.43)", async () => {
			const placeId = sampleView.place?.id ?? "";
			const search = {
				...(sampleView.actions[0] as PlayView["actions"][number]),
				id: "h:search-here",
				label: "Search the room",
				descriptor: "test/search-room",
				targetRef: `place_node:${placeId}`,
				targetName: "",
				provider: "place" as const,
				acceptsUtterance: false,
				slot: undefined,
			};
			signIn();
			renderPlay({ view: { ...sampleView, actions: [...sampleView.actions, search] } });
			await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
			const map = document.querySelector<HTMLElement>('[data-tile="map"]');
			expect(map?.getAttribute("data-zoom")).toBe("stage");
			expect(
				within(map as HTMLElement).queryByRole("button", { name: /Search the room/i }),
			).toBeNull();
			expect(
				within(screen.getByTestId("play-dock")).getByRole("button", { name: /Search the room/i }),
			).toBeTruthy();
		});

		it("fight over: only a player who took the map-first layout is offered the way back, to the arrangement they had", async () => {
			signIn();
			const { worldOpener } = renderPlay({ view: fightView });
			await takeFightLayoutOffer();
			const args = worldOpener.mock.calls[0]?.[0] as { onView: (view: PlayView) => void };
			args.onView(sampleView);
			await screen.findByText("Fight over.");
			// Still the fight's layout: leaving a fight resizes nothing either.
			expect(document.querySelector('[data-tile="map"]')?.getAttribute("data-zoom")).toBe("stage");
			await fireEvent.click(screen.getByRole("button", { name: "Back to exploring" }));
			await waitFor(() =>
				expect(document.querySelector('[data-tile="table"]')?.getAttribute("data-zoom")).toBe(
					"stage",
				),
			);
			expect(screen.queryByText("Fight over.")).toBeNull();
		});
	});

	describe("dogfood 2026-11-12 wiring (sk-jay0.1.8.92, .96, .99, .100, .101, .102)", () => {
		it("a name attempt sends the bare name and shows an activity row, never a JSON bubble", async () => {
			signIn();
			const context = placeDetailView.manipulationContext;
			if (context?.status !== "ready") throw new Error("fixture needs a ready context");
			const { act } = renderPlay({
				actResult: 'You say: "Brannoch"',
				view: {
					...placeDetailView,
					manipulationContext: {
						...context,
						actions: [
							...context.actions,
							{
								actionId: "fixture/name",
								displayName: "Name your character",
								communicationSpeechActId: "fixture/name",
								acceptsUtterance: true,
								input: {
									fields: [
										{
											name: "name",
											label: "Name",
											control: "text",
											required: true,
											channel: "utterance",
										},
									],
								},
								tags: [],
								selfOnly: false,
								selfEligible: false,
							},
						],
					},
				},
			});
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await fireEvent.input(input, { target: { value: "/" } });
			await fireEvent.keyDown(input, { key: "ArrowDown" });
			await fireEvent.click(screen.getByRole("option", { name: /Name your character/ }));
			await fireEvent.input(input, { target: { value: `${input.value} @` } });
			await fireEvent.keyDown(input, { key: "ArrowDown" });
			await fireEvent.click(screen.getByRole("option", { name: /Aldwin/ }));
			await fireEvent.input(input, { target: { value: `${input.value} name:"Brannoch"` } });
			await fireEvent.keyDown(input, { key: "Enter" });
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			// The utterance is the bare text; the structured value rides beside it.
			expect(act.mock.calls[0]?.[1]).toBe("Brannoch");
			expect(act.mock.calls[0]?.[3]).toEqual({ name: "Brannoch" });
			const stream = document.querySelector(".table-explore-stream") as HTMLElement;
			await waitFor(() => expect(within(stream).getByText("Name: Brannoch")).toBeTruthy());
			expect(within(stream).getByText("Name your character")).toBeTruthy();
			expect(stream.textContent).not.toContain("{");
			for (const line of Array.from(stream.querySelectorAll('[data-slot="explore-speech-line"]')))
				expect(line.textContent).not.toContain("Brannoch");
		});

		describe("owner decisions of 2026-11-12, batch 3 (sk-jay0.1.8.94, .95, .96, .99, .101)", () => {
			const context = placeDetailView.manipulationContext;
			if (context?.status !== "ready") throw new Error("fixture needs a ready context");
			const livePlace = placeDetailView.place;
			if (livePlace === null) throw new Error("fixture needs a place");
			// The world's generic answer slot: no name of its own, only the
			// authored response-slot marker.
			const slotView: PlayView = {
				...placeDetailView,
				manipulationContext: {
					...context,
					actions: [
						...context.actions,
						{
							actionId: "fixture/slot-2",
							displayName: "Answer 2",
							communicationSpeechActId: "fixture/slot-2",
							responseSlot: 2,
							tags: [],
							selfOnly: false,
							selfEligible: false,
						},
					],
				},
			};
			const downedIds = [...placeDetailView.hero.conditions, "srd/condition/unconscious"];
			// A live view (ready facts), so the dock mounts the one text box.
			const liveTalkView: PlayView = {
				...talkView,
				interactionOrigin: undefined,
				manipulationContext: context,
			};
			const downedTalkView: PlayView = {
				...liveTalkView,
				hero: {
					...talkView.hero,
					conditions: downedIds,
					conditionDetails: [{ id: "srd/condition/unconscious", label: "Unconscious" }],
				},
			};

			async function openFinder(text: string): Promise<string[]> {
				const input = await screen.findByRole<HTMLInputElement>("combobox");
				await fireEvent.input(input, { target: { value: text } });
				await fireEvent.keyDown(input, { key: "ArrowDown" });
				await tick();
				return screen.queryAllByRole("option").map((row) => row.textContent ?? "");
			}

			it("keeps a generic answer slot out of the finder until an open question names it", async () => {
				signIn();
				const { worldOpener } = renderPlay({ view: slotView });
				const rows = await openFinder("/");
				expect(rows.some((row) => /Inspect/.test(row))).toBe(true);
				expect(rows.some((row) => /Answer 2/.test(row))).toBe(false);
				// The question opens: the same slot is listed under the name it gives.
				const input = screen.getByRole<HTMLInputElement>("combobox");
				await fireEvent.keyDown(input, { key: "Escape" });
				await fireEvent.input(input, { target: { value: "" } });
				worldOpener.mock.calls[0]?.[0].onView({
					...slotView,
					manipulationContext: {
						...slotView.manipulationContext,
						revision: 2,
						prompts: [
							{
								occurrenceId: "fixture:prompt:1",
								promptDefId: "fixture/prompt",
								contractVersion: 1,
								sourceRef: "entity:4",
								responseActionIds: ["fixture/slot-2"],
								openedAtTick: 42,
								consumed: false,
								presentation: {
									question: "Which class calls to you?",
									labels: { "fixture/slot-2": "Wizard" },
								},
							},
						],
					},
				});
				await tick();
				await waitFor(async () => {
					const named = await openFinder("/");
					expect(named.some((row) => /Wizard/.test(row))).toBe(true);
					expect(named.some((row) => /Answer 2/.test(row))).toBe(false);
				});
			});

			it("lists a way out by its destination with the direction in the label, and sends it", async () => {
				signIn();
				const { move } = renderPlay({ view: placeDetailView });
				const input = await screen.findByRole<HTMLInputElement>("combobox");
				await openFinder("/go");
				await fireEvent.click(screen.getByRole("option", { name: /Go — Stairs \(southeast\)/ }));
				await waitFor(() => expect(input.value).toBe("/go-stairs"));
				expect(move).not.toHaveBeenCalled();
				await fireEvent.keyDown(input, { key: "Enter" });
				await waitFor(() => expect(move).toHaveBeenCalledOnce());
				expect(move.mock.calls[0]?.[0]).toMatchObject({ handle: "s:exit:1" });
			});

			it("a way-out click on one of two exits to the same place inserts the direction suffix", async () => {
				signIn();
				const [first, ...rest] = livePlace.exits;
				if (first === undefined) throw new Error("fixture needs a way out");
				const twin = { ...first, handle: "s:exit:twin", rev: "rt", label: "west" };
				const { move } = renderPlay({
					view: { ...placeDetailView, place: { ...livePlace, exits: [first, twin, ...rest] } },
				});
				const input = await screen.findByRole<HTMLInputElement>("combobox");
				const dock = within(await screen.findByTestId("play-dock"));
				await fireEvent.keyDown(dock.getByRole("button", { name: /\d+ ways? out/ }), {
					key: "Enter",
				});
				const items = within(await screen.findByRole("menu")).getAllByRole("menuitem");
				const westItem = items.find((item) => /west/i.test(item.textContent ?? ""));
				if (westItem === undefined) throw new Error("expected the west way out in the menu");
				await fireEvent.click(westItem);
				await waitFor(() => expect(input.value).toBe("/go-stairs-west"));
				// The other exit to the same place carries its direction too.
				await fireEvent.input(input, { target: { value: "" } });
				await openFinder("/go-stairs");
				expect(screen.getByRole("option", { name: /Go — Stairs \(west\)/ })).toBeTruthy();
				await fireEvent.click(screen.getByRole("option", { name: /Go — Stairs \(southeast\)/ }));
				await waitFor(() => expect(input.value).toBe("/go-stairs-southeast"));
				expect(move).not.toHaveBeenCalled();
			});

			it("reads Down above Talk while the hero is down, and says so in the composer", async () => {
				signIn();
				const { worldOpener } = renderPlay({ view: liveTalkView });
				const table = await screen.findByRole("region", { name: "Table" });
				expect(table.querySelector(".tile-mode")?.textContent).toBe("Talk");
				const talkGlyph = table.querySelector(".tile-icon path")?.getAttribute("d");
				const dock = (): string => screen.getByTestId("play-dock").textContent ?? "";
				expect(dock()).not.toContain("You are down and cannot act right now.");
				worldOpener.mock.calls[0]?.[0].onView(downedTalkView);
				await waitFor(() => expect(table.querySelector(".tile-mode")?.textContent).toBe("Down"));
				expect(table.querySelector(".tile-icon path")?.getAttribute("d")).not.toBe(talkGlyph);
				expect(dock()).toContain("You are down and cannot act right now.");
				// Going down adds no notice of its own.
				expect(dock()).not.toContain("Fight begins.");
				// The hero is helped up: the scene is Talk again.
				worldOpener.mock.calls[0]?.[0].onView(liveTalkView);
				await waitFor(() => expect(table.querySelector(".tile-mode")?.textContent).toBe("Talk"));
				expect(dock()).not.toContain("You are down and cannot act right now.");
			});

			it("keeps Fight above Down and tells going down as one stream line", async () => {
				signIn();
				renderPlay({
					view: { ...downedHeroView, interactionOrigin: undefined, manipulationContext: context },
				});
				const table = await screen.findByRole("region", { name: "Table" });
				expect(table.querySelector(".tile-mode")?.textContent).toBe("Fight");
				await waitFor(() =>
					expect(
						// One plain sentence, keyed on the world's unconscious
						// condition id (owner decision 2026-11-12; this pin used
						// to expect the folded list sentence).
						screen.getAllByText(playCopy.stream.fellUnconscious).length,
					).toBe(1),
				);
				expect(screen.queryByText(/You are now affected by Unconscious/)).toBeNull();
				expect(screen.queryByText("You are now affected by Incapacitated.")).toBeNull();
				expect(screen.getByTestId("play-dock").textContent).toContain(
					"You are down and cannot act right now.",
				);
			});
		});

		it("shows a downed hero as Unconscious on the You tile and hides the DM's workflow conditions", async () => {
			signIn();
			renderPlay({ view: downedHeroView });
			const hero = await waitFor(() => {
				const tile = document.querySelector<HTMLElement>('[data-tile="hero"]');
				if (tile === null) throw new Error("no You tile");
				return tile;
			});
			await waitFor(() =>
				expect(within(hero).getAllByText(/Unconscious/).length).toBeGreaterThan(0),
			);
			expect(hero.textContent).not.toMatch(/dm\/|creation|drafting/i);
		});

		it("links to the hosted full map by default, and drops the link and the site name when switched off", async () => {
			vi.stubEnv("VITE_SPELLKAVE_GATEWAY_URL", "https://mcp.spellkave.com");
			signIn();
			// Nothing set: the hosted build's case. The link must stay.
			renderPlay({ view: sampleView });
			await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
			await screen.findByTestId("fake-map-canvas");
			expect(screen.getByRole("link", { name: /Open the full map/ }).getAttribute("href")).toBe(
				"https://maps.spellkave.com/?world=demo1",
			);
			expect(screen.getByText(/whole world/i).textContent).toContain("maps.spellkave.com");
			cleanup();

			vi.stubEnv("VITE_SPELLKAVE_MAPS_URL", "off");
			renderPlay({ view: sampleView });
			await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
			await screen.findByTestId("fake-map-canvas");
			expect(screen.getByText(/whole world/i).textContent).not.toContain("maps.spellkave.com");
			expect(screen.queryByRole("link", { name: /Open the full map/ })).toBeNull();
			cleanup();

			vi.stubEnv("VITE_SPELLKAVE_MAPS_URL", "http://127.0.0.1:5174/");
			renderPlay({ view: sampleView });
			await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
			await screen.findByTestId("fake-map-canvas");
			expect(screen.getByRole("link", { name: /Open the full map/ }).getAttribute("href")).toBe(
				"http://127.0.0.1:5174/?world=demo1",
			);
			vi.unstubAllEnvs();
		});

		it.each([
			["blocked", "Not sent — your words are kept.", "Result unknown"],
			[
				"failed",
				"Result unknown — your words are kept; look around before you try again.",
				"Not sent",
			],
		] as const)("names a %s composer attempt by its own state on the status line", async (kind, phrase, absent) => {
			signIn();
			const context = placeDetailView.manipulationContext;
			if (context?.status !== "ready") throw new Error("fixture needs a ready context");
			const { act } = renderPlay({
				view: {
					...placeDetailView,
					manipulationContext: {
						...context,
						actions: [
							...context.actions,
							{
								actionId: "fixture/name",
								displayName: "Name your character",
								communicationSpeechActId: "fixture/name",
								acceptsUtterance: true,
								input: {
									fields: [
										{
											name: "name",
											label: "Name",
											control: "text",
											required: true,
											channel: "utterance",
										},
									],
								},
								tags: [],
								selfOnly: false,
								selfEligible: false,
							},
						],
					},
				},
			});
			const sentence = "Fill in “Name” first.";
			act.mockRejectedValueOnce(
				kind === "blocked" ? new PlayAttemptBlockedError(sentence) : new Error("The line dropped."),
			);
			const input = await screen.findByRole<HTMLInputElement>("combobox");
			await fireEvent.input(input, { target: { value: "/" } });
			await fireEvent.keyDown(input, { key: "ArrowDown" });
			await fireEvent.click(screen.getByRole("option", { name: /Name your character/ }));
			await fireEvent.input(input, { target: { value: `${input.value} @` } });
			await fireEvent.keyDown(input, { key: "ArrowDown" });
			await fireEvent.click(screen.getByRole("option", { name: /Aldwin/ }));
			await fireEvent.input(input, { target: { value: `${input.value} name:"Brannoch"` } });
			await fireEvent.keyDown(input, { key: "Enter" });
			await waitFor(() => expect(act).toHaveBeenCalledOnce());
			await waitFor(() =>
				expect(document.getElementById("play-shell-status")?.textContent).toContain(phrase),
			);
			const status = document.getElementById("play-shell-status")?.textContent ?? "";
			expect(status).not.toContain(absent);
			if (kind === "blocked") {
				// Nothing was sent, so the stream tells nothing about it.
				const stream = document.querySelector(".table-explore-stream") as HTMLElement;
				expect(status).toContain(sentence);
				expect(stream.textContent).not.toContain(sentence);
				expect(stream.textContent).not.toContain("Name your character");
			}
		});

		it("drops a destination selection on arrival, so the place just reached is not offered as a target", async () => {
			signIn();
			const currentPlace = sampleView.place;
			if (currentPlace === undefined || currentPlace === null) throw new Error("sample place");
			const view = {
				...sampleView,
				place: {
					...currentPlace,
					exits: [
						{
							handle: "s:exit:test",
							rev: "exit-rev",
							label: "north",
							to: "destination",
							toNodeId: "test/destination",
							toName: "Airlock",
							gates: [],
						},
					],
				},
			};
			const { move, worldOpener } = renderPlay({ view });
			const arrived = {
				...view,
				place: { ...currentPlace, id: "test/destination", name: "Airlock", exits: [] },
			};
			move.mockImplementation(async () => {
				worldOpener.mock.calls[0]?.[0].onView(arrived);
				return "You arrive at Airlock.";
			});
			await fireEvent.click(await screen.findByRole("button", { name: "Open Map" }));
			await fireEvent.click(await screen.findByRole("button", { name: "Select test map place" }));
			await fireEvent.click(await screen.findByRole("button", { name: "1 Travel to Airlock" }));
			await waitFor(() => expect(move).toHaveBeenCalledOnce());
			await waitFor(() =>
				expect(screen.getByTestId("fake-map-canvas").dataset.placeNodeId).toBe("test/destination"),
			);
			// With nothing selected the dock shows its HERE and ME groups; a
			// surviving selection of the own place would show that one group only.
			const dock = within(screen.getByTestId("play-dock"));
			await waitFor(() => expect(dock.getByRole("group", { name: "Me" })).toBeTruthy());
			// A deliberate click on the place the hero now stands in still selects.
			await fireEvent.click(screen.getByRole("button", { name: "Select test map place" }));
			await waitFor(() => expect(dock.queryByRole("group", { name: "Me" })).toBeNull());
		});
	});
});
