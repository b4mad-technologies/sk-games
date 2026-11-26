import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	AssistantMessage,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "@earendil-works/pi-ai";

export type TranscriptUserItem = {
	kind: "user";
	id: string;
	text: string;
};

export type TranscriptAssistantItem = {
	kind: "assistant";
	id: string;
	text: string;
	streaming: boolean;
	aborted: boolean;
	error: string | null;
};

export type TranscriptToolItem = {
	kind: "tool";
	id: string;
	toolCallId: string;
	toolName: string;
	args: unknown;
	resultText: string | null;
	isError: boolean;
	pending: boolean;
};

export type TranscriptItem = TranscriptUserItem | TranscriptAssistantItem | TranscriptToolItem;

export function userText(message: UserMessage): string {
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("");
}

export function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/**
 * Extension point for ThinkingContent blocks on an assistant message.
 * The in-browser WebLLM provider never emits thinking_* events or these blocks.
 */
export function thinkingContentBlocks(message: AssistantMessage): ThinkingContent[] {
	return message.content.filter((block): block is ThinkingContent => block.type === "thinking");
}

export function formatJson(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return String(value);
	}
}

function toolCallsOf(message: AssistantMessage): ToolCall[] {
	return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

function toolResultText(message: ToolResultMessage): string {
	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
	if (text.length > 0) return text;
	return formatJson(message.details);
}

function pushAssistant(
	items: TranscriptItem[],
	message: AssistantMessage,
	results: Map<string, ToolResultMessage>,
	streaming: boolean,
	index: { n: number },
): void {
	const text = assistantText(message);
	const aborted = message.stopReason === "aborted";
	const error =
		message.stopReason === "error" ? (message.errorMessage ?? "The model returned an error") : null;
	if (text.length > 0 || streaming || aborted || error !== null) {
		items.push({
			kind: "assistant",
			id: streaming ? "streaming" : `assistant-${index.n++}`,
			text,
			streaming,
			aborted,
			error,
		});
	}
	for (const call of toolCallsOf(message)) {
		const result = results.get(call.id);
		items.push({
			kind: "tool",
			id: `tool-${call.id || String(index.n++)}`,
			toolCallId: call.id,
			toolName: call.name,
			args: call.arguments,
			resultText: result === undefined ? null : toolResultText(result),
			isError: result?.isError ?? false,
			pending: result === undefined,
		});
	}
}

export function buildTranscript(
	messages: AgentMessage[],
	streaming?: AgentMessage,
): TranscriptItem[] {
	const results = new Map<string, ToolResultMessage>();
	for (const message of messages) {
		if (message.role === "toolResult") results.set(message.toolCallId, message);
	}

	const items: TranscriptItem[] = [];
	const index = { n: 0 };
	for (const message of messages) {
		if (message.role === "user") {
			items.push({ kind: "user", id: `user-${index.n++}`, text: userText(message) });
		} else if (message.role === "assistant") {
			pushAssistant(items, message, results, false, index);
		}
	}

	if (streaming !== undefined && streaming.role === "assistant") {
		pushAssistant(items, streaming, results, true, index);
	}

	return items;
}
