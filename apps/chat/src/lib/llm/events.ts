import type {
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	StopReason,
	TextContent,
	ToolCall,
	Usage,
} from "@earendil-works/pi-ai";

export type OpenAiToolCallDelta = {
	index?: number;
	id?: string;
	function?: { name?: string; arguments?: string };
};

export type OpenAiChatChunk = {
	id?: string;
	model?: string;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	choices?: Array<{
		finish_reason?: string | null;
		delta?: {
			content?: string | null;
			tool_calls?: OpenAiToolCallDelta[];
		};
	}>;
};

type ScratchToolCall = ToolCall & { partialArgs: string };

export type ChunkReducer = {
	output: AssistantMessage;
	started: boolean;
	finished: boolean;
	textBlock: TextContent | null;
	toolCallsByIndex: Map<number, ScratchToolCall>;
	toolCallsById: Map<string, ScratchToolCall>;
};

export function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function createChunkReducer(model: Model<"openai-completions">): ChunkReducer {
	return {
		output: {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
		},
		started: false,
		finished: false,
		textBlock: null,
		toolCallsByIndex: new Map(),
		toolCallsById: new Map(),
	};
}

function parseStreamingJson(partial: string): ToolCall["arguments"] {
	if (partial.length === 0) return {};
	try {
		const parsed: unknown = JSON.parse(partial);
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as ToolCall["arguments"];
		}
		return {};
	} catch {
		return {};
	}
}

function applyUsage(output: AssistantMessage, usage: OpenAiChatChunk["usage"]): void {
	if (usage === undefined) return;
	const input = usage.prompt_tokens ?? 0;
	const outputTokens = usage.completion_tokens ?? 0;
	const total = usage.total_tokens ?? input + outputTokens;
	output.usage = {
		...emptyUsage(),
		input,
		output: outputTokens,
		totalTokens: total,
	};
}

function mapStopReason(reason: string): { stopReason: StopReason; errorMessage?: string } {
	switch (reason) {
		case "stop":
			return { stopReason: "stop" };
		case "length":
			return { stopReason: "length" };
		case "tool_calls":
			return { stopReason: "toolUse" };
		default:
			return { stopReason: "error", errorMessage: `Provider finish_reason: ${reason}` };
	}
}

function contentIndex(
	output: AssistantMessage,
	block: AssistantMessage["content"][number],
): number {
	return output.content.indexOf(block);
}

function ensureStarted(state: ChunkReducer, events: AssistantMessageEvent[]): void {
	if (state.started) return;
	state.started = true;
	events.push({ type: "start", partial: state.output });
}

function ensureTextBlock(state: ChunkReducer, events: AssistantMessageEvent[]): TextContent {
	if (state.textBlock) return state.textBlock;
	const block: TextContent = { type: "text", text: "" };
	state.textBlock = block;
	state.output.content.push(block);
	events.push({
		type: "text_start",
		contentIndex: contentIndex(state.output, block),
		partial: state.output,
	});
	return block;
}

function ensureToolCall(
	state: ChunkReducer,
	delta: OpenAiToolCallDelta,
	events: AssistantMessageEvent[],
): ScratchToolCall {
	const streamIndex = typeof delta.index === "number" ? delta.index : 0;
	let block = state.toolCallsByIndex.get(streamIndex);
	if (block === undefined && delta.id) {
		block = state.toolCallsById.get(delta.id);
	}
	if (block === undefined) {
		block = {
			type: "toolCall",
			id: delta.id ?? "",
			name: delta.function?.name ?? "",
			arguments: {},
			partialArgs: "",
		};
		state.toolCallsByIndex.set(streamIndex, block);
		if (delta.id) state.toolCallsById.set(delta.id, block);
		state.output.content.push(block);
		events.push({
			type: "toolcall_start",
			contentIndex: contentIndex(state.output, block),
			partial: state.output,
		});
		return block;
	}
	if (delta.id && !block.id) {
		block.id = delta.id;
		state.toolCallsById.set(delta.id, block);
	}
	if (delta.function?.name && !block.name) {
		block.name = delta.function.name;
	}
	return block;
}

function closeOpenBlocks(state: ChunkReducer, events: AssistantMessageEvent[]): void {
	for (const block of state.output.content) {
		const index = contentIndex(state.output, block);
		if (block.type === "text") {
			events.push({
				type: "text_end",
				contentIndex: index,
				content: block.text,
				partial: state.output,
			});
		} else if (block.type === "toolCall") {
			const scratch = block as ScratchToolCall;
			scratch.arguments = parseStreamingJson(scratch.partialArgs);
			delete (scratch as { partialArgs?: string }).partialArgs;
			events.push({
				type: "toolcall_end",
				contentIndex: index,
				toolCall: scratch,
				partial: state.output,
			});
		}
	}
}

function fail(
	state: ChunkReducer,
	reason: Extract<StopReason, "aborted" | "error">,
	message: string,
): AssistantMessageEvent[] {
	const events: AssistantMessageEvent[] = [];
	ensureStarted(state, events);
	state.output.stopReason = reason;
	state.output.errorMessage = message;
	state.finished = true;
	events.push({ type: "error", reason, error: state.output });
	return events;
}

/** Apply one OpenAI-style streaming chunk. Returns protocol events (may be empty). */
export function reduceChunk(state: ChunkReducer, chunk: OpenAiChatChunk): AssistantMessageEvent[] {
	if (state.finished) return [];
	const events: AssistantMessageEvent[] = [];
	ensureStarted(state, events);
	if (chunk.id) state.output.responseId ||= chunk.id;
	if (typeof chunk.model === "string" && chunk.model.length > 0) {
		state.output.responseModel ||= chunk.model;
	}
	applyUsage(state.output, chunk.usage);
	const choice = chunk.choices?.[0];
	if (choice === undefined) return events;

	if (choice.finish_reason) {
		const mapped = mapStopReason(choice.finish_reason);
		state.output.stopReason = mapped.stopReason;
		if (mapped.errorMessage) state.output.errorMessage = mapped.errorMessage;
	}

	const delta = choice.delta;
	if (delta?.content) {
		const block = ensureTextBlock(state, events);
		block.text += delta.content;
		events.push({
			type: "text_delta",
			contentIndex: contentIndex(state.output, block),
			delta: delta.content,
			partial: state.output,
		});
	}
	if (delta?.tool_calls) {
		for (const toolDelta of delta.tool_calls) {
			const block = ensureToolCall(state, toolDelta, events);
			const argDelta = toolDelta.function?.arguments ?? "";
			if (argDelta.length > 0) {
				block.partialArgs += argDelta;
				block.arguments = parseStreamingJson(block.partialArgs);
			}
			events.push({
				type: "toolcall_delta",
				contentIndex: contentIndex(state.output, block),
				delta: argDelta,
				partial: state.output,
			});
		}
	}
	return events;
}

/** Successful stream end: close open blocks and emit `done` (or `error` on provider error). */
export function reduceStreamEnd(state: ChunkReducer): AssistantMessageEvent[] {
	if (state.finished) return [];
	const events: AssistantMessageEvent[] = [];
	ensureStarted(state, events);
	closeOpenBlocks(state, events);
	if (state.output.stopReason === "error") {
		state.finished = true;
		events.push({
			type: "error",
			reason: "error",
			error: state.output,
		});
		return events;
	}
	const reason = state.output.stopReason;
	if (reason !== "stop" && reason !== "length" && reason !== "toolUse") {
		state.output.stopReason = "error";
		state.output.errorMessage ||= `Unexpected stop reason: ${reason}`;
		state.finished = true;
		events.push({ type: "error", reason: "error", error: state.output });
		return events;
	}
	state.finished = true;
	events.push({ type: "done", reason, message: state.output });
	return events;
}

export function reduceAbort(state: ChunkReducer): AssistantMessageEvent[] {
	if (state.finished) return [];
	return fail(state, "aborted", "Request was aborted");
}

export function reduceError(state: ChunkReducer, message: string): AssistantMessageEvent[] {
	if (state.finished) return [];
	return fail(state, "error", message);
}
