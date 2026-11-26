import { expect, it, vi } from "vitest";
import { connectSpellkaveMcp } from "./client";

it("uses the latest credential for MCP requests without reconnecting the client", async () => {
	let current: string | null = "initial";
	const calls: { method: string; authorization: string | null }[] = [];
	const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
		if (init?.method === "GET" || init?.method === "DELETE")
			return new Response(null, { status: 405 });
		const request = JSON.parse(String(init?.body));
		calls.push({
			method: request.method,
			authorization: new Headers(init?.headers).get("authorization"),
		});
		if (request.id === undefined) return new Response(null, { status: 202 });
		const result =
			request.method === "initialize"
				? {
						protocolVersion: "2025-03-26",
						capabilities: { tools: {} },
						serverInfo: { name: "test", version: "1" },
					}
				: request.method === "tools/list"
					? { tools: [] }
					: { content: [{ type: "text", text: "ok" }] };
		return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
			headers: { "content-type": "application/json" },
		});
	});
	const client = await connectSpellkaveMcp({
		url: "https://mcp.example/mcp",
		accessToken: "fallback",
		getAccessToken: () => current,
		fetchImpl,
	});
	current = "rotated";
	await client.callTool("spellkave_scene", {});
	expect(calls.filter((c) => c.method === "initialize")).toHaveLength(1);
	expect(calls.find((c) => c.method === "initialize")?.authorization).toBe("Bearer initial");
	expect(calls.at(-1)).toEqual({ method: "tools/call", authorization: "Bearer rotated" });
	current = null;
	await client.callTool("spellkave_scene", {});
	expect(calls.at(-1)?.authorization).toBeNull();
	await client.disconnect();
});
