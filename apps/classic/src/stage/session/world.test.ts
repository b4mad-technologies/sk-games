import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenPlaySessionArgs, PlaySessionHandle } from "../../../../play/src/lib/play-session";
import type { PlayView } from "../../../../play/src/lib/play-view";
import recorded from "./fixtures/common-room.view.json";
import classQuestion from "./fixtures/creation-class.view.json";
import nameOpen from "./fixtures/creation-name.view.json";
import reopened from "./fixtures/creation-reopened.view.json";
import fightView from "./fixtures/fight-my-turn.view.json";
import {
	ARRIVE_TIMEOUT_MS,
	answerText,
	type LiveDeps,
	LiveWorld,
	walkingText,
} from "./world.svelte";

const view = recorded as unknown as PlayView;
const atClass = classQuestion as unknown as PlayView;
const atReopened = reopened as unknown as PlayView;
const atName = nameOpen as unknown as PlayView;
const inFight = fightView as unknown as PlayView;
const config = { url: "http://node", db: "db", actorId: view.hero.actorId, token: "t", slug: "s" };

/** A session that answers what the test tells it to. */
function session(answer: { message: string; outcome: string }) {
	let args: OpenPlaySessionArgs | undefined;
	const sent: string[] = [];
	const handle = {
		move: vi.fn(async (exit: { handle: string }) => {
			sent.push(`move ${exit.handle}`);
			return answer.message;
		}),
		act: vi.fn(async (action: { id: string }, words?: string) => {
			sent.push(words ? `act ${action.id} "${words}"` : `act ${action.id}`);
			return answer.message;
		}),
		endTurn: vi.fn(async () => {
			sent.push("end turn");
			return answer.message;
		}),
		react: vi.fn(async (handle: string, rev: string, intent: string) => {
			sent.push(`react ${handle} ${rev} ${intent}`);
			return answer.message;
		}),
		selectItem: vi.fn(async (item: { id: string } | null) => {
			sent.push(`look ${item?.id ?? "away"}`);
		}),
		disconnect: vi.fn(),
	} as unknown as PlaySessionHandle;
	const deps: LiveDeps = {
		open: async (opened) => {
			args = opened;
			return handle;
		},
		lastOutcome: () => answer.outcome,
		srdArt: async (id) => `sprite:${id}`,
		worldArt: null,
		reference: async () => undefined,
		storage: null,
	};
	return {
		deps,
		sent,
		handle,
		show: (next: PlayView) => {
			args?.onView(next);
			flushSync();
		},
	};
}

async function opened(answer = { message: "Done.", outcome: "happened" }, first = view) {
	const fake = session(answer);
	const world = new LiveWorld(config, fake.deps);
	await Promise.resolve();
	await Promise.resolve();
	fake.show(first);
	return { world, ...fake };
}

const way = (world: LiveWorld) => {
	const thing = world.stage.things.find((entry) => entry.kind === "way");
	if (!thing) throw new Error("the recorded place has no way out");
	return thing;
};

const somebody = (world: LiveWorld) => {
	const thing = world.stage.things.find(
		(entry) => entry.kind === "thing" && entry.offers.length > 0,
	);
	if (!thing) throw new Error("the recorded place has nothing with an offer");
	return thing;
};

const asker = (world: LiveWorld) => {
	const thing = world.stage.things.find((entry) => entry.asks);
	if (!thing) throw new Error("nobody asks in the recorded place");
	return thing;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LiveWorld", () => {
	it("shows a waiting stage until the world answers, then the place", async () => {
		const fake = session({ message: "", outcome: "happened" });
		const world = new LiveWorld(config, fake.deps);
		expect(world.stage.place.name).toBe("Connecting…");
		expect(world.stage.hero.drafting).toBe(true);
		await Promise.resolve();
		await Promise.resolve();
		fake.show(view);
		expect(world.stage.place.name).toBe(view.place?.name);
	});

	it("does not replay what was said before the app opened", async () => {
		const { world } = await opened();
		expect(world.stage.lines.length).toBeGreaterThan(0);
		expect(world.stage.lines.every((line) => line.old)).toBe(true);
	});

	it("sends an offer and puts the world's answer on the thing", async () => {
		const { world, sent } = await opened({ message: "You look closely.", outcome: "happened" });
		const thing = somebody(world);
		const offer = thing.offers[0];
		await world.attempt(thing.id, offer?.id ?? "");
		expect(sent).toEqual([`act ${offer?.id}`]);
		const last = world.stage.lines.at(-1);
		expect(last).toMatchObject({ kind: "result", text: "You look closely.", thingId: thing.id });
		expect(last?.old).toBeUndefined();
		expect(world.stage.busy).toBeNull();
	});

	it("remembers a refusal on the offer, and forgets it when the world agrees", async () => {
		const answer = { message: "It will not budge.", outcome: "rejected" };
		const { world } = await opened(answer);
		const thing = somebody(world);
		const offerId = thing.offers[0]?.id ?? "";
		await world.attempt(thing.id, offerId);
		expect(somebody(world).offers[0]?.refused).toBe("It will not budge.");
		expect(world.stage.lines.at(-1)).toMatchObject({ kind: "refusal", thingId: thing.id });

		answer.message = "It gives way.";
		answer.outcome = "happened";
		await world.attempt(thing.id, offerId);
		expect(somebody(world).offers[0]?.refused).toBeUndefined();
	});

	it("walks through a way out and says the hero is on the way until the place changes", async () => {
		const { world, sent, show } = await opened({ message: "You set out.", outcome: "happened" });
		const out = way(world);
		await world.attempt(out.id, "go");
		expect(sent).toEqual([`move ${out.id.slice("way:".length)}`]);
		expect(world.stage.busy?.text).toBe(`On the way to ${out.name}…`);

		show({ ...view, place: view.place && { ...view.place, id: "somewhere/else" } });
		expect(world.stage.busy).toBeNull();
	});

	it("gives the wait up when the hero never arrives", async () => {
		const { world } = await opened({ message: "You set out.", outcome: "happened" });
		const out = way(world);
		await world.attempt(out.id, "go");
		vi.advanceTimersByTime(ARRIVE_TIMEOUT_MS + 1);
		flushSync();
		expect(world.stage.busy).toBeNull();
		expect(world.stage.lines.at(-1)?.text).toContain("did not end");
	});

	it("remembers a refused way and does not wait for an arrival", async () => {
		const { world } = await opened({ message: "The door is locked.", outcome: "rejected" });
		const out = way(world);
		await world.attempt(out.id, "go");
		expect(world.stage.busy).toBeNull();
		expect(way(world).offers[0]?.refused).toBe("The door is locked.");
	});

	it("says so when the answer gets lost, without calling it the world's no", async () => {
		const { world, handle } = await opened();
		vi.mocked(handle.act).mockRejectedValueOnce(new Error("socket closed"));
		const thing = somebody(world);
		await world.attempt(thing.id, thing.offers[0]?.id ?? "");
		expect(world.stage.lines.at(-1)?.text).toContain("socket closed");
		expect(somebody(world).offers[0]?.refused).toBeUndefined();
	});

	it("disconnects on close", async () => {
		const { world, handle } = await opened();
		world.close();
		expect(handle.disconnect).toHaveBeenCalled();
	});

	it("turns to somebody on Talk without sending anything, and away again", async () => {
		const { world, sent } = await opened();
		const aldwin = asker(world);
		await world.attempt(aldwin.id, "stage:talk");
		expect(sent).toEqual([]);
		expect(world.stage.talk).toMatchObject({ speakerId: aldwin.id, freeSpeech: true });
		world.talkTo(null);
		flushSync();
		expect(world.stage.talk).toBeNull();
	});

	it("gives a named answer, bound to the question, and hints that the asker thinks", async () => {
		const { world, handle, sent } = await opened({ message: "", outcome: "happened" });
		const aldwin = asker(world);
		world.talkTo(aldwin.id);
		flushSync();
		const round = world.stage.talk;
		await world.answer(round?.id ?? "", round?.answers[1]?.id ?? "");
		expect(sent).toHaveLength(1);
		expect(vi.mocked(handle.act).mock.calls[0]?.[0].semanticContext).toEqual({
			source_ref: `entity:${aldwin.id}`,
			occurrence_id: round?.id,
		});
		expect(world.stage.busy?.text).toBe(`${aldwin.name} is thinking…`);
		vi.advanceTimersByTime(20_001);
		flushSync();
		expect(world.stage.busy).toBeNull();
		// Nobody answered: the story says so, the wait does not just end.
		expect(world.stage.lines.at(-1)).toMatchObject({
			kind: "result",
			text: `${aldwin.name} has not answered.`,
		});
	});

	it("keeps its own notes of what the hero answered, and of the reply", async () => {
		const stored = new Map<string, string>();
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			removeItem: (key: string) => void stored.delete(key),
		};
		const fake = session({ message: "", outcome: "happened" });
		const world = new LiveWorld(config, { ...fake.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		fake.show(view);
		const aldwin = asker(world);
		world.talkTo(aldwin.id);
		flushSync();
		const round = world.stage.talk;
		const picked = round?.answers[0];
		await world.answer(round?.id ?? "", picked?.id ?? "");
		flushSync();
		expect(world.stage.hero.said).toEqual([{ who: aldwin.name, said: picked?.label }]);
		// The asker's next sentence is the reply to it.
		fake.show({
			...view,
			speech: [
				...view.speech,
				{
					...(view.speech[0] as PlayView["speech"][number]),
					id: "reply:1",
					speakerId: aldwin.id,
					mine: false,
					text: "Good. The hatch is off the stairs.",
				},
			],
		});
		expect(world.stage.hero.said).toEqual([
			{ who: aldwin.name, said: picked?.label, reply: "Good. The hatch is off the stairs." },
		]);
		// Kept in the browser: the notes are there when the page opens again.
		const second = session({ message: "", outcome: "happened" });
		const again = new LiveWorld(config, { ...second.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		second.show(view);
		expect(again.stage.hero.said).toHaveLength(1);
	});

	it("says free words to the partner", async () => {
		const { world, sent } = await opened({ message: "", outcome: "happened" });
		world.talkTo(asker(world).id);
		await world.say("  Good morning.  ");
		expect(sent).toEqual([
			`act factored:srd/speak-to:target:${config.actorId}:entity:6 "Good morning."`,
		]);
	});

	it("forgets the partner who is no longer in the place", async () => {
		const { world, show } = await opened();
		world.talkTo(asker(world).id);
		show({ ...view, occupants: view.occupants.filter((occupant) => occupant.id !== "6") });
		expect(world.stage.talk).toBeNull();
	});

	it("runs hero creation as a guided talk: answer, wait for the next question", async () => {
		const { world, sent, show } = await opened({ message: "", outcome: "happened" }, atClass);
		const round = world.stage.talk;
		expect(round?.question).toContain("Which class?");
		expect(
			world.stage.things.every((thing) => thing.kind === "way" || thing.offers.length === 0),
		).toBe(true);
		await world.answer(round?.id ?? "", round?.answers[0]?.id ?? "");
		expect(sent).toHaveLength(1);

		// The question closed and no new one is open: the DM thinks, and the
		// outline the DM sent last stays up.
		show({
			...atClass,
			manipulationContext: {
				...atClass.manipulationContext,
				prompts: [],
			} as PlayView["manipulationContext"],
		});
		expect(world.stage.busy?.text).toContain("is thinking");
		expect(world.stage.talk?.input).toBeUndefined();
		expect(world.stage.talk?.outline?.[0]?.label).toBe("Class");

		show(atReopened);
		expect(world.stage.busy).toBeNull();
		expect(world.stage.talk?.question).toContain("Which fighting style?");
	});

	it("sends the typed name through the DM's own form", async () => {
		const { world, handle } = await opened({ message: "", outcome: "happened" }, atName);
		expect(world.stage.talk?.input?.label).toBe("Name");
		await world.say("Borin");
		const call = vi.mocked(handle.act).mock.calls[0];
		expect(call?.[0].actionId).toBe("dm/creation/input/name");
		expect(call?.[0].targetRef).toBe("entity:6");
		expect(call?.[3]).toEqual({ name: "Borin" });
	});

	it("steps back and forward with the DM's commands, without a line in the story", async () => {
		const { world, handle } = await opened(
			{ message: "Nothing you notice changes.", outcome: "quiet" },
			atReopened,
		);
		const lines = world.stage.lines.length;
		await world.back();
		await world.forward();
		expect(vi.mocked(handle.act).mock.calls.map((call) => call[0].actionId)).toEqual([
			"dm/creation/back",
			"dm/creation/forward",
		]);
		expect(world.stage.lines).toHaveLength(lines);
	});

	it("names the place of a fight also when the app opens in the middle of it", async () => {
		const stored = new Map<string, string>();
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			removeItem: (key: string) => void stored.delete(key),
		};
		const first = session({ message: "", outcome: "happened" });
		new LiveWorld(config, { ...first.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		first.show(view);
		// A reload: the first view is the fight, whose place is a grid cell.
		const second = session({ message: "", outcome: "happened" });
		const again = new LiveWorld(config, { ...second.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		second.show(inFight);
		expect(again.stage.place.name).toBe(view.place?.name);
		// Without the store the top line can only say that it is a fight.
		const { world } = await opened(undefined, inFight);
		expect(world.stage.place.name).toBe("A fight");
	});

	it("plays a fight on the floor: no way tags, the fighters on their cells", async () => {
		const { world } = await opened(undefined, inFight);
		expect(world.stage.fight?.myTurn).toBe(true);
		expect(world.stage.things.map((thing) => [thing.kind, thing.name, thing.x, thing.y])).toEqual([
			["self", "Borin", 48, 261],
			["creature", "Cellar Rat 1", 96, 261],
			["creature", "Cellar Rat Swarm", 96, 234],
		]);
		const rat = world.stage.things[1];
		expect(rat?.offers.filter((offer) => offer.lead).map((offer) => offer.label)).toContain(
			"Melee Attack",
		);
	});

	it("ends the turn without a line in the story", async () => {
		const { world, sent } = await opened({ message: "next: 137", outcome: "happened" }, inFight);
		const lines = world.stage.lines.length;
		await world.endTurn();
		expect(sent).toEqual(["end turn"]);
		expect(world.stage.lines).toHaveLength(lines);
	});

	/** The fight view with the hero on another cell, with a way on north. */
	function onCell(row: number): PlayView {
		const id = `session_grid_3/c_0_${row}`;
		const north = inFight.place?.exits.find((exit) => exit.label === "north");
		return {
			...inFight,
			place: inFight.place && {
				...inFight.place,
				id,
				exits: north
					? [{ ...north, handle: `s:exit:n${row}`, toNodeId: `session_grid_3/c_0_${row + 1}` }]
					: [],
			},
			economyBudget: inFight.economyBudget && {
				...inFight.economyBudget,
				channels: inFight.economyBudget.channels.map((channel) =>
					channel.channelId === "srd/economy_channel/movement"
						? { ...channel, remainingMs: 6000 - row * 1000 }
						: channel,
				),
			},
		};
	}

	it("walks to a clicked cell one offered step after the other and counts the steps left", async () => {
		const { world, handle, sent, show } = await opened(
			{ message: "", outcome: "happened" },
			onCell(0),
		);
		let row = 0;
		vi.mocked(handle.move).mockImplementation(async (exit) => {
			sent.push(`move ${exit.handle}`);
			row += 1;
			show(onCell(row));
			return "";
		});
		await world.step(0, 2);
		expect(sent).toEqual(["move s:exit:n0", "move s:exit:n1"]);
		expect(world.stage.place.id).toBe("session_grid_3/c_0_2");
		expect(world.stage.fight?.budget.find((chip) => chip.label === "Steps")).toMatchObject({
			left: 4,
			of: 6,
		});
		expect(world.stage.busy).toBeNull();
	});

	it("stops the walk at the first step the world refuses", async () => {
		const { world, sent } = await opened(
			{ message: "Something is in the way.", outcome: "rejected" },
			onCell(0),
		);
		await world.step(0, 3);
		expect(sent).toEqual(["move s:exit:n0"]);
		expect(world.stage.lines.at(-1)).toMatchObject({
			kind: "refusal",
			text: "Something is in the way.",
		});
	});

	it("stops between two steps when asked", async () => {
		const { world, handle, sent, show } = await opened(
			{ message: "", outcome: "happened" },
			onCell(0),
		);
		let row = 0;
		vi.mocked(handle.move).mockImplementation(async (exit) => {
			sent.push(`move ${exit.handle}`);
			row += 1;
			show(onCell(row));
			world.stop();
			return "";
		});
		await world.step(0, 3);
		expect(sent).toHaveLength(1);
	});

	it("looks at a thing of the pack through the session, and offers what its detail lists", async () => {
		const { world, sent, show } = await opened();
		const item = view.pack[0];
		if (!item) throw new Error("the recorded pack is empty");
		expect(world.stage.pack[0]).toMatchObject({ name: item.name, offers: [] });
		world.inspect(item.id);
		expect(sent).toEqual([`look ${item.id}`]);

		const entity = item.id.replace(/^i:/, "");
		const own = {
			...(view.actions[0] as PlayView["actions"][number]),
			id: "own",
			targetRef: `item:${entity}`,
		};
		const other = { ...own, id: "other", targetRef: "item:someone-else" };
		show({
			...view,
			itemDetail: {
				id: item.id,
				entityId: entity,
				kind: "Item",
				slot: null,
				description: "A broad blade.",
				definitionRef: "srd/weapon/greatsword",
				facts: [],
				verbs: [own, other],
			},
		});
		await vi.waitFor(() =>
			expect(world.stage.pack[0]?.art?.url).toBe("sprite:srd/weapon/greatsword"),
		);
		expect(world.stage.pack[0]).toMatchObject({ description: "A broad blade." });
		expect(world.stage.pack[0]?.offers.map((offer) => offer.id)).toEqual(["own"]);

		await world.attempt(item.id, "own");
		expect(sent.at(-1)).toBe("act own");

		// Another look takes the detail away; the picture stays in the list.
		show({ ...view });
		expect(world.stage.pack[0]).toMatchObject({ offers: [] });
		expect(world.stage.pack[0]?.art?.url).toBe("sprite:srd/weapon/greatsword");
	});

	it("remembers the places a plate has shown, also across a reload", async () => {
		const stored = new Map<string, string>();
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			removeItem: (key: string) => void stored.delete(key),
		};
		const listed = { ...storage, keys: () => [...stored.keys()] };
		const places = (of: LiveWorld) => of.stage.map.sheets.flatMap((sheet) => sheet.places);
		const first = session({ message: "", outcome: "happened" });
		const world = new LiveWorld(config, { ...first.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		first.show(view);
		const here = view.place?.id;
		expect(world.stage.map.here).toBe(here);
		expect(places(world).find((place) => place.id === here)?.known).toBe(true);
		expect(places(world).length).toBeGreaterThan(1);
		// The hero's own area is the first sheet.
		expect(world.stage.map.sheets[0]?.places.some((place) => place.id === here)).toBe(true);

		// A new page: the plate now draws nothing, the memory still does.
		const second = session({ message: "", outcome: "happened" });
		const again = new LiveWorld(config, { ...second.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		second.show({ ...view, mapSvg: null });
		const ids = (of: LiveWorld) =>
			places(of)
				.map((place) => place.id)
				.sort();
		expect(ids(again)).toEqual(ids(world));

		// The same hero id in a re-staged world: nothing of the old hero's places.
		const third = session({ message: "", outcome: "happened" });
		const fresh = new LiveWorld({ ...config, token: "another-world" }, { ...third.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		third.show({ ...view, mapSvg: null, place: view.place && { ...view.place, exits: [] } });
		expect(ids(fresh)).toEqual([here]);

		// A hero still being made has seen nothing; what was kept is dropped.
		const fourth = session({ message: "", outcome: "happened" });
		const drafted = new LiveWorld(config, { ...fourth.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		fourth.show({ ...view, hero: { ...view.hero, drafting: true } });
		expect(places(drafted)).toEqual([]);
		// Left: the atlas, the place last stood in, the hit points, the story
		// and the names met of the other staging's hero.
		expect([...stored.keys()].map((key) => key.split(".")[1]).toSorted()).toEqual([
			"atlas",
			"ground",
			"hp",
			"met",
			"story",
		]);

		// A store that can list its keys is cleared of the stagings before.
		stored.set(`classic.atlas.${config.slug}.${config.actorId}.old`, "{}");
		stored.set("somebody.elses", "kept");
		const fifth = session({ message: "", outcome: "happened" });
		new LiveWorld(config, { ...fifth.deps, storage: listed });
		expect([...stored.keys()]).toEqual(["somebody.elses"]);
	});

	it("keeps the most hit points seen, so a wounded hero is not whole after a reload", async () => {
		const stored = new Map<string, string>();
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			removeItem: (key: string) => void stored.delete(key),
		};
		const hp = view.hero.hp ?? 0;
		const first = session({ message: "", outcome: "happened" });
		const world = new LiveWorld(config, { ...first.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		first.show(view);
		expect(world.stage.hero.hpMax).toBe(hp);
		const second = session({ message: "", outcome: "happened" });
		const again = new LiveWorld(config, { ...second.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		second.show({ ...view, hero: { ...view.hero, hp: hp - 5 } });
		expect(again.stage.hero).toMatchObject({ hp: hp - 5, hpMax: hp });
	});

	it("floats the change of the hero's hit points up from the hero for a moment", async () => {
		vi.useFakeTimers();
		try {
			const { world, show } = await opened();
			const hp = view.hero.hp ?? 0;
			expect(world.stage.flashes).toEqual([]);
			show({ ...view, hero: { ...view.hero, hp: hp - 7 } });
			expect(world.stage.flashes).toMatchObject([
				{ thingId: view.hero.actorId, text: "−7", tone: "harm" },
			]);
			show({ ...view, hero: { ...view.hero, hp: hp - 2 } });
			expect(world.stage.flashes.at(-1)).toMatchObject({ text: "+5", tone: "good" });
			vi.advanceTimersByTime(2000);
			flushSync();
			expect(world.stage.flashes).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("marks a blow that missed, harm the hero dealt and experience won", async () => {
		const old = { id: "old:1", tick: 1, kind: "xp_gained", summary: "", fields: { amount: 5 } };
		const { world, show } = await opened(undefined, { ...view, events: [old] } as PlayView);
		// What the world reported before the app opened floats nowhere.
		expect(world.stage.flashes).toEqual([]);
		const foe = view.occupants[0];
		const hit = (id: string, amount: number, targetName?: string) => ({
			id,
			tick: 2,
			kind: "dealt_hit",
			summary: "",
			fields: { amount, targetName },
		});
		show({
			...view,
			events: [
				old,
				{ id: "m:1", tick: 2, kind: "trace_addressed", summary: "", traceKind: "srd/attack-miss" },
				hit("d:1", 4, foe?.name),
				hit("d:2", 9, "Nobody here"),
				{ id: "x:1", tick: 2, kind: "xp_gained", summary: "", fields: { amount: 50 } },
			],
		} as PlayView);
		expect(world.stage.flashes.map((flash) => [flash.thingId, flash.text, flash.tone])).toEqual([
			[view.hero.actorId, "miss", "plain"],
			[foe?.id, "−4", "harm"],
			[view.hero.actorId, "+50 XP", "good"],
		]);
	});

	it("keeps the story in the browser, so a reload does not start it empty", async () => {
		const stored = new Map<string, string>();
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			removeItem: (key: string) => void stored.delete(key),
		};
		const first = session({ message: "The lid does not move.", outcome: "happened" });
		const world = new LiveWorld(config, { ...first.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		first.show(view);
		const thing = somebody(world);
		await world.attempt(thing.id, thing.offers[0]?.id ?? "");
		flushSync();
		const told = world.stage.lines.map((line) => line.text);
		expect(told).toContain("The lid does not move.");

		// The page is opened again: the world replays what was said, not what happened.
		const second = session({ message: "", outcome: "happened" });
		const again = new LiveWorld(config, { ...second.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		second.show(view);
		const lines = again.stage.lines;
		expect(lines.map((line) => line.text)).toEqual(told);
		// The past is the past: nothing of it is played on the stage again.
		expect(lines.every((line) => line.old)).toBe(true);
		expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
		// A third opening does not grow the kept story.
		const third = session({ message: "", outcome: "happened" });
		const once = new LiveWorld(config, { ...third.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		third.show(view);
		expect(once.stage.lines.map((line) => line.text)).toEqual(told);
	});

	it("answers a question asked in words only, and keeps the picked words in the story", async () => {
		const context = view.manipulationContext;
		if (context.status !== "ready") throw new Error("the recording has no context");
		// The same room, but the keeper's numbered question has no prompt behind it.
		const asked = { ...view, manipulationContext: { ...context, prompts: [] } } as PlayView;
		const { world, sent } = await opened({ message: "", outcome: "happened" }, asked);
		const keeper = world.stage.things.find((thing) => thing.asks);
		expect(keeper?.offers[0]).toMatchObject({ label: "Answer" });
		world.talkTo(keeper?.id ?? null);
		flushSync();
		const round = world.stage.talk;
		expect(round?.answers.map((answer) => answer.label)).toEqual([
			"The cellar is overrun — I'll clear it.",
			"Not today.",
		]);
		await world.answer(round?.id ?? "", round?.answers[1]?.id ?? "");
		flushSync();
		expect(sent.at(-1)).toMatch(/^act factored:dm\/dialog\/choice\/2:/);
		expect(world.stage.lines.at(-1)).toMatchObject({ kind: "result", text: "Not today." });
	});

	it("shows an open reaction window by the name of its action, and answers it", async () => {
		const { world, show, sent } = await opened(
			{ message: "You strike.", outcome: "happened" },
			inFight,
		);
		expect(world.stage.reaction).toBeUndefined();
		const context = inFight.manipulationContext;
		const action = context.status === "ready" ? context.actions[0] : undefined;
		if (!action) throw new Error("the recorded fight has no actions");
		const reaction = {
			windowKind: "reaction" as const,
			handle: "r0",
			rev: "r1-x",
			originatingActionId: action.actionId,
			originatingActor: inFight.hero.actorId,
			originatingActorName: inFight.hero.name,
			remainingMs: null,
			faces: [],
		};
		show({ ...inFight, reaction });
		expect(world.stage.reaction).toMatchObject({ name: action.displayName });
		await world.react(false);
		expect(sent.at(-1)).toBe("react r0 r1-x pass");
		await world.react(true);
		expect(sent.at(-1)).toBe("react r0 r1-x react");
		show({ ...inFight, reaction: null });
		expect(world.stage.reaction).toBeUndefined();
		await world.react(true);
		expect(sent.filter((line) => line.startsWith("react"))).toHaveLength(2);
	});

	it("remembers what the hero answered in the creation talk, and what a spend left", async () => {
		const stored = new Map<string, string>();
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			removeItem: (key: string) => void stored.delete(key),
		};
		const fake = session({ message: "", outcome: "happened" });
		const world = new LiveWorld(config, { ...fake.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		// The reopened creation view carries an outline with answered steps.
		fake.show(atReopened);
		const picks = [...stored.entries()].find(([key]) => key.startsWith("classic.picks."));
		expect(JSON.parse(picks?.[1] ?? "[]")).toContain("srd/class/fighter");

		// Later, in the world: a spend event says what is left; a rest forgets it.
		const spent = {
			id: "s:1",
			tick: 2,
			kind: "self_resource_spent",
			summary: "",
			fields: { resourceId: "srd/spell_slot_1", amount: 1, newValue: 1 },
		};
		fake.show({ ...view, events: [spent] } as PlayView);
		expect(world.stage.hero.left).toEqual([{ label: "Level 1 spell slots", left: 1 }]);
		// The picks outlive the creation talk.
		expect(stored.has(picks?.[0] ?? "")).toBe(true);
		const rest = {
			id: "5",
			label: "Complete a Long Rest",
			phase: "running",
			description: null,
			progress: 40,
			terminal: false,
			worldTimed: true,
			turnRule: null,
			fields: [],
		};
		const running = {
			state: "ready" as const,
			selected: rest,
			items: [],
			total: 0,
			nextCursor: null,
		};
		fake.show({ ...view, events: [spent], operations: running } as PlayView);
		fake.show({
			...view,
			events: [spent],
			operations: { ...running, selected: { ...rest, terminal: true, progress: 100 } },
		} as PlayView);
		expect(world.stage.hero.left).toEqual([]);
	});

	it("does not play again what was said in a place before the hero came back", async () => {
		const { world, show } = await opened();
		const speech = view.speech.at(-1);
		if (!speech) throw new Error("the recorded view has no speech");
		const newest = Math.max(
			...view.speech.map((row) => row.tick),
			...view.events.map((row) => row.tick),
		);
		const row = (id: string, tick: number) => ({ ...speech, id, tick, text: `said ${id}` });
		show({ ...view, speech: [...view.speech, row("late", newest - 10), row("fresh", newest + 1)] });
		const line = (text: string) => world.stage.lines.find((entry) => entry.text === text);
		expect(line("said late")?.old).toBe(true);
		expect(line("said fresh")?.old).toBeUndefined();
	});

	it("says what still runs in world time, and how far it is", async () => {
		const { world, show } = await opened();
		expect(world.stage.busy).toBeNull();
		const rest = {
			id: "5",
			label: "Complete a Long Rest",
			phase: "running",
			description: null,
			progress: 40,
			terminal: false,
			worldTimed: true,
			turnRule: null,
			fields: [],
		};
		const operations = {
			state: "ready" as const,
			selected: rest,
			items: [],
			total: 0,
			nextCursor: null,
		};
		show({ ...view, operations });
		expect(world.stage.busy).toEqual({ text: "Complete a Long Rest… 40%", stoppable: false });
		show({
			...view,
			operations: { ...operations, selected: { ...rest, terminal: true, progress: 100 } },
		});
		expect(world.stage.busy).toBeNull();
		// The world ends a rest without a word; the story says it is done.
		expect(world.stage.lines.at(-1)).toMatchObject({
			kind: "result",
			text: "Complete a Long Rest: done.",
		});
		// Seen live: the running rest is on the list of what is ongoing, while
		// the detail still describes something that ended.
		show({
			...view,
			operations: {
				...operations,
				selected: { ...rest, id: "4", label: "Activity", terminal: true, progress: 100 },
				items: [{ id: "16", label: "Complete a Long Rest", phase: "active" }],
			},
		});
		expect(world.stage.busy).toEqual({ text: "Complete a Long Rest…", stoppable: false });
	});

	it("shows no area map in a fight", async () => {
		const { world } = await opened(undefined, inFight);
		expect(world.stage.map.sheets).toEqual([]);
		// The top line names the place the fight is in, not the hero's grid cell.
		expect(world.stage.place.name).not.toMatch(/^Cell /);
	});

	it("walks to a place on the map one way after the other and waits for each arrival", async () => {
		const { world, handle, sent, show } = await opened({ message: "", outcome: "happened" });
		const here = view.place?.id ?? "";
		const exit = view.place?.exits.find((entry) => entry.toNodeId && entry.gates.length === 0);
		if (!exit?.toNodeId) throw new Error("the recorded place has no open way");
		const goal = exit.toNodeId;
		vi.mocked(handle.move).mockImplementation(async (moved) => {
			sent.push(`move ${moved.handle}`);
			return "You set off.";
		});
		const walk = world.walkTo(goal);
		await vi.waitFor(() => expect(world.stage.busy?.text).toContain("On the way to"));
		expect(world.stage.busy?.stoppable).toBe(true);
		expect(sent).toEqual([`move ${exit.handle}`]);

		show({ ...view, place: view.place && { ...view.place, id: goal, exits: [] } });
		await walk;
		expect(world.stage.place.id).toBe(goal);
		expect(world.stage.busy).toBeNull();
		expect(here).not.toBe(goal);
	});

	it("counts the places of a walk over several, instead of one leg's percent", () => {
		expect(walkingText("Hamlet Gate", 5, "Crossroads")).toBe(
			"On the way to Hamlet Gate: 5 places to go, now to Crossroads…",
		);
		expect(walkingText("Hamlet Gate", 1, "Hamlet Gate")).toBe("On the way to Hamlet Gate…");
	});

	it("walks on when the tool stopped watching the walk before the arrival", async () => {
		const { world, handle, show } = await opened({ message: "", outcome: "rejected" });
		const exit = view.place?.exits.find((entry) => entry.toNodeId && entry.gates.length === 0);
		if (!exit?.toNodeId) throw new Error("the recorded place has no open way");
		const goal = exit.toNodeId;
		vi.mocked(handle.move).mockResolvedValue(`actor '168' did not reach '${goal}' within 11800ms`);
		const walk = world.walkTo(goal);
		await vi.waitFor(() => expect(world.stage.busy?.text).toContain("On the way to"));
		show({ ...view, place: view.place && { ...view.place, id: goal, exits: [] } });
		await walk;
		expect(world.stage.place.id).toBe(goal);
		// No raw tool sentence in the story, and no refusal kept on the way.
		expect(world.stage.lines.some((line) => line.text.includes("did not reach"))).toBe(false);
		expect(world.stage.lines.some((line) => line.kind === "refusal")).toBe(false);
	});

	it("names what was tried when the world's answer says nothing about it", () => {
		expect(answerText("Complete a Short Rest", "The outcome could not be confirmed.")).toBe(
			"Complete a Short Rest: The outcome could not be confirmed.",
		);
		expect(answerText("Ranged Attack: Cellar Rat 1", "That cannot be done right now.")).toBe(
			"Ranged Attack, Cellar Rat 1: That cannot be done right now.",
		);
		expect(answerText("Complete a Long Rest — You (Ugra)", "Nothing you notice changes.")).toBe(
			"Complete a Long Rest: Nothing you notice changes.",
		);
		// An answer with words of its own stands alone.
		expect(answerText("Melee Attack: Wolf", "You swing at Wolf.")).toBe("You swing at Wolf.");
	});

	it("ends the walk where the world offers no way on", async () => {
		const { world, sent } = await opened();
		const stranded = { ...view, place: view.place && { ...view.place, exits: [] } };
		const { world: lost, sent: none } = await opened(undefined, stranded);
		const goal =
			world.stage.map.sheets
				.flatMap((sheet) => sheet.places)
				.find((place) => place.id !== view.place?.id)?.id ?? "";
		// The second world has no memory of routes; nothing is sent either way.
		await lost.walkTo(goal);
		expect(none).toEqual([]);
		expect(sent).toEqual([]);
	});
});

describe("a page opened between two creation questions", () => {
	it("still shows the outline the DM sent with its last question", async () => {
		const stored = new Map<string, string>();
		const storage = {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			removeItem: (key: string) => void stored.delete(key),
		};
		const first = session({ message: "", outcome: "happened" });
		new LiveWorld(config, { ...first.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		first.show(atReopened);

		const second = session({ message: "", outcome: "happened" });
		const again = new LiveWorld(config, { ...second.deps, storage });
		await Promise.resolve();
		await Promise.resolve();
		// No question is open here, so this view carries no outline of its own.
		second.show(atName);
		expect(again.stage.talk?.outline?.[0]).toMatchObject({ label: "Class", value: "Fighter" });

		// A finished hero's outline is not kept.
		second.show(view);
		expect([...stored.keys()].some((key) => key.startsWith("classic.guide."))).toBe(false);
	});
});
