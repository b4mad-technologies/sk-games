import { describe, expect, it } from "vitest";
import type { PlayView } from "../../../../play/src/lib/play-view";
import {
	cellId,
	cellOf,
	FLOOR,
	fighterSpots,
	fightFrom,
	fightSentence,
	gridWindow,
	passedOver,
	recapOf,
	stepToward,
} from "./fight-from-view";
import room from "./fixtures/common-room.view.json";
import recorded from "./fixtures/fight-my-turn.view.json";

// Recorded from a local world on 2026-11-15: the cellar fight, the hero's
// turn. A 10 x 10 session grid; the hero on cell 0,0, a rat on 1,0 and a
// swarm on 1,1.
const view = recorded as unknown as PlayView;
const GRID = "session_grid_3";
const memory = { art: () => undefined, stepCostMs: null };

/** The same fight with the hero (and optionally their token) somewhere else. */
function heroAt(col: number, row: number, moveToken = true): PlayView {
	const id = cellId(GRID, { col, row });
	return {
		...view,
		place: view.place && { ...view.place, id },
		sessionTokens: (view.sessionTokens ?? []).map((token) =>
			token.isMe && moveToken ? { ...token, nodeId: id } : token,
		),
	};
}

describe("the session grid on the floor", () => {
	it("reads a cell from a node id", () => {
		expect(cellOf("session_grid_3/c_2_1")).toEqual({ prefix: GRID, col: 2, row: 1 });
		expect(cellOf("elven_mini/inn/cellar")).toBeNull();
		expect(cellOf(undefined)).toBeNull();
	});

	it("shows a window of the floor's size on a larger grid", () => {
		expect(gridWindow(view)).toEqual({
			prefix: GRID,
			col0: 0,
			row0: 0,
			cols: FLOOR.cols,
			rows: FLOOR.rows,
			hero: { col: 0, row: 0 },
		});
	});

	it("is no grid outside a fight", () => {
		expect(gridWindow(room as unknown as PlayView)).toBeNull();
		expect(fightFrom(room as unknown as PlayView, memory)).toBeNull();
	});

	it("keeps the fight in the window and moves it only as far as the hero needs", () => {
		// Two cells up, the rats on rows 0 and 1 still fit beside the hero.
		expect(gridWindow(heroAt(2, 3))).toMatchObject({ col0: 0, row0: 0 });
		// Far away, the hero is held and the rats fall out of the window.
		const far = gridWindow(heroAt(9, 9));
		expect(far).toMatchObject({ col0: 1, row0: 6, hero: { col: 9, row: 9 } });
		expect([...fighterSpots(heroAt(9, 9), far as NonNullable<typeof far>).keys()]).toEqual([
			view.hero.actorId,
		]);
	});

	it("stands every fighter on their cell, north further back", () => {
		const window = gridWindow(view);
		const spots = fighterSpots(view, window as NonNullable<typeof window>);
		expect(spots.get("168")).toEqual({ x: 48, y: 261 });
		expect(spots.get("137")).toEqual({ x: 96, y: 261 });
		expect(spots.get("139")).toEqual({ x: 96, y: 234 });
	});

	it("trusts the hero's place over a token that lags one view behind", () => {
		const lagging = heroAt(0, 1, false);
		const window = gridWindow(lagging);
		expect(window?.hero).toEqual({ col: 0, row: 1 });
		expect(fighterSpots(lagging, window as NonNullable<typeof window>).get("168")).toEqual({
			x: 48,
			y: 234,
		});
	});
});

describe("fightFrom", () => {
	const fight = fightFrom(view, memory);

	it("lists the turn order with whose turn it is", () => {
		expect(fight?.roster.map((fighter) => [fighter.name, fighter.mine, fighter.active])).toEqual([
			["Borin", true, true],
			["Cellar Rat 1", false, false],
			["Cellar Rat Swarm", false, false],
		]);
		expect(fight?.myTurn).toBe(true);
		expect(fight?.round).toBeUndefined();
	});

	it("gives a fighter the sprite of the creature the world names", () => {
		const pictured = fightFrom(view, {
			art: (key) => `sprite:${key}`,
			stepCostMs: null,
			heroArt: { url: "hero.webp", pixel: true },
		});
		expect(pictured?.roster[0]?.art?.url).toBe("hero.webp");
		expect(pictured?.roster[1]?.art?.url).toMatch(/^sprite:srd\/creature\//);
	});

	it("offers every free cell of the window and none a fighter stands on", () => {
		expect(fight?.cells).toHaveLength(FLOOR.cols * FLOOR.rows - 3);
		const taken = fight?.cells.filter(
			(cell) => (cell.col === 0 && cell.row === 0) || (cell.col === 1 && cell.row <= 1),
		);
		expect(taken).toEqual([]);
		expect(fight?.cellSize).toEqual({ w: FLOOR.w, h: FLOOR.h });
	});

	it("shows the turn budget the world reports, one pip per channel, in the order of a turn", () => {
		expect(fight?.budget.map((chip) => [chip.label, chip.left, chip.of])).toEqual([
			["Move", 1, 1],
			["Action", 1, 1],
			["Bonus", 1, 1],
			["Object", 1, 1],
			["Reaction", 1, 1],
		]);
	});

	it("counts movement in steps once a step was seen to cost something", () => {
		// The world's numbers are a millisecond off a whole step (cost 1001, 4999 left).
		const steps = (remainingMs: number) =>
			fightFrom(
				{
					...view,
					economyBudget: view.economyBudget && {
						...view.economyBudget,
						channels: view.economyBudget.channels.map((channel) =>
							channel.channelId === "srd/economy_channel/movement"
								? { ...channel, remainingMs }
								: channel,
						),
					},
				},
				{ ...memory, stepCostMs: 1001 },
			)?.budget.find((chip) => chip.label === "Steps");
		expect(steps(6000)).toMatchObject({ left: 6, of: 6 });
		expect(steps(4999)).toMatchObject({ left: 5, of: 6 });
		expect(steps(0)).toMatchObject({ left: 0, of: 6 });
	});
});

describe("stepToward", () => {
	it("takes the offered way to the neighbour that closes the gap", () => {
		expect(stepToward(view, { col: 0, row: 3 })?.toNodeId).toBe(cellId(GRID, { col: 0, row: 1 }));
		expect(stepToward(view, { col: 4, row: 4 })?.toNodeId).toBe(cellId(GRID, { col: 1, row: 1 }));
		expect(stepToward(view, { col: 5, row: 0 })?.toNodeId).toBe(cellId(GRID, { col: 1, row: 0 }));
	});

	it("is nothing on the hero's own cell or where the world offers no way", () => {
		expect(stepToward(view, { col: 0, row: 0 })).toBeUndefined();
		const walled = { ...view, place: view.place && { ...view.place, exits: [] } };
		expect(stepToward(walled, { col: 0, row: 3 })).toBeUndefined();
	});
});

describe("recapOf", () => {
	const me = { id: view.hero.actorId, self: true as const };
	const rat = { id: "137", name: "Cellar Rat 1" };
	const swarm = { id: "139", name: "Cellar Rat Swarm" };
	const pass = (id: string, from: object, to: object) => ({
		id,
		tick: 1,
		kind: "turn_transition",
		summary: "The turn passes.",
		fields: { sessionId: "3", fromActor: from, toActor: to },
	});
	const said = (id: string, summary: string, kind = "self_hit") => ({ id, tick: 1, kind, summary });
	const round = [
		said("e0", "You swing and miss.", "trace_addressed"),
		pass("e1", me, rat),
		said("e2", "You take 6 damage from Cellar Rat 1 — 1 HP left."),
		pass("e3", rat, swarm),
		said("e4", "Cellar Rat Swarm's Melee Attack misses you.", "trace_addressed"),
		pass("e5", swarm, me),
	];
	const withEvents = (events: object[], myTurn = true): PlayView =>
		({ ...view, session: { ...view.session, myTurn }, events }) as unknown as PlayView;

	it("tells what the others did between the hero's turns, without the turn changes", () => {
		expect(recapOf(withEvents(round))).toEqual([
			"You take 6 damage from Cellar Rat 1 — 1 HP left.",
			"Cellar Rat Swarm's Melee Attack misses you.",
		]);
	});

	it("starts at the opening of the fight when the hero has not acted yet", () => {
		const opening = [
			said("o0", "Something older."),
			{ id: "o1", tick: 1, kind: "session_lifecycle", summary: "A session opens." },
			...round.slice(2),
		];
		expect(recapOf(withEvents(opening))).toHaveLength(2);
	});

	it("is not told once something happened after the turn came back, or on another's turn", () => {
		const later = [...round, said("e6", "You spend 1 Second Wind Uses — 0 left.")];
		expect(recapOf(withEvents(later))).toBeUndefined();
		expect(recapOf(withEvents(round, false))).toBeUndefined();
		expect(fightFrom(withEvents(round), memory)?.recap).toHaveLength(2);
	});
});

describe("fightSentence", () => {
	const life = (id: string, sessionId: string, phase: string, participants: string[]) =>
		({
			id,
			tick: 1,
			kind: "session_lifecycle",
			summary: "A session.",
			fields: { sessionId, phase, participants },
		}) as unknown as PlayView["events"][number];
	const events = [
		life("a", "3", "opened", ["168", "137", "139"]),
		life("b", "3", "closed", []),
		life("c", "4", "opened", ["168"]),
		life("d", "4", "closed", []),
		life("e", "9", "closed", []),
	];
	const say = (index: number) => {
		const entry = events[index];
		return entry ? fightSentence(entry, events) : "none";
	};

	it("calls a session of several a fight, at its opening and its end", () => {
		expect(say(0)).toBe("A fight begins: 3 fighters.");
		expect(say(1)).toBe("The fight is over.");
	});

	it("leaves a journey of one, and a closing without its opening, to the world's words", () => {
		expect(say(2)).toBeUndefined();
		expect(say(3)).toBeUndefined();
		expect(say(4)).toBeUndefined();
		const hit = { id: "h", tick: 1, kind: "self_hit", summary: "Ouch." };
		expect(fightSentence(hit, events)).toBeUndefined();
	});

	it("knows a fight by a foe's turn when the opening is gone (after a reload)", () => {
		const turn = {
			id: "t",
			tick: 1,
			kind: "turn_transition",
			summary: "",
			fields: {
				sessionId: "9",
				fromActor: { id: "23", name: "Crypt Warden" },
				toActor: { id: "168", self: true },
			},
		} as unknown as PlayView["events"][number];
		const closing = events[4];
		if (!closing) throw new Error("no closing");
		expect(fightSentence(closing, [turn, closing])).toBe("The fight is over.");
	});
});

describe("who the turn order passes over", () => {
	const HERO = view.hero.actorId;
	const [RAT, SWARM] = view.session.roster.filter((entry) => !entry.isMe).map((e) => e.actorId);
	const side = (id: string) => (id === HERO ? { id, self: true } : { id, name: "Somebody" });
	/** The fight with these turns on record, in order: who the turn passed to. */
	function withTurns(...to: string[]): PlayView {
		const events = to.map((id, index) => ({
			id: `turn:${index}`,
			tick: 300 + index,
			kind: "turn_transition",
			summary: "The turn passes.",
			fields: {
				sessionId: view.session.id,
				fromActor: side(to[index - 1] ?? id),
				toActor: side(id),
			},
		}));
		return { ...view, events: events as unknown as PlayView["events"] };
	}

	it("names nobody before a full round is on record", () => {
		expect(passedOver(view).size).toBe(0);
		expect(passedOver(withTurns(RAT as string, SWARM as string, HERO)).size).toBe(0);
	});

	it("counts the turn the record starts in the middle of", () => {
		// After a reload: the hero ended a turn, the swarm had its own, back to the hero.
		const turns = [HERO, SWARM, HERO] as string[];
		const later = withTurns(...turns);
		// `withTurns` passes the first turn from its own fighter (an opening); drop that one.
		const events = later.events.slice(1);
		expect([...passedOver({ ...later, events } as PlayView)]).toEqual([RAT]);
	});

	it("names nobody while everybody gets their turn", () => {
		const turns = [HERO, RAT, SWARM, HERO] as string[];
		expect(passedOver(withTurns(...turns)).size).toBe(0);
	});

	it("names the fighter who had no turn in the last full round", () => {
		// Seen live 2026-11-16: the dead one is skipped from the next round on.
		const turns = [HERO, RAT, SWARM, HERO, SWARM, HERO] as string[];
		expect([...passedOver(withTurns(...turns))]).toEqual([RAT]);
	});

	it("reads only the turns of the running fight", () => {
		const other = withTurns(...([HERO, SWARM, HERO] as string[]));
		const events = other.events.map((entry) => ({
			...entry,
			fields: { ...entry.fields, sessionId: "another" },
		}));
		expect(passedOver({ ...other, events } as PlayView).size).toBe(0);
	});

	it("shows them as down on the turn order", () => {
		const turns = [HERO, RAT, SWARM, HERO, SWARM, HERO] as string[];
		const fight = fightFrom(withTurns(...turns), memory);
		expect(fight?.roster.filter((fighter) => fighter.down).map((fighter) => fighter.id)).toEqual([
			RAT,
		]);
	});
});

describe("several fighters on one cell", () => {
	it("stands them side by side, so that each can be clicked", () => {
		const hero = view.hero.actorId;
		const others = (view.sessionTokens ?? []).filter((token) => !token.isMe);
		const cell = others[0]?.nodeId ?? "";
		const crowded: PlayView = {
			...view,
			sessionTokens: (view.sessionTokens ?? []).map((token) =>
				token.isMe ? token : { ...token, nodeId: cell },
			),
		};
		const window = gridWindow(crowded);
		if (!window) throw new Error("no grid");
		const spots = fighterSpots(crowded, window);
		const [a, b] = others.map((token) => spots.get(token.actorId));
		expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0))).toBeGreaterThanOrEqual(20);
		expect(a?.y).toBe(b?.y);
		// Alone on their cell, the hero stands in its middle as before.
		expect(spots.get(hero)).toEqual(fighterSpots(view, window).get(hero));
	});
});
