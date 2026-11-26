import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { CatalogEntry } from "./llm/catalog";

export const SYSTEM_PROMPT = [
	"You are playing a character in the Spellkave world.",
	"The listed tools are how you see, move, and act. Do not invent world outcomes.",
	"Call spellkave_orient first when you lack a current situation.",
	"Act through tools (scene, affordances, move, end turn); do not narrate actions as if they already happened.",
	"Speak to the player as the character only after tools return.",
].join("\n");

export function catalogToModel(entry: CatalogEntry): Model<"openai-completions"> {
	return {
		id: entry.id,
		name: entry.label,
		api: "openai-completions",
		provider: "webllm",
		baseUrl: "webllm://local",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: entry.contextWindow,
		maxTokens: entry.maxTokens,
	};
}

export function createChatAgent(
	streamFn: StreamFn,
	model: Model<"openai-completions">,
	initialMessages: AgentMessage[] = [],
): Agent {
	return new Agent({
		streamFn,
		initialState: {
			model,
			systemPrompt: SYSTEM_PROMPT,
			tools: [],
			messages: initialMessages,
		},
	});
}
