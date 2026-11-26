import type { AgentTool } from "@earendil-works/pi-agent-core";
import { attachMcpTools, type ToolHost } from "./attach.ts";

export type WorldStatus =
	| { kind: "connected"; toolCount: number }
	| { kind: "disconnected"; reason: string };

export interface WorldClient {
	agentTools(): AgentTool[];
	disconnect(): Promise<void>;
}

export function formatWorldStatus(status: WorldStatus): string {
	if (status.kind === "connected") return `World: connected, ${status.toolCount} tools`;
	return `World: not connected (${status.reason})`;
}

export async function bindWorldToAgent(options: {
	agent: ToolHost;
	accessToken: string;
	url?: string;
	connect: (opts: { accessToken: string; url?: string }) => Promise<WorldClient>;
}): Promise<{ status: WorldStatus; client: WorldClient | null }> {
	try {
		const client = await options.connect({
			accessToken: options.accessToken,
			...(options.url === undefined ? {} : { url: options.url }),
		});
		attachMcpTools(options.agent, client);
		return { status: { kind: "connected", toolCount: client.agentTools().length }, client };
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		return { status: { kind: "disconnected", reason }, client: null };
	}
}
