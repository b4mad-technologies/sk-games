<script lang="ts">
	/**
	 * Stand-in for `@spellkave/map-canvas`'s `MapCanvas`, used only by
	 * `vi.mock("@spellkave/map-canvas", …)` in `App.smoke.test.ts` — the real
	 * component pulls in MapLibre (~207 KB gzipped) via a runtime dynamic
	 * import, which jsdom has no business loading in a unit test. Every prop
	 * `MapTile.svelte` forwards is echoed onto a `data-*` attribute so the test
	 * can assert what actually reached the widget. Like the real canvas, it
	 * reports the place it opens at through `onPlaceClick` on every boot (the
	 * boot selection): on mount, and again when `token`, `slug` or
	 * `gatewayOrigin` changes, which makes the real canvas tear its map down
	 * and boot again. It offers one button per kind of deliberate pick; like
	 * the real canvas, a click reports twice (at once and after the lookup).
	 */
	import { untrack } from "svelte";

	let {
		gatewayOrigin,
		slug,
		token,
		mode,
		placeNodeId,
		onPlaceClick,
		overlay = false,
		occupancyPlaces = [],
		minePlaces = [],
		mineEntityIds = [],
		substrateControl = false,
		followPlace = false,
	}: {
		gatewayOrigin: string;
		slug: string;
		token: string;
		mode: string;
		placeNodeId?: string;
		onPlaceClick?: (place: { name: string; nodeId: string; rows: []; lon: number; lat: number }) => void;
		overlay?: boolean;
		occupancyPlaces?: { entityId: string }[];
		minePlaces?: { entityId: string; placeNodeId: string }[];
		mineEntityIds?: string[];
		substrateControl?: boolean;
		followPlace?: boolean;
	} = $props();

	function report(nodeId: string, name: string): void {
		onPlaceClick?.({ name, nodeId, rows: [], lon: 0, lat: 0 });
	}
	$effect(() => {
		void token;
		void slug;
		void gatewayOrigin;
		untrack(() => {
			if (placeNodeId) report(placeNodeId, "Boot map place");
		});
	});
	function pick(nodeId: string, name: string): void {
		report(nodeId, name);
		// The real canvas looks the clicked place up and reports it again.
		queueMicrotask(() => report(nodeId, name));
	}
</script>

<div
	data-testid="fake-map-canvas"
	data-gateway-origin={gatewayOrigin}
	data-slug={slug}
	data-token={token}
	data-mode={mode}
	data-place-node-id={placeNodeId}
	data-overlay={overlay ? "true" : "false"}
	data-occupancy-count={occupancyPlaces.length}
	data-seat-place={minePlaces.find((row) => mineEntityIds.includes(row.entityId))?.placeNodeId ?? ""}
	data-substrate-control={substrateControl ? "true" : "false"}
	data-follow-place={followPlace ? "true" : "false"}
>
	<button onclick={() => pick("test/destination", "Selected map place")}>Select test map place</button>
	<button onclick={() => { if (placeNodeId) pick(placeNodeId, "Own map place"); }}>Select own map place</button>
</div>
