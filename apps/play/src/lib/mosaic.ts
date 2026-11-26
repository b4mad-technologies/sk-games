/**
 * Pure geometry for the zoomed table: which tile is focused, how big every
 * tile is, and the grid tracks that share carries. Nothing here touches the
 * DOM or `PlayView` — `PlayTable.svelte` is the only caller, and the level
 * thresholds and rest sizes mirror `ledger/designs/play-zoomed-table/
 * prototype.html` (`size()`, `fr()`, `level()`, `tracks()`).
 *
 * Phase 1 (sk-jay0.1.8.3) only jumped between levels on a tap: one scalar per
 * tile, folded via a single `focus`. The shell phase (window-style resizing,
 * `ledger/designs/play-zoomed-table.md` "Direction after the prototype")
 * replaces that scalar with a `MosaicLayout`: an independent width share per
 * desktop column and an independent height share per tile within its column
 * (or, on a phone, within the single stack). A pointer or pinch drag mutates
 * only the two shares either side of the boundary it grabbed — "only that
 * neighbour yields" — everything else in the layout is untouched. A row
 * boundary sits between two stacked tiles and is reachable from either
 * one's near edge (the tile above's bottom band, or the tile below's top
 * band); the mosaic's own outer edges carry no boundary and are inert.
 */

export const TILE_IDS = ["table", "map", "place", "hero", "pack"] as const;

export type TileId = (typeof TILE_IDS)[number];

export type TileLevel = "strip" | "card" | "stage";

/** Reading order on a phone: what the world asks of you first, then place, then self. */
export const MOBILE_ORDER: readonly TileId[] = ["table", "map", "place", "hero", "pack"];

/** Desktop mosaic: map over place on the left, table centre, self stack on the right. */
export const DESKTOP_COLUMNS: readonly (readonly TileId[])[] = [
	["map", "place"],
	["table"],
	["hero", "pack"],
];

export const TILE_TITLES: Record<TileId, string> = {
	table: "Table",
	map: "Map",
	place: "Place",
	hero: "You",
	pack: "Pack",
};

/** At rest the table is already open; the others sit as cards beside it. */
const REST_SIZE: Record<TileId, number> = {
	table: 0.7,
	map: 0.5,
	place: 0.5,
	hero: 0.5,
	pack: 0.5,
};

/** `0 → 0`, `0.5 → 1`, `1 → 5`: a card's share grows far faster than a strip's. */
export function fr(size: number): number {
	return size <= 0.5 ? size * 2 : 1 + (size - 0.5) * 8;
}

const CARD_THRESHOLD = 0.25;
const STAGE_THRESHOLD = 0.7;
/* Table is prose-first: its stream remains useful at the width where the
 * surrounding spatial tiles genuinely need their compact card treatment. */
const TABLE_STAGE_THRESHOLD = 0.5;

/** `size ∈ [0,1]`: 0 = a strip, 0.5 = a card, 1 = the stage. */
function levelForSizeAtThreshold(size: number, stageThreshold: number): TileLevel {
	if (size < CARD_THRESHOLD) return "strip";
	if (size < stageThreshold) return "card";
	return "stage";
}

export function levelForSize(size: number): TileLevel {
	return levelForSizeAtThreshold(size, STAGE_THRESHOLD);
}

// ── Layout: one width share per desktop column, one height share per tile ──

/**
 * `colShare[i]` is the width share of `DESKTOP_COLUMNS[i]`; only meaningful
 * on desktop. `rowShare[id]` is `id`'s height share within its own column
 * (desktop) or within the single phone stack (mobile) — the two contexts
 * share one field because a tile is never in both at once, `PlayTable`
 * switches the whole mosaic at the 64rem breakpoint.
 */
export interface MosaicLayout {
	colShare: [number, number, number];
	rowShare: Record<TileId, number>;
}

/** The column (0, 1 or 2) that carries `id` on desktop. */
export function columnIndexOf(id: TileId): number {
	return DESKTOP_COLUMNS.findIndex((ids) => ids.includes(id));
}

function siblingsOf(id: TileId, mobile: boolean): readonly TileId[] | null {
	return mobile ? MOBILE_ORDER : (DESKTOP_COLUMNS[columnIndexOf(id)] ?? null);
}

/** `id`'s neighbour one place further down its column/stack, or `null` if `id` is last. */
export function belowSibling(id: TileId, mobile: boolean): TileId | null {
	const siblings = siblingsOf(id, mobile);
	if (siblings === null) return null;
	const index = siblings.indexOf(id);
	return index >= 0 && index + 1 < siblings.length ? (siblings[index + 1] ?? null) : null;
}

/** `id`'s neighbour one place further up its column/stack, or `null` if `id` is first. */
export function aboveSibling(id: TileId, mobile: boolean): TileId | null {
	const siblings = siblingsOf(id, mobile);
	if (siblings === null) return null;
	const index = siblings.indexOf(id);
	return index > 0 ? (siblings[index - 1] ?? null) : null;
}

/** Whether `id`'s column has a neighbouring column on `side` (desktop only). */
export function hasColumnBoundary(id: TileId, side: "left" | "right"): boolean {
	const col = columnIndexOf(id);
	const boundary = side === "right" ? col : col - 1;
	return boundary >= 0 && boundary < DESKTOP_COLUMNS.length - 1;
}

/** Nobody focused: the table at stage, the rest as cards (desktop) or strips (phone). */
export function restLayout(mobile: boolean): MosaicLayout {
	const rowShare = Object.fromEntries(
		TILE_IDS.map((id) => [id, mobile ? (id === "table" ? 1 : 0) : REST_SIZE[id]]),
	) as Record<TileId, number>;
	const colShare = DESKTOP_COLUMNS.map((ids) => Math.max(...ids.map((id) => REST_SIZE[id]))) as [
		number,
		number,
		number,
	];
	return { colShare, rowShare };
}

/**
 * `id` at its stage, every other tile folded to a strip — a tap's target
 * layout. No `mobile` parameter: folding to 0/1 reads the same both ways,
 * `tileSizeInLayout`'s mobile branch already ignores `colShare`.
 */
export function focusedLayout(focus: TileId): MosaicLayout {
	const rowShare = Object.fromEntries(TILE_IDS.map((id) => [id, id === focus ? 1 : 0])) as Record<
		TileId,
		number
	>;
	const colShare = DESKTOP_COLUMNS.map((ids) => (ids.includes(focus) ? 1 : 0)) as [
		number,
		number,
		number,
	];
	return { colShare, rowShare };
}

/**
 * `hasTacticalSession(view)` (`play-table.ts`): the map takes the stage as
 * the battle picture, the table drops to a card — `PlayTable`'s turn bar
 * branch (`Combat`'s tracker strip, End turn, status line) — and every
 * other tile folds to a strip. Same shape as `restLayout`/`focusedLayout`
 * (one width share per desktop column, one height share per tile), so a
 * tile head's own tap-to-grow still works during a fight: `toggleTile`
 * reads `layout`/`tileFillsViewport`, not which function produced the
 * layout it is holding. No `mobile` parameter, like `focusedLayout`: the
 * map's stage share and the table's card share already read the same both
 * ways (a singleton desktop column reads its `colShare` directly; a phone
 * stack reads `rowShare` directly — see `tileSizeInLayout`), unlike
 * `restLayout`'s rest sizes, which need the mobile/desktop split because a
 * desktop *card* share (0.5) would read as a phone *card*, not a phone
 * *strip*.
 *
 * The map's own share is `REST_SIZE.table`'s 0.7, not 1: past the stage
 * threshold but short of `tileFillsViewport`'s fill threshold, on purpose,
 * the same reasoning `REST_SIZE.table` already carries for the table at
 * rest (`tileFillsViewport`'s own "rest never fills" test). The map is
 * *already* this layout's default stage tile, not a tile the player just
 * tapped to focus — if its own share instead read as "filling", tapping the
 * map tile's head would immediately read `tileFillsViewport` as true and
 * shrink the whole fight posture back to rest on the very first tap,
 * instead of merely toggling its own zoom like every other tile's head.
 */
const FIGHT_SIZE: Record<TileId, number> = {
	// Just below Table's prose-stage threshold: a fight keeps its compact turn bar.
	table: 0.49,
	map: 0.7,
	place: 0,
	hero: 0,
	pack: 0,
};

export function fightLayout(): MosaicLayout {
	const rowShare = Object.fromEntries(TILE_IDS.map((id) => [id, FIGHT_SIZE[id]])) as Record<
		TileId,
		number
	>;
	const colShare = DESKTOP_COLUMNS.map((ids) => Math.max(...ids.map((id) => FIGHT_SIZE[id]))) as [
		number,
		number,
		number,
	];
	return { colShare, rowShare };
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Linear blend between two layouts — pinch scales continuously between rest and focused. */
export function lerpLayout(a: MosaicLayout, b: MosaicLayout, t: number): MosaicLayout {
	const clamped = clamp01(t);
	const colShare = a.colShare.map(
		(value, i) => value + ((b.colShare[i] ?? value) - value) * clamped,
	) as [number, number, number];
	const rowShare = Object.fromEntries(
		TILE_IDS.map((id) => [id, a.rowShare[id] + (b.rowShare[id] - a.rowShare[id]) * clamped]),
	) as Record<TileId, number>;
	return { colShare, rowShare };
}

/**
 * The size a tile actually receives on its vertical axis. A desktop
 * singleton (currently Table) has no independent row boundary, so its row
 * follows the column that is its only resizable dimension.
 */
export function effectiveRowShare(layout: MosaicLayout, id: TileId, mobile: boolean): number {
	if (mobile) return layout.rowShare[id];
	const col = columnIndexOf(id);
	const siblings = DESKTOP_COLUMNS[col] ?? [];
	return siblings.length <= 1 ? (layout.colShare[col] ?? 0) : layout.rowShare[id];
}

/** `id`'s own size: on desktop the narrower of its column's width and its effective row height. */
export function tileSizeInLayout(layout: MosaicLayout, id: TileId, mobile: boolean): number {
	if (mobile) return effectiveRowShare(layout, id, mobile);
	const col = columnIndexOf(id);
	return Math.min(layout.colShare[col] ?? 0, effectiveRowShare(layout, id, mobile));
}

export function levelInLayout(layout: MosaicLayout, id: TileId, mobile: boolean): TileLevel {
	return levelForSizeAtThreshold(
		tileSizeInLayout(layout, id, mobile),
		id === "table" ? TABLE_STAGE_THRESHOLD : STAGE_THRESHOLD,
	);
}

/** How close a share must sit to 1 to read as "fully open" rather than merely `stage`. */
const FILL_THRESHOLD = 0.99;

/**
 * Whether `id` fills the whole mosaic, not merely its own `stage` threshold
 * (0.7). `stage` alone is not enough on desktop: a tile can cross the stage
 * threshold while its column still shares width with the other two, so it
 * reads as a large panel, not the full screen. Filling the screen needs the
 * column itself pushed to its own maximum share too — the state
 * `focusedLayout(id)` puts a tapped tile in. Splitter drags intentionally
 * retain their continuous value instead. On a phone there is only one column,
 * already full width, so `stage` there already reads as full-screen.
 */
export function tileFillsViewport(layout: MosaicLayout, id: TileId, mobile: boolean): boolean {
	if (mobile) return levelInLayout(layout, id, mobile) === "stage";
	const col = columnIndexOf(id);
	return (
		(layout.colShare[col] ?? 0) >= FILL_THRESHOLD &&
		effectiveRowShare(layout, id, mobile) >= FILL_THRESHOLD
	);
}

// ── Dragging: adjust exactly the two shares either side of a grabbed edge ──

export interface EdgeDrag {
	/**
	 * Vertical delta share for the boundary between two stacked tiles,
	 * grabbed from `id`'s own `edge`: "bottom" pairs `id` with
	 * `belowSibling(id)`, "top" pairs `aboveSibling(id)` with `id` — the same
	 * boundary, reachable from either of its two tiles. `delta` always grows
	 * whichever tile is physically above the boundary and shrinks whichever
	 * is below, regardless of which of the two `edge`s it came from.
	 */
	row?: {
		edge: "top" | "bottom";
		delta: number;
		pixels?: [number, number];
		/** Full column height, used to allocate an initially-collapsed pair into free track space. */
		availablePixels?: number;
	};
	/** Horizontal delta share: `id`'s column grows, the column on `side` yields. */
	col?: { side: "left" | "right"; delta: number; pixels?: [number, number] };
}

function sizeFromFr(weight: number): number {
	return clamp01(weight <= 1 ? weight / 2 : (weight + 3) / 8);
}

/**
 * Adjust a neighbouring pair. Old callers may supply a normalised share
 * delta; an interactive splitter supplies the measured pixel sizes at grab
 * time, so a 20px pointer movement moves the rendered boundary 20px instead
 * of accelerating through the non-linear `fr()` scale.
 */
function pairAdjust(
	a: number,
	b: number,
	delta: number,
	pixels?: [number, number],
	availablePixels?: number,
): [number, number] {
	if (pixels !== undefined) {
		const [firstPixels, secondPixels] = pixels;
		const totalPixels = firstPixels + secondPixels;
		const totalWeight = fr(a) + fr(b);
		if (totalPixels > 0 && totalWeight > 0) {
			const nextFirstPixels = Math.max(0, Math.min(totalPixels, firstPixels + delta));
			const requestedWeight = totalWeight * (nextFirstPixels / totalPixels);
			const nextWeight = Math.max(Math.max(0, totalWeight - 5), Math.min(5, requestedWeight));
			return [sizeFromFr(nextWeight), sizeFromFr(totalWeight - nextWeight)];
		}
		// Both collapsed tracks start at their CSS minimums. Their column's
		// explicit free track is their first donor: normalize against the full
		// column, not the two 40px strips, so the first move grows smoothly
		// instead of converting 20px into a clamped whole layout share.
		if (
			totalPixels > 0 &&
			totalWeight === 0 &&
			availablePixels !== undefined &&
			availablePixels > 0
		) {
			const activatedWeight = Math.min(1, Math.abs(delta) / availablePixels);
			const activatedSize = sizeFromFr(activatedWeight);
			return delta >= 0 ? [activatedSize, b] : [a, activatedSize];
		}
	}
	const nextA = clamp01(a + delta);
	const actual = nextA - a;
	return [nextA, clamp01(b - actual)];
}

/** The (upper, lower) tile pair a row grab at `id`'s `edge` band controls, or `null` if `id` is the outer tile on that side. */
function rowBoundary(id: TileId, edge: "top" | "bottom", mobile: boolean): [TileId, TileId] | null {
	if (edge === "bottom") {
		const lower = belowSibling(id, mobile);
		return lower === null ? null : [id, lower];
	}
	const upper = aboveSibling(id, mobile);
	return upper === null ? null : [upper, id];
}

/**
 * Apply a pointer/pinch drag to `layout`. A `row` delta only ever touches
 * the two tiles either side of the boundary it grabbed — every other row
 * share in the column (or stack) is untouched. A `col` delta only ever
 * touches `id`'s column and the one column adjacent on `side` — the third
 * column is untouched. A corner grab passes both fields in the same call.
 */
export function applyEdgeDrag(
	layout: MosaicLayout,
	id: TileId,
	drag: EdgeDrag,
	mobile: boolean,
): MosaicLayout {
	const rowShare = { ...layout.rowShare };
	const colShare = [...layout.colShare] as [number, number, number];

	if (drag.row !== undefined) {
		const boundary = rowBoundary(id, drag.row.edge, mobile);
		if (boundary !== null) {
			const [upper, lower] = boundary;
			const [a, b] = pairAdjust(
				rowShare[upper],
				rowShare[lower],
				drag.row.delta,
				drag.row.pixels,
				drag.row.availablePixels,
			);
			rowShare[upper] = a;
			rowShare[lower] = b;
		}
	}

	if (drag.col !== undefined && !mobile) {
		const col = columnIndexOf(id);
		const boundary = drag.col.side === "right" ? col : col - 1;
		if (boundary >= 0 && boundary < colShare.length - 1) {
			const [a, b] = pairAdjust(
				colShare[boundary] ?? 0,
				colShare[boundary + 1] ?? 0,
				drag.col.delta,
				drag.col.pixels,
			);
			colShare[boundary] = a;
			colShare[boundary + 1] = b;
		}
	}

	return { colShare, rowShare };
}

// ── Grid templates: read a layout into CSS track lists ──

/** `grid-template-columns` for the three desktop columns. */
export function columnTemplateFromLayout(layout: MosaicLayout): string {
	return layout.colShare.map((share) => `minmax(var(--mosaic-icon-col), ${fr(share)}fr)`).join(" ");
}

/** A column whose width share is still under the strip threshold becomes an icon rail. */
export function columnIsNarrowInLayout(layout: MosaicLayout, colIndex: number): boolean {
	return (layout.colShare[colIndex] ?? 0) < CARD_THRESHOLD;
}

/** `grid-template-rows` for one desktop column. */
export function rowTemplateFromLayout(layout: MosaicLayout, colIndex: number): string {
	const ids = DESKTOP_COLUMNS[colIndex] ?? [];
	const weights = ids.map((id) => fr(effectiveRowShare(layout, id, false)));
	if (columnIsNarrowInLayout(layout, colIndex) && weights.every((weight) => weight === 0)) {
		return ids.map(() => "var(--mosaic-icon-col)").join(" ");
	}
	const rowMinimum = columnIsNarrowInLayout(layout, colIndex)
		? "var(--mosaic-icon-col)"
		: "var(--mosaic-strip)";
	const freeTrackWeight = Math.max(0, 1 - weights.reduce((sum, weight) => sum + weight, 0));
	return ids
		.map((id) => `minmax(${rowMinimum}, ${fr(effectiveRowShare(layout, id, false))}fr)`)
		.concat(`minmax(0, ${freeTrackWeight}fr)`)
		.join(" ");
}

/** Whether a horizontal boundary has flexible share it can redistribute. */
export function canResizeRowBoundary(_layout: MosaicLayout, id: TileId, mobile: boolean): boolean {
	const lower = belowSibling(id, mobile);
	return lower !== null;
}

/** `grid-template-rows` for the single phone column. */
export function mobileRowTemplateFromLayout(layout: MosaicLayout): string {
	return MOBILE_ORDER.map((id) => `minmax(var(--mosaic-strip), ${fr(layout.rowShare[id])}fr)`).join(
		" ",
	);
}
