<script lang="ts">
	import { untrack } from "svelte";
	import {
		beginDefaultDraft,
		type DefaultDraft,
		defaultDraftIsCurrent,
		effectiveDefaultInputs,
		effectiveDefaultTarget,
		suppressDefaultInputs,
		suppressDefaultTarget,
	} from "../lib/default-draft";
	import { type ComposerCompletion, type ComposerDraftState, type ComposerPrompt, exitShellTexts, promptAnswerShellTexts, shellSlug } from "../lib/fact-composer";
	import type { Keymap } from "../lib/keymap";
	import type { PlayAction, PlayActionInputField, PlayExit, PlayManipulationAction, PlayManipulationTarget } from "../lib/play-view";
	import { playCopy, playerTargetName } from "../lib/player-copy";
	import { readDefinitionCard } from "../lib/reference-adapter";
	import {
		applyShellEdit,
		bindShellCandidate,
		emptyShellBuffer,
		parseShellBuffer,
		reconcileShellText,
		type ShellBuffer,
		type ShellSpan,
		shellCompletionRange,
		shellQuotedValue,
		shellRangeInValue,
		validShellBindings,
	} from "../lib/shell-buffer";
	import {
		type FrozenShellFinder,
		findShellCandidates,
		freezeShellFinder,
		type ShellFinderCandidate,
	} from "../lib/shell-finder";
	import ShellComposer from "./ShellComposer.svelte";

	let {
		draft,
		actions,
		targets,
		prompts = [],
		senseActions = [],
		exits = [],
		canEndTurn = false,
		selectedPromptId = null,
		insertion = null,
		prefillTargetRef = null,
		clearToken = 0,
		revision,
		busy = false,
		outcome = null,
		statusMessage,
		suspended = false,
		downed = false,
		keymap,
		onExecutableChange = () => {},
		onChooseAction = () => {},
		onChooseTarget = () => {},
		onChoosePrompt = () => {},
		onAttemptSense,
		onAttemptMove,
		onAttemptEndTurn,
		onChangeDetails = () => {},
		onInsertionKept = () => {},
		onAttempt,
	}: {
		draft: ComposerDraftState;
		actions: readonly ComposerCompletion<PlayManipulationAction>[];
		targets: readonly ComposerCompletion<PlayManipulationTarget>[];
		prompts?: readonly ComposerPrompt[];
		/** Direct factual query syntax remains a typed sense attempt, never a
		 * fabricated manipulation action. */
		senseActions?: readonly PlayAction[];
		/** Exit identity is its current scene handle; display text is only a
		 * shell spelling and cannot itself cause movement. */
		exits?: readonly PlayExit[];
		canEndTurn?: boolean;
		selectedPromptId?: string | null;
		prefillTargetRef?: string | null;
		/** A request to write a bound sentence into the box. Two sources: an
		 * explicit detail button (verb Insert, Go there) and a click on a way out
		 * (ways-out menu, Place row, card map, stage map). Arrow browsing never
		 * writes. The request never sends, and it replaces only a box without
		 * the player's own words (see `replaceable`). */
		insertion?: { token: number; actionId?: string; targetRef?: string; exitHandle?: string } | null;
		/** Advances only after an observed accepted attempt. Rejections, stale
		 * facts and unobserved transport outcomes deliberately retain repairable
		 * player text. */
		clearToken?: number;
		revision: number;
		busy?: boolean;
		statusMessage?: { text: string; tone: "stale" | "error" };
		/** Transport/admission status supplied by the dispatch owner. It is
		 * presentation only: this composer never promotes admission to a world
		 * consequence. */
		outcome?: { text: string; kind: "accepted" | "rejected" | "unobserved" | "blocked" } | null;
		suspended?: boolean;
		/** The hero is down (the caller reads this from the hero's own state).
		 * It only changes the help line: the box stays usable and the world
		 * still decides every attempt. */
		downed?: boolean;
		keymap?: Keymap;
		onExecutableChange?: (executable: Pick<ComposerDraftState, "actionId" | "targetRef" | "semanticContext">) => void;
		/** Compatibility observation hooks. The executable parent draft uses
		 * onExecutableChange exclusively. */
		onChooseAction?: (actionId: string) => void;
		onChooseTarget?: (targetRef: string) => void;
		onChoosePrompt?: (occurrenceId: string) => void;
		onAttemptSense?: (actionId: string) => void;
		onAttemptMove?: (exitHandle: string) => void;
		onAttemptEndTurn?: () => void;
		onChangeDetails?: (details: Pick<ComposerDraftState, "inputValues" | "utterance">) => void;
		/** An insertion request was refused because the player's words are in the
		 * box. The owner may let the same gesture ask again. The argument is the
		 * way out that was asked for, or `null` for a detail action. */
		onInsertionKept?: (exitHandle: string | null) => void;
		onAttempt: () => void;
	} = $props();

	let buffer = $state<ShellBuffer>(emptyShellBuffer());
	let selection = $state<ShellSpan>({ start: 0, end: 0 });
	let appliedClearToken = $state<number | null>(null);
	let defaultDraft = $state<DefaultDraft | undefined>(undefined);
	type DirectRoute =
		| { kind: "sense"; actionId: string }
		| { kind: "move"; exitHandle: string }
		| { kind: "end-turn" };
	let directRoute = $state<(DirectRoute & { canonical: string; text: string }) | null>(null);
	let appliedPrefillTarget = $state<string | null>(null);
	let appliedInsertion = 0;
	let focusToken = $state(0);
	/** Caret position for the next focus request; `undefined` means the end. */
	let focusCaret = $state<number | undefined>(undefined);
	function requestFocus(caret?: number): void {
		focusCaret = caret;
		focusToken += 1;
	}
	/** A click asked to fill the box while the player's own words were in it.
	 * The words stay; the note lasts until the text changes. */
	let keptDraftNote = $state<{ text: string; choice: string } | null>(null);
	let responseDescriptions = $state<Record<string, string>>({});
	$effect(() => {
		const refs = [...new Set(prompts.flatMap(prompt => Object.values(prompt.presentation?.responseRefs ?? {})))];
		let current = true;
		void Promise.all(refs.map(async ref => [ref, (await readDefinitionCard(ref).catch(() => null))?.description] as const))
			.then(entries => { if (current) responseDescriptions = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === "string" && entry[1].length > 0)); });
		return () => { current = false; };
	});
	const allActionCandidates = $derived(actions.map((entry): ShellFinderCandidate => ({
			id: `action:${entry.value.actionId}`,
			// The player-facing sentence uses a readable shell spelling. Its
			// opaque action id stays only in `canonical`: the parser never turns
			// the text back into authority, so duplicate labels remain safe.
			text: `/${shellSlug(entry.label)}`,
			kind: "action",
			canonical: entry.value.actionId,
			label: entry.label,
			...(entry.reason === undefined ? {} : { detail: entry.reason }),
			...(entry.value.description === undefined ? {} : { preview: entry.value.description }),
			...(entry.value.cue?.rank === undefined ? {} : { cueRank: entry.value.cue.rank }),
			source: "actions",
		})));
	const candidates = $derived.by(() => {
		// A numbered answer slot (the authored response-slot marker) is a row
		// only as the named answer of an open question. Without one it has no
		// name of its own, so it is not listed (owner ruling 2026-11-12). This
		// is presentation: nothing here checks whether the world would allow it.
		const answerSlots = new Set(actions.filter(entry => entry.value.responseSlot !== undefined).map(entry => entry.value.actionId));
		const actionCandidates = allActionCandidates.filter(entry => !answerSlots.has(entry.canonical) && !prompts.some(prompt => !prompt.consumed && prompt.responseActionIds.includes(entry.canonical)));
		const targetCandidates: ShellFinderCandidate[] = targets.map((entry) => {
			// A raw reference never reaches the page, even if a caller passes one.
			const label = playerTargetName(entry.label, entry.value.targetRef);
			return {
				id: `target:${entry.value.targetFactId}`,
				text: entry.value.targetRef.startsWith("entity:") ? `@"${label}"` : `#"${label}"`,
				kind: entry.value.targetRef.startsWith("entity:") ? "actor" : "world_ref",
				canonical: entry.value.targetRef,
				label,
				...(entry.reason === undefined ? {} : { detail: entry.reason }),
				source: "targets",
			};
		});
		const promptCandidates: ShellFinderCandidate[] = prompts.filter(prompt => !prompt.consumed).flatMap((prompt) => {
			const answers = prompt.responseActionIds.flatMap((actionId) => {
				const action = actions.find((candidate) => candidate.value.actionId === actionId);
				return action === undefined ? [] : [{ actionId, label: prompt.presentation?.labels[actionId] ?? action.label }];
			});
			// A long answer label is cut for the command text only. The row keeps
			// the full label, and cut texts stay apart inside this one question.
			const answerTexts = promptAnswerShellTexts(answers);
			return answers.map(({ actionId, label: responseLabel }) => {
				const definitionRef = prompt.presentation?.responseRefs?.[actionId];
				const preview = definitionRef === undefined ? undefined : responseDescriptions[definitionRef];
				return {
					id: `prompt:${prompt.occurrenceId}:${actionId}`,
					// A response uses the same visible intent token as an ordinary
					// action. Its selected binding—not its label—retains the exact
					// prompt occurrence plus response action identity.
					text: answerTexts.get(actionId) ?? `/${shellSlug(responseLabel)}`,
					// The uncut spelling stays findable: a player who types on past
					// the cut, to tell two cut answers apart, still finds the row.
					searchText: `/${shellSlug(responseLabel)}`,
					kind: "action" as const,
					canonical: actionId,
					// Exact response IDs replace their duplicate ordinary rows while
					// this prompt is open. Other actions remain available.
					label: responseLabel,
					...(preview === undefined ? {} : { preview }),
					prompt: { occurrenceId: prompt.occurrenceId, sourceName: prompt.sourceName, question: prompt.presentation?.question },
					detail: prompt.presentation?.question ?? playCopy.candidates.replyTo(prompt.sourceName),
					role: "prompt" as const,
					source: "prompts" as const,
					semanticContext: { source_ref: prompt.sourceRef, occurrence_id: prompt.occurrenceId },
				};
			});
		});
		const sensingCandidates: ShellFinderCandidate[] = senseActions.map((action) => ({
			id: `sense:${action.id}`,
			text: `/${action.descriptor}`,
			kind: "action",
			canonical: action.id,
			label: action.label,
			...(action.description === undefined ? {} : { detail: action.description }),
			source: "sensing",
		}));
		// A way out is spelled by where it leads; the direction stays readable
		// in the label and the detail line.
		const exitTexts = exitShellTexts(exits);
		const movementCandidates: ShellFinderCandidate[] = exits.map((exit) => ({
			id: `move:${exit.handle}`,
			text: exitTexts.get(exit.handle) ?? `/go-${shellSlug(exit.toName || exit.label)}`,
			kind: "action",
			canonical: exit.handle,
			label: playCopy.candidates.goTo(exit.toName || exit.label, exit.label),
			detail: playCopy.candidates.wayOut(exit.label),
			source: "movement",
		}));
		const turnCandidates: ShellFinderCandidate[] = canEndTurn
			? [{
				id: "turn:end",
				text: "/end-turn",
				kind: "action",
				canonical: "end-turn",
				label: playCopy.candidates.endTurn,
				detail: playCopy.candidates.endTurnDetail,
				source: "turn",
			}]
			: [];
		return [...fieldCandidates, ...promptCandidates, ...actionCandidates, ...targetCandidates, ...sensingCandidates, ...movementCandidates, ...turnCandidates];
	});
	const completionRange = $derived(shellCompletionRange(buffer.text, selection));
	const activeToken = $derived(buffer.text.slice(completionRange.start, completionRange.end));
	/* The finder is a player-visible observation, not a reactive offer list.
	 * Keep its identities fixed until the player explicitly accepts a new
	 * observation. Otherwise an index could silently select a different fact
	 * after a world revision. */
	let finderSnapshot = $state<FrozenShellFinder | null>(null);
	let finderOpen = $state(false);
	let finderRefreshToken = $state(0);
	$effect(() => {
		if (finderSnapshot === null) finderSnapshot = freezeShellFinder(revision, candidates);
	});
	const currentFinderSnapshot = $derived(finderOpen && finderSnapshot !== null ? finderSnapshot : freezeShellFinder(revision, candidates));
	const results = $derived(findShellCandidates(currentFinderSnapshot, activeToken));
	const finderRefreshAvailable = $derived(revision !== currentFinderSnapshot.revision);
	const unresolvedTokenRanges = $derived.by(() => {
		const bindings = validShellBindings(buffer);
		return parseShellBuffer(buffer.text)
			.filter((token) => token.kind === "action" || token.kind === "actor" || token.kind === "world_ref")
			.filter((token) => !bindings.some((binding) => binding.start === token.start && binding.end === token.end))
			.filter((token) =>
				!findShellCandidates(currentFinderSnapshot, token.text).some((result) => result.candidate.kind === token.kind),
			)
			.map(({ start, end }) => ({ start, end }));
	});
	const helpPrompt = $derived(prompts.find(prompt => !prompt.consumed && prompt.occurrenceId === selectedPromptId) ?? prompts.find(prompt => !prompt.consumed));
	const stalePrompt = $derived(
		buffer.bindings.some((binding) =>
			binding.semanticContext !== undefined &&
			!prompts.some(
				(prompt) =>
					!prompt.consumed &&
					prompt.occurrenceId === binding.semanticContext?.occurrence_id &&
					prompt.sourceRef === binding.semanticContext?.source_ref,
			),
		),
	);
	const promptTargetConflict = $derived.by(() => {
		const bindings = validShellBindings(buffer);
		const response = bindings.findLast((binding) => binding.kind === "action" && binding.semanticContext !== undefined);
		const target = bindings.findLast((binding) => binding.kind === "actor" || binding.kind === "world_ref");
		return target !== undefined && response?.semanticContext !== undefined && target.canonical !== response.semanticContext.source_ref;
	});
	/** Why an armed route cannot be sent. `gone`: its picked word was edited
	 * away or the world no longer offers it. `extra`: the route is still open
	 * but another picked name stands beside it. Only the player's own
	 * completion puts one there: a map or name click beside a route only
	 * selects (owner ruling 2026-11-13). */
	const routeProblem = $derived.by((): { kind: "gone" } | { kind: "extra"; route: string; extra: string } | undefined => {
		const route = directRoute;
		if (route === null) return undefined;
		const bindings = validShellBindings(buffer);
		const own = bindings.find((binding) => binding.kind === "action" && binding.canonical === route.canonical && binding.text === route.text);
		const offered = route.kind === "sense"
			? candidates.some((candidate) => candidate.source === "sensing" && candidate.canonical === route.actionId)
			: route.kind === "move"
				? candidates.some((candidate) => candidate.source === "movement" && candidate.canonical === route.exitHandle)
				: candidates.some((candidate) => candidate.source === "turn");
		if (own === undefined || !offered) return { kind: "gone" };
		const others = bindings.filter((binding) => binding !== own);
		return others.length === 0 ? undefined : { kind: "extra", route: route.text, extra: others.map((binding) => binding.text).join(" ") };
	});
	// A typed route is executable only while its completed action remains the
	// sole bound fact. Appending/replacing a target must not leave a movement
	// or sense route armed behind the visible sentence.
	const staleRoute = $derived(routeProblem !== undefined);
	const selectedAction = $derived(actions.find((action) => action.value.actionId === draft.actionId)?.value);
	const shellAction = $derived.by(() => {
		const binding = validShellBindings(buffer).findLast(
			(candidate) => candidate.kind === "action" && actions.some((action) => action.value.actionId === candidate.canonical),
		);
		return binding === undefined ? undefined : actions.find((action) => action.value.actionId === binding.canonical)?.value;
	});
	const defaultDraftAction = $derived(
		defaultDraft === undefined
			? undefined
			: actions.find((action) => action.value.actionId === defaultDraft?.actionId)?.value,
	);
	const defaultDraftStale = $derived(
		!defaultDraftIsCurrent(
			defaultDraft,
			defaultDraftAction,
			new Set(targets.map((target) => target.value.targetRef)),
		),
	);
	const activeDefaultTarget = $derived(
		defaultDraftStale ? undefined : effectiveDefaultTarget(defaultDraft),
	);
	const activeDefaultInputs = $derived(
		defaultDraftStale ? {} : effectiveDefaultInputs(defaultDraft),
	);
	/* Detail fields of the chosen action are filled in this same text box as
	 * `name:"…"` words. They are schema, not world identities: a "Fill in" row
	 * inserts plain text and Play never fills a value. */
	const formFields = $derived(directRoute === null ? ((shellAction ?? selectedAction)?.input?.fields ?? []) : []);
	const fieldTokenNames = $derived(new Set(
		parseShellBuffer(buffer.text)
			.filter((token) => token.kind === "field")
			.map((token) => token.text.slice(0, token.text.indexOf(":"))),
	));
	function fieldTemplate(field: PlayActionInputField): string | undefined {
		const text = field.control === "number" ? `${field.name}:` : `${field.name}:""`;
		const parsed = parseShellBuffer(text);
		// A field whose name is not one plain word cannot be offered as a row;
		// the blocker still names it.
		return parsed.length === 1 && parsed[0]?.kind === "field" && parsed[0].end === text.length ? text : undefined;
	}
	function fieldSpelling(field: PlayActionInputField, value: string): string {
		return field.control === "number" ? `${field.name}:${value}` : `${field.name}:"${value}"`;
	}
	const fieldCandidates = $derived.by((): ShellFinderCandidate[] => {
		const open = formFields.filter((field) => !fieldTokenNames.has(field.name));
		return [...open.filter((field) => field.required === true), ...open.filter((field) => field.required !== true)].flatMap((field) => {
			const text = fieldTemplate(field);
			if (text === undefined) return [];
			const range = field.control === "number" && field.min !== undefined && field.max !== undefined
				? playCopy.candidates.numberRange(field.min, field.max)
				: undefined;
			const detail = [field.required === true ? playCopy.candidates.fieldNeeded : playCopy.candidates.fieldOptional, field.placeholder ?? range]
				.filter((part): part is string => part !== undefined && part.trim() !== "")
				.join(" · ");
			return [{ id: `field:${field.name}`, text, kind: "field" as const, canonical: field.name, label: field.label, detail, source: "fields" as const }];
		});
	});
	const shellActionBinding = $derived(validShellBindings(buffer).findLast(
		(candidate) => candidate.kind === "action" && actions.some((action) => action.value.actionId === candidate.canonical),
	));
	/** The chosen action carries spoken words and nothing else: no detail
	 * fields, and it is not an answer to an open question. */
	const takesWords = $derived(
		shellAction !== undefined &&
		(shellAction.communicationSpeechActId !== undefined || shellAction.acceptsUtterance === true) &&
		(shellAction.input === undefined || shellAction.input.fields.length === 0) &&
		shellAction.responseSlot === undefined &&
		shellActionBinding?.semanticContext === undefined,
	);
	/** Computed from the sentence itself, never from the parent's `draft`,
	 * which only follows after `onExecutableChange`. */
	function targetResolved(): boolean {
		const action = shellActionBinding;
		if (action === undefined) return false;
		if (validShellBindings(buffer).some((binding) => binding.kind === "actor" || binding.kind === "world_ref")) return true;
		if (action.semanticContext !== undefined) return true;
		return defaultDraft?.actionId === action.canonical && activeDefaultTarget !== undefined;
	}
	const emptyValues = $derived(parseShellBuffer(buffer.text).flatMap((token) => {
		if (token.kind === "payload" && token.text === '""' && takesWords) {
			return [{ start: token.start + 1, text: playCopy.composer.wordsPlaceholder, hint: playCopy.composer.wordsHint, needsTarget: true }];
		}
		if (token.kind !== "field" || !token.text.endsWith(':""')) return [];
		const field = formFields.find((candidate) => candidate.control !== "number" && `${candidate.name}:""` === token.text);
		return field === undefined ? [] : [{ start: token.end - 1, text: field.placeholder ?? field.label, hint: playCopy.composer.fieldHint(field.label), needsTarget: false }];
	}));
	/* The mirror draws a hint inside the quotes and so shifts everything after
	 * it, while the real caret stays at its text position. Draw a hint only
	 * while the collapsed caret sits at that very spot. */
	const emptyQuoteHints = $derived(
		emptyValues.filter((entry) => selection.start === selection.end && selection.start === entry.start),
	);
	/** The caret is inside quotes or in a detail: the player writes there. No
	 * completion is offered, so the key legend names no picking key. The shell
	 * applies the same rule to its keys (`shellRangeInValue`). */
	const caretInValue = $derived(shellRangeInValue(buffer.text, completionRange));
	const goHint = $derived.by(() => {
		if (directRoute?.kind !== "move" || staleRoute) return undefined;
		const handle = directRoute.exitHandle;
		const exit = exits.find((candidate) => candidate.handle === handle);
		return exit === undefined ? undefined : playCopy.composer.goHint(exit.toName || exit.label);
	});
	/** The next step in one line: a waiting empty value, a way out, or Enter. */
	const emptyValueHint = $derived.by(() => {
		const first = emptyValues[0];
		// Without a target the help line asks for the target first.
		return first === undefined || (first.needsTarget && !targetResolved()) ? undefined : first.hint;
	});
	const nextStepHint = $derived.by(() => {
		if (emptyValueHint !== undefined) return emptyValueHint;
		const pressEnter =
			goHint ??
			(attemptBlock === undefined && buffer.text.trim() !== "" ? playCopy.composer.sendHint : undefined);
		// A downed hero reads "cannot act" where a "press Enter" hint would stand,
		// and in the empty box when no question is open. An open question, a
		// "fill in" hint, a default-draft line and a blocker keep their place.
		const idle = buffer.text.trim() === "" && helpPrompt === undefined;
		return downed && (pressEnter !== undefined || idle) ? playCopy.composer.downed : pressEnter;
	});
	/** An explicit completion may append ONE empty template at the end and put
	 * the caret inside it. Typing and selection prefill never come here. */
	function appendTemplate(text: string, caretFromEnd: number): void {
		const prefix = buffer.text === "" || /\s$/.test(buffer.text) ? "" : " ";
		const end = buffer.text.length;
		buffer = applyShellEdit(buffer, { range: { start: end, end }, text: `${prefix}${text}` });
		const caret = buffer.text.length - caretFromEnd;
		selection = { start: caret, end: caret };
		requestFocus(caret);
	}
	function offerNextPiece(): void {
		if (directRoute !== null || shellAction === undefined || !targetResolved()) return;
		const tokens = parseShellBuffer(buffer.text);
		if (tokens.some((token) => token.kind === "unknown")) return;
		const fields = shellAction.input?.fields ?? [];
		if (fields.length > 0) {
			const field = fields.find((candidate) =>
				candidate.required === true &&
				!fieldTokenNames.has(candidate.name) &&
				activeDefaultInputs[candidate.name] === undefined,
			);
			const template = field === undefined ? undefined : fieldTemplate(field);
			if (template === undefined) return;
			appendTemplate(template, template.endsWith('"') ? 1 : 0);
			noteExplicitDefaultEdits();
			return;
		}
		if (takesWords && !tokens.some((token) => token.kind === "payload")) appendTemplate('""', 1);
	}
	function formatDefaultField(name: string, value: string | number): string {
		return `${name}:${typeof value === "string" ? JSON.stringify(value) : value}`;
	}
	const defaultSummary = $derived.by(() => {
		if (defaultDraft === undefined) return undefined;
		if (defaultDraftStale) return playCopy.defaults.changed;
		const action = defaultDraftAction;
		if (action === undefined) return playCopy.defaults.notCurrent;
		if (validShellBindings(buffer).some((binding) => binding.semanticContext !== undefined)) return undefined;
		const parts: string[] = [];
		if (activeDefaultTarget !== undefined) {
			const name = targets.find((candidate) => candidate.value.targetRef === activeDefaultTarget)?.label;
			parts.push(`@${JSON.stringify(playerTargetName(name, activeDefaultTarget))}`);
		}
		for (const [name, value] of Object.entries(activeDefaultInputs).sort(([left], [right]) => left.localeCompare(right))) {
			parts.push(formatDefaultField(name, value));
		}
		return parts.length === 0 ? playCopy.defaults.suppressed : playCopy.defaults.summary(parts);
	});
	const submitting = $derived(busy && outcome === null);
	/** `needs: "write"` marks a blocker that asks for written words. Nothing is
	 * left to pick there, so the key legend must not point at Tab. */
	type AttemptBlock = { message: string; invalid: boolean; needs?: "write" };
	const attemptBlock = $derived.by((): AttemptBlock | undefined => {
		if (stalePrompt) return { message: playCopy.attemptBlock.promptChanged, invalid: true };
		if (promptTargetConflict) return { message: playCopy.attemptBlock.otherSpeaker, invalid: true };
		if (routeProblem?.kind === "extra") return { message: playCopy.attemptBlock.routeExtra(routeProblem.route, routeProblem.extra), invalid: true, needs: "write" };
		if (staleRoute) return { message: playCopy.attemptBlock.routeGone, invalid: true };
		if (defaultDraftStale) return { message: playCopy.attemptBlock.suggestionChanged, invalid: true };
		const tokens = parseShellBuffer(buffer.text);
		const unresolved = unresolvedTokenRanges[0];
		if (unresolved !== undefined) {
			const token = tokens.find((candidate) => candidate.start === unresolved.start && candidate.end === unresolved.end);
			if (token?.kind === "action") return { message: playCopy.attemptBlock.unknownAction, invalid: true };
			return { message: playCopy.attemptBlock.unknownTarget, invalid: true };
		}
		const looseWords = tokens.filter((token) => token.kind === "unknown").map((token) => token.text).join(" ");
		// Words are sent only inside quotes. Play never quotes them itself.
		if (takesWords) {
			// Only one quoted part is sent. Echoing the loose words beside an
			// existing one would teach a second pair, which drops the first.
			const quoted = tokens.filter((token) => token.kind === "payload").length;
			if (quoted > 1 || (quoted === 1 && looseWords !== "")) return { message: playCopy.attemptBlock.oneQuote, invalid: false, needs: "write" };
			if (looseWords !== "") return { message: playCopy.attemptBlock.quoteWords(looseWords), invalid: false, needs: "write" };
		}
		if (directRoute !== null) return undefined;
		const bindings = validShellBindings(buffer);
		const actionToken = tokens.find((token) => token.kind === "action" && !bindings.some((binding) => binding.start === token.start && binding.end === token.end));
		// A bare trigger character is not a token the player wrote: the line
		// asks for the pick itself and never says that "/" is not picked yet
		// (owner ruling 2026-11-12, E6a). It still blocks the send.
		const chooseActionBlock: AttemptBlock = { message: helpPrompt === undefined ? playCopy.attemptBlock.chooseAction : playCopy.attemptBlock.chooseAnswer, invalid: false };
		if (actionToken !== undefined) return actionToken.text.length <= 1 ? chooseActionBlock : { message: playCopy.attemptBlock.pickAction(actionToken.text), invalid: false };
		if (draft.actionId === null) return chooseActionBlock;
		const targetToken = tokens.find((token) => (token.kind === "actor" || token.kind === "world_ref") && !bindings.some((binding) => binding.start === token.start && binding.end === token.end));
		const bareTarget = targetToken !== undefined && targetToken.text.length <= 1;
		if (targetToken !== undefined && !bareTarget) return { message: playCopy.attemptBlock.pickTarget(targetToken.text), invalid: false };
		if (draft.targetRef === null || bareTarget) {
			const actionLabel = actions.find((action) => action.value.actionId === draft.actionId)?.label;
			return { message: playCopy.attemptBlock.chooseTarget(actionLabel), invalid: false };
		}
		if (formFields.length > 0) {
			const values = detailsFromBuffer(buffer.text).inputValues;
			const missing = formFields.find((field) => field.required === true && String(values[field.name] ?? "").trim() === "");
			if (looseWords !== "") {
				// A bare word is most likely text: prefer a missing detail, then one
				// that takes text. A number detail echoes the word only if it is one.
				const field = missing ?? formFields.find((candidate) => candidate.control !== "number") ?? formFields[0];
				if (field !== undefined) {
					const fits = !looseWords.includes('"') && (field.control !== "number" || Number.isFinite(Number(looseWords)));
					return { message: playCopy.attemptBlock.strayForField(looseWords, field.label, fieldSpelling(field, fits ? looseWords : "…")), invalid: false, needs: "write" };
				}
			}
			// The session repeats this check as the backstop for other callers.
			if (missing !== undefined) return { message: playCopy.attemptBlock.fieldMissing(missing.label, fieldSpelling(missing, "…")), invalid: false, needs: "write" };
		}
		return undefined;
	});
	/** The legend never names a key that does nothing. Inside a value Tab is
	 * the browser's own Tab; while the sentence is also blocked Enter sends
	 * nothing, so no key is named and the blocker speaks alone (owner ruling
	 * 2026-11-13). */
	const legend = $derived(
		caretInValue
			? (attemptBlock === undefined ? "value" : "none")
			: attemptBlock === undefined ? "ready" : attemptBlock.needs === "write" ? "write" : "unpicked",
	);
	function syncExecutableDraft(): void {
		const bindings = validShellBindings(buffer);
		const action = bindings.findLast((binding) =>
			binding.kind === "action" &&
			actions.some((candidate) => candidate.value.actionId === binding.canonical),
		);
		const target = bindings.findLast((binding) =>
			(binding.kind === "actor" || binding.kind === "world_ref") && targets.some((candidate) => candidate.value.targetRef === binding.canonical),
		);
		const targetConflictsWithPrompt =
			action?.semanticContext !== undefined &&
			target !== undefined &&
			target.canonical !== action.semanticContext.source_ref;
		if (action?.semanticContext !== undefined || defaultDraft?.actionId !== action?.canonical) {
			defaultDraft = undefined;
		}
		const ordinaryDefaultTarget =
			action?.semanticContext === undefined && defaultDraft?.actionId === action?.canonical
				? activeDefaultTarget
				: undefined;
		onExecutableChange({
			// A prompt occurrence authorises only its recorded source. Keep the raw
			// sentence repairable, but never manufacture a cross-speaker attempt.
			actionId: targetConflictsWithPrompt ? null : (action?.canonical ?? null),
			// A selected prompt response already names its speaker through the
			// occurrence contract. Reuse that authorised source as the target
			// rather than forcing the player to reconstruct @Aldwin in the shell.
			// An explicit completed target remains the player's visible override.
			targetRef: target?.canonical ?? action?.semanticContext?.source_ref ?? ordinaryDefaultTarget ?? null,
			...(targetConflictsWithPrompt || action?.semanticContext === undefined
				? {}
				: { semanticContext: action.semanticContext }),
		});
	}
	function replaceOrAppendTarget(candidate: ShellFinderCandidate): void {
		const previous = validShellBindings(buffer).findLast(
			(binding) => binding.kind === "actor" || binding.kind === "world_ref",
		);
		const range = previous === undefined
			? { start: buffer.text.length, end: buffer.text.length }
			: { start: previous.start, end: previous.end };
		const prefix = previous === undefined && buffer.text !== "" && !/\s$/.test(buffer.text) ? " " : "";
		if (prefix !== "") buffer = reconcileShellText(buffer, `${buffer.text}${prefix}`);
		const adjusted = previous === undefined
			? { start: buffer.text.length, end: buffer.text.length }
			: range;
		buffer = bindShellCandidate(buffer, adjusted, candidate);
		if (defaultDraft !== undefined) defaultDraft = suppressDefaultTarget(defaultDraft);
		syncExecutableDraft();
	}
	function noteExplicitDefaultEdits(): void {
		const bindings = validShellBindings(buffer);
		const action = bindings.findLast((binding) => binding.kind === "action");
		if (defaultDraft === undefined || action?.canonical !== defaultDraft.actionId) return;
		if (bindings.some((binding) => binding.kind === "actor" || binding.kind === "world_ref")) {
			defaultDraft = suppressDefaultTarget(defaultDraft);
		}
		const fieldNames = new Set(
			parseShellBuffer(buffer.text)
				.filter((token) => token.kind === "field")
				.map((token) => token.text.slice(0, token.text.indexOf(":"))),
		);
		defaultDraft = suppressDefaultInputs(defaultDraft, fieldNames);
	}
	$effect(() => {
		if (appliedClearToken === null) {
			appliedClearToken = clearToken;
			return;
		}
		if (clearToken === appliedClearToken) return;
		appliedClearToken = clearToken;
		buffer = emptyShellBuffer();
		defaultDraft = undefined;
		directRoute = null;
		finderSnapshot = freezeShellFinder(revision, candidates);
	});

	function openFinder(): void {
		finderSnapshot = freezeShellFinder(revision, candidates);
		finderOpen = true;
	}

	function refreshFinder(): void {
		finderSnapshot = freezeShellFinder(revision, candidates);
		finderRefreshToken += 1;
	}

	function detailsFromBuffer(text: string): Pick<ComposerDraftState, "inputValues" | "utterance"> {
		const action = shellAction ?? selectedAction;
		const fields = action?.input?.fields ?? [];
		const inputValues: Record<string, string | number | boolean> = { ...activeDefaultInputs };
		let utterance = "";
		for (const token of parseShellBuffer(text)) {
			if (token.kind === "payload") utterance = shellQuotedValue(token.text);
			if (token.kind !== "field") continue;
			const split = token.text.indexOf(":");
			const name = token.text.slice(0, split);
			const field = fields.find((candidate) => candidate.name === name);
			if (field === undefined) continue;
			const raw = shellQuotedValue(token.text.slice(split + 1));
			inputValues[name] = field.control === "number" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
		}
		return { inputValues, utterance };
	}

	function choose(candidate: ShellFinderCandidate, offer = true): void {
		if (candidate.source === "fields") {
			// Plain text, no world identity: nothing is chosen or sent.
			const range = completionRange;
			buffer = applyShellEdit(buffer, { range, text: candidate.text });
			const end = range.start + candidate.text.length;
			const caret = candidate.text.endsWith('"') ? end - 1 : end;
			selection = { start: caret, end: caret };
			noteExplicitDefaultEdits();
			syncExecutableDraft();
			onChangeDetails(detailsFromBuffer(buffer.text));
			requestFocus(caret);
			return;
		}
		buffer = bindShellCandidate(buffer, completionRange, candidate);
		selection = { start: completionRange.start + candidate.text.length, end: completionRange.start + candidate.text.length };
		/* Completing an occurrence-bound reply must make its source legible in
		 * the sentence whenever that disclosed target is still available. This is
		 * an explicit completion insertion, not a hidden default: a player can
		 * edit or replace it, which then makes the reply non-executable. */
		if (candidate.source === "prompts" && candidate.semanticContext !== undefined) {
			const hasTarget = validShellBindings(buffer).some(
				(binding) => binding.kind === "actor" || binding.kind === "world_ref",
			);
			const sourceTarget = candidates.find(
				(entry) => entry.source === "targets" && entry.canonical === candidate.semanticContext?.source_ref,
			);
			if (!hasTarget && sourceTarget !== undefined) {
				replaceOrAppendTarget(sourceTarget);
				selection = { start: buffer.text.length, end: buffer.text.length };
			}
		}
		if (candidate.source === "sensing") {
			directRoute = { kind: "sense", actionId: candidate.canonical, canonical: candidate.canonical, text: candidate.text };
			syncExecutableDraft();
			return;
		}
		if (candidate.source === "movement") {
			directRoute = { kind: "move", exitHandle: candidate.canonical, canonical: candidate.canonical, text: candidate.text };
			syncExecutableDraft();
			return;
		}
		if (candidate.source === "turn") {
			directRoute = { kind: "end-turn", canonical: candidate.canonical, text: candidate.text };
			syncExecutableDraft();
			return;
		}
		// A name completed beside a route leaves the route armed, so the help
		// line can say that the route takes nothing else. Any other pick, and a
		// name that replaced the route's own word, ends the route.
		const route = directRoute;
		const routeWordStands = route !== null && validShellBindings(buffer).some(
			(binding) => binding.kind === "action" && binding.canonical === route.canonical && binding.text === route.text,
		);
		if (candidate.source !== "targets" || !routeWordStands) directRoute = null;
		if (candidate.source === "actions") {
			const action = actions.find((entry) => entry.value.actionId === candidate.canonical)?.value;
			const hasExplicitTarget = validShellBindings(buffer).some(
				(binding) => binding.kind === "actor" || binding.kind === "world_ref",
			);
			defaultDraft = beginDefaultDraft(action, { explicitTarget: hasExplicitTarget });
		}
		if (candidate.source === "targets") onChooseTarget(candidate.canonical);
		else if (candidate.source === "prompts") {
			const occurrenceId = candidate.semanticContext?.occurrence_id;
			if (occurrenceId !== undefined) onChoosePrompt(occurrenceId);
			onChooseAction(candidate.canonical);
		} else onChooseAction(candidate.canonical);
		syncExecutableDraft();
		if (offer) offerNextPiece();
		onChangeDetails(detailsFromBuffer(buffer.text));
	}
	/** An outside insertion replaces only what Play itself put there: nothing,
	 * one way out (still open or gone since) with or without names a click put
	 * beside it, names a click put there, or a picked sentence whose appended
	 * template is still empty. Typed words are never destroyed. */
	function replaceable(): boolean {
		const tokens = parseShellBuffer(buffer.text);
		if (tokens.length === 0) return true;
		const bindings = validShellBindings(buffer);
		const picked = (token: ShellSpan, targetsOnly: boolean) => bindings.some((binding) =>
			(!targetsOnly || binding.kind === "actor" || binding.kind === "world_ref") && binding.start === token.start && binding.end === token.end,
		);
		// A go sentence stays replaceable after its way out has gone, and with
		// picked names beside it: the player typed none of it as words.
		// Only the route's own word counts, so a second picked action is kept.
		const route = directRoute;
		if (route?.kind === "move") {
			const own = (token: ShellSpan) => bindings.some((binding) =>
				binding.kind === "action" && binding.canonical === route.canonical && binding.start === token.start && binding.end === token.end,
			);
			if (tokens.filter(own).length === 1 && tokens.every((token) => own(token) || picked(token, true))) return true;
		}
		if (tokens.every((token) => picked(token, true))) return true;
		const emptyTemplate = (token: (typeof tokens)[number]) =>
			(token.kind === "payload" && token.text === '""') || (token.kind === "field" && /:(?:"")?$/.test(token.text));
		return tokens.some(emptyTemplate) && tokens.every((token) => emptyTemplate(token) || picked(token, false));
	}
	$effect(() => {
		const request = insertion;
		if (!request || request.token === appliedInsertion) return;
		appliedInsertion = request.token;
		untrack(() => {
			const action = [...allActionCandidates, ...candidates].find(entry => request.exitHandle !== undefined
				? entry.source === "movement" && entry.canonical === request.exitHandle
				: (entry.source === "actions" || entry.source === "sensing") && entry.canonical === request.actionId);
			const target = request.targetRef === undefined ? undefined : candidates.find(entry => entry.source === "targets" && entry.canonical === request.targetRef);
			if (!action || (request.targetRef !== undefined && !target)) return;
			if (!replaceable()) {
				const exit = request.exitHandle === undefined ? undefined : exits.find(entry => entry.handle === request.exitHandle);
				keptDraftNote = { text: buffer.text, choice: exit === undefined ? action.label : (exit.toName || exit.label) };
				requestFocus();
				onInsertionKept(request.exitHandle ?? null);
				return;
			}
			keptDraftNote = null;
			buffer = emptyShellBuffer();
			defaultDraft = undefined;
			directRoute = null;
			selection = { start: 0, end: 0 };
			choose(action, false);
			if (target) replaceOrAppendTarget(target);
			selection = { start: buffer.text.length, end: buffer.text.length };
			syncExecutableDraft();
			requestFocus();
			offerNextPiece();
			onChangeDetails(detailsFromBuffer(buffer.text));
		});
	});

	$effect(() => {
		const targetRef = prefillTargetRef;
		if (targetRef === null) { appliedPrefillTarget = null; return; }
		if (targetRef === appliedPrefillTarget) return;
		appliedPrefillTarget = targetRef;
		// A route sentence (a way out, a look, the end of the turn) takes no
		// name. While one stands in the box a name or map click only selects
		// (owner ruling 2026-11-13). The skipped name is not added later either.
		// Only an armed route swallows the name: one the world has withdrawn
		// (its way out or sense is gone) is no route sentence any more.
		if (untrack(() => directRoute !== null && routeProblem?.kind !== "gone")) return;
		const candidate = candidates.find(entry => entry.source === "targets" && entry.canonical === targetRef);
		if (!candidate) return;
		replaceOrAppendTarget(candidate);
		// The browser puts the caret at the end of a value it did not type. The
		// recorded caret must follow: left at its old place it kept the grey
		// suggestion of the word before the new name, so `/` plus a grey
		// `go-stairs` read as a finished `/go-stairs #"Cellar"`.
		selection = { start: buffer.text.length, end: buffer.text.length };
	});

	function attempt(): void {
		// The note has been read once Enter is pressed. It must not hide the
		// outcome of this attempt.
		keptDraftNote = null;
		if (staleRoute) return;
		if (directRoute?.kind === "sense") onAttemptSense?.(directRoute.actionId);
		else if (directRoute?.kind === "move") onAttemptMove?.(directRoute.exitHandle);
		else if (directRoute?.kind === "end-turn") onAttemptEndTurn?.();
		else onAttempt();
	}
</script>

<ShellComposer
	{focusToken}
	{focusCaret}
	{emptyQuoteHints}
	notice={keptDraftNote !== null && keptDraftNote.text === buffer.text ? playCopy.composer.draftKept(keptDraftNote.choice) : undefined}
	{buffer}
	{keymap}
	summary={defaultSummary ?? nextStepHint}
	{statusMessage}
	promptMessage={helpPrompt === undefined ? undefined : playCopy.prompt.from(helpPrompt.sourceName, helpPrompt.presentation?.question ?? playCopy.prompt.answerFallback)}
	{activeToken}
	{completionRange}
	candidates={results.map(({ candidate }) => candidate.prompt === undefined ? candidate : { ...candidate, preview: candidates.find(current => current.id === candidate.id)?.preview })}
	{unresolvedTokenRanges}
	{attemptBlock}
	{legend}
	onAttemptBlocked={() => { keptDraftNote = null; }}
	{outcome}
	{submitting}
	refreshAvailable={finderRefreshAvailable}
	refreshToken={finderRefreshToken}
	disabled={busy || suspended}
	attemptDisabled={attemptBlock !== undefined}
	{promptTargetConflict}
	onTextChange={(text) => {
		buffer = reconcileShellText(buffer, text);
		selection = { start: text.length, end: text.length };
		// Only a route whose own word is gone is dropped. One with an extra
		// name beside it stays armed, so removing the name makes it sendable.
		if (directRoute !== null && routeProblem?.kind === "gone") directRoute = null;
		noteExplicitDefaultEdits();
		syncExecutableDraft();
		onChangeDetails(detailsFromBuffer(text));
	}}
	onSelectionChange={(nextSelection) => {
		selection = nextSelection;
	}}
	onFinderOpen={openFinder}
	onFinderClose={() => { finderOpen = false; }}
	onRefreshFinder={refreshFinder}
	onChoose={choose}
	onAttempt={attempt}
/>
