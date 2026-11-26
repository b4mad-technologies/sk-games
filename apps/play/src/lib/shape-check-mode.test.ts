import { describe, expect, it } from "vitest";
import { applyShapeCheckBuildMode } from "./shape-check-mode";

describe("applyShapeCheckBuildMode", () => {
	it.each([
		["warn", "warn"],
		["strict", "strict"],
		[undefined, undefined],
		["", undefined],
	])("VITE_SPELLKAVE_SHAPE_CHECK=%s sets the SDK global to %s", (value, expected) => {
		const target: { SPELLKAVE_SHAPE_CHECK?: string } = {};
		applyShapeCheckBuildMode(value, target);
		expect(target.SPELLKAVE_SHAPE_CHECK).toBe(expected);
	});

	it.each(["WARN", "off", "enforce"])("refuses the unknown value %s", (value) => {
		expect(() => applyShapeCheckBuildMode(value, {})).toThrow(/must be "strict" or "warn"/);
	});
});
