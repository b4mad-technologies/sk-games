import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	createChunkReducer,
	type OpenAiChatChunk,
	reduceAbort,
	reduceChunk,
	reduceStreamEnd,
} from "./events";

const model: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test",
	api: "openai-completions",
	provider: "webllm",
	baseUrl: "webllm://local",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 256,
};

function typesOf(events: { type: string }[]): string[] {
	return events.map((event) => event.type);
}

function run(chunks: OpenAiChatChunk[]) {
	const state = createChunkReducer(model);
	const events = chunks.flatMap((chunk) => reduceChunk(state, chunk));
	events.push(...reduceStreamEnd(state));
	return { state, events };
}

describe("chunk reducer", () => {
	it("maps a plain text stream", () => {
		const { events, state } = run([
			{ choices: [{ delta: { content: "Hello" } }] },
			{ choices: [{ delta: { content: " world" }, finish_reason: "stop" }] },
			{ usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
		]);
		expect(typesOf(events)).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_delta",
			"text_end",
			"done",
		]);
		const done = events.at(-1);
		expect(done?.type).toBe("done");
		if (done?.type !== "done") throw new Error("expected done");
		expect(done.reason).toBe("stop");
		expect(done.message.content).toEqual([{ type: "text", text: "Hello world" }]);
		expect(state.output.usage.input).toBe(4);
		expect(state.output.usage.output).toBe(2);
		expect(state.output.usage.totalTokens).toBe(6);
	});

	it("maps one complete tool call", () => {
		const { events } = run([
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									function: { name: "lookup", arguments: '{"city":"Paris"}' },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);
		expect(typesOf(events)).toEqual([
			"start",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		const end = events.find((event) => event.type === "toolcall_end");
		if (end?.type !== "toolcall_end") throw new Error("expected toolcall_end");
		expect(end.toolCall).toMatchObject({
			type: "toolCall",
			id: "call_1",
			name: "lookup",
			arguments: { city: "Paris" },
		});
		const done = events.at(-1);
		if (done?.type !== "done") throw new Error("expected done");
		expect(done.reason).toBe("toolUse");
	});

	it("joins a tool call split across chunks", () => {
		const { events } = run([
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, id: "call_2", function: { name: "lookup", arguments: '{"ci' } },
							],
						},
					},
				],
			},
			{
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: 'ty":"Paris"}' } }],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);
		expect(typesOf(events)).toEqual([
			"start",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		const end = events.find((event) => event.type === "toolcall_end");
		if (end?.type !== "toolcall_end") throw new Error("expected toolcall_end");
		expect(end.toolCall.arguments).toEqual({ city: "Paris" });
		expect(end.partial.content).toHaveLength(1);
	});

	it("emits an aborted error event", () => {
		const state = createChunkReducer(model);
		const events = [
			...reduceChunk(state, { choices: [{ delta: { content: "Hi" } }] }),
			...reduceAbort(state),
		];
		expect(typesOf(events)).toEqual(["start", "text_start", "text_delta", "error"]);
		const error = events.at(-1);
		if (error?.type !== "error") throw new Error("expected error");
		expect(error.reason).toBe("aborted");
		expect(error.error.stopReason).toBe("aborted");
		expect(reduceStreamEnd(state)).toEqual([]);
	});
});
