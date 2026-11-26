import { describe, expect, it } from "vitest";

import { readGatewayUrl, tryReadGatewayUrl } from "./env";

describe("readGatewayUrl", () => {
	it("requires VITE_SPELLKAVE_GATEWAY_URL", () => {
		expect(() => readGatewayUrl({})).toThrow(/VITE_SPELLKAVE_GATEWAY_URL is required/);
		expect(tryReadGatewayUrl({})).toBeNull();
	});

	it("accepts http(s) and returns origin", () => {
		expect(readGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "https://mcp.spellkave.com/" })).toBe(
			"https://mcp.spellkave.com",
		);
		expect(readGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "http://127.0.0.1:8080/mcp" })).toBe(
			"http://127.0.0.1:8080",
		);
	});

	it("rejects non-http schemes", () => {
		expect(() => readGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "ws://127.0.0.1:8080" })).toThrow(
			/http\(s\)/,
		);
	});
});
