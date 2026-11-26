import { describe, expect, it } from "vitest";

import { tryReadGatewayUrl, tryReadMapsUrl } from "./env";

describe("tryReadGatewayUrl", () => {
	it("is null when unset", () => {
		expect(tryReadGatewayUrl({})).toBeNull();
		expect(tryReadGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "" })).toBeNull();
	});

	it("accepts http(s) and returns the origin", () => {
		expect(tryReadGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "https://mcp.spellkave.com/" })).toBe(
			"https://mcp.spellkave.com",
		);
		expect(tryReadGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "http://127.0.0.1:8080/mcp" })).toBe(
			"http://127.0.0.1:8080",
		);
	});

	it("is null for a malformed or non-http(s) URL rather than throwing", () => {
		expect(tryReadGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "not a url" })).toBeNull();
		expect(tryReadGatewayUrl({ VITE_SPELLKAVE_GATEWAY_URL: "ws://127.0.0.1:8080" })).toBeNull();
	});
});

describe("tryReadMapsUrl", () => {
	it("defaults to the hosted maps site when unset, so the hosted build keeps its link", () => {
		expect(tryReadMapsUrl({})).toBe("https://maps.spellkave.com");
		expect(tryReadMapsUrl({ VITE_SPELLKAVE_MAPS_URL: "  " })).toBe("https://maps.spellkave.com");
	});

	it("is null for an explicit off, so a local session can drop the hosted link", () => {
		expect(tryReadMapsUrl({ VITE_SPELLKAVE_MAPS_URL: "off" })).toBeNull();
	});

	it("accepts http(s) and returns the origin", () => {
		expect(tryReadMapsUrl({ VITE_SPELLKAVE_MAPS_URL: "https://maps.spellkave.com/" })).toBe(
			"https://maps.spellkave.com",
		);
		expect(tryReadMapsUrl({ VITE_SPELLKAVE_MAPS_URL: "http://127.0.0.1:5174/?world=x" })).toBe(
			"http://127.0.0.1:5174",
		);
	});

	it("is null for a malformed or non-http(s) URL rather than throwing", () => {
		expect(tryReadMapsUrl({ VITE_SPELLKAVE_MAPS_URL: "maps.spellkave.com" })).toBeNull();
		expect(tryReadMapsUrl({ VITE_SPELLKAVE_MAPS_URL: "javascript:alert(1)" })).toBeNull();
	});

	it("does not read the gateway variable", () => {
		expect(tryReadMapsUrl({ VITE_SPELLKAVE_GATEWAY_URL: "https://mcp.example.test" })).toBe(
			"https://maps.spellkave.com",
		);
	});
});
