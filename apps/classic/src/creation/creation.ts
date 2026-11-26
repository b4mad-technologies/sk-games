// Hero creation as the wizard sees it.
//
// Creation is a dialogue with the DM NPC. This module turns what the PLAYER
// tools disclose about that dialogue into wizard material, and nothing more:
//
// - an open prompt (question, labelled answers, SRD definition refs) becomes a
//   step with option cards;
// - an offered action with an authored input form (name, ability scores,
//   appearance, backstory) becomes a form.
//
// The DM stays the only authority on what the steps are and in which order
// (owner decision 2026-11-14, "way B"). The wizard never reads the DM's own
// document and never guesses a step from the wording of a question.

import type { PlayAction, PlayManipulationPrompt, PlayView } from "../../../play/src/lib/play-view";

export type CreationChoice = {
	actionId: string;
	label: string;
	/** `srd/class/fighter` and the like, when the DM names a definition. */
	definitionRef?: string;
	/** The bound answer, ready to hand to the session; absent when the world
	 * discloses the prompt but no matching action toward its source. */
	action?: PlayAction;
};

export type CreationStep = {
	occurrenceId: string;
	promptDefId: string;
	sourceRef: string;
	question: string;
	choices: CreationChoice[];
};

export type CreationForm = {
	action: PlayAction;
	title: string;
	fields: NonNullable<PlayAction["input"]>["fields"];
};

export type CreationModel = {
	/** True while the world marks the hero as still being drafted. */
	drafting: boolean;
	steps: CreationStep[];
	forms: CreationForm[];
	/** Input-less creation actions toward the DM, such as discarding the draft. */
	commands: PlayAction[];
	/** Show the question before the open one again. Nothing is cleared. */
	back?: PlayAction;
	/** Leave a reopened question as it was answered. */
	forward?: PlayAction;
	/** Empty the whole draft and begin again. Also listed among `commands`. */
	discard?: PlayAction;
};

/** Creation actions carry this authored id prefix. It is the DM engine's own
 * namespace, not an adventure's. */
const CREATION_ACTION_PREFIX = "dm/creation/";
/** The two commands that walk the answered questions. They get their own
 * buttons instead of a place among the commands. */
const BACK_ACTION_ID = `${CREATION_ACTION_PREFIX}back`;
const FORWARD_ACTION_ID = `${CREATION_ACTION_PREFIX}forward`;
const DISCARD_ACTION_ID = `${CREATION_ACTION_PREFIX}discard`;

function actionIdOf(action: PlayAction): string {
	return action.actionId ?? action.descriptor;
}

function stepFromPrompt(view: PlayView, prompt: PlayManipulationPrompt): CreationStep {
	const choices = prompt.responseActionIds.map((actionId): CreationChoice => {
		const offered = view.actions.find(
			(action) => actionIdOf(action) === actionId && action.targetRef === prompt.sourceRef,
		);
		return {
			actionId,
			label: prompt.presentation?.labels[actionId] ?? offered?.name ?? actionId,
			definitionRef: prompt.presentation?.responseRefs?.[actionId],
			// The answer is bound to this prompt occurrence, so a late click can
			// never answer a question the DM has since replaced.
			action: offered && {
				...offered,
				semanticContext: { source_ref: prompt.sourceRef, occurrence_id: prompt.occurrenceId },
			},
		};
	});
	return {
		occurrenceId: prompt.occurrenceId,
		promptDefId: prompt.promptDefId,
		sourceRef: prompt.sourceRef,
		question: prompt.presentation?.question ?? "",
		choices,
	};
}

export function creationModel(view: PlayView): CreationModel {
	const prompts =
		view.manipulationContext.status === "ready" ? (view.manipulationContext.prompts ?? []) : [];
	const steps = prompts
		.filter((prompt) => !prompt.consumed)
		.sort((a, b) => a.openedAtTick - b.openedAtTick)
		.map((prompt) => stepFromPrompt(view, prompt));

	// One creation action is paired with every target the hero sees. The right
	// pairing is the one toward whoever runs the dialogue: the source of an open
	// prompt, or, between two questions, whoever spoke to the hero last.
	const askers = new Set(steps.map((step) => step.sourceRef));
	if (askers.size === 0) {
		const lastSpeaker = [...view.speech]
			.reverse()
			.find((line) => !line.mine && line.speakerId !== null);
		if (lastSpeaker) askers.add(`entity:${lastSpeaker.speakerId}`);
	}
	const perAction = new Map<string, PlayAction>();
	for (const action of view.actions) {
		const id = actionIdOf(action);
		if (!id.startsWith(CREATION_ACTION_PREFIX)) continue;
		const known = perAction.get(id);
		if (!known || (askers.has(action.targetRef) && !askers.has(known.targetRef)))
			perAction.set(id, action);
	}
	const forms: CreationForm[] = [];
	const commands: PlayAction[] = [];
	for (const [id, action] of perAction) {
		if (id === BACK_ACTION_ID || id === FORWARD_ACTION_ID) continue;
		const fields = action.input?.fields ?? [];
		if (fields.length > 0) forms.push({ action, title: action.name ?? action.label, fields });
		else commands.push(action);
	}
	return {
		drafting: view.hero.drafting === true,
		steps,
		forms,
		commands,
		back: perAction.get(BACK_ACTION_ID),
		forward: perAction.get(FORWARD_ACTION_ID),
		discard: perAction.get(DISCARD_ACTION_ID),
	};
}

const IDENTITY_REF = /^srd\/(class|background|species)\//;

/**
 * The list after one more answer.
 *
 * On the open question the answer is added at the end. On a reopened question
 * it takes the place of what that question held. A new class also drops every
 * later answer that is not a background or a species, as the keeper does.
 *
 * The list is the wizard's own memory, not the keeper's draft. A reopened
 * question that the keeper asks in several parts (the starting kit's items)
 * can leave an old part in the list until bead sk-jay0.1.76.13.1 lets the
 * world send the draft.
 */
export function journalAfterAnswer(
	journal: readonly JournalEntry[],
	entry: JournalEntry,
	reopened: boolean,
): JournalEntry[] {
	const at = journal.findIndex((known) => known.step === entry.step);
	if (!reopened || at < 0) return [...journal, entry];
	const old = journal[at];
	const newClass =
		old?.definitionRef?.startsWith("srd/class/") === true &&
		old.definitionRef !== entry.definitionRef;
	const kept = journal.filter(
		(known) =>
			known.step !== entry.step && (!newClass || IDENTITY_REF.test(known.definitionRef ?? "")),
	);
	const before = journal.slice(0, at).filter((known) => kept.includes(known)).length;
	return [...kept.slice(0, before), entry, ...kept.slice(before)];
}

/** One answered step, as the wizard remembers it. */
export type JournalEntry = {
	id: number;
	step: string;
	answer: string;
	definitionRef?: string;
	/** The prompt occurrence this answer was given to. */
	occurrence?: string;
};

/**
 * True when the list cannot belong to this world. A world numbers its prompt
 * occurrences upwards, so an answer given to an occurrence that is not older
 * than the open one comes from a world that was since wiped: the fresh world
 * reuses the hero's id and so the storage key.
 */
export function journalIsStale(journal: readonly JournalEntry[], openOccurrence: string): boolean {
	const open = Number(openOccurrence);
	if (!Number.isFinite(open)) return false;
	return journal.some((entry) => {
		const answered = Number(entry.occurrence ?? Number.NaN);
		return Number.isFinite(answered) && answered >= open;
	});
}

type JournalStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const journalKey = (heroId: string) => `classic:creation-journal:${heroId}`;
const backKey = (heroId: string) => `classic:creation-back:${heroId}`;

/** How many questions back the player looks, kept with the list. */
export function loadBack(store: JournalStore | undefined, heroId: string): number {
	try {
		const parsed = Number(store?.getItem(backKey(heroId)) ?? 0);
		return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
	} catch {
		return 0;
	}
}

export function saveBack(store: JournalStore | undefined, heroId: string, back: number): void {
	try {
		if (back <= 0) store?.removeItem(backKey(heroId));
		else store?.setItem(backKey(heroId), String(back));
	} catch {
		// Blocked or full storage: the count stays in memory only.
	}
}

/**
 * The world does not disclose the draft while it is being made (bead
 * sk-jay0.1.76.13.1), so the wizard keeps its own list of answers. It lives
 * in the tab's session storage, keyed by the drafted hero, so a reload keeps
 * it. Another browser or device starts with an empty list. Storage can be
 * blocked; then the list lasts only until the next reload.
 */
export function loadJournal(store: JournalStore | undefined, heroId: string): JournalEntry[] {
	try {
		const parsed: unknown = JSON.parse(store?.getItem(journalKey(heroId)) ?? "[]");
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry): entry is JournalEntry =>
				typeof entry === "object" &&
				entry !== null &&
				typeof entry.id === "number" &&
				typeof entry.step === "string" &&
				typeof entry.answer === "string" &&
				(entry.definitionRef === undefined || typeof entry.definitionRef === "string") &&
				(entry.occurrence === undefined || typeof entry.occurrence === "string"),
		);
	} catch {
		return [];
	}
}

/** Saves the list; an empty list removes it. */
export function saveJournal(
	store: JournalStore | undefined,
	heroId: string,
	journal: readonly JournalEntry[],
): void {
	try {
		if (journal.length === 0) store?.removeItem(journalKey(heroId));
		else store?.setItem(journalKey(heroId), JSON.stringify(journal));
	} catch {
		// Blocked or full storage: the list stays in memory only.
	}
}
