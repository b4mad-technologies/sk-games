// Waiting for someone else, as the player sees it.
//
// An NPC answers 5 to 20 seconds after the hero spoke, and a foe takes about
// as long over its turn. The world sends nothing in between. This module
// decides when the app says "… is thinking" and when it stops saying it.
//
// It is a guess shown as a hint, never a lock: nothing is disabled while it
// shows, and it ends by itself.

import type { PlayView } from "../../../play/src/lib/play-view";
import { inFight } from "./menu";
import { openQuestions, spokenLines } from "./talk";

/** The hero spoke and nothing has come back yet. */
export type Waiting = {
	/** Who was addressed, by name; empty when the words went to everyone. */
	who: string;
	/** What had been heard when the hero spoke (`heardMark`). */
	mark: string;
};

/** How long the hint stays when nobody answers. */
export const WAITING_TIMEOUT_MS = 20_000;

/**
 * A fingerprint of everything others have said or asked so far. It changes
 * when someone else speaks or a new question opens, and stays the same when
 * only the hero's own line arrives.
 */
export function heardMark(view: PlayView): string {
	const others = spokenLines(view).filter((line) => !line.mine);
	const last = others[others.length - 1]?.key ?? "";
	const asked = openQuestions(view)
		.map((question) => question.occurrenceId)
		.join(",");
	// Not the number of lines: the view keeps a sliding window of speech, so a
	// new line of the hero's own pushes an old line of someone else out.
	return `${last}|${asked}`;
}

/** Has someone answered since the hero spoke? */
export function answered(waiting: Waiting, view: PlayView): boolean {
	return heardMark(view) !== waiting.mark;
}

/**
 * The one line to show, or undefined when the player waits for nobody.
 * A foe's turn in a fight comes first: the hero cannot act then anyway.
 */
export function thinkingLine(view: PlayView, waiting: Waiting | null): string | undefined {
	if (inFight(view.session) && !view.session.myTurn) {
		return `${view.session.currentActorName ?? "Someone"} is thinking`;
	}
	if (waiting === null) return undefined;
	return waiting.who === "" ? "Waiting for an answer" : `${waiting.who} is thinking`;
}
