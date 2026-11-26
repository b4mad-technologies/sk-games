import { describe, expect, it } from "vitest";
import { descriptionObservation, fieldObservation } from "./play-field-observation";
import { projectObservation } from "./play-observation";
import { heroFromSelfSummary } from "./play-view";

describe("field presentation evidence", () => {
	it("counts condition dialog metadata without treating closed fields as disclosed", () => {
		const root = document.createElement("section");
		root.innerHTML =
			'<span data-slot="play-condition-value">Private label</span><span data-field-metadata="play-condition-value" data-field-disclosed="false"></span>';
		expect(fieldObservation(root, "hero_conditions", 2, "ready")).toMatchObject({
			represented_fields: 2,
			disclosed_fields: 1,
		});
		root.lastElementChild?.setAttribute("data-field-disclosed", "true");
		expect(fieldObservation(root, "hero_conditions", 2, "ready")).toMatchObject({
			represented_fields: 2,
			disclosed_fields: 2,
		});
	});
	it("counts portalled field descriptions once and follows their disclosure state", () => {
		const root = document.createElement("section");
		root.innerHTML =
			'<span data-field-description="play-vital-value" data-field-disclosed="false"></span><dd data-slot="play-vital-value">private value</dd>';
		expect(fieldObservation(root, "hero_vitals", 2, "ready")).toMatchObject({
			represented_fields: 2,
			disclosed_fields: 1,
		});
		root.firstElementChild?.setAttribute("data-field-disclosed", "true");
		expect(fieldObservation(root, "hero_vitals", 2, "ready")).toMatchObject({
			represented_fields: 2,
			disclosed_fields: 2,
		});
		expect(
			JSON.stringify(projectObservation(fieldObservation(root, "hero_vitals", 2, "ready"))),
		).not.toContain("private value");
	});
	it("distinguishes an action explanation behind a menu from reachable and expanded prose", () => {
		const root = document.createElement("section");
		root.innerHTML =
			'<details id="menu"><summary>More</summary><details id="explanation"><summary>About private action</summary><p data-slot="play-action-description">private prose</p></details></details>';
		const observe = () => descriptionObservation(root, "table", 2, "ready");
		expect(observe()).toMatchObject({
			available_descriptions: 2,
			mounted_descriptions: 1,
			reachable_descriptions: 0,
			expanded_descriptions: 0,
		});
		root.querySelector("#menu")?.setAttribute("open", "");
		expect(observe()).toMatchObject({ reachable_descriptions: 1, expanded_descriptions: 0 });
		root.querySelector("#explanation")?.setAttribute("open", "");
		expect(observe()).toMatchObject({ reachable_descriptions: 1, expanded_descriptions: 1 });
		expect(JSON.stringify(projectObservation(observe()))).not.toContain("private");
	});
	it("detects a supplied quest row omitted by the renderer without exporting its value", () => {
		const hero = heroFromSelfSummary("private-actor", {
			self: {
				quest: {
					items: [
						{ state_id: "private/one", value: "secret" },
						{ state_id: "private/two", value: "0" },
					],
				},
			},
		});
		const root = document.createElement("section");
		root.innerHTML = '<dd data-slot="play-quest-value">secret</dd>';
		const projected = projectObservation(
			fieldObservation(root, "hero_quest", hero.suppliedFields?.quest, "ready"),
		);
		expect(projected).toMatchObject({
			spellkave_supplied_fields: 2,
			spellkave_represented_fields: 1,
			spellkave_disclosed_fields: 1,
		});
		expect(JSON.stringify(projected)).not.toMatch(/secret|private/);
	});
	it("distinguishes mounted details from closed disclosures and unknown source data", () => {
		const root = document.createElement("section");
		root.innerHTML =
			'<details><summary data-slot="play-condition-value">Fatigue</summary><p data-slot="play-condition-value">3</p></details>';
		expect(fieldObservation(root, "hero_conditions", 2, "ready")).toMatchObject({
			represented_fields: 2,
			disclosed_fields: 1,
		});
		root.querySelector("details")?.setAttribute("open", "");
		expect(fieldObservation(root, "hero_conditions", 2, "ready").disclosed_fields).toBe(2);
		expect(fieldObservation(root, "hero_conditions", 2, "closed")).toMatchObject({
			detail_state: "closed",
			represented_fields: 0,
			disclosed_fields: 0,
		});
		expect(fieldObservation(root, "hero_conditions", undefined, "ready")).toMatchObject({
			detail_state: "unknown",
		});
		expect(fieldObservation(root, "hero_conditions", undefined, "ready")).not.toHaveProperty(
			"supplied_fields",
		);
	});
});
