<script lang="ts" module>
	export type MenuEntry = {
		id: string;
		label: string;
		/** Small text on the right: cost, range, or the last refusal. */
		hint?: string;
		/** Refused earlier at this world revision; shown muted, still clickable. */
		refused?: boolean;
		art?: string;
	};

	/** A folded second level: one row that opens its entries in place. */
	export type MenuFold = { id: string; label: string; entries: MenuEntry[] };
</script>

<script lang="ts">
	// The point-and-click menu: opens where the player clicked, lists the
	// actions the client paired with that target, and closes on Escape or an
	// outside click.
	let {
		title,
		subtitle,
		entries,
		folds = [],
		x,
		y,
		onPick,
		onClose,
	}: {
		title: string;
		subtitle?: string;
		entries: MenuEntry[];
		folds?: MenuFold[];
		x: number;
		y: number;
		onPick: (id: string) => void;
		onClose: () => void;
	} = $props();

	let node = $state<HTMLDivElement>();
	let openFold = $state<string | null>(null);
	// Keep the menu inside the window.
	const left = $derived(Math.max(8, Math.min(x, window.innerWidth - 260)));
	const top = $derived(Math.max(8, Math.min(y, window.innerHeight - 60 - (entries.length + folds.length) * 48)));

	$effect(() => {
		node?.querySelector<HTMLButtonElement>("button")?.focus();
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape") onClose();
	}}
/>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="veil" onclick={onClose}></div>
<div class="menu" bind:this={node} role="menu" aria-label={`Actions for ${title}`} style:left={`${left}px`} style:top={`${top}px`}>
	<header>
		<span class="sk-label">{title}</span>
		{#if subtitle}<small>{subtitle}</small>{/if}
	</header>
	{#snippet row(entry: MenuEntry)}
		<button type="button" role="menuitem" class:refused={entry.refused} onclick={() => onPick(entry.id)}>
			{#if entry.art}<img class="cm-pixel" src={entry.art} alt="" />{/if}
			<span>{entry.label}</span>
			{#if entry.hint}<small>{entry.hint}</small>{/if}
		</button>
	{/snippet}
	{#each entries as entry (entry.id)}
		{@render row(entry)}
	{/each}
	{#each folds as fold (fold.id)}
		<button type="button" role="menuitem" class="fold" aria-expanded={openFold === fold.id} onclick={() => (openFold = openFold === fold.id ? null : fold.id)}>
			<span>{fold.label}</span>
			<small>{fold.entries.length} {openFold === fold.id ? "▾" : "▸"}</small>
		</button>
		{#if openFold === fold.id}
			<div class="folded">
				{#each fold.entries as entry (entry.id)}
					{@render row(entry)}
				{/each}
			</div>
		{/if}
	{/each}
	{#if entries.length === 0 && folds.length === 0}
		<p>Nothing to do here.</p>
	{/if}
</div>

<style>
	.veil {
		position: fixed;
		inset: 0;
		z-index: 40;
	}
	.folded {
		max-height: 14rem;
		overflow-y: auto;
		border-left: 2px solid var(--border);
		margin-left: 0.6rem;
	}
	.menu {
		position: fixed;
		z-index: 41;
		width: 15.5rem;
		background: var(--popover);
		color: var(--popover-foreground);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 0.25rem;
		box-shadow: var(--control-shadow, 0 4px 12px rgb(0 0 0 / 0.3));
	}
	header {
		display: flex;
		flex-direction: column;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0.25rem;
	}
	small {
		color: var(--muted-foreground);
		font-size: 0.72rem;
	}
	button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.75rem;
		padding: 0.25rem 0.6rem;
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
	}
	button span {
		flex: 1;
	}
	button:hover,
	button:focus-visible {
		background: var(--accent);
		color: var(--accent-foreground);
		outline: none;
	}
	button.refused span {
		text-decoration: line-through;
		color: var(--muted-foreground);
	}
	img {
		width: 1.75rem;
		height: 1.75rem;
	}
	p {
		padding: 0.5rem 0.6rem;
		color: var(--muted-foreground);
	}
</style>
