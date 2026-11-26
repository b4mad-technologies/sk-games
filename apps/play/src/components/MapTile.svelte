<script lang="ts">
	import type { ActorPlace, MapCanvasMode, OccupancyPlace, Place } from "@spellkave/map-canvas";
	import type { Snippet } from "svelte";
	import type { PlayMapWatch } from "../lib/map-watch";
	import { type PlayObservation, playObservation } from "../lib/play-observation";

	/**
	 * `@spellkave/map-canvas` — MapLibre plus ~1300 lines of pan/zoom/search/
	 * floor/place-panel/seat-marker logic, ~207 KB gzipped once MapLibre itself
	 * loads inside it — is imported dynamically, and only once `open` first
	 * turns true (the map tile reaches its stage level). A player who never
	 * opens the map tile never downloads it. See `apps/play/CLAUDE.md`, "The
	 * map tile: an accepted exception" (`sk-jay0.1.8.1`, `sk-jay0.1.8.9`).
	 */
	let {
		open,
		mode,
		gatewayOrigin,
		slug,
		token,
		placeNodeId,
		mapHref,
		onPlaceClick,
		controls,
		overlay = false,
		minePlaces = [],
		mineEntityIds = [],
		occupancyPlaces = [],
		watch = null,
	}: {
		/** The map tile is at its stage level. */
		open: boolean;
		/** `"full"` once the tile fills the viewport, `"medium"` otherwise. */
		mode: MapCanvasMode;
		/** `null` when `VITE_SPELLKAVE_GATEWAY_URL` is unset or invalid — the
		 * canvas mounts anyway and reads it as its own `blocked()` case rather
		 * than taking the rest of the table down. */
		gatewayOrigin: string | null;
		slug: string;
		token: string;
		placeNodeId?: string;
		/** The maps site (`VITE_SPELLKAVE_MAPS_URL`), shown as an escape hatch
		 * beside the whole-world note. `null` when it is switched off (`off`,
		 * for a local world): no link, and the note does not name a site. */
		mapHref: string | null;
		onPlaceClick?: (place: Place) => void;
		controls?: Snippet;
		overlay?: boolean;
		minePlaces?: ActorPlace[];
		mineEntityIds?: string[];
		occupancyPlaces?: OccupancyPlace[];
		watch?: PlayMapWatch | null;
	} = $props();
	let radarOn = $state(false);
	/**
	 * The hero's own place marker is always drawn (sk-jay0.1.8.100): without
	 * the observer overlay — or while the overlay's watch has not resolved a
	 * seat yet — the canvas still gets one seat row at the hero's current
	 * place. `HERO_SEAT_KEY` is only the key that joins that row to
	 * `mineEntityIds`; it is never an entity id and never shown. The camera
	 * stays `placeNodeId`'s: `followPlace` makes the canvas fly once per place
	 * and the marker follows it. The canvas itself keeps a follow off
	 * `onPlaceClick` (the hero arriving is not the player choosing), but its
	 * boot (and every later boot) still reports the place it opened at, see
	 * `reportPlacePick`.
	 * Occupancy pins and the radar stay behind `overlay`.
	 */
	const HERO_SEAT_KEY = "play:hero";
	const watchSeat = $derived(overlay && minePlaces.length > 0 && mineEntityIds.length > 0);
	const seatPlaces = $derived<ActorPlace[]>(
		watchSeat ? minePlaces : placeNodeId ? [{ entityId: HERO_SEAT_KEY, placeNodeId }] : [],
	);
	const seatEntityIds = $derived(watchSeat ? mineEntityIds : placeNodeId ? [HERO_SEAT_KEY] : []);
	/** The maps site's host, for the whole-world sentence; never a
	 * hard-coded hosted domain. */
	const mapSiteName = $derived.by(() => {
		if (mapHref === null) return null;
		try {
			return new URL(mapHref).host;
		} catch {
			return null;
		}
	});

	let mapCanvasModule = $state<typeof import("@spellkave/map-canvas") | null>(null);
	let importFailed = $state(false);
	/**
	 * Opening the tile is not a pick (owner ruling 2026-11-12, sk-jay0.1.8.99
	 * E6b). The canvas reports the place it boots at through `onPlaceClick`
	 * exactly like a click, after a lookup that may answer late, and it boots
	 * again whenever its token, slug or gateway origin changes (a token
	 * renewal while the tile is open). None of that is the player choosing a
	 * place, so a report is passed on only when the player acted on the
	 * canvas first: a pointer press, a click or a key inside the canvas mount
	 * arms ONE report, and the next report uses it up. A report that no
	 * gesture armed selects nothing and writes nothing into the composer.
	 * The canvas reports one click twice (at once, and again after its
	 * lookup); the second one is dropped, the host only needs the place id.
	 * A new boot (mount, unmount, or a changed token, slug or origin) disarms.
	 * What this cannot tell apart: a gesture that reports nothing (a pan, a
	 * key in the search box) while a boot lookup is still in flight lets that
	 * boot report through.
	 * Not reactive: only the handlers read it.
	 */
	let gestureArmed = false;
	// `$effect.pre`: runs before the canvas mounts or boots again, so a boot
	// report that arrives synchronously is already unarmed.
	$effect.pre(() => {
		void open;
		void mapCanvasModule;
		void token;
		void slug;
		void gatewayOrigin;
		gestureArmed = false;
	});
	/** Capture phase: armed before the canvas's own handlers report. */
	function armOnGesture(node: HTMLElement): () => void {
		const arm = (): void => {
			gestureArmed = true;
		};
		const kinds = ["pointerdown", "click", "keydown"] as const;
		for (const kind of kinds) node.addEventListener(kind, arm, true);
		return () => {
			for (const kind of kinds) node.removeEventListener(kind, arm, true);
		};
	}
	function reportPlacePick(place: Place): void {
		if (!gestureArmed) return;
		gestureArmed = false;
		onPlaceClick?.(place);
	}
	let lastMapState: PlayObservation["map_state"];
	function reportMapState(state: NonNullable<PlayObservation["map_state"]>): void {
		if (state === lastMapState) return;
		lastMapState = state;
		playObservation.record({ phase: "presentation", interaction: 0, map_state: state });
	}
	$effect(() => { if (!open) reportMapState("closed"); });

	$effect(() => {
		if (!open || mapCanvasModule !== null) return;
		let cancelled = false;
		importFailed = false;
		reportMapState("loading");
		void import("@spellkave/map-canvas").then((mod) => {
			if (!cancelled) mapCanvasModule = mod;
		}).catch(() => { if (!cancelled) { importFailed = true; reportMapState("failed"); } });
		return () => {
			cancelled = true;
		};
	});
</script>

{#if open}
	<div class="map-tile-stage">
		<div class="map-tile-canvas" data-testid="map-tile-canvas-mount" {@attach armOnGesture}>
			{#if mapCanvasModule}
				<mapCanvasModule.MapCanvas
					gatewayOrigin={gatewayOrigin ?? ""}
					{slug}
					{token}
					{mode}
					{placeNodeId}
					followPlace
					onPlaceClick={reportPlacePick}
					minePlaces={seatPlaces}
					mineEntityIds={seatEntityIds}
					overlay={overlay}
					occupancyPlaces={overlay ? occupancyPlaces : []}
					placeDetails={playPlaceDetails}
					onNotice={(notice) => reportMapState(notice.kind)}
					notices={{
						blocked: "The map connection is unavailable. You can still explore through Place; reopen the world to reconnect.",
						failed: "The map could not be loaded. Close and reopen Map to retry; Place remains available.",
					}}
				/>
			{:else if importFailed}
				<p role="status">The map controls could not load. Close and reopen Map to retry.</p>
			{:else}
				<div class="map-tile-skeleton" data-testid="map-tile-loading" aria-hidden="true"></div>
			{/if}
		</div>
		<!-- Accepted exception (operator, 2026-09-02, sk-jay0.1.8.1): the
		     gateway's tile routes are whole-world, not seat-scoped, so this
		     note holds until sk-adr8.15 lands (sk-ubx carries the play-side
		     rule). A `flex: 0 0 auto` sibling of the canvas, not stacked inside
		     its scroll — `.map-tile-stage` gives the canvas `flex: 1` so this
		     row always stays in view instead of the tile's scroller clipping
		     it below the fold. The escape-hatch link to the configured maps
		     site (absent when none is configured) rides the same row so it never trails off as a second, easily
		     clipped line of its own. -->
		{#if overlay && watch && mapCanvasModule}
			<div class="map-tile-radar" data-testid="maps-radar">
				<button type="button" class="map-tile-radar-toggle" aria-pressed={radarOn} onclick={() => (radarOn = !radarOn)}>Radar</button>
				{#if radarOn}
					<mapCanvasModule.Radar
						oldestTick={watch.oldestTick}
						latestTick={watch.latestTick}
						cursorTick={watch.cursorTick}
						live={watch.live}
						events={watch.events}
						onPause={watch.pause}
						onPlay={watch.play}
						onScrub={watch.scrub}
					/>
				{/if}
			</div>
		{/if}
		<div class="map-tile-footer">
			<p class="play-map-whole-world">
				{#if mapSiteName}
					You're seeing the whole world here, the same as {mapSiteName} — per-seat fog of war
					comes later.
				{:else}
					You're seeing the whole world here — per-seat fog of war comes later.
				{/if}
			</p>
			{#if mapHref !== null}<a class="map-tile-open-link" href={mapHref}>Open the full map →</a>{/if}
		</div>
		{#if controls}<div class="map-tile-controls">{@render controls()}</div>{/if}
	</div>
{/if}

{#snippet playPlaceDetails(place: Place)}
	{@const description = place.rows.find((row) => row.key === "description")?.value}
	{@const floor = place.rows.find((row) => row.key === "level")?.value}
	{#if description}<p class="m-0 text-sm leading-relaxed">{description}</p>{/if}
	{#if floor}<p class="m-0 text-xs text-muted-foreground">Floor {floor}</p>{/if}
{/snippet}
