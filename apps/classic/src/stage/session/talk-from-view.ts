// PlayView -> Round: the talk panel's one round, from what the world discloses.
//
// A round is an open question of whoever the hero is turned to (a prompt with
// its bound answers), or free speech to them when they ask nothing. Hero
// creation is the same thing with the DM: its questions arrive as prompts and
// carry, as `presentation.guide`, where the guided talk stands (contract:
// ledger/designs/guided-dialogue-tree.md). The outline shown is the DM's; the
// client keeps no answer list of its own and never branches on a step id.

import type { DialogueGuide } from "@spellkave/sdk";
import type {
	PlayAction,
	PlayManipulationPrompt,
	PlayView,
} from "../../../../play/src/lib/play-view";
import { type CreationForm, creationModel } from "../../creation/creation";
import { grantedDefinition } from "../../lib/srd-art";
import { openQuestions, speechAction, type TalkQuestion } from "../../lib/talk";
import type { Answer, OutlineStep, Round } from "../model";
import { answerList, withoutAnswerList } from "../words";

/** The shell's offer on somebody who can be spoken to: it turns the hero to them. */
export const TALK = "stage:talk";

export type TalkMemory = {
	/** Who the hero is turned to; null for nobody. */
	partnerId: string | null;
	/** The last guide the DM sent: between two questions none is open. */
	guide: DialogueGuide | undefined;
	/** The hero answered or spoke, and nobody has replied yet. */
	waiting: boolean;
	art(key: string): string | undefined;
	/** The public reference page of a definition id, once looked up. */
	href(definitionRef: string): string | undefined;
	/** The reference guide's short text of a definition id, once looked up. */
	about(definitionRef: string): string | undefined;
	/** What the hero answered the open step of `guide` with, once sent: the
	 * DM sends its next outline only with its next question. */
	answered?: string;
	/** No question has been open for a good while: do not hold a form back. */
	patient?: boolean;
};

function openPrompts(view: PlayView): PlayManipulationPrompt[] {
	const prompts =
		view.manipulationContext.status === "ready" ? (view.manipulationContext.prompts ?? []) : [];
	return prompts
		.filter((prompt) => !prompt.consumed)
		.sort((a, b) => a.openedAtTick - b.openedAtTick);
}

/** The guide of the open guided question, if one is open. */
export function openGuide(view: PlayView): DialogueGuide | undefined {
	return openPrompts(view).find((prompt) => prompt.presentation?.guide)?.presentation?.guide;
}

/** Every definition id an open question names for one of its answers. */
export function answerRefs(view: PlayView): string[] {
	return openPrompts(view).flatMap((prompt) =>
		Object.values(prompt.presentation?.responseRefs ?? {}).map(grantedDefinition),
	);
}

/** The id prefix of a round read from what somebody said, not from a prompt. */
const SAID = "said:";

/**
 * A question somebody asked in words only. The DM's quest talk names its
 * answers in the sentence ("... 1: Take the companion. 2: Walk alone a while
 * longer.") and sometimes opens no prompt for them (seen live 2026-11-16,
 * the companion offer after a level-up). The world still takes the numbered
 * answer acts toward the speaker, so the newest such sentence of a speaker
 * is a question for as long as the hero has said nothing after it.
 */
function spokenQuestions(view: PlayView): TalkQuestion[] {
	const asked = new Map<string, TalkQuestion>();
	for (const line of view.speech) {
		const speakerId = (line.speakerId ?? "").replace(/^entity:/, "");
		// Whatever the hero says next answers, or passes over, what was asked.
		if (line.mine) asked.clear();
		if (line.mine || speakerId === "") continue;
		// A newer sentence of the same speaker replaces what they asked before.
		asked.delete(speakerId);
		const list = answerList(line.text);
		if (!list) continue;
		const sourceRef = `entity:${speakerId}`;
		const answers = list.answers.map((label, index) => ({
			actionId: String(index + 1),
			label,
			action: view.actions.find(
				(action) => action.slot === index + 1 && action.targetRef === sourceRef,
			),
		}));
		if (answers.some((answer) => !answer.action)) continue;
		asked.set(speakerId, {
			occurrenceId: SAID + line.id,
			asker: nameOf(view, speakerId),
			askerId: speakerId,
			question: list.question,
			answers,
		});
	}
	// Only somebody who is still here can be answered.
	return [...asked.values()].filter((question) => question.asker !== "");
}

/**
 * Every question the hero can answer now: the open prompts, and what
 * somebody asked in words without one.
 */
export function questionsOf(view: PlayView): TalkQuestion[] {
	const prompted = openQuestions(view);
	const askers = new Set(prompted.map((question) => question.askerId));
	return [...prompted, ...spokenQuestions(view).filter((entry) => !askers.has(entry.askerId))];
}

/** Was this round read from a spoken sentence? Its answer comes back wordless. */
export function isSpokenRound(roundId: string): boolean {
	return roundId.startsWith(SAID);
}

function outlineFrom(
	guide: DialogueGuide | undefined,
	memory: Pick<TalkMemory, "art">,
	/** Between two questions: what the open step was answered with. */
	answered?: string,
): OutlineStep[] {
	const steps = guide?.outline ?? [];
	// The outline is as old as the last question. Once that question is
	// answered its step is done, and the step after it is where the talk is.
	const openAt = steps.findIndex((entry) => entry.state === "open");
	const moved = answered !== undefined && openAt >= 0 && steps[openAt]?.answers.length === 0;
	return steps.map((entry, index) => {
		if (moved && index === openAt)
			return {
				id: String(index),
				label: entry.title,
				value: answered,
				short: answered,
				current: false,
			};
		if (moved && index === openAt + 1 && entry.answers.length === 0)
			return { id: String(index), label: entry.title, current: true };
		const value = entry.answers.map((answer) => answer.label).join(", ");
		const first = entry.answers[0]?.label;
		const url = entry.answers
			.map((answer) => (answer.ref ? memory.art(grantedDefinition(answer.ref)) : undefined))
			.find((found) => found !== undefined);
		return {
			// Several entries can share a step id; the position is the key.
			id: String(index),
			label: entry.title,
			...(value ? { value } : {}),
			...(first ? { short: first } : {}),
			...(entry.answers.length > 1 ? { more: entry.answers.length - 1 } : {}),
			...(url ? { art: { url, pixel: true } } : {}),
			current: entry.state === "open",
		};
	});
}

function answersFrom(view: PlayView, question: TalkQuestion, memory: TalkMemory): Answer[] {
	const prompt = openPrompts(view).find((entry) => entry.occurrenceId === question.occurrenceId);
	const refs = prompt?.presentation?.responseRefs ?? {};
	const descriptions = prompt?.presentation?.guide?.descriptions ?? [];
	return question.answers.map((answer, index): Answer => {
		const named = refs[answer.actionId];
		const ref = named ? grantedDefinition(named) : undefined;
		const url = ref ? memory.art(ref) : undefined;
		const href = ref ? memory.href(ref) : undefined;
		// The DM's own words first; where it sends none, the guide's short text.
		const blurb = descriptions[index] || (ref ? memory.about(ref) : undefined);
		return {
			id: answer.actionId,
			label: answer.label,
			...(blurb ? { blurb } : {}),
			...(url ? { art: { url, pixel: true } } : {}),
			...(ref ? { ref } : {}),
			...(href ? { href } : {}),
		};
	});
}

/**
 * The form that takes the hero's name: the one creation form with a single
 * line of text. Typing stays for speech and the name; the other forms
 * of words (appearance, backstory) are not on the stage; the form of
 * numbers is set by clicks (`numberForm`).
 */
export function nameForm(view: PlayView): CreationForm | undefined {
	return creationModel(view).forms.find(
		(form) => form.fields.length === 1 && form.fields[0]?.control === "text",
	);
}

const slug = (words: string) =>
	words
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-");

/**
 * The creation form that takes whole numbers only, when the open step of the
 * outline is the one it belongs to: the last part of the form's action id is
 * the step's title ("Ability scores", ".../ability-scores"). The DM names
 * both; the stage only puts them side by side.
 */
export function numberForm(
	view: PlayView,
	guide: DialogueGuide | undefined,
): CreationForm | undefined {
	const open = guide?.outline.find((entry) => entry.state === "open");
	if (!open) return undefined;
	return creationModel(view).forms.find((form) => {
		const id = form.action.actionId ?? form.action.descriptor ?? "";
		return (
			form.fields.length > 0 &&
			form.fields.every(
				(field) =>
					field.control === "number" &&
					typeof field.min === "number" &&
					typeof field.max === "number",
			) &&
			id.split("/").at(-1) === slug(open.title)
		);
	});
}

function nameOf(view: PlayView, entityId: string | null): string {
	return view.occupants.find((occupant) => occupant.id === entityId)?.name ?? "";
}

function creationRound(view: PlayView, memory: TalkMemory): Round | null {
	const model = creationModel(view);
	const question = openQuestions(view)[0];
	const guide = openGuide(view) ?? memory.guide;
	const guided = {
		outline: outlineFrom(guide, memory, question ? undefined : memory.answered),
		...(question && guide?.remaining ? { picksLeft: guide.remaining } : {}),
		canBack:
			model.back !== undefined && (guide?.outline ?? []).some((entry) => entry.answers.length > 0),
		canForward: model.forward !== undefined && guide?.reopened === true,
		// Nothing answered yet is nothing to throw away.
		canRestart:
			model.discard !== undefined &&
			(guide?.outline ?? []).some((entry) => entry.answers.length > 0),
	};
	if (question) {
		const numbers = numberForm(view, guide);
		return {
			id: question.occurrenceId,
			speakerId: question.askerId ?? "",
			speakerName: question.asker,
			// The cards below are the answers; the sentence need not list them again.
			question: withoutAnswerList(question.question),
			answers: answersFrom(view, question, memory),
			freeSpeech: false,
			...(numbers
				? {
						numbers: {
							title: numbers.title,
							submit: numbers.action.input?.submitLabel ?? numbers.title,
							fields: numbers.fields.map((field) => {
								const min = field.min ?? 0;
								const max = field.max ?? 0;
								// What the hero has now, by the last part of the ability's
								// id ("srd/str" for the field "str"), where it fits.
								const has = view.hero.abilities.find(
									(ability) => ability.id.split("/").at(-1) === field.name,
								)?.score;
								return {
									name: field.name,
									label: field.label,
									min,
									max,
									...(has !== undefined && has >= min && has <= max ? { value: has } : {}),
								};
							}),
						},
					}
				: {}),
			...guided,
		};
	}
	// Between two questions: whoever runs the talk is thinking, or waits for
	// something only the hero can give in words.
	const form = nameForm(view);
	const speakerId = (form?.action.targetRef ?? "").replace(/^entity:/, "");
	const field = form?.fields[0];
	if (!form || !nameOf(view, speakerId)) return null;
	// The name form stands open through the whole talk, and for a moment
	// after every answer no question is open. The field shows when its own
	// step is next in the outline, when the outline names no such step, or
	// when nothing was asked for a good while.
	const steps = guide?.outline ?? [];
	const openAt = steps.findIndex((entry) => entry.state === "open");
	const ownStep = field ? steps.findIndex((entry) => entry.title === field.label) : -1;
	const due =
		ownStep < 0 ||
		ownStep === openAt ||
		(ownStep === openAt + 1 && memory.answered !== undefined) ||
		memory.patient === true;
	return {
		id: `words:${form.action.id}`,
		speakerId,
		speakerName: nameOf(view, speakerId),
		answers: [],
		...(field && due && !memory.waiting
			? {
					input: {
						label: field.label,
						placeholder: field.placeholder ?? "",
						maxLength: field.maxLength ?? 60,
					},
				}
			: {}),
		freeSpeech: false,
		...guided,
		// No question is open, so there is nothing to step back from right now.
		canBack: false,
		canForward: false,
	};
}

/** The round the talk panel shows, or null when the hero talks to nobody. */
export function roundFrom(view: PlayView, memory: TalkMemory): Round | null {
	if (view.hero.drafting === true) return creationRound(view, memory);
	const partnerId = memory.partnerId;
	const speakerName = nameOf(view, partnerId);
	if (partnerId === null || speakerName === "") return null;
	const freeSpeech = speechAction(view, partnerId) !== undefined;
	const question = questionsOf(view).find((entry) => entry.askerId === partnerId);
	if (!question) {
		return { id: `free:${partnerId}`, speakerId: partnerId, speakerName, answers: [], freeSpeech };
	}
	return {
		id: question.occurrenceId,
		speakerId: partnerId,
		speakerName,
		question: question.question,
		answers: answersFrom(view, question, memory),
		freeSpeech,
	};
}

/** The bound action behind one answer of an open round. */
export function answerFor(
	view: PlayView,
	roundId: string,
	answerId: string,
): { action?: PlayAction; label: string; askerId: string | null; asker: string } | undefined {
	const question = questionsOf(view).find((entry) => entry.occurrenceId === roundId);
	const answer = question?.answers.find((entry) => entry.actionId === answerId);
	if (!question || !answer) return undefined;
	return {
		...(answer.action ? { action: answer.action } : {}),
		label: answer.label,
		askerId: question.askerId,
		asker: question.asker,
	};
}
