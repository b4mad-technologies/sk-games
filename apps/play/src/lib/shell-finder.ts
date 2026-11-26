/** Frozen, presentation-only search over caller-visible shell candidates. */
import { Fzf } from "fzf";
import type { ShellCandidate } from "./shell-buffer";

export type ShellFinderSource =
	| "actions"
	| "targets"
	| "prompts"
	| "sensing"
	| "movement"
	| "turn"
	| "participants"
	| "history"
	| "pack"
	/** Detail fields of the chosen action. Accepting one inserts plain text;
	 * it is schema, never a world identity. */
	| "fields";

export interface ShellFinderCandidate extends ShellCandidate {
	id: string;
	label: string;
	detail?: string;
	/** Structured occurrence presentation, never recovered from a display label. */
	prompt?: { occurrenceId: string; sourceName: string; question?: string };
	preview?: string;
	/**
	 * A longer spelling the row is also found by, never shown and never
	 * inserted: the uncut command of a prompt answer whose `text` was capped
	 * (sk-jay0.1.8.94). Accepting the row still inserts `text`.
	 */
	searchText?: string;
	role?: "bound-fact" | "prompt" | "reaction" | "suggestion" | "stale" | "error" | "muted";
	source: ShellFinderSource;
	/** Advisory rank for otherwise-equal ordinary action matches only. */
	cueRank?: number;
}

export interface FrozenShellFinder {
	revision: number;
	candidates: readonly ShellFinderCandidate[];
}

export interface ShellFinderResult {
	candidate: ShellFinderCandidate;
	score: number;
	positions: ReadonlySet<number>;
}

/** Numeric-aware id tie-break: `choice/2` before `choice/10`. */
const idCollator = new Intl.Collator("en-US", { numeric: true });

/**
 * Display order of the finder by where a row comes from (owner decision
 * 2026-11-12, sk-jay0.1.8.95): answers to an open question, what is here,
 * ways out, then everything else. The open detail fields of the action being
 * filled in are not one of the owner's four tiers. This table is the order of
 * the EMPTY query, where they lead to keep form filling as it was before the
 * tiers: the caller lists them first, and the composer's grey next-detail
 * text reads the first row, also while the form's own question is still open
 * (`FactShellComposer.test.ts`, "ghosts the next detail after a space"). A
 * typed query uses `queryTier` below, where prompt answers lead. This is
 * presentation only. It hides nothing and says nothing about what the world
 * would allow. Typed as a full record so a new source needs a tier.
 */
const SOURCE_TIER: Record<ShellFinderSource, number> = {
	fields: 0,
	prompts: 1,
	targets: 2,
	movement: 3,
	actions: 4,
	sensing: 4,
	turn: 4,
	participants: 4,
	history: 4,
	pack: 4,
};

/**
 * Tier for a typed query. Prompt answers come first, as they did before the
 * tiers existed (they beat every other source on an equal score). Fields
 * follow them, then the owner's remaining tiers.
 */
function queryTier(source: ShellFinderSource): number {
	return source === "prompts" ? -1 : SOURCE_TIER[source];
}

/** History and Pack are named but inert until they have typed world contracts. */
export const INERT_SHELL_SOURCES = new Set<ShellFinderSource>(["history", "pack"]);

export function freezeShellFinder(
	revision: number,
	candidates: readonly ShellFinderCandidate[],
): FrozenShellFinder {
	return {
		revision,
		candidates: candidates
			.filter((candidate) => !INERT_SHELL_SOURCES.has(candidate.source))
			.map((candidate) => ({
				...candidate,
				...(candidate.prompt === undefined ? {} : { prompt: { ...candidate.prompt } }),
				...(candidate.semanticContext === undefined
					? {}
					: { semanticContext: { ...candidate.semanticContext } }),
			})),
	};
}

/** fzf ranks only the passed snapshot; it cannot discover or certify facts. */
export function findShellCandidates(
	snapshot: FrozenShellFinder,
	query: string,
	limit = 12,
): readonly ShellFinderResult[] {
	if (query === "")
		// The sort is stable: inside one tier the caller's order stays, so
		// authored answer order and the field order are kept.
		return [...snapshot.candidates]
			.sort((left, right) => SOURCE_TIER[left.source] - SOURCE_TIER[right.source])
			.slice(0, limit)
			.map((candidate) => ({ candidate, score: 0, positions: new Set<number>() }));
	const finder = new Fzf(snapshot.candidates, {
		// `searchText` comes last so the match positions of the shown parts
		// keep their offsets.
		selector: (candidate) =>
			`${candidate.label} ${candidate.text} ${candidate.canonical}${
				candidate.searchText === undefined || candidate.searchText === candidate.text
					? ""
					: ` ${candidate.searchText}`
			}`,
	});
	return finder
		.find(query)
		.map((result) => ({
			candidate: result.item,
			score: result.score,
			positions: result.positions,
		}))
		.sort((left, right) => {
			// Literal shell prefixes lead fuzzy matches by owner ruling (.56).
			// Rank the entire match set before limiting so fzf cannot discard one.
			const leftPrefix = Number(candidatePrefixMatches(query, left.candidate));
			const rightPrefix = Number(candidatePrefixMatches(query, right.candidate));
			if (leftPrefix !== rightPrefix) return rightPrefix - leftPrefix;
			// Within a prefix tier, cues only break equal fuzzy scores.
			if (left.score !== right.score) return right.score - left.score;
			// Equally relevant rows follow the source tier, so a bare `/` shows
			// answers and ways out before the long list of things to do.
			const tier = queryTier(left.candidate.source) - queryTier(right.candidate.source);
			if (tier !== 0) return tier;
			const leftCue = left.candidate.source === "actions" ? (left.candidate.cueRank ?? 0) : 0;
			const rightCue = right.candidate.source === "actions" ? (right.candidate.cueRank ?? 0) : 0;
			return rightCue - leftCue || idCollator.compare(left.candidate.id, right.candidate.id);
		})
		.slice(0, limit);
}

/** A literal prefix of the shown spelling or of the longer `searchText`. */
function candidatePrefixMatches(query: string, candidate: ShellFinderCandidate): boolean {
	return (
		shellCompletionPrefixMatches(query, candidate.text) ||
		(candidate.searchText !== undefined &&
			shellCompletionPrefixMatches(query, candidate.searchText))
	);
}

/** Ghost text is conservative: only a case-insensitive strict prefix of the
 * candidate's literal shell text may be accepted. */
export function ghostShellCandidate(
	query: string,
	results: readonly ShellFinderResult[],
): ShellFinderCandidate | undefined {
	const candidate = results[0]?.candidate;
	return candidate !== undefined && shellCompletionPrefixMatches(query, candidate.text)
		? candidate
		: undefined;
}

/**
 * A disclosed person or world reference is stored as a quoted shell token so
 * spaces cannot make a second, unbound argument. The finder still accepts the
 * mention-shaped prefix a player naturally types (`@Al` / `#Inn`), then inserts
 * that canonical quoted token on selection. Other token families stay literal.
 */
export function shellCompletionPrefixMatches(query: string, candidateText: string): boolean {
	if (query === "") return false;
	const normalizedQuery = query.toLocaleLowerCase();
	const normalizedCandidate = candidateText.toLocaleLowerCase();
	if (normalizedCandidate.startsWith(normalizedQuery)) return true;
	const quotedReference = /^([@#])"(.+)"$/.exec(candidateText);
	return (
		quotedReference !== null &&
		query.startsWith(quotedReference[1] ?? "") &&
		(quotedReference[2] ?? "").toLocaleLowerCase().startsWith(query.slice(1).toLocaleLowerCase())
	);
}
