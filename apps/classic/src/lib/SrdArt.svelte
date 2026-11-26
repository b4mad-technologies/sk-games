<script lang="ts">
	// A sprite for an SRD definition id, or the fallback snippet when the SRD
	// art set has none.
	import type { Snippet } from "svelte";
	import { srdArtUrl } from "./srd-art";

	let { definitionRef, class: className = "", fallback }: { definitionRef: string | undefined; class?: string; fallback?: Snippet } = $props();

	let url = $state<string>();
	$effect(() => {
		let current = true;
		url = undefined;
		void srdArtUrl(definitionRef).then((next) => {
			if (current) url = next;
		});
		return () => {
			current = false;
		};
	});
</script>

{#if url}
	<img class="cm-pixel {className}" src={url} alt="" />
{:else}
	{@render fallback?.()}
{/if}
