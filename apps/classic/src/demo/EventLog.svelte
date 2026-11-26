<script lang="ts">
	// "What happens": the structured world-event stream rendered as lines.
	import { app } from "./state.svelte";

	let scroller = $state<HTMLDivElement>();

	$effect(() => {
		void app.log.length;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<div class="log" bind:this={scroller} aria-live="polite" aria-label="What happens">
	{#each app.log as line (line.id)}
		<p class={line.kind}>
			{#if line.who}<strong>{line.who}:</strong>{/if}
			{line.text}
		</p>
	{:else}
		<p class="system">Nothing has happened yet. Click something in the scene.</p>
	{/each}
</div>

<style>
	.log {
		overflow-y: auto;
		height: 100%;
		padding: 0.5rem 0.75rem;
		font-family: var(--font-body);
		font-size: 0.92rem;
		line-height: 1.45;
	}
	p {
		margin: 0 0 0.3rem;
	}
	.system {
		color: var(--muted-foreground);
		font-style: italic;
	}
	.roll {
		font-family: var(--font-mono);
		font-size: 0.82rem;
	}
	.refusal {
		color: var(--muted-foreground);
		border-left: 2px solid var(--destructive);
		padding-left: 0.5rem;
	}
	.speech strong {
		color: var(--primary);
	}
</style>
