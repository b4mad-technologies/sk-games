import { describe, expect, it } from "vitest";
import {
	composerActions,
	composerPrompts,
	composerTargets,
	draftWithPrompt,
	draftWithSelection,
	emptyComposerDraft,
	exitShellTexts,
	freezeCompletions,
	fuzzyCompletions,
	fuzzyMatchScore,
	intentFromComposer,
	promptAnswerShellTexts,
	shellSlug,
} from "./fact-composer";
import type { PlayManipulationAction, PlayManipulationContext } from "./play-view";

const context: PlayManipulationContext = {
	status: "ready",
	schemaVersion: 1,
	revision: 7,
	actions: [
		{
			actionId: "srd/inspect",
			displayName: "Inspect",
			tags: [],
			selfOnly: false,
			selfEligible: false,
		},
		{
			actionId: "dm/answer",
			displayName: "Answer",
			communicationSpeechActId: "dm/answer",
			tags: [],
			selfOnly: false,
			selfEligible: false,
		},
	],
	targets: [
		{ targetFactId: "chest", targetRef: "entity:chest", targetName: "Locked chest", tags: [] },
		{ targetFactId: "aldwin", targetRef: "entity:aldwin", targetName: "Aldwin", tags: [] },
	],
	participants: [],
	prompts: [],
};

describe("fact composer", () => {
	it("orders numbered labels numerically (sk-jay0.1.8.94)", () => {
		const numbered: PlayManipulationContext = {
			...context,
			actions: ["10", "2", "1", "16", "3"].map((slot) => ({
				actionId: `dm/dialog/choice/${slot}`,
				displayName: `Answer ${slot}`,
				tags: [],
				selfOnly: false,
				selfEligible: false,
			})),
		};
		expect(composerActions(numbered).map((entry) => entry.label)).toEqual([
			"Answer 1",
			"Answer 2",
			"Answer 3",
			"Answer 10",
			"Answer 16",
		]);
	});

	it("gives a niche-bound action no invented reason (sk-jay0.1.8.95)", () => {
		const nicheBound: PlayManipulationContext = {
			...context,
			actions: context.actions.map((action) =>
				action.actionId === "srd/inspect"
					? {
							...action,
							// Only presence matters here; the fields beyond the id are irrelevant.
							nicheRequirements: [
								{ niche_id: "srd/niche/container" },
							] as unknown as PlayManipulationAction["nicheRequirements"],
						}
					: action,
			),
		};
		const inspect = composerActions(nicheBound).find((entry) => entry.id === "srd/inspect");
		expect(inspect?.reason).toBeUndefined();
	});

	it("never shows a raw target or speaker reference (sk-jay0.1.8.92)", () => {
		const raw: PlayManipulationContext = {
			...context,
			targets: [
				{
					targetFactId: "self",
					targetRef: "entity:168",
					targetName: "entity:168",
					tags: [],
					nicheIds: ["n"],
				},
				{ targetFactId: "box", targetRef: "item:4", targetName: "", tags: [] },
			],
			prompts: [
				{
					occurrenceId: "p",
					promptDefId: "dm/prompt/name",
					contractVersion: 1,
					sourceRef: "entity:999",
					responseActionIds: [],
					openedAtTick: 1,
					consumed: false,
				},
			],
		};
		const targets = composerTargets(raw);
		expect(targets.map((entry) => entry.label)).toEqual(["Someone here", "Something here"]);
		expect(targets.every((entry) => entry.reason === undefined)).toBe(true);
		expect(composerPrompts(raw)[0]?.sourceName).toBe("Someone here");
	});

	it("keeps action syntax and perceived targets independent", () => {
		expect(composerActions(context).map((entry) => entry.label)).toEqual(["Answer", "Inspect"]);
		expect(composerTargets(context).map((entry) => entry.label)).toEqual([
			"Aldwin",
			"Locked chest",
		]);
	});

	it("ranks a prompt's authored response IDs and labels without hiding other actions", () => {
		const prompt = {
			occurrenceId: "42",
			promptDefId: "dm/prompt/class",
			contractVersion: 1,
			sourceRef: "entity:aldwin",
			sourceName: "Aldwin",
			responseActionIds: ["dm/answer", "srd/inspect"],
			openedAtTick: 10,
			consumed: false,
			presentation: {
				question: "Who are you?",
				labels: { "dm/answer": "Fighter" },
			},
		};
		expect(composerActions(context, prompt).map((entry) => entry.label)).toEqual([
			"Fighter",
			"Inspect",
		]);
	});

	it("uses a cue only to rank ordinary actions; a selected prompt remains first", () => {
		const withCue: PlayManipulationContext = {
			...context,
			actions: context.actions.map((action) =>
				action.actionId === "srd/inspect"
					? { ...action, cue: { rank: 9, hint: "The chest merits a closer look." } }
					: action,
			),
		};
		expect(composerActions(withCue).map((entry) => entry.id)).toEqual(["srd/inspect", "dm/answer"]);
		const prompt = {
			occurrenceId: "42",
			promptDefId: "dm/prompt/class",
			contractVersion: 1,
			sourceRef: "entity:aldwin",
			sourceName: "Aldwin",
			responseActionIds: ["dm/answer"],
			openedAtTick: 10,
			consumed: false,
		};
		expect(composerActions(withCue, prompt).map((entry) => entry.id)).toEqual([
			"dm/answer",
			"srd/inspect",
		]);
		expect(composerActions(withCue)[0]?.reason).toBe("The chest merits a closer look.");
	});

	it("keeps only unconsumed caller-scoped prompt facts and resolves a disclosed source name", () => {
		const prompts = composerPrompts({
			...context,
			prompts: [
				{
					occurrenceId: "consumed",
					promptDefId: "dm/prompt/old",
					contractVersion: 1,
					sourceRef: "entity:aldwin",
					responseActionIds: ["dm/answer"],
					openedAtTick: 1,
					consumed: true,
				},
				{
					occurrenceId: "open",
					promptDefId: "dm/prompt/class",
					contractVersion: 1,
					sourceRef: "entity:aldwin",
					responseActionIds: ["dm/answer"],
					openedAtTick: 2,
					consumed: false,
				},
			],
		});
		expect(prompts).toMatchObject([{ occurrenceId: "open", sourceName: "Aldwin" }]);
	});

	it("binds a newly opened prompt's source but leaves its response unselected", () => {
		const draft = draftWithPrompt(
			{ ...emptyComposerDraft(), actionId: "dm/answer", targetRef: "entity:old", utterance: "old" },
			{ sourceRef: "entity:aldwin", occurrenceId: "next" },
		);
		expect(draft).toMatchObject({
			actionId: null,
			targetRef: "entity:aldwin",
			utterance: "",
			semanticContext: { source_ref: "entity:aldwin", occurrence_id: "next" },
		});
	});

	it("prefills only a currently disclosed selected target", () => {
		const draft = draftWithSelection(
			emptyComposerDraft(),
			{ kind: "actor", actorId: "chest" },
			context,
		);
		expect(draft.targetRef).toBe("entity:chest");
		expect(draft.activePart).toBe("action");
		expect(draftWithSelection(draft, { kind: "actor", actorId: "chest" }, context)).toBe(draft);
		expect(draftWithSelection(draft, { kind: "actor", actorId: "missing" }, context)).toBe(draft);
	});

	it("freezes the displayed completion order", () => {
		const entries = composerActions(context);
		const frozen = freezeCompletions("action", 7, entries);
		const first = entries[0];
		if (first === undefined) throw new Error("fixture needs an action");
		first.label = "Changed outside snapshot";
		expect(frozen.entries[0]?.label).toBe("Answer");
	});

	it("fuzzy-matches only the frozen completion snapshot", () => {
		const entries = [
			{ id: "barbarian", label: "Barbarian", value: 1 },
			{ id: "bard", label: "Bard", value: 2 },
		];
		expect(fuzzyMatchScore("brbn", "Barbarian")).not.toBeNull();
		expect(fuzzyMatchScore("zz", "Barbarian")).toBeNull();
		expect(fuzzyCompletions(entries, "").map((entry) => entry.id)).toEqual(["barbarian", "bard"]);
		expect(fuzzyCompletions(entries, "brbn").map((entry) => entry.id)).toEqual(["barbarian"]);
	});

	it("forms one explicit direct draft only after action and target are chosen", () => {
		const draft = { ...emptyComposerDraft(), actionId: "srd/inspect", targetRef: "entity:chest" };
		expect(intentFromComposer(draft, context.actions)).toMatchObject({
			kind: "manipulate",
			action_id: "srd/inspect",
			target_ref: "entity:chest",
		});
	});

	it("keeps free speech as an explicit draft detail", () => {
		const draft = {
			...emptyComposerDraft(),
			actionId: "dm/answer",
			targetRef: "entity:aldwin",
			utterance: "Soldier",
		};
		expect(intentFromComposer(draft, context.actions)).toMatchObject({
			kind: "communicate",
			speech_act_id: "dm/answer",
			target_ref: "entity:aldwin",
			utterance: "Soldier",
		});
	});

	it("carries a selected prompt occurrence as semantic context without deriving it", () => {
		const draft = {
			...emptyComposerDraft(),
			actionId: "dm/answer",
			targetRef: "entity:aldwin",
			semanticContext: { source_ref: "entity:aldwin", occurrence_id: "42" },
		};
		expect(intentFromComposer(draft, context.actions)).toMatchObject({
			kind: "communicate",
			semantic_context: { source_ref: "entity:aldwin", occurrence_id: "42" },
		});
	});
});

describe("way-out spelling", () => {
	const exit = (handle: string, label: string, toName: string) => ({
		handle,
		rev: "1",
		label,
		to: null,
		toName,
		gates: [],
	});

	it("spells a way out by its destination, not its direction", () => {
		const texts = exitShellTexts([
			exit("s:exit:1", "north", "Stairs"),
			exit("s:exit:2", "southeast", "Common Room"),
		]);
		expect(texts.get("s:exit:1")).toBe("/go-stairs");
		expect(texts.get("s:exit:2")).toBe("/go-common-room");
	});

	it("adds the direction to every way out that would be spelled alike", () => {
		const texts = exitShellTexts([
			exit("s:exit:1", "north", "Stairs"),
			exit("s:exit:2", "east", "stairs"),
			exit("s:exit:3", "down", "Cellar"),
		]);
		expect(texts.get("s:exit:1")).toBe("/go-stairs-north");
		expect(texts.get("s:exit:2")).toBe("/go-stairs-east");
		expect(texts.get("s:exit:3")).toBe("/go-cellar");
	});

	it("falls back to the direction when the destination has no name", () => {
		const texts = exitShellTexts([exit("s:exit:1", "north", ""), exit("s:exit:2", "north", " ")]);
		// Nothing tells these two apart, and no suffix repeats the same word.
		expect([...texts.values()]).toEqual(["/go-north", "/go-north"]);
	});

	it("suffixes both when an unnamed way out's direction is another's destination", () => {
		const texts = exitShellTexts([
			exit("s:exit:1", "Stairs", ""),
			exit("s:exit:2", "north", "Stairs"),
		]);
		expect(texts.get("s:exit:1")).toBe("/go-stairs-stairs");
		expect(texts.get("s:exit:2")).toBe("/go-stairs-north");
	});

	it("spells a destination the shell cannot spell by its direction", () => {
		const unspellable = String.fromCodePoint(0x6d1e, 0x7a74);
		expect(exitShellTexts([exit("s:exit:1", "north", unspellable)]).get("s:exit:1")).toBe(
			"/go-north",
		);
	});

	it("cuts a long answer at a word boundary and leaves short ones alone", () => {
		const texts = promptAnswerShellTexts([
			{
				actionId: "a",
				label: "(A) Chain Mail, Greatsword, Flail, 8 Javelins, Dungeoneer's Pack, and 4 GP",
			},
			{ actionId: "b", label: "Soldier" },
			{ actionId: "c", label: "Supercalifragilisticexpialidocious" },
		]);
		expect(texts.get("a")).toBe("/a-chain-mail-greatsword");
		expect(texts.get("b")).toBe("/soldier");
		// One word longer than the limit is cut inside the word.
		expect(texts.get("c")).toBe("/supercalifragilisticexpi");
		for (const text of texts.values()) expect(text.length).toBeLessThanOrEqual(25);
	});

	it("keeps cut answers apart with a suffix and never renames an uncut one", () => {
		const texts = promptAnswerShellTexts([
			{ actionId: "a", label: "Chain Mail, Greatsword, Flail and a Pack" },
			{ actionId: "b", label: "Chain Mail, Greatsword, Javelins and 4 GP" },
			{ actionId: "c", label: "Chain mail greatsword" },
			{ actionId: "d", label: "Yes" },
			{ actionId: "e", label: "Yes" },
		]);
		expect(texts.get("a")).toBe("/chain-mail-greatsword-1");
		expect(texts.get("b")).toBe("/chain-mail-greatsword-2");
		expect(texts.get("c")).toBe("/chain-mail-greatsword");
		// Labels the author made alike are not Play's to rename.
		expect(texts.get("d")).toBe("/yes");
		expect(texts.get("e")).toBe("/yes");
	});

	it("suffixes a single cut answer that would equal an uncut one, skipping a taken suffix", () => {
		const texts = promptAnswerShellTexts([
			{ actionId: "a", label: "Chain mail greatsword" },
			{ actionId: "b", label: "Chain mail greatsword 1" },
			{ actionId: "c", label: "Chain Mail, Greatsword, Flail and a Pack" },
		]);
		expect(texts.get("a")).toBe("/chain-mail-greatsword");
		expect(texts.get("b")).toBe("/chain-mail-greatsword-1");
		expect(texts.get("c")).toBe("/chain-mail-greatsword-2");
	});

	it("keeps a slug to plain lower-case words", () => {
		expect(shellSlug("Dungeoneer's Pack")).toBe("dungeoneer-s-pack");
		expect(shellSlug("  ")).toBe("go");
	});

	it("folds accents instead of cutting the word", () => {
		const eAcute = String.fromCodePoint(0xe9);
		const uUmlaut = String.fromCodePoint(0xfc);
		expect(shellSlug(`Caf${eAcute}`)).toBe("cafe");
		expect(shellSlug(`K${uUmlaut}che`)).toBe("kuche");
		expect(shellSlug(`Cafe${String.fromCodePoint(0x301)} Noir`)).toBe("cafe-noir");
	});
});
