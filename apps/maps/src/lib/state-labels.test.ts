import { describe, expect, it } from "vitest";
import { humanizeStateLeaf, isKnownStateId, stateFieldView } from "./state-labels";

describe("stateFieldView", () => {
	it("converts copper pieces to the SRD's gp/sp/cp split", () => {
		expect(stateFieldView("srd/cost_cp", "7500")).toEqual({
			label: "Cost",
			value: "75 gp",
			code: false,
		});
		expect(stateFieldView("srd/cost_cp", "7550").value).toBe("75 gp 5 sp");
		expect(stateFieldView("srd/cost_cp", "55").value).toBe("5 sp 5 cp");
		expect(stateFieldView("srd/cost_cp", "0").value).toBe("0 cp");
	});

	it("converts tenths of a pound to pounds", () => {
		expect(stateFieldView("srd/weight_lb10", "550")).toEqual({
			label: "Weight",
			value: "55 lb",
			code: false,
		});
		expect(stateFieldView("srd/weight_lb10", "5").value).toBe("0.5 lb");
	});

	it("reads the armor numbers as the armor chapter defines them", () => {
		expect(stateFieldView("srd/armor_ac_base", "16")).toEqual({
			label: "Armor class",
			value: "16",
			code: false,
		});
		expect(stateFieldView("srd/armor_str_required", "13").label).toBe("Strength required");
		expect(stateFieldView("srd/armor_dex_cap", "2").label).toBe("Dexterity cap");
		expect(stateFieldView("srd/armor_stealth_disadvantage", "1")).toEqual({
			label: "Stealth",
			value: "Disadvantage",
			code: false,
		});
		expect(stateFieldView("srd/armor_stealth_disadvantage", "0").value).toBe("No penalty");
	});

	it("keeps the documented units for reach and speeds", () => {
		expect(stateFieldView("srd/reach_mm", "1524").value).toBe("1524 mm");
		expect(stateFieldView("srd/speed-walk", "6")).toEqual({
			label: "Walking speed",
			value: "6 cells",
			code: false,
		});
		expect(stateFieldView("srd/speed-fly", "1").value).toBe("1 cell");
	});

	it("labels the well-known character states", () => {
		expect(stateFieldView("srd/hp", "12").label).toBe("Hit points");
		expect(stateFieldView("srd/ac", "16").label).toBe("Armor class");
		expect(stateFieldView("srd/str", "16").label).toBe("Strength");
		expect(stateFieldView("srd/level", "1").label).toBe("Character level");
	});

	it("labels a skill DC by its skill", () => {
		expect(stateFieldView("srd/dc/stealth", "13")).toEqual({
			label: "Stealth DC",
			value: "13",
			code: false,
		});
	});

	it("shows an undocumented id's raw value with the id, never a guess", () => {
		expect(stateFieldView("mod/gizmo/flux_qq", "42")).toEqual({
			label: "Flux qq",
			value: "42 (mod/gizmo/flux_qq)",
			code: true,
		});
	});

	it("degrades to the raw form when a unit's value is not a number", () => {
		expect(stateFieldView("srd/weight_lb10", "heavy")).toEqual({
			label: "Weight",
			value: "heavy (srd/weight_lb10)",
			code: true,
		});
	});

	it("humanizes a class-feature leaf without a table entry", () => {
		expect(humanizeStateLeaf("srd/fighter/second-wind-uses")).toBe("Second wind uses");
		expect(isKnownStateId("srd/fighter/second-wind-uses")).toBe(false);
		expect(isKnownStateId("srd/hp")).toBe(true);
	});
});
