// PlayView -> Fight: the turn session on the stage floor.
//
// The world runs a fight on a session grid: every fighter stands on a cell
// (`sessionTokens`, from the map read), the hero's place is their cell, and
// the ways out of it are the steps to its neighbours. This module puts that
// grid on the floor of the scene and reads the turn roster and the turn
// budget beside it. It shades nothing: the world sends no reachable cells
// and no weapon reach (sk-jay0.1.76.15.3). A click on a cell asks.
//
// A grid of another size than the floor: the floor shows a window of at most
// 9 x 4 cells (figures keep their size), clamped to the grid's edges; a
// smaller grid is centred. The window sits around the middle of the fight
// (all fighters), moved as little as needed to keep the hero in it. A
// fighter it cannot hold is on the roster only.

import type { PlayExit, PlayView } from "../../../../play/src/lib/play-view";
import { fightTokens } from "../../lib/fight";
import { inFight } from "../../lib/menu";
import type { BudgetChip, Cell, Fight, Fighter } from "../model";

/** The floor of the stage as a grid, in stage units (as the accepted mock drew it). */
export const FLOOR = { cols: 9, rows: 4, x: 24, y: 158, w: 48, h: 27 } as const;

export type GridCell = { col: number; row: number };

/** The part of the session grid the floor shows. */
export type GridWindow = {
	/** `session_grid_3`: the node id without the cell part. */
	prefix: string;
	col0: number;
	row0: number;
	cols: number;
	rows: number;
	hero: GridCell;
};

const CELL = /^(.+)\/c_(\d+)_(\d+)$/;
// The ruleset's own channels; the kernel's generic ones repeat two of them.
const SRD_CHANNEL = /^srd\/economy_channel\//;
const MOVEMENT_CHANNEL = "srd/economy_channel/movement";
const MOST_PIPS = 12;
/** How far apart two figures on one cell stand, and how far back one who is out of the fight. */
const SHARED_STEP = 22;
const SHARED_BACK = 6;

/** `session_grid_3/c_2_1` -> its grid and cell; null for any other place. */
export function cellOf(nodeId: string | undefined): (GridCell & { prefix: string }) | null {
	const match = CELL.exec(nodeId ?? "");
	return match ? { prefix: match[1] ?? "", col: Number(match[2]), row: Number(match[3]) } : null;
}

export function cellId(prefix: string, cell: GridCell): string {
	return `${prefix}/c_${cell.col}_${cell.row}`;
}

function clamp(value: number, low: number, high: number): number {
	return Math.max(low, Math.min(high, value));
}

/** The window of the grid the floor shows, or null when the hero stands on no grid. */
export function gridWindow(view: PlayView): GridWindow | null {
	if (!inFight(view.session)) return null;
	// The hero's place is their cell. The tokens come with the map read, which
	// can lag one view behind a step (seen live 2026-11-15), so the place leads.
	const mine = (view.sessionTokens ?? []).find((token) => token.isMe);
	const hero = cellOf(view.place?.id) ?? cellOf(mine?.nodeId);
	if (!hero) return null;
	// How far the grid reaches: every cell the plate draws, and whatever the
	// tokens and the ways out name beyond it.
	const known = [...(view.mapSvg ?? "").matchAll(/data-node-id="([^"]+)"/g)].map(
		(match) => match[1],
	);
	const named = [
		...known,
		...(view.sessionTokens ?? []).map((token) => token.nodeId),
		...(view.place?.exits ?? []).map((exit) => exit.toNodeId),
	]
		.map((id) => cellOf(id))
		.filter((cell) => cell !== null && cell.prefix === hero.prefix) as GridCell[];
	const width = Math.max(hero.col, ...named.map((cell) => cell.col)) + 1;
	const height = Math.max(hero.row, ...named.map((cell) => cell.row)) + 1;
	const cols = Math.min(FLOOR.cols, width);
	const rows = Math.min(FLOOR.rows, height);
	const fighters = [
		{ col: hero.col, row: hero.row },
		...(view.sessionTokens ?? [])
			.filter((token) => !token.isMe)
			.map((token) => cellOf(token.nodeId))
			.filter((cell) => cell !== null && cell.prefix === hero.prefix),
	] as GridCell[];
	// Start at the middle of the fight, then move just enough to hold the hero.
	const start = (at: (cell: GridCell) => number, mine: number, span: number, size: number) => {
		const all = fighters.map(at);
		const middle = (Math.min(...all) + Math.max(...all)) / 2;
		const first = clamp(Math.round(middle - (span - 1) / 2), 0, size - span);
		return clamp(first, mine - span + 1, mine);
	};
	return {
		prefix: hero.prefix,
		col0: start((cell) => cell.col, hero.col, cols, width),
		row0: start((cell) => cell.row, hero.row, rows, height),
		cols,
		rows,
		hero: { col: hero.col, row: hero.row },
	};
}

function inWindow(window: GridWindow, cell: GridCell): boolean {
	return (
		cell.col >= window.col0 &&
		cell.col < window.col0 + window.cols &&
		cell.row >= window.row0 &&
		cell.row < window.row0 + window.rows
	);
}

/** The top left corner of a cell on the stage. North (a higher row) is further back. */
function corner(window: GridWindow, cell: GridCell): { x: number; y: number } {
	const left = FLOOR.x + ((FLOOR.cols - window.cols) * FLOOR.w) / 2;
	return {
		x: left + (cell.col - window.col0) * FLOOR.w,
		y: FLOOR.y + (window.rows - 1 - (cell.row - window.row0)) * FLOOR.h,
	};
}

/** Where each fighter in the window stands (feet), by actor id. */
export function fighterSpots(
	view: PlayView,
	window: GridWindow,
): Map<string, { x: number; y: number }> {
	const spots = new Map<string, { x: number; y: number }>();
	// Several can stand on one cell (seen live 2026-11-16: a cultist stepped
	// onto the cell of a dead one, and the body on top took every click).
	// They share the cell side by side; whoever the turn order passes over
	// stands at the back of it.
	const out = passedOver(view);
	const sharing = new Map<string, string[]>();
	for (const token of view.sessionTokens ?? []) {
		const cell = token.isMe ? { prefix: window.prefix, ...window.hero } : cellOf(token.nodeId);
		if (!cell || cell.prefix !== window.prefix || !inWindow(window, cell)) continue;
		const key = cellId(window.prefix, cell);
		sharing.set(key, [...(sharing.get(key) ?? []), token.actorId]);
		const at = corner(window, cell);
		spots.set(token.actorId, { x: at.x + FLOOR.w / 2, y: at.y + FLOOR.h - 5 });
	}
	for (const ids of sharing.values()) {
		if (ids.length < 2) continue;
		const room = Math.min(SHARED_STEP, (FLOOR.w - 12) / (ids.length - 1));
		ids.forEach((id, index) => {
			const spot = spots.get(id);
			if (!spot) return;
			spots.set(id, {
				x: spot.x + (index - (ids.length - 1) / 2) * room,
				y: spot.y - (out.has(id) ? SHARED_BACK : 0),
			});
		});
	}
	return spots;
}

/**
 * How many steps each other fighter stands from the hero, by actor id: the
 * larger of the two differences, as a step may go diagonally. The world
 * sends no weapon reach and answers a blow from too far with "That cannot be
 * done right now." (sk-jay0.1.76.15.3); the distance is what the grid shows.
 */
export function stepsAway(view: PlayView, window: GridWindow): Map<string, number> {
	const steps = new Map<string, number>();
	for (const token of view.sessionTokens ?? []) {
		const cell = token.isMe ? null : cellOf(token.nodeId);
		if (!cell || cell.prefix !== window.prefix) continue;
		steps.set(
			token.actorId,
			Math.max(Math.abs(cell.col - window.hero.col), Math.abs(cell.row - window.hero.row)),
		);
	}
	return steps;
}

/**
 * The order a turn is read in: walk, act, the small things, what waits for
 * somebody else's turn. The world lists its channels by id.
 */
const CHIP_ORDER = ["movement", "primary", "bonus", "object_interaction", "reaction"];

function chipRank(channelId: string): number {
	const rank = CHIP_ORDER.indexOf(channelId.split("/").pop() ?? "");
	return rank < 0 ? CHIP_ORDER.length : rank;
}

function budgetFrom(view: PlayView, stepCostMs: number | null): BudgetChip[] {
	if (!view.economyBudget || view.economyBudget.unavailable) return [];
	const channels = [...view.economyBudget.channels].sort(
		(a, b) => chipRank(a.channelId) - chipRank(b.channelId),
	);
	return channels.flatMap((channel): BudgetChip[] => {
		const { poolMs, remainingMs } = channel;
		// A channel without disclosed numbers is not shown as ready or spent.
		if (
			!SRD_CHANNEL.test(channel.channelId) ||
			poolMs === null ||
			remainingMs === null ||
			poolMs <= 0
		)
			return [];
		const left = Math.max(0, remainingMs);
		// The world gives movement as a share of the turn. Once a step here was
		// seen to cost something, the chip counts whole steps of that cost.
		if (channel.channelId === MOVEMENT_CHANNEL && stepCostMs) {
			const of = Math.min(MOST_PIPS, Math.max(1, Math.round(poolMs / stepCostMs)));
			return [
				{
					id: channel.channelId,
					label: "Steps",
					// The world's numbers are a millisecond off a whole step (4999 of 6000).
					left: Math.min(of, Math.floor(left / stepCostMs + 0.01)),
					of,
				},
			];
		}
		return [{ id: channel.channelId, label: channel.label, left: left > 0 ? 1 : 0, of: 1 }];
	});
}

/**
 * The world opens a turn session for a fight and for a long walk alike and
 * says "A session opens (3 participants)." and "The session closes." for
 * both. With more than one participant it is a fight, and the story says so.
 * Undefined for every other event, and for a closing of which the view
 * carries neither the opening nor a turn of somebody else.
 */
export function fightSentence(
	entry: PlayView["events"][number],
	events: PlayView["events"],
): string | undefined {
	if (entry.kind !== "session_lifecycle") return undefined;
	const opening =
		entry.fields?.phase === "opened"
			? entry
			: events.find(
					(other) =>
						other.kind === "session_lifecycle" &&
						other.fields?.phase === "opened" &&
						other.fields.sessionId === entry.fields?.sessionId,
				);
	const fighters = opening?.fields?.participants?.length ?? 0;
	if (entry.fields?.phase === "opened")
		return fighters < 2 ? undefined : `A fight begins: ${fighters} fighters.`;
	// After a reload the opening is gone; a turn that somebody else had in
	// this session says as much.
	const others = events.some(
		(other) =>
			other.kind === "turn_transition" &&
			other.fields?.sessionId === entry.fields?.sessionId &&
			[other.fields?.fromActor, other.fields?.toActor].some((actor) => actor && !isSelf(actor)),
	);
	return fighters >= 2 || others ? "The fight is over." : undefined;
}

/** Does this side of a turn change name the hero? */
function isSelf(actor: unknown): boolean {
	return typeof actor === "object" && actor !== null && (actor as { self?: unknown }).self === true;
}

/**
 * What the others did while the hero waited: the world's sentences between
 * the hero's turn ending (or the fight opening) and the turn coming back.
 * Undefined unless the turn coming back is the newest thing the world said;
 * after that, the hero's own doings are the news.
 */
export function recapOf(view: PlayView): string[] | undefined {
	if (!view.session.myTurn) return undefined;
	const events = view.events;
	const back = events.at(-1);
	if (back?.kind !== "turn_transition" || !isSelf(back.fields?.toActor)) return undefined;
	const lines: string[] = [];
	for (let index = events.length - 2; index >= 0; index -= 1) {
		const entry = events[index];
		if (!entry || entry.kind === "session_lifecycle") break;
		if (entry.kind !== "turn_transition") lines.unshift(entry.summary);
		else if (isSelf(entry.fields?.fromActor)) break;
	}
	return lines;
}

/** The id a side of a turn change names. */
function actorOf(side: unknown): string | undefined {
	const id = typeof side === "object" && side !== null ? (side as { id?: unknown }).id : undefined;
	return typeof id === "string" ? id : undefined;
}

/**
 * The fighters the turn order passes over. The world does not say who is
 * down or dead while a fight lasts (sk-jay0.1.76.19.12): a dead cultist
 * stands as before and takes a blow like a living one. But it gets no turn
 * any more. Read from the turn changes of this session: whoever is on the
 * roster and had no turn in the last full round (from the previous turn of
 * whoever acts now up to this one) is out of the fight. Empty until a full
 * round is on record. What put them out, the world does not say.
 */
export function passedOver(view: PlayView): Set<string> {
	const out = new Set<string>();
	if (!inFight(view.session)) return out;
	const changes = view.events.filter(
		(entry) => entry.kind === "turn_transition" && entry.fields?.sessionId === view.session.id,
	);
	// Whoever the first change on record passed the turn from had a turn too
	// (after a reload the record starts in the middle of a round). The change
	// that opens a fight passes the turn from its first fighter to the same.
	const first = changes[0]?.fields;
	const from = actorOf(first?.fromActor);
	const turns = [
		...(from !== undefined && from !== actorOf(first?.toActor) ? [from] : []),
		...changes.map((entry) => actorOf(entry.fields?.toActor)),
	].filter((id) => id !== undefined);
	const now = turns.at(-1);
	// One turn on record is no round (and `lastIndexOf` would count from the end).
	if (now === undefined || turns.length < 2) return out;
	const before = turns.lastIndexOf(now, turns.length - 2);
	if (before < 0) return out;
	const round = new Set(turns.slice(before));
	for (const entry of view.session.roster) {
		if (!entry.isMe && !round.has(entry.actorId)) out.add(entry.actorId);
	}
	return out;
}

export type FightMemory = {
	art(key: string): string | undefined;
	/** What a step was last seen to cost; null until one was measured. */
	stepCostMs: number | null;
	heroArt?: Fighter["art"];
};

/** The fight as the shell draws it, or null outside one. */
export function fightFrom(view: PlayView, memory: FightMemory): Fight | null {
	if (!inFight(view.session)) return null;
	const defs = new Map(fightTokens(view).map((token) => [token.id, token.defId]));
	const out = passedOver(view);
	const roster = [...view.session.roster]
		.sort((a, b) => a.ordinal - b.ordinal)
		.map((entry): Fighter => {
			const def = defs.get(entry.actorId);
			const url = def ? memory.art(def) : undefined;
			const art = entry.isMe ? memory.heroArt : url ? { url, pixel: true } : undefined;
			return {
				id: entry.actorId,
				name: entry.name,
				...(art ? { art } : {}),
				mine: entry.isMe,
				active: entry.isCurrent,
				// The roster names who fights, not how they fare; the turn order
				// shows who no longer gets a turn.
				down: out.has(entry.actorId),
			};
		});
	const window = gridWindow(view);
	const cells: Cell[] = [];
	if (window) {
		const taken = new Set([
			cellId(window.prefix, window.hero),
			...(view.sessionTokens ?? []).filter((token) => !token.isMe).map((token) => token.nodeId),
		]);
		for (let row = window.row0; row < window.row0 + window.rows; row += 1) {
			for (let col = window.col0; col < window.col0 + window.cols; col += 1) {
				if (taken.has(cellId(window.prefix, { col, row }))) continue;
				cells.push({ col, row, ...corner(window, { col, row }) });
			}
		}
	}
	const recap = recapOf(view);
	return {
		roster,
		myTurn: view.session.myTurn,
		budget: budgetFrom(view, memory.stepCostMs),
		...(recap ? { recap } : {}),
		cells,
		cellSize: { w: FLOOR.w, h: FLOOR.h },
	};
}

/**
 * The next single step from the hero's cell toward a clicked one: straight
 * or diagonal, whichever closes the gap. Undefined when the hero stands
 * there, stands on no grid, or the world offers no way to that neighbour.
 */
export function stepToward(view: PlayView, goal: GridCell): PlayExit | undefined {
	const window = gridWindow(view);
	if (!window) return undefined;
	const { hero, prefix } = window;
	if (hero.col === goal.col && hero.row === goal.row) return undefined;
	const next = cellId(prefix, {
		col: hero.col + Math.sign(goal.col - hero.col),
		row: hero.row + Math.sign(goal.row - hero.row),
	});
	return view.place?.exits.find((exit) => exit.toNodeId === next);
}
