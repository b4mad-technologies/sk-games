<script lang="ts">
	// The hero sheet and the pack. Both are the shipped widgets; this component
	// lays them out, asks the world for an item's detail when the player picks
	// one, shows the item's SRD sprite and offers what the world lists as
	// actions on that item. The attempt itself is the app's (`onAct`).
	import { Button } from "@spellkave/ui";
	import { Hero, Pack } from "@spellkave/ui-widgets";
	import type { PlayAction, PlayPackItem, PlayView } from "../../../play/src/lib/play-view";
	import type { ActionMenu } from "./menu";
	import SrdArt from "./SrdArt.svelte";

	let {
		view,
		onSelectItem,
		sortActions,
		onAct,
		busy = false,
		result,
		onClose,
	}: {
		view: PlayView;
		/** Ask the world for one item's detail. */
		onSelectItem: (item: PlayPackItem) => void;
		/** The app's own menu order (lead actions, folded groups). */
		sortActions: (actions: readonly PlayAction[]) => ActionMenu;
		/** Try one action on the picked item; `label` names the item. */
		onAct: (action: PlayAction, label: string) => void;
		busy?: boolean;
		/** What the last attempt from this sheet came to. */
		result?: string;
		onClose: () => void;
	} = $props();

	let selectedId = $state<string | null>(null);

	const self = $derived({
		...view.hero,
		// The stage line already says "Level 1 · Fighter".
		sheetVitals: view.hero.vitals.filter((vital) => !(view.hero.level !== undefined && vital.id === "srd/level")),
		...(view.hero.appearance === "" ? { appearance: undefined } : {}),
		...(view.hero.backstory === "" ? { backstory: undefined } : {}),
	});

	// A detail that belongs to an earlier pick is not shown under the new one.
	const detail = $derived(view.itemDetail && view.itemDetail.id === selectedId ? view.itemDetail : null);

	const picked = $derived(view.pack.find((entry) => entry.id === selectedId) ?? null);
	const menu = $derived(detail && !detail.failed ? sortActions(detail.verbs) : null);
	const label = (action: PlayAction) => action.name ?? action.label;

	function act(action: PlayAction) {
		onAct(action, picked ? `${label(action)}: ${picked.name}` : label(action));
	}

	function select(id: string) {
		selectedId = id;
		const item = view.pack.find((entry) => entry.id === id);
		if (item) onSelectItem(item);
	}

	// The widget shows the first item when nothing is picked; ask for that one.
	$effect(() => {
		const first = view.pack[0];
		if (selectedId === null && first) select(first.id);
	});
</script>

<svelte:window onkeydown={(event) => event.key === "Escape" && onClose()} />

<div class="veil" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
	<div class="sheet cm-panel" role="dialog" aria-modal="true" aria-label="Hero sheet and pack">
		<header>
			<span class="sk-title">{view.hero.name}</span>
			<Button size="sm" variant="outline" onclick={onClose}>Close</Button>
		</header>
		<div class="cols">
			<section>
				<Hero {self} density="stage" chrome="bare" infoCards />
			</section>
			<section>
				<p class="sk-label cm-muted">Pack ({view.pack.length})</p>
				{#if view.pack.length === 0}
					<p class="cm-muted">The pack is empty.</p>
				{:else}
					<Pack selectionOnly items={view.pack} {selectedId} onSelect={select} {detail} density="stage" chrome="bare">
						{#snippet artwork(id: string)}
							{#if detail && detail.id === id}
								<SrdArt definitionRef={detail.definitionRef} class="item-art" />
							{/if}
						{/snippet}
					</Pack>
					{#if result}
						<p class="result" role="status">{result}</p>
					{/if}
					{#if picked && menu}
						<div class="do" aria-label={`Actions on ${picked.name}`}>
							<p class="sk-label cm-muted">Do with {picked.name}</p>
							{#if menu.primary.length === 0 && menu.groups.length === 0}
								<p class="cm-muted">The world offers nothing to do with this right now.</p>
							{/if}
							<div class="buttons">
								{#each menu.primary as action (action.id)}
									<Button size="sm" variant="outline" disabled={busy} onclick={() => act(action)}>{label(action)}</Button>
								{/each}
							</div>
							{#each menu.groups as group (group.id)}
								<details>
									<summary class="sk-label cm-muted">{group.label} ({group.actions.length})</summary>
									<div class="buttons">
										{#each group.actions as action (action.id)}
											<Button size="sm" variant="outline" disabled={busy} onclick={() => act(action)}>{label(action)}</Button>
										{/each}
									</div>
								</details>
							{/each}
						</div>
					{/if}
				{/if}
			</section>
		</div>
	</div>
</div>

<style>
	.veil {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: color-mix(in oklab, var(--background) 88%, transparent);
	}
	.sheet {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: min(72rem, 100%);
		max-height: 100%;
		padding: 0.75rem 1rem;
		overflow: hidden;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1rem;
		min-height: 0;
		overflow-y: auto;
	}
	section {
		min-width: 0;
	}
	.do {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
	}
	.do p {
		margin: 0 0 0.3rem;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.4rem;
	}
	.buttons :global(button) {
		min-height: 2.75rem;
	}
	.result {
		margin: 0.5rem 0 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: var(--font-body);
	}
	section :global(.item-art) {
		width: 6rem;
		height: 6rem;
	}
	@media (max-width: 60rem) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
