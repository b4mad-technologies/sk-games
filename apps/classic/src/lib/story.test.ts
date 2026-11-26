import { describe, expect, it } from "vitest";
import { inTickOrder, type StoryLine, withResults } from "./story";

const world = (key: string, tick: number): StoryLine => ({ key, tick, who: "", text: key });
const texts = (lines: StoryLine[]) => lines.map((line) => line.text);

describe("withResults", () => {
	// Seen live 2026-11-14: "You end your turn." was noted after the foe's
	// reply had arrived and landed below it.
	it("keeps a result above the world's reply to it", () => {
		const lines = [world("turn to you", 77), world("turn to rat", 78), world("rat hits", 78)];
		const story = withResults(lines, [{ id: 1, after: "turn to you", text: "You end your turn." }]);
		expect(texts(story)).toEqual(["turn to you", "You end your turn.", "turn to rat", "rat hits"]);
	});

	it("keeps results with one anchor in click order", () => {
		const story = withResults(
			[world("a", 1)],
			[
				{ id: 1, after: "a", text: "attack" },
				{ id: 2, after: "a", text: "end turn" },
			],
		);
		expect(texts(story)).toEqual(["a", "attack", "end turn"]);
	});

	it("leads with a result that has no anchor or lost it", () => {
		const story = withResults(
			[world("b", 2)],
			[
				{ id: 1, after: null, text: "first" },
				{ id: 2, after: "gone", text: "second" },
			],
		);
		expect(texts(story)).toEqual(["first", "second", "b"]);
	});

	it("marks results", () => {
		const [line] = withResults([], [{ id: 7, after: null, text: "x" }]);
		expect(line).toMatchObject({ key: "r7", result: true });
	});
});

describe("inTickOrder", () => {
	it("sorts by tick and keeps arrival order within a tick", () => {
		expect(texts(inTickOrder([world("b", 2), world("a1", 1), world("a2", 1)]))).toEqual([
			"a1",
			"a2",
			"b",
		]);
	});
});
