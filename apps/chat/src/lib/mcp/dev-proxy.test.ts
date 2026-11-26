import { describe, expect, it } from "vitest";
import { MCP_DEV_PROXY_STRIP_HEADERS, prepareMcpProxyRequest } from "./dev-proxy.ts";

function fakeOutgoing() {
	const removed: string[] = [];
	const set: Record<string, string> = {};
	return {
		removed,
		set,
		removeHeader(name: string) {
			removed.push(name);
		},
		setHeader(name: string, value: string) {
			set[name] = value;
		},
	};
}

describe("prepareMcpProxyRequest", () => {
	it("strips Origin and forwarded hop headers, then pins Host", () => {
		const req = fakeOutgoing();
		prepareMcpProxyRequest(req, "mcp.spellkave.com");
		expect(req.removed).toEqual([
			"origin",
			"forwarded",
			"x-forwarded-for",
			"x-forwarded-proto",
			"x-forwarded-host",
			"x-forwarded-port",
			"x-real-ip",
		]);
		expect(req.removed).toEqual([...MCP_DEV_PROXY_STRIP_HEADERS]);
		expect(req.set).toEqual({ host: "mcp.spellkave.com" });
	});
});
