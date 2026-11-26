/**
 * Play's own player-facing sentences, in one typed table.
 *
 * Scope: the composer, the finder, Play's local status lines and the few
 * sentences Play writes into the Table stream itself. World-side
 * refusal prose stays in `packages/spellkave-tool-player/src/refusal-prose.ts`;
 * this table never repeats it. Every value is plain words for a human player:
 * no tool names, handles, internal ids, or composer jargon. `player-copy.test.ts`
 * enforces that for every leaf, including the sentence builders.
 */
import type { ShellFinderSource } from "./shell-finder";

/** Finder group label per candidate source. Typed as a full record so a new
 * source fails typecheck until it has a player-facing name. */
const sources: Record<ShellFinderSource, string> = {
	prompts: "Answer",
	actions: "Do",
	targets: "Here",
	sensing: "Notice",
	movement: "Go",
	turn: "Turn",
	participants: "With",
	pack: "Pack",
	history: "Recent",
	fields: "Fill in",
};

/** Longest echo of the player's own loose words inside a blocker sentence. */
const ECHO_LIMIT = 40;
function echoWords(words: string): string {
	const trimmed = words.trim();
	return trimmed.length <= ECHO_LIMIT ? trimmed : `${trimmed.slice(0, ECHO_LIMIT).trimEnd()}…`;
}

export const playCopy = {
	composer: {
		/** Accessible name of the shell input and its region. */
		label: "Compose an intention",
		/** Shown in the empty input when no suggestion is ghosted. One short line. */
		placeholder: "What do you do?",
		/** Screen-reader description of the input grammar. */
		grammarHelp:
			"Type / for something to do, @ for someone here, # for a place or thing, or put what you say in quotes. The order does not matter.",
		/** Help line when nothing else has to be said. */
		idleHint:
			"Type / to do something, @ for someone here, or # for a place or thing. Tab picks, Enter sends.",
		/** Help line while an attempt waits for the world's answer. */
		submitting: "Sent. Waiting for the world to answer.",
		/** Help line once nothing stops the sentence. It never promises that the
		 * world will accept it. */
		sendHint: "Press Enter to send.",
		/** Help line while an empty quoted detail waits for its value. */
		fieldHint: (label: string) =>
			`Write the ${label} between the quotes, then press Enter to send.`,
		/** Grey text between the empty quotes of something to say. */
		wordsPlaceholder: "what you say",
		wordsHint: "Write what you say between the quotes, then press Enter to send.",
		/** Help line while a way out is in the box. It names where the way out
		 * leads and which key sets off. */
		goHint: (destination: string) => `Go to ${destination}. Press Enter to set off.`,
		/** Help line while the hero is down. It stands where a "press Enter" hint
		 * would, and in the empty box when no question is open. An answer from
		 * the world, a blocker, a "fill in" hint, a default-draft line and an
		 * open question keep their place. */
		downed: "You are down and cannot act right now.",
		/** A click wanted to fill the box, but the player's own words are in it. */
		draftKept: (choice: string) =>
			`You have unsent words in the box. Send or clear them, then choose ${choice} again.`,
		/** Key legend on the right of the help line. It describes keys and never
		 * changes them; the key names come from the player's key settings. */
		keys: {
			/** List closed, something still to pick. */
			unpicked: (tab: string, right: string, browse: string) =>
				`${tab} pick · ${right} take grey text · ${browse} browse`,
			/** List open. */
			open: (move: string, accept: string) =>
				`${move} move · ${accept} or Tab put it in · Esc close`,
			/** Nothing stops the sentence. */
			ready: (send: string) => `${send} send · Tab more choices`,
			/** The caret is inside quotes or a detail value: the player writes
			 * there, so no picking key is named. Shown only while nothing stops
			 * the sentence; a blocked sentence shows no legend there at all. */
			value: (send: string) => `${send} send`,
			/** Something written is missing or misplaced; nothing is left to pick.
			 * `right` is given only while grey text is on offer. */
			write: (browse: string, right?: string) =>
				right === undefined ? `${browse} browse` : `${right} take grey text · ${browse} browse`,
		},
	},
	finder: {
		regionLabel: "Suggestions",
		resultsLabel: "Suggested choices",
		changed: "Things have changed here.",
		refresh: "Show current choices",
		/** Leads the key line under the open list. */
		pickingDoesNotSend: "Picking does not send.",
		typeToNarrow: "Type to narrow the list",
		/** Group header fallback when a question has no authored text. */
		questionFallback: "Choose an answer.",
		/** Preview heading with no highlighted row. */
		emptyTitle: "Nothing selected",
		/** Preview body with no highlighted row. */
		emptyPreview: "Pick a suggestion to add it to what you are writing.",
		previousSelection: "The previous choice",
		refreshedKept: (label: string) => `Suggestions updated. ${label} is still selected.`,
		refreshedGone: (previous: string) => `Suggestions updated. ${previous} is no longer available.`,
		refreshedReplaced: (previous: string, next: string) =>
			`Suggestions updated. ${previous} is no longer available. ${next} selected.`,
	},
	sources,
	candidates: {
		replyTo: (name: string) => `Reply to ${name}.`,
		/** A way out is named by where it leads; its direction follows in
		 * brackets when it says something the destination does not. */
		goTo: (destination: string, direction?: string) => {
			const where = destination.trim();
			const way = direction?.trim() ?? "";
			return way === "" || way.toLocaleLowerCase() === where.toLocaleLowerCase()
				? `Go — ${where}`
				: `Go — ${where} (${way})`;
		},
		wayOut: (label: string) => `Way out: ${label}.`,
		endTurn: "End turn",
		endTurnDetail: "End your turn and let the next one act.",
		/** Detail words of a "Fill in" row. */
		fieldNeeded: "needed",
		fieldOptional: "optional",
		numberRange: (min: number, max: number) => `from ${min} to ${max}`,
	},
	targets: {
		/** Neutral names for a target whose name the world did not give us.
		 * A raw reference is never shown instead. */
		unnamedPerson: "Someone here",
		unnamedThing: "Something here",
	},
	prompt: {
		from: (speaker: string, question: string) => `From ${speaker}: ${question}`,
		answerFallback: "Choose an answer.",
	},
	defaults: {
		/** `parts` are already in the shell's own spelling, e.g. `@"Locked chest"`. */
		summary: (parts: readonly string[]) => `Suggested: ${parts.join(" · ")}`,
		suppressed: "Suggestion replaced by your choice",
		notCurrent: "That suggestion no longer applies",
		changed: "That suggestion changed; choose what to do again",
	},
	attemptBlock: {
		promptChanged: "That question has changed. Choose one of the current answers.",
		otherSpeaker: "That answer is for someone else. Choose an answer for the person you named.",
		routeGone: "That is no longer possible here. Choose again from the suggestions.",
		suggestionChanged: "That suggestion has changed. Choose what to do again.",
		/** A way out, a look or the end of the turn stands with another name the
		 * player picked beside it (a name or map click adds none there). Both
		 * arguments are the box's own spellings, e.g. `/go-stairs` and
		 * `#"Cellar"`. The way out itself is still open. */
		routeExtra: (route: string, extra: string) =>
			`“${route}” takes nothing else. Remove ${extra}, then press Enter to send.`,
		unknownAction: "No observed action matches this text. Edit it or choose a suggestion.",
		unknownTarget: "No observed target matches this text. Edit it or choose a suggestion.",
		/** A typed / word that is not picked yet. Typing never picks. */
		pickAction: (typed: string) =>
			`“${echoWords(typed)}” is not picked yet. Press Tab to pick it from the suggestions, then Enter to send.`,
		chooseAction: "What do you do? Type / and press Tab to pick, then Enter to send.",
		/** Nothing picked while a question is open. */
		chooseAnswer: "Pick an answer: press Tab to see the answers, then Enter to send.",
		/** A typed @ or # word that is not picked yet. */
		pickTarget: (typed: string) =>
			`“${echoWords(typed)}” is not picked yet. Press Tab to pick it from the suggestions, then Enter to send.`,
		chooseTarget: (actionLabel?: string) =>
			`${actionLabel === undefined || actionLabel.trim() === "" ? "Who or what?" : `${actionLabel}: who or what?`} Type @ for someone here, # for a place or thing.`,
		/** Loose words beside something that takes spoken words. Play never
		 * quotes or sends them itself. */
		quoteWords: (words?: string) =>
			words === undefined || words.trim() === "" || words.includes('"')
				? 'Put what you say in quotes, like "hello".'
				: `Put what you say in quotes: "${echoWords(words)}"`,
		/** Loose words beside words already in quotes, or two quoted parts: only
		 * one would be sent, so the words are not echoed. */
		oneQuote: "Put all of what you say inside one pair of quotes.",
		/** `spelling` is the shell's own way to write the detail, e.g. `name:"…"`. */
		fieldMissing: (label: string, spelling: string) =>
			`“${label}” is missing. Add it as ${spelling}.`,
		strayForField: (words: string, label: string, spelling: string) =>
			`“${echoWords(words)}” is not part of anything yet. For the ${label}, write ${spelling}.`,
	},
	/** State phrases appended after an outcome line. Each names the state in
	 * player words (PRD: a rejected or unobserved attempt names its state). */
	outcome: {
		rejected: "Refused — your words are kept, so you can change them and try again.",
		unobserved: "Result unknown — your words are kept; look around before you try again.",
		/** Play stopped the attempt before sending it (`PlayAttemptBlockedError`
		 * → `ActStatusKind` `"blocked"`). */
		blocked: "Not sent — your words are kept.",
	},
	/** The Table tile's scene head while the hero is down (`PlayTable.svelte`
	 * ranks it above Talk): the scene name and the card's one summary line. */
	table: {
		downLabel: "Down",
		downSummary: "You are down and cannot act right now.",
	},
	/** Sentences Play writes into the Table stream itself. */
	stream: {
		/** Stands for the folded list of new states when the hero goes down
		 * (owner decision 2026-11-12, sk-jay0.1.8.102). */
		fellUnconscious: "You fall unconscious.",
	},
	/** Sentences `play-session.ts` throws as a `PlayAttemptBlockedError`: its
	 * local checks before sending, and repeat suppression. World refusals keep
	 * their own prose. `play-session.test.ts` proves the wiring. */
	session: {
		requiredFields: "Fill in the missing details first.",
		requiredField: (label: string) => `Fill in “${label}” first.`,
		actionAndTarget: "Choose what to do, and who or what, first.",
		malformedInput: "Some of what you typed could not be read. Change it and try again.",
		repeatRefusal: (lastRefusal?: string) =>
			lastRefusal === undefined || lastRefusal.trim() === ""
				? "That was already refused. Try something else, or wait until something changes."
				: `That was already refused: ${lastRefusal.trim()} Try something else, or wait until something changes.`,
		loading: "Still getting ready. Try again in a moment.",
		unknownAction: "You can no longer do that here.",
		invalidTarget: "That is not something you can choose here.",
		targetGone: "That is no longer here.",
		participantConflict: "Those choices do not go together. Choose one.",
		participantGone: "That is no longer available.",
		participantRequired: "Choose who or what takes part first.",
	},
} as const;

export type PlayCopy = typeof playCopy;

/** True when a display name is missing or is itself a raw reference such as
 * `entity:168`. Such a value must never reach the page. */
export function looksLikeRawRef(name: string | undefined, ref?: string): boolean {
	if (name === undefined) return true;
	const trimmed = name.trim();
	if (trimmed === "" || (ref !== undefined && trimmed === ref)) return true;
	return /^(entity|item|place_node|place_edge|location|world|occupant|def|action):\S*$/.test(
		trimmed,
	);
}

/** A neutral name for a target whose supplied name is missing or raw. */
export function playerTargetName(name: string | undefined, ref: string): string {
	if (!looksLikeRawRef(name, ref)) return (name as string).trim();
	return ref.startsWith("entity:") ? playCopy.targets.unnamedPerson : playCopy.targets.unnamedThing;
}
