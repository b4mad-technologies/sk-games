import { getToolContract } from "@spellkave/tool-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type ListedMcpTool, mcpToolsToAgentTools, mcpToolToAgentTool } from "./agent-tools.ts";
import { attachMcpTools } from "./attach.ts";
import { curatedToolSet, DEFAULT_CURATED_MCP_TOOLS } from "./curated.ts";
import toolsList from "./fixtures/tools-list.json";
import { typeBoxFromJsonSchema } from "./json-schema.ts";
import { listToolEvents, resetToolEvents } from "./tool-events.ts";
import {
	TOOL_RESULT_ARRAY_LIMIT,
	TOOL_RESULT_STRING_LIMIT,
	truncateToolResultJson,
} from "./truncate.ts";

const listed = (toolsList as { result: { tools: ListedMcpTool[] } }).result.tools;

afterEach(() => {
	resetToolEvents();
});

describe("json-schema to TypeBox", () => {
	it("converts a real tools/list schema (unknown tool)", () => {
		const unknown = listed.find((tool) => tool.name === "demo_unknown_tool");
		expect(unknown).toBeDefined();
		const schema = typeBoxFromJsonSchema(unknown?.inputSchema) as {
			type?: string;
			properties?: Record<string, { type?: string }>;
			required?: string[];
		};
		expect(schema.type).toBe("object");
		const properties = (schema as { properties?: Record<string, { type?: string }> }).properties;
		expect(properties?.q?.type).toBe("string");
		expect(properties?.n?.type).toBe("integer");
		const required = (schema as { required?: string[] }).required;
		expect(required).toContain("q");
	});

	it("converts spellkave_orient's recorded inputSchema", () => {
		const orient = listed.find((tool) => tool.name === "spellkave_orient");
		const schema = typeBoxFromJsonSchema(orient?.inputSchema) as {
			type?: string;
			properties?: Record<string, { type?: string }>;
		};
		expect(schema.type).toBe("object");
		const properties = (schema as { properties?: Record<string, { type?: string }> }).properties;
		expect(properties?.cursor?.type).toBe("string");
		expect(properties?.limit?.type).toBe("number");
	});
});

describe("mcp tools to AgentTool", () => {
	it("uses tool-contracts TypeBox when the name matches", () => {
		const orient = listed.find((tool) => tool.name === "spellkave_orient");
		expect(orient).toBeDefined();
		const agentTool = mcpToolToAgentTool(orient as ListedMcpTool, {
			callTool: async () => ({}),
		});
		expect(agentTool.parameters).toBe(getToolContract("spellkave_orient").parameters);
		expect(agentTool.label).toBe(getToolContract("spellkave_orient").label);
	});

	it("falls back to JSON-schema conversion for unknown names", () => {
		const unknown = listed.find((tool) => tool.name === "demo_unknown_tool");
		const agentTool = mcpToolToAgentTool(unknown as ListedMcpTool, {
			callTool: async () => ({}),
		});
		expect(agentTool.parameters).not.toBeUndefined();
		expect((agentTool.parameters as { type?: string }).type).toBe("object");
	});

	it("keeps the curated allowlist and drops the rest", () => {
		const tools = mcpToolsToAgentTools(listed, { callTool: async () => ({}) }, curatedToolSet());
		expect(tools.map((tool) => tool.name).sort()).toEqual(
			["spellkave_end_turn", "spellkave_orient", "spellkave_scene"].sort(),
		);
		expect(DEFAULT_CURATED_MCP_TOOLS).toContain("spellkave_move");
		expect(tools.some((tool) => tool.name === "spellkave_feedback")).toBe(false);
		expect(tools.some((tool) => tool.name === "demo_unknown_tool")).toBe(false);
	});

	it("returns truncated text in content and full JSON in details, and publishes the event", async () => {
		const full = {
			ok: true,
			items: Array.from({ length: 25 }, (_, index) => `item-${index}`),
			blurb: "x".repeat(TOOL_RESULT_STRING_LIMIT + 10),
		};
		const scene = listed.find((tool) => tool.name === "spellkave_scene") as ListedMcpTool;
		const agentTool = mcpToolToAgentTool(scene, {
			callTool: async () => full,
		});
		const result = await agentTool.execute("call-1", {});
		expect(result.details).toEqual(full);
		const text = result.content[0];
		expect(text?.type).toBe("text");
		if (text?.type === "text") {
			expect(text.text).toContain("truncated");
			expect(text.text).not.toContain("x".repeat(TOOL_RESULT_STRING_LIMIT + 1));
			expect(text.text.split("item-24").length).toBe(1);
		}
		expect(listToolEvents()).toHaveLength(1);
		expect(listToolEvents()[0]?.result).toEqual(full);
		expect(listToolEvents()[0]?.tool).toBe("spellkave_scene");
	});
});

describe("truncateToolResultJson", () => {
	it("keeps small payloads intact", () => {
		const { text, truncated } = truncateToolResultJson({ a: 1, b: ["x"] });
		expect(truncated).toBe(false);
		expect(text).toContain('"a": 1');
	});

	it("caps arrays at the constant limit", () => {
		const { text, truncated } = truncateToolResultJson({
			items: Array.from({ length: TOOL_RESULT_ARRAY_LIMIT + 3 }, (_, i) => i),
		});
		expect(truncated).toBe(true);
		expect(text).toContain("truncated");
		expect(text).toContain(String(TOOL_RESULT_ARRAY_LIMIT - 1));
		expect(text).not.toContain(String(TOOL_RESULT_ARRAY_LIMIT + 2));
	});
});

describe("attachMcpTools", () => {
	it("assigns curated AgentTools onto the agent", () => {
		const tools = mcpToolsToAgentTools(listed, { callTool: async () => ({}) }, curatedToolSet());
		const agent = { tools: [] as typeof tools };
		const client = {
			agentTools: () => tools,
		};
		attachMcpTools(agent, client);
		expect(agent.tools).toEqual(tools);
	});
});
