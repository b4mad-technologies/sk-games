<script lang="ts">
	import { readDefinitionCard } from "../lib/reference-adapter";
	import DefLinkText from "./DefLinkText.svelte";

	let {
		definitionRef,
		shownDescription,
	}: {
		definitionRef?: string;
		/** The description the surrounding detail already shows. An item or
		 * occupant without prose of its own falls back to its definition's, so
		 * the card's description would print the same text a second time. */
		shownDescription?: string;
	} = $props();
	const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
	let card = $state<Awaited<ReturnType<typeof readDefinitionCard>>>(null);
	$effect(() => {
		const ref = definitionRef;
		card = null;
		let active = true;
		if (ref) void readDefinitionCard(ref).then(result => { if (active) card = result; });
		return () => { active = false; };
	});
	const description = $derived(
		card?.description && !(shownDescription && sameText(card.description, shownDescription))
			? card.description
			: null,
	);
</script>
{#if card}
	<section class="mt-4" aria-label="Documentation">
		{#if description}<p class="sk-play-prose"><DefLinkText text={description} /></p>{/if}
		<a class="text-sm text-primary underline" href={card.href} target="_blank" rel="noopener noreferrer">Read {card.title} in the documentation</a>
	</section>
{/if}
