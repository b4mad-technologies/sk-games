import { Hero } from "@spellkave/ui-widgets";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { expect, it } from "vitest";
import { fieldObservation } from "./play-field-observation";
import { offeredAction } from "./play-table";
import {
	actionsForDisclosedEntity,
	heroFromSelfSummary,
	manipulationContextFromPayload,
} from "./play-view";

it("distinguishes a failed description read from an empty successful read", async () => {
	const summary = {
		self: { vitals: { items: [{ state_id: "test/value", display_name: "Signal", value: "0" }] } },
	};
	const failed = heroFromSelfSummary("1", summary, null, null);
	expect(failed.descriptionReads).toEqual({ values: "failed", identity: "failed" });
	const ready = heroFromSelfSummary("1", summary, { items: [] }, { items: [] });
	expect(ready.descriptionReads).toEqual({ values: "ready", identity: "ready" });
	render(Hero, { self: { ...failed, sheetVitals: failed.vitals }, density: "stage" });
	await fireEvent.click(screen.getByRole("button", { name: "Signal" }));
	expect(await screen.findByRole("alert")).toHaveProperty(
		"textContent",
		"Description could not be loaded.",
	);
	expect(screen.queryByText("No description available.")).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Close" }));
});

it("joins quest prose without changing summary membership/order and counts its disclosure", async () => {
	const hero = heroFromSelfSummary(
		"1",
		{
			self: { quest: { items: [{ state_id: "test/quest", display_name: "Signal", value: "0" }] } },
		},
		{
			items: [
				{ state_id: "test/unlisted", description: "Must not become a quest" },
				{ state_id: "test/quest", description: "Restore the distant beacon." },
			],
		},
	);
	expect(hero.quest).toEqual([
		{ id: "test/quest", label: "Signal", value: "0", description: "Restore the distant beacon." },
	]);
	const view = render(Hero, { self: hero, density: "stage" });
	expect(
		fieldObservation(view.container, "hero_quest", hero.suppliedFields?.quest, "ready"),
	).toMatchObject({ supplied_fields: 2, represented_fields: 2, disclosed_fields: 1 });
	await fireEvent.click(screen.getByRole("button", { name: "Signal" }));
	expect(await screen.findByRole("dialog", { name: "Signal" })).toBeTruthy();
	expect(
		fieldObservation(view.container, "hero_quest", hero.suppliedFields?.quest, "ready"),
	).toMatchObject({ disclosed_fields: 2 });
	await fireEvent.click(screen.getByRole("button", { name: "Close" }));
});

it("preserves authored action explanations through factual discovery and local candidates", () => {
	const payload = {
		manipulation_context: {
			status: "ready",
			actions: [
				{
					action_id: "test/inspect",
					display_name: "Inspect",
					description: "Study its markings.",
				},
			],
			targets: [{ target_fact_id: "entity:2", target_ref: "entity:2" }],
		},
	};
	const context = manipulationContextFromPayload(payload, { place: null, occupants: [], pack: [] });
	const action = actionsForDisclosedEntity(context, "2")[0];
	if (!action) throw new Error("Expected an offered action");
	expect(offeredAction(action).description).toBe("Study its markings.");
});
