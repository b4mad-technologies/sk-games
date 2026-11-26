<script lang="ts">
	import { Button, DockHelpLine } from "@spellkave/ui";
	import { BrowseRow } from "@spellkave/ui-widgets";
	import { tick, untrack } from "svelte";
	import { DEFAULT_KEYMAP, type Keymap, keyLabelFor, shellCommandForKey } from "../lib/keymap";
	import { playCopy } from "../lib/player-copy";
	import {
	parseShellBuffer,
	type ShellBinding,
	type ShellBuffer,
		type ShellToken,
		shellRangeInValue,
		validShellBindings,
	} from "../lib/shell-buffer";
	import type { ShellFinderCandidate } from "../lib/shell-finder";

	let {
		buffer,
		candidates = [],
		activeToken = buffer.text.slice(buffer.text.lastIndexOf(" ") + 1),
		completionRange = { start: buffer.text.length, end: buffer.text.length },
		refreshAvailable = false,
		refreshToken = 0,
		promptTargetConflict = false,
		unresolvedTokenRanges = [],
		attemptBlock,
		summary,
		promptMessage,
		statusMessage,
		outcome = null,
		submitting = false,
		disabled = false,
		attemptDisabled = false,
		keymap = DEFAULT_KEYMAP,
		focusToken = 0,
		focusCaret,
		emptyQuoteHints = [],
		notice,
		legend,
		onAttemptBlocked = () => {},
		label = playCopy.composer.label,
		onTextChange,
		onSelectionChange = () => {},
		onFinderOpen = () => {},
		onFinderClose = () => {},
		onRefreshFinder = () => {},
		onChoose,
		onAttempt,
	}: {
		buffer: ShellBuffer;
		candidates?: readonly ShellFinderCandidate[];
		/** The token currently being completed. The finder owner supplies this
		 * when its grammar spans several sentence parts. */
		activeToken?: string;
		/** The raw-buffer span receiving a finder insertion. */
		completionRange?: { start: number; end: number };
		/** A newer factual snapshot exists. It is never substituted silently. */
		refreshAvailable?: boolean;
		/** Changes only after the player explicitly refreshes the finder. */
		refreshToken?: number;
		/** The owner detected that a prompt-bound response names another target. */
		promptTargetConflict?: boolean;
		/** Token spans the owner could not resolve against its frozen observed facts.
		 * The shell only renders this state; it never invents an identity from text. */
		unresolvedTokenRanges?: readonly { start: number; end: number }[];
		/** One owner-derived explanation for the disabled Attempt control. */
		attemptBlock?: { message: string; invalid: boolean };
		/** Compact provenance-aware context owned by the fact composer. */
		summary?: string;
		promptMessage?: string;
		statusMessage?: { text: string; tone: "stale" | "error" };
		/** An owner-observed transport/admission status. This is deliberately
		 * not a consequence narration. `blocked` means Play stopped the attempt
		 * before sending it, so no receipt is pending. */
		outcome?: { text: string; kind: "accepted" | "rejected" | "unobserved" | "blocked" } | null;
		submitting?: boolean;
		disabled?: boolean;
		attemptDisabled?: boolean;
		keymap?: Keymap;
		focusToken?: number;
		/** Where the caret lands on the next focus request. Default: the end. */
		focusCaret?: number;
		/** Grey text drawn between an empty pair of quotes. `start` is the index
		 * of the closing quote. Drawing only: the input text is not changed. The
		 * mirror shifts every later character by the hint's width while the real
		 * caret stays put, so the owner passes a hint only while the collapsed
		 * caret sits at its `start`. */
		emptyQuoteHints?: readonly { start: number; text: string }[];
		/** One owner sentence that outranks hints and blockers, e.g. "your words
		 * were kept". The owner clears it, at the latest on the next attempt
		 * (`onAttempt` / `onAttemptBlocked`), so it never hides a blocker or an
		 * outcome the player asked for. */
		notice?: string;
		/** Which key legend the closed list shows. The owner knows whether the
		 * blocker asks to pick something (`unpicked`), asks for written words
		 * (`write`), or whether the caret sits inside a value (`value`, where no
		 * completion key is advertised; `none` when the sentence is blocked there
		 * as well, so no key is named at all). Default: `unpicked` while something
		 * blocks, else `ready`. Display only; it never changes a key. */
		legend?: "unpicked" | "ready" | "value" | "write" | "none";
		/** Enter was pressed while Attempt is blocked. Nothing was sent. */
		onAttemptBlocked?: () => void;
		label?: string;
		onTextChange: (text: string) => void;
		onSelectionChange?: (selection: { start: number; end: number }) => void;
		onFinderOpen?: () => void;
		onFinderClose?: () => void;
		onRefreshFinder?: () => void;
		onChoose: (candidate: ShellFinderCandidate) => void;
		onAttempt: () => void;
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let appliedFocusToken = 0;
	$effect(() => {
		if (focusToken === appliedFocusToken) return;
		appliedFocusToken = focusToken;
		menuOpen = false;
		// Every place that closes the list reports it. An owner that froze its
		// suggestions for the open list would otherwise keep them frozen.
		untrack(() => onFinderClose());
		void tick().then(() => {
			if (input === null) return;
			const caret = Math.max(0, Math.min(focusCaret ?? buffer.text.length, buffer.text.length));
			input.focus();
			input.setSelectionRange(caret, caret);
			reportSelection(input);
		});
	});

	// A disabled input drops focus to the page body, and the browser does not
	// give it back. When the attempt settles and nothing else took focus,
	// return it, so words typed right after a refusal are not lost.
	let wasDisabled = false;
	$effect(() => {
		if (disabled) {
			wasDisabled = true;
			return;
		}
		if (!wasDisabled) return;
		wasDisabled = false;
		void tick().then(() => {
			const active = document.activeElement;
			if (active === null || active === document.body) input?.focus();
		});
	});

	let mirrorElement = $state<HTMLDivElement | null>(null);
	let resultsElement = $state<HTMLDivElement | null>(null);
	let activeCandidateId = $state<string | null>(null);
	let activeCandidateLabel = $state<string | null>(null);
	let appliedRefreshToken = $state<number | null>(null);
	let refreshAnnouncement = $state("");
	let menuOpen = $state(false);
	let escapeTab = $state(false);
	const inputId = "play-shell-input";
	const listId = "play-shell-results";
	const helpId = "play-shell-grammar";
	const statusId = "play-shell-status";
	/** Arrow keys read better as arrows in the one-line legend. Display only. */
	const KEY_GLYPHS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
	const finderNavigationHint = $derived(
		[keyLabelFor(keymap, "shell.prev"), keyLabelFor(keymap, "shell.next")].filter(
			(key): key is string => key !== null,
		).map((key) => KEY_GLYPHS[key] ?? key).join("/") || "No browse shortcut",
	);
	const acceptHint = $derived(keyLabelFor(keymap, "shell.accept") ?? "No insert shortcut");
	const attemptHint = $derived(keyLabelFor(keymap, "shell.attempt") ?? "No attempt shortcut");
	// The legend describes keys; it never changes them. It follows the state:
	// list open, something still to pick, or nothing in the way.
	const keyLegend = $derived.by(() => {
		if (isOpen) return playCopy.composer.keys.open(finderNavigationHint, acceptHint);
		const state = legend ?? (attemptBlock !== undefined ? "unpicked" : "ready");
		if (state === "none") return "";
		if (state === "value") return playCopy.composer.keys.value(attemptHint);
		if (state === "write") return playCopy.composer.keys.write(finderNavigationHint, ghostText === "" ? undefined : "→");
		return state === "unpicked"
			? playCopy.composer.keys.unpicked("Tab", "→", finderNavigationHint)
			: playCopy.composer.keys.ready(attemptHint);
	});
	// A non-accepted outcome keeps the player's words and names its state in
	// player terms (PRD play-interaction-shell, "Attempt and outcomes").
	// The last outcome describes the sentence that was sent. Once the player
	// edits the box it would hide the hints for the next sentence, so an edit
	// dismisses it; the next attempt shows the next outcome again.
	let dismissedOutcome = $state<string | null>(null);
	const outcomeKey = $derived(outcome === null ? null : `${outcome.kind}:${outcome.text}`);
	// Text placed in the box from outside (a way-out click, a picked row) is
	// the next sentence too. Clearing the box after a send is not.
	let lastBufferText: string | null = null;
	$effect(() => {
		const text = buffer.text;
		if (lastBufferText === null) {
			lastBufferText = text;
			return;
		}
		if (text === lastBufferText) return;
		lastBufferText = text;
		if (text !== "") dismissedOutcome = untrack(() => outcomeKey);
	});
	const liveOutcome = $derived(outcome !== null && outcomeKey !== dismissedOutcome ? outcome : null);
	const outcomeMessage = $derived(liveOutcome === null ? undefined : liveOutcome.kind === "accepted" ? liveOutcome.text : `${liveOutcome.text} ${playCopy.outcome[liveOutcome.kind]}`);
	let blockedAttemptText = $state<string | null>(null);
	const blockedAttemptMessage = $derived(blockedAttemptText === buffer.text ? attemptBlock?.message : undefined);
	const helpMessage = $derived(statusMessage?.text ?? (submitting ? playCopy.composer.submitting : notice ?? blockedAttemptMessage ?? outcomeMessage ?? (attemptBlock?.invalid ? attemptBlock.message : undefined) ?? summary ?? promptMessage ?? attemptBlock?.message ?? playCopy.composer.idleHint));
	const helpTone = $derived(statusMessage?.tone ?? (!submitting && notice !== undefined ? "muted" : blockedAttemptMessage !== undefined ? (attemptBlock?.invalid ? "error" : "muted") : liveOutcome !== null ? (liveOutcome.kind === "rejected" || liveOutcome.kind === "blocked" ? "error" : liveOutcome.kind === "unobserved" ? "stale" : "muted") : attemptBlock?.invalid ? "error" : "muted"));
	// The completion range lies in a value the player writes (quoted words or
	// a detail). A completion replaces its whole range, so none is offered
	// there: no list, no grey text, and Tab keeps its native meaning (it moves
	// focus on, as it does when nothing matches).
	const inValue = $derived(shellRangeInValue(buffer.text, completionRange));
	const isOpen = $derived(menuOpen && !inValue && candidates.length > 0);
	/* Preview body: the candidate's own text, or nothing. A candidate without
	 * prose gets no filler sentence; only an empty list explains itself. */
	const previewBody = $derived.by(() => {
		if (activeCandidate === undefined) return playCopy.finder.emptyPreview;
		if (activeCandidate.prompt !== undefined && activeCandidate.preview === undefined) return undefined;
		return activeCandidate.preview ?? activeCandidate.detail;
	});
	const activeCandidate = $derived(
		(activeCandidateId === null ? undefined : candidates.find((candidate) => candidate.id === activeCandidateId)) ??
			candidates[0],
	);
	const activeIndex = $derived(Math.max(0, candidates.findIndex((candidate) => candidate.id === activeCandidate?.id)));
	const activeOptionId = $derived(activeCandidate === undefined ? undefined : `play-shell-option-${activeCandidate.id}`);
	const boundRanges = $derived(validShellBindings(buffer));
	const ghostCandidate = $derived.by(() => {
		if (inValue) return undefined;
		// After whitespace there is no typed prefix to show a ghost against. Only
		// a detail field of the chosen action is ghosted there, and only at the
		// end of the text, where the mirror can draw it. An invisible ghost is
		// never accepted.
		if (buffer.text !== "" && activeToken === "") {
			return completionRange.start === buffer.text.length && activeCandidate?.source === "fields" ? activeCandidate : undefined;
		}
		if (buffer.text !== "") return activeCandidate;
		if (isOpen) return activeCandidate?.source === "prompts" ? activeCandidate : undefined;
		return candidates.find(candidate => candidate.source === "prompts");
	});
	const ghostText = $derived.by(() => {
		const candidate = ghostCandidate;
		if (candidate === undefined || !candidate.text.toLocaleLowerCase().startsWith(activeToken.toLocaleLowerCase())) return "";
		return candidate.text.slice(activeToken.length);
	});
	const mirror = $derived.by(() => {
		const pieces: Array<{ text: string; role: string }> = [];
		let cursor = 0;
		for (const token of parseShellBuffer(buffer.text)) {
			if (cursor < token.start) pieces.push({ text: buffer.text.slice(cursor, token.start), role: "plain" });
			const role = tokenRole(token, boundRanges);
			const hint = emptyQuoteHints.find((entry) => entry.start > token.start && entry.start < token.end);
			if (hint === undefined) pieces.push({ text: token.text, role });
			else {
				const split = hint.start - token.start;
				pieces.push({ text: token.text.slice(0, split), role }, { text: hint.text, role: "suggestion" }, { text: token.text.slice(split), role });
			}
			if (token.start === completionRange.start && token.end === completionRange.end && ghostText !== "") {
				pieces.push({ text: ghostText, role: "suggestion" });
			}
			cursor = token.end;
		}
		if (cursor < buffer.text.length) {
			pieces.push({ text: buffer.text.slice(cursor), role: "plain" });
			cursor = buffer.text.length;
		}
		if (cursor === completionRange.end && ghostText !== "" && completionRange.start === completionRange.end) {
			pieces.push({ text: ghostText, role: "suggestion" });
		}
		return pieces;
	});
	$effect(() => {
		if (activeCandidateId !== null || activeCandidate === undefined) return;
		activeCandidateId = activeCandidate.id;
		activeCandidateLabel = activeCandidate.label;
	});
	/* DOM scrolling is an external effect: after a keyboard move has changed
	 * aria-selected, keep that actual option inside the finder viewport. The
	 * player still owns focus in the shell input; result buttons never steal it. */
	$effect(() => {
		const results = resultsElement;
		if (results === null || activeCandidateId === null) return;
		const active = results.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
		// jsdom has no scrollIntoView; real browser elements do. Keeping the
		// capability guard makes the presentation effect testable without a
		// geometry shim.
		if (typeof active?.scrollIntoView === "function") {
			active.scrollIntoView({ block: "nearest", inline: "nearest" });
		}
	});
	$effect(() => {
		if (appliedRefreshToken === null) {
			appliedRefreshToken = refreshToken;
			return;
		}
		if (refreshToken === appliedRefreshToken) return;
		appliedRefreshToken = refreshToken;
		const previousLabel = activeCandidateLabel ?? playCopy.finder.previousSelection;
		const retained = activeCandidateId === null ? undefined : candidates.find((candidate) => candidate.id === activeCandidateId);
		if (retained !== undefined) {
			activeCandidateLabel = retained.label;
			refreshAnnouncement = playCopy.finder.refreshedKept(retained.label);
			return;
		}
		const replacement = candidates[0];
		activeCandidateId = replacement?.id ?? null;
		activeCandidateLabel = replacement?.label ?? null;
		refreshAnnouncement = replacement === undefined
			? playCopy.finder.refreshedGone(previousLabel)
			: playCopy.finder.refreshedReplaced(previousLabel, replacement.label);
	});

	function tokenRole(token: ShellToken, bindings: readonly ShellBinding[]): string {
		const binding = bindings.find((candidate) => candidate.start === token.start && candidate.end === token.end);
		if (binding !== undefined) return binding.semanticContext === undefined ? `bound-${binding.kind}` : "prompt";
		if (unresolvedTokenRanges.some((range) => range.start === token.start && range.end === token.end)) return "error";
		// A sigil says what the player is trying to name, not that the name is a
		// current fact. The owner resolves each token against its frozen
		// observation; ordinary incomplete syntax remains quiet even if the caret
		// has already moved to another sentence part.
		if (token.kind === "action") return "syntax-action";
		if (token.kind === "actor") return "syntax-actor";
		if (token.kind === "world_ref") return "syntax-world-ref";
		if (token.kind === "field") return "field";
		if (token.kind === "payload") return "payload";
		if (token.kind === "reaction") return "reaction";
		if (token.kind === "participant") return "participant";
		if (token.kind === "unknown") return "muted";
		return "plain";
	}

	async function choose(candidate: ShellFinderCandidate | undefined): Promise<void> {
		if (candidate === undefined || disabled || inValue) return;
		onChoose(candidate);
		menuOpen = false;
		onFinderClose();
		await tick();
		input?.focus();
	}

	function move(step: number): void {
		if (!isOpen || candidates.length === 0) return;
		const nextIndex = Math.max(0, Math.min(activeIndex + step, candidates.length - 1));
		const next = candidates[nextIndex];
		activeCandidateId = next?.id ?? null;
		activeCandidateLabel = next?.label ?? null;
	}

	function onInput(event: Event): void {
		escapeTab = false;
		const target = event.currentTarget as HTMLInputElement;
		activeCandidateId = null;
		activeCandidateLabel = null;
		dismissedOutcome = outcomeKey;
		onTextChange(target.value);
		reportSelection(target);
		syncHorizontalScroll(target);
	}

	function reportSelection(target: HTMLInputElement): void {
		onSelectionChange({
			start: target.selectionStart ?? target.value.length,
			end: target.selectionEnd ?? target.value.length,
		});
	}

	function syncHorizontalScroll(target: HTMLInputElement): void {
		if (mirrorElement !== null) mirrorElement.scrollLeft = target.scrollLeft;
	}

	function onSelectionEvent(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		reportSelection(target);
		syncHorizontalScroll(target);
	}

	function refreshFinder(): void {
		if (!refreshAvailable || disabled) return;
		onRefreshFinder();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.isComposing || disabled) return;
		const command = shellCommandForKey(keymap, event, isOpen ? "finder" : "input");
		const unmodified = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
		if (unmodified && event.key === "Tab") {
			if (inValue) {
				// Written words are never replaced. Tab picks nothing here and
				// stays native, exactly as with no candidates.
				escapeTab = false;
				return;
			}
			if (escapeTab && !isOpen) {
				escapeTab = false;
				return;
			}
			if (candidates.length === 0) return;
			event.preventDefault();
			if (isOpen || (buffer.text !== "" && candidates.length === 1)) {
				void choose(activeCandidate);
			} else {
				onFinderOpen();
				if (activeToken !== "") {
					let prefix = candidates[0]?.text ?? "";
					for (const candidate of candidates) {
						while (prefix && !candidate.text.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
							prefix = prefix.slice(0, -1);
						}
					}
					if (prefix.length > activeToken.length && prefix.toLocaleLowerCase().startsWith(activeToken.toLocaleLowerCase())) {
						onTextChange(buffer.text.slice(0, completionRange.start) + prefix + buffer.text.slice(completionRange.end));
						onSelectionChange({ start: completionRange.start + prefix.length, end: completionRange.start + prefix.length });
					}
				}
				menuOpen = true;
			}
			return;
		}
		if ((command === "shell.next" || command === "shell.prev") && inValue) return;
		if ((command === "shell.next" || command === "shell.prev") && !isOpen && candidates.length > 0) {
			event.preventDefault();
			onFinderOpen();
			menuOpen = true;
			return;
		}
		if (command === "shell.next") {
			event.preventDefault();
			move(1);
			return;
		}
		if (command === "shell.prev") {
			event.preventDefault();
			move(-1);
			return;
		}
		if (command === "shell.accept" && isOpen) {
			event.preventDefault();
			void choose(activeCandidate);
			return;
		}
		// Right accepts an inline ghost only at the end of a collapsed active
		// token. Everywhere else it remains native caret movement.
		if (
			event.key === "ArrowRight" &&
			!event.shiftKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			activeCandidate !== undefined &&
			ghostText !== "" &&
			input?.selectionStart === completionRange.end &&
			input?.selectionEnd === completionRange.end
		) {
			event.preventDefault();
			void choose(ghostCandidate);
			return;
		}
		if (command === "shell.attempt") {
			event.preventDefault();
			if (attemptDisabled) {
				blockedAttemptText = buffer.text;
				onAttemptBlocked();
			} else {
				dismissedOutcome = null;
				onAttempt();
			}
			return;
		}
		if (event.key === "Escape" && isOpen) {
			event.preventDefault();
			menuOpen = false;
			onFinderClose();
			escapeTab = true;
		}
	}
</script>

<section class="shell-composer" aria-label={label}>
	<div class="shell-composer__overlay-anchor">
		{#if isOpen}
			<section class="shell-composer__finder" aria-label={playCopy.finder.regionLabel} data-testid="shell-finder">
				{#if refreshAvailable}
					<div class="shell-composer__refresh">
						<span>{playCopy.finder.changed}</span>
						<Button type="button" size="sm" variant="ghost" onclick={refreshFinder}>{playCopy.finder.refresh}</Button>
					</div>
				{/if}
				<div class="shell-composer__finder-body">
					<div bind:this={resultsElement} id={listId} class="shell-composer__results" role="listbox" aria-label={playCopy.finder.resultsLabel}>
						{#each candidates as candidate, index (candidate.id)}
							{#if candidate.prompt !== undefined && !candidates.slice(0, index).some(previous => previous.prompt?.occurrenceId === candidate.prompt?.occurrenceId)}
								<p id={`play-shell-question-${candidate.prompt.occurrenceId}`} class="shell-composer__question">{candidate.prompt.sourceName}: {candidate.prompt.question ?? playCopy.finder.questionFallback}</p>
							{/if}
							<BrowseRow
								type="button"
								tabindex={-1}
								id={`play-shell-option-${candidate.id}`}
								role="option"
								aria-label={candidate.prompt === undefined ? undefined : `${candidate.label} — answer to ${candidate.prompt.sourceName}`}
								aria-describedby={candidate.prompt === undefined ? undefined : `play-shell-question-${candidate.prompt.occurrenceId}`}
								aria-selected={index === activeIndex}
								data-role={candidate.role ?? "bound-fact"}
								selected={index === activeIndex}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => {
									activeCandidateId = candidate.id;
									activeCandidateLabel = candidate.label;
									void choose(candidate);
								}}
							>
								<span class="shell-composer__cursor" aria-hidden="true">{index === activeIndex ? "▸" : " "}</span>
								<span class="shell-composer__candidate-label" data-role={candidate.role ?? "bound-fact"}>{candidate.label}</span>
								<span class="shell-composer__candidate-source" data-role={candidate.role ?? "bound-fact"}>{playCopy.sources[candidate.source]}</span>
							{#if candidate.prompt === undefined && candidate.detail !== undefined}<small>{candidate.detail}</small>{/if}
							</BrowseRow>
						{/each}
					</div>
					<aside class="shell-composer__preview" aria-live="polite" data-role={activeCandidate?.role ?? "muted"}>
						{#if activeCandidate?.prompt !== undefined && activeCandidate.preview === undefined}
							<small>{activeCandidate.prompt.question ?? activeCandidate.detail}</small>
						{/if}
						<h3 class:answer={activeCandidate?.prompt !== undefined}>{activeCandidate?.label ?? playCopy.finder.emptyTitle}</h3>
						{#if previewBody !== undefined}<p>{previewBody}</p>{/if}
						{#if activeCandidate?.prompt === undefined && activeCandidate?.preview !== undefined && activeCandidate.detail !== undefined}
							<small>{activeCandidate.detail}</small>
						{/if}
					</aside>
				</div>
				<footer class="shell-composer__keys"><span>{playCopy.finder.pickingDoesNotSend}</span><span>{playCopy.composer.keys.open(finderNavigationHint, acceptHint)}</span><span>{playCopy.finder.typeToNarrow}</span></footer>
			</section>
		{/if}
		<p class="shell-composer__announcement" aria-live="polite">{refreshAnnouncement}</p>
		<p id={helpId} class="shell-composer__grammar">{playCopy.composer.grammarHelp}</p>
		<div class:conflict={promptTargetConflict} class="shell-composer__input-frame">
			<!-- No whitespace between these inline spans: the mirror deliberately
			     uses white-space: pre so its pixels track the native text input. -->
			<div bind:this={mirrorElement} class="shell-composer__mirror" aria-hidden="true"><span class="shell-composer__prompt">›</span>{#if buffer.text === ""}{#if ghostText !== ""}<span data-role="suggestion">{ghostText}</span>{:else}<span data-role="muted">{playCopy.composer.placeholder}</span>{/if}{:else}{#each mirror as piece, index (`${piece.role}:${index}`)}<span data-role={piece.role}>{piece.text}</span>{/each}{/if}</div>
			<input
				bind:this={input}
				id={inputId}
				class="shell-composer__input"
				role="combobox"
				aria-autocomplete="both"
				aria-controls={listId}
				aria-expanded={isOpen}
				aria-activedescendant={isOpen ? activeOptionId : undefined}
				aria-label={label}
				aria-describedby={`${helpId} ${statusId}`}
				aria-invalid={attemptBlock?.invalid ? "true" : undefined}
				spellcheck="false"
				value={buffer.text}
				disabled={disabled}
				oninput={onInput}
				onclick={onSelectionEvent}
				onkeyup={onSelectionEvent}
				onselect={onSelectionEvent}
				onscroll={onSelectionEvent}
				onkeydown={onKeydown}
			/>
		</div>
		<DockHelpLine id={statusId} message={helpMessage} tone={helpTone} keys={keyLegend} />
	</div>
	<Button type="button" variant="woven-secondary" size="sm" disabled={disabled || attemptDisabled} aria-describedby={attemptBlock === undefined ? undefined : statusId} onclick={() => { dismissedOutcome = null; onAttempt(); }}>Attempt</Button>
</section>

<style>
	.shell-composer__question { margin: 0; padding: 0.4rem 0.6rem; font-size: 0.75rem; }
	.shell-composer__preview h3.answer { font-size: 1.5rem; }
	.shell-composer { display: flex; align-items: flex-start; gap: 0.45rem; min-inline-size: 0; }
	.shell-composer__overlay-anchor { position: relative; flex: 1; min-inline-size: 0; }
	.shell-composer__input-frame { position: relative; min-block-size: 2.75rem; border: 1px solid var(--input); border-radius: var(--radius); background: var(--background); }
	.shell-composer__mirror, .shell-composer__input { box-sizing: border-box; inline-size: 100%; min-block-size: 2.75rem; padding: 0.7rem 0.85rem 0.7rem 2.35rem; font: 500 0.98rem/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.01em; white-space: pre; }
	.shell-composer__mirror { overflow: hidden; pointer-events: none; }
	.shell-composer__input { position: absolute; inset: 0; border: 0; outline: 0; background: transparent; color: transparent; caret-color: var(--foreground); }
	.shell-composer__input:focus-visible { box-shadow: 0 0 0 2px var(--ring); }
	.shell-composer__input-frame.conflict { border-color: var(--shell-error, var(--destructive)); }
	.shell-composer__prompt { position: absolute; inset-inline-start: 0.85rem; color: var(--shell-action, var(--primary)); font-weight: 750; }
	.shell-composer > :global(button) { margin-block-start: 0.15rem; }
	.shell-composer__finder { position: absolute; z-index: 20; inline-size: min(54rem, 100%); inset-inline-start: 0; inset-block-end: calc(100% + 0.45rem); border: 1px solid color-mix(in srgb, var(--primary) 68%, transparent); border-radius: var(--radius); background: color-mix(in srgb, var(--background) 94%, black); box-shadow: 0 -0.8rem 2rem color-mix(in srgb, black 36%, transparent); }
	.shell-composer__finder-body { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(14rem, 0.95fr); }
	.shell-composer__refresh { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; border-bottom: 1px solid color-mix(in srgb, var(--muted-foreground) 28%, transparent); padding: 0.35rem 0.6rem; color: var(--muted-foreground); font-size: 0.75rem; }
	.shell-composer__announcement, .shell-composer__grammar { position: absolute; block-size: 1px; inline-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	.shell-composer__results { max-block-size: min(19rem, 48vh); overflow: auto; padding: 0.3rem; }
	.shell-composer__results :global([role="option"]) { display: grid; inline-size: 100%; grid-template-columns: 1.15rem minmax(0, 1fr) auto; gap: 0.2rem; cursor: pointer; padding: 0.45rem 0.55rem; text-align: start; }
	.shell-composer__results small { grid-column: 2 / -1; color: var(--muted-foreground); }
	.shell-composer__candidate-source { align-self: center; color: var(--muted-foreground); font: 0.68rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
	.shell-composer__cursor { color: var(--primary); }
	.shell-composer__preview { border-inline-start: 1px solid color-mix(in srgb, var(--muted-foreground) 28%, transparent); padding: 0.8rem; }
	.shell-composer__keys { color: var(--muted-foreground); font: 0.72rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
	.shell-composer__preview h3 { margin: 0.35rem 0; font: 600 1rem/1.25 var(--font-display, inherit); }
	.shell-composer__preview p { margin: 0; color: var(--muted-foreground); }
	.shell-composer__preview small { display: block; margin-block-start: 0.45rem; color: var(--muted-foreground); font: 0.75rem/1.3 var(--font-body, sans-serif); }
	.shell-composer__keys { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; border-top: 1px solid color-mix(in srgb, var(--muted-foreground) 28%, transparent); padding: 0.4rem 0.6rem; }
	/* Shell colour roles are semantic variables, with this theme's tokens only
	 * as defaults. A future skin or player preference can change a role without
	 * needing to know whether it happens to be an action, a target or prose. */
	[data-role="action"], [data-role="bound-action"], [data-role="bound-fact"], [data-role="syntax-action"] { color: var(--shell-action, var(--primary)); }
	[data-role="actor"], [data-role="bound-actor"], [data-role="syntax-actor"] { color: var(--shell-actor, var(--foreground)); }
	[data-role="world-ref"], [data-role="bound-world_ref"], [data-role="syntax-world-ref"] { color: var(--shell-world-ref, var(--accent-foreground)); }
	[data-role="field"], [data-role="bound-field"] { color: var(--shell-field, var(--shell-world-ref, var(--accent-foreground))); }
	[data-role="payload"] { color: var(--shell-payload, var(--accent-foreground)); }
	[data-role="participant"], [data-role="bound-participant"] { color: var(--shell-participant, var(--foreground)); }
	[data-role="prompt"], [data-role="syntax-prompt"] { color: var(--shell-prompt, var(--shell-action, var(--primary))); font-weight: 650; }
	[data-role="reaction"], [data-role="bound-reaction"] { color: var(--shell-reaction, var(--destructive)); font-weight: 650; }
	[data-role^="bound-"] { font-weight: 650; text-decoration: underline dotted color-mix(in srgb, currentColor 55%, transparent); text-underline-offset: 0.16em; }
	[data-role="suggestion"], [data-role="muted"] { color: var(--shell-suggestion, var(--muted-foreground)); }
	[data-role="default"] { color: var(--shell-default, var(--shell-suggestion, var(--muted-foreground))); font-style: italic; }
	[data-role="stale"], [data-role="error"] { color: var(--shell-error, var(--destructive)); text-decoration: underline wavy currentcolor; text-underline-offset: 0.16em; }
	@media (max-width: 42rem) { .shell-composer__finder-body { grid-template-columns: 1fr; } .shell-composer__preview { border-inline-start: 0; border-top: 1px solid color-mix(in srgb, var(--muted-foreground) 28%, transparent); } }
	@media (forced-colors: active) { [data-role^="bound-"] { outline: 1px dotted currentcolor; text-decoration-style: solid; } [data-role="default"] { outline: 1px dashed currentcolor; } [data-role="stale"], [data-role="error"] { outline: 2px solid currentcolor; } }
</style>
