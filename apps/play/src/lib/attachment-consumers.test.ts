import { snapshotDbFromFixture } from "@spellkave/sdk";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "@spellkave/tool-player";
import { expect, it } from "vitest";
import { contextualActions } from "./play-action-context";
import {
	actionsFromManipulationContext,
	manipulationContextFromPayload,
	type PlayAction,
} from "./play-view";

/** A small command-menu consumer: categories are filters, not Play surfaces. */
function commandMenu(actions: readonly PlayAction[], group?: string) {
	return actions
		.filter((action) => group === undefined || action.groups?.includes(group))
		.map((action) => ({ command: action.id, text: action.label }));
}

it("shares public non-SRD action classifications between Play and a command menu without changing attempts", async () => {
	const metadata = [{ actionId: "orbital/inspect", tag: "survey" }];
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		action_definition_tag: metadata,
		world_time: [{ tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		directly_controlled_actor_spatial_location: [{ entityId: 1n }],
		action_definition: [
			{ actionId: "orbital/inspect", displayName: "Inspect", selfOnly: false, selfEligible: false },
		],
		outcome_template: [{ manipulationActionId: "orbital/inspect", communicationSpeechActId: "" }],
		visible_manipulation_context: [
			{ perceiverEntityId: 1n, ready: true, schemaVersion: 1, revision: 1n },
		],
		visible_manipulation_available_action: [
			{ perceiverEntityId: 1n, actionId: "orbital/inspect", nicheIds: [] },
		],
		visible_manipulation_observed_target: [
			{
				perceiverEntityId: 1n,
				targetFactId: "entity:2",
				targetRef: { tag: "Entity", value: 2n },
				nicheIds: [],
			},
		],
	});
	const tools = createPlayerFacingToolMap({ db, act: { actorId: "1" } } as SpellkaveToolContext);
	const read = async () =>
		actionsFromManipulationContext(
			manipulationContextFromPayload(
				await tools.manipulationContext.execute("read", { detail: "full" }),
				{
					place: null,
					occupants: [],
					pack: [],
				},
			),
		).actions;
	const withMetadata = await read();
	const context = { packIds: new Set<string>(), occupantIds: new Set(["2"]) };
	const play = contextualActions(withMetadata, context);
	expect(play.place).toEqual(withMetadata);
	expect(commandMenu(withMetadata, "survey")).toEqual(commandMenu(play.all));
	expect(commandMenu(withMetadata, "unknown")).toEqual([]);

	metadata.length = 0;
	const withoutMetadata = await read();
	expect(withoutMetadata.map(({ groups: _groups, group: _group, ...action }) => action)).toEqual(
		withMetadata.map(({ groups: _groups, group: _group, ...action }) => action),
	);
	expect(commandMenu(withoutMetadata, "survey")).toEqual([]);
	expect(commandMenu(withoutMetadata)).toEqual(commandMenu(withMetadata));
	expect(contextualActions(withoutMetadata, context).all).toEqual(withoutMetadata);
});
