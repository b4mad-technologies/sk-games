// Talking, as the talk panel sees it.
//
// Three things the PLAYER tools already disclose are put side by side:
//
// - what was said (`view.speech`);
// - open questions: a prompt with its labelled answers, each bound to that
//   prompt occurrence, so an answer slot nobody asked for is never offered;
// - one way to say free words, to one person or to everyone here.
//
// Nothing here decides whether speaking will work. The world answers.

import type {
	PlayAction,
	PlayManipulationPrompt,
	PlayOccupant,
	PlayView,
} from "../../../play/src/lib/play-view";
import { nicheFit } from "./menu";

export type TalkAnswer = {
	actionId: string;
	label: string;
	/** Bound to the question's occurrence; absent when the world discloses the
	 * question but no matching action toward whoever asked. */
	action?: PlayAction;
};

export type TalkQuestion = {
	occurrenceId: string;
	/** Who asks, by name, when that someone is in view. */
	asker: string;
	askerId: string | null;
	question: string;
	answers: TalkAnswer[];
};

export type TalkPartner = { id: string; name: string };

function actionIdOf(action: PlayAction): string {
	return action.actionId ?? action.descriptor;
}

function entityIdOf(ref: string): string | null {
	return ref.startsWith("entity:") ? ref.slice("entity:".length) : null;
}

function questionFromPrompt(view: PlayView, prompt: PlayManipulationPrompt): TalkQuestion {
	const askerId = entityIdOf(prompt.sourceRef);
	const asker = view.occupants.find((occupant) => occupant.id === askerId)?.name ?? "";
	return {
		occurrenceId: prompt.occurrenceId,
		asker,
		askerId,
		question: prompt.presentation?.question ?? "",
		answers: prompt.responseActionIds.map((actionId): TalkAnswer => {
			const offered = view.actions.find(
				(action) => actionIdOf(action) === actionId && action.targetRef === prompt.sourceRef,
			);
			return {
				actionId,
				label: prompt.presentation?.labels[actionId] ?? offered?.name ?? actionId,
				action: offered && {
					...offered,
					semanticContext: { source_ref: prompt.sourceRef, occurrence_id: prompt.occurrenceId },
				},
			};
		}),
	};
}

/** Open questions, oldest first. */
export function openQuestions(view: PlayView): TalkQuestion[] {
	const prompts =
		view.manipulationContext.status === "ready" ? (view.manipulationContext.prompts ?? []) : [];
	return prompts
		.filter((prompt) => !prompt.consumed)
		.sort((a, b) => a.openedAtTick - b.openedAtTick)
		.map((prompt) => questionFromPrompt(view, prompt));
}

/** Who the hero can address: the persons and creatures in view. */
export function talkPartners(occupants: readonly PlayOccupant[]): TalkPartner[] {
	return occupants
		.filter((occupant) => occupant.kind === "person" || occupant.kind === "creature")
		.map((occupant) => ({ id: occupant.id, name: occupant.name }));
}

// The SRD ruleset's speech acts for free words. The app may couple to the
// ruleset (never to an adventure). The world discloses no fact that tells a
// free-words act from a fixed line such as "ask about advancement": both are
// communication acts, and `acceptsUtterance` is false for all of them.
const SPEAK_TO_ONE = "srd/speak-to";
const SPEAK_TO_ALL = ["srd/speak-to-room", "srd/speak-aloud"];
const FREE_SPEECH = new Set([SPEAK_TO_ONE, ...SPEAK_TO_ALL]);

function isFreeSpeech(action: PlayAction): boolean {
	return action.verb === "communicate" && FREE_SPEECH.has(actionIdOf(action));
}

/**
 * The action that carries free words: to one partner, or to everyone here
 * when `partnerId` is null. Undefined when the world offers no way to speak.
 */
export function speechAction(view: PlayView, partnerId: string | null): PlayAction | undefined {
	const speech = view.actions.filter(isFreeSpeech);
	if (partnerId !== null) {
		return speech.find(
			(action) => action.targetRef === `entity:${partnerId}` && actionIdOf(action) === SPEAK_TO_ONE,
		);
	}
	// Words for everyone are still paired with a target, and that target has to
	// suit the speech act. Seen live 2026-11-14: the hero as the target of their
	// own words is refused ("You cannot do that to yourself"), and so is the
	// place for a speech act that asks for someone who can be spoken with. So:
	// never the hero, never a target whose niche the act does not fit, and
	// among the rest the place before a person. Who hears does not depend on
	// which of them carries the words.
	const self = `entity:${view.hero.actorId}`;
	const fits = nicheFit(view.manipulationContext);
	for (const id of SPEAK_TO_ALL) {
		const offered = speech.filter(
			(action) => actionIdOf(action) === id && action.targetRef !== self && fits(action) !== false,
		);
		const pick =
			offered.find((action) => action.targetRef.startsWith("place_node:")) ??
			offered.find((action) => action.targetRef.startsWith("entity:")) ??
			offered[0];
		if (pick) return pick;
	}
	return undefined;
}

/**
 * Free speech has its own field in the talk panel, so a click menu does not
 * list it again once per target. Every other action stays.
 */
export function withoutFreeSpeech(actions: readonly PlayAction[]): PlayAction[] {
	return actions.filter((action) => !isFreeSpeech(action));
}

/** Can this target be spoken to directly? */
export function canAddress(view: PlayView, occupantId: string): boolean {
	return speechAction(view, occupantId) !== undefined;
}

export type SpokenLine = {
	key: string;
	tick: number;
	who: string;
	text: string;
	mine: boolean;
};

/**
 * What was said, one line per utterance.
 *
 * The world can report one utterance more than once (seen live 2026-11-14,
 * bead sk-jay0.1.76.14.6): speaking to the room yields one row per listener,
 * and speaking aloud yields a second row beside the regular one. The extra
 * rows carry the speaker as a target ref (`entity:168`) instead of a bare id
 * and have no speaker name. Rows of that form are folded into the regular
 * row with the same tick and words; where no regular row exists, one of them
 * stays, the hero's own if there is one. Two people who say the same words
 * in the same tick both arrive as regular rows and both stay.
 */
export function spokenLines(
	view: PlayView,
	/** Names of people met before, by entity id: a far speaker arrives as a bare id. */
	met: Readonly<Record<string, string>> = {},
): SpokenLine[] {
	const hero = view.hero.actorId;
	const nameOf = (id: string, fallback: string) =>
		id === hero
			? view.hero.name
			: (view.occupants.find((occupant) => occupant.id === id)?.name ?? met[id] ?? fallback);
	const groups = new Map<string, PlayView["speech"]>();
	for (const line of view.speech) {
		const key = `${line.tick}\n${line.text}`;
		groups.set(key, [...(groups.get(key) ?? []), line]);
	}
	const out: SpokenLine[] = [];
	for (const rows of groups.values()) {
		const regular = rows.filter((row) => entityIdOf(row.speakerId ?? "") === null);
		const kept =
			regular.length > 0
				? regular
				: [rows.find((row) => entityIdOf(row.speakerId ?? "") === hero) ?? rows[0]];
		for (const row of kept) {
			if (row === undefined) continue;
			const id = entityIdOf(row.speakerId ?? "") ?? row.speakerId ?? "";
			// Somebody out of sight has no name in the row: the world repeats
			// the id ("6"). A name known from before stands in; else "Someone".
			const nameless = row.speaker === id || row.speaker === row.speakerId;
			const speaker =
				entityIdOf(row.speakerId ?? "") !== null
					? nameOf(id, row.speaker)
					: nameless
						? nameOf(id, "Someone")
						: row.speaker;
			// The addressee of a folded row is whoever carried the words, not
			// whom they were meant for; only a regular row's addressee is shown.
			const to = regular.length > 0 && row.addresseeName ? ` to ${row.addresseeName}` : "";
			out.push({
				key: row.id,
				tick: row.tick,
				who: `${speaker}${to}`,
				text: row.text,
				mine: row.mine || id === hero,
			});
		}
	}
	return out.sort((a, b) => a.tick - b.tick);
}
