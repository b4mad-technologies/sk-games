import { describe, expect, it } from "vitest";
import {
	aboveSibling,
	applyEdgeDrag,
	belowSibling,
	canResizeRowBoundary,
	columnIndexOf,
	columnIsNarrowInLayout,
	columnTemplateFromLayout,
	DESKTOP_COLUMNS,
	fightLayout,
	focusedLayout,
	fr,
	hasColumnBoundary,
	lerpLayout,
	levelForSize,
	levelInLayout,
	type MosaicLayout,
	mobileRowTemplateFromLayout,
	restLayout,
	rowTemplateFromLayout,
	tileFillsViewport,
	tileSizeInLayout,
} from "./mosaic";

describe("fr", () => {
	it("maps the three named points from the prototype", () => {
		expect(fr(0)).toBe(0);
		expect(fr(0.5)).toBe(1);
		expect(fr(1)).toBe(5);
	});
});

describe("levelForSize", () => {
	it("splits at the strip/card and card/stage thresholds", () => {
		expect(levelForSize(0)).toBe("strip");
		expect(levelForSize(0.24)).toBe("strip");
		expect(levelForSize(0.25)).toBe("card");
		expect(levelForSize(0.5)).toBe("card");
		expect(levelForSize(0.69)).toBe("card");
		expect(levelForSize(0.7)).toBe("stage");
		expect(levelForSize(1)).toBe("stage");
	});
});

describe("restLayout / focusedLayout", () => {
	it("keeps the prose-first Table at stage from its half-share while spatial tiles remain cards", () => {
		const layout = restLayout(false);
		layout.colShare[1] = 0.5;
		layout.colShare[0] = 0.5;

		expect(levelInLayout(layout, "table", false)).toBe("stage");
		expect(levelInLayout(layout, "map", false)).toBe("card");
	});

	it("rests the table at stage and the others as cards, desktop", () => {
		const layout = restLayout(false);
		expect(levelInLayout(layout, "table", false)).toBe("stage");
		expect(levelInLayout(layout, "map", false)).toBe("card");
		expect(levelInLayout(layout, "place", false)).toBe("card");
		expect(levelInLayout(layout, "hero", false)).toBe("card");
	});

	it("rests the table at stage and the rest as a strip stack, mobile", () => {
		const layout = restLayout(true);
		expect(levelInLayout(layout, "table", true)).toBe("stage");
		expect(levelInLayout(layout, "map", true)).toBe("strip");
		expect(levelInLayout(layout, "pack", true)).toBe("strip");
	});

	it("grows the focused tile to stage and folds every other tile to a strip", () => {
		const layout = focusedLayout("map");
		expect(tileSizeInLayout(layout, "map", false)).toBe(1);
		expect(levelInLayout(layout, "map", false)).toBe("stage");
		expect(levelInLayout(layout, "table", false)).toBe("strip");
		expect(levelInLayout(layout, "place", false)).toBe("strip");
		expect(levelInLayout(layout, "hero", false)).toBe("strip");
	});

	it("never moves a tile: table stays centre-column regardless of focus", () => {
		expect(DESKTOP_COLUMNS[1]).toEqual(["table"]);
	});
});

describe("fightLayout", () => {
	it("puts the map at stage, the table at a card (the turn bar), and everything else at strip, desktop", () => {
		const layout = fightLayout();
		expect(levelInLayout(layout, "map", false)).toBe("stage");
		expect(levelInLayout(layout, "table", false)).toBe("card");
		expect(levelInLayout(layout, "place", false)).toBe("strip");
		expect(levelInLayout(layout, "hero", false)).toBe("strip");
		expect(levelInLayout(layout, "pack", false)).toBe("strip");
	});

	it("reads the same shape on a phone: map stage, table card, the rest strip", () => {
		const layout = fightLayout();
		expect(levelInLayout(layout, "map", true)).toBe("stage");
		expect(levelInLayout(layout, "table", true)).toBe("card");
		expect(levelInLayout(layout, "place", true)).toBe("strip");
		expect(levelInLayout(layout, "pack", true)).toBe("strip");
	});

	it("never moves a tile: entering the fight only regrades shares, map and table stay in their own columns", () => {
		expect(columnIndexOf("map")).toBe(0);
		expect(columnIndexOf("table")).toBe(1);
	});

	it("desktop: the map is stage but does not fill, same as the table at rest — its own head still toggles a manual focus instead of always shrinking the fight posture", () => {
		const layout = fightLayout();
		expect(levelInLayout(layout, "map", false)).toBe("stage");
		expect(tileFillsViewport(layout, "map", false)).toBe(false);
		expect(tileFillsViewport(layout, "table", false)).toBe(false);
	});

	it("leaving the fight (hasTacticalSession turning false) restores the rest layout: table back to stage, map back to a card", () => {
		const fight = fightLayout();
		expect(levelInLayout(fight, "table", false)).not.toBe("stage");
		expect(levelInLayout(fight, "map", false)).not.toBe("card");

		const rest = restLayout(false);
		expect(levelInLayout(rest, "table", false)).toBe("stage");
		expect(levelInLayout(rest, "map", false)).toBe("card");
	});

	it("holds the same rest-restores-it shape on a phone", () => {
		const fight = fightLayout();
		expect(levelInLayout(fight, "table", true)).not.toBe("stage");

		const rest = restLayout(true);
		expect(levelInLayout(rest, "table", true)).toBe("stage");
		expect(levelInLayout(rest, "map", true)).toBe("strip");
	});
});

describe("lerpLayout", () => {
	it("interpolates every share between two layouts", () => {
		const rest = restLayout(false);
		const focused = focusedLayout("pack");
		const half = lerpLayout(rest, focused, 0.5);
		expect(tileSizeInLayout(half, "pack", false)).toBeCloseTo(
			(tileSizeInLayout(rest, "pack", false) + 1) / 2,
		);
		expect(lerpLayout(rest, focused, 0)).toEqual(rest);
		expect(lerpLayout(rest, focused, 1)).toEqual(focused);
	});
});

describe("belowSibling / aboveSibling / columnIndexOf / hasColumnBoundary", () => {
	it("finds the next tile down a desktop column, and null past the last", () => {
		expect(belowSibling("map", false)).toBe("place");
		expect(belowSibling("place", false)).toBeNull();
		expect(belowSibling("hero", false)).toBe("pack");
		expect(belowSibling("pack", false)).toBeNull();
	});

	it("finds the next tile up a desktop column, and null before the first", () => {
		expect(aboveSibling("place", false)).toBe("map");
		expect(aboveSibling("map", false)).toBeNull();
		expect(aboveSibling("pack", false)).toBe("hero");
		expect(aboveSibling("hero", false)).toBeNull();
	});

	it("finds the next tile down and up the phone stack", () => {
		expect(belowSibling("table", true)).toBe("map");
		expect(belowSibling("pack", true)).toBeNull();
		expect(aboveSibling("map", true)).toBe("table");
		expect(aboveSibling("table", true)).toBeNull();
	});

	it("reports which side of a column has a neighbour", () => {
		expect(columnIndexOf("map")).toBe(0);
		expect(columnIndexOf("table")).toBe(1);
		expect(columnIndexOf("pack")).toBe(2);
		expect(hasColumnBoundary("map", "left")).toBe(false);
		expect(hasColumnBoundary("map", "right")).toBe(true);
		expect(hasColumnBoundary("table", "left")).toBe(true);
		expect(hasColumnBoundary("table", "right")).toBe(true);
		expect(hasColumnBoundary("pack", "right")).toBe(false);
		expect(hasColumnBoundary("pack", "left")).toBe(true);
	});
});

describe("applyEdgeDrag: window semantics", () => {
	it("a drag on the map/place boundary, grabbed from map's bottom band, changes only map and place shares", () => {
		const before = restLayout(false);
		const after = applyEdgeDrag(before, "map", { row: { edge: "bottom", delta: 0.2 } }, false);
		expect(after.rowShare.map).toBeCloseTo(before.rowShare.map + 0.2);
		expect(after.rowShare.place).toBeCloseTo(before.rowShare.place - 0.2);
		// Nothing else in the layout moved.
		expect(after.rowShare.table).toBe(before.rowShare.table);
		expect(after.rowShare.hero).toBe(before.rowShare.hero);
		expect(after.rowShare.pack).toBe(before.rowShare.pack);
		expect(after.colShare).toEqual(before.colShare);
	});

	it("uses measured pane pixels to keep a splitter boundary under the pointer despite the non-linear fr scale", () => {
		const before = restLayout(false);
		const after = applyEdgeDrag(
			before,
			"map",
			{ row: { edge: "bottom", delta: 20, pixels: [100, 100] } },
			false,
		);
		const mapFraction =
			fr(after.rowShare.map) / (fr(after.rowShare.map) + fr(after.rowShare.place));
		expect(mapFraction).toBeCloseTo(0.6);
		expect(after.rowShare.table).toBe(before.rowShare.table);
	});

	it("grows a collapsed fight-strip pair smoothly into its explicit free track", () => {
		const before = fightLayout();
		const after = applyEdgeDrag(
			before,
			"hero",
			{ row: { edge: "bottom", delta: 20, pixels: [40, 40], availablePixels: 600 } },
			false,
		);
		expect(after.rowShare.hero).toBeGreaterThan(0);
		expect(after.rowShare.hero).toBeLessThan(0.1);
		expect(after.rowShare.pack).toBe(0);
	});

	it("advertises a resize when a collapsed pair can grow into its free track", () => {
		const fight = fightLayout();
		expect(canResizeRowBoundary(fight, "hero", false)).toBe(true);
		expect(canResizeRowBoundary(restLayout(false), "hero", false)).toBe(true);
	});

	it("a drag on the map/place boundary, grabbed from place's top band, is the same boundary from the other side", () => {
		const before = restLayout(false);
		const fromMap = applyEdgeDrag(before, "map", { row: { edge: "bottom", delta: 0.2 } }, false);
		const fromPlace = applyEdgeDrag(before, "place", { row: { edge: "top", delta: 0.2 } }, false);
		expect(fromPlace.rowShare).toEqual(fromMap.rowShare);
	});

	it("the first tile's top band is inert: there is no boundary above it", () => {
		const before = restLayout(false);
		const after = applyEdgeDrag(before, "map", { row: { edge: "top", delta: 0.3 } }, false);
		expect(after).toEqual(before);
	});

	it("the last tile's bottom band is inert: there is no boundary below it", () => {
		const before = restLayout(false);
		const after = applyEdgeDrag(before, "place", { row: { edge: "bottom", delta: 0.3 } }, false);
		expect(after).toEqual(before);
	});

	it("a side-edge (col) drag on map's right edge changes only the left and centre column widths", () => {
		const before = restLayout(false);
		const after = applyEdgeDrag(before, "map", { col: { side: "right", delta: 0.2 } }, false);
		expect(after.colShare[0]).toBeCloseTo(before.colShare[0] + 0.2);
		expect(after.colShare[1]).toBeCloseTo(before.colShare[1] - 0.2);
		expect(after.colShare[2]).toBe(before.colShare[2]);
		expect(after.rowShare).toEqual(before.rowShare);
	});

	it("dragging the centre column's left edge is the same boundary as map's right edge", () => {
		const before = restLayout(false);
		const fromMap = applyEdgeDrag(before, "map", { col: { side: "right", delta: 0.2 } }, false);
		const fromTable = applyEdgeDrag(before, "table", { col: { side: "left", delta: 0.2 } }, false);
		expect(fromTable.colShare).toEqual(fromMap.colShare);
	});

	it("a corner drag changes both the row and the column shares from the same tile", () => {
		const before = restLayout(false);
		const after = applyEdgeDrag(
			before,
			"map",
			{ row: { edge: "bottom", delta: 0.2 }, col: { side: "right", delta: 0.15 } },
			false,
		);
		expect(after.rowShare.map).toBeCloseTo(before.rowShare.map + 0.2);
		expect(after.rowShare.place).toBeCloseTo(before.rowShare.place - 0.2);
		expect(after.colShare[0]).toBeCloseTo(before.colShare[0] + 0.15);
		expect(after.colShare[1]).toBeCloseTo(before.colShare[1] - 0.15);
	});

	it("clamps at the edges instead of taking more than the neighbour has", () => {
		const before = restLayout(false);
		const after = applyEdgeDrag(before, "map", { row: { edge: "bottom", delta: 5 } }, false);
		expect(after.rowShare.map).toBe(1);
		expect(after.rowShare.place).toBe(0);
	});

	it("on a phone, a row drag only ever touches the two tiles either side of the boundary it grabbed", () => {
		const before = restLayout(true);
		const after = applyEdgeDrag(before, "table", { row: { edge: "bottom", delta: -0.3 } }, true);
		expect(after.rowShare.table).toBeCloseTo(before.rowShare.table - 0.3);
		expect(after.rowShare.map).toBeCloseTo(before.rowShare.map + 0.3);
		expect(after.rowShare.place).toBe(before.rowShare.place);
	});

	it("ignores a column delta on a phone: there is only one column", () => {
		const before = restLayout(true);
		const after = applyEdgeDrag(before, "table", { col: { side: "right", delta: 0.3 } }, true);
		expect(after).toEqual(before);
	});
});

describe("the world pull forces the table to stage regardless of a manual layout", () => {
	it("a reaction/your-turn pull always resets to restLayout, which reads the table as stage", () => {
		const manual = applyEdgeDrag(
			focusedLayout("map"),
			"map",
			{ row: { edge: "bottom", delta: -0.9 } },
			false,
		);
		expect(levelInLayout(manual, "table", false)).not.toBe("stage");

		const pulled = restLayout(false);
		expect(levelInLayout(pulled, "table", false)).toBe("stage");
	});

	it("holds on a phone too", () => {
		const manual = focusedLayout("pack");
		expect(levelInLayout(manual, "table", true)).not.toBe("stage");
		expect(levelInLayout(restLayout(true), "table", true)).toBe("stage");
	});
});

describe("desktop track templates", () => {
	it("gives every rest column a real share, none of them narrow", () => {
		const layout = restLayout(false);
		const template = columnTemplateFromLayout(layout);
		expect(template.split(" minmax").length).toBe(3);
		for (let i = 0; i < DESKTOP_COLUMNS.length; i++)
			expect(columnIsNarrowInLayout(layout, i)).toBe(false);
	});

	it("narrows the side columns to an icon rail when the table is maximised", () => {
		const layout = focusedLayout("table");
		expect(columnIsNarrowInLayout(layout, 0)).toBe(true);
		expect(columnIsNarrowInLayout(layout, 2)).toBe(true);
		expect(columnIsNarrowInLayout(layout, 1)).toBe(false);
	});

	it("keeps an untouched narrow column as fixed icon-rail rows", () => {
		const layout = focusedLayout("table");
		expect(rowTemplateFromLayout(layout, 0)).toBe("var(--mosaic-icon-col) var(--mosaic-icon-col)");
	});

	it("grades a column's rows by each tile's own share when it is not narrow", () => {
		const rows = rowTemplateFromLayout(restLayout(false), 2);
		expect(rows.split(" minmax").length).toBe(3);
	});

	it("uses the column share for Table's singleton row after a manual column resize", () => {
		const layout = focusedLayout("map");
		layout.colShare[1] = 0.5;
		// A former focus left this stored row at zero. Table has no row boundary,
		// so its rendered and semantic size must follow its middle column instead.
		expect(layout.rowShare.table).toBe(0);
		expect(tileSizeInLayout(layout, "table", false)).toBe(0.5);
		expect(rowTemplateFromLayout(layout, 1)).toBe(
			"minmax(var(--mosaic-strip), 1fr) minmax(0, 0fr)",
		);
	});
});

describe("mobile row template", () => {
	it("carries all five tiles in the fixed reading order", () => {
		const rows = mobileRowTemplateFromLayout(restLayout(true));
		expect(rows.split(" minmax").length).toBe(5);
	});
});

describe("tileFillsViewport", () => {
	it("desktop: a merely-stage tile (both shares past 0.7, short of 1) does not fill", () => {
		const layout: MosaicLayout = {
			...restLayout(false),
			colShare: [0.8, 0.5, 0.5],
			rowShare: { ...restLayout(false).rowShare, map: 0.8, place: 0.2 },
		};
		expect(levelInLayout(layout, "map", false)).toBe("stage");
		expect(tileFillsViewport(layout, "map", false)).toBe(false);
	});

	it("desktop: focusedLayout maximises both the column and the tile's own share, so it fills", () => {
		const layout = focusedLayout("map");
		expect(tileFillsViewport(layout, "map", false)).toBe(true);
		// The sibling in the same column is folded away, not "filling" anything.
		expect(tileFillsViewport(layout, "place", false)).toBe(false);
	});

	it("desktop: rest never fills, even for the table which already reads as stage", () => {
		const layout = restLayout(false);
		expect(levelInLayout(layout, "table", false)).toBe("stage");
		expect(tileFillsViewport(layout, "table", false)).toBe(false);
	});

	it("desktop: Table fills with its singleton column despite a stale stored row", () => {
		const layout = focusedLayout("map");
		layout.colShare[1] = 1;
		expect(layout.rowShare.table).toBe(0);
		expect(tileFillsViewport(layout, "table", false)).toBe(true);
	});

	it("mobile: stage already means full width, so stage alone fills", () => {
		expect(tileFillsViewport(focusedLayout("map"), "map", true)).toBe(true);
		expect(tileFillsViewport(restLayout(true), "map", true)).toBe(false);
	});
});
