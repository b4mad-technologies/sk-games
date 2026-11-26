/**
 * Adapted from @earendil-works/pi-ai@0.80.9 `dist/api/openai-completions.js`
 * (`convertMessages`). Trimmed to the WebLLM Chat Completions subset:
 * system / user / assistant(+tool_calls) / tool. Hosted-provider compat
 * flags (Kimi deferred tools, OpenRouter routing, reasoning_content, …)
 * are intentionally omitted.
 */
import type { Context, Message } from "@earendil-works/pi-ai";

export type OpenAiToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

export type OpenAiChatMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| {
			role: "assistant";
			content: string | null;
			tool_calls?: OpenAiToolCall[];
	  }
	| { role: "tool"; content: string; tool_call_id: string };

function userText(message: Extract<Message, { role: "user" }>): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function assistantPayload(message: Extract<Message, { role: "assistant" }>): {
	content: string | null;
	tool_calls?: OpenAiToolCall[];
} {
	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
	const toolCalls = message.content.filter((block) => block.type === "toolCall");
	const tool_calls =
		toolCalls.length === 0
			? undefined
			: toolCalls.map((call) => ({
					id: call.id,
					type: "function" as const,
					function: {
						name: call.name,
						arguments: JSON.stringify(call.arguments ?? {}),
					},
				}));
	return {
		content: text.length > 0 ? text : tool_calls ? null : "",
		tool_calls,
	};
}

function toolResultText(message: Extract<Message, { role: "toolResult" }>): string {
	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	if (text.length > 0) return text;
	if (message.content.some((block) => block.type === "image")) {
		return "(see attached image)";
	}
	return "(no tool output)";
}

/** pi-ai `Context.messages` → OpenAI Chat Completions messages, including tool results. */
export function toOpenAiMessages(context: Context): OpenAiChatMessage[] {
	const params: OpenAiChatMessage[] = [];
	if (context.systemPrompt) {
		params.push({ role: "system", content: context.systemPrompt });
	}
	for (const message of context.messages) {
		if (message.role === "user") {
			params.push({ role: "user", content: userText(message) });
			continue;
		}
		if (message.role === "assistant") {
			const payload = assistantPayload(message);
			if (
				(payload.content === null || payload.content === "") &&
				payload.tool_calls === undefined
			) {
				continue;
			}
			params.push({ role: "assistant", ...payload });
			continue;
		}
		if (message.role === "toolResult") {
			params.push({
				role: "tool",
				content: toolResultText(message),
				tool_call_id: message.toolCallId,
			});
		}
	}
	return params;
}
