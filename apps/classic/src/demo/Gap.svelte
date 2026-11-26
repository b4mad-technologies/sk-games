<script lang="ts">
	// A visible marker for something the mock-up fakes because no read exists
	// today. Toggled by "Show gaps" in the top bar.
	import { app } from "./state.svelte";

	let { title, where }: { title: string; where?: string } = $props();
</script>

{#if app.showGaps}
	<aside class="gap" aria-label="Known gap">
		<strong>Gap</strong>
		<span>{title}</span>
		{#if where}<code>{where}</code>{/if}
	</aside>
{/if}

<style>
	.gap {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
		border: 1px dashed var(--status-waiting, var(--ring));
		border-radius: var(--radius-sm);
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1.3;
		color: var(--muted-foreground);
	}
	.gap strong {
		color: var(--foreground);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 0.65rem;
	}
	.gap code {
		font-size: 0.7rem;
		overflow-wrap: anywhere;
	}
</style>
