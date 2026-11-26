import type { AgentTool } from "@earendil-works/pi-agent-core";

export type ToolHost = { tools: AgentTool[] } | { state: { tools: AgentTool[] } };

/**
 * Wire curated MCP tools onto a pi-agent-core Agent (or a test double).
 */
export function attachMcpTools(agent: ToolHost, client: { agentTools(): AgentTool[] }): void {
	const tools = client.agentTools();
	if ("state" in agent) {
		agent.state.tools = tools;
		return;
	}
	agent.tools = tools;
}
