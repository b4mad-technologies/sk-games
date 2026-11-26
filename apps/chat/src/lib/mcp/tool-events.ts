export interface McpToolEvent {
	tool: string;
	args: unknown;
	result: unknown;
	at: number;
}

const listeners = new Set<(event: McpToolEvent) => void>();
const events: McpToolEvent[] = [];

export function publishToolEvent(event: McpToolEvent): void {
	events.push(event);
	for (const listener of listeners) listener(event);
}

export function subscribeToolEvents(listener: (event: McpToolEvent) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function listToolEvents(): readonly McpToolEvent[] {
	return events;
}

export function resetToolEvents(): void {
	events.length = 0;
	listeners.clear();
}
