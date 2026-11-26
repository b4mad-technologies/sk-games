import { expect, it } from "vitest";
import {
	contextualActions,
	isGenericCheckAction,
	isPlaceDetailVerb,
	retainActionClassification,
} from "./play-action-context";
import type { PlayAction } from "./play-view";

const context = { packIds: new Set(["10"]), occupantIds: new Set(["20"]) };
function action(id: string, targetRef: string, extra: Partial<PlayAction> = {}): PlayAction {
	return {
		id,
		targetRef,
		label: "Inspect",
		verb: "manipulate",
		descriptor: "orbital/inspect",
		targetName: "",
		acceptsUtterance: false,
		...extra,
	};
}

it("routes identical labels by typed target and preserves unknown groups in the fallback", () => {
	const offers = [
		action("gear", "entity:10"),
		action("person", "entity:20"),
		action("hatch", "place_edge:30"),
		action("unknown", "new-kind:40", { groups: ["orbital-maintenance"] }),
	];
	const routed = contextualActions(offers, context);
	expect(routed.pack.map((a) => a.id)).toEqual(["gear"]);
	expect(routed.place.map((a) => a.id)).toEqual(["person"]);
	expect(routed.map.map((a) => a.id)).toEqual(["hatch"]);
	expect(routed.table.map((a) => a.id)).toEqual(["unknown"]);
	expect(routed.all).toEqual(offers);
	expect(routed.pack[0]).toBe(offers[0]);
});

it("keeps conversation and combat at Table without duplicating a handle", () => {
	const speech = action("speak", "entity:20", { verb: "communicate", acceptsUtterance: true });
	const strike = action("strike", "entity:20", { groups: ["combat", "orbital-security"] });
	const routed = contextualActions([speech, strike, speech], context);
	expect(routed.table).toEqual([speech, strike]);
	expect(routed.all).toEqual([speech, strike]);
	expect(routed.place).toEqual([]);
});

it("keeps listing combat classification when a targeted read omits groups", () => {
	const catalog = [
		action("h:opp", "entity:20", {
			group: "combat",
			groups: ["combat"],
			label: "Opportunity attack",
		}),
	];
	const targeted = action("h:opp", "entity:20", { label: "Opportunity attack" });
	const retained = retainActionClassification(targeted, catalog);
	expect(retained.group).toBe("combat");
	expect(retained.groups).toEqual(["combat"]);
	const routed = contextualActions([retained], context);
	expect(routed.table.map((a) => a.id)).toEqual(["h:opp"]);
	expect(routed.place).toEqual([]);
});

// sk-jay0.1.8.63.9: identifies the generic-check descriptor FAMILY, never a
// display-label prefix — two different check labels/skills both classify,
// and a same-namespace but different-family action does not.
it("classifies the generic-check descriptor family regardless of skill or label", () => {
	const acrobatics = action("h:1", "entity:20", {
		descriptor: "srd/check/acrobatics",
		label: "Acrobatics",
	});
	const arcana = action("h:2", "entity:20", {
		descriptor: "srd/check/arcana",
		label: "check: arcana",
	});
	const attack = action("h:3", "entity:20", { descriptor: "srd/attack/melee", label: "Attack" });
	const unrelated = action("h:4", "entity:20", { descriptor: "srd/speak-to", label: "Speak to" });
	expect(isGenericCheckAction(acrobatics)).toBe(true);
	expect(isGenericCheckAction(arcana)).toBe(true);
	expect(isGenericCheckAction(attack)).toBe(false);
	expect(isGenericCheckAction(unrelated)).toBe(false);
});

it("keeps every Place detail verb except numbered prompt answers", () => {
	expect(isPlaceDetailVerb({})).toBe(true);
	expect(isPlaceDetailVerb({ slot: 3 })).toBe(false);
});
