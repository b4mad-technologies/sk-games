<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		minePlaces = [],
		onDrawableNodes,
		openRail = false,
		railExtra,
		drawerExtra,
		drawerOpen = false,
		drawerPlaceMode = false,
		onDrawerClose,
		onPlaceDetails,
	}: {
		minePlaces?: { placeNodeId: string }[];
		/** The real MapCanvas reports the occupied nodes it has coordinates
		 * for. The stub reports `minePlaces`, so a test says which nodes the
		 * map can draw — and which are off it. */
		onDrawableNodes?: (ids: ReadonlySet<string>) => void;
		openRail?: boolean;
		railExtra?: Snippet;
		drawerExtra?: Snippet;
		drawerOpen?: boolean;
		drawerPlaceMode?: boolean;
		onDrawerClose?: () => void;
		onPlaceDetails?: () => void;
	} = $props();

	$effect(() => {
		onDrawableNodes?.(new Set(minePlaces.map((place) => place.placeNodeId)));
	});
</script>

<div data-testid="canvas-stub">
	{#if openRail}
		{@render railExtra?.()}
	{/if}
	{#if drawerOpen && !drawerPlaceMode}
		{@render drawerExtra?.()}
	{/if}
	{#if drawerOpen}
		<button type="button" data-testid="stub-drawer-close" onclick={() => onDrawerClose?.()}>×</button>
	{/if}
	{#if onPlaceDetails}
		<button type="button" data-testid="stub-place-details" onclick={() => onPlaceDetails?.()}>place-details</button>
	{/if}
</div>
