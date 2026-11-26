import { render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import MapTile from "./MapTile.svelte";

vi.mock("@spellkave/map-canvas", async () => {
	const mod = await import("../test/FakeMapCanvas.svelte");
	return { MapCanvas: mod.default, Radar: mod.default };
});

const occupancy = [{ entityId: "1", placeNodeId: "demo/hall", name: "Renn", mine: false }];

const watch = {
	overlay: true,
	places: [],
	mineEntityIds: ["1"],
	occupancy,
	actors: [],
	events: [],
	oldestTick: 0,
	latestTick: 1,
	cursorTick: 1,
	live: true,
	pause: () => {},
	play: () => {},
	scrub: () => {},
};

describe("MapTile overlay gate", () => {
	it("does not mount occupancy pins or the radar timeline when overlay is false", async () => {
		render(MapTile, {
			open: true,
			mode: "full",
			gatewayOrigin: "https://gw.example",
			slug: "demo",
			token: "tok",
			mapHref: "https://maps.example",
			overlay: false,
			occupancyPlaces: occupancy,
			watch,
		});
		await waitFor(() => {
			expect(screen.getByTestId("fake-map-canvas")).toBeTruthy();
		});
		const canvas = screen.getByTestId("fake-map-canvas");
		expect(canvas.getAttribute("data-overlay")).toBe("false");
		expect(canvas.getAttribute("data-occupancy-count")).toBe("0");
		expect(screen.queryByTestId("maps-radar")).toBeNull();
	});

	it("mounts occupancy pins and the radar timeline when overlay is true", async () => {
		render(MapTile, {
			open: true,
			mode: "full",
			gatewayOrigin: "https://gw.example",
			slug: "demo",
			token: "tok",
			mapHref: "https://maps.example",
			overlay: true,
			occupancyPlaces: occupancy,
			watch,
		});
		await waitFor(() => {
			expect(screen.getByTestId("fake-map-canvas")).toBeTruthy();
		});
		const canvas = screen.getByTestId("fake-map-canvas");
		expect(canvas.getAttribute("data-overlay")).toBe("true");
		expect(canvas.getAttribute("data-occupancy-count")).toBe("1");
		expect(screen.getByTestId("maps-radar")).toBeTruthy();
	});
});

describe("MapTile hero seat (sk-jay0.1.8.100)", () => {
	const base = {
		open: true,
		gatewayOrigin: "https://gw.example",
		slug: "demo",
		token: "tok",
		mapHref: null,
	} as const;

	it.each([
		"medium",
		"full",
	] as const)("passes the hero's own place as the seat without the overlay (%s), and no occupancy", async (mode) => {
		render(MapTile, { ...base, mode, placeNodeId: "demo/hall", occupancyPlaces: occupancy });
		const canvas = await screen.findByTestId("fake-map-canvas");
		expect(canvas.getAttribute("data-seat-place")).toBe("demo/hall");
		expect(canvas.getAttribute("data-occupancy-count")).toBe("0");
	});

	it("follows the hero to a new place", async () => {
		const view = render(MapTile, { ...base, mode: "medium", placeNodeId: "demo/hall" });
		const canvas = await screen.findByTestId("fake-map-canvas");
		await view.rerender({ ...base, mode: "medium", placeNodeId: "demo/cellar" });
		expect(canvas.getAttribute("data-seat-place")).toBe("demo/cellar");
	});

	it("keeps the watch's own seat under the overlay, and falls back to the hero's place until it resolves", async () => {
		const view = render(MapTile, {
			...base,
			mode: "full",
			placeNodeId: "demo/hall",
			overlay: true,
			watch,
			minePlaces: [{ entityId: "1", placeNodeId: "demo/loft" }],
			mineEntityIds: ["1"],
		});
		const canvas = await screen.findByTestId("fake-map-canvas");
		expect(canvas.getAttribute("data-seat-place")).toBe("demo/loft");
		await view.rerender({
			...base,
			mode: "full",
			placeNodeId: "demo/hall",
			overlay: true,
			watch,
			minePlaces: [],
			mineEntityIds: ["1"],
		});
		expect(canvas.getAttribute("data-seat-place")).toBe("demo/hall");
	});

	it("drops the canvas boot report of the hero's place, and hands a later pick of it on", async () => {
		const onPlaceClick = vi.fn();
		render(MapTile, { ...base, mode: "medium", onPlaceClick, placeNodeId: "demo/hall" });
		// The fake canvas reports its boot place on mount, as the real one does.
		await screen.findByTestId("fake-map-canvas");
		expect(onPlaceClick).not.toHaveBeenCalled();
		screen.getByRole("button", { name: "Select own map place" }).click();
		expect(onPlaceClick).toHaveBeenCalledTimes(1);
		expect(onPlaceClick.mock.calls[0]?.[0]).toMatchObject({ nodeId: "demo/hall" });
	});

	it("drops a second boot report after a token renewal, also after the player picked that place once", async () => {
		const onPlaceClick = vi.fn();
		const props = { ...base, mode: "medium", onPlaceClick, placeNodeId: "demo/hall" } as const;
		const view = render(MapTile, props);
		await screen.findByTestId("fake-map-canvas");
		// A token renewal makes the canvas boot again and report its place.
		await view.rerender({ ...props, token: "tok-renewed" });
		await tick();
		expect(onPlaceClick).not.toHaveBeenCalled();
		// One click is one pick, although the canvas reports it twice.
		screen.getByRole("button", { name: "Select own map place" }).click();
		await tick();
		expect(onPlaceClick).toHaveBeenCalledTimes(1);
		// A later renewal, and a place the hero moved to meanwhile: no pick.
		await view.rerender({ ...props, token: "tok-renewed-2", placeNodeId: "demo/cellar" });
		await tick();
		await view.rerender({ ...props, slug: "demo-2", placeNodeId: "demo/cellar" });
		await tick();
		expect(onPlaceClick).toHaveBeenCalledTimes(1);
	});

	it("does not let a gesture that reported nothing arm a later boot", async () => {
		const onPlaceClick = vi.fn();
		const props = { ...base, mode: "medium", onPlaceClick, placeNodeId: "demo/hall" } as const;
		const view = render(MapTile, props);
		const canvas = await screen.findByTestId("fake-map-canvas");
		// A pan: a pointer press on the canvas that selects nothing.
		canvas.dispatchEvent(new Event("pointerdown", { bubbles: true }));
		await view.rerender({ ...props, token: "tok-renewed" });
		await tick();
		expect(onPlaceClick).not.toHaveBeenCalled();
	});

	it("holds nothing back when the canvas was mounted without a place", async () => {
		const onPlaceClick = vi.fn();
		// No place at mount: no boot place to wait for.
		const props = { ...base, mode: "medium", onPlaceClick } as const;
		const view = render(MapTile, props);
		await screen.findByTestId("fake-map-canvas");
		screen.getByRole("button", { name: "Select test map place" }).click();
		expect(onPlaceClick).toHaveBeenCalledTimes(1);
		// A pick of the place the hero stands in later goes through.
		await view.rerender({ ...props, placeNodeId: "demo/hall" });
		screen.getByRole("button", { name: "Select own map place" }).click();
		expect(onPlaceClick).toHaveBeenCalledTimes(2);
	});

	it("lets the canvas follow the hero's place, and hands every pick of the canvas on", async () => {
		const onPlaceClick = vi.fn();
		const props = { ...base, mode: "medium", onPlaceClick } as const;
		const view = render(MapTile, { ...props, placeNodeId: "demo/hall" });
		const canvas = await screen.findByTestId("fake-map-canvas");
		// The canvas owns the follow and keeps it off onPlaceClick itself
		// (`followPlace`, MapCanvas.camera.svelte.test.ts). MapTile only drops
		// the boot report (the test above); a follow changes nothing here.
		expect(canvas.getAttribute("data-follow-place")).toBe("true");
		const pick = screen.getByRole("button", { name: "Select test map place" });
		await view.rerender({ ...props, placeNodeId: "test/destination" });
		pick.click();
		expect(onPlaceClick).toHaveBeenCalledTimes(1);
		await view.rerender({ ...props, placeNodeId: "demo/cellar" });
		await view.rerender({ ...props, placeNodeId: "test/destination" });
		pick.click();
		expect(onPlaceClick).toHaveBeenCalledTimes(2);
	});

	it("never asks the canvas for a Substrate control", async () => {
		render(MapTile, { ...base, mode: "full", placeNodeId: "demo/hall" });
		const canvas = await screen.findByTestId("fake-map-canvas");
		expect(canvas.getAttribute("data-substrate-control")).toBe("false");
	});
});

describe("MapTile maps-site link", () => {
	const base = {
		open: true,
		mode: "full",
		gatewayOrigin: "https://gw.example",
		slug: "demo",
		token: "tok",
	} as const;

	it("shows no link and names no site when no maps site is configured", async () => {
		render(MapTile, { ...base, mapHref: null });
		await waitFor(() => expect(screen.getByTestId("fake-map-canvas")).toBeTruthy());
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText(/whole world/).textContent).not.toMatch(/same as|spellkave\.com/);
	});

	it("links to the configured site and names its host in the whole-world note", async () => {
		render(MapTile, { ...base, mapHref: "http://127.0.0.1:5174/?world=demo" });
		await waitFor(() => expect(screen.getByTestId("fake-map-canvas")).toBeTruthy());
		expect(screen.getByRole("link", { name: /Open the full map/ }).getAttribute("href")).toBe(
			"http://127.0.0.1:5174/?world=demo",
		);
		expect(screen.getByText(/whole world/).textContent).toContain("the same as 127.0.0.1:5174");
	});
});
