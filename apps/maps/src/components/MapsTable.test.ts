import { cleanup, fireEvent, render, screen, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MineWatchArgs } from "../lib/watch-view";
import MapCanvasStub from "./MapCanvasStub.svelte";
import MapsTable from "./MapsTable.svelte";

vi.mock("@spellkave/map-canvas", async (importOriginal) => {
	const orig = await importOriginal<Record<string, unknown>>();
	return { ...orig, MapCanvas: MapCanvasStub };
});

afterEach(() => {
	cleanup();
});

const loft = "kavemouth/inn/loft";
const limbo = "kavemouth/creation_limbo/station";

const mira = {
	entityId: "2",
	actorId: "2",
	name: "Mira",
	placeNodeId: loft,
	faction: null,
	description: null,
	conditions: [],
	states: [],
	art: null,
};

const torvald = {
	entityId: "1",
	actorId: "1",
	name: "Torvald Ironmark",
	placeNodeId: loft,
	faction: null,
	description: "A freshly created fighter.",
	conditions: [],
	states: [{ state_id: "srd/hp", display_name: "srd/hp", value: "12" }],
	art: null,
};

/** Off the map: the stub only reports `minePlaces` as drawable. */
const aldwin = {
	entityId: "4",
	actorId: "4",
	name: "Aldwin",
	placeNodeId: limbo,
	faction: null,
	description: null,
	conditions: [],
	states: [],
	art: null,
};

const javelin = (id: string) => ({
	entityId: id,
	name: "Javelin",
	placeNodeId: loft,
	holderEntityId: "1",
	holderName: "Torvald Ironmark",
	slotId: "",
	description: "A throwable spear.",
	states: [],
	tags: [],
	art: null,
});

const chainMail = {
	entityId: "156",
	name: "Chain Mail",
	placeNodeId: loft,
	holderEntityId: "1",
	holderName: "Torvald Ironmark",
	slotId: "srd/slot/chest",
	description: "Heavy interlocking rings.",
	states: [
		{ state_id: "srd/armor_ac_base", display_name: "srd/armor_ac_base", value: "16" },
		{ state_id: "srd/armor_str_required", display_name: "srd/armor_str_required", value: "13" },
		{ state_id: "srd/weight_lb10", display_name: "srd/weight_lb10", value: "550" },
		{ state_id: "srd/cost_cp", display_name: "srd/cost_cp", value: "7500" },
	],
	tags: ["armor"],
	art: null,
};

const watchArgs: MineWatchArgs = {
	slug: "kavemouth",
	places: [],
	mineEntityIds: [],
	overlay: true,
	occupancy: [
		{ entityId: "1", placeNodeId: loft, name: "Torvald Ironmark", mine: true },
		{ entityId: "2", placeNodeId: loft, name: "Mira", mine: false },
		{ entityId: "4", placeNodeId: limbo, name: "Aldwin", mine: false },
	],
	actors: [torvald, mira, aldwin],
	items: [
		javelin("159"),
		javelin("160"),
		javelin("161"),
		javelin("162"),
		javelin("163"),
		chainMail,
	],
	events: [],
	oldestTick: 1,
	latestTick: 1,
	cursorTick: 1,
	live: true,
	framePopulated: true,
	pause: () => {},
	play: () => {},
	scrub: () => {},
};

function renderTable(selectedEntityId = "1"): void {
	render(MapsTable, {
		props: {
			gatewayOrigin: "http://gateway.local",
			slug: "kavemouth",
			token: "t",
			// The stub reports these as the nodes the map can draw.
			minePlaces: [{ entityId: "1", placeNodeId: loft }],
			mineEntityIds: [],
			occupancyPlaces: watchArgs.occupancy,
			overlay: true,
			watchArgs,
			selectedEntityId,
		},
	});
}

async function openDrawer(selectedEntityId = "1"): Promise<void> {
	renderTable(selectedEntityId);
	await fireEvent.click(screen.getByTestId("inspect-details-toggle"));
}

function referenceGroup(label: string): HTMLElement {
	return screen.getByRole("region", { name: label });
}

describe("MapsTable drawer (sk-jay0.4.4.5)", () => {
	it("opens the person drawer from the rail card and shows the next density", async () => {
		await openDrawer();
		expect(screen.getByTestId("maps-drawer-entry")).toBeTruthy();
		expect(within(referenceGroup("Carrying")).getAllByText(/Javelin/).length).toBeGreaterThan(0);
		expect(referenceGroup("Also here")).toBeTruthy();
	});

	it("switches the drawer to the thing when a carried row is clicked — never two", async () => {
		await openDrawer();
		await fireEvent.click(
			within(referenceGroup("Carrying")).getByRole("link", { name: "Chain Mail" }),
		);
		expect(screen.queryByRole("region", { name: "Carrying" })).toBeNull();
		expect(referenceGroup("Held by")).toBeTruthy();
		expect(screen.getAllByText("Chain Mail").length).toBeGreaterThan(0);
	});

	it("Esc closes the drawer but keeps the rail card", async () => {
		await openDrawer();
		await fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByTestId("maps-drawer-entry")).toBeNull();
		expect(screen.getByTestId("maps-preview")).toBeTruthy();
	});

	it("the drawer close button closes too", async () => {
		await openDrawer();
		await fireEvent.click(screen.getByTestId("stub-drawer-close"));
		expect(screen.queryByTestId("maps-drawer-entry")).toBeNull();
	});
});

describe("MapsTable drawer body renders as a catalogue entry (sk-jay0.4.4.7)", () => {
	it("gives the person the docs chrome, description and readable fields", async () => {
		await openDrawer();
		const entry = screen.getByTestId("maps-drawer-entry");
		expect(within(entry).getByTestId("entry-heading-ref").textContent).toContain("Person");
		expect(within(entry).getByTestId("entry-heading-ref").textContent).toContain("entity:1");
		expect(within(entry).getByTestId("description-rendered").textContent).toContain(
			"A freshly created fighter.",
		);
		const fields = within(entry).getByTestId("field-list");
		expect(within(fields).getByText("Hit points")).toBeTruthy();
		expect(referenceGroup("Place")).toBeTruthy();
	});

	it("shows the thing's armor numbers with labels and units, and the holder as a link", async () => {
		renderTable();
		await fireEvent.click(screen.getByTestId("inspect-details-toggle"));
		await fireEvent.click(
			within(referenceGroup("Carrying")).getByRole("link", { name: "Chain Mail" }),
		);
		const entry = screen.getByTestId("maps-drawer-entry");
		expect(within(entry).getByTestId("entry-heading-ref").textContent).toContain("Thing");
		const fields = within(entry).getByTestId("field-list");
		for (const [label, value] of [
			["Equipped", "chest"],
			["Armor class", "16"],
			["Strength required", "13"],
			["Weight", "55 lb"],
			["Cost", "75 gp"],
		]) {
			expect(within(fields).getByText(label as string)).toBeTruthy();
			expect(within(fields).getByText(value as string)).toBeTruthy();
		}
		const holder = within(referenceGroup("Held by")).getByRole("link", {
			name: "Torvald Ironmark",
		});
		expect(holder.getAttribute("href")).toContain("/w/kavemouth/person/1");
	});

	it("routes a carried link through the Maps locator, not the docs catalogue", async () => {
		await openDrawer();
		const link = within(referenceGroup("Carrying")).getByRole("link", { name: "Chain Mail" });
		expect(link.getAttribute("href")).toContain("/w/kavemouth/thing/156");
		await fireEvent.click(link);
		expect(window.location.pathname).toBe("/w/kavemouth/thing/156");
	});

	it("explains an off-map place instead of linking it", async () => {
		await openDrawer("4");
		const place = referenceGroup("Place");
		expect(within(place).queryByRole("link")).toBeNull();
		expect(place.textContent).toContain("not drawn on this map");
	});
});
