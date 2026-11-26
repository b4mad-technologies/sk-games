/**
 * The Play dock's local interaction grammar. It deliberately keeps authored
 * action syntax and independently perceived targets separate until an explicit
 * Attempt turns one editable draft into transport input. In particular, this
 * module never evaluates niche predicates or materialises action × target
 * eligibility rows (ADR-0140/ADR-0141).
 */
import {
	type IntentDraft,
	type IntentInputValues,
	type IntentSemanticContext,
	inputValuesToText,
} from "@spellkave/sdk";
import type {
	PlayExit,
	PlayManipulationAction,
	PlayManipulationContext,
	PlayManipulationPrompt,
	PlayManipulationTarget,
} from "./play-view";
import { playerTargetName } from "./player-copy";
import type { Selection } from "./selection";

/** Numeric-aware label order, so "Answer 2" sorts before "Answer 10". */
const labelCollator = new Intl.Collator("en-US", { numeric: true });
function compareLabels(left: string, right: string): number {
	return labelCollator.compare(left, right);
}

export type ComposerPart = "action" | "target" | "details";

/** A readable shell word for a label. It is a spelling only and never an
 * identity: what a picked word means stays in its bound fact. */
export function shellSlug(value: string): string {
	return asciiSlug(value) || "go";
}

/** Lower-case ASCII words joined by hyphens, or "" when nothing is left.
 * Accents are folded first ("Café" gives "cafe", "Küche" gives "kuche"); a
 * letter with no ASCII base form is dropped. */
function asciiSlug(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLocaleLowerCase("en-US")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * The shell spelling of each way out, by exit handle: `/go-<destination>`
 * (owner ruling 2026-11-12). The direction is not part of the spelling; it
 * stays in the row's label. When two ways out would be spelled alike, each of
 * them carries its direction as a suffix, so neither looks like the default.
 * An exit whose destination has no name, or a name with no letter the shell
 * can spell, is spelled by its direction. The suffix is left out only when it
 * would tell none of the alike ways out apart (each one's direction is the
 * shared word itself).
 */
export function exitShellTexts(exits: readonly PlayExit[]): ReadonlyMap<string, string> {
	const spelled = exits.map((exit) => {
		const direction = asciiSlug(exit.label);
		return { exit, direction, slug: asciiSlug(exit.toName) || direction || "go" };
	});
	const alike = new Map<string, { count: number; told: boolean }>();
	for (const { slug, direction } of spelled) {
		const group = alike.get(slug) ?? { count: 0, told: false };
		group.count += 1;
		group.told ||= direction !== "" && direction !== slug;
		alike.set(slug, group);
	}
	return new Map(
		spelled.map(({ exit, slug, direction }) => {
			const group = alike.get(slug);
			const suffixed = group !== undefined && group.count > 1 && group.told && direction !== "";
			return [exit.handle, suffixed ? `/go-${slug}-${direction}` : `/go-${slug}`];
		}),
	);
}

/** Longest shell word of a prompt answer before its suffix, in characters
 * after the `/`. */
export const ANSWER_SHELL_LIMIT = 24;

/** Cuts a slug at the last whole word that fits. One over-long word is cut
 * inside the word. */
function capSlug(slug: string, limit: number): string {
	if (slug.length <= limit) return slug;
	const boundary = slug.lastIndexOf("-", limit);
	return boundary > 0 ? slug.slice(0, boundary) : slug.slice(0, limit);
}

/**
 * The shell spelling of each answer of ONE open question, by action id (owner
 * decision 2026-11-12, sk-jay0.1.8.94). A long label is cut at a word boundary
 * near `ANSWER_SHELL_LIMIT` characters; the row keeps the full label. A cut
 * spelling that would equal another answer's spelling gets a number suffix,
 * and so does every other cut spelling alike to it, so none looks like the
 * default. Spellings that were not cut stay as authored, also when two
 * answers carry the same label. The spelling is never an identity: the
 * picked row keeps its action id and its question.
 */
export function promptAnswerShellTexts(
	answers: readonly { actionId: string; label: string }[],
): ReadonlyMap<string, string> {
	const spelled = answers.map(({ actionId, label }) => {
		const full = shellSlug(label);
		const slug = capSlug(full, ANSWER_SHELL_LIMIT);
		return { actionId, slug, cut: slug !== full };
	});
	const taken = new Set(spelled.filter((entry) => !entry.cut).map((entry) => entry.slug));
	const cutCount = new Map<string, number>();
	for (const entry of spelled) {
		if (entry.cut) cutCount.set(entry.slug, (cutCount.get(entry.slug) ?? 0) + 1);
	}
	const texts = new Map<string, string>();
	for (const entry of spelled) {
		let slug = entry.slug;
		if (entry.cut && (taken.has(slug) || (cutCount.get(slug) ?? 0) > 1)) {
			let suffix = 1;
			while (taken.has(`${entry.slug}-${suffix}`)) suffix += 1;
			slug = `${entry.slug}-${suffix}`;
		}
		if (entry.cut) taken.add(slug);
		texts.set(entry.actionId, `/${slug}`);
	}
	return texts;
}

export interface ComposerDraftState {
	actionId: string | null;
	targetRef: string | null;
	inputValues: IntentInputValues;
	/** Free authored speech, separate from structured input values. */
	utterance: string;
	/** ADR-0142 occurrence identity selected from a caller-scoped prompt fact.
	 * It is intentionally absent for ordinary direct attempts. */
	semanticContext?: IntentSemanticContext;
	activePart: ComposerPart;
}

export interface ComposerCompletion<T> {
	id: string;
	label: string;
	value: T;
	/** An authored explanation, never an eligibility assertion. Absent when
	 * the world supplies none: this model never invents a reason. */
	reason?: string;
}

/** A caller-scoped prompt occurrence in composer presentation form. Its
 * response IDs rank known action syntax; they never filter the ordinary action
 * completion list or assert reducer eligibility. */
export interface ComposerPrompt extends PlayManipulationPrompt {
	sourceName: string;
}

export interface FrozenCompletions<T> {
	part: ComposerPart;
	revision: number;
	entries: readonly ComposerCompletion<T>[];
}

/**
 * A deliberately small fzf-like matcher for an already-authorized completion
 * snapshot. It ranks presentation only: the returned score must never be
 * used to infer eligibility or manufacture a new completion.
 *
 * Consecutive and word-start matches win over scattered subsequences, while
 * an empty query retains the server/author supplied snapshot order.
 */
export function fuzzyMatchScore(query: string, candidate: string): number | null {
	const needle = query.trim().toLocaleLowerCase();
	if (needle === "") return 0;
	const haystack = candidate.toLocaleLowerCase();
	let cursor = 0;
	let score = 0;
	let previous = -2;
	for (const character of needle) {
		const found = haystack.indexOf(character, cursor);
		if (found === -1) return null;
		const consecutive = found === previous + 1;
		const wordStart = found === 0 || /[\\s/_-]/.test(haystack[found - 1] ?? "");
		score += consecutive ? 8 : wordStart ? 5 : 1;
		cursor = found + 1;
		previous = found;
	}
	return score;
}

/** Ranks only entries held in the frozen caller-visible snapshot. */
export function fuzzyCompletions<T>(
	entries: readonly ComposerCompletion<T>[],
	query: string,
): readonly ComposerCompletion<T>[] {
	return entries
		.map((entry, index) => ({
			entry,
			index,
			score: fuzzyMatchScore(query, `${entry.label} ${entry.id}`),
		}))
		.filter(
			(candidate): candidate is { entry: ComposerCompletion<T>; index: number; score: number } =>
				candidate.score !== null,
		)
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.map(({ entry }) => entry);
}

export function emptyComposerDraft(): ComposerDraftState {
	return { actionId: null, targetRef: null, inputValues: {}, utterance: "", activePart: "action" };
}

/** Start a fresh editable sentence from one server-projected occurrence. This
 * deliberately binds only the speaker/target context. A response stays
 * unselected: choosing it is the player's intent, not a client default. */
export function draftWithPrompt(
	draft: ComposerDraftState,
	prompt: Pick<ComposerPrompt, "sourceRef" | "occurrenceId">,
): ComposerDraftState {
	return {
		...draft,
		actionId: null,
		targetRef: prompt.sourceRef,
		inputValues: {},
		utterance: "",
		semanticContext: { source_ref: prompt.sourceRef, occurrence_id: prompt.occurrenceId },
		activePart: "action",
	};
}

export function composerActions(
	context: PlayManipulationContext,
	prompt?: ComposerPrompt,
): readonly ComposerCompletion<PlayManipulationAction>[] {
	if (context.status !== "ready") return [];
	const labelByAction = prompt?.presentation?.labels ?? {};
	const promptOrder = new Map(prompt?.responseActionIds.map((id, index) => [id, index]) ?? []);
	return context.actions
		.map((action) => ({
			id: action.actionId,
			label: labelByAction[action.actionId] ?? action.displayName,
			value: action,
			// Only an authored cue explains a row. A niche requirement is a fact
			// about the verb, not an observation of anything here (sk-jay0.1.8.95).
			...(action.cue?.hint !== undefined ? { reason: action.cue.hint } : {}),
		}))
		.sort((left, right) => {
			const leftOrder = promptOrder.get(left.id);
			const rightOrder = promptOrder.get(right.id);
			if (leftOrder !== undefined || rightOrder !== undefined) {
				if (leftOrder === undefined) return 1;
				if (rightOrder === undefined) return -1;
				return leftOrder - rightOrder;
			}
			const leftRank = left.value.cue?.rank ?? 0;
			const rightRank = right.value.cue?.rank ?? 0;
			return (
				rightRank - leftRank ||
				compareLabels(left.label, right.label) ||
				compareLabels(left.id, right.id)
			);
		});
}

export function composerPrompts(context: PlayManipulationContext): readonly ComposerPrompt[] {
	if (context.status !== "ready") return [];
	const targetNameByRef = new Map(
		context.targets.map((target) => [target.targetRef, target.targetName]),
	);
	return (context.prompts ?? [])
		.filter((prompt) => !prompt.consumed)
		.map((prompt) => ({
			...prompt,
			// Never show the raw source reference (sk-jay0.1.8.92).
			sourceName: playerTargetName(targetNameByRef.get(prompt.sourceRef), prompt.sourceRef),
		}))
		.sort(
			(left, right) =>
				left.openedAtTick - right.openedAtTick ||
				compareLabels(left.occurrenceId, right.occurrenceId),
		);
}

export function composerTargets(
	context: PlayManipulationContext,
): readonly ComposerCompletion<PlayManipulationTarget>[] {
	if (context.status !== "ready") return [];
	return context.targets
		.map((target) => ({
			id: target.targetFactId,
			// A missing or raw name gets a neutral label, never the reference.
			label: playerTargetName(target.targetName, target.targetRef),
			value: target,
		}))
		.sort(
			(left, right) => compareLabels(left.label, right.label) || compareLabels(left.id, right.id),
		);
}

/** Freeze the displayed digit mapping. New facts can cause a later refresh,
 * but never silently change the meaning of a digit under the player's hand. */
export function freezeCompletions<T>(
	part: ComposerPart,
	revision: number,
	entries: readonly ComposerCompletion<T>[],
): FrozenCompletions<T> {
	return { part, revision, entries: entries.map((entry) => ({ ...entry })) };
}

/** Maps a non-dispatching global selection to an independently disclosed
 * target fact. A selection without a matching current fact simply leaves the
 * draft alone; it never invents a target reference. */
export function targetForSelection(
	selection: Selection,
	context: PlayManipulationContext,
): PlayManipulationTarget | undefined {
	if (selection === null || context.status !== "ready") return undefined;
	const ref =
		selection.kind === "actor"
			? `entity:${selection.actorId}`
			: selection.kind === "item"
				? `item:${selection.itemId}`
				: selection.kind === "place" || selection.kind === "cell"
					? `place_node:${selection.nodeId}`
					: undefined;
	return ref === undefined ? undefined : context.targets.find((target) => target.targetRef === ref);
}

export function draftWithSelection(
	draft: ComposerDraftState,
	selection: Selection,
	context: PlayManipulationContext,
): ComposerDraftState {
	const target = targetForSelection(selection, context);
	return target === undefined || target.targetRef === draft.targetRef
		? draft
		: {
				...draft,
				targetRef: target.targetRef,
				activePart: draft.actionId === null ? "action" : "details",
			};
}

/** Forms a direct candidate only after the player selects both independent
 * facts. Completeness/admission remain the SDK/server's responsibility. */
export function intentFromComposer(
	draft: ComposerDraftState,
	actions: readonly PlayManipulationAction[],
): IntentDraft | undefined {
	if (draft.actionId === null || draft.targetRef === null) return undefined;
	const action = actions.find((candidate) => candidate.actionId === draft.actionId);
	if (action === undefined) return undefined;
	const argsJson =
		Object.keys(draft.inputValues).length === 0 ? "{}" : inputValuesToText(draft.inputValues);
	if (action.communicationSpeechActId !== undefined) {
		return {
			kind: "communicate",
			speech_act_id: action.communicationSpeechActId,
			target_ref: draft.targetRef,
			args_json: argsJson,
			...(draft.utterance.trim() === "" ? {} : { utterance: draft.utterance.trim() }),
			...(Object.keys(draft.inputValues).length === 0 ? {} : { input_values: draft.inputValues }),
			...(draft.semanticContext === undefined ? {} : { semantic_context: draft.semanticContext }),
		};
	}
	return {
		kind: "manipulate",
		action_id: action.actionId,
		target_ref: draft.targetRef,
		args_json: argsJson,
		...(Object.keys(draft.inputValues).length === 0 ? {} : { input_values: draft.inputValues }),
		...(draft.semanticContext === undefined ? {} : { semantic_context: draft.semanticContext }),
	};
}
