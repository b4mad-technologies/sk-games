import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hotbar, HotbarGroup } from "../lib/dock-hotbar";
import PlayDock from "./PlayDock.svelte";

function group(overrides: Partial<HotbarGroup> & Pick<HotbarGroup, "id" | "label">): HotbarGroup {
	return { key: null, slots: [], more: [], ...overrides };
}

const noSelectionHotbar: Hotbar = {
	chip: null,
	answers: null,
	selection: [],
	here: group({
		id: "here",
		label: "Here",
		slots: [
			{ id: "a:look", label: "Look", descriptor: "look", acceptsUtterance: false, dimmed: false },
		],
	}),
	me: group({
		id: "me",
		label: "Me",
		slots: [
			{
				id: "a:dodge",
				label: "Dodge",
				descriptor: "dodge",
				acceptsUtterance: false,
				dimmed: false,
			},
		],
	}),
};

const baseProps = {
	heroHp: 32,
	heroAc: 15,
	heroConditions: [{ id: "srd/condition/poisoned", label: "Poisoned" }],
	placeId: "hamlet/gate",
	placeName: "Hamlet Gate",
	exits: [],
	onChooseExit: () => {},
	hotbar: noSelectionHotbar,
	slotKeys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
	onSlot: () => {},
	onEndTurn: () => {},
	composerLabel: "Say or do something — Look (to the room)",
	composerPlaceholder: "Say or do something — Look (to the room)",
	composerDisabled: false,
	onSay: () => {},
	onAcceptReply: () => {},
	onClearSelection: () => {},
	busy: false,
};

afterEach(async () => {
	// bits-ui menus restore focus on a timeout; let it run while jsdom lives.
	await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("PlayDock exits menu", () => {
	it("opens the menu with both exits (menu names the structured exit count) and hands the handle to onChooseExit", async () => {
		const onChooseExit = vi.fn();
		render(PlayDock, {
			...baseProps,
			exits: [
				{ handle: "exit:1", direction: "north", name: "Village Square" },
				{ handle: "exit:2", direction: "", name: "Cellar Stair" },
			],
			onChooseExit,
		});

		const trigger = screen.getByRole("button", { name: "2 ways out" });
		expect(trigger).toBeTruthy();
		await fireEvent.keyDown(trigger, { key: "Enter" });
		const menu = await screen.findByRole("menu");

		const villageSquare = within(menu).getByText("Village Square").closest('[role="menuitem"]');
		expect(villageSquare).toBeTruthy();
		expect(within(menu).getByText("Cellar Stair")).toBeTruthy();
		expect(within(menu).getByText("north")).toBeTruthy();

		if (villageSquare === null) throw new Error("Village Square menu item is missing");
		await fireEvent.click(villageSquare);
		expect(onChooseExit).toHaveBeenCalledWith("exit:1");
	});

	it("renders '0 ways out' with no menu when there are no exits", () => {
		render(PlayDock, { ...baseProps, exits: [] });
		expect(screen.getByText("0 ways out")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Ways out" })).toBeNull();
	});
});

describe("PlayDock reaction row", () => {
	it("keeps a recorded dialogue prompt reachable without restoring ordinary action groups", async () => {
		const onSlot = vi.fn();
		const promptHotbar: Hotbar = {
			...noSelectionHotbar,
			answers: group({
				id: "answers",
				label: "1 answer · Aldwin",
				slots: [
					{
						id: "dialogue:fighter",
						label: "Fighter",
						descriptor: "answer:1",
						acceptsUtterance: false,
						dimmed: false,
					},
				],
			}),
		};
		render(PlayDock, {
			...baseProps,
			exits: [],
			hotbar: promptHotbar,
			onSlot,
		});

		await fireEvent.click(screen.getByRole("button", { name: "1 Fighter" }));
		expect(onSlot).toHaveBeenCalledWith("dialogue:fighter");
		expect(screen.queryByRole("group", { name: "Here" })).toBeNull();
	});

	it("uses the recorded-action bridge only when an imported view has no factored context", () => {
		render(PlayDock, { ...baseProps, exits: [], legacyActionFallback: true });

		expect(screen.getByRole("group", { name: "Here" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "1 Look" })).toBeTruthy();
	});

	it("keeps place and condition orientation as information links", () => {
		render(PlayDock, { ...baseProps, exits: [] });

		expect(screen.getByRole("button", { name: "Hamlet Gate" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Poisoned" })).toBeTruthy();
	});

	it("keeps ordinary action offers out of the dock", () => {
		render(PlayDock, { ...baseProps, exits: [] });

		expect(screen.queryByRole("group", { name: "Here" })).toBeNull();
		expect(screen.queryByRole("button", { name: "1 Look" })).toBeNull();
		expect(screen.getByText("HP 32 · AC 15")).toBeTruthy();
	});

	it("shows an urgent world-held answer window and sends only its selected answer", async () => {
		const onSlot = vi.fn();
		render(PlayDock, {
			...baseProps,
			exits: [],
			onSlot,
			urgent: {
				text: "The cellar rat lunges.",
				remainingMs: null,
				answers: [{ id: "reaction:dodge", label: "Dodge", key: "1", dimmed: false }],
			},
		});

		await fireEvent.click(screen.getByRole("button", { name: "1 Dodge" }));
		expect(onSlot).toHaveBeenCalledWith("reaction:dodge");
	});
});

describe("PlayDock status row (row 3): no answers, next-step pills or More… any more", () => {
	it("renders no next-step or More… controls in the status row", () => {
		render(PlayDock, { ...baseProps, exits: [] });
		expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
	});

	it("renders the caller's notice", () => {
		render(PlayDock, {
			...baseProps,
			exits: [],
			notice: { text: "The world is still thinking…" },
		});

		expect(screen.getByText("The world is still thinking…")).toBeTruthy();
	});

	it("renders no notice when the caller supplies none", () => {
		render(PlayDock, { ...baseProps, exits: [] });
		expect(document.querySelector('[data-slot="dock-notice"]')).toBeNull();
	});
});

it("leaves HP and AC out of the You status while the hero is drafted (sk-jay0.1.8.102)", () => {
	render(PlayDock, { ...baseProps, heroHp: undefined, heroAc: undefined, heroDrafting: true });
	const you = screen.getByRole("group", { name: "You status" });
	expect(you.textContent).not.toMatch(/HP|AC/);
	// The hero's conditions still show.
	expect(within(you).getByRole("button", { name: "Poisoned" })).toBeTruthy();
});

it("groups typed status by tile topic without shared pills", () => {
	render(PlayDock, baseProps);
	const you = screen.getByRole("group", { name: "You status" });
	const place = screen.getByRole("group", { name: "Place status" });
	expect(within(you).getByText("HP 32 · AC 15")).toBeTruthy();
	expect(within(you).getByRole("button", { name: "Poisoned" })).toBeTruthy();
	expect(within(place).getByRole("button", { name: "Hamlet Gate" })).toBeTruthy();
	expect(you.querySelector(".rounded-full")).toBeNull();
});
