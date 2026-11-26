import { describe, expect, it } from "vitest";
import { xpForLevel } from "./srd-advancement";

describe("xpForLevel", () => {
	it("gives the SRD's experience for a level", () => {
		expect(xpForLevel(2)).toBe(300);
		expect(xpForLevel(3)).toBe(900);
		expect(xpForLevel(5)).toBe(6500);
		expect(xpForLevel(20)).toBe(355000);
	});

	it("is undefined below level 2 and beyond the table", () => {
		expect(xpForLevel(1)).toBeUndefined();
		expect(xpForLevel(21)).toBeUndefined();
	});
});
