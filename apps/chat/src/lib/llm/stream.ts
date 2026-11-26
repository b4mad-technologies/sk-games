import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";

/**
 * Local stand-in for pi-ai's AssistantMessageEventStream.
 * The class is type-only on the package root (`export type` from types.d.ts),
 * so we cannot `new` it from `@earendil-works/pi-ai`. Shape matches
 * `push` / `end` / `result` / async iteration used by pi-agent-core.
 */
export class ChatAssistantStream implements AsyncIterable<AssistantMessageEvent> {
	private readonly queue: AssistantMessageEvent[] = [];
	private readonly waiting: Array<(next: IteratorResult<AssistantMessageEvent>) => void> = [];
	private complete = false;
	private final!: AssistantMessage;
	private readonly finalPromise: Promise<AssistantMessage>;
	private resolveFinal!: (message: AssistantMessage) => void;

	constructor() {
		this.finalPromise = new Promise((resolve) => {
			this.resolveFinal = resolve;
		});
	}

	push(event: AssistantMessageEvent): void {
		if (this.complete) return;
		if (event.type === "done" || event.type === "error") {
			this.complete = true;
			this.final = event.type === "done" ? event.message : event.error;
			this.resolveFinal(this.final);
		}
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	end(result?: AssistantMessage): void {
		this.complete = true;
		if (result !== undefined) {
			this.final = result;
			this.resolveFinal(result);
		}
		while (this.waiting.length > 0) {
			this.waiting.shift()?.({ value: undefined, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
		while (true) {
			if (this.queue.length > 0) {
				const event = this.queue.shift();
				if (event !== undefined) yield event;
			} else if (this.complete) {
				return;
			} else {
				const next = await new Promise<IteratorResult<AssistantMessageEvent>>((resolve) => {
					this.waiting.push(resolve);
				});
				if (next.done) return;
				yield next.value;
			}
		}
	}

	result(): Promise<AssistantMessage> {
		return this.finalPromise;
	}
}
