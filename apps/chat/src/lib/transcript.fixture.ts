import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { emptyUsage } from "./llm/events";

export function fixtureAssistant(
	partial: Partial<AssistantMessage> & Pick<AssistantMessage, "content">,
): AssistantMessage {
	return {
		role: "assistant",
		api: "openai-completions",
		provider: "webllm",
		model: "test",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: 1,
		...partial,
	};
}

export const TRANSCRIPT_FIXTURE: AgentMessage[] = [
	{ role: "user", content: "Look around.", timestamp: 1 },
	fixtureAssistant({
		content: [
			{ type: "text", text: "Checking the scene." },
			{ type: "toolCall", id: "call-1", name: "spellkave_orient", arguments: { brief: true } },
		],
		stopReason: "toolUse",
	}),
	{
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "spellkave_orient",
		content: [{ type: "text", text: '{"place":"stonehill"}' }],
		isError: false,
		timestamp: 2,
	},
	fixtureAssistant({ content: [{ type: "text", text: "You are in Stonehill." }] }),
	fixtureAssistant({
		content: [{ type: "text", text: "partial answer" }],
		stopReason: "aborted",
		errorMessage: "Request was aborted",
	}),
	fixtureAssistant({
		content: [{ type: "text", text: "" }],
		stopReason: "error",
		errorMessage: "model failed",
	}),
];
