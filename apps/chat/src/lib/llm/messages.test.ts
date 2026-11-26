import type { Context } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { toOpenAiMessages } from "./messages";

describe("toOpenAiMessages", () => {
	it("maps system, user, assistant, and toolResult roles", () => {
		const context: Context = {
			systemPrompt: "Be brief.",
			messages: [
				{ role: "user", content: "Hi", timestamp: 1 },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "calling" },
						{ type: "toolCall", id: "c1", name: "lookup", arguments: { q: "x" } },
					],
					api: "openai-completions",
					provider: "webllm",
					model: "test",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: "c1",
					toolName: "lookup",
					content: [{ type: "text", text: "ok" }],
					isError: false,
					timestamp: 3,
				},
			],
		};
		expect(toOpenAiMessages(context)).toEqual([
			{ role: "system", content: "Be brief." },
			{ role: "user", content: "Hi" },
			{
				role: "assistant",
				content: "calling",
				tool_calls: [
					{
						id: "c1",
						type: "function",
						function: { name: "lookup", arguments: '{"q":"x"}' },
					},
				],
			},
			{ role: "tool", content: "ok", tool_call_id: "c1" },
		]);
	});
});
