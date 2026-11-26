import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { bindWorldToAgent, formatWorldStatus } from "./world.ts";

function stubTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
	};
}

describe("bindWorldToAgent", () => {
	it("attaches curated tools from a successful connect", async () => {
		const tools = [stubTool("spellkave_orient"), stubTool("spellkave_scene")];
		const agent = { tools: [] as AgentTool[] };
		const result = await bindWorldToAgent({
			agent,
			accessToken: "tok",
			connect: async () => ({
				agentTools: () => tools,
				disconnect: async () => undefined,
			}),
		});
		expect(result.status).toEqual({ kind: "connected", toolCount: 2 });
		expect(agent.tools).toEqual(tools);
		expect(formatWorldStatus(result.status)).toBe("World: connected, 2 tools");
	});

	it("leaves the agent without tools when connect fails", async () => {
		const agent = { tools: [] as AgentTool[] };
		const result = await bindWorldToAgent({
			agent,
			accessToken: "tok",
			connect: async () => {
				throw new Error("gateway down");
			},
		});
		expect(result.status).toEqual({ kind: "disconnected", reason: "gateway down" });
		expect(result.client).toBeNull();
		expect(agent.tools).toEqual([]);
		expect(formatWorldStatus(result.status)).toBe("World: not connected (gateway down)");
	});
});
