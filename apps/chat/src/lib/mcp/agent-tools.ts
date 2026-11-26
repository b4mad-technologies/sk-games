import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { getToolContract } from "@spellkave/tool-contracts";
import type { TSchema } from "typebox";
import { typeBoxFromJsonSchema } from "./json-schema.ts";
import { publishToolEvent } from "./tool-events.ts";
import { truncateToolResultJson } from "./truncate.ts";

export interface ListedMcpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface McpToolCaller {
	callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

function parametersFor(tool: ListedMcpTool): TSchema {
	try {
		return getToolContract(tool.name).parameters;
	} catch {
		return typeBoxFromJsonSchema(tool.inputSchema ?? { type: "object", properties: {} });
	}
}

function labelFor(tool: ListedMcpTool): string {
	try {
		return getToolContract(tool.name).label;
	} catch {
		return tool.name;
	}
}

function executionModeFor(tool: ListedMcpTool): AgentTool["executionMode"] {
	try {
		return getToolContract(tool.name).executionMode;
	} catch {
		return undefined;
	}
}

export function mcpToolToAgentTool(tool: ListedMcpTool, caller: McpToolCaller): AgentTool {
	const parameters = parametersFor(tool);
	const executionMode = executionModeFor(tool);
	return {
		name: tool.name,
		label: labelFor(tool),
		description: tool.description ?? tool.name,
		parameters,
		...(executionMode === undefined ? {} : { executionMode }),
		execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
			const args =
				params !== null && typeof params === "object" && !Array.isArray(params)
					? (params as Record<string, unknown>)
					: {};
			const result = await caller.callTool(tool.name, args);
			publishToolEvent({ tool: tool.name, args, result, at: Date.now() });
			const { text } = truncateToolResultJson(result);
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
	};
}

export function mcpToolsToAgentTools(
	tools: readonly ListedMcpTool[],
	caller: McpToolCaller,
	allowlist: ReadonlySet<string>,
): AgentTool[] {
	return tools
		.filter((tool) => allowlist.has(tool.name))
		.map((tool) => mcpToolToAgentTool(tool, caller));
}
