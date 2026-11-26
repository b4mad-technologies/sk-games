<script lang="ts">
	import { Button } from "@spellkave/ui";
	/**
	 * The Talk scene's CARD-level place channel as a thread (sk-jay0.1.8.12):
	 * one world-ordered stream, newest at the bottom, bursts grouped under one
	 * speaker, numbered answers and any line-bound offered action as chips
	 * under the line that offered them. The composer itself stays in
	 * `PlayTable.svelte` (already built, already tested) — this component
	 * only renders what was heard.
	 *
	 * Stage moved to the Table's own shared stream at sk-jay0.1.8.63.1 Part B
	 * (`exploreStreamFromView` + `PlayTable.svelte`'s `exploreStreamLine`
	 * snippet): entering/leaving Talk no longer swaps which list renderer is
	 * mounted, so this component's own auto-follow/scrollport plumbing below
	 * is exercised at `density="card"` only now (card never scrolls) — kept
	 * rather than trimmed, since `density="stage"` remains a valid, tested
	 * shape of this component in its own right (`Thread.test.ts`), just one
	 * `PlayTable.svelte` no longer reaches for. The participant head that
	 * used to sit above the stage transcript is `TalkParticipants.svelte` now
	 * (moved out whole, not redesigned) — a Talk-only header PlayTable mounts
	 * above the shared stream instead of inside this component.
	 *
	 * `chips` render as plain buttons, not the `Speech`/`Actions` widgets:
	 * those wrap a whole `PlayFrame` per mount (a title row, a border), which
	 * is right for ONE open dialogue but wrong repeated once per chat line —
	 * a documented choice, not an oversight (see the bead's implementer
	 * report).
	 *
	 * Every rendered line carries `data-line-id={line.id}` (sk-jay0.1.8.18
	 * task 2): PlayTable's `scrollToBurst` used to find a burst's own first
	 * line by ITS INDEX against `.play-thread ol > li`, a lookup that would
	 * silently no-op the moment this markup's own structure changed (a
	 * different index than the one `thread.lines` predicts). The stable id
	 * hook is the in-lane fix; card mounts no longer need it for navigation
	 * (`scrollToBurst` now targets the shared stream's own `data-activity-id`
	 * hook), but it stays as a general stable-row identity for this widget.
	 */
	import { ActivityFeed, Description, SpeechBubble } from "@spellkave/ui-widgets";
	import { onDestroy, onMount } from "svelte";
	import { createFollowScroll } from "../lib/follow-scroll.svelte";
	import type { ThreadChip, ThreadLine } from "../lib/play-table";
	import {
		loadReferenceMatcher,
		type PlayReferenceTarget,
		referenceVocabularyUrl,
		safeReferenceHref,
	} from "../lib/reference-vocabulary";
	import ReferencePreview from "./ReferencePreview.svelte";
	import ReferenceText from "./ReferenceText.svelte";

	let {
		lines,
		density = "stage",
		busy = false,
		onAct,
		onUnreadChange,
		referencesEnabled = true,
		scrollport = false,
		chips = true,
	}: {
		lines: ThreadLine[];
		/** `card` shows the last two lines only, statically (no scroll, no
		 * "new lines" pill — task 6); `stage` shows the whole thread with
		 * auto-follow. */
		density?: "card" | "stage";
		busy?: boolean;
		/** Fire a chip's own offered action (a numbered answer, or a
		 * line-bound action such as "Adopt the recommended array"). Only read
		 * when `chips` renders them; Play's own Table passes neither (axiom
		 * A1, `ledger/designs/play-interaction-axioms.md`: the dock acts). */
		onAct?: (actionId: string) => void;
		/** The containing tile renders catch-up outside its scrolling answers. */
		onUnreadChange?: (count: number, jumpToLatest: () => void) => void;
		referencesEnabled?: boolean;
		/** Keep stage participants fixed while only the transcript scrolls. */
		scrollport?: boolean;
		/** Render each line's own chips (round 3, sk-jay0.1.8): the Talk dock
		 * is now where the open prompt's answers and any line-bound offer
		 * live at stage, so the thread itself renders no chip buttons there
		 * — one dock, not a dock plus a duplicate row per chat line. The dock
		 * is mounted whatever the Table's size, so `PlayTable.svelte` passes
		 * `false` at card density too (sk-jay0.1.8.63.29); the default stays
		 * `true` for a caller without a dock. */
		chips?: boolean;
	} = $props();

	// The speaker filter (sk-jay0.1.8.12 task 5) is a Talk-stage affordance
	// now owned by `PlayTable.svelte`'s own `activeViewFilterId`, applied to
	// the shared stream directly — this component no longer mounts at stage,
	// so it never receives or applies one itself.
	const shown = $derived(density === "card" ? lines.slice(-2) : lines);

	/**
	 * Auto-follow (task 3, "newest at the bottom, auto-follow unless the
	 * player scrolled up") scrolls the tile's OWN scroller
	 * (`.tile[data-zoom="stage"] .tile-body`, styles.css — "the stage tile's
	 * body is the only scroller"), not a container Thread owns itself: the
	 * composer and the "+" menu are siblings of this component inside that
	 * SAME scroller (`PlayTable.svelte`'s `table-scene`), so there is no
	 * bounded height anywhere between `tile-body` and here for a nested
	 * scroll region to mean anything — reusing the established scroller is
	 * correct, not a shortcut. Resolved once per mount via `closest`,
	 * never reassigned even if `rootEl` briefly nulls on teardown.
	 */
	let rootEl = $state<HTMLElement | null>(null);
	let scrollHost: HTMLElement | null = null;
	const docsUrl = referenceVocabularyUrl(import.meta.env as Record<string, string | undefined>);
	const docsOrigin = new URL(docsUrl).origin;
	let choiceReferenceMatcher = $state<Awaited<ReturnType<typeof loadReferenceMatcher>>>(null);

	/**
	 * A choice is a direct stateful action, so it cannot also be the nested
	 * Popover trigger. Resolve a separate reading aid from the same public
	 * vocabulary used by prose; only an exact, safe target earns that control.
	 */
	function referenceForChoice(label: string): { target: PlayReferenceTarget; href: string } | null {
		const matcher = choiceReferenceMatcher;
		if (!referencesEnabled || matcher === null) return null;
		const match = matcher.match(label).find((candidate) => candidate.start === 0 && candidate.end === label.length);
		if (match === undefined) return null;
		const href = safeReferenceHref(match.target.href, docsOrigin);
		return href === null ? null : { target: match.target, href };
	}

	onMount(() => {
		if (!referencesEnabled) return;
		let active = true;
		void loadReferenceMatcher(docsUrl).then((matcher) => {
			if (active) choiceReferenceMatcher = matcher;
		});
		return () => { active = false; };
	});

	function host(): HTMLElement | null {
		if (scrollHost === null) {
			scrollHost = scrollport
				? rootEl?.querySelector<HTMLElement>(".play-thread__scroll") ?? null
				: rootEl?.closest(".tile-body") ?? null;
		}
		return scrollHost;
	}

	// The follow-scroll rule itself — pinned vs unread, smooth-vs-instant
	// landing — is shared with the Explore stream (sk-jay0.1.8.63.1,
	// `follow-scroll.svelte.ts`); only host resolution (this component's own
	// scroller lookup, `card` density never scrolling) stays local.
	const follow = createFollowScroll(() => (density === "stage" ? host() : null));

	// Reference helpers and line-bound controls can mount just after the first
	// DOM tick. A short initial settle makes a reload land at the newest line
	// even when those additions lengthen the transcript.
	onMount(() => {
		if (density !== "stage" || !scrollport) return;
		const timer = window.setTimeout(follow.jumpToLatest, 120);
		return () => window.clearTimeout(timer);
	});

	$effect(() => {
		onUnreadChange?.(density === "stage" && !follow.pinned ? follow.unread : 0, follow.jumpToLatest);
	});
	onDestroy(() => onUnreadChange?.(0, follow.jumpToLatest));

	// Starts at 0, not `shown.length`, so the initial mount never reads a
	// `$derived` outside a reactive context (svelte's own
	// `state_referenced_locally` warning) — harmless either way, since the
	// first effect run's own growth (0 → however many lines the fixture or
	// the world already holds) falls through to the SAME reveal an ordinary
	// new-line arrival would, landing the thread open on its newest line
	// rather than its oldest.
	let lastCount = 0;
	$effect(() => {
		const count = shown.length;
		if (density !== "stage") {
			lastCount = count;
			return;
		}
		if (count > lastCount) follow.reveal(count - lastCount);
		lastCount = count;
	});
</script>

{#snippet threadLine(line: ThreadLine)}
	<div
		class={line.startsBurst && line.id !== shown[0]?.id ? "mt-3" : "mt-1"}
		data-line-id={line.id}
	>
		<SpeechBubble speaker={line.speaker} outgoing={line.mine} continued={!line.startsBurst}>

			{#if line.addresseeName !== null}
				<p class="sk-label sk-play-muted m-0">to {line.addresseeName}</p>
			{/if}
			{#if line.isChoice}
				<p class="sk-play-prose italic m-0">
					<!-- The space lives outside the span: Svelte drops a trailing space
					     inside it, which rendered "Chose ·3 Just a drink" in play. -->
					<span class="sk-play-muted not-italic">Chose ·</span>{" "}<ReferenceText text={line.text} enabled={referencesEnabled} />
				</p>
			{:else}
				<p class="sk-play-prose m-0"><ReferenceText text={line.text} enabled={referencesEnabled} /></p>
			{/if}
		</SpeechBubble>
		{#if chips && line.chips.length > 0}
			<ul class="mt-2 flex flex-wrap gap-2" aria-label="Answers from {line.speaker}">
				{#each line.chips as chip (chip.actionId)}
					{@const reference = referenceForChoice(chip.label)}
					<li class="min-w-0 max-w-full">
						<div class="flex items-center gap-1">
							<Button variant="woven-secondary" size="sm" type="button" class="min-h-7 gap-2" disabled={busy} onclick={() => onAct?.(chip.actionId)}>
								{#if chip.slot !== undefined}<span class="sk-num opacity-70">{chip.slot}.</span>{/if}
								{chip.label}
							</Button>
							{#if reference !== null}
								<ReferencePreview text="ⓘ" target={reference.target} href={reference.href} triggerAriaLabel={`About ${reference.target.label}`} triggerClass="play-choice-reference" />
							{/if}
						</div>
						<Description text={chip.description} label={`About ${chip.label}`} valueSlot="play-action-description" />
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/snippet}

<div class="play-thread flex flex-col gap-2" class:play-thread--scrollport={scrollport} data-slot="play-thread" bind:this={rootEl}>
	<div class:play-thread__scroll={scrollport}>
		<ActivityFeed readable items={shown} ariaLabel="What has been said" emptyText="Nobody has spoken here." renderItem={threadLine} />
	</div>
</div>

<style>
	:global(.play-choice-reference) {
		padding: 0;
		border: 0;
		background: transparent;
		font-size: 0.75rem;
		line-height: 1;
		text-align: center;
		text-decoration: none;
	}

	.play-thread--scrollport {
		flex: 1 1 auto;
		min-height: 0;
	}

	.play-thread__scroll {
		min-height: 0;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
</style>
