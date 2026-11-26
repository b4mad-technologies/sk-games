<script lang="ts">
	/**
	 * Free prose in the Table stream and dock (sk-jay0.1.8.63.10): a matched
	 * vocabulary term becomes an `InfoLink` opening a `def:<ref>` card,
	 * through the isolated `reference-adapter.ts` — never `ReferenceText`'s
	 * own `reference-vocabulary.ts` import directly, so the stream/dock stay
	 * behind the one adapter seam. Unavailable vocabulary (feed down, or
	 * simply no match) renders the input text unchanged, byte-identical —
	 * same contract `ReferenceText` already keeps for its own callers.
	 */
	import { InfoLink } from "@spellkave/ui";
	import { onMount } from "svelte";
	import { loadDefLinkMatcher } from "../lib/reference-adapter";

	let { text, class: className = "", enabled = true }: { text: string; class?: string; enabled?: boolean } =
		$props();

	let matcher = $state<Awaited<ReturnType<typeof loadDefLinkMatcher>>>(null);

	onMount(() => {
		if (!enabled) return;
		let active = true;
		void loadDefLinkMatcher().then((next) => {
			if (active) matcher = next;
		});
		return () => {
			active = false;
		};
	});

	// Mirrors `ReferenceText.svelte`'s own segment split exactly — the same
	// synchronous re-derivation over an async-loaded matcher, so `text`
	// reacting to a future prop change (never expected for an immutable
	// stream/dock line, but free) never trips `state_referenced_locally`.
	const segments = $derived.by(() => {
		if (!enabled || matcher === null) return [{ text, ref: null as string | null }];
		const matches = matcher.match(text);
		if (matches.length === 0) return [{ text, ref: null as string | null }];
		const result: { text: string; ref: string | null }[] = [];
		let cursor = 0;
		for (const match of matches) {
			if (match.start < cursor || match.end <= match.start || match.end > text.length) continue;
			if (match.start > cursor) result.push({ text: text.slice(cursor, match.start), ref: null });
			result.push({ text: text.slice(match.start, match.end), ref: match.target.ref });
			cursor = match.end;
		}
		if (cursor < text.length) result.push({ text: text.slice(cursor), ref: null });
		return result;
	});
</script>

<span class={className}
	>{#each segments as segment, index (`${index}:${segment.text}`)}{#if segment.ref !== null}<InfoLink
				refId={`def:${segment.ref}`}>{segment.text}</InfoLink
			>{:else}{segment.text}{/if}{/each}</span
>
