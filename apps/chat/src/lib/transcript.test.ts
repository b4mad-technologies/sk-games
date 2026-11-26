import { describe, expect, it } from "vitest";
import { buildTranscript, thinkingContentBlocks } from "./transcript";
import { fixtureAssistant, TRANSCRIPT_FIXTURE } from "./transcript.fixture";

describe("buildTranscript", () => {
	it("renders user, assistant text, tool results, abort, and error rows", () => {
		const items = buildTranscript(TRANSCRIPT_FIXTURE);
		expect(items.map((item) => item.kind)).toEqual([
			"user",
			"assistant",
			"tool",
			"assistant",
			"assistant",
			"assistant",
		]);
		expect(items[0]).toMatchObject({ kind: "user", text: "Look around." });
		expect(items[2]).toMatchObject({
			kind: "tool",
			toolName: "spellkave_orient",
			pending: false,
			isError: false,
			resultText: '{"place":"stonehill"}',
		});
		expect(items[4]).toMatchObject({ kind: "assistant", aborted: true, text: "partial answer" });
		expect(items[5]).toMatchObject({ kind: "assistant", error: "model failed" });
	});

	it("marks a tool row pending until the toolResult arrives", () => {
		const items = buildTranscript(TRANSCRIPT_FIXTURE.slice(0, 2));
		expect(items[2]).toMatchObject({ kind: "tool", pending: true, resultText: null });
	});
});

describe("thinkingContentBlocks", () => {
	it("is the unused ThinkingContent extension point", () => {
		expect(
			thinkingContentBlocks(fixtureAssistant({ content: [{ type: "text", text: "hi" }] })),
		).toEqual([]);
		expect(
			thinkingContentBlocks(
				fixtureAssistant({
					content: [
						{ type: "thinking", thinking: "plan" },
						{ type: "text", text: "hi" },
					],
				}),
			),
		).toEqual([{ type: "thinking", thinking: "plan" }]);
	});
});
