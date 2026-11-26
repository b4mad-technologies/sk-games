<script lang="ts">
	import type { IntentInputValues } from "@spellkave/sdk";
	import type {
		DockBarEntry,
		DockBarSection,
		DockHotbarGroup,
		DockHotbarPip,
		DockHotbarUrgent,
	} from "@spellkave/ui";
	import {
		Button,
		DockBar,
		DockBarMenu,
		DockBarText,
		DockHotbar,
		DockNotice,
		DockPips,
		DockStatusBar,
		InfoLink,
		Input,
	} from "@spellkave/ui";
	import { onMount, type Snippet } from "svelte";
	import { assignSlotKeys, type Hotbar, type HotbarGroup, hotbarRows } from "../lib/dock-hotbar";
	import type { ComposerCompletion, ComposerDraftState, ComposerPrompt } from "../lib/fact-composer";
	import type { Keymap } from "../lib/keymap";
	import { TILE_TITLES } from "../lib/mosaic";
	import type { PlayAction, PlayActionInput, PlayExit, PlayManipulationAction, PlayManipulationTarget } from "../lib/play-view";
	import type { SelectionMenuEntry } from "../lib/selection";
	import FactShellComposer from "./FactShellComposer.svelte";
	import MosaicGlyph from "./MosaicGlyph.svelte";

	/** One hero condition chip: `id` is what an `InfoLink` opens
	 * (`condition:<id>`), `label` what it shows — kept apart because
	 * `PlayTable.svelte`'s own condition source is label-only until the
	 * on-demand detail read has landed (sk-jay0.1.8.63.10). */
	export interface DockCondition {
		id: string;
		label: string;
	}

	export interface DockExit {
		handle: string;
		direction: string;
		name: string;
	}

	const DOCK_EXPANDED_STORAGE_KEY = "spellkave.play.dock.expanded";

	/** The player's own control (axiom A2): read once at mount, never changed
	 * by the app. Storage can be missing, blocked or hold anything (a private
	 * window, cleared site data), so this never throws — the dock just opens
	 * compact. */
	function loadDockExpanded(): boolean {
		try {
			return typeof localStorage !== "undefined" && localStorage.getItem(DOCK_EXPANDED_STORAGE_KEY) === "true";
		} catch {
			return false;
		}
	}

	let {
		heroHp,
		heroHpMax,
		heroAc,
		heroDrafting = false,
		heroConditions,
		placeId,
		placeName,
		exits,
		onChooseExit,
		hotbar,
		pips = [],
		slotKeys,
		activeSlotId = null,
		onSlot,
		showEndTurn = false,
		onEndTurn,
		composerLabel,
		composerInput,
		composerPlaceholder,
		composerDisabled,
		onSay,
		factComposer = null,
		legacyActionFallback = false,
		replySuggestionName = null,
		onAcceptReply,
		onClearSelection,
		busy,
		busyActionId = null,
		notice = null,
		statusMessage,
		urgent,
		extras,
		seal,
	}: {
		heroHp?: number;
		statusMessage?: { text: string; tone: "stale" | "error" };
		heroHpMax?: number;
		heroAc?: number;
		/** The hero is still being drafted (`PlayHero.drafting`, keyed on the
		 * world's drafting condition id): the HP/AC text is left out instead
		 * of reading as a dash or a zero. Temporary until sk-jay0.1.8.108. */
		heroDrafting?: boolean;
		heroConditions: readonly DockCondition[];
		/** The current place's own id — `null` alongside a `null` `placeName`
		 * (no place resolved yet). Feeds row 1's fallback chip (nothing
		 * selected) and its own `place:<id>` `InfoLink` ref. */
		placeId: string | null;
		placeName: string | null;
		exits: readonly DockExit[];
		/** "Ways out" never travels on its own (axioms A1/A4): the caller
		 * writes the go sentence into the composer; a click never moves
		 * (`PlayTable.svelte`'s `chooseExit`). */
		onChooseExit: (exitHandle: string) => void;
		/** The pure hotbar model (`../lib/dock-hotbar.ts`) — every value this
		 * component renders beyond the status row and composer comes from it. */
		hotbar: Hotbar;
		/** Resource strip, leading the hotbar's first row. */
		pips?: DockHotbarPip[];
		/** The digit label bound to each of the first row's slot positions, in
		 * order — read off the SAME keymap the caller's own keyboard handler
		 * uses, so a slot's badge and the key that fires it never disagree. */
		slotKeys: readonly (string | null)[];
		/** The slot id the composer currently speaks through, for the hotbar's
		 * own `active` highlight. */
		activeSlotId?: string | null;
		/** A hotbar slot id, from a click or its bound digit alike — the
		 * caller owns dimmed/words-taking branching and the world dispatch
		 * (`PlayTable.svelte`'s `pressSlot`). */
		onSlot: (id: string) => void;
		/** Shown only in a tactical session, on the player's own turn. */
		showEndTurn?: boolean;
		onEndTurn: () => void;
		/** The composer's sr-only `<label>` text — always starts "Say or do
		 * something" (tests and the keymap's `composer.focus` hint anchor on
		 * it), naming the slot it currently resolves to. */
		composerLabel: string;
		/** Optional world-authored input schema for the armed affordance. */
		composerInput?: PlayActionInput;
		/** The composer's own placeholder — usually the same words as the
		 * label, replaced by a reply suggestion when one is offered. */
		composerPlaceholder: string;
		/** `true` when nothing offered takes words at all. */
		composerDisabled: boolean;
		onSay: (text: string, inputValues?: IntentInputValues) => void;
		/** The live composer: one text box for actions, targets, quoted speech
		 * and authored form fields (`name:"…"`). The legacy speech form below
		 * is rendered only for legacy recordings (`legacyActionFallback`). */
		factComposer?: {
			draft: ComposerDraftState;
			actions: readonly ComposerCompletion<PlayManipulationAction>[];
			targets: readonly ComposerCompletion<PlayManipulationTarget>[];
			prompts?: readonly ComposerPrompt[];
			senseActions?: readonly PlayAction[];
			exits?: readonly PlayExit[];
			canEndTurn?: boolean;
			selectedPromptId?: string | null;
			prefillTargetRef?: string | null;
			insertion?: { token: number; actionId?: string; targetRef?: string; exitHandle?: string } | null;
			clearToken?: number;
			revision: number;
			keymap?: Keymap;
			factsUnavailable?: boolean;
			suspended?: boolean;
			/** The hero carries the downed fact: the composer's help line says
			 * the hero cannot act right now. The box stays usable; the world
			 * still answers an attempt. */
			downed?: boolean;
			onExecutableChange: (executable: Pick<ComposerDraftState, "actionId" | "targetRef" | "semanticContext">) => void;
			onAttemptSense?: (actionId: string) => void;
			onAttemptMove?: (exitHandle: string) => void;
			onAttemptEndTurn?: () => void;
			onChangeDetails: (details: Pick<ComposerDraftState, "inputValues" | "utterance">) => void;
			/** A way-out or detail insertion was refused: typed words are in the box. */
			onInsertionKept?: (exitHandle: string | null) => void;
			onAttempt: () => void;
			outcome?: { text: string; kind: "accepted" | "rejected" | "unobserved" | "blocked" } | null;
		} | null;
		/** Imported recordings from before the factored manipulation context are
		 * still playable review artefacts. They cannot construct an
		 * `IntentDraft`, so (and only so) retain the old fact-less action row.
		 * A live world that has supplied even an unavailable context must not
		 * silently fall back: it should explain that state through the composer. */
		legacyActionFallback?: boolean;
		/** The last speaker who addressed the player, offered as the
		 * composer's own suggestion while nothing is selected — `null` when no
		 * such suggestion stands (`PlayTable.svelte`'s `replySuggestion`). */
		replySuggestionName?: string | null;
		onAcceptReply: () => void;
		/** The chip's own `×` — clears the global selection (never shown
		 * without one: no selection falls back to the place name instead). */
		onClearSelection: () => void;
		busy: boolean;
		/** The id of the one action whose call is in flight, or `null`. Only
		 * that action renders `pending`; every other action stays inert but
		 * unchanged in appearance. */
		busyActionId?: string | null;
		notice?: {
			text: string;
			tone?: "info" | "warn";
			onDismiss?: () => void;
			/** One offer the notice makes, e.g. a layout hint (axiom A2: the app
			 * never changes the layout itself, it offers). */
			action?: { label: string; onSelect: () => void };
		} | null;
		/**
		 * Something the world is holding open for an answer — a reaction
		 * window (axiom A7, `ledger/designs/play-interaction-axioms.md`). The
		 * dock is the one surface that is always visible whatever the player
		 * has done to the mosaic. While set it REPLACES the hotbar's action
		 * rows, so the digits on screen are the digits that answer; its
		 * answers fire `onSlot` like any other slot.
		 */
		urgent?: DockHotbarUrgent | null;
		extras?: Snippet;
		seal?: Snippet;
	} = $props();

	let dockExpanded = $state(loadDockExpanded());
	/** Also the keymap's `dock.toggle` (`PlayTable.svelte` calls it through
	 * its component reference), so the key and the button are one path. */
	export function toggleExpanded(): void {
		dockExpanded = !dockExpanded;
		try {
			localStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, dockExpanded ? "true" : "false");
		} catch {
			// Storage may be missing or blocked (private window, cleared site
			// data) — the toggle still works for this render, just not
			// remembered across a reload.
		}
	}

	const COMPASS_DIRECTIONS = new Set([
		"north",
		"south",
		"east",
		"west",
		"northeast",
		"northwest",
		"southeast",
		"southwest",
		"up",
		"down",
	]);

	let sayText = $state("");
	let inputValues = $state<Record<string, string>>({});
	const inputSignature = $derived(
		composerInput === undefined
			? ""
			: composerInput.fields.map((field) => `${field.name}:${field.control}`).join("|"),
	);
	$effect(() => {
		void inputSignature;
		inputValues = {};
	});
	let rootEl = $state<HTMLElement | null>(null);

	onMount(() => {
		if (rootEl === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect.height;
			if (height === undefined) return;
			document.documentElement.style.setProperty("--play-dock-height", `${Math.ceil(height)}px`);
		});
		observer.observe(rootEl);
		return () => observer.disconnect();
	});

	function submitSay(event: SubmitEvent): void {
		event.preventDefault();
		if (composerInput !== undefined) {
			const values: Record<string, string> = {};
			for (const field of composerInput.fields) {
				const value = (inputValues[field.name] ?? "").trim();
				if (field.required && value === "") return;
				if (value !== "") values[field.name] = value;
			}
			if (Object.keys(values).length === 0) return;
			onSay(JSON.stringify(values), values);
			return;
		}
		const text = sayText.trim();
		if (text === "") return;
		onSay(text);
	}

	function exitEntry(exit: DockExit): DockBarEntry {
		return { id: exit.handle, label: exit.name, hint: exit.direction || undefined };
	}

	const hpText = $derived(
		heroHp === undefined ? "—" : heroHpMax === undefined ? `${heroHp}` : `${heroHp}/${heroHpMax}`,
	);
	const acText = $derived(heroAc === undefined ? "—" : `${heroAc}`);
	const exitsLabel = $derived(
		`${exits.length} ${exits.length === 1 ? "way" : "ways"} out`,
	);
	const exitSections = $derived.by((): DockBarSection[] => {
		const compass = exits.filter((exit) => COMPASS_DIRECTIONS.has(exit.direction.toLowerCase()));
		const other = exits.filter((exit) => !COMPASS_DIRECTIONS.has(exit.direction.toLowerCase()));
		const sections: DockBarSection[] = [];
		if (compass.length > 0) sections.push({ entries: compass.map(exitEntry) });
		if (other.length > 0) sections.push({ entries: other.map(exitEntry) });
		return sections;
	});

	// The hotbar's own visual rows (compact/expanded — the player's own
	// control, axiom A2) and the digit each first-row slot carries, mapped
	// onto `@spellkave/ui`'s `DockHotbarGroup` shape: `dimmed`/`pending`/
	// `active` are this component's own presentation of the pure model, never
	// a second copy of it.
	const rows = $derived(hotbarRows(hotbar, dockExpanded));
	const slotAssignment = $derived(assignSlotKeys(rows, slotKeys));

	function toDockEntry(entry: SelectionMenuEntry): DockBarEntry {
		return entry.submenu === undefined
			? { id: entry.id, label: entry.label }
			: { id: entry.id, label: entry.label, submenu: entry.submenu.map((sub) => ({ id: sub.id, label: sub.label })) };
	}

	function toDockSections(more: readonly SelectionMenuEntry[]): DockBarSection[] {
		return more.length === 0 ? [] : [{ entries: more.map(toDockEntry) }];
	}

	function toDockGroup(group: HotbarGroup): DockHotbarGroup {
		return {
			id: group.id,
			label: group.label,
			slots: group.slots.map((slot) => ({
				id: slot.id,
				label: slot.label,
				accessibleLabel: slot.accessibleLabel,
				key: slotAssignment.keyBySlotId.get(slot.id) ?? null,
				dimmed: slot.dimmed,
				dimmedReason: slot.dimmed ? "Not offered right now" : undefined,
				pending: busyActionId === slot.id,
				active: activeSlotId === slot.id ? true : undefined,
			})),
			more: toDockSections(group.more),
			note: group.note,
		};
	}

	const dockHotbarRows = $derived(rows.map((row) => row.map(toDockGroup)));
</script>

{#snippet endTurnButton()}
	<Button type="button" variant="outline" size="sm" onclick={onEndTurn}>End turn</Button>
{/snippet}

{#snippet youIcon()}<MosaicGlyph name="person" />{/snippet}
{#snippet placeIcon()}<MosaicGlyph name="compass" />{/snippet}
{#snippet youStatus()}
 {#if !heroDrafting}<DockBarText>HP {hpText} · AC {acText}</DockBarText>{/if}
 {#each heroConditions as condition (condition.id)}
  <InfoLink refId={`condition:${condition.id}`}><DockBarText>{condition.label}</DockBarText></InfoLink>
 {/each}
{/snippet}
{#snippet placeStatus()}
 {#if placeName !== null && placeId !== null}
  <InfoLink refId={`place:${placeId}`}><DockBarText>{placeName}</DockBarText></InfoLink>
 {:else}<DockBarText>{placeName ?? "—"}</DockBarText>{/if}
 {#if exits.length === 0}<DockBarText>{exitsLabel}</DockBarText>
 {:else}<DockBarMenu label={exitsLabel} sections={exitSections} onSelect={onChooseExit} />{/if}
{/snippet}
{#snippet statusTrailing()}
 {#if showEndTurn && !urgent}{@render endTurnButton()}{/if}
 {#if extras}{@render extras()}{/if}
 {#if seal}{@render seal()}{/if}
{/snippet}
{#snippet compactTrailing()}
 <DockStatusBar groups={[
  {id: "you", label: TILE_TITLES.hero, icon: youIcon, content: youStatus},
  {id: "place", label: TILE_TITLES.place, icon: placeIcon, content: placeStatus},
 ]} trailing={statusTrailing} />
{/snippet}
<div class="play-dock" data-testid="play-dock" bind:this={rootEl}>
	{#if legacyActionFallback}
		<!-- Recordings made before `manipulationContext` cannot form an
		     IntentDraft. This deliberately contains the retired text/form path
		     only for those immutable playback artefacts. -->
		<form class="play-dock__row1" onsubmit={submitSay}>
			{#if hotbar.chip}
				<span class="play-dock__chip">
					{#if hotbar.chip.infoRef}
						<InfoLink refId={hotbar.chip.infoRef}>
							<span class="play-dock__chip-name" title={hotbar.chip.name}>{hotbar.chip.name}</span>
						</InfoLink>
					{:else}
						<span class="play-dock__chip-name" title={hotbar.chip.name}>{hotbar.chip.name}</span>
					{/if}
					<Button type="button" variant="ghost" size="icon-xs" aria-label="Clear selection" onclick={onClearSelection}
						>×</Button
					>
				</span>
			{/if}
			{#if replySuggestionName !== null}
				<Button type="button" variant="outline" size="sm" onclick={onAcceptReply}>
					Reply to {replySuggestionName}
				</Button>
			{/if}
			{#if composerInput === undefined}
				<label class="sr-only" for="play-dock-say">{composerLabel}</label>
				<Input
					id="play-dock-say"
					type="text"
					autocomplete="off"
					placeholder={composerPlaceholder}
					value={sayText}
					disabled={composerDisabled}
					oninput={(event) => (sayText = event.currentTarget.value)}
				/>
			{:else}
				<fieldset class="play-dock__inputs" disabled={composerDisabled}>
					<legend class="sr-only">{composerLabel}</legend>
					{#each composerInput.fields as field (field.name)}
						<label class="play-dock__input-field">
							<span>{field.label}</span>
							{#if field.control === "textarea"}
								<textarea
									rows="2"
									placeholder={field.placeholder ?? field.label}
									maxlength={field.maxLength}
									value={inputValues[field.name] ?? ""}
									oninput={(event) => (inputValues[field.name] = event.currentTarget.value)}
								></textarea>
							{:else}
								<Input
									type={field.control === "number" ? "number" : "text"}
									autocomplete="off"
									placeholder={field.placeholder ?? field.label}
									min={field.min}
									max={field.max}
									maxlength={field.maxLength}
									value={inputValues[field.name] ?? ""}
									oninput={(event) => (inputValues[field.name] = event.currentTarget.value)}
								/>
							{/if}
						</label>
					{/each}
				</fieldset>
			{/if}
			<Button
				variant="woven-secondary"
				size="sm"
				type="submit"
				disabled={busy || composerDisabled || (composerInput === undefined && sayText.trim() === "")}
			>
				{composerInput?.submitLabel ?? "Send"}
			</Button>
			{#if !dockExpanded && pips && pips.length > 0}
				<DockPips {pips} class="play-dock__pips" />
			{/if}
		</form>
	{:else if factComposer}
		<FactShellComposer
			{statusMessage}
			draft={factComposer.draft}
			actions={factComposer.actions}
			targets={factComposer.targets}
			prompts={factComposer.prompts}
			senseActions={factComposer.senseActions}
			exits={factComposer.exits}
			canEndTurn={factComposer.canEndTurn}
			selectedPromptId={factComposer.selectedPromptId}
			insertion={factComposer.insertion}
			prefillTargetRef={factComposer.prefillTargetRef}
			clearToken={factComposer.clearToken}
			revision={factComposer.revision}
			keymap={factComposer.keymap}
			outcome={factComposer.outcome}
			suspended={factComposer.suspended}
			downed={factComposer.downed}
			{busy}
			onExecutableChange={factComposer.onExecutableChange}
			onAttemptSense={factComposer.onAttemptSense}
			onAttemptMove={factComposer.onAttemptMove}
			onAttemptEndTurn={factComposer.onAttemptEndTurn}
			onChangeDetails={factComposer.onChangeDetails}
			onInsertionKept={factComposer.onInsertionKept}
			onAttempt={factComposer.onAttempt}
		/>
	{/if}
	<div class="play-dock__row2">
		{#if urgent}
			<DockHotbar
				rows={dockHotbarRows}
				{urgent}
				pips={dockExpanded ? pips : undefined}
				expanded={dockExpanded}
				onToggleExpanded={toggleExpanded}
				disabled={busy}
				onSelect={onSlot}
			/>
		{:else}
			{#if legacyActionFallback}
				<!-- A captured pre-factored recording has no WorldFacts from which to
				     construct an IntentDraft. Preserve its recorded action path for
				     inspection/playback; current live sessions never take this branch. -->
				<DockHotbar
					rows={dockHotbarRows}
					pips={dockExpanded ? pips : undefined}
					expanded={dockExpanded}
					onToggleExpanded={toggleExpanded}
					disabled={busy}
					onSelect={onSlot}
				/>
			{:else if hotbar.answers && factComposer === null}
				<!-- A pre-cutover caller with no composer surface may replay its
				     recorded answer row. A live factored session always builds a
				     sentence and uses its explicit Attempt gesture. -->
				<DockHotbar
					rows={[[toDockGroup(hotbar.answers)]]}
					disabled={busy}
					onSelect={onSlot}
				/>
			{/if}

		{/if}
		<DockBar class="play-dock__row3">{@render compactTrailing()}</DockBar>
	</div>

	{#if notice}
		<DockNotice text={notice.text} tone={notice.tone} onDismiss={notice.onDismiss} action={notice.action} />
	{/if}
</div>
