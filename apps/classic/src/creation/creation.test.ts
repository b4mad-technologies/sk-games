import { describe, expect, it } from "vitest";
import type { PlayAction, PlayView } from "../../../play/src/lib/play-view";
import {
	creationModel,
	journalAfterAnswer,
	journalIsStale,
	loadBack,
	loadJournal,
	saveBack,
	saveJournal,
} from "./creation";

// Shapes copied from a live local world (2026-11-14): one open class prompt
// from the DM (entity 6), the hero is entity 168, and every action is paired
// with every target the hero sees.
function action(actionId: string, targetRef: string, extra: Partial<PlayAction> = {}): PlayAction {
	return {
		id: `factored:${actionId}:${targetRef}`,
		actionId,
		descriptor: actionId,
		label: `${actionId} — ${targetRef}`,
		name: actionId,
		verb: "communicate",
		targetName: targetRef,
		targetRef,
		acceptsUtterance: false,
		...extra,
	};
}

const nameInput = {
	fields: [
		{ name: "name", label: "Name", control: "text" as const, channel: "utterance" as const },
	],
};

function view(overrides: Partial<PlayView> = {}): PlayView {
	return {
		hero: { drafting: true, name: "Creation Candidate" },
		speech: [],
		actions: [
			action("dm/dialog/choice/1", "entity:168"),
			action("dm/dialog/choice/1", "entity:6"),
			action("dm/dialog/choice/2", "entity:6"),
			action("dm/creation/input/name", "entity:168", { input: nameInput }),
			action("dm/creation/input/name", "entity:6", { input: nameInput }),
			action("dm/creation/discard", "entity:6", { input: { fields: [] } }),
			action("srd/check/arcana", "entity:6"),
		],
		manipulationContext: {
			status: "ready",
			schemaVersion: 1,
			revision: 1,
			actions: [],
			targets: [],
			participants: [],
			prompts: [
				{
					occurrenceId: "2",
					promptDefId: "dm/prompt/creation-menu/4",
					contractVersion: 1,
					sourceRef: "entity:6",
					responseActionIds: ["dm/dialog/choice/1", "dm/dialog/choice/2", "dm/dialog/choice/3"],
					openedAtTick: 19,
					consumed: false,
					presentation: {
						question: "Which class? 1 Fighter, 2 Rogue, 3 Cleric.",
						labels: {
							"dm/dialog/choice/1": "Fighter",
							"dm/dialog/choice/2": "Rogue",
							"dm/dialog/choice/3": "Cleric",
						},
						responseRefs: {
							"dm/dialog/choice/1": "srd/class/fighter",
							"dm/dialog/choice/2": "srd/class/rogue",
						},
					},
				},
			],
		},
		...overrides,
	} as unknown as PlayView;
}

describe("creationModel", () => {
	it("turns an open prompt into a step with labelled, referenced choices", () => {
		const [step] = creationModel(view()).steps;
		expect(step?.question).toBe("Which class? 1 Fighter, 2 Rogue, 3 Cleric.");
		expect(step?.choices.map((choice) => [choice.label, choice.definitionRef])).toEqual([
			["Fighter", "srd/class/fighter"],
			["Rogue", "srd/class/rogue"],
			["Cleric", undefined],
		]);
	});

	it("binds each answer to the prompt's source and occurrence", () => {
		const [step] = creationModel(view()).steps;
		const fighter = step?.choices[0]?.action;
		expect(fighter?.targetRef).toBe("entity:6");
		expect(fighter?.semanticContext).toEqual({ source_ref: "entity:6", occurrence_id: "2" });
	});

	it("leaves a choice unbound when the world offers no matching action", () => {
		const [step] = creationModel(view()).steps;
		expect(step?.choices[2]?.action).toBeUndefined();
	});

	it("skips consumed prompts", () => {
		const base = view();
		if (base.manipulationContext.status !== "ready") throw new Error("fixture");
		const consumed = {
			...base.manipulationContext,
			prompts: base.manipulationContext.prompts?.map((prompt) => ({ ...prompt, consumed: true })),
		};
		expect(creationModel(view({ manipulationContext: consumed })).steps).toEqual([]);
	});

	it("offers each creation form once, paired with the one who asks", () => {
		const model = creationModel(view());
		expect(model.forms).toHaveLength(1);
		expect(model.forms[0]?.action.targetRef).toBe("entity:6");
		expect(model.forms[0]?.fields.map((field) => field.name)).toEqual(["name"]);
	});

	it("between two questions, pairs a form with whoever spoke last", () => {
		const base = view();
		if (base.manipulationContext.status !== "ready") throw new Error("fixture");
		const quiet = { ...base.manipulationContext, prompts: [] };
		const speech = [
			{ id: "1", tick: 1, speakerId: "20", speaker: "Someone else", text: "Hm.", mine: false },
			{
				id: "2",
				tick: 2,
				speakerId: "6",
				speaker: "Keeper",
				text: "What shall I call you?",
				mine: false,
			},
			{ id: "3", tick: 3, speakerId: "168", speaker: "You", text: "Let me think.", mine: true },
		];
		const model = creationModel(view({ manipulationContext: quiet, speech }));
		expect(model.forms[0]?.action.targetRef).toBe("entity:6");
	});

	it("lists input-less creation actions as commands and ignores other actions", () => {
		const model = creationModel(view());
		expect(model.commands.map((command) => command.actionId)).toEqual(["dm/creation/discard"]);
	});

	it("reports whether the hero is still being drafted", () => {
		expect(creationModel(view()).drafting).toBe(true);
		expect(creationModel(view({ hero: { name: "Mira" } as PlayView["hero"] })).drafting).toBe(
			false,
		);
	});
});

describe("creation journal", () => {
	function store(initial: Record<string, string> = {}) {
		const data = new Map(Object.entries(initial));
		return {
			data,
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => void data.set(key, value),
			removeItem: (key: string) => void data.delete(key),
		};
	}
	const entry = {
		id: 1,
		step: "Which class?",
		answer: "Fighter",
		definitionRef: "srd/class/fighter",
	};

	it("survives a reload, per drafted hero", () => {
		const kept = store();
		saveJournal(kept, "168", [entry]);
		expect(loadJournal(kept, "168")).toEqual([entry]);
		expect(loadJournal(kept, "200")).toEqual([]);
	});

	it("is removed when the list is emptied", () => {
		const kept = store();
		saveJournal(kept, "168", [entry]);
		saveJournal(kept, "168", []);
		expect(kept.data.size).toBe(0);
	});

	it("starts empty on missing, broken or foreign data", () => {
		expect(loadJournal(undefined, "168")).toEqual([]);
		expect(loadJournal(store({ "classic:creation-journal:168": "{oops" }), "168")).toEqual([]);
		expect(
			loadJournal(
				store({ "classic:creation-journal:168": '[{"id":"x"},' + JSON.stringify(entry) + "]" }),
				"168",
			),
		).toEqual([entry]);
	});

	it("keeps working when storage throws", () => {
		const broken = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};
		expect(loadJournal(broken, "168")).toEqual([]);
		expect(() => saveJournal(broken, "168", [entry])).not.toThrow();
	});
});

describe("back and forward", () => {
	it("gives the two walking commands their own slots, outside the commands", () => {
		const model = creationModel(
			view({
				actions: [
					action("dm/creation/discard", "entity:6", { input: { fields: [] } }),
					action("dm/creation/back", "entity:6", { input: { fields: [] } }),
					action("dm/creation/forward", "entity:6", { input: { fields: [] } }),
				],
			}),
		);
		expect(model.commands.map((command) => command.actionId)).toEqual(["dm/creation/discard"]);
		expect(model.back?.actionId).toBe("dm/creation/back");
		expect(model.forward?.actionId).toBe("dm/creation/forward");
	});

	const list = [
		{ id: 1, step: "Which class?", answer: "Fighter", definitionRef: "srd/class/fighter" },
		{
			id: 2,
			step: "Which background?",
			answer: "Acolyte",
			definitionRef: "srd/background/acolyte",
		},
		{ id: 3, step: "Which skill?", answer: "Athletics", definitionRef: "srd/skill/athletics" },
		{ id: 4, step: "Which skill?", answer: "History", definitionRef: "srd/skill/history" },
	];

	it("adds an answer to the open question at the end", () => {
		const next = { id: 5, step: "Which kit?", answer: "Kit A" };
		expect(journalAfterAnswer(list, next, false)).toEqual([...list, next]);
	});

	it("puts an answer to a reopened question in that question's place", () => {
		const next = {
			id: 5,
			step: "Which background?",
			answer: "Sage",
			definitionRef: "srd/background/sage",
		};
		expect(journalAfterAnswer(list, next, true).map((entry) => entry.answer)).toEqual([
			"Fighter",
			"Sage",
			"Athletics",
			"History",
		]);
	});

	it("replaces every pick of a reopened question that takes several", () => {
		const next = {
			id: 5,
			step: "Which skill?",
			answer: "Insight",
			definitionRef: "srd/skill/insight",
		};
		expect(journalAfterAnswer(list, next, true).map((entry) => entry.answer)).toEqual([
			"Fighter",
			"Acolyte",
			"Insight",
		]);
	});

	it("keeps the list on the same class and drops class picks on another", () => {
		const same = {
			id: 5,
			step: "Which class?",
			answer: "Fighter",
			definitionRef: "srd/class/fighter",
		};
		expect(journalAfterAnswer(list, same, true).map((entry) => entry.answer)).toEqual([
			"Fighter",
			"Acolyte",
			"Athletics",
			"History",
		]);
		const other = {
			id: 5,
			step: "Which class?",
			answer: "Rogue",
			definitionRef: "srd/class/rogue",
		};
		expect(journalAfterAnswer(list, other, true).map((entry) => entry.answer)).toEqual([
			"Rogue",
			"Acolyte",
		]);
	});

	it("remembers how far back the player looks, per drafted hero", () => {
		const data = new Map<string, string>();
		const store = {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => void data.set(key, value),
			removeItem: (key: string) => void data.delete(key),
		};
		saveBack(store, "entity:9", 2);
		expect(loadBack(store, "entity:9")).toBe(2);
		expect(loadBack(store, "entity:10")).toBe(0);
		saveBack(store, "entity:9", 0);
		expect(loadBack(store, "entity:9")).toBe(0);
	});
});

describe("a list from a wiped world", () => {
	const answered = (occurrence?: string) => [
		{ id: 1, step: "Which class?", answer: "Fighter", occurrence },
	];
	it("is stale when an answer is not older than the open question", () => {
		expect(journalIsStale(answered("7"), "2")).toBe(true);
		expect(journalIsStale(answered("2"), "2")).toBe(true);
	});
	it("is kept when every answer is older, or its occurrence is unknown", () => {
		expect(journalIsStale(answered("2"), "5")).toBe(false);
		expect(journalIsStale(answered(), "1")).toBe(false);
		expect(journalIsStale(answered("x"), "1")).toBe(false);
		expect(journalIsStale([], "1")).toBe(false);
	});
});
