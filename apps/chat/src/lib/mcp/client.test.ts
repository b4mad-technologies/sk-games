import { describe, expect, it } from "vitest";
import {
	DEFAULT_SPELLKAVE_MCP_URL,
	readMcpResource,
	readMcpUrl,
	resolveMcpRequestUrl,
} from "./url.ts";

describe("readMcpUrl", () => {
	it("defaults to the public player MCP resource", () => {
		expect(readMcpUrl({})).toBe(DEFAULT_SPELLKAVE_MCP_URL);
	});

	it("uses VITE_SPELLKAVE_MCP_URL as the resource, appending /mcp when needed", () => {
		expect(readMcpUrl({ VITE_SPELLKAVE_MCP_URL: "https://127.0.0.1:8443/mcp" })).toBe(
			"https://127.0.0.1:8443/mcp",
		);
		expect(readMcpUrl({ VITE_SPELLKAVE_MCP_URL: "https://127.0.0.1:8443" })).toBe(
			"https://127.0.0.1:8443/mcp",
		);
	});

	it("keeps a relative /mcp URL for the same-origin Vite proxy", () => {
		expect(readMcpUrl({ VITE_SPELLKAVE_MCP_URL: "/mcp" })).toBe("/mcp");
		expect(resolveMcpRequestUrl("/mcp", "https://devbox.example.com")).toBe(
			"https://devbox.example.com/mcp",
		);
	});
});

describe("readMcpResource", () => {
	it("uses the absolute MCP URL as the AuthKit resource", () => {
		expect(readMcpResource({ VITE_SPELLKAVE_MCP_URL: "https://127.0.0.1:8443/mcp" })).toBe(
			"https://127.0.0.1:8443/mcp",
		);
	});

	it("keeps the production aud when the MCP URL is relative", () => {
		expect(readMcpResource({ VITE_SPELLKAVE_MCP_URL: "/mcp" })).toBe(DEFAULT_SPELLKAVE_MCP_URL);
	});

	it("honours VITE_SPELLKAVE_MCP_RESOURCE over the client URL", () => {
		expect(
			readMcpResource({
				VITE_SPELLKAVE_MCP_URL: "/mcp",
				VITE_SPELLKAVE_MCP_RESOURCE: "https://mcp.example.test/mcp",
			}),
		).toBe("https://mcp.example.test/mcp");
	});
});
