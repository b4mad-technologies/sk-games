<script lang="ts">
	import {
		type ActorPlace,
		buildMapsLocator,
		copyText,
		MapCanvas,
		type OccupancyPlace,
		type Place,
		parseMapsLocator,
		publishMapsLocator,
		Radar,
		type SubstrateFilter,
	} from "@spellkave/map-canvas";
	import { Button, Card } from "@spellkave/ui";
	import { CopyLocator, Inspect } from "@spellkave/ui-widgets";
	import {
		DescriptionField,
		type DocsRowEntryView,
		EntryHeading,
		FieldList,
		ReferenceGroup,
	} from "@spellkave/ui-widgets/catalogue";
	import { onMount, type Snippet } from "svelte";
	import { type DrawerFrame, type DrawerLinks, drawerRowView } from "../lib/drawer-view";
	import {
		carriedFromWatch,
		entityDetailFromWatch,
		humanizePlaceNode,
		type MineWatchArgs,
		offMapNotice,
		thingsFromWatch,
	} from "../lib/watch-view";
	import DrawerArtwork from "./DrawerArtwork.svelte";

	let {
		gatewayOrigin,
		slug,
		token,
		placeNodeId,
		minePlaces,
		mineEntityIds,
		occupancyPlaces,
		overlay,
		watchArgs,
		selectedEntityId = $bindable<string | null>(null),
		selectedThingId = $bindable<string | null>(null),
		selectionPending = false,
		seal,
	}: {
		gatewayOrigin: string;
		slug: string;
		token: string;
		placeNodeId?: string;
		minePlaces: ActorPlace[];
		mineEntityIds: string[];
		occupancyPlaces: OccupancyPlace[];
		overlay: boolean;
		watchArgs: MineWatchArgs | null;
		selectedEntityId?: string | null;
		selectedThingId?: string | null;
		/** True while the current selection is an un-vouched deep link —
		 * onPlaceClear must not wipe it (sk-jay0.4.4.1). */
		selectionPending?: boolean;
		seal?: Snippet;
	} = $props();

	let occupancyOn = $state(true);
	let thingsOn = $state(true);
	let graphsOn = $state(true);
	let activeSubstrate = $state<SubstrateFilter>("all");
	let radarOn = $state(false);
	let satelliteOn = $state(true);
	let satelliteAvailable = $state(false);
	let layersOpen = $state(false);
	let mapBoot = $state(true);
	let picked = $state<Place | null>(null);
	/** Node ids the map has coordinates for (from MapCanvas's occupancy sync).
	 * Empty until the first sync — an empty set must not mislabel actors
	 * before the map has reported anything. */
	let drawableNodes = $state<ReadonlySet<string>>(new Set());
	/** Drawer subject (sk-jay0.4.4.5): the next-larger rendering of the rail
	 * card's subject, fanned out right of the rail. EPHEMERAL BY DESIGN — the
	 * URL locator stays /person|thing|place/<id> and deep links open the rail
	 * card only; the drawer is never shareable state. */
	type DrawerSubject = { kind: "person" | "thing" | "place"; id: string };
	let drawer = $state<DrawerSubject | null>(null);

	const selectedActor = $derived(
		watchArgs?.actors.find((actor) => actor.entityId === selectedEntityId),
	);
	const selectedDetail = $derived(entityDetailFromWatch(selectedActor));
	const selectedOffMap = $derived(
		offMapNotice(selectedActor?.placeNodeId ?? "", drawableNodes),
	);
	const selectedThing = $derived(
		(watchArgs?.items ?? []).find((item) => item.entityId === selectedThingId),
	);
	const selectedThingOffMap = $derived(
		offMapNotice(selectedThing?.placeNodeId ?? "", drawableNodes),
	);
	const shownOccupancy = $derived(
		overlay && occupancyOn ? occupancyPlaces : ([] as OccupancyPlace[]),
	);
	const inspectOpen = $derived(
		overlay && (selectedActor !== undefined || selectedThing !== undefined),
	);
	function onPlaceClick(place: Place): void {
		picked = place;
		selectedEntityId = null;
		selectedThingId = null;
		layersOpen = false;
		if (drawer !== null && place.nodeId !== null) drawer = { kind: "place", id: place.nodeId };
	}

	function onPlaceClear(): void {
		picked = null;
		if (!selectionPending) selectedEntityId = null;
	}

	function selectPerson(entityId: string): void {
		selectedEntityId = entityId;
		selectedThingId = null;
		picked = null;
		layersOpen = false;
		// A new selection REPLACES an open drawer with the new subject — never
		// two drawers, never a stale one (operator ask, sk-jay0.4.4.5).
		if (drawer !== null) drawer = { kind: "person", id: entityId };
		publishMapsLocator(slug, "person", entityId);
	}

	function onActorClick(place: OccupancyPlace): void {
		selectPerson(place.entityId);
	}

	function selectPlace(nodeId: string): void {
		selectedEntityId = null;
		selectedThingId = null;
		publishMapsLocator(slug, "place", nodeId, true);
	}

	/** Drawer body links are Maps locators, so routing them is a parse and a
	 * selection — never the docs catalogue's `catalogueOpen` (which would
	 * pushState a docs route and scroll a page Maps does not have). */
	function drawerNavigate(href: string, event: MouseEvent): void {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		const locator = parseMapsLocator(href);
		if (locator.person !== null) {
			selectPerson(locator.person);
			return;
		}
		if (locator.thing !== null) {
			onThingClick(locator.thing);
			return;
		}
		if (locator.place !== null) selectPlace(locator.place);
	}

	const drawerFrame = $derived<DrawerFrame>({
		actors: watchArgs?.actors ?? [],
		items: watchArgs?.items ?? [],
		occupancy: occupancyPlaces,
		drawableNodes,
	});
	const drawerLinks: DrawerLinks = {
		person: (entityId) => buildMapsLocator(window.location.href, slug, "person", entityId),
		thing: (entityId) => buildMapsLocator(window.location.href, slug, "thing", entityId),
		place: (nodeId) => buildMapsLocator(window.location.href, slug, "place", nodeId),
	};
	/** The drawer body as a catalogue row. `place` stays null on purpose:
	 * MapCanvas owns the place drawer body (`drawerPlaceMode`). */
	const drawerRow = $derived.by((): DocsRowEntryView | null => {
		if (drawer === null) return null;
		if (drawer.kind === "person" && selectedActor !== undefined) {
			return drawerRowView({ kind: "person", actor: selectedActor }, drawerFrame, drawerLinks);
		}
		if (drawer.kind === "thing" && selectedThing !== undefined) {
			return drawerRowView({ kind: "thing", item: selectedThing }, drawerFrame, drawerLinks);
		}
		return null;
	});

	function onThingClick(entityId: string): void {
		selectedThingId = entityId;
		selectedEntityId = null;
		picked = null;
		layersOpen = false;
		if (drawer !== null) drawer = { kind: "thing", id: entityId };
		publishMapsLocator(slug, "thing", entityId);
	}

	function toggleDrawer(kind: DrawerSubject["kind"], id: string): void {
		drawer = drawer !== null && drawer.kind === kind && drawer.id === id ? null : { kind, id };
	}

	function closePreview(): void {
		picked = null;
		selectedEntityId = null;
	}

	function toggleOccupancy(): void {
		occupancyOn = !occupancyOn;
	}

	function toggleThings(): void {
		thingsOn = !thingsOn;
	}

	function toggleGraphs(): void {
		graphsOn = !graphsOn;
	}

	function toggleRadar(): void {
		radarOn = !radarOn;
	}

	function toggleSatellite(): void {
		satelliteOn = !satelliteOn;
	}

	function toggleLayers(): void {
		layersOpen = !layersOpen;
	}

	onMount(() => {
		const dismiss = (): void => {
			mapBoot = false;
		};
		window.addEventListener("spellkave-maps-ready", dismiss);
		const timer = window.setTimeout(dismiss, 12000);
		// Esc closes the drawer FIRST (capture phase, before MapCanvas's
		// clearPlace) so the rail card survives (sk-jay0.4.4.5 acceptance 3).
		const onKeydown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape" || drawer === null) return;
			drawer = null;
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		window.addEventListener("keydown", onKeydown, true);
		return () => {
			window.removeEventListener("spellkave-maps-ready", dismiss);
			window.removeEventListener("keydown", onKeydown, true);
			window.clearTimeout(timer);
		};
	});

	// Losing the subject (deselect, clear search, rail close) closes the drawer.
	$effect(() => {
		if (!inspectOpen && picked === null && drawer !== null) drawer = null;
	});
</script>

<div class="maps-canvas" data-testid="maps-canvas">
	<div class="maps-map">
		<MapCanvas
			{gatewayOrigin}
			{slug}
			{token}
			mode="full"
			chrome="maps"
			navigationPosition="bottom-right"
			{placeNodeId}
			{minePlaces}
			{mineEntityIds}
			occupancyPlaces={shownOccupancy}
			thingPlaces={overlay && thingsOn ? thingsFromWatch(watchArgs?.items ?? []) : []}
			onDrawableNodes={(ids) => {
				drawableNodes = ids;
			}}
			indoorEmphasis={graphsOn}
			satellite={satelliteOn}
			onSatelliteAvailability={(available) => {
				satelliteAvailable = available;
				if (!available) satelliteOn = false;
			}}
			substrate={activeSubstrate}
			openRail={inspectOpen}
			railExtra={inspectRail}
			drawerOpen={drawer !== null}
			drawerPlaceMode={drawer?.kind === "place"}
			onDrawerClose={() => {
				drawer = null;
			}}
			drawerExtra={drawerContent}
			onPlaceDetails={() => {
				if (picked?.nodeId != null) toggleDrawer("place", picked.nodeId);
			}}
			{onPlaceClick}
			{onPlaceClear}
			{onActorClick}
			onNotice={(notice) => {
				mapBoot = notice.kind === "loading";
			}}
		/>
	</div>
	{#if mapBoot}
		<div class="maps-boot" role="status" aria-live="polite" data-testid="maps-boot">
			<div class="maps-boot__track" aria-hidden="true"><div class="maps-boot__bar"></div></div>
			<p class="maps-boot__label">Opening the map…</p>
		</div>
	{/if}

{#snippet drawerContent()}
	<!-- The drawer is a REFERENCE over the live world, the same job the docs
	     site does over the adventure and the SRD — so it renders through the
	     catalogue widgets over `drawerRowView`'s projection, not through the
	     play widgets (sk-jay0.4.4.7). -->
	{#if drawerRow}
		<div class="flex flex-col gap-3" data-testid="maps-drawer-entry">
			{#if drawer?.kind === "person" && selectedActor?.art}
				<DrawerArtwork art={selectedActor.art} {gatewayOrigin} {slug} {token} label={selectedActor.name} />
			{:else if drawer?.kind === "thing" && selectedThing?.art}
				<DrawerArtwork art={selectedThing.art} {gatewayOrigin} {slug} {token} label={selectedThing.name} />
			{/if}
			<EntryHeading row={drawerRow} chrome={false} />
			{#if drawerRow.description}
				<DescriptionField description={drawerRow.description} />
			{/if}
			<FieldList fields={drawerRow.fields} navigate={drawerNavigate} />
			{#each drawerRow.references ?? [] as group (group.label)}
				<ReferenceGroup {group} onNavigate={drawerNavigate} />
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet inspectRail()}
	{#if inspectOpen && selectedActor && selectedDetail && selectedEntityId}
		<section class="mt-4 border-t border-border pt-3" data-testid="maps-preview">
			{#if selectedOffMap !== null}
				<p class="pb-2 text-xs text-muted-foreground" data-testid="maps-offmap-notice">
					{selectedOffMap}
				</p>
			{/if}
			<Inspect
				title={selectedActor.name}
				onDetails={() => toggleDrawer("person", selectedActor.entityId)}
				description={selectedActor.description ?? ""}
				facts={selectedDetail.facts.map((fact) => {
					if (
						fact.id !== "place" ||
						selectedActor.placeNodeId === "" ||
						selectedOffMap !== null
					) {
						return { label: fact.label, value: fact.value };
					}
					const nodeId = selectedActor.placeNodeId;
					return {
						label: fact.label,
						value: fact.value,
						href: buildMapsLocator(window.location.href, slug, "place", nodeId),
						onClick: (event: MouseEvent) => {
							event.preventDefault();
							selectedEntityId = null;
							publishMapsLocator(slug, "place", nodeId, true);
						},
					};
				})}
				carried={carriedFromWatch(
					watchArgs?.items ?? [],
					selectedActor.entityId,
					(id) => buildMapsLocator(window.location.href, slug, "thing", id),
				)}
				onSelectCarried={onThingClick}
				here={occupancyPlaces
					.filter(
						(row) =>
							row.placeNodeId === selectedActor.placeNodeId && row.entityId !== selectedActor.entityId,
					)
					.map((row) => ({ id: row.entityId, name: row.name }))}
				onSelectHere={(id) => {
					selectedEntityId = id;
					publishMapsLocator(slug, "person", id);
				}}
			/>
			<CopyLocator
				url={buildMapsLocator(window.location.href, slug, "person", selectedActor.entityId)}
				copy={copyText}
			/>
		</section>
	{/if}
	{#if inspectOpen && selectedThing && selectedThingId}
		<section class="mt-4 border-t border-border pt-3" data-testid="maps-preview">
			{#if selectedThingOffMap !== null}
				<p class="pb-2 text-xs text-muted-foreground" data-testid="maps-offmap-notice">
					{selectedThingOffMap}
				</p>
			{/if}
			<Inspect
				label="Thing"
				onDetails={() => toggleDrawer("thing", selectedThing.entityId)}
				title={selectedThing.name}
				facts={[
					{
						label: "Holder",
						value: selectedThing.holderName ?? selectedThing.holderEntityId ?? "—",
						href:
							selectedThing.holderEntityId !== null
								? buildMapsLocator(
										window.location.href,
										slug,
										"person",
										selectedThing.holderEntityId,
									)
								: undefined,
						onClick: (event: MouseEvent) => {
								if (selectedThing.holderEntityId === null) return;
								event.preventDefault();
								onActorClick({
									entityId: selectedThing.holderEntityId,
									placeNodeId: selectedThing.placeNodeId,
									name: selectedThing.holderName ?? "",
								});
							},
						},
					{
						label: "Place",
						value: humanizePlaceNode(selectedThing.placeNodeId),
						href:
							selectedThing.placeNodeId !== "" && selectedThingOffMap === null
								? buildMapsLocator(
										window.location.href,
										slug,
										"place",
										selectedThing.placeNodeId,
									)
								: undefined,
						onClick: (event: MouseEvent) => {
								event.preventDefault();
								selectedThingId = null;
								publishMapsLocator(slug, "place", selectedThing.placeNodeId, true);
							},
						},
				]}
			/>
			<CopyLocator
				url={buildMapsLocator(window.location.href, slug, "thing", selectedThing.entityId)}
				copy={copyText}
			/>
		</section>
	{/if}
	{#if overlay && watchArgs && watchArgs.events.length > 0 && (inspectOpen || picked)}
		<section class="mt-4 flex flex-col gap-1 border-t border-border pt-3" data-testid="maps-activity" aria-label="Recent activity">
			<h3 class="maps-place-section">Recent</h3>
			{#each watchArgs.events.slice(-8).reverse() as event (event.id)}
				<p class="text-xs text-muted-foreground">
					tick {event.tick} · {event.summary ?? event.kind}
				</p>
			{/each}
		</section>
	{/if}
{/snippet}

	<div class="maps-layers">
		{#if layersOpen}
			<Card
				size="sm"
				id="maps-layers-panel"
				class="maps-layers-panel"
				role="toolbar"
				aria-label="Map layers"
			>
				<div class="px-2 pt-1 pb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Map type</div>
				<Button
					variant={!satelliteOn ? "secondary" : "ghost"}
					class="h-auto min-h-10 w-full flex-col items-start gap-0.5 py-1.5"
					aria-pressed={!satelliteOn}
					data-testid="layer-map"
					onclick={() => {
						satelliteOn = false;
					}}
				>
					<span>Map</span>
					<span class="text-xs font-normal text-muted-foreground">Places and paths</span>
				</Button>
				<Button
					variant={satelliteAvailable && satelliteOn ? "secondary" : "ghost"}
					class="h-auto min-h-10 w-full flex-col items-start gap-0.5 py-1.5"
					aria-pressed={satelliteAvailable && satelliteOn}
					disabled={!satelliteAvailable}
					data-testid="layer-satellite"
					onclick={() => {
						if (satelliteAvailable) satelliteOn = true;
					}}
				>
					<span>Satellite</span>
					<span class="text-xs font-normal text-muted-foreground">{satelliteAvailable ? "Outdoor imagery under the map" : "No outdoor imagery installed"}</span>
				</Button>

				<div class="px-2 pt-2 pb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/60 mt-1">Substrate</div>
				<div class="grid grid-cols-2 gap-1 p-1 bg-muted/40 rounded-lg" data-testid="substrate-control" role="group" aria-label="Substrate">
					<Button
						variant={activeSubstrate === "all" ? "secondary" : "ghost"}
						size="sm"
						class="h-7 text-xs justify-center"
						aria-pressed={activeSubstrate === "all"}
						onclick={() => activeSubstrate = "all"}
					>
						All
					</Button>
					<Button
						variant={activeSubstrate === "outdoor" ? "secondary" : "ghost"}
						size="sm"
						class="h-7 text-xs justify-center"
						aria-pressed={activeSubstrate === "outdoor"}
						onclick={() => activeSubstrate = "outdoor"}
					>
						Outdoor
					</Button>
					<Button
						variant={activeSubstrate === "indoor" ? "secondary" : "ghost"}
						size="sm"
						class="h-7 text-xs justify-center"
						aria-pressed={activeSubstrate === "indoor"}
						onclick={() => activeSubstrate = "indoor"}
					>
						Indoor
					</Button>
					<Button
						variant={activeSubstrate === "tactical" ? "secondary" : "ghost"}
						size="sm"
						class="h-7 text-xs justify-center text-rose-400 font-medium"
						aria-pressed={activeSubstrate === "tactical"}
						onclick={() => activeSubstrate = "tactical"}
					>
						Tactical
					</Button>
				</div>

				<div class="px-2 pt-2 pb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/60 mt-1">Details & Overlays</div>
				<Button
					variant={graphsOn ? "secondary" : "ghost"}
					class="h-auto min-h-10 w-full flex-col items-start gap-0.5 py-1.5"
					aria-pressed={graphsOn}
					onclick={toggleGraphs}
				>
					<span>Indoor Floors</span>
					<span class="text-xs font-normal text-muted-foreground">Floors above zoom and compass</span>
				</Button>
				<Button
					variant={overlay && occupancyOn ? "secondary" : "ghost"}
					class="h-auto min-h-10 w-full flex-col items-start gap-0.5 py-1.5"
					aria-pressed={overlay && occupancyOn}
					disabled={!overlay}
					onclick={toggleOccupancy}
				>
					<span>People</span>
					<span class="text-xs font-normal text-muted-foreground">{overlay ? "Who is where" : "Needs an observer grant"}</span>
				</Button>
				<Button
					variant={overlay && thingsOn ? "secondary" : "ghost"}
					class="h-auto min-h-10 w-full flex-col items-start gap-0.5 py-1.5"
					aria-pressed={overlay && thingsOn}
					disabled={!overlay}
					onclick={toggleThings}
				>
					<span>Things</span>
					<span class="text-xs font-normal text-muted-foreground">{overlay ? "Carried and placed items" : "Needs an observer grant"}</span>
				</Button>
				<Button
					variant={overlay && radarOn ? "secondary" : "ghost"}
					class="h-auto min-h-10 w-full flex-col items-start gap-0.5 py-1.5"
					aria-pressed={overlay && radarOn}
					disabled={!overlay}
					onclick={toggleRadar}
				>
					<span>Radar</span>
					<span class="text-xs font-normal text-muted-foreground">{overlay ? "Movement since you started watching" : "Needs an observer grant"}</span>
				</Button>
			</Card>
		{/if}
		<Button
			variant="outline"
			aria-expanded={layersOpen}
			aria-controls="maps-layers-panel"
			aria-label="Map layers"
			onclick={toggleLayers}
		>
			Layers
		</Button>
	</div>


	{#if overlay && radarOn && watchArgs}
		<div class="maps-radar" data-testid="maps-radar">
			<Radar
				oldestTick={watchArgs.oldestTick}
				latestTick={watchArgs.latestTick}
				cursorTick={watchArgs.cursorTick}
				live={watchArgs.live}
				events={watchArgs.events}
				onPause={watchArgs.pause}
				onPlay={watchArgs.play}
				onScrub={watchArgs.scrub}
			/>
		</div>
	{/if}


	{#if seal}
		<div class="maps-seal">{@render seal()}</div>
	{/if}
</div>
