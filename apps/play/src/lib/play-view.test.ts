import type { WorldEvent } from "@spellkave/tool-runtime";
import { describe, expect, it } from "vitest";
import type { PlaySpeech } from "./play-view";
import {
	actionAcceptsUtterance,
	actionsFromManipulationContext,
	actionsFromSenseContext,
	actionTakesInput,
	CHRONICLE_KIND_RULES,
	capabilityChipsFromPayload,
	chronicleKindRule,
	conditionLabel,
	economyBudgetFromPayload,
	economyFromPayload,
	HERO_DRAFTING_CONDITION_ID,
	heroFromSelfSummary,
	hideDraftVitals,
	humaniseNodeId,
	isDmInternalCondition,
	itemDetailFromPayload,
	learnSpeakerNames,
	manipulationContextFromPayload,
	mergeSpeech,
	occupantDetailFromPayload,
	packFromPayload,
	reactionFromPayloads,
	sceneFromPayload,
	selfStateFacetsFromPayload,
	selfTargetLabel,
	senseContextFromPayload,
	sessionFromPayload,
	sessionTokensFromPayload,
	speechFromEvents,
	speechFromEventsRemembering,
	speechFromTraceDetail,
	traceRefsFromListing,
} from "./play-view";

it("keeps factored manipulation actions and targets independent while naming targets from the visible scene", () => {
	const context = manipulationContextFromPayload(
		{
			details: {
				manipulation_context: {
					status: "ready",
					schema_version: 1,
					revision: 8,
					actions: [
						{
							action_id: "srd/speak-to",
							display_name: "Speak To",
							self_only: false,
							self_eligible: false,
						},
						{
							action_id: "srd/inspect",
							display_name: "Inspect",
							self_only: false,
							self_eligible: false,
						},
					],
					targets: [{ target_fact_id: "target:aldwin", target_ref: "entity:4" }],
					participants: [
						{
							context_id: "mpc:9",
							action_id: "srd/speak-to",
							binding_count: 1,
							bindings: [{ role_id: "speaker", entity_id: "4" }],
						},
					],
				},
			},
		},
		{
			place: { id: "inn/common_room", name: "Common Room", description: "", exits: [] },
			occupants: [
				{
					id: "4",
					handle: "scene:4",
					rev: "1",
					kind: "person",
					sceneKind: "actor",
					name: "Aldwin",
					conditions: [],
					note: "",
				},
			],
			pack: [],
		},
	);
	expect(context).toEqual({
		status: "ready",
		schemaVersion: 1,
		revision: 8,
		actions: [
			{
				actionId: "srd/speak-to",
				displayName: "Speak To",
				tags: [],
				nicheRequirements: [],
				selfOnly: false,
				selfEligible: false,
			},
			{
				actionId: "srd/inspect",
				displayName: "Inspect",
				tags: [],
				nicheRequirements: [],
				selfOnly: false,
				selfEligible: false,
			},
		],
		targets: [
			{
				targetFactId: "target:aldwin",
				targetRef: "entity:4",
				targetName: "Aldwin",
				tags: [],
				nicheIds: [],
			},
		],
		participants: [
			{
				contextId: "mpc:9",
				actionId: "srd/speak-to",
				bindingCount: 1,
				bindings: [{ roleId: "speaker", entityId: "4" }],
			},
		],
		prompts: [],
	});
});

it("lets an explicit empty world-authored input schema override legacy text carriage", () => {
	const context = manipulationContextFromPayload(
		{
			details: {
				manipulation_context: {
					status: "ready",
					schema_version: 1,
					revision: 1,
					actions: [
						{
							action_id: "dm/creation/discard",
							display_name: "Discard",
							accepts_utterance: true,
							input: { fields: [] },
							self_only: false,
							self_eligible: true,
						},
					],
					targets: [{ target_fact_id: "target:self", target_ref: "entity:4" }],
					participants: [],
				},
			},
		},
		{ place: null, occupants: [], pack: [] },
	);
	const { actions } = actionsFromManipulationContext(context, "4");
	const [action] = actions;
	if (action === undefined) throw new Error("expected one action");
	expect(action.input).toEqual({ fields: [] });
	expect(action.provider).toBe("actor");
	expect(actionTakesInput(action)).toBe(false);
});

it("retains an authored input field transport without inventing one for legacy fields", () => {
	const context = manipulationContextFromPayload(
		{
			details: {
				manipulation_context: {
					status: "ready",
					schema_version: 1,
					revision: 1,
					actions: [
						{
							action_id: "dm/example/form",
							display_name: "Example form",
							input: {
								fields: [
									{ name: "spoken", label: "Spoken", control: "text", channel: "utterance" },
									{ name: "count", label: "Count", control: "number", channel: "args_json" },
									{ name: "legacy", label: "Legacy", control: "text" },
								],
							},
							self_only: false,
							self_eligible: true,
						},
					],
					targets: [{ target_fact_id: "target:self", target_ref: "entity:4" }],
					participants: [],
				},
			},
		},
		{ place: null, occupants: [], pack: [] },
	);
	const { actions } = actionsFromManipulationContext(context, "4");
	const [action] = actions;
	expect(action?.input?.fields).toEqual([
		{ name: "spoken", label: "Spoken", control: "text", channel: "utterance" },
		{ name: "count", label: "Count", control: "number", channel: "args_json" },
		{ name: "legacy", label: "Legacy", control: "text" },
	]);
});

it("projects only well-formed caller-scoped prompt occurrences and their authored presentation", () => {
	const context = manipulationContextFromPayload(
		{
			details: {
				manipulation_context: {
					status: "ready",
					schema_version: 1,
					revision: 3,
					actions: [],
					targets: [{ target_fact_id: "guide", target_ref: "entity:guide" }],
					participants: [],
					prompts: [
						{
							occurrence_id: "prompt:class:1",
							prompt_def_id: "dm/prompt/creation/class",
							contract_version: 2,
							source_ref: "entity:guide",
							response_action_ids: ["dm/creation/class/barbarian"],
							opened_at_tick: 14,
							consumed: false,
							presentation: {
								question: "What class do you choose?",
								labels: { "dm/creation/class/barbarian": "Barbarian" },
							},
						},
						{
							occurrence_id: "broken",
							prompt_def_id: "",
							source_ref: "entity:guide",
							response_action_ids: [],
						},
					],
				},
			},
		},
		{ place: null, occupants: [], pack: [] },
	);
	if (context.status !== "ready") throw new Error("Expected factual context");
	expect(context.prompts).toEqual([
		{
			occurrenceId: "prompt:class:1",
			promptDefId: "dm/prompt/creation/class",
			contractVersion: 2,
			sourceRef: "entity:guide",
			responseActionIds: ["dm/creation/class/barbarian"],
			openedAtTick: 14,
			consumed: false,
			presentation: {
				question: "What class do you choose?",
				labels: { "dm/creation/class/barbarian": "Barbarian" },
			},
		},
	]);
});

it("keeps a numbered dialogue answer directly invokable when its speech act carries text", () => {
	const context = manipulationContextFromPayload(
		{
			details: {
				manipulation_context: {
					status: "ready",
					schema_version: 1,
					revision: 1,
					actions: [
						{
							action_id: "dm/creation/class/barbarian",
							display_name: "Unrelated wording",
							response_slot: 1,
							communication_speech_act_id: "orbital/answer",
							accepts_utterance: true,
							self_only: false,
							self_eligible: false,
						},
					],
					targets: [{ target_fact_id: "target:guide", target_ref: "entity:4" }],
					participants: [],
				},
			},
		},
		{ place: null, occupants: [], pack: [] },
	);
	const { actions } = actionsFromManipulationContext(context);
	const [action] = actions;
	if (action === undefined) throw new Error("expected one action");
	expect(action.slot).toBe(1);
	expect(action.acceptsUtterance).toBe(true);
	expect(actionTakesInput(action)).toBe(false);
});

it("preserves authored niche and presentation facts for direct communication choices", () => {
	const context = manipulationContextFromPayload(
		{
			manipulation_context: {
				status: "ready",
				schema_version: 1,
				revision: 1,
				actions: [
					{
						action_id: "orbital/answer",
						display_name: "Unrelated wording",
						response_slot: 3,
						communication_speech_act_id: "orbital/answer",
						accepts_utterance: false,
						description: "Accept the assignment.",
						groups: ["survey"],
						niche_requirements: [
							{
								niche_id: "orbital/dialog",
								requires_spatial_attachment: true,
								admits_targets_without_membership: false,
							},
						],
					},
				],
				targets: [
					{ target_fact_id: "captain", target_ref: "entity:4", niche_ids: ["orbital/dialog"] },
				],
			},
		},
		{ place: null, occupants: [], pack: [] },
	);
	if (context.status !== "ready") throw new Error("Expected factual context");
	expect(context.actions[0]?.nicheRequirements).toEqual([
		{
			niche_id: "orbital/dialog",
			requires_spatial_attachment: true,
			admits_targets_without_membership: false,
		},
	]);
	expect(context.targets[0]?.nicheIds).toEqual(["orbital/dialog"]);
	expect(actionsFromManipulationContext(context).actions[0]).toMatchObject({
		verb: "communicate",
		slot: 3,
		acceptsUtterance: false,
		description: "Accept the assignment.",
		groups: ["survey"],
		targetRef: "entity:4",
	});
});

it("forms local direct candidates from factored context without an affordance handle", () => {
	const result = actionsFromManipulationContext({
		status: "ready",
		schemaVersion: 1,
		revision: 9,
		actions: [
			{
				actionId: "srd/inspect",
				displayName: "Inspect",
				tags: [],
				selfOnly: false,
				selfEligible: false,
			},
			{
				actionId: "srd/speak-to",
				displayName: "Speak To",
				communicationSpeechActId: "srd/speak-to",
				acceptsUtterance: true,
				tags: ["social"],
				selfOnly: false,
				selfEligible: false,
			},
		],
		targets: [
			{ targetFactId: "target:aldwin", targetRef: "entity:4", targetName: "Aldwin", tags: [] },
		],
		participants: [],
	});
	expect(result).toEqual({
		total: 1,
		actions: [
			expect.objectContaining({
				id: "factored:srd/speak-to:target:aldwin",
				verb: "communicate",
				descriptor: "srd/speak-to",
				acceptsUtterance: true,
			}),
		],
	});
});

it("keeps self-eligible verbs on ME and does not attach them to other occupants", () => {
	const result = actionsFromManipulationContext(
		{
			status: "ready",
			schemaVersion: 1,
			revision: 1,
			actions: [
				{
					actionId: "srd/dodge",
					displayName: "Dodge",
					tags: [],
					selfOnly: false,
					selfEligible: true,
				},
			],
			targets: [
				{ targetFactId: "target:aldwin", targetRef: "entity:4", targetName: "Aldwin", tags: [] },
			],
			participants: [],
		},
		"1",
	);
	expect(result.actions).toEqual([
		expect.objectContaining({
			descriptor: "srd/dodge",
			targetRef: "entity:1",
			provider: "actor",
		}),
	]);
});

it("maps factual sensing syntax to a direct world sensing action", () => {
	const context = senseContextFromPayload({
		details: {
			sense_context: {
				status: "ready",
				queries: [
					{
						query_kind: "look",
						visibility: "Local",
						display_name: "Look Around",
						outcome_template_id: "core/sense/look",
					},
				],
			},
		},
	});
	expect(actionsFromSenseContext(context)).toEqual([
		expect.objectContaining({
			id: "sense:look:Local",
			verb: "sensing",
			descriptor: "look",
			targetRef: "world",
			senseVisibility: "Local",
		}),
	]);
});

it("retains authored item prose and state labels without inventing missing text", () => {
	expect(
		itemDetailFromPayload({
			status: "ok",
			item: {
				entity_id: "2",
				entity_def_id: "opaque/blade",
				description: "A steel blade.",
				states: [{ state_id: "other/quality", display_name: "Craftsmanship", value: "Fine" }],
			},
		}),
	).toMatchObject({
		description: "A steel blade.",
		definitionRef: "opaque/blade",
		facts: [{ id: "other/quality", label: "Craftsmanship", value: "Fine" }],
	});
	expect(itemDetailFromPayload({ status: "ok", item: { entity_id: "2" } })).not.toHaveProperty(
		"description",
	);
});

it("keeps quest zero/text and only supplied positive condition metadata", () => {
	const hero = heroFromSelfSummary("1", {
		self: {
			quest: { items: [{ state_id: "other/progress", display_name: "Progress", value: "0" }] },
			conditions: {
				items: [
					{ condition_definition_id: "other/fatigue", stack_count: 3, expires_at_tick: 1200 },
					{ condition_definition_id: "other/marked", stack_count: 1, expires_at_tick: 0 },
				],
			},
		},
	});
	expect(hero.quest).toEqual([{ id: "other/progress", label: "Progress", value: "0" }]);
	expect(hero.conditionDetails).toEqual([
		{ id: "other/fatigue", label: "Fatigue", stackCount: 3, expiresAtTick: 1200 },
		{ id: "other/marked", label: "Marked", stackCount: 1 },
	]);
});

it("keeps one hero condition per id when the body holds several instances", () => {
	// Prod elven-mini-1 (sk-jay0.1.1.16): the creation candidate carries
	// `dm/creation/drafting` from its definition AND from Aldwin. Two rows with
	// one id crashed the YOU tile's keyed `{#each}` and froze Play at "Entering".
	// The fixture now uses a neutral id: a `dm/` workflow condition is no longer
	// listed at all (sk-jay0.1.8.96, next test), and the per-id rule must hold
	// for any condition the tile does show.
	const hero = heroFromSelfSummary("1", {
		self: {
			conditions: {
				items: [
					{ condition_definition_id: "other/drafting", stack_count: 1 },
					{ condition_definition_id: "other/marked" },
					{ condition_definition_id: "other/drafting", stack_count: 2 },
				],
			},
		},
	});
	expect(hero.conditions).toEqual(["other/drafting", "other/marked"]);
	expect(hero.conditionDetails?.map((condition) => condition.id)).toEqual([
		"other/drafting",
		"other/marked",
	]);
	expect(hero.conditionDetails?.[0]?.stackCount).toBe(1);
	expect(hero.suppliedFields?.conditions).toBe(3);
});

it("never lists the DM's workflow conditions on the hero (sk-jay0.1.8.96)", () => {
	for (const id of [
		"dm/creation/drafting",
		"dm/creation/pending/name",
		"dm/level-up/drafting",
		"core/condition/controlled",
	]) {
		expect(isDmInternalCondition(id)).toBe(true);
	}
	expect(isDmInternalCondition("srd/condition/unconscious")).toBe(false);
	// Only the DM's own namespace, not any id that merely contains "dm/".
	expect(isDmInternalCondition("other/dm/marked")).toBe(false);
	const hero = heroFromSelfSummary("1", {
		self: {
			conditions: {
				items: [
					{ condition_definition_id: "dm/creation/drafting", stack_count: 1 },
					{ condition_definition_id: "dm/creation/pending/name" },
					{ condition_definition_id: "dm/creation/drafting", stack_count: 2 },
					{ condition_definition_id: "other/marked" },
				],
			},
		},
	});
	expect(hero.conditions).toEqual(["other/marked"]);
	expect(hero.conditionDetails?.map((condition) => condition.label)).toEqual(["Marked"]);
});

it("lists every condition from the detail page when the summary is only a sample (sk-jay0.1.8.101)", () => {
	// A downed hero: the summary's bounded page holds four rows sorted by id,
	// which cuts `srd/condition/unconscious` (it sorts last).
	const summary = {
		self: {
			conditions: {
				count: 6,
				listing: "examples",
				items: [
					{ condition_definition_id: "core/condition/controlled" },
					{ condition_definition_id: "srd/condition/incapacitated" },
					{ condition_definition_id: "srd/condition/no-action" },
					{ condition_definition_id: "srd/condition/no-bonus-action" },
				],
			},
		},
	};
	const detailPage = {
		items: [
			{ condition_definition_id: "core/condition/controlled", stack_count: 1 },
			{ condition_definition_id: "srd/condition/incapacitated", stack_count: 1 },
			{ condition_definition_id: "srd/condition/no-action", stack_count: 1 },
			{ condition_definition_id: "srd/condition/no-bonus-action", stack_count: 1 },
			{ condition_definition_id: "srd/condition/no-reaction", stack_count: 1 },
			{
				condition_definition_id: "srd/condition/unconscious",
				stack_count: 1,
				description: "You are out cold.",
			},
		],
	};
	const hero = heroFromSelfSummary("1", summary, undefined, undefined, detailPage);
	expect(hero.conditions).toEqual([
		"srd/condition/incapacitated",
		"srd/condition/no-action",
		"srd/condition/no-bonus-action",
		"srd/condition/no-reaction",
		"srd/condition/unconscious",
	]);
	expect(hero.conditionDetails?.at(-1)).toEqual({
		id: "srd/condition/unconscious",
		label: "Unconscious",
		description: "You are out cold.",
		stackCount: 1,
	});
	// A failed detail read keeps the summary's sample rather than showing nothing.
	expect(
		heroFromSelfSummary("1", summary, undefined, undefined, { status: "error" }).conditions,
	).toEqual([
		"srd/condition/incapacitated",
		"srd/condition/no-action",
		"srd/condition/no-bonus-action",
	]);
	// A complete summary still controls membership (the next test).
	const complete = {
		self: { conditions: { ...summary.self.conditions, listing: "complete" } },
	};
	expect(
		heroFromSelfSummary("1", complete, undefined, undefined, detailPage).conditions,
	).not.toContain("srd/condition/unconscious");
});

it("names the hero's own target 'You (<name>)' and never shows a raw target ref (sk-jay0.1.8.92)", () => {
	const payload = {
		details: {
			manipulation_context: {
				status: "ready",
				schema_version: 1,
				revision: 1,
				actions: [],
				targets: [
					{ target_fact_id: "t:self", target_ref: "entity:168" },
					{ target_fact_id: "t:aldwin", target_ref: "entity:4" },
					{ target_fact_id: "t:unknown", target_ref: "entity:999" },
					{ target_fact_id: "t:place", target_ref: "place_node:inn/attic" },
				],
				participants: [],
				prompts: [],
			},
		},
	};
	const scene = {
		place: null,
		occupants: [
			{
				id: "4",
				handle: "s:actor:4",
				rev: "r",
				kind: "person" as const,
				sceneKind: "actor",
				name: "Aldwin",
				conditions: [],
				note: "",
			},
		],
		pack: [],
	};
	const names = (context: ReturnType<typeof manipulationContextFromPayload>) =>
		context.status === "ready" ? context.targets.map((target) => target.targetName) : [];
	expect(
		names(
			manipulationContextFromPayload(payload, {
				...scene,
				self: { entityId: "168", name: "Brannoch" },
			}),
		),
	).toEqual(["You (Brannoch)", "Aldwin", "Someone here", "Something here"]);
	// A hero without a name of its own yet (creation) is still "You".
	expect(
		names(
			manipulationContextFromPayload(payload, { ...scene, self: { entityId: "168", name: "" } }),
		)[0],
	).toBe("You");
	expect(selfTargetLabel("168")).toBe("You");
	// Without the hero (the older call shape) the ref still never shows.
	const withoutSelf = names(manipulationContextFromPayload(payload, scene));
	expect(withoutSelf[0]).toBe("Someone here");
	for (const name of withoutSelf) expect(name).not.toMatch(/^(entity|place_node):/);
});

it("shows no bare kind word as a pack item's lead line (sk-jay0.1.8.102)", () => {
	const pack = packFromPayload({
		details: {
			listing: "complete",
			items: [
				{ entity_id: "12", name: "Longsword", kind: "item", quantity: 1 },
				{
					entity_id: "13",
					name: "Chain Mail",
					kind: "item",
					description: "Heavy armour of interlocking rings.",
				},
				{
					entity_id: "20",
					name: "Backpack",
					kind: "container",
					contents: [{ entity_id: "21", name: "Rations", kind: "item", quantity: 3 }],
				},
			],
		},
	});
	expect(pack.map((item) => [item.name, item.detail])).toEqual([
		["Longsword", ""],
		["Chain Mail", "Heavy armour of interlocking rings."],
		["Backpack", ""],
		["Rations", "carried inside"],
	]);
});

it("joins condition prose only onto summary-selected conditions and reports read failures", () => {
	const summary = {
		self: {
			conditions: {
				items: [
					{ condition_definition_id: "other/fatigue", stack_count: 3 },
					{ condition_definition_id: "other/marked", stack_count: 1 },
				],
			},
		},
	};
	const hero = heroFromSelfSummary("1", summary, undefined, undefined, {
		items: [
			{ condition_definition_id: "other/fatigue", description: "Fatigue explanation." },
			{ condition_definition_id: "other/marked", description: "  " },
			{ condition_definition_id: "other/unrelated", description: "Do not enumerate this." },
		],
	});
	expect(hero.conditionDetails).toEqual([
		{ id: "other/fatigue", label: "Fatigue", stackCount: 3, description: "Fatigue explanation." },
		{ id: "other/marked", label: "Marked", stackCount: 1 },
	]);
	expect(hero.descriptionReads?.conditions).toBe("ready");
	expect(hero.suppliedFields?.conditions).toBe(5);
	expect(
		heroFromSelfSummary("1", summary, undefined, undefined, { status: "error" }).descriptionReads
			?.conditions,
	).toBe("failed");
});

// Shapes below are copied from live PLAYER tool answers against the staged
// Elven Mini world (2026-09-02), trimmed to the fields the page reads.

const selfSummary = {
	details: {
		self: {
			actor_id: "1",
			entity_name: "Creation Candidate",
			appearance: "",
			backstory: "",
			current_node_id: "elven_mini/creation_limbo/station",
			// `self_summary`'s own compact re-surfacing of `readSelfIdentity`
			// (packages/spellkave-tool-player/src/tools.ts's `selfSummaryToolDef`,
			// "identity: boundedCollection(...)"): tag + catalog prefix, no
			// description, bounded at 16.
			identity: {
				count: 3,
				listing: "complete",
				items: [
					{ tag: "srd.species.human", prefix: "srd.species" },
					{ tag: "srd.class.fighter", prefix: "srd.class" },
					{ tag: "srd.background.soldier", prefix: "srd.background" },
				],
			},
			conditions: { count: 0, listing: "complete", items: [] },
			vitals: {
				count: 2,
				listing: "complete",
				items: [
					{ state_id: "srd/hp", display_name: "Hit Points", value: "0" },
					{ state_id: "srd/level", display_name: "Character Level", value: "1" },
				],
			},
		},
	},
};

const scene = {
	details: {
		node_id: "elven_mini/creation_limbo/station",
		node_display_name: "Creation Limbo",
		node_description: "",
		graph_description: "A place outside the adventure.",
		scene_resolved: true,
		rev: "s4-1fijmyp",
		listing: "complete",
		items: [
			{ handle: "s:actor:18", rev: "i8c19a", kind: "actor", id: "18", label: "World Operator" },
			{
				handle: "s:actor:4",
				rev: "56es86",
				kind: "actor",
				id: "4",
				label: "Aldwin, keeper of the hearth-ledger",
			},
			{
				handle: "s:actor:123",
				rev: "c1",
				kind: "actor",
				id: "123",
				label: "Cellar Rat 1",
				conditions: ["srd/condition/dead"],
				entity_def_id: "srd/creature/cellar-rat",
			},
			{ handle: "s:trace:2", rev: "12gv2gw", kind: "trace", id: "2", label: "srd/speech" },
			{
				handle: "s:exit:276",
				rev: "1hxxv50",
				kind: "exit",
				id: "276",
				label: "northeast",
				to: "inn/common_room",
				to_name: "Common Room",
				traversal_gates: [{ template_id: "elven_mini/affordance/dm_threshold", mode_id: "" }],
			},
		],
	},
};

describe("play view mappers", () => {
	it("reads the hero from spellkave_self_summary, keeping only the vitals the world reports", () => {
		const hero = heroFromSelfSummary("1", selfSummary);
		expect(hero.name).toBe("Creation Candidate");
		expect(hero.hp).toBe(0);
		expect(hero.level).toBe(1);
		expect(hero.ac).toBeUndefined();
		expect(hero.vitals.map((vital) => vital.label)).toEqual(["Hit Points", "Character Level"]);
		expect(hero.placeId).toBe("elven_mini/creation_limbo/station");
		// Species/class/background are parsed from the compact identity glance's
		// own dotted tags — `readSelfIdentity`'s doc comment invites exactly
		// this ("rendering a phrase like 'Human Fighter (Soldier)' ... stays
		// the consumer's job").
		expect(hero.species).toBe("Human");
		expect(hero.className).toBe("Fighter");
		expect(hero.background).toBe("Soldier");
		// Abilities/skills/masteries are a SEPARATE `spellkave_self_states`
		// read (`selfStateFacetsFromPayload`/`capabilityChipsFromPayload`
		// below) — `heroFromSelfSummary` alone never populates them.
		expect(hero.abilities).toEqual([]);
		expect(hero.skills).toEqual([]);
		expect(hero.masteries).toEqual([]);
	});

	it("keeps the place's own picture when the scene sends a well-formed one", () => {
		const art = { path: "art/places/common-room.webp", hash: "a".repeat(64), license: "CC-BY-4.0" };
		const details = scene.details as Record<string, unknown>;
		expect(sceneFromPayload({ details: { ...details, art } }, "1").place?.art).toEqual(art);
		expect(
			sceneFromPayload({ details: { ...details, art: { ...art, hash: "short" } } }, "1").place?.art,
		).toBeUndefined();
		expect(sceneFromPayload(scene, "1").place?.art).toBeUndefined();
	});

	it("splits spellkave_scene into the place, its exits and the occupants", () => {
		const { place, occupants } = sceneFromPayload(scene, "1");
		expect(place?.name).toBe("Creation Limbo");
		expect(place?.description).toBe("A place outside the adventure.");
		expect(place?.exits).toEqual([
			{
				handle: "s:exit:276",
				rev: "1hxxv50",
				label: "northeast",
				to: "inn/common_room",
				toName: "Common Room",
				gates: ["elven_mini/affordance/dm_threshold"],
			},
		]);
		expect(occupants.map((entry) => entry.name)).toEqual([
			"World Operator",
			"Aldwin, keeper of the hearth-ledger",
			"Cellar Rat 1",
		]);
		expect(occupants[2]?.note).toBe("Dead");
		expect(occupants.map((entry) => entry.sceneKind)).toEqual(["actor", "actor", "actor"]);
		// sk-jay0.1.8.63.9: an occupant whose scene listing carries `entity_def_id`
		// surfaces it as `defId` — absent (never `""`) for one that does not.
		expect(occupants[2]?.defId).toBe("srd/creature/cellar-rat");
		expect(occupants[1]?.defId).toBeUndefined();
	});

	it("reads authorized scene_detail fields without inventing taxonomy", () => {
		const detail = occupantDetailFromPayload(
			{
				status: "ok",
				handle: "s:actor:4",
				rev: "a4",
				target: {
					kind: "actor",
					id: "4",
					label: "Aldwin",
					detail: {
						entity_id: "4",
						name: "Aldwin",
						faction: "inn",
						entity_def_id: "srd/creature/human-commoner",
						description: "Keeper of the hearth-ledger.",
						appearance: "A tired innkeeper",
						conditions: [{ condition_definition_id: "srd/condition/prone", stack_count: 1 }],
					},
				},
			},
			{ id: "4", handle: "s:actor:4", rev: "a4" },
		);
		expect(detail).toMatchObject({
			id: "4",
			entityId: "4",
			defId: "srd/creature/human-commoner",
			handle: "s:actor:4",
			rev: "a4",
			description: "Keeper of the hearth-ledger.",
		});
		expect(detail?.facts.map((fact) => fact.id)).toEqual([
			"appearance",
			"faction",
			"srd/condition/prone",
		]);
		expect(
			occupantDetailFromPayload({ status: "error" }, { id: "4", handle: "s:actor:4", rev: "a4" }),
		).toBeNull();
	});

	it("leaves defId absent when scene_detail resolves no entity_def_id (sk-jay0.1.8.63.9)", () => {
		const detail = occupantDetailFromPayload(
			{
				status: "ok",
				handle: "s:actor:18",
				rev: "op",
				target: {
					kind: "actor",
					id: "18",
					label: "World Operator",
					detail: { entity_id: "18", name: "World Operator", faction: null },
				},
			},
			{ id: "18", handle: "s:actor:18", rev: "op" },
		);
		expect(detail?.defId).toBeUndefined();
	});

	it("maps a creature/actor cue to the creature kind when the scene item carries one (sk-jay0.1.7 item 2)", () => {
		// `spellkave_scene`'s live payload (the `scene` fixture above, copied
		// from a real answer) carries NO species/creature signal at all today —
		// this is a genuine tool-contract gap (see `occupantKindForActor`'s own
		// doc comment in play-view.ts). Exercise the mapping defensively
		// against the `identity`-tag shape `spellkave_self_summary` already
		// uses for a body's OWN creature niche (`srd.creature`), so a future
		// tool version that starts forwarding it needs no further client change.
		const withCreatureCue = {
			details: {
				...scene.details,
				items: [
					...scene.details.items.slice(0, 2),
					{ ...scene.details.items[2], identity: ["srd.creature"] },
					...scene.details.items.slice(3),
				],
			},
		};
		const { occupants } = sceneFromPayload(withCreatureCue, "1");
		const cellarRat = occupants.find((entry) => entry.name === "Cellar Rat 1");
		expect(cellarRat?.kind).toBe("creature");
		expect(cellarRat?.note).toBe("Dead");
	});

	it("stays 'person' with no creature/actor cue, matching the live payload today", () => {
		const { occupants } = sceneFromPayload(scene, "1");
		expect(occupants.find((entry) => entry.name === "Cellar Rat 1")?.kind).toBe("person");
	});

	it("maps a condition id to a player-facing label, falling back to humanising an unmapped one", () => {
		expect(conditionLabel("srd/condition/dead")).toBe("Dead");
		expect(conditionLabel("srd/condition/prone")).toBe("Prone");
		expect(conditionLabel("srd/condition/some-future-condition")).toBe("Some Future Condition");
	});

	it("humanises a node id only when the world authored no name", () => {
		expect(humaniseNodeId("inn/common_room")).toBe("Common Room");
		const unnamed = sceneFromPayload({ details: { ...scene.details, node_display_name: "" } }, "1");
		expect(unnamed.place?.name).toBe("Station");
	});

	it("recognises canonical speech descriptors even when the supplied verb class is manipulate", () => {
		// The recorded live cellar fight supplies actor-carried Speak Aloud
		// through `manipulate`, but the descriptor remains the authoritative
		// free-text contract.
		expect(actionAcceptsUtterance("manipulate", "srd/speak-aloud", "Speak Aloud")).toBe(true);
		expect(actionAcceptsUtterance("manipulate", "srd/action/dodge", "Dodge")).toBe(false);
	});

	it("prefers the SDK's own participant name over the scene map (a fight on a session grid lists no occupants)", () => {
		const status = sessionFromPayload(
			{
				details: {
					status: "session_detail",
					session: {
						session_id: "3",
						lifecycle: "open",
						roster: [
							{ actor_id: "145", ordinal: 0, name: "Cellar Rat 3" },
							{ actor_id: "1", ordinal: 3, name: null },
						],
						current_actor: "145",
						my_turn: false,
					},
				},
			},
			"1",
			(id) => ({ "1": "Mira" })[id] ?? id,
		);
		expect(status.roster.map((entry) => entry.name)).toEqual(["Cellar Rat 3", "Mira"]);
		expect(status.currentActorName).toBe("Cellar Rat 3");
	});

	it("reads turn order from spellkave_session_status and names the seats", () => {
		const nameOf = (id: string) => ({ "1": "Renn", "123": "Cellar Rat 1" })[id] ?? id;
		const status = sessionFromPayload(
			{
				details: {
					status: "ok",
					session: {
						session_id: "9",
						lifecycle: "open",
						current_actor: "123",
						my_turn: false,
						roster: [
							{ actor_id: "123", ordinal: 1 },
							{ actor_id: "1", ordinal: 0 },
						],
					},
				},
			},
			"1",
			nameOf,
		);
		expect(status.inSession).toBe(true);
		expect(status.currentActorName).toBe("Cellar Rat 1");
		expect(status.roster.map((entry) => [entry.name, entry.isMe, entry.isCurrent])).toEqual([
			["Renn", true, false],
			["Cellar Rat 1", false, true],
		]);
		expect(
			sessionFromPayload({ details: { status: "no_session", session: null } }, "1", nameOf)
				.inSession,
		).toBe(false);
	});

	it("takes the first open reaction window, falling back to intervention windows", () => {
		const nameOf = (id: string) => (id === "123" ? "Cellar Rat 1" : id);
		const none = { details: { rev: "r0", items: [], matched: 0 } };
		expect(reactionFromPayloads(none, none, nameOf)).toBeNull();
		const reaction = reactionFromPayloads(
			{
				details: {
					rev: "r1",
					items: [
						{ handle: "r0", originating_action_id: "srd/attack/melee", originating_actor: "123" },
					],
				},
			},
			none,
			nameOf,
		);
		expect(reaction).toMatchObject({
			windowKind: "reaction",
			handle: "r0",
			rev: "r1",
			originatingActorName: "Cellar Rat 1",
		});
	});

	it("flattens the inventory tree into pack items, mapping the raw equipped slot id to a label", () => {
		// `equipped_slot` arrives as the world's own SRD slot id, not a
		// human word — the live rig sent `srd/slot/main-hand`, which pack
		// rows rendered raw (uppercased by the `sk-label` style into
		// "SRD/SLOT/MAIN-HAND", sk-jay0.1.8.11 item 4).
		const pack = packFromPayload({
			details: {
				listing: "complete",
				items: [
					{
						entity_id: "12",
						name: "Longsword",
						kind: "weapon",
						quantity: 1,
						equipped_slot: "srd/slot/main-hand",
					},
					{
						entity_id: "20",
						name: "Backpack",
						kind: "container",
						quantity: 1,
						contents: [{ entity_id: "13", name: "Rations", kind: "provisions", quantity: 3 }],
					},
				],
			},
		});
		expect(pack.map((item) => [item.name, item.quantity, item.equipped])).toEqual([
			["Longsword", 1, "Main Hand"],
			["Backpack", 1, null],
			["Rations", 3, null],
		]);
		expect(pack[2]?.detail).toContain("carried inside");
	});

	it("humanises an unmapped equipped slot id instead of showing it raw", () => {
		const pack = packFromPayload({
			details: {
				listing: "complete",
				items: [
					{
						entity_id: "5",
						name: "Boots",
						kind: "armor",
						quantity: 1,
						equipped_slot: "srd/slot/feet",
					},
				],
			},
		});
		expect(pack[0]?.equipped).toBe("Feet");
	});

	it("humanises an item-detail slot id that arrives with no slot_label", () => {
		const detail = itemDetailFromPayload({
			details: {
				status: "ok",
				rev: "p1",
				handle: "i:5",
				item: {
					entity_id: "5",
					name: "Boots",
					entity_def_id: "srd/item/boots",
					kind: "armor",
					quantity: 1,
					containment: { container_id: "7", depth: 0, container_path: [], slot_id: "" },
					equipment: { owner_entity_id: "7", slot_id: "srd/slot/feet", equipped_at_tick: 12 },
					states: [],
				},
			},
		});
		expect(detail?.slot).toBe("Feet");
	});

	it("turns speech_heard events and speech trace details into dialogue lines", () => {
		const lines = speechFromEvents(
			[
				{
					kind: "speech_heard",
					inscribed_at: 90,
					trace_id: "7",
					trace_kind: "srd/speech",
					text: "Which class?",
					inscribed_by: "4",
					inscribed_by_name: "Aldwin, keeper of the hearth-ledger",
					location_kind: "place_node",
					location_ref: "x",
					observed_at_tick: 90,
				},
				{ kind: "xp_gained", amount: 10, observed_at_tick: 91 },
			],
			"7-self",
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			id: "speech:7",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "Which class?",
			mine: false,
		});

		const refs = traceRefsFromListing(
			{
				details: {
					items: [{ handle: "t:2", rev: "1mtokz", kind: "srd/speech", inscribed_at: 91 }],
				},
			},
			"srd/speech",
		);
		expect(refs).toEqual([{ handle: "t:2", rev: "1mtokz", id: "2", tick: 91 }]);
		const line = speechFromTraceDetail(
			{
				details: {
					status: "ok",
					trace: {
						trace_id: "2",
						kind: "srd/speech",
						inscribed_by: "1",
						inscribed_at: 91,
						payload: { text: "Hello." },
					},
				},
			},
			(id) => (id === "1" ? "Renn" : id),
			"1",
		);
		expect(line).toMatchObject({ id: "speech:2", speaker: "Renn", text: "Hello.", mine: true });
	});

	it("marks a speech_heard event as mine when the world's own inscribed_by matches the self actor", () => {
		const lines = speechFromEvents(
			[
				{
					kind: "speech_heard",
					inscribed_at: 92,
					trace_id: "9",
					trace_kind: "srd/speech",
					text: "I choose Fighter.",
					inscribed_by: "7",
					inscribed_by_name: "Renn",
					location_kind: "place_node",
					location_ref: "x",
					observed_at_tick: 92,
				},
			],
			"7",
		);
		expect(lines).toEqual([
			expect.objectContaining({ id: "speech:9", mine: true, text: "I choose Fighter." }),
		]);
	});

	it("keeps an own dialog-choice event with empty text, marked by its slot (D1: the choice's word is resolved later, never invented here)", () => {
		const lines = speechFromEvents(
			[
				{
					kind: "speech_heard",
					inscribed_at: 93,
					trace_id: "10",
					trace_kind: "srd/speech",
					text: "",
					action_id: "dm/dialog/choice/5",
					response: { action_id: "dm/dialog/choice/5", slot: 5 },
					inscribed_by: "7",
					inscribed_by_name: "Renn",
					location_kind: "place_node",
					location_ref: "x",
					observed_at_tick: 93,
				},
			],
			"7",
		);
		expect(lines).toEqual([
			expect.objectContaining({ id: "speech:10", mine: true, text: "", choiceSlot: 5 }),
		]);
	});

	it("drops a quiet speech_heard event that carries neither words nor a dialog choice", () => {
		const lines = speechFromEvents(
			[
				{
					kind: "speech_heard",
					inscribed_at: 94,
					trace_id: "11",
					trace_kind: "srd/speech",
					text: "",
					inscribed_by: "7",
					inscribed_by_name: "Renn",
					location_kind: "place_node",
					location_ref: "x",
					observed_at_tick: 94,
				},
			],
			"7",
		);
		expect(lines).toEqual([]);
	});

	// Shapes below are built from the tool source, not live-recorded (no
	// staged world was available in this session): `spellkave_self_states`'s
	// row shape is `queryPage`'s `QueryEnvelope` (packages/spellkave-tool-
	// contracts/src/query-protocol.ts) wrapping `ActorStateEntry`
	// (`state_id`/`display_name`/`value`, packages/spellkave-sdk/src/core/
	// readers/actor_states.ts) for `kind: "state"`, or `CompactSelfCapability`
	// (`capability_id`/`display_name`/`source`, packages/spellkave-sdk/src/
	// core/readers/self_capabilities.ts) for `kind: "capability"`.
	it("reads the six abilities and Proficiency Bonus from spellkave_self_states(kind: state), computing modifiers from the reported score", () => {
		const selfStates = {
			details: {
				listing: "paginated",
				shown: 8,
				matched: 8,
				truncated: false,
				next_cursor: null,
				rev: "s1",
				items: [
					{ state_id: "srd/hp", display_name: "Hit Points", value: "11" },
					{ state_id: "srd/str", display_name: "Strength", value: "16" },
					{ state_id: "srd/dex", display_name: "Dexterity", value: "12" },
					{ state_id: "srd/con", display_name: "Constitution", value: "14" },
					{ state_id: "srd/int", display_name: "Intelligence", value: "10" },
					{ state_id: "srd/wis", display_name: "Wisdom", value: "11" },
					{ state_id: "srd/cha", display_name: "Charisma", value: "9" },
					{ state_id: "srd/proficiency_bonus", display_name: "Proficiency Bonus", value: "2" },
				],
			},
		};
		const { abilities, proficiency } = selfStateFacetsFromPayload(selfStates);
		expect(abilities.map((ability) => [ability.label, ability.score, ability.modifier])).toEqual([
			["STR", 16, 3],
			["DEX", 12, 1],
			["CON", 14, 2],
			["INT", 10, 0],
			["WIS", 11, 0],
			["CHA", 9, -1],
		]);
		expect(proficiency).toBe(2);
	});

	it("retains authorized state and identity prose without adding unselected values", () => {
		const states = {
			items: [
				{ state_id: "other/stress", value: "0", description: "Stress explanation" },
				{ state_id: "srd/str", value: "16", description: "Strength explanation" },
				{ state_id: "srd/proficiency_bonus", value: "2", description: "Training explanation" },
			],
		};
		const hero = heroFromSelfSummary(
			"1",
			{
				self: {
					entity_name: "Pilot",
					vitals: [{ state_id: "other/stress", display_name: "Stress", value: "0" }],
					identity: [{ tag: "srd.species.human" }],
				},
			},
			states,
			{
				items: [
					{ tag: "srd.species.human", description: "Human explanation" },
					{ tag: "srd.class.fighter", description: "Unselected explanation" },
				],
			},
		);
		expect(hero.vitals).toEqual([
			{ id: "other/stress", label: "Stress", value: "0", description: "Stress explanation" },
		]);
		expect(hero.suppliedFields?.vitals).toBe(2);
		expect(hero.identityDetails).toEqual([
			{ id: "srd.species.human", label: "Human", description: "Human explanation" },
		]);
		expect(selfStateFacetsFromPayload(states)).toEqual({
			abilities: [
				{
					id: "srd/str",
					label: "STR",
					score: 16,
					modifier: 3,
					description: "Strength explanation",
				},
			],
			proficiency: 2,
			proficiencyDescription: "Training explanation",
		});
	});

	it("reads skill chips from spellkave_self_states(kind: capability), leaving masteries empty until the substrate grants any", () => {
		const capabilities = {
			details: {
				listing: "paginated",
				shown: 2,
				matched: 2,
				truncated: false,
				next_cursor: null,
				rev: "c1",
				items: [
					{
						capability_id: "srd/skill/athletics",
						display_name: "Athletics",
						source: "class",
					},
					{
						capability_id: "srd/fighting-style/defense",
						display_name: "Fighting Style: Defense",
						source: "class",
					},
				],
			},
		};
		const { skills, masteries } = capabilityChipsFromPayload(capabilities);
		expect(skills).toEqual([{ id: "srd/skill/athletics", label: "Athletics" }]);
		// No `srd/mastery/…`-style capability exists in the substrate yet
		// (packages/spellkave-srd-cc/src/chapters/classes/fighter-units.ts:
		// weapon mastery properties are pending Equipment-chapter work) — a
		// non-skill, non-mastery capability (a fighting style) is neither
		// chip, matching that gap honestly rather than mis-bucketing it.
		expect(masteries).toEqual([]);
	});

	it("strips the live rig's own 'Skill: ' lead-in from a skill chip's label", () => {
		// The live rig's `display_name` for a skill capability repeats the
		// category as a prefix ("Skill: Athletics") — every id in this
		// branch already starts with `srd/skill/`, so the chip need not
		// say it twice (sk-jay0.1.8.11 item 7, co-play live-14-pack.png).
		const { skills } = capabilityChipsFromPayload({
			details: {
				items: [
					{
						capability_id: "srd/skill/athletics",
						display_name: "Skill: Athletics",
						source: "class",
					},
				],
			},
		});
		expect(skills).toEqual([{ id: "srd/skill/athletics", label: "Athletics" }]);
	});

	it("reads only the channels spellkave_self_states(kind: economy) actually returned, in order", () => {
		const economy = economyFromPayload({
			details: {
				items: [
					{ channel_id: "srd/economy_channel/primary", spent_ms: "1000", window_start_ms: "0" },
					{ channel_id: "srd/economy_channel/bonus", spent_ms: "0", window_start_ms: "0" },
				],
			},
		});
		expect(economy).toEqual([
			{ channelId: "srd/economy_channel/primary", spentMs: 1000, windowStartMs: 0 },
			{ channelId: "srd/economy_channel/bonus", spentMs: 0, windowStartMs: 0 },
		]);
	});

	it("tolerates a missing window_start_ms and drops a row with no channel_id", () => {
		const economy = economyFromPayload({
			details: {
				items: [
					{ channel_id: "srd/economy_channel/reaction", spent_ms: "500" },
					{ spent_ms: "9999", window_start_ms: "0" },
				],
			},
		});
		expect(economy).toEqual([
			{ channelId: "srd/economy_channel/reaction", spentMs: 500, windowStartMs: 0 },
		]);
	});

	it("answers an honest empty page rather than null when the actor has spent nothing yet", () => {
		expect(economyFromPayload({ details: { items: [] } })).toEqual([]);
	});

	it("answers null for a failed read, never an invented row", () => {
		expect(economyFromPayload(null)).toBeNull();
	});

	describe("economyBudgetFromPayload — spellkave_self_states(kind: economy_budget)", () => {
		it("reads a disclosed ok channel's pool/remaining, deriving a short label", () => {
			const budget = economyBudgetFromPayload({
				details: {
					status: "ok",
					items: [
						{
							channel_id: "srd/economy_channel/primary",
							pool_ms_per_round: "6000",
							effective_pool_ms: "6000",
							spent_ms: "1000",
							remaining_ms: "5000",
							off_turn_eligible: false,
							status: "ok",
						},
					],
				},
			});
			expect(budget).toEqual({
				channels: [
					{
						channelId: "srd/economy_channel/primary",
						label: "Action",
						poolMs: 6000,
						remainingMs: 5000,
						spentMs: 1000,
						status: "ok",
						offTurnEligible: false,
					},
				],
				unavailable: false,
			});
		});

		it("keeps a pending_boundary channel's pool/remaining unknown, never zero", () => {
			const budget = economyBudgetFromPayload({
				details: {
					status: "pending_boundary",
					items: [
						{
							channel_id: "srd/economy_channel/reaction",
							pool_ms_per_round: "6000",
							spent_ms: "0",
							off_turn_eligible: true,
							status: "pending_boundary",
						},
					],
				},
			});
			expect(budget).toEqual({
				channels: [
					{
						channelId: "srd/economy_channel/reaction",
						label: "Reaction",
						poolMs: null,
						remainingMs: null,
						spentMs: 0,
						status: "pending_boundary",
						offTurnEligible: true,
					},
				],
				unavailable: false,
			});
		});

		it("keeps an unknown_channel row's numbers unknown, distinct from pending_boundary", () => {
			const budget = economyBudgetFromPayload({
				details: {
					status: "ok",
					items: [
						{
							channel_id: "srd/economy_channel/object_interaction",
							spent_ms: "0",
							off_turn_eligible: false,
							status: "unknown_channel",
						},
					],
				},
			});
			expect(budget?.channels).toEqual([
				{
					channelId: "srd/economy_channel/object_interaction",
					label: "Object",
					poolMs: null,
					remainingMs: null,
					spentMs: 0,
					status: "unknown_channel",
					offTurnEligible: false,
				},
			]);
		});

		it("answers { channels: [], unavailable: true } when the envelope itself is unavailable", () => {
			expect(
				economyBudgetFromPayload({
					details: { status: "unavailable", reason: "world_time", items: [] },
				}),
			).toEqual({ channels: [], unavailable: true });
		});

		it("answers null for a missing/failed read, never an invented budget", () => {
			expect(economyBudgetFromPayload(null)).toBeNull();
			expect(economyBudgetFromPayload(undefined)).toBeNull();
		});
	});

	// sk-jay0.4.2: spellkave_map's session_tokens, parsed from the SAME
	// payload mapSvgFromPayload reads.
	it("reads session_tokens naming node/actor/name, marking the caller's own row", () => {
		const tokens = sessionTokensFromPayload({
			details: {
				session_tokens: [
					{ node_id: "session_grid_9/c_0_0", actor_id: "1", name: "Renn", is_me: true },
					{ node_id: "session_grid_9/c_1_0", actor_id: "2", name: "Cellar Rat 1", is_me: false },
				],
			},
		});
		expect(tokens).toEqual([
			{ nodeId: "session_grid_9/c_0_0", actorId: "1", name: "Renn", isMe: true },
			{ nodeId: "session_grid_9/c_1_0", actorId: "2", name: "Cellar Rat 1", isMe: false },
		]);
	});

	it("falls back to the actor id when a row carries no name, and drops a row missing node_id or actor_id", () => {
		const tokens = sessionTokensFromPayload({
			details: {
				session_tokens: [
					{ node_id: "session_grid_9/c_0_0", actor_id: "3", is_me: false },
					{ node_id: "session_grid_9/c_2_2", is_me: false },
					{ actor_id: "4", is_me: false },
				],
			},
		});
		expect(tokens).toEqual([
			{ nodeId: "session_grid_9/c_0_0", actorId: "3", name: "3", isMe: false },
		]);
	});

	it("answers [] (never an error) when the field is absent — no tactical session open", () => {
		expect(sessionTokensFromPayload({ details: { has_layout: true } })).toEqual([]);
	});

	it("answers [] for a failed read, matching mapSvgFromPayload's own failure shape", () => {
		expect(sessionTokensFromPayload(null)).toEqual([]);
	});

	it("reads item facts and the slot chip, omitting description when the answer supplies none", () => {
		const itemDetail = {
			details: {
				status: "ok",
				rev: "p12",
				handle: "i:12",
				item: {
					entity_id: "12",
					name: "Longsword",
					entity_def_id: "srd/item/longsword",
					kind: "weapon",
					quantity: 1,
					containment: { container_id: "7", depth: 0, container_path: [], slot_id: "main_hand" },
					equipment: {
						owner_entity_id: "7",
						slot_id: "main_hand",
						slot_label: "Main Hand",
						equipped_at_tick: 12,
					},
					states: [
						{
							state_id: "srd/damage",
							value: "1d8",
							source_template_id: "srd/item/longsword",
							set_at_tick: 0,
							expires_at_tick: 0,
							bundle_id: "srd",
						},
					],
				},
			},
		};
		const detail = itemDetailFromPayload(itemDetail);
		expect(detail).toEqual({
			id: "12",
			definitionRef: "srd/item/longsword",
			suppliedFields: 2,
			kind: "Weapon",
			slot: "Main Hand",
			facts: [{ id: "srd/damage", label: "Damage", value: "1d8" }],
		});
	});

	it("unwraps a tagged JSON state value and presents the SRD's copper / tenths-of-a-pound units in player terms", () => {
		const detail = itemDetailFromPayload({
			details: {
				status: "ok",
				rev: "p12",
				handle: "i:12",
				item: {
					entity_id: "12",
					name: "Greataxe",
					entity_def_id: "srd/item/greataxe",
					kind: "weapon",
					quantity: 1,
					containment: { container_id: "7", depth: 0, container_path: [], slot_id: "main_hand" },
					equipment: null,
					states: [
						{
							state_id: "srd/cost",
							display_name: "Cost (copper)",
							value: '{"tag":"Int","value":"3000"}',
						},
						{
							state_id: "srd/weight",
							display_name: "Weight (tenths of a pound)",
							value: '{"tag":"Int","value":"75"}',
						},
						{ state_id: "srd/damage", display_name: "Damage", value: "1d12 slashing" },
					],
				},
			},
		});
		expect(detail?.facts).toEqual([
			{ id: "srd/cost", label: "Cost", value: "30 gp" },
			{ id: "srd/weight", label: "Weight", value: "7.5 lb" },
			{ id: "srd/damage", label: "Damage", value: "1d12 slashing" },
		]);
	});

	it("humanises a fact's recognized unit suffix into a label + a formatted value, leaving a non-measurement value (dice notation) untouched (coordinator review: 'WEIGHT G 1360')", () => {
		const detail = itemDetailFromPayload({
			details: {
				status: "ok",
				rev: "p12",
				handle: "i:12",
				item: {
					entity_id: "12",
					name: "Longsword",
					entity_def_id: "srd/item/longsword",
					kind: "weapon",
					quantity: 1,
					containment: { container_id: "7", depth: 0, container_path: [], slot_id: "main_hand" },
					equipment: null,
					states: [
						{
							state_id: "srd/weight_g",
							value: "1360",
							source_template_id: "srd/item/longsword",
							set_at_tick: 0,
							expires_at_tick: 0,
							bundle_id: "srd",
						},
						{
							state_id: "srd/damage",
							value: "1d8",
							source_template_id: "srd/item/longsword",
							set_at_tick: 0,
							expires_at_tick: 0,
							bundle_id: "srd",
						},
						{
							state_id: "srd/reach_mm",
							value: "1500",
							source_template_id: "srd/item/longsword",
							set_at_tick: 0,
							expires_at_tick: 0,
							bundle_id: "srd",
						},
						{
							state_id: "srd/some_future_flag",
							value: "true",
							source_template_id: "srd/item/longsword",
							set_at_tick: 0,
							expires_at_tick: 0,
							bundle_id: "srd",
						},
					],
				},
			},
		});
		expect(detail?.facts).toEqual([
			{ id: "srd/weight_g", label: "Weight", value: "1,360 g" },
			{ id: "srd/damage", label: "Damage", value: "1d8" },
			{ id: "srd/reach_mm", label: "Reach", value: "1,500 mm" },
			{ id: "srd/some_future_flag", label: "Some Future Flag", value: "true" },
		]);
	});

	it("reports item_unavailable as no detail, never a stale or invented one", () => {
		expect(
			itemDetailFromPayload({
				details: { status: "item_unavailable", rev: "p12", handle: "i:12", reason: "gone" },
			}),
		).toBeNull();
	});
});

describe("mergeSpeech: the one world-ordered speech stream (sk-jay0.1.8.12)", () => {
	function line(id: string, tick: number, text = id): PlaySpeech {
		return { id, tick, speakerId: "4", speaker: "Aldwin", text, mine: false };
	}

	it("orders by tick, then by trace id on a tie, never by insertion order", () => {
		const merged = mergeSpeech(
			[],
			[line("speech:3", 10), line("speech:1", 10), line("speech:2", 5)],
		);
		expect(merged.map((entry) => entry.id)).toEqual(["speech:2", "speech:1", "speech:3"]);
	});

	it("dedupes by trace id: the same trace arriving from a live event and from the trace backfill collapses to one line", () => {
		const fromBackfill = mergeSpeech([], [line("speech:7", 20, "Which class calls to you?")]);
		// The live path answers the identical id (`speech:<trace id>`, no
		// per-call sequence number) a moment later — a second `readView` must
		// not duplicate it.
		const merged = mergeSpeech(fromBackfill, [line("speech:7", 20, "Which class calls to you?")]);
		expect(merged).toHaveLength(1);
	});

	it("keeps the newest supplied text for a retained speech trace", () => {
		const unresolved = mergeSpeech([], [{ ...line("speech:5", 30, ""), choiceSlot: 5 }]);
		const resolved = mergeSpeech(unresolved, [
			{ ...line("speech:5", 30, "5 Fighter"), choiceSlot: 5 },
		]);
		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.text).toBe("5 Fighter");
	});

	it("returns a fresh copy, unchanged, when nothing new arrived", () => {
		const previous = mergeSpeech([], [line("speech:1", 1)]);
		const merged = mergeSpeech(previous, []);
		expect(merged).toEqual(previous);
		expect(merged).not.toBe(previous);
	});

	it("orders a same-tick burst by NUMERIC trace id across a digit boundary, never a string compare (live-rig finding: trace 10 rendered before traces 6-9)", () => {
		// "speech:10" < "speech:6" lexically (the digit "1" sorts before "6"),
		// which put Aldwin's "Which species?" (trace 10) before the player's
		// own earlier answers (traces 6-9) in the SAME burst on the live rig.
		// Shuffled arrival order on purpose — the merge/sort must not lean on
		// insertion order either.
		const shuffled = [11, 6, 9, 7, 10, 8].map((n) => line(`speech:${n}`, 100));
		const merged = mergeSpeech([], shuffled);
		expect(merged.map((entry) => entry.id)).toEqual([
			"speech:6",
			"speech:7",
			"speech:8",
			"speech:9",
			"speech:10",
			"speech:11",
		]);
	});

	it("falls back to a string compare only when the trace id is not a plain integer", () => {
		const merged = mergeSpeech([], [line("speech:abc", 5), line("speech:xyz", 5)]);
		expect(merged.map((entry) => entry.id)).toEqual(["speech:abc", "speech:xyz"]);
	});
});

describe("CHRONICLE_KIND_RULES / chronicleKindRule (sk-jay0.1.8.13)", () => {
	// One row per real `WorldEvent` kind — task 2's own "unit-tested per
	// kind" acceptance clause, checked against the CLOSED union rather than
	// a hand-picked subset so a kind this table forgets is caught here, not
	// only by the `Record<WorldEvent["kind"], …>` type at compile time.
	const cases: [
		WorldEvent["kind"],
		"speech" | "fight" | "conditions" | "comings" | "things",
		boolean,
	][] = [
		["session_lifecycle", "comings", true],
		["turn_transition", "fight", false],
		["self_hit", "fight", true],
		["dealt_hit", "fight", true],
		["self_condition_changed", "conditions", true],
		["dealt_condition", "conditions", true],
		["xp_gained", "things", false],
		["self_resource_spent", "things", false],
		["reaction_window", "fight", true],
		["advancement_available", "things", true],
		["speech_heard", "speech", true],
		["trace_addressed", "speech", false],
		["trace_departure", "comings", false],
	];

	it.each(cases)("%s → chip %s, important %s", (kind, chip, important) => {
		expect(CHRONICLE_KIND_RULES[kind]).toEqual({ chip, important });
		expect(chronicleKindRule(kind)).toEqual({ chip, important });
	});

	it("covers every kind in the closed WorldEvent union, none twice", () => {
		expect(Object.keys(CHRONICLE_KIND_RULES).sort()).toEqual(cases.map(([kind]) => kind).sort());
	});

	it("falls back to the Things chip, not important, for a kind outside the closed union (a demo fixture's own placeholder kind)", () => {
		expect(chronicleKindRule("passage_opened")).toEqual({ chip: "things", important: false });
	});
});

describe("selfStateFacetsFromPayload: experience from the state read", () => {
	it("reads srd/xp so a kill's XP reaches the sheet even when the self summary omits it", () => {
		const facets = selfStateFacetsFromPayload({
			details: {
				status: "ok",
				items: [
					{ state_id: "srd/str", value: "15" },
					{ state_id: "srd/xp", value: "25" },
				],
			},
		});
		expect(facets.xp).toBe(25);
		expect(facets.abilities.map((ability) => ability.id)).toEqual(["srd/str"]);
	});
});

// K2: structured causal history is independent of labels and action-id spelling.
it("renders a delayed response's answered words supplied by the tool", () => {
	const lines = speechFromEvents(
		[
			{
				kind: "speech_heard",
				trace_id: "old",
				trace_kind: "speech",
				text: "",
				action_id: "unrelated/action",
				response: {
					action_id: "unrelated/action",
					slot: 2,
					occurrence_id: "11",
					label: "The answered words",
				},
				inscribed_at: 1,
				observed_at_tick: 99,
				inscribed_by: "1",
				inscribed_by_name: "Hero",
				location_kind: "place_node",
				location_ref: "room",
			},
		],
		"1",
	);
	expect(lines).toMatchObject([{ text: "The answered words", choiceSlot: 2 }]);
});

describe("speaker name memory (sk-jay0.1.8.96 s8)", () => {
	const heard = (traceId: string, speaker: string | null, name: string | null): WorldEvent => ({
		kind: "speech_heard",
		inscribed_at: 90,
		trace_id: traceId,
		trace_kind: "srd/speech",
		text: "It's done. Welcome to the world.",
		inscribed_by: speaker,
		inscribed_by_name: name,
		location_kind: "place_node",
		location_ref: "x",
		observed_at_tick: 90,
	});

	it("shows the name learned earlier when the event arrives unnamed", () => {
		const known = new Map<string, string>();
		learnSpeakerNames([heard("7", "4", "Aldwin")], known);
		expect(known).toEqual(new Map([["4", "Aldwin"]]));
		expect(speechFromEvents([heard("8", "4", null)], "1", known)[0]?.speaker).toBe("Aldwin");
	});

	it("keeps 'Someone' for a speaker never named, for no speaker id, and with no memory", () => {
		const known = new Map([["4", "Aldwin"]]);
		expect(speechFromEvents([heard("8", "5", null)], "1", known)[0]?.speaker).toBe("Someone");
		expect(speechFromEvents([heard("8", null, null)], "1", known)[0]?.speaker).toBe("Someone");
		expect(speechFromEvents([heard("8", "4", null)], "1")[0]?.speaker).toBe("Someone");
	});

	it("lets the world's own name win over the remembered one, and remembers the newest", () => {
		const known = new Map([["4", "A stranger"]]);
		expect(speechFromEvents([heard("8", "4", "Aldwin")], "1", known)[0]?.speaker).toBe("Aldwin");
		learnSpeakerNames([heard("8", "4", "Aldwin"), heard("9", "4", null)], known);
		expect(known.get("4")).toBe("Aldwin");
	});

	it("never names an earlier line from a later event of the same batch", () => {
		const known = new Map<string, string>();
		const lines = speechFromEventsRemembering(
			[heard("7", "4", null), heard("8", "4", "Aldwin"), heard("9", "4", null)],
			"1",
			known,
		);
		expect(lines.map((line) => line.speaker)).toEqual(["Someone", "Aldwin", "Aldwin"]);
		expect(known).toEqual(new Map([["4", "Aldwin"]]));
	});

	it("learns from speech only", () => {
		const known = new Map<string, string>();
		learnSpeakerNames(
			[{ kind: "xp_gained", amount: 10, observed_at_tick: 4 }, heard("7", null, "Nobody")],
			known,
		);
		expect(known.size).toBe(0);
	});
});

describe("a hero still being drafted (sk-jay0.1.8.102 s3)", () => {
	const summary = (conditions: unknown[]) => ({
		self: {
			vitals: {
				items: [
					{ state_id: "srd/hp", display_name: "Hit Points", value: "0" },
					{ state_id: "srd/ac", display_name: "Armor Class", value: "0" },
					{ state_id: "srd/xp", display_name: "Experience", value: "0" },
					{ state_id: "srd/level", display_name: "Level", value: "1" },
				],
			},
			conditions: { items: conditions },
		},
	});

	it("hides HP, AC and XP while the world's drafting condition is on the hero", () => {
		const hero = heroFromSelfSummary(
			"1",
			summary([{ condition_definition_id: HERO_DRAFTING_CONDITION_ID }]),
		);
		expect(hero.drafting).toBe(true);
		expect(hero.hp).toBeUndefined();
		expect(hero.ac).toBeUndefined();
		expect(hero.xp).toBeUndefined();
		expect("hp" in hero || "ac" in hero || "xp" in hero).toBe(false);
		expect(hero.vitals.map((vital) => vital.id)).toEqual(["srd/level"]);
		expect(hero.level).toBe(1);
		// The workflow condition itself still never shows as a condition.
		expect(hero.conditions).toEqual([]);
	});

	it("shows the numbers, zero included, for every other hero", () => {
		for (const conditions of [
			[],
			[{ condition_definition_id: "dm/level-up/drafting" }],
			[{ condition_definition_id: "other/creation/drafting" }],
		]) {
			const hero = heroFromSelfSummary("1", summary(conditions));
			expect(hero.drafting).toBeUndefined();
			expect([hero.hp, hero.ac, hero.xp]).toEqual([0, 0, 0]);
			expect(hero.vitals).toHaveLength(4);
		}
	});

	it("hideDraftVitals also drops an xp merged in afterwards, and leaves a finished hero alone", () => {
		const drafted = heroFromSelfSummary(
			"1",
			summary([{ condition_definition_id: HERO_DRAFTING_CONDITION_ID }]),
		);
		const merged = hideDraftVitals({ ...drafted, xp: 0 });
		expect("xp" in merged).toBe(false);
		const finished = { ...heroFromSelfSummary("1", summary([])), xp: 25 };
		expect(hideDraftVitals(finished)).toBe(finished);
	});
});

describe("the place's own floor (sk-jay0.1.8.111)", () => {
	const scene = (extra: Record<string, unknown>) => ({
		details: { node_id: "inn/cellar", scene_resolved: true, items: [], ...extra },
	});

	it("carries pose_elevation as the place elevation, zero included", () => {
		expect(sceneFromPayload(scene({ pose_elevation: -3 }), "1").place?.elevation).toBe(-3);
		expect(sceneFromPayload(scene({ pose_elevation: 0 }), "1").place?.elevation).toBe(0);
	});

	it("leaves it off when the world sends none", () => {
		expect(sceneFromPayload(scene({ pose_elevation: null }), "1").place).not.toHaveProperty(
			"elevation",
		);
		expect(sceneFromPayload(scene({}), "1").place).not.toHaveProperty("elevation");
	});
});
