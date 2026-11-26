import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Context, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai";
import {
	CreateWebWorkerMLCEngine,
	type InitProgressReport,
	type WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import type { CatalogEntry } from "./catalog";
import {
	createChunkReducer,
	type OpenAiChatChunk,
	reduceAbort,
	reduceChunk,
	reduceError,
	reduceStreamEnd,
} from "./events";
import { toOpenAiMessages } from "./messages";
import type { BrowserModelProvider, LoadProgress } from "./provider";
import { ChatAssistantStream } from "./stream";

function toOpenAiTools(tools: Tool[] | undefined, supportsTools: boolean) {
	if (!supportsTools || tools === undefined || tools.length === 0) {
		return undefined;
	}
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters as unknown as Record<string, unknown>,
		},
	}));
}

function pushAll(stream: ChatAssistantStream, events: ReturnType<typeof reduceChunk>): void {
	for (const event of events) {
		stream.push(event);
	}
}

class WebLlmProvider implements BrowserModelProvider {
	readonly id: string;
	readonly label: string;
	readonly supportsTools: boolean;
	private engine: WebWorkerMLCEngine | undefined;
	private worker: Worker | undefined;
	private readonly entry: CatalogEntry;

	constructor(entry: CatalogEntry) {
		this.entry = entry;
		this.id = entry.id;
		this.label = entry.label;
		this.supportsTools = entry.supportsTools;
	}

	async load(onProgress: (progress: LoadProgress) => void): Promise<void> {
		if (this.engine !== undefined) return;
		const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
		this.worker = worker;
		try {
			this.engine = await CreateWebWorkerMLCEngine(worker, this.entry.id, {
				initProgressCallback: (report: InitProgressReport) => {
					onProgress({ progress: report.progress, text: report.text });
				},
			});
		} catch (cause) {
			worker.terminate();
			this.worker = undefined;
			this.engine = undefined;
			throw cause;
		}
	}

	createStreamFn(): StreamFn {
		const streamFn: StreamFn = (model, context, options) => {
			const stream = new ChatAssistantStream();
			void this.runStream(model, context, options, stream);
			return stream as unknown as ReturnType<StreamFn>;
		};
		return streamFn;
	}

	dispose(): void {
		const engine = this.engine;
		this.engine = undefined;
		if (engine !== undefined) {
			void engine.unload().catch(() => undefined);
		}
		this.worker?.terminate();
		this.worker = undefined;
	}

	private async runStream(
		model: Model<Api>,
		context: Context,
		options: SimpleStreamOptions | undefined,
		stream: ChatAssistantStream,
	): Promise<void> {
		const reducer = createChunkReducer(
			model.api === "openai-completions"
				? (model as Model<"openai-completions">)
				: {
						...model,
						api: "openai-completions",
					},
		);
		const abort = () => {
			try {
				this.engine?.interruptGenerate();
			} catch {
				// interruptGenerate is best-effort; the abort event still ends the stream.
			}
		};
		options?.signal?.addEventListener("abort", abort, { once: true });
		try {
			const engine = this.engine;
			if (engine === undefined) {
				pushAll(stream, reduceError(reducer, "Model is not loaded"));
				stream.end();
				return;
			}
			if (options?.signal?.aborted) {
				pushAll(stream, reduceAbort(reducer));
				stream.end();
				return;
			}
			const completions = await engine.chat.completions.create({
				messages: toOpenAiMessages(context),
				stream: true,
				temperature: options?.temperature,
				max_tokens: options?.maxTokens ?? this.entry.maxTokens,
				tools: toOpenAiTools(context.tools, this.supportsTools),
			});
			for await (const chunk of completions) {
				if (options?.signal?.aborted) {
					pushAll(stream, reduceAbort(reducer));
					stream.end();
					return;
				}
				pushAll(stream, reduceChunk(reducer, chunk as OpenAiChatChunk));
			}
			if (options?.signal?.aborted) {
				pushAll(stream, reduceAbort(reducer));
			} else {
				pushAll(stream, reduceStreamEnd(reducer));
			}
			stream.end();
		} catch (cause) {
			if (options?.signal?.aborted) {
				pushAll(stream, reduceAbort(reducer));
			} else {
				const message = cause instanceof Error ? cause.message : String(cause);
				pushAll(stream, reduceError(reducer, message));
			}
			stream.end();
		} finally {
			options?.signal?.removeEventListener("abort", abort);
		}
	}
}

export function createWebLlmProvider(entry: CatalogEntry): BrowserModelProvider {
	return new WebLlmProvider(entry);
}
