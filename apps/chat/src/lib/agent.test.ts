import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./agent.ts";

describe("SYSTEM_PROMPT", () => {
	it("stays short and tells the model to orient then act via tools", () => {
		const lines = SYSTEM_PROMPT.split("\n").filter((line) => line.trim() !== "");
		expect(lines.length).toBeLessThanOrEqual(12);
		expect(SYSTEM_PROMPT).toMatch(/spellkave_orient/);
		expect(SYSTEM_PROMPT).toMatch(/tools/);
	});
});
