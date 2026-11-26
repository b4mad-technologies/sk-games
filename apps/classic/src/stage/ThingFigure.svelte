<script lang="ts">
	// One thing on the stage. What it affords hangs on the thing itself: a
	// click opens its offers as paper tags beside it. Lead offers show at
	// once, the rest fold behind "more".
	// ci-allow(ui-primitives): classic stage owner exception sk-jay0.1.76.19, see apps/classic/DESIGN.md
	import { Popover } from "bits-ui";
	import type { Flash, Line, Offer, Thing } from "./model";

	type Props = {
		thing: Thing;
		/** The hero is in a talk with this one: a click is for its other offers. */
		talking?: boolean;
		bubble?: Line;
		flashes: Flash[];
		onattempt: (thingId: string, offerId: string) => void;
		onhint: (sentence: string | null) => void;
	};
	let { thing, talking = false, bubble, flashes, onattempt, onhint }: Props = $props();

	let open = $state(false);
	// Somebody who asks is answered first: one click opens the talk, not a
	// list with "Answer" on top. In the talk, the next click opens the list.
	const answer = $derived(
		thing.asks && !talking
			? thing.offers.find((offer) => offer.id === thing.answerWith)
			: undefined,
	);
	function setOpen(next: boolean): void {
		if (next && answer) pick(answer.id);
		else open = next;
	}
	let unfolded = $state(false);
	let openFold = $state<string | null>(null);

	const lead = $derived(thing.offers.filter((offer) => offer.lead));
	const folded = $derived(thing.offers.filter((offer) => !offer.lead));
	// Folded offers without a fold of their own come first, then the folds.
	const loose = $derived(folded.filter((offer) => !offer.group));
	const folds = $derived(
		[...new Set(folded.flatMap((offer) => (offer.group ? [offer.group] : [])))].map((label) => ({
			label,
			offers: folded.filter((offer) => offer.group === label),
		})),
	);
	const dead = $derived(thing.conditions.includes("dead"));
	const first = $derived(answer ?? lead[0] ?? thing.offers[0]);

	function pick(offerId: string): void {
		open = false;
		onhint(null);
		onattempt(thing.id, offerId);
	}

	$effect(() => {
		if (!open) {
			unfolded = false;
			openFold = null;
			about = null;
		} else if (thing.opens) {
			// Down or in a fight, the hero needs what they can do now, not the
			// sheet: that fold is open at once.
			unfolded = true;
			openFold = folds.find((fold) => fold.label === thing.opens)?.label ?? folds[0]?.label ?? null;
		}
	});
	// What the world says the pointed-at action is.
	let about = $state<Offer | null>(null);
	// What the world says about the thing's state, in a word under its name.
	// A dead body is dead; that it is also "incapacitated" says nothing more.
	const states = $derived(dead ? ["dead"] : thing.conditions);

	// Closing the tags hands the focus back to the figure. Only a focus the
	// keyboard brought says what a click would do; else the sentence line
	// would keep that hint over the world's answer.
	function onfocus(event: FocusEvent): void {
		const target = event.currentTarget;
		if (target instanceof HTMLElement && target.matches(":focus-visible"))
			onhint(first ? first.sentence : thing.name);
	}
</script>

{#snippet tag(offer: Offer)}
	<button
		type="button"
		class="st-tag"
		data-refused={offer.refused ? "" : undefined}
		onclick={() => pick(offer.id)}
		onpointerenter={() => {
			about = offer;
			onhint(offer.sentence);
		}}
		onfocus={() => {
			about = offer;
			onhint(offer.sentence);
		}}
	>
		{offer.label}
		{#if offer.refused}<small>Last time: {offer.refused}</small>{/if}
	</button>
{/snippet}

<Popover.Root bind:open={() => open, setOpen}>
	<Popover.Trigger
		class="st-thing"
		style="left: calc({thing.x} * var(--u)); top: calc({thing.y} * var(--u)); z-index: {Math.round(thing.y)};"
		data-kind={thing.kind}
		data-dead={dead ? "" : undefined}
		data-down={thing.down ? "" : undefined}
		data-out={thing.out ? "" : undefined}
		data-artless={thing.art ? undefined : ""}
		aria-label={thing.name}
		disabled={dead}
		onpointerenter={() => onhint(first ? first.sentence : thing.name)}
		onpointerleave={() => onhint(null)}
		{onfocus}
		onblur={() => onhint(null)}
	>
		{#if thing.art}
			<img class="st-sprite" src={thing.art.url} alt="" draggable="false" />
			<span class="st-hit"></span>
		{:else}
			{#if thing.kind === "thing"}
				<span class="st-glyph" aria-hidden="true">{thing.name.slice(0, 1)}</span>
			{:else}
				<span class="st-glyph st-glyph--body"></span>
			{/if}
		{/if}
		{#if thing.asks}<span class="st-asks" aria-label="asks you something">?</span>{/if}
		{#if thing.down}<span class="st-asks st-asks--down" aria-label="is down">!</span>{/if}
		<span class="st-name">
			{thing.name}
			{#if states.length > 0}<small>{states.join(", ")}</small>{/if}
		</span>
		{#if bubble}
			{#key bubble.id}<span class="st-bubble" data-kind={bubble.kind}><span>{bubble.text}</span></span>{/key}
		{/if}
		{#each flashes as flash (flash.id)}
			<span class="st-flash" data-tone={flash.tone}>{flash.text}</span>
		{/each}
	</Popover.Trigger>
	<Popover.Portal>
		<!-- The tags keep clear of the top line and the foot line. -->
		<Popover.Content
			class="st-tags st-float"
			side="right"
			align="center"
			sideOffset={4}
			collisionPadding={{ top: 48, bottom: 58, left: 8, right: 8 }}
		>
			<div class="st-taglist">
			<header>
				<strong>{thing.name}</strong>
				{#if thing.note}<p>{thing.note}</p>{/if}
			</header>
			{#each lead as offer (offer.id)}{@render tag(offer)}{/each}
			{#if folded.length > 0 && !unfolded}
				<button type="button" class="st-tag st-tag--more" onclick={() => (unfolded = true)}>
					more… ({folded.length})
				</button>
			{:else if unfolded}
				{#each loose as offer (offer.id)}{@render tag(offer)}{/each}
				{#each folds as fold (fold.label)}
					{@const shown = openFold === fold.label || folds.length + loose.length === 1}
					<button
						type="button"
						class="st-tag st-tag--more"
						aria-expanded={shown}
						onclick={() => (openFold = shown ? null : fold.label)}
					>
						{fold.label} ({fold.offers.length})
					</button>
					{#if shown}
						{#each fold.offers as offer (offer.id)}{@render tag(offer)}{/each}
					{/if}
				{/each}
			{/if}
			{#if thing.offers.length === 0}
				<header><p>Nothing to do with it that you know of.</p></header>
			{/if}
			</div>
			{#if about?.about}
				<p class="st-tagabout" aria-live="polite"><b>{about.label}.</b> {about.about}</p>
			{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
