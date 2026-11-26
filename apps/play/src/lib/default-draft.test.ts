import { describe, expect, it } from "vitest";
import {
	beginDefaultDraft,
	defaultDraftIsCurrent,
	effectiveDefaultInputs,
	effectiveDefaultTarget,
	suppressDefaultInputs,
	suppressDefaultTarget,
} from "./default-draft";
import type { PlayManipulationAction } from "./play-view";

const inspect: PlayManipulationAction = {
	actionId: "srd/inspect",
	displayName: "Inspect",
	tags: [],
	selfOnly: false,
	selfEligible: false,
	defaults: {
		target: { targetRef: "entity:chest", kind: "reference" },
		inputValues: { distance: 5, note: "carefully" },
		provenance: {
			namespace: "ui.affordance_defaults",
			templateId: "demo",
			attachmentId: "one",
			contentKey: "v1",
		},
	},
};

describe("author-published default draft", () => {
	it("keeps a bound snapshot until the player explicitly suppresses a value", () => {
		let draft = beginDefaultDraft(inspect, { explicitTarget: false });
		expect(effectiveDefaultTarget(draft)).toBe("entity:chest");
		expect(effectiveDefaultInputs(draft)).toEqual({ distance: 5, note: "carefully" });
		draft = suppressDefaultTarget(draft);
		draft = suppressDefaultInputs(draft, new Set(["distance"]));
		expect(effectiveDefaultTarget(draft)).toBeUndefined();
		expect(effectiveDefaultInputs(draft)).toEqual({ note: "carefully" });
		// Removing distance: from text does not re-enable it.
		draft = suppressDefaultInputs(draft, new Set());
		expect(effectiveDefaultInputs(draft)).toEqual({ note: "carefully" });
	});

	it("marks an edited, replaced, or hidden author snapshot stale", () => {
		const draft = beginDefaultDraft(inspect, { explicitTarget: false });
		const defaults = inspect.defaults;
		if (defaults === undefined) throw new Error("fixture needs defaults");
		expect(defaultDraftIsCurrent(draft, inspect, new Set(["entity:chest"]))).toBe(true);
		expect(defaultDraftIsCurrent(draft, inspect, new Set())).toBe(false);
		expect(
			defaultDraftIsCurrent(
				draft,
				{
					...inspect,
					defaults: {
						...defaults,
						provenance: { ...defaults.provenance, contentKey: "v2" },
					},
				},
				new Set(["entity:chest"]),
			),
		).toBe(false);
	});
});
