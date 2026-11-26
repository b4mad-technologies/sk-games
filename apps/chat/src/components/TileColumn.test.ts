import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { publishToolEvent, resetToolEvents } from "../lib/mcp/tool-events.ts";
import mapFixture from "../lib/tiles/fixtures/map.json";
import selfSummaryFixture from "../lib/tiles/fixtures/self_summary.json";
import { TILE_NAMES } from "../lib/tiles/index.ts";
import { resetTiles } from "../lib/tiles/state.svelte.ts";
import TileColumn from "./TileColumn.svelte";

afterEach(() => {
	cleanup();
	resetToolEvents();
	resetTiles();
});

describe("TileColumn", () => {
	it("renders five tiles as not seen yet", () => {
		render(TileColumn);
		expect(screen.getByTestId("tile-column")).toBeTruthy();
		const tiles = screen.getAllByRole("heading", { level: 2 });
		expect(tiles.map((heading) => heading.textContent)).toEqual([...TILE_NAMES]);
		expect(screen.getAllByText("not seen yet")).toHaveLength(TILE_NAMES.length);
	});

	it("fills a tile after a matching tool event", async () => {
		render(TileColumn);
		publishToolEvent({
			tool: "spellkave_self_summary",
			args: {},
			result: selfSummaryFixture,
			at: Date.parse("2026-08-28T12:00:00.000Z"),
		});
		await waitFor(() => {
			expect(screen.getByText("Regdar")).toBeTruthy();
		});
		expect(
			screen.getByText("seen at 2026-08-28T12:00:00.000Z via spellkave_self_summary"),
		).toBeTruthy();
		expect(screen.getAllByText("not seen yet")).toHaveLength(TILE_NAMES.length - 1);
	});

	it("renders sanitised map svg after spellkave_map", async () => {
		render(TileColumn);
		publishToolEvent({
			tool: "spellkave_map",
			args: {},
			result: mapFixture,
			at: 1,
		});
		await waitFor(() => {
			expect(screen.getByTestId("tile-map-svg").querySelector("svg")).not.toBeNull();
		});
	});
});
