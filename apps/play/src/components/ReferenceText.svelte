<script lang="ts">
	import { onMount } from "svelte";
	import {
		loadReferenceMatcher,
		referenceVocabularyUrl,
		safeReferenceHref,
	} from "../lib/reference-vocabulary";
	import ReferencePreview from "./ReferencePreview.svelte";

	let { text, class: className = "", enabled = true }: { text: string; class?: string; enabled?: boolean } = $props();
	let matcher = $state<Awaited<ReturnType<typeof loadReferenceMatcher>>>(null);

	const docsUrl = referenceVocabularyUrl(import.meta.env as Record<string, string | undefined>);
	const docsOrigin = new URL(docsUrl).origin;

	onMount(() => {
		if (!enabled) return;
		let active = true;
		void loadReferenceMatcher(docsUrl).then((next) => {
			if (active) matcher = next;
		});
		return () => { active = false; };
	});

	const segments = $derived.by(() => {
		if (!enabled || matcher === null) return [{ text, target: null }];
		const matches = matcher.match(text);
		if (matches.length === 0) return [{ text, target: null }];
		const result: { text: string; target: (typeof matches)[number]["target"] | null }[] = [];
		let cursor = 0;
		for (const match of matches) {
			if (match.start < cursor || match.end <= match.start || match.end > text.length) continue;
			if (match.start > cursor) result.push({ text: text.slice(cursor, match.start), target: null });
			result.push({ text: text.slice(match.start, match.end), target: match.target });
			cursor = match.end;
		}
		if (cursor < text.length) result.push({ text: text.slice(cursor), target: null });
		return result;
	});
</script>

<span class={className}>
	{#each segments as segment, index (`${index}:${segment.text}`)}
		{#if segment.target !== null}
			{@const href = safeReferenceHref(segment.target.href, docsOrigin)}
			{#if href !== null}{#key `${href}:${segment.target.previewHref ?? ""}`}<ReferencePreview text={segment.text} target={segment.target} {href} />{/key}
			{:else}{segment.text}{/if}
		{:else}{segment.text}{/if}
	{/each}
</span>
