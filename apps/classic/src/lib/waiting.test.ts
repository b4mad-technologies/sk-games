import { describe, expect, it } from "vitest";
import type { PlayView } from "../../../play/src/lib/play-view";
import { answered, heardMark, thinkingLine } from "./waiting";

type Speech = PlayView["speech"][number];

const line = (id: string, speakerId: string, mine: boolean): Speech =>
	({ id, tick: Number(id), text: `words ${id}`, speaker: speakerId, speakerId, mine }) as Speech;

function view(overrides: Partial<PlayView> = {}): PlayView {
	return {
		hero: { actorId: "168", name: "Borin" },
		occupants: [{ id: "6", name: "Aldwin", kind: "person" }],
		speech: [],
		actions: [],
		manipulationContext: { status: "unavailable" },
		session: { inSession: false, myTurn: false, roster: [] },
		...overrides,
	} as unknown as PlayView;
}

const fight = (myTurn: boolean) =>
	({
		inSession: true,
		myTurn,
		currentActorName: "Cellar Rat",
		roster: [
			{ actorId: "168", name: "Borin", isMe: true },
			{ actorId: "137", name: "Cellar Rat", isMe: false },
		],
	}) as unknown as PlayView["session"];

describe("heardMark", () => {
	it("does not change when only the hero's own line arrives", () => {
		const before = view({ speech: [line("1", "6", false)] });
		const after = view({ speech: [line("1", "6", false), line("2", "168", true)] });
		expect(heardMark(after)).toBe(heardMark(before));
	});

	it("does not change when an old line of someone else falls out of the window", () => {
		const before = view({ speech: [line("1", "6", false), line("2", "6", false)] });
		const after = view({ speech: [line("2", "6", false), line("3", "168", true)] });
		expect(heardMark(after)).toBe(heardMark(before));
	});

	it("changes when someone else speaks", () => {
		const before = view({ speech: [line("1", "168", true)] });
		const after = view({ speech: [line("1", "168", true), line("2", "6", false)] });
		expect(answered({ who: "Aldwin", mark: heardMark(before) }, after)).toBe(true);
	});

	it("changes when a question opens", () => {
		const before = view();
		const after = view({
			manipulationContext: {
				status: "ready",
				prompts: [
					{
						occurrenceId: "p1",
						sourceRef: "entity:6",
						consumed: false,
						openedAtTick: 3,
						responseActionIds: [],
					},
				],
			} as unknown as PlayView["manipulationContext"],
		});
		expect(heardMark(after)).not.toBe(heardMark(before));
	});
});

describe("thinkingLine", () => {
	it("says nothing when the player waits for nobody", () => {
		expect(thinkingLine(view(), null)).toBeUndefined();
	});

	it("names whom the hero spoke to", () => {
		expect(thinkingLine(view(), { who: "Aldwin", mark: "" })).toBe("Aldwin is thinking");
	});

	it("names nobody when the words went to everyone", () => {
		expect(thinkingLine(view(), { who: "", mark: "" })).toBe("Waiting for an answer");
	});

	it("names the fighter whose turn it is", () => {
		expect(thinkingLine(view({ session: fight(false) }), null)).toBe("Cellar Rat is thinking");
	});

	it("says nothing on the hero's own turn", () => {
		expect(thinkingLine(view({ session: fight(true) }), null)).toBeUndefined();
	});
});
