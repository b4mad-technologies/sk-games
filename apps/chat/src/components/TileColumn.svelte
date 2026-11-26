<script lang="ts">
	import { Hero, Occupants, Pack, PlaceMap, Scene } from "@spellkave/ui-widgets";
	import { onMount } from "svelte";
	import { TILE_NAMES, type TileName } from "../lib/tiles/index.ts";
	import { startTileStore, tiles } from "../lib/tiles/state.svelte.ts";

	onMount(() => startTileStore());

	function caption(name: TileName): string | undefined {
		const seen = tiles.seen[name];
		if (seen === undefined) return undefined;
		return `seen at ${new Date(seen.at).toISOString()} via ${seen.tool}`;
	}
</script>

<aside
	data-testid="tile-column"
	class="flex w-full flex-col gap-3 lg:w-72 lg:shrink-0"
	aria-label="World tiles"
>
	{#each TILE_NAMES as name (name)}
		<section
			data-testid={`tile-${name}`}
			class="rounded-[var(--radius)] border border-border bg-card p-4"
		>
			<h2
				class="[font-family:var(--font-display)] text-sm font-medium tracking-[0.08em] text-foreground uppercase"
			>
				{name}
			</h2>
			{#if name === "Hero" && tiles.hero}
				<div class="mt-2">
					<Hero self={tiles.hero.self} />
				</div>
				<p class="mt-2 text-xs text-muted-foreground">{caption(name)}</p>
			{:else if name === "Scene" && tiles.scene}
				<div class="mt-2">
					<Scene place={tiles.scene.place} />
				</div>
				<p class="mt-2 text-xs text-muted-foreground">{caption(name)}</p>
			{:else if name === "Pack" && tiles.pack}
				<div class="mt-2">
					<Pack items={tiles.pack.items} />
				</div>
				<p class="mt-2 text-xs text-muted-foreground">{caption(name)}</p>
			{:else if name === "Occupants" && tiles.occupants}
				<div class="mt-2">
					<Occupants occupants={tiles.occupants.occupants} />
				</div>
				<p class="mt-2 text-xs text-muted-foreground">{caption(name)}</p>
			{:else if name === "Map" && tiles.map}
				<div class="mt-2">
					<PlaceMap frame={tiles.map.frame} />
				</div>
				{#if tiles.mapSvg}
					<div class="mt-3 max-h-48 overflow-auto" data-testid="tile-map-svg">
						{@html tiles.mapSvg}
					</div>
				{/if}
				<p class="mt-2 text-xs text-muted-foreground">{caption(name)}</p>
			{:else}
				<p class="mt-2 text-xs text-muted-foreground">not seen yet</p>
			{/if}
		</section>
	{/each}
</aside>
