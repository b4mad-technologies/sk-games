import { describe, expect, it } from "vitest";
import { unwrapToolResult } from "./unwrap.ts";

describe("unwrapToolResult", () => {
	it("prefers structuredContent", () => {
		expect(
			unwrapToolResult({
				content: [{ type: "text", text: '{"wrong":true}' }],
				structuredContent: { entity_name: "Regdar" },
			}),
		).toEqual({ entity_name: "Regdar" });
	});

	it("parses the first text content block when structuredContent is absent", () => {
		expect(
			unwrapToolResult({
				content: [{ type: "text", text: '{"ok":true}' }],
			}),
		).toEqual({ ok: true });
	});

	it("treats a bare details object as already unwrapped", () => {
		expect(unwrapToolResult({ listing: "complete", items: [] })).toEqual({
			listing: "complete",
			items: [],
		});
	});

	it("returns undefined for unusable values", () => {
		expect(unwrapToolResult(null)).toBeUndefined();
		expect(unwrapToolResult("nope")).toBeUndefined();
		expect(unwrapToolResult({ content: [{ type: "text", text: "not-json" }] })).toBeUndefined();
	});
});
