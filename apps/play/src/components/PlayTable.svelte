<script lang="ts">
	import { type IntentInputValues, utteranceFromInputValues } from "@spellkave/sdk";
	import type { DockHotbarUrgent, InfoCardData } from "@spellkave/ui";
	import { Button, InfoCardProvider, InfoLink } from "@spellkave/ui";
	import {
		Actions,
		ActivityFeed,
		ActivitySectionHeader,
		ActivityStatus,
		BattleMap,
		Combat,
		Hero,
		hasGridCells,
		InfoHint,
		Pack,
		PlaceMap,
		PlacePanel,
		SpeechBubble,
		sanitiseSvg,
	} from "@spellkave/ui-widgets";
	import { onMount, type Snippet, tick, untrack } from "svelte";
	import { assignSlotKeys, composerSlot, type HotbarMemory, hotbarFromView, hotbarRows, rememberHotbar } from "../lib/dock-hotbar";
	import {
	composerActions,
	composerPrompts,
	composerTargets,
	emptyComposerDraft,
	intentFromComposer,
	targetForSelection,
} from "../lib/fact-composer";
	import { createFollowScroll } from "../lib/follow-scroll.svelte";
	import { resolveInfoCard } from "../lib/info-cards";
	import {
		commandForKey,
		KEYMAP_CHANGE_EVENT,
		keyLabelFor,
		loadKeymap,
		type PlayCommand,
		SLOT_COUNT,
		slotIndexOf,
	} from "../lib/keymap";
	import type { PlayMapWatch } from "../lib/map-watch";
	import {
		applyEdgeDrag,
		belowSibling,
		canResizeRowBoundary,
		columnIndexOf,
		columnIsNarrowInLayout,
		columnTemplateFromLayout,
		DESKTOP_COLUMNS,
		fightLayout,
		focusedLayout,
		lerpLayout,
		levelInLayout,
		MOBILE_ORDER,
		type MosaicLayout,
		mobileRowTemplateFromLayout,
		restLayout,
		rowTemplateFromLayout,
		TILE_IDS,
		TILE_TITLES,
		type TileId,
		tileFillsViewport,
		tileSizeInLayout,
	} from "../lib/mosaic";
	import {
		type ActionSurface,
		contextualActions,
		isGenericCheckAction,
		isPlaceDetailVerb,
		isTableBoundOffer,
		retainActionClassification,
	} from "../lib/play-action-context";
	import type { PlayChronicleEntry } from "../lib/play-chronicle";
	import { resourcePipsFromBudget } from "../lib/play-economy";
	import { descriptionObservation, type FieldSurface, fieldObservation } from "../lib/play-field-observation";
	import { activityObservation, playObservation } from "../lib/play-observation";
	import {
		type ActStatusKind,
		actStatusKindFromOutcome,
		combatFromView,
		combatHandles,
		type DockAnswer,
		dialogueFromView,
		dockNoticeFrom,
		EXPLORE_ACTIVITY_LIMIT,
		type ExploreActivity,
		type ExploreActivityDisplayValue,
		type ExplorePlaceDivider,
		type ExploreStreamEntry,
		exploreContextFromView,
		exploreStreamFromView,
		groupActionsByTarget,
		hasTacticalSession,
		heroDownedFromView,
		mapFrameFromView,
		nodeOfActor,
		offeredAction,
		splitDockAnswers,
		talkDockFromView,
		targetsFromView,
		threadFromView,
		threadLineIdsForPlace,
		tokensByNode,
		UNTARGETED_TARGET_REF,
		verbName,
		verbsForTarget,
		xpProgressLabel,
	} from "../lib/play-table";
	import { playTrail } from "../lib/play-trail";
	import {
		actionTakesInput,
		CHRONICLE_CHIP_LABELS,
		type ChronicleFilterChip,
		type PlayAction,
		type PlayExit,
		type PlayOccupantDetail,
		type PlaySpeech,
		type PlayView,
	} from "../lib/play-view";
	import { playCopy } from "../lib/player-copy";
	import { readDefinitionCard } from "../lib/reference-adapter";
	import {
		type Selection,
		selectionAfterArrival,
		selectionRing,
		selectionRowFromView,
		stepSelection,
	} from "../lib/selection";
	import DefLinkText from "./DefLinkText.svelte";
	import MapTile from "./MapTile.svelte";
	import MosaicGlyph from "./MosaicGlyph.svelte";
	import PlaceReference from "./PlaceReference.svelte";
	import PlayDock from "./PlayDock.svelte";
	import TalkParticipants, { type ThreadParticipant } from "./TalkParticipants.svelte";
	import Thread from "./Thread.svelte";
	import WorldArt from "./WorldArt.svelte";

	let {
		view,
		busy,
		busyActionId = null,
		status,
		statusKind = "other",
		reconnecting = false,
		statusMessage,
		refusal = null,
		mapHref,
		gatewayOrigin,
		slug,
		token,
		mapWatch = null,
		seal,
		dockExtras,
		resetLayoutRequest,
		initialLayout,
		initialLayoutMobile,
		onLayoutChange,
		onAct,
		onMove,
		onEndTurn,
		onReact,
		onSelectItem,
		onSelectOccupant,
		onSelectOperation,
		itemDetailGeneration = 0,
		occupantDetailGeneration = 0,
		referencesEnabled = true,
	}: {
		view: PlayView;
		busy: boolean;
		/** The id of the action whose call is in flight, forwarded to `PlayDock`. */
		busyActionId?: string | null;
		/** The last act/move's own rendered prose — never shown as its own
		 * line any more (round 4, refusals into the stream); read only to
		 * build an Explore stream line's outcome text and, in Talk/Fight/
		 * Reaction, the dock's one refusal notice. */
		status: string | null;
		/** `classifyActResult`'s own kind for the last act (round 3,
		 * sk-jay0.1.8): still used to tell a Talk/Fight/Reaction refusal
		 * (`"rejected"`/`"failed"`) apart from a quiet/delta outcome the
		 * thread already carries. */
		statusKind?: ActStatusKind;
		/** A dropped socket reconnecting under the mounted view — the dock's
		 * one notice's top priority. */
		reconnecting?: boolean;
		statusMessage?: { text: string; tone: "stale" | "error" };
		/** The raw refusal code (+ optional `failure_detail`) behind `status`,
		 * when the last act was a rejection (sk-j8e.4) — attached to the
		 * Explore stream line it produces so its ⓘ hover can show it. */
		refusal?: { code: string; detail?: string } | null;
		recapWorldName: string;
		/** `null` when the maps link is switched off (`VITE_SPELLKAVE_MAPS_URL=off`,
		 * for a local world): no "Open the full map" link is shown. */
		mapHref: string | null;
		/** `null` when `VITE_SPELLKAVE_GATEWAY_URL` is unset or invalid; forwarded to `MapTile`. */
		gatewayOrigin: string | null;
		/** World slug, forwarded to `MapTile`'s `@spellkave/map-canvas` mount. */
		slug: string;
		/** The session's own WorkOS access token, forwarded to `MapTile`. */
		token: string;
		mapWatch?: PlayMapWatch | null;
		/**
		 * The seat seal button, owned and rendered by App.svelte (it needs
		 * session/account state this component doesn't have) but forwarded to
		 * `PlayDock`, which renders it at the right end of its status row.
		 */
		seal?: Snippet;
		/** Extra menus rendered in the dock's status row, right before the
		 * seal — e.g. the Playground's Mock menu. */
		dockExtras?: Snippet;
		/**
		 * An incrementing counter (App.svelte's seat menu "Reset layout" row,
		 * the same "please act again" shape as App's own `retry`) that snaps
		 * the mosaic back to `restLayout` — the only way back to rest after a
		 * boundary drag besides toggling the table head twice (sk-jay0.1.8.14
		 * task a). Optional: absent whenever no seat menu owns it (a static
		 * fixture mount).
		 */
		resetLayoutRequest?: number;
		/** A validated recording may restore its settled mosaic only at the
		 * breakpoint where it was captured; a different breakpoint starts clean. */
		initialLayout?: MosaicLayout;
		initialLayoutMobile?: boolean;
		/** Settled presentation changes only; in-flight drag/pinch frames stay local. */
		onLayoutChange?: (layout: MosaicLayout, mobile: boolean) => void;
		onAct: (
			action: PlayAction,
			words?: string,
			surface?: ActionSurface,
			inputValues?: IntentInputValues,
		) => Promise<boolean>;
		onMove: (exit: PlayExit, surface?: ActionSurface) => Promise<void>;
		onEndTurn: () => Promise<void>;
		onSelectOperation?: (id: string | null, cursor?: string) => Promise<void>;
		onReact: (handle: string, rev: string, responseIntent: string) => Promise<void>;
		/**
		 * Select (or, with `null`, deselect) a Pack item — the caller owns the
		 * on-demand `spellkave_item_detail` read and current factual candidates
		 * (`PlaySessionHandle.selectItem`); this component only owns WHICH item
		 * is selected. Optional: absent in a static fixture mount (demo.html,
		 * the smoke tests) where `view.itemDetail` is already the fixture's
		 * own recorded shape and there is no live session to read from.
		 */
		onSelectItem?: (item: { id: string; handle: string; rev: string; name: string }) => void;
		/**
		 * Select (or, with `null`, deselect) a Place occupant — presentation
		 * plus the authorized scene_detail read. Never a gameplay dispatch.
		 */
		onSelectOccupant?: (occupant: { id: string; handle: string; rev: string; name: string } | null) => void;
		/** Changes when the owner replaces its item-detail reader. */
		itemDetailGeneration?: number;
		occupantDetailGeneration?: number;
		referencesEnabled?: boolean;
	} = $props();

	let selectedOccupant = $state<string | null>(null);
	let selectedItemId = $state<string | null>(null);

	// ── The table's scene: derived in play-table.ts, one scene by priority
	// (reaction > fight > talk > explore) ──
	const dialogue = $derived(dialogueFromView(view));
	// A speaker selection or transcript filter only describes the current
	// place-channel. Keeping either across a move can leave an old speaker's
	// history on screen while the composer has already switched to somebody
	// at the new place. Key those local choices to the place instead of
	// imperatively trying to clear them after every possible view update.
	const conversationPlaceId = $derived(view.place?.id ?? null);
	// The Talk scene as a thread (sk-jay0.1.8.12): one world-ordered stream,
	// bursts grouped, numbered answers and any line-bound offered action
	// (e.g. "Adopt the recommended array") as chips under the line that
	// offered them. A no-op outside Talk (`threadFromView` reads no
	// dialogue as an empty claim set), so this is safe to compute always.
	// Scope the compact Talk thread to the current place. The full stream
	// retains every authorized speech line across places.
	let placeEnteredTick = $state<number | null>(null);
	let placeEnteredId: string | null = null;
	// One continuous Explore journal across every place visited this session
	// (sk-jay0.1.8.60): a quiet divider marks each place the player has
	// entered. Recorded in the same effect that tracks arrival, since both
	// fire on exactly the same place-id transition.
	let nextExplorePlaceDividerId = 0;
	// ONE record counter for every local stream entry — place dividers here,
	// own attempt rows in `recordExploreActivity` (sk-jay0.1.8.96, owner
	// decision 2026-11-12). `exploreStreamFromView` reads it only to order two
	// local entries that share a tick; a world line is never re-sequenced.
	let nextLocalRecordSeq = 0;
	let explorePlaceDividers = $state<ExplorePlaceDivider[]>([]);
	$effect(() => {
		const placeId = view.place?.id ?? null;
		if (placeId === placeEnteredId) return;
		const first = placeEnteredId === null;
		placeEnteredId = placeId;
		untrack(() => {
			// The very first observation (page load or a reload) still opens a
			// divider — the journal always shows where the player is, rather
			// than a blank page waiting for the first move — it just skips the
			// "departure has served"/arrival-tick bookkeeping below, exactly as
			// the reload case always has for everything else on this tile.
			const tick = currentTrailTick();
			// A tactical session mints a fresh place id per grid cell
			// ("Cell 1,1"), so treating every step as an arrival would flood the
			// journal with "Cell x,y" dividers (sk-jay0.1.8.63.2 task 6) — the
			// same ephemeral-grid signal `hasTacticalSession` already gates the
			// fight frame with, never a match on the "Cell" string. No divider
			// is recorded for as long as the tactical grid holds (a mid-fight
			// reload included: the journal opens with no place row rather than
			// one for whichever cell the reload landed on); the fight's own
			// opening moment is instead a quiet `session_lifecycle` world-event
			// row, which comes for free once it is in `view.events` (task 1) —
			// no separate divider is needed for it here.
			if (!hasTacticalSession(view)) {
				explorePlaceDividers = [
					...explorePlaceDividers,
					{
						id: `place:${nextExplorePlaceDividerId++}`,
						placeId,
						placeName: view.place?.name ?? "Between places",
						// The opening divider heads the journal: lines the world
						// backfills after a reload carry earlier ticks and would
						// otherwise sort above the place they were heard in.
						tick: first ? 0 : tick,
						recordSeq: nextLocalRecordSeq++,
					},
				].slice(-EXPLORE_ACTIVITY_LIMIT);
			}
			if (first) return; // a reload: no arrival observed, keep every line
			// The departure line ("You set off toward…") has served; the new place
			// speaks for itself now.
			if (localFeedback !== null && !localFeedback.pending && (localFeedback.surface === "place" || localFeedback.surface === "map")) {
				localFeedback = null;
			}
			placeEnteredTick = tick;
			// The place just arrived at is no longer a destination: drop a
			// selection that still names it, and with it the composer's target
			// token. Only here, on the place change — a later deliberate click
			// on the current place stays selected.
			selection = selectionAfterArrival(selection, placeId);
		});
	});
	// The thread shows what belongs to THIS place (`threadLineIdsForPlace`):
	// the player's own lines, anyone still here, and anything heard since
	// arriving. The group channel stays coherent with whoever last spoke
	// (App.smoke 'does not carry a selected speaker or transcript filter into
	// a new place') because present speakers always keep their lines.
	const thread = $derived.by(() => {
		const result = threadFromView(view);
		const keep = threadLineIdsForPlace(view, placeEnteredTick);
		if (result.lines.every((line) => keep.has(line.id))) return result;
		const lines = result.lines.filter((line) => keep.has(line.id));
		const first = lines[0];
		return {
			...result,
			lines: first === undefined ? lines : [{ ...first, startsBurst: true }, ...lines.slice(1)],
		};
	});
	const combat = $derived(combatFromView(view));
	// ── Target-first turn bar (S3, sk-jay0.1.8.39/40): the fight's offered
	// actions, regrouped by target, feed the turn bar's chips and verb row
	// instead of the flat Actions palette (design doc §9/§10 row S3). ──
	const targetGroups = $derived(targetsFromView(view));
	const combatTargets = $derived(
		targetGroups.map((group) => ({
			targetRef: group.targetRef,
			label: group.label,
			// The verb button shows only the action's own display name (the
			// target is already the selected chip) — `verbName` strips the
			// world's own " — <target>" suffix (play-view.ts's `actionLabel`)
			// off `offeredAction`'s full label; that full label survives as
			// `accessibleLabel`, the button's own `aria-label`/`title`, so it
			// stays reachable by its unambiguous name.
			actions: group.actions.map((action) => ({
				...offeredAction(action),
				label: verbName(action),
				accessibleLabel: action.label,
			})),
		})),
	);
	// A roster entry's own `entity:<actorId>` ref, so the turn bar's tracker
	// chip can double as that target's chip (Combat.svelte decides whether
	// it is actually live right now via its own `targets` prop — this just
	// carries the identity, never invents one `combatFromView` didn't offer).
	const combatForWidget = $derived(
		combat === null || combat.roster === undefined
			? combat
			: {
					...combat,
					roster: combat.roster.map((entry) => {
						const sessionEntry = view.session.roster.find(
							(candidate) => candidate.ordinal === entry.ordinal,
						);
						return sessionEntry === undefined
							? entry
							: { ...entry, targetRef: `entity:${sessionEntry.actorId}` };
					}),
				},
	);
	const svg = $derived(view.mapSvg === null ? undefined : sanitiseSvg(view.mapSvg));
	const mapFrame = $derived(mapFrameFromView(view, svg));
	const contexts = $derived(contextualActions(view.actions, {
		packIds: new Set(view.pack.map((item) => item.id)),
		occupantIds: new Set(view.occupants.map((occupant) => occupant.id)),
	}));
	// The turn bar (S3, sk-jay0.1.8.39/40) already shows every fight-offered
	// action as a target chip's own verb row — the Actions palette must not
	// offer the same handle a second time (design doc §9/§10 row S3, "the
	// cross product of buttons is gone"). Outside a tactical session
	// `combatHandles` is empty, so this is a no-op everywhere else.
	const combatHandleIds = $derived(combatHandles(view));
	// Include selected detail candidates (also carried separately in recordings)
	// so every item dock slot fires through this same direct attempt path.
	const byId = $derived(
		new Map(
			[...view.actions, ...(view.itemDetail?.verbs ?? []), ...(view.occupantDetail?.verbs ?? [])].map((action) => [action.id, action]),
		),
	);
	const scenePlace = $derived(
		view.place === null
			? null
			: {
					id: view.place.id,
					name: view.place.name,
					description: view.place.description,
					exits: view.place.exits.map((exit) => ({
						id: exit.handle,
						label: exit.toName,
						direction: exit.label,
						gated: exit.gates.length > 0,
					})),
				},
	);
	const exitsByHandle = $derived(new Map((view.place?.exits ?? []).map((exit) => [exit.handle, exit])));
	const occupants = $derived(
		view.occupants.map((entry) => ({
			id: entry.id,
			name: entry.name,
			kind: entry.kind,
			sceneKind: entry.sceneKind,
			note: entry.note,
			conditions: entry.conditions,
			noteIsPresence: entry.conditions.length === 0,
		})),
	);
	const pack = $derived(
		view.pack.map((item) => ({
			id: item.id,
			name: item.name,
			detail: item.detail,
			quantity: item.quantity,
			equipped: item.equipped,
			depth: item.depth,
		})),
	);
	const packById = $derived(new Map(view.pack.map((item) => [item.id, item])));
	// `view.itemDetail` is the CURRENT selection's on-demand read; only trust
	// it for the pack tile's active item, never a stale one left over from a
	// selection the tile has since moved on from (`PackItemDetail`'s own `id`
	// gate does the same check again inside `Pack.svelte`, cheaply, since a
	// prop is not guaranteed to skip a superseded render).
	const packDetail = $derived.by(() => {
		const detail = view.itemDetail;
		if (!detail || detail.failed) return detail ?? null;
		const entityId = detail.entityId ?? detail.id;
		const contextual = view.actions.filter((action) =>
			action.targetRef === `entity:${entityId}` || action.targetRef === `item:${entityId}`,
		);
		// The targeted read wins when both reads describe the same handle.
		// Preserve its detail/selection gate and use the shared dispatch path.
		const verbs = [...new Map([...contextual, ...detail.verbs].map((action) => [action.id, action])).values()];
		return { ...detail, verbs };
	});
	let heroRoot = $state<HTMLElement | null>(null);
	let packRoot = $state<HTMLElement | null>(null);
	let tableRoot = $state<HTMLElement | null>(null);
	const lastFieldReports = new Map<string, string>();
	const hero = $derived({
		name: view.hero.name,
		// Preserve the world's ui.self_summary order and labels. SRD sheet
		// supplements belong to this app, not to the configurable widget.
		sheetVitals: [
			// The stage's origin line already says "Level 1 · Barbarian"; the
			// summary's own "Character Level 1" figure repeated it right below.
			...view.hero.vitals.filter((vital) => !(view.hero.level !== undefined && vital.id === "srd/level")),
			...(view.hero.xp === undefined || view.hero.vitals.some((v) => v.id === "srd/xp") ? [] : [{ id: "srd/xp", label: "Experience", value: xpProgressLabel(view.hero.xp, view.hero.level) }]),
			...(view.hero.proficiency === undefined || view.hero.vitals.some((v) => v.id === "srd/proficiency_bonus") ? [] : [{ id: "srd/proficiency_bonus", label: "Proficiency", value: String(view.hero.proficiency), description: view.hero.proficiencyDescription }]),
		],
		identityDetails: view.hero.identityDetails,
		descriptionReads: view.hero.descriptionReads,
		...(view.hero.species === undefined ? {} : { species: view.hero.species }),
		...(view.hero.className === undefined ? {} : { className: view.hero.className }),
		...(view.hero.background === undefined ? {} : { background: view.hero.background }),
		...(view.hero.level === undefined ? {} : { level: view.hero.level }),
		...(view.hero.hp === undefined ? {} : { hp: view.hero.hp }),
		...(view.hero.ac === undefined ? {} : { ac: view.hero.ac }),
		...(view.hero.xp === undefined ? {} : { xp: view.hero.xp }),
		...(view.hero.proficiency === undefined ? {} : { proficiency: view.hero.proficiency }),
		abilities: view.hero.abilities,
		skills: view.hero.skills,
		masteries: view.hero.masteries,
		conditions: view.hero.conditions,
		quest: view.hero.quest,
		conditionDetails: view.hero.conditionDetails,
		...(view.hero.appearance === "" ? {} : { appearance: view.hero.appearance }),
		...(view.hero.backstory === "" ? {} : { backstory: view.hero.backstory }),
	});

	$effect(() => {
		const sheetRoot = heroRoot;
		const itemRoot = packRoot;
		const actionRoot = tableRoot;
		if (!sheetRoot || !itemRoot || !actionRoot) return;
		const roots = { sheet: sheetRoot, item: itemRoot, table: actionRoot };
		const tableClosed = levelOf("table") === "strip";
		const descriptions = view.actions.filter((action) => action.description?.trim()).length;
		const sheetOpen = levelOf("hero") === "stage";
		const itemOpen = levelOf("pack") === "stage";
		const counts = view.hero.suppliedFields;
		const vitals = counts === undefined ? undefined : counts.vitals + hero.sheetVitals.slice(view.hero.vitals.length).reduce((count, value) => count + 1 + (value.description ? 1 : 0), 0);
		const selected = selectedItemId ?? pack[0]?.id;
		const detail = packDetail?.id === selected ? packDetail : null;
		const selection = pack.findIndex((item) => item.id === selected) + 1;
		const itemDescriptions = detail?.verbs.filter((action) => action.description?.trim()).length;
		const itemState = !itemOpen ? "closed" : selected === undefined ? "empty" : detail?.failed ? "error" : detail === null ? "loading" : "ready";
		let cancelled = false;
		function report() {
			if (cancelled) return;
			const rows: [FieldSurface, number | undefined][] = [
				["hero_vitals", vitals], ["hero_quest", counts?.quest], ["hero_conditions", counts?.conditions],
			];
			const events = rows.map(([surface, count]) => fieldObservation(roots.sheet, surface, count,
				!sheetOpen ? "closed" : surface !== "hero_conditions" && view.hero.descriptionReads?.values === "failed" ? "error" : "ready"));
			events.push({ ...fieldObservation(roots.item, "item_detail", selected === undefined ? 0 : detail?.suppliedFields, itemState), selection });
			events.push(descriptionObservation(roots.table, "table", descriptions, tableClosed ? "closed" : "ready"));
			events.push({ ...descriptionObservation(roots.item, "item", selected === undefined ? 0 : itemDescriptions, itemState), selection });
			for (const event of events) {
				const key = event.surface ?? `description:${event.description_scope}`;
				const signature = JSON.stringify(event);
				if (lastFieldReports.get(key) === signature) continue;
				lastFieldReports.set(key, signature);
				playObservation.record(event);
			}
		}
		const observer = new MutationObserver(report);
		for (const root of [sheetRoot, itemRoot, actionRoot]) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "data-field-disclosed", "aria-expanded"] });
		void tick().then(report);
		return () => { cancelled = true; observer.disconnect(); };
	});

	// The last item id an on-demand read was actually fired for — guards
	// both the auto-select effect below (reopening an already-detailed Pack
	// tile must not re-request it) and a manual click landing on the item
	// the effect just requested (no double read for one selection). A new
	// reader generation invalidates the request, while keeping the selection.
	let lastRequestedItemId = $state<string | null>(null);
	let lastRequestedItemGeneration = $state(-1);

	function selectItem(id: string): void {
		if (!packById.has(id)) return;
		setSelection({ kind: "item", itemId: id });
		requestItem(id);
	}

	function requestItem(id: string): void {
		selectedItemId = id;
		if (id === lastRequestedItemId && itemDetailGeneration === lastRequestedItemGeneration) return;
		const item = packById.get(id);
		if (item === undefined) return;
		lastRequestedItemId = id;
		lastRequestedItemGeneration = itemDetailGeneration;
		// Narrowed to what `selectItem` needs (`SelectedPackItem` in play-
		// session.ts) — never the full `PlayPackItem`, so a caller asserting on
		// the call sees exactly the on-demand read's own inputs, not the pack
		// row's incidental extra fields (`detail`/`quantity`/`equipped`).
		onSelectItem?.({ id: item.id, handle: item.handle, rev: item.rev, name: item.name });
	}

	let lastRequestedOccupantKey = $state<string | null>(null);
	const occupantsById = $derived(new Map(view.occupants.map((occupant) => [occupant.id, occupant])));
	const occupantDetailAllVerbs = $derived.by(() => {
		const detail = view.occupantDetail;
		if (!detail || selectedOccupant === null) return detail ?? null;
		if (detail.id !== selectedOccupant && detail.entityId !== selectedOccupant) return null;
		const contextual = view.actions.filter(
			(action) => action.targetRef === `entity:${selectedOccupant}` || action.targetRef === `item:${selectedOccupant}`,
		);
		const verbs = [
			...new Map(
				[...contextual, ...detail.verbs.map((action) => retainActionClassification(action, view.actions))].map(
					(action) => [action.id, action],
				),
			).values(),
		];
		return { ...detail, verbs };
	});
	const occupantDetail = $derived(
		occupantDetailAllVerbs && {
			...occupantDetailAllVerbs,
			verbs: occupantDetailAllVerbs.verbs.filter((action) => !isTableBoundOffer(action)),
		},
	);
	const placeOccupantDetail = $derived.by(() => {
		if (selectedOccupant === null) return null;
		if (onSelectOccupant) {
			const detail = occupantDetailAllVerbs;
			if (!detail) return null;
			return {
				id: detail.id,
				description: detail.description,
				facts: detail.facts,
				verbs: detail.verbs.filter(isPlaceDetailVerb).map(action => {
					const definition = view.manipulationContext?.status === "ready"
						? view.manipulationContext.actions.find(definition => definition.actionId === action.actionId)
						: undefined;
					return { ...offeredAction(action), label: action.name ?? definition?.displayName ?? action.label, groups: action.groups };
				}),
				failed: detail.failed,
			};
		}
		const verbs = contexts.place
			.filter((action) => action.targetRef === `entity:${selectedOccupant}` && !isTableBoundOffer(action))
			.map(offeredAction);
		return { id: selectedOccupant, facts: [], verbs };
	});
	// sk-jay0.1.8.63.9: classified from the STILL-`PlayAction[]` verbs (its own
	// `descriptor`, e.g. `srd/check/acrobatics`) before `offeredAction` above
	// strips that field — `isGenericCheckAction` is the SAME semantic class,
	// never a label prefix, `play-action-context.ts` already tests in
	// isolation. Ids survive the `offeredAction` mapping unchanged, so this
	// closure over ids is all `PlacePanel` needs (the dock hotbar's own
	// SELECTION group groups its own "Checks" submenu separately,
	// `groupFromActions` in `../lib/dock-hotbar.ts`).
	const occupantSecondaryVerbIds = $derived.by(() => {
		if (selectedOccupant === null) return new Set<string>();
		const raw = onSelectOccupant
			? (occupantDetailAllVerbs?.verbs ?? [])
			: contexts.place.filter(
					(action) => action.targetRef === `entity:${selectedOccupant}` && !isTableBoundOffer(action),
				);
		return new Set(raw.filter(isGenericCheckAction).map((action) => action.id));
	});
	const isOccupantSecondaryVerb = $derived(
		(verb: { id: string }) => occupantSecondaryVerbIds.has(verb.id),
	);

	function requestOccupant(id: string | null): void {
		if (id === null) {
			selectedOccupant = null;
			lastRequestedOccupantKey = null;
			onSelectOccupant?.(null);
			return;
		}
		const occupant = occupantsById.get(id);
		if (occupant === undefined) {
			selectedOccupant = null;
			lastRequestedOccupantKey = null;
			onSelectOccupant?.(null);
			return;
		}
		selectedOccupant = id;
		const key = `${occupant.id}:${occupant.handle}:${occupant.rev}:${occupantDetailGeneration}`;
		if (key === lastRequestedOccupantKey) return;
		lastRequestedOccupantKey = key;
		onSelectOccupant?.({ id: occupant.id, handle: occupant.handle, rev: occupant.rev, name: occupant.name });
	}

	function selectOccupant(id: string | null): void {
		if (id !== null && id === selectedOccupant) {
			requestOccupant(null);
			return;
		}
		requestOccupant(id);
	}

	// ── Info cards (sk-jay0.1.8.63.10): one `InfoCardProvider` mounted at this
	// component's own root (below) covers every `InfoLink` in the Table
	// stream, dock, AND full character sheet. `resolveCard` is the one `InfoCardResolve` they
	// all share, dispatching on the ref's own kind (`info-cards.ts`) — this
	// component only supplies the reads that need a live session. ──

	/**
	 * Requests (via the SAME `requestOccupant` a stream name always used,
	 * sk-jay0.1.8.63.7) get bridged into a promise here because the actual
	 * answer arrives asynchronously, as a later `view.occupantDetail` prop
	 * update — never a read this component invents a second time. Superseded
	 * by a newer selection (another occupant opened before this one settled)
	 * rejects rather than hanging forever; a `failed` detail rejects too, so
	 * the card shows its own error state instead of an empty "not found".
	 */
	let pendingOccupantReads: {
		id: string;
		resolve: (detail: PlayOccupantDetail) => void;
		reject: (error: unknown) => void;
	}[] = [];
	$effect(() => {
		const currentId = selectedOccupant;
		const detail = occupantDetail;
		if (pendingOccupantReads.length === 0) return;
		const waiting: typeof pendingOccupantReads = [];
		for (const pending of pendingOccupantReads) {
			if (pending.id !== currentId) {
				pending.reject(new Error("Superseded by a newer selection."));
			} else if (detail === null) {
				waiting.push(pending); // still loading
			} else if (detail.failed) {
				pending.reject(new Error("The occupant detail read failed."));
			} else {
				pending.resolve(detail);
			}
		}
		pendingOccupantReads = waiting;
	});

	function readOccupantCard(id: string): Promise<PlayOccupantDetail> {
		if (!onSelectOccupant) {
			// No live session (a static fixture mount — demo.html, Playground):
			// there is no on-demand read to await. Same minimal fallback
			// `placeOccupantDetail`'s own no-callback branch already builds.
			const occupant = occupantsById.get(id);
			const verbs = contexts.place.filter(
				(action) => action.targetRef === `entity:${id}` && !isTableBoundOffer(action),
			);
			return Promise.resolve({ id, handle: occupant?.handle ?? "", rev: occupant?.rev ?? "", facts: [], verbs });
		}
		requestOccupant(id);
		return new Promise((resolve, reject) => {
			pendingOccupantReads = [...pendingOccupantReads, { id, resolve, reject }];
		});
	}

	function resolveCard(refId: string): Promise<InfoCardData | null> {
		return resolveInfoCard(refId, {
			view,
			actionsById: byId,
			readOccupant: readOccupantCard,
			readDefinition: readDefinitionCard,
		});
	}

	$effect(() => {
		if (selectedOccupant === null) return;
		requestOccupant(occupantsById.has(selectedOccupant) ? selectedOccupant : null);
	});

	let localFeedback = $state<{ surface: ActionSurface; pending: boolean; text: string | null } | null>(null);
	// The dock stays silent for an ordinary act; only a wait past 3s earns
	// "The world is still thinking…" (minimal motion, no modal feel).
	let slowPending = $state(false);
	$effect(() => {
		if (!localFeedback?.pending) {
			slowPending = false;
			return;
		}
		const timer = setTimeout(() => {
			slowPending = true;
		}, 3000);
		return () => clearTimeout(timer);
	});
	const dockNotice = $derived.by(() => {
		// A refusal is a stream line in every scene now (every scene mounts the
		// one Table stream), so the dock's notice reports the connection, a
		// slow world, and — below those — the one layout offer of a fight.
		const ambient = statusMessage === undefined ? dockNoticeFrom({ reconnecting, slowPending }) : null;
		if (ambient !== null || layoutHint === null) return ambient;
		return {
			text: layoutHint === "fight" ? "Fight begins." : "Fight over.",
			tone: "info" as const,
			action: {
				label: layoutHint === "fight" ? "Map view" : "Back to exploring",
				onSelect: takeLayoutHint,
			},
			onDismiss: dismissLayoutHint,
		};
	});
	let nextExploreActivityId = 0;
	let exploreActivities = $state<ExploreActivity[]>([]);
	// The transport retains only 40 speech lines. Keep the same visit-sized
	// history as events so folding Chronicle never drops an already seen line.
	let exploreSpeech = $state<PlaySpeech[]>([]);
	$effect(() => {
		const retained = new Map(exploreSpeech.map((line) => [line.id, line]));
		const additions = view.speech.filter((line) => !retained.has(line.id));
		if (additions.length > 0) exploreSpeech = [...exploreSpeech, ...additions].slice(-EXPLORE_ACTIVITY_LIMIT);
	});
	// Both transport rings are bounded at 40; retain the raw event text too.
	let admittedEventIds = $state<Set<string>>(new Set());
	let exploreEvents = $state<PlayChronicleEntry[]>([]);
	$effect(() => {
		const additions = view.events.filter((event) => !admittedEventIds.has(event.id));
		if (additions.length === 0) return;
		exploreEvents = [...exploreEvents, ...additions].slice(-EXPLORE_ACTIVITY_LIMIT);
		admittedEventIds = new Set([...admittedEventIds, ...additions.map((event) => event.id)]);
	});
	// One continuous chronology across every place visited this session
	// (Table design note, sk-jay0.1.8.60): the player's own local outcomes,
	// place-arrival dividers, the world's heard speech and (sk-jay0.1.8.63.2)
	// its non-speech world events, merged into world-tick order — never
	// Explore's old separate "Recent activity" / "Said here" lists, and no
	// longer emptied by a move to another place.
	const exploreStream = $derived(
		exploreStreamFromView({ ...view, speech: exploreSpeech }, exploreActivities, {
			includeRetainedSpeech: true,
			dividers: explorePlaceDividers,
			events: exploreEvents,
		}),
	);
	// Stream scrolling (Table design note): a reload lands on the newest entry,
	// the player's own action reveals its result, and a passive arrival never
	// yanks a reader who scrolled up. This is the ONE follow-scroll instance
	// for the whole stage table now (Explore, Talk and Fight all mount the
	// same stream, sk-jay0.1.8.63.1 Part B) — `Thread.svelte` still owns its
	// own instance (`follow-scroll.svelte.ts`) for its `density="card"` shape,
	// where it never actually scrolls. Kept local only because `ActivityFeed`
	// stays a neutral list with no scroll opinion of its own.
	let exploreStreamEl = $state<HTMLDivElement | null>(null);
	let exploreStreamContentEl = $state<HTMLElement | null>(null);
	const followExplore = createFollowScroll(() => exploreStreamEl);
	$effect(() => {
		if (exploreStreamEl === null) return;
		followExplore.settle();
	});
	// ActivityFeed defers painting off-screen rows. A reload can therefore grow
	// the content after its initial scroll lands, leaving the reader above the
	// tail without an unread indicator. Observe that content: while pinned, a
	// late layout growth re-anchors to the tail. Deliberately scrolling up turns
	// `pinned` false, so this never interrupts reading older entries.
	$effect(() => {
		const content = exploreStreamContentEl;
		if (content === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (followExplore.pinned) followExplore.jumpToLatest();
		});
		observer.observe(content);
		return () => observer.disconnect();
	});
	// Keyed on the newest entry, not the length: the stream is bounded
	// (`EXPLORE_ACTIVITY_LIMIT`), so a new entry can arrive while the count
	// stays flat because the oldest one fell off.
	let exploreStreamNewestId: string | null = null;
	$effect(() => {
		const newest = exploreStream.at(-1) ?? null;
		const newestId = newest?.id ?? null;
		if (newestId !== null && newestId !== exploreStreamNewestId) {
			// A local activity is always the player's own act; a `local:` id is
			// how `recordExploreActivity` mints them — its result reveals even
			// when the reader had scrolled up. Anything else follows the shared
			// controller's own pin state (or, unpinned, counts toward the
			// catch-up pill) — read via `untrack` so a later scroll alone never
			// re-triggers this id-keyed effect.
			const ownAct = newest?.kind === "activity" && newestId.startsWith("local:");
			untrack(() => followExplore.reveal(1, { forced: ownAct }));
		}
		exploreStreamNewestId = newestId;
	});
	// An operation is the present tail of the chronology, even when it has not
	// emitted a separate journal line yet. Let its first appearance follow the
	// same pin/unread contract as a passive stream event: readers at the bottom
	// see it; readers studying earlier events get the existing catch-up pill.
	let presentedActivityId: string | null = null;
	$effect(() => {
		const selected = view.operations?.selected;
		const activityId = selected && !selected.terminal ? selected.id : null;
		if (activityId !== null && activityId !== presentedActivityId) {
			untrack(() => followExplore.reveal(1));
		}
		presentedActivityId = activityId;
	});
	// The stable "PLACE / STAGE CONTEXT" line (Table design note): place name,
	// who else is here — never a technical id.
	const exploreContext = $derived(exploreContextFromView(view));

	/** Records one Explore journal line for a local outcome — an act's own
	 * result (including a structured outgoing speech message) or a move's
	 * departure line (`heading` a "Travel — <where>" label).
	 * `placeId` is still stamped for provenance even though the journal no
	 * longer filters by it (sk-jay0.1.8.60). */
	function recordExploreActivity(
		heading: string,
		outcome: string,
		options: {
			words?: string;
			addresseeName?: string;
			addressing?: "room" | "self";
			refusal?: { code: string; detail?: string };
			/** Entered input-field values: the row is then an activity
			 * ("Name: Brannoch"), never a speech bubble of the transport text. */
			display?: readonly ExploreActivityDisplayValue[];
		} = {},
	): void {
		const activity: ExploreActivity = {
			id: `local:${nextExploreActivityId++}`,
			placeId: view.place?.id ?? null,
			action: heading,
			outcome,
			tick: currentTrailTick(),
			recordSeq: nextLocalRecordSeq++,
			...(options.words !== undefined ? { words: options.words } : {}),
			...(options.addresseeName !== undefined ? { addresseeName: options.addresseeName } : {}),
			...(options.addressing !== undefined ? { addressing: options.addressing } : {}),
			...(options.refusal !== undefined ? { refusal: options.refusal } : {}),
			...(options.display !== undefined ? { display: options.display } : {}),
		};
		exploreActivities = [...exploreActivities, activity].slice(-EXPLORE_ACTIVITY_LIMIT);
	}

	let lastOriginReport = "";
	$effect(() => {
		if (!localFeedback || localFeedback.surface === "table") return;
		const surface = localFeedback.surface;
		const level = levelOf(surface);
		const mounted = level !== "strip" && (surface !== "map" || level === "stage");
		const state = !mounted ? "hidden" : localFeedback.pending ? "pending" : localFeedback.text ? "shown" : "hidden";
		const key = `${surface}:${state}`;
		if (key === lastOriginReport) return;
		lastOriginReport = key;
		playObservation.record({ phase: "presentation", interaction: 0, action_surface: surface, origin_feedback: state });
	});
	let selectedMapNode = $state<string | null>(null);
	// ── BattleMap in the map tile during a fight (S2, sk-jay0.1.8.38): every
	// offered exit that names a plate cell (`toNodeId`), mapped to the
	// widget's own `BattleMapExit` shape — never invented, exactly the
	// `handle`/`toNodeId`/`label` `play-view.ts` already carries. ──
	const battleMapExits = $derived(
		(view.place?.exits ?? [])
			.filter((exit): exit is PlayExit & { toNodeId: string } => exit.toNodeId !== undefined)
			.map((exit) => ({ handle: exit.handle, toNodeId: exit.toNodeId, label: exit.label })),
	);
	// The battle grid's own tokens, grouped by cell — shared by the selection
	// context below and `battleMapReachableExits`, so both read the exact
	// same map rather than two independent derivations of it.
	const sessionTokensByNode = $derived(tokensByNode(view));
	// A cell already holding a token is never "reachable": the world only
	// ever offers a step onto an EMPTY cell, so a step into an occupied one
	// would be refused (sk-jay0.1.8.63.13 review) — `BattleMap`'s own visual
	// tint/aria ("…, reachable") and legacy-mode `onStep` must not promise a
	// move the world would reject. `selection.ts`'s own `cellRow` already
	// prioritises occupants over "Move here" regardless of this filter; this
	// only keeps the PLATE's own affordance honest.
	const battleMapReachableExits = $derived(
		battleMapExits.filter((exit) => (sessionTokensByNode.get(exit.toNodeId)?.length ?? 0) === 0),
	);
	// The passive plate's travel targets: the same offered exits, labelled by
	// where they lead ("Go to North Road") — an exit's own `label` is its
	// direction, which names a cell step well but not a place.
	const placeMapExits = $derived(
		battleMapExits.map((exit) => ({ ...exit, label: exitsByHandle.get(exit.handle)?.toName || exit.label })),
	);
	// Occupant tokens for the battle map (sk-jay0.1.8.63.13): `PlaySessionToken`
	// (sk-jay0.4.2) carries no ally/foe signal today — only `isMe`. Rather than
	// invent hostility for what could just as well be a party NPC, every other
	// token renders "neutral" until the world offers a better signal.
	const battleMapTokens = $derived(
		(view.sessionTokens ?? []).map((token) => ({
			nodeId: token.nodeId,
			actorId: token.actorId,
			name: token.name,
			...(token.isMe ? { isMe: true } : { tone: "neutral" as const }),
		})),
	);
	// A click on a way out never moves (axioms A1/A4, owner ruling
	// 2026-11-12, sk-jay0.1.8.99). In a live session it highlights the
	// destination and asks the composer to insert that exit's bound go
	// sentence; Enter there is the only step that calls `move()`. The
	// selection is set with prefill OFF: a prefilled place target behind
	// `/go-…` would be a second binding and make the route stale. The composer
	// itself decides whether the insertion replaces the box or keeps typed
	// words. A legacy recording has no composer and keeps the selection row
	// with its "Travel to <place>" slot.
	function fillGo(handle: string): void {
		const exit = exitsByHandle.get(handle);
		if (exit === undefined) return;
		if (legacyActionFallback) {
			if (exit.toNodeId !== undefined) setSelection({ kind: "place", nodeId: exit.toNodeId, exitHandle: handle });
			else move(handle);
			return;
		}
		if (exit.toNodeId !== undefined) setSelection({ kind: "place", nodeId: exit.toNodeId, exitHandle: handle }, false);
		insertMove(handle);
	}
	// The composer refused the last way-out insertion because typed words were
	// in the box, and its help line says "choose it again". On the Place list
	// that row is already marked, so the next click on it asks again instead of
	// unmarking. Not reactive: only click handlers read it.
	let keptExitFill: string | null = null;
	function insertMove(exitHandle: string): void {
		keptExitFill = null;
		detailInsertion = { token: (detailInsertion?.token ?? 0) + 1, exitHandle };
	}
	// The Place tile hands `insertMove` to its stage rows (the row marks its
	// own exit through `onSelectExit` first) and `chooseExit` to its card rows
	// (sk-jay0.1.8.99 E4): a card row has no mark of its own, so it takes the
	// dock menu's path, destination highlight and draft-keeping rule included.
	// The card map's travel-marked node (`PlaceMap`'s `onTravel`).
	function travelFromMap(handle: string): void {
		fillGo(handle);
	}
	// The stage map: a place that is the destination of exactly one current
	// way out fills the composer like the other surfaces; any other place
	// (far, or reachable by several ways out) only selects, as before.
	function selectMapPlace(nodeId: string): void {
		const ways = legacyActionFallback ? [] : (view.place?.exits ?? []).filter((exit) => exit.toNodeId === nodeId);
		if (ways.length === 1 && ways[0] !== undefined) fillGo(ways[0].handle);
		else setSelection({ kind: "place", nodeId });
	}
	// The last map-surface move's own feedback line (`localFeedback`, already
	// populated from `messageForMove`'s failure_detail on a rejection), fed
	// straight to `BattleMap`'s own `refusal` prop below. Never "Nothing
	// happens.": an occupied-cell rejection's own reason is what
	// `messageForMove` returns.
	const mapRefusal = $derived(
		localFeedback?.surface === "map" && !localFeedback.pending && localFeedback.text !== null
			? localFeedback.text
			: null,
	);
	// ── The one live selection row (sk-jay0.1.8.63.13): "the map is always
	// only selecting, actions always only on the Table" (user ruling
	// 2026-09-19). One shared `selection` drives BattleMap's own selection,
	// the turn bar's chip highlight, the explore card map, and the
	// stage/card selection row below — never a per-tile selection of its
	// own. `Combat`'s `onSelectTarget` still hands back an `entity:<id>`
	// ref (its own roster-chip identity, unchanged by this bead); parsing
	// it into an actor id is the one translation this component owns. ──
	let selection = $state<Selection>(null);
	let selectionPrefillsComposer = $state(true);
	function setSelection(next: Selection, prefill = true): void {
		selectionPrefillsComposer = prefill;
		selection = next;
	}
	// A plain field, not a closure over the mutable `selection` binding
	// itself — narrowing `selection?.kind === "actor"` does not survive into
	// a nested callback (e.g. `Array.find`), so call sites that need the
	// actor id inside one read this instead.
	const selectedActorId = $derived(selection?.kind === "actor" ? selection.actorId : null);
	function actorIdFromEntityRef(targetRef: string): string | null {
		return targetRef.startsWith("entity:") ? targetRef.slice("entity:".length) : null;
	}
	function selectTurnOrderTarget(targetRef: string): void {
		const actorId = actorIdFromEntityRef(targetRef);
		if (actorId !== null) setSelection({ kind: "actor", actorId });
	}
	// Clicking the ALREADY-selected cell clears it (design brief: "cleared
	// by Esc or by clicking the selected cell again") — every other cell
	// (including one an `actor` selection merely resolved to) selects.
	function selectBattleMapCell(nodeId: string): void {
		setSelection(selection?.kind === "cell" && selection.nodeId === nodeId ? null : { kind: "cell", nodeId });
	}
	// Highlights the roster chip matching the current selection — never a
	// fallback to the first group: nothing selected highlights nothing
	// (`Combat`'s own `selectionMode` contract). A turn-order pick names its
	// own `entity:<id>` ref directly; a CELL selection is the other
	// direction of the two-way sync (design doc), so it resolves through
	// `view.sessionTokens` — exactly one occupant highlights that occupant's
	// chip, several occupants highlight none (`Combat`'s own
	// `selectedTargetRef` takes one ref, never an invented list).
	const combatSelectedTargetRef = $derived.by(() => {
		// `selection` is a `let`: capture it once so TS's narrowing survives
		// across the two checks below (a closure over a mutable outer
		// binding does not narrow on its own).
		const current = selection;
		if (current?.kind === "actor") return `entity:${current.actorId}`;
		if (current?.kind === "cell") {
			const occupants = (view.sessionTokens ?? []).filter((token) => token.nodeId === current.nodeId);
			return occupants.length === 1 ? `entity:${occupants[0]?.actorId}` : null;
		}
		return null;
	});
	// The battle grid's own cell a turn-order pick resolves to, so selecting
	// a combatant rings its cell on the map (design doc's "two-way" sync);
	// selecting a cell already highlights the matching tracker chip via
	// `combatSelectedTargetRef` reading `selection.kind === "actor"` — this
	// is that same sync in the other direction, computed once here.
	const selectionCellId = $derived(
		selection?.kind === "cell"
			? selection.nodeId
			: selection?.kind === "actor"
				? nodeOfActor(view, selection.actorId)
				: null,
	);
	// Node ids a selection may legitimately name right now (`selection.ts`'s
	// own staleness gate): the battle grid's own cells during a fight — own
	// cell, every placed token, every offered step's destination — or, while
	// exploring, the current place and its offered neighbours. A selection
	// naming anything else (the fight just ended, the place just changed)
	// goes stale and the row disappears.
	const selectionKnownNodeIds = $derived(
		new Set(
			hasTacticalSession(view)
				? [
						...(view.place?.id ? [view.place.id] : []),
						...battleMapExits.map((exit) => exit.toNodeId),
						...(view.sessionTokens ?? []).map((token) => token.nodeId),
					]
				: [...(view.place?.id ? [view.place.id] : []), ...placeMapExits.map((exit) => exit.toNodeId)],
		),
	);
	// The offered step/travel landing on a node — `view.place.exits` is the
	// one source every map surface (`battleMapExits`, `placeMapExits`, the
	// MapLibre canvas's own offered "Go to") already builds its own shape
	// from, so the row reads it directly rather than re-deriving per surface.
	function selectionExitTo(nodeId: string): { handle: string; label: string; name: string } | null {
		const exit = (view.place?.exits ?? []).find((candidate) => candidate.toNodeId === nodeId);
		return exit === undefined ? null : { handle: exit.handle, label: exit.label, name: exit.toName || exit.label };
	}
	// Every currently-offered action targeting this actor, outside a fight
	// (`dockMore`); inside one, the SAME target-first regrouping
	// (`targetsFromView`/`verbsForTarget`) the old turn bar's own verb row
	// used to read.
	function selectionActionsForActor(actorId: string): PlayAction[] {
		const targetRef = `entity:${actorId}`;
		return hasTacticalSession(view)
			? verbsForTarget(view, targetRef)
			: dockMore.filter((action) => action.targetRef === targetRef);
	}
	// Self-targeted/untargeted offers for the player's own cell: the
	// untargeted group (Dodge, a self-only check), the own-cell group
	// (`place_node:<id>`, "Cell 1,1" in the live UI) and the world-scoped
	// group (identified by its own `targetRef === "world"`, never a
	// lower-cased label match) — the SAME three groups outside a fight and
	// during one (sk-jay0.1.8.63.13 review: a fight's own cell used to be
	// "Nothing is offered from here." even when generic checks or a
	// world-scoped action were live; this union restores them). Deduplicated
	// by action id in case a group repeats one (it shouldn't, but a caller
	// merging never assumes).
	function selectionSelfActions(): PlayAction[] {
		const groups = groupActionsByTarget(view.actions);
		const ownRef = view.place ? `place_node:${view.place.id}` : null;
		const merged = new Map<string, PlayAction>();
		for (const group of groups) {
			if (group.targetRef !== UNTARGETED_TARGET_REF && group.targetRef !== ownRef && group.targetRef !== "world") {
				continue;
			}
			for (const action of group.actions) merged.set(action.id, action);
		}
		return [...merged.values()];
	}
	const selectionCtx = $derived({
		knownNodeIds: selectionKnownNodeIds,
		ownNodeId: view.place?.id ?? null,
		tokensByNode: sessionTokensByNode,
		exitTo: selectionExitTo,
		actionsForActor: selectionActionsForActor,
		selfActions: selectionSelfActions,
		isReadableOccupant: (actorId: string) => occupantsById.has(actorId),
		isReadablePlace: (nodeId: string) => nodeId === (view.place?.id ?? null),
		actorExists: (actorId: string) =>
			occupantsById.has(actorId) || view.session.roster.some((entry) => entry.actorId === actorId),
		nameForActor: (actorId: string) =>
			occupantsById.get(actorId)?.name ?? view.session.roster.find((entry) => entry.actorId === actorId)?.name ?? null,
		nodeOfActor: (actorId: string) => nodeOfActor(view, actorId),
	});
	const selectionRow = $derived(selectionRowFromView(view, selection, selectionCtx));
	// The factored composer owns an editable local draft. Selection contributes
	// only a currently disclosed target fact; no target/action pair is formed
	// until its explicit Attempt gesture reaches the existing Player-tool seam.
	let factComposerDraft = $state(emptyComposerDraft());
	/** A successful world receipt consumes one shell sentence. It is separate
	 * from fact revision: a rejected or unobserved attempt must leave its text
	 * available for repair. */
	let factComposerClearToken = $state(0);
	// Imported recordings predating the factored-context field remain readable;
	// they expose no composer facts rather than crashing the whole shell.
	const manipulationContext = $derived(view.manipulationContext ?? ({ status: "unavailable" } as const));
	// Only the recording adapter can opt into the retired action dock. A live
	// unavailable context is an honest lack of current facts, never a reason to
	// rebuild the cache-shaped action list.
	const legacyActionFallback = $derived(view.interactionOrigin === "legacy-recording");
	const factComposerPrompts = $derived(composerPrompts(manipulationContext));
	const selectedComposerPrompt = $derived(
		factComposerDraft.semanticContext === undefined
			? undefined
			: factComposerPrompts.find(
					(prompt) =>
						prompt.occurrenceId === factComposerDraft.semanticContext?.occurrence_id &&
						prompt.sourceRef === factComposerDraft.semanticContext?.source_ref,
				),
	);
	const factComposerActions = $derived(composerActions(manipulationContext, selectedComposerPrompt));
	const factComposerTargets = $derived(composerTargets(manipulationContext));
	const factComposerPrefillTargetRef = $derived(selectionPrefillsComposer
		? targetForSelection(selection, manipulationContext)?.targetRef ?? null : null);

	let detailInsertion = $state<{ token: number; actionId?: string; targetRef?: string; exitHandle?: string } | null>(null);
	function insertDetailAction(id: string): void {
		const action = byId.get(id);
		if (!action) return;
		detailInsertion = { token: (detailInsertion?.token ?? 0) + 1, actionId: action.actionId ?? (action.senseVisibility !== undefined ? action.id : action.descriptor), ...(action.senseVisibility === undefined ? { targetRef: action.targetRef } : {}) };
	}

	// A selection whose row just went stale (the fight ended, the place
	// changed, the actor left) clears itself — a later click on the same id
	// must never be silently suppressed by a leftover non-null `selection`.
	$effect(() => {
		if (selection !== null && selectionRow === null) setSelection(null);
	});
	// Only the pressed pill shows pending; `act`/`move` already guard
	// re-entrancy through `localFeedback?.pending`, so this only ever names
	// the ONE in-flight call, cleared the moment it settles (mirrors
	// `busyActionId`'s own single-flight contract, App.svelte).
	let selectionActingId = $state<string | null>(null);
	$effect(() => {
		if (!localFeedback?.pending) selectionActingId = null;
	});
	/** Dispatches a selection-row pill through the existing `act`/`move`
	 * paths, never a call of its own — `move:<handle>` is `selection.ts`'s
	 * own convention for "this id is a step/travel, not an affordance
	 * handle" (see that module's header). */
	function selectionAct(actionId: string): void {
		if (busy || localFeedback?.pending) return;
		selectionActingId = actionId;
		if (actionId.startsWith("move:")) move(actionId.slice("move:".length), "table");
		else void act(actionId, undefined, "table");
	}
	function isEditableElement(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		if (el === null) return false;
		return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
	}
	/**
	 * Digits 1–9 (design brief): never while an input/textarea/
	 * contenteditable has focus (the dock's own composer, first and
	 * foremost) — beyond that, denied only when focus sits inside some
	 * OTHER named tile (Hero) that owns its own
	 * keyboard surface. A click that leaves focus nowhere specific (a plain
	 * SVG cell — several browsers, and jsdom always, do not move focus for
	 * it) or on un-tiled chrome (the seat menu, say) still counts as "the
	 * selection surfaces. Pack and Place also select, so a digit after an
	 * item, occupant or exit click must reach the same dock slots.
	 */
	function digitBlockedByFocus(target: EventTarget | null): boolean {
		if (isEditableElement(target)) return true;
		// A key event's target is an element in practice, but `window` and
		// `document` are valid targets too and have no `closest`.
		if (!(target instanceof Element)) return false;
		const tile = target.closest<HTMLElement>("[data-tile]");
		return tile !== undefined && tile !== null && !["table", "map", "pack", "place"].includes(tile.dataset.tile ?? "");
	}
	/** A hotbar `…` menu or a real dialog (feedback, a field reader) owns the
	 * whole keyboard while open. */
	function hasOpenOverlay(): boolean {
		return (
			document.querySelector('[role="menu"], [role="dialog"]:not([data-slot="info-card"]), dialog[open]') !== null
		);
	}
	/** An info card only explains. A name click selects AND opens the card
	 * (W5), and the next thing a player does is press the digit of what they
	 * want to do to that name, so the card must not swallow the keymap. Only
	 * Escape stays the card's own: it closes the card before a second Escape
	 * clears the selection. */
	function hasOpenInfoCard(): boolean {
		return document.querySelector('[data-slot="info-card"]') !== null;
	}
	// Every key goes through the one keymap (axiom A8, `../lib/keymap.ts`):
	// this handler names COMMANDS, never keys, so a player's rebinding in
	// `localStorage` reaches all of them at once.
	let keymap = $state(loadKeymap(typeof localStorage === "undefined" ? undefined : localStorage));
	// The keyboard's stable walk: present actors in the world's order (turn
	// order in a fight), then the ways out clockwise from north. Grid cells
	// are the map's own arrow keys, so a fight's ring holds actors only.
	const selectionRingEntries = $derived(
		selectionRing({
			actorIds: hasTacticalSession(view)
				? view.session.roster.filter((entry) => !entry.isMe).map((entry) => entry.actorId)
				: view.occupants.map((occupant) => occupant.id),
			exits: hasTacticalSession(view)
				? []
				: battleMapExits.map((exit) => ({ handle: exit.handle, toNodeId: exit.toNodeId, direction: exit.label })),
		}),
	);
	// A reaction window can open under a finger already on its way to a
	// digit; a slot key answers it only after this long.
	// Typed by shape, not by the component: a formatter that sees the import
	// used only as a type rewrites it to `import type` and the template's
	// `<PlayDock>` stops resolving.
	let dock = $state<{ toggleExpanded: () => void } | null>(null);
	const REACTION_KEY_GUARD_MS = 400;
	let reactionOpenedAt = 0;
	let reactionHandle: string | null = null;
	// The window's full length is not part of the read; the longest time seen
	// left on this one window stands in for it (the draining bar's start).
	let reactionTotalMs = $state<number | null>(null);
	$effect(() => {
		const reaction = view.reaction;
		if (reaction === null) {
			reactionHandle = null;
			return;
		}
		if (reaction.handle !== reactionHandle) {
			reactionHandle = reaction.handle;
			reactionOpenedAt = Date.now();
			reactionTotalMs = reaction.remainingMs;
			// The eyes are on the stream, so the moment is told there too
			// (axiom A3: one more line, never a rewrite).
			untrack(() =>
				recordExploreActivity(
					reaction.windowKind === "reaction" ? "A moment to react" : "A moment to intervene",
					`${reactionText(reaction)}. Answer in the dock.`,
				),
			);
			return;
		}
		if (reaction.remainingMs !== null && reaction.remainingMs > (untrack(() => reactionTotalMs) ?? 0)) {
			reactionTotalMs = reaction.remainingMs;
		}
	});
	function reactionText(reaction: NonNullable<typeof view.reaction>): string {
		const who = reaction.originatingActorName ?? "Someone";
		const what = reaction.originatingActionId.split("/").pop()?.replace(/[-_]+/g, " ") ?? "acts";
		return `${who} — ${what}`;
	}
	const REACTION_SLOT_IDS = ["reaction:react", "reaction:pass"] as const;
	const dockUrgent = $derived.by((): DockHotbarUrgent | null => {
		const reaction = view.reaction;
		if (reaction === null) return null;
		return {
			title: reaction.windowKind === "reaction" ? "A moment to react" : "A moment to intervene",
			text: reactionText(reaction),
			remainingMs: reaction.remainingMs,
			totalMs: reactionTotalMs,
			answers: [
				{ id: REACTION_SLOT_IDS[0], label: "React", key: slotKeyLabels[0] ?? null },
				{ id: REACTION_SLOT_IDS[1], label: "Let it pass", key: slotKeyLabels[1] ?? null },
			],
		};
	});
	function answerReaction(slot: number): void {
		if (view.reaction === null || busy || slot > 1) return;
		void onReact(view.reaction.handle, view.reaction.rev, slot === 0 ? "react" : "pass");
	}
	function isInteractiveElement(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			target.closest("button, a[href], [role='button'], [role='menuitem'], summary") !== null
		);
	}
	function onSelectionKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		const command = commandForKey(keymap, event);
		if (command === null) return;
		// An open menu, card or dialog owns the keyboard, Escape first of all.
		if (hasOpenOverlay()) return;
		if (command === "select.clear") {
			if (hasOpenInfoCard()) return;
			if (selectionRow !== null) setSelection(null);
			return;
		}
		if (digitBlockedByFocus(event.target)) return;
		if (command === "select.next" || command === "select.prev") {
			const next = stepSelection(selectionRingEntries, selection, command === "select.next" ? 1 : -1);
			if (next === selection) return;
			event.preventDefault();
			setSelection(next);
			return;
		}
		if (command === "composer.focus") {
			// Enter on a focused button is that button's own. The live composer is
			// one native shell input; its result list owns its navigation from
			// there, rather than reviving the retired action/target controls.
			if (isInteractiveElement(event.target)) return;
			const control = document.getElementById(legacyActionFallback ? "play-dock-say" : "play-shell-input");
			if (control === null) return;
			event.preventDefault();
			control.focus();
			return;
		}
		if (command === "dock.toggle") {
			event.preventDefault();
			dock?.toggleExpanded();
			return;
		}
		if (command === "hint.accept") {
			// A layout hint wins when both are showing (item 7): it is the
			// player's own, one-time offer for this fight; the reply suggestion
			// stays offered afterward.
			if (layoutHint !== null) {
				event.preventDefault();
				takeLayoutHint();
				return;
			}
			if (replySuggestion === null) return;
			event.preventDefault();
			acceptReply();
			return;
		}
		if (command === "hint.dismiss") {
			if (layoutHint === null) return;
			event.preventDefault();
			dismissLayoutHint();
			return;
		}
		if (command === "turn.end") {
			if (!hasTacticalSession(view) || !view.session.myTurn || busy) return;
			event.preventDefault();
			void onEndTurn();
			return;
		}
		const slot = slotIndexOf(command);
		if (slot === null) return;
		// A reaction prompt overlays the dock's action row (axiom A7), so while
		// it is open the first two slots are its two answers and nothing else.
		if (view.reaction !== null) {
			if (busy || slot > 1 || Date.now() - reactionOpenedAt < REACTION_KEY_GUARD_MS) return;
			event.preventDefault();
			answerReaction(slot);
			return;
		}
		// Ordinary digits belong to the focused fact-composer completion row.
		// A pre-factored recording has no completion facts at all, however, so
		// its immutable playback bridge retains the original digit mapping.
		// A world that supplied a context never falls back to this route.
		if (legacyActionFallback) {
			const id = hotbarSlotAssignment.ids[slot];
			if (id !== null && id !== undefined) {
				event.preventDefault();
				pressSlot(id);
			}
		}
		return;
	}
	onMount(() => {
		window.addEventListener("keydown", onSelectionKeydown);
		const onKeymapChange = () => {
			keymap = loadKeymap(typeof localStorage === "undefined" ? undefined : localStorage);
		};
		window.addEventListener(KEYMAP_CHANGE_EVENT, onKeymapChange);
		return () => {
			window.removeEventListener("keydown", onSelectionKeydown);
			window.removeEventListener(KEYMAP_CHANGE_EVENT, onKeymapChange);
		};
	});
	async function act(
		id: string,
		words?: string,
		surface: ActionSurface = "table",
		localSpeechRoute?: "entity" | "room" | "self",
		inputValues?: IntentInputValues,
		actionOverride?: PlayAction,
		display?: readonly ExploreActivityDisplayValue[],
	): Promise<boolean> {
		const action = actionOverride ?? byId.get(id);
		if (action === undefined || busy || localFeedback?.pending) return false;
		// Every scene mounts the one Table stream now (sk-jay0.1.8.63.1 part B,
		// sk-jay0.1.8.63.13), so an act's outcome belongs there in Talk and in a
		// fight too, whichever tile or row the press came from. A spoken line
		// the world echoes back is deduplicated by `exploreStreamFromView`.
		const spoken = words?.trim() || undefined;
		// An input-field attempt is headed by its action ("Name your
		// character"), not by the transport text of its values.
		const heading = display === undefined && spoken ? `You said “${spoken}”` : action.label;
		const addresseeName = spoken && localSpeechRoute === "entity" && action.targetName !== ""
			? action.targetName
			: undefined;
		const addressing = spoken && (localSpeechRoute === "room" || localSpeechRoute === "self")
			? localSpeechRoute
			: undefined;
		const dialogueAtStart = dialogue !== null;
		localFeedback = { surface, pending: true, text: null };
		try {
			const completed = await onAct(action, words, surface, inputValues);
			const outcome = status ?? (completed ? "Completed." : "The action could not complete. Try again.");
			localFeedback = { surface, pending: false, text: outcome };
			// In an open dialogue a quiet outcome ("Nothing you notice changes.")
			// is noise: the world's own speech lines carry what happened. Read
			// from the trail, which the act has already written by now; the
			// `statusKind` prop may still hold the previous act's value here.
			const quiet = actStatusKindFromOutcome(playTrail.entries().findLast((entry) => entry.kind === "act")?.outcome ?? null) === "quiet";
			// An attempt Play stopped before sending never happened in the
			// world, so it is no stream line; the composer's status line says
			// "not sent". `onAct` settles after the owner flushed `statusKind`.
			if (statusKind === "blocked") return completed;
			if (!quiet || !dialogueAtStart) {
				recordExploreActivity(heading, outcome, {
					words: spoken,
					addresseeName,
					addressing,
					refusal: refusal ?? undefined,
					display,
				});
			}
			return completed;
		} catch {
			const outcome = "The action could not complete. Try again.";
			localFeedback = { surface, pending: false, text: outcome };
			recordExploreActivity(heading, outcome, { words: spoken, addresseeName, addressing, display });
			return false;
		}
	}

	function move(exitHandle: string, surface: ActionSurface = "place"): void {
		const exit = exitsByHandle.get(exitHandle);
		if (exit === undefined || busy || localFeedback?.pending) return;
		// A move always leaves its departure line in the journal, whichever
		// scene or tile it came from (sk-jay0.1.8.60, "travel leaves lines"):
		// walking out of a conversation is still the step that explains the
		// next place divider. Arrival is that divider, recorded separately
		// once the view shows the new place.
		localFeedback = { surface, pending: true, text: null };
		const previousActId = playTrail.entries().findLast(entry => entry.kind === "act")?.id;
		void onMove(exit, surface).then(() => {
			const latestAct = playTrail.entries().findLast(entry => entry.kind === "act");
			const settled = actStatusKindFromOutcome(latestAct?.id !== previousActId ? latestAct?.outcome ?? null : null);
			if (settled === "quiet" || settled === "delta") {
				factComposerDraft = emptyComposerDraft();
				factComposerClearToken += 1;
			}
			localFeedback = { surface, pending: false, text: status };
			if (status) recordExploreActivity(`Travel — ${exit.toName}`, status);
		}).catch(() => {
			const outcome = "The move could not complete. Try again.";
			localFeedback = { surface, pending: false, text: outcome };
			recordExploreActivity(`Travel — ${exit.toName}`, outcome);
		});
	}

	// ── The Talk dock (sk-jay0.1.8, round 3): the open prompt's answers move
	// into the dock hotbar's own leading "answers" group — the dock is the
	// present decision point, the thread is history (design contract).
	// `talkDockFromView`'s own `more` bucket only needs the live combat
	// handle excluded now (axiom A6: the turn bar renders no verbs of its
	// own any more); a say target is not a separate exclusion any more
	// either — the composer follows the global SELECTION now (axiom A4),
	// never a second target of its own. ──
	const talkDock = $derived(talkDockFromView(view, dialogue));
	const dockMore = $derived(talkDock.more.filter((action) => !combatHandleIds.has(action.id)));
	// BG3-style answer buttons (dock-as-menu-bar round): built directly from
	// the open prompt's choices, `number` and `text` kept apart so the dock
	// can shorten `text` on a word boundary without mangling the key badge —
	// the same slot/choiceActions join `talkDockFromView` does for its own
	// fused `TalkDock.answers` label.
	const dockAnswerEntries = $derived.by((): DockAnswer[] => {
		if (dialogue === null) return [];
		return dialogue.dialog.choices
			.map((choice) => {
				const action = dialogue.choiceActions.get(choice.slot);
				return action === undefined ? null : { id: action.id, number: choice.slot, text: choice.text };
			})
			.filter((answer): answer is DockAnswer => answer !== null);
	});
	const dockAnswerSplit = $derived(splitDockAnswers(dockAnswerEntries));
	// Names whom the answers address: with two open prompts in the room,
	// "2 answers" alone did not say whose.
	const dockAnswersLabel = $derived(
		dockAnswerEntries.length > 0 && dialogue !== null
			? `${dockAnswerEntries.length === 1 ? "1 answer" : `${dockAnswerEntries.length} answers`} · ${dialogue.dialog.speaker}`
			: null,
	);

	// ── PlayDock: the one bottom orientation + action surface regardless of
	// which tile is on stage. Presentational only — every value below is
	// handed to it as a prop; it owns no world reads of its own. ──
	const dockPlaceExits = $derived(
		scenePlace === null
			? []
			: [
					...scenePlace.exits.filter((exit) => exit.direction !== ""),
					...scenePlace.exits.filter((exit) => exit.direction === ""),
				].map((exit) => ({ handle: exit.id, direction: exit.direction, name: exit.label })),
	);
	// `id` is what a chip's own `InfoLink` opens (`condition:<id>`,
	// sk-jay0.1.8.63.10) — the detail read's own id when it has landed,
	// else the raw condition id `view.hero.conditions` already carries.
	const dockHeroConditions = $derived(
		view.hero.conditionDetails && view.hero.conditionDetails.length > 0
			? view.hero.conditionDetails.map((condition) => ({ id: condition.id, label: condition.label }))
			: view.hero.conditions.map((id) => ({ id, label: id })),
	);

	// ── The dock hotbar (axioms A1, A4, A6, `ledger/designs/play-interaction-axioms.md`):
	// the pure translation lives in `../lib/dock-hotbar.ts`, this is its one
	// live wiring, fed by the SAME `selectionRow`/`view.actions` every other
	// Table surface already reads. `hotbarMemory` is grow-only client state
	// (a known slot stays in place, dimmed, once the world stops offering
	// it) — the effect both reads and writes it, so its own read is
	// untracked, per `rememberHotbar`'s "returns the same map" contract. ──
	let hotbarMemory = $state<HotbarMemory>(new Map());
	const hotbar = $derived(
		hotbarFromView({
			actions: [...new Map([...view.actions, ...(occupantDetail?.verbs ?? [])].map((action) => [action.id, action])).values()],
			heroActorId: view.hero.actorId,
			placeId: view.place?.id ?? null,
			selectionRow,
			answers: dockAnswerSplit.shown,
			answersLabel: dockAnswersLabel,
			answersOverflow: dockAnswerSplit.overflow,
			talkSpeakerId: dialogue?.speakerId ?? null,
			memory: hotbarMemory,
		}),
	);
	$effect(() => {
		const next = rememberHotbar(untrack(() => hotbarMemory), hotbar);
		if (next !== hotbarMemory) hotbarMemory = next;
	});
	// Resource strip (W6): per-channel spend, leading the hotbar's first row.
	// Outside a turn structure the strip says nothing: every channel reads
	// "available" until something is spent and "pending" from then on, with no
	// round to refill it. It shows where it informs (sk-jay0.1.8.63.27).
	const resourcePips = $derived(hasTacticalSession(view) ? resourcePipsFromBudget(view.economyBudget) : []);
	// The digit badge each of the first row's slots would carry, read off the
	// SAME keymap the digit keydown handler below reads — a click's own
	// badge and the key that fires it never disagree. Digits only ever
	// number the FIRST row (`assignSlotKeys`'s own contract) — `expanded`
	// never changes what row 0 holds, only whether further rows follow it —
	// so this digit→action map does not depend on the dock's own
	// (player-owned) expanded state.
	const slotKeyLabels = $derived(
		Array.from({ length: SLOT_COUNT }, (_, index) => keyLabelFor(keymap, `slot.${index + 1}` as PlayCommand)),
	);
	const hotbarSlotAssignment = $derived(assignSlotKeys([hotbarRows(hotbar, false)[0] ?? []], slotKeyLabels));
	/** The composer's own mode: which slot's words it dispatches through.
	 * `null` until the player presses a words-taking slot; `composerSlot`
	 * (`../lib/dock-hotbar.ts`) resolves the fallback while that is so. */
	let composerModeId = $state<string | null>(null);
	const composerSlotValue = $derived(composerSlot(hotbar, composerModeId));
	const composerInput = $derived(
		composerSlotValue === null
			? undefined
			: view.actions.find((action) => action.id === composerSlotValue.id)?.input,
	);
	// The label always starts "Say or do something" (kept literally: tests
	// and the keymap's `composer.focus` hint both anchor on it) — only the
	// slot it currently resolves to changes.
	const composerLabel = $derived(
		composerSlotValue === null
			? "Say or do something — nothing here takes words."
			: `Say or do something — ${composerSlotValue.label}${
					composerSlotValue.groupLabel === "Me" || composerSlotValue.groupLabel === "Here"
						? " (to the room)"
						: ` (${composerSlotValue.groupLabel})`
				}`,
	);
	/**
	 * Reply suggestion (Selection model, "Decided details" 3): with nothing
	 * selected, the last line that addressed the player offers itself as the
	 * composer's default — the app never overwrites a selection the player
	 * actually made, so this is `null` the moment `selection` is not.
	 * Mirrors `defaultSayTarget`'s own "addressed me" rule (`play-table.ts`),
	 * retargeted at the speaker's own actor id.
	 */
	const replySuggestion = $derived.by(() => {
		if (selection !== null) return null;
		const addressedToMe = [...view.speech]
			.reverse()
			.find((line) => !line.mine && line.addresseeName === view.hero.name);
		if (addressedToMe?.speakerId == null) return null;
		const action = view.actions.find(
			(candidate) => actionTakesInput(candidate) && candidate.targetRef === `entity:${addressedToMe.speakerId}`,
		);
		if (action === undefined) return null;
		return { actorId: addressedToMe.speakerId, name: addressedToMe.speaker, actionId: action.id };
	});
	const acceptReplyKeyLabel = $derived(keyLabelFor(keymap, "hint.accept"));
	// The reply suggestion wins even while composerSlot is null (that is
	// exactly its own case: nobody else takes words, but someone just
	// addressed the player specifically) — it still shows disabled, since
	// accepting it (a click on the row-1 button, or `hint.accept`) is what
	// arms the composer, not typing into it first.
	const composerPlaceholder = $derived(
		replySuggestion !== null
			? `Reply to ${replySuggestion.name}${acceptReplyKeyLabel ? ` — press ${acceptReplyKeyLabel.toUpperCase()}` : ""}`
			: composerSlotValue === null
				? "Nothing here takes words."
				: composerLabel,
	);
	function acceptReply(): void {
		const reply = replySuggestion;
		if (reply === null) return;
		setSelection({ kind: "actor", actorId: reply.actorId });
		composerModeId = reply.actionId;
	}
	function findHotbarSlot(id: string) {
		const groups = [...(hotbar.answers ? [hotbar.answers] : []), ...hotbar.selection, hotbar.here, hotbar.me];
		for (const group of groups) {
			const slot = group.slots.find((candidate) => candidate.id === id);
			if (slot !== undefined) return slot;
		}
		return undefined;
	}
	/** Dispatches a hotbar slot id, from a click or its bound digit alike
	 * ("Dock anatomy"): a `dimmed:` id never acts; a words-taking slot sets
	 * the composer's mode and focuses it instead of acting; everything else
	 * — including a `move:<handle>` — goes through the existing
	 * `selectionAct`. */
	function pressSlot(id: string): void {
		const reactionSlot = REACTION_SLOT_IDS.indexOf(id as (typeof REACTION_SLOT_IDS)[number]);
		if (reactionSlot !== -1) {
			answerReaction(reactionSlot);
			return;
		}
		if (id.startsWith("dimmed:")) return;
		// The dialogue's numbered answer wins over a same-handle copy in the
		// general affordance listing. It is a complete invocation, even though
		// the underlying communication act carries dispatch text.
		if (dockAnswerEntries.some((answer) => answer.id === id)) {
			selectionAct(id);
			return;
		}
		if (findHotbarSlot(id)?.acceptsUtterance) {
			composerModeId = id;
			document.getElementById("play-dock-say")?.focus();
			return;
		}
		selectionAct(id);
	}
	/** Submits the composer's current mode's own action (axiom A4, W4) — the
	 * composer has no target chip of its own any more; `composerSlot`
	 * resolves which action carries the words, following the global
	 * selection. */
	async function submitSay(text: string, inputValues?: IntentInputValues): Promise<void> {
		const slot = composerSlotValue;
		if (slot === null) return;
		const route = slot.groupLabel === "Here" ? "room" : slot.groupLabel === "Me" ? "self" : "entity";
		if (await act(slot.id, text, "table", route, inputValues)) composerModeId = null;
	}
	function directActionFromComposer(): PlayAction | null {
		if (manipulationContext.status !== "ready") return null;
		const intent = intentFromComposer(factComposerDraft, manipulationContext.actions);
		if (intent === undefined) return null;
		const action = manipulationContext.actions.find(
			(candidate) => candidate.actionId === factComposerDraft.actionId,
		);
		const target = manipulationContext.targets.find(
			(candidate) => candidate.targetRef === factComposerDraft.targetRef,
		);
		if (action === undefined || target === undefined) return null;
		return {
			id: `composer:${action.actionId}:${target.targetFactId}`,
			label: action.displayName,
			verb: intent.kind === "communicate" ? "communicate" : "manipulate",
			descriptor: intent.kind === "communicate" ? intent.speech_act_id ?? "" : action.actionId,
			...(intent.kind === "manipulate" ? { actionId: action.actionId } : {}),
			targetName: target.targetName,
			targetRef: target.targetRef,
			acceptsUtterance: action.acceptsUtterance === true,
			...(intent.semantic_context === undefined ? {} : { semanticContext: intent.semantic_context }),
			...(action.input === undefined ? {} : { input: action.input }),
		};
	}
	async function attemptFactComposer(): Promise<void> {
		const action = directActionFromComposer();
		if (action === null || busy || localFeedback?.pending) return;
		const fields = action.input?.fields ?? [];
		// One utterance field travels as its bare text ("Brannoch"), several as
		// one JSON object (`utteranceFromInputValues`). A field whose author
		// named no channel keeps travelling with the words, as before.
		const words =
			action.input === undefined
				? factComposerDraft.utterance.trim() || undefined
				: utteranceFromInputValues(
						fields.map((field) => (field.channel === undefined ? { ...field, channel: "utterance" as const } : field)),
						factComposerDraft.inputValues,
					) || undefined;
		// What the stream shows for those values: "Label: value" per field,
		// never the transport text.
		const entered = fields.flatMap((field) => {
			const value = factComposerDraft.inputValues[field.name];
			const text = value === undefined ? "" : String(value).trim();
			return text === "" ? [] : [{ label: field.label ?? "", value: text }];
		});
		const completed = await act(
			action.id,
			words,
			"table",
			undefined,
			factComposerDraft.inputValues,
			action,
			entered.length === 0 ? undefined : entered,
		);
		const settled = actStatusKindFromOutcome(
			playTrail.entries().findLast((entry) => entry.kind === "act")?.outcome ?? null,
		);
		if (completed && (settled === "quiet" || settled === "delta")) {
			factComposerDraft = emptyComposerDraft();
			factComposerClearToken += 1;
		}
	}
	/** The dock's "Ways out" menu fills the composer, it does not travel
	 * (axioms A1/A4): see `fillGo`. An exit with no destination node fills
	 * like any other in a live session; only a legacy recording, which has
	 * no composer, still moves such an exit directly. */
	function chooseExit(handle: string): void {
		fillGo(handle);
	}

	// ── The participant head (sk-jay0.1.8.12 task 5, `TalkParticipants.svelte`
	// since sk-jay0.1.8.63.1 Part B): tap SELECTS the participant (axiom A4)
	// and, when they offer a words-taking act, sets the composer's mode to
	// it; a second tap on the ALREADY-selected participant toggles a
	// client-side view filter — never a private channel, everyone at the
	// place still hears everything; the filter only narrows the shared
	// stream's SPEECH entries below (`visibleExploreStream`). ──
	const participants: ThreadParticipant[] = $derived(occupants);
	// The conversation head is not the scene roster. It contains only people
	// the world currently permits the player to address through the shared
	// composer; everyone else remains available for inspection in Place.
	const talkParticipants = $derived(
		participants.filter((participant) =>
			view.actions.some(
				(action) => actionTakesInput(action) && action.targetRef === `entity:${participant.id}`,
			),
		),
	);
	let viewFilterId = $state<string | null>(null);
	let viewFilterPlaceId = $state<string | null>(null);
	const activeViewFilterId = $derived(
		viewFilterPlaceId === conversationPlaceId ? viewFilterId : null,
	);
	function setViewFilter(id: string | null): void {
		viewFilterId = id;
		viewFilterPlaceId = conversationPlaceId;
	}
	// The speaker filter narrows the stream's SPEECH entries only — the
	// player's own lines, activities and place rows always stay, so the
	// journal's own shape (dividers, outcomes) never disappears just because
	// a reader filtered to one speaker (sk-jay0.1.8.63.1 Part B, task 3).
	let streamFilter = $state<ChronicleFilterChip | null>(null);
	const visibleExploreStream = $derived(exploreStream.filter((entry) => {
		const chip = entry.kind === "place" ? "comings" : entry.chip;
		if (streamFilter !== null && chip !== streamFilter) return false;
		return activeViewFilterId === null || entry.kind !== "speech" || entry.mine || entry.speakerId === activeViewFilterId;
	}));
	/** A tap SELECTS the participant (axiom A4) and, when they offer a
	 * words-taking act, sets the composer's mode to it; a second tap on the
	 * already-selected participant toggles the stream's own view filter. */
	function tapParticipant(participant: ThreadParticipant): void {
		if (selection?.kind === "actor" && selection.actorId === participant.id) {
			setViewFilter(activeViewFilterId === participant.id ? null : participant.id);
			return;
		}
		const action = view.actions.find(
			(candidate) => actionTakesInput(candidate) && candidate.targetRef === `entity:${participant.id}`,
		);
		setSelection({ kind: "actor", actorId: participant.id });
		if (action !== undefined) composerModeId = action.id;
		setViewFilter(null);
	}

	/** Place selection browses the authorized detail; the draft stays untouched. */
	function selectPlaceOccupant(id: string | null): void {
		selectOccupant(id);
		setSelection(id !== null && selectedOccupant !== null ? { kind: "actor", actorId: id } : null, false);
	}

	// ── The mosaic: fixed tiles, a continuous layout the player can drag ──
	let isMobile = $state(false);
	let layout = $state<MosaicLayout>(restLayout(false));
	let layoutBeforeFocus: MosaicLayout | null = null;
	function publishLayout(next: MosaicLayout): void {
		onLayoutChange?.(copyLayout(next), isMobile);
	}

	/** `layout` is Svelte reactive state. Copy only the numeric contract at the
	 * component boundary instead of passing its non-cloneable reactive proxy. */
	function copyLayout(source: MosaicLayout): MosaicLayout {
		return {
			colShare: [...source.colShare] as [number, number, number],
			rowShare: Object.fromEntries(TILE_IDS.map((id) => [id, source.rowShare[id]])) as MosaicLayout["rowShare"],
		};
	}

	onMount(() => {
		if (typeof window.matchMedia !== "function") {
			isMobile = false;
			layout = initialLayout !== undefined && initialLayoutMobile === isMobile
				? copyLayout(initialLayout)
				: restLayout(isMobile);
			publishLayout(layout);
			return;
		}
		const mql = window.matchMedia("(max-width: 63.99rem)");
		isMobile = mql.matches;
		layout = initialLayout !== undefined && initialLayoutMobile === isMobile
			? copyLayout(initialLayout)
			: restLayout(isMobile);
		publishLayout(layout);
		const onChange = (event: MediaQueryListEvent): void => {
			// A manual layout from one breakpoint carries no meaning at the
			// other — different columns, different stack — so the breakpoint
			// change starts clean at rest, same as first mount. This follows
			// the player's own viewport change, never the world's state.
			isMobile = event.matches;
			setLayout(restLayout(isMobile), "breakpoint");
		};
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	});

	function levelOf(id: TileId): "strip" | "card" | "stage" {
		return levelInLayout(layout, id, isMobile);
	}

	/** The freshest world tick this component currently knows about — the
	 * same reading `latestTick` (`play-session.ts`) takes of the same two
	 * already tick-stamped arrays, duplicated here rather than exported
	 * across the lane boundary: this component only has `view`, never the
	 * session that builds it. */
	function currentTrailTick(): number {
		let max = 0;
		for (const event of view.events) if (event.tick > max) max = event.tick;
		for (const line of view.speech) if (line.tick > max) max = line.tick;
		return max;
	}

	/**
	 * Every layout mutation the player or the world can actually SEE goes
	 * through here rather than a bare `layout = …` assignment, so one trail
	 * entry (`play-trail.ts`) lands per tile whose level actually changed,
	 * tagged with what caused it (tap, drag, pinch, reset, pull, breakpoint,
	 * scroll). The two continuous in-flight paths — `onWindowPointerMove`'s
	 * per-frame drag delta and `onWindowTouchMove`'s per-frame pinch delta —
	 * deliberately keep assigning `layout` directly: logging every intermediate
	 * frame of a drag would flood the ~100-entry ring with noise for a
	 * gesture that is, from the trail's point of view, ONE layout change; only
	 * their own release handlers (`endDrag`, `endPinch`) call this, with the
	 * gesture's final, settled layout.
	 */
	function setLayout(next: MosaicLayout, trigger: string, rememberFocus = true): void {
		const previous = layout;
		if (trigger === "reset" || trigger === "breakpoint") layoutBeforeFocus = null;
		// Shrink returns to the overview (sk-jay0.1.8.102, owner decision
		// 2026-11-12): only an arrangement with NO filling tile is worth going
		// back to. Opening a second tile from a zoomed one keeps the layout
		// remembered before the first zoom, so one Shrink never lands on
		// another zoomed tile.
		else if (
			rememberFocus &&
			TILE_IDS.some((id) => tileFillsViewport(next, id, isMobile)) &&
			!TILE_IDS.some((id) => tileFillsViewport(previous, id, isMobile))
		) layoutBeforeFocus = previous;
		layout = next;
		publishLayout(next);
		const tick = currentTrailTick();
		for (const id of TILE_IDS) {
			const before = levelInLayout(previous, id, isMobile);
			const after = levelInLayout(next, id, isMobile);
			if (before !== after) playTrail.recordLayout({ tile: id, level: after, trigger, tick });
		}
	}

	// A large tile may still share the mosaic. Only a fully focused tile
	// restores the last arrangement that had no filling tile (the overview);
	// every other head maximizes it.
	function toggleTile(id: TileId): void {
		if (tileFillsViewport(layout, id, isMobile)) {
			const restored = layoutBeforeFocus ?? restLayout(isMobile);
			layoutBeforeFocus = null;
			setLayout(restored, "tap", false);
		} else setLayout(focusedLayout(id), "tap");
	}

	// "Reset layout" (seat menu, App.svelte, sk-jay0.1.8.14 task a): the seal
	// menu owns no layout state of its own, so it hands PlayTable a plain
	// incrementing counter — the same shape App's own `retry` already uses to
	// ask for "do that again" — and every change here snaps back to rest, the
	// same target a double-click/-tap on a boundary handle reaches below.
	// `resetLayoutRequest` is only ever read inside this effect (reading a
	// prop outside a reactive context only captures its mount-time value —
	// `state_referenced_locally`), so first-run vs. "actually changed" is
	// told apart with its own flag instead of a baseline snapshotted early.
	let resetLayoutSeen = false;
	let lastSeenReset = 0;
	$effect(() => {
		const request = resetLayoutRequest ?? 0;
		if (!resetLayoutSeen) {
			resetLayoutSeen = true;
			lastSeenReset = request;
			return;
		}
		if (request === lastSeenReset) return;
		lastSeenReset = request;
		setLayout(restLayout(isMobile), "reset");
	});

	const columnTemplate = $derived(columnTemplateFromLayout(layout));
	const rowTemplates = $derived(DESKTOP_COLUMNS.map((_, i) => rowTemplateFromLayout(layout, i)));
	const columnNarrow = $derived(DESKTOP_COLUMNS.map((_, i) => columnIsNarrowInLayout(layout, i)));
	const columnHasActiveRows = $derived(
		DESKTOP_COLUMNS.map((ids) => ids.some((id) => layout.rowShare[id] > 0)),
	);
	const mobileRows = $derived(mobileRowTemplateFromLayout(layout));

	// The table tile is "at stage" both at rest (nobody else focused) and when
	// explicitly maximised — the two ways `levelOf("table")` reads "stage".
	const tableIsStage = $derived(levelOf("table") === "stage");

	// The map tile mounts `@spellkave/map-canvas` only once it reaches its
	// stage level, and only outside a fight — a fight keeps the tactical grid
	// from `spellkave_map` (ADR-0052) at every level instead, both stage and
	// card. Read `hasTacticalSession(view)` directly rather than `combat ===
	// null`: since `fightLayout` (below) puts the map tile at its stage level
	// for the WHOLE fight by default, not only once a player has tapped it
	// open, this condition is now the one thing standing between the
	// exploring MapLibre canvas and the tactical grid, so it has to key off
	// the fight itself rather than incidentally off whatever `combatFromView`
	// happened to compute this tick (the two read the same value today, but
	// saying so here is the point — a future roster edge case must not
	// silently reopen the exploring canvas mid-fight). `mapMode` is "full"
	// only once the tile actually fills the viewport, not merely past the
	// stage threshold (`mosaic.ts`, `tileFillsViewport`) — a tile that shares
	// its column with a sibling still reads "medium".
	const mapOpen = $derived(levelOf("map") === "stage" && !hasTacticalSession(view));
	const mapMode = $derived(tileFillsViewport(layout, "map", isMobile) ? "full" : "medium");

	// The layout belongs to the player (axiom A2,
	// `ledger/designs/play-interaction-axioms.md`): nothing the world does —
	// a fight opening, the turn passing to the player, a reaction window —
	// ever resizes a tile. The old "pull" (snap to rest on your turn) and
	// fight posture (snap to `fightLayout` on entry) fought each other: the
	// pull landed a tick after the posture and threw the player out of the
	// battle view mid-fight. What is left is an OFFER in the dock's notice
	// slot, once per fight, that the player takes or dismisses; a reaction
	// needs no layout at all any more because its prompt lives in the dock
	// (axiom A7, the `dockUrgent` snippet below).
	let layoutHint = $state<"fight" | "rest" | null>(null);
	// Only a player who TOOK the fight layout is offered the way back, and
	// the way back is the arrangement they had, not a generic rest.
	let layoutBeforeFightHint: MosaicLayout | null = null;
	let hintWasInFight = false;
	let hintWasMyTurn = false;
	$effect(() => {
		const inFight = hasTacticalSession(view);
		const myTurn = view.session.myTurn;
		untrack(() => {
			if (inFight && !hintWasInFight) {
				// Nothing to offer a player whose map already is the battle picture.
				layoutHint = levelOf("map") === "stage" ? null : "fight";
			} else if (!inFight && hintWasInFight) {
				layoutHint = layoutBeforeFightHint !== null ? "rest" : null;
			} else if (layoutHint === "fight" && hintWasMyTurn && !myTurn) {
				// The player has played a whole own turn without taking it.
				layoutHint = null;
			}
		});
		hintWasInFight = inFight;
		hintWasMyTurn = myTurn;
	});

	function takeLayoutHint(): void {
		if (layoutHint === "fight") {
			layoutBeforeFightHint = copyLayout(layout);
			setLayout(fightLayout(), "hint");
		} else if (layoutHint === "rest") {
			setLayout(layoutBeforeFightHint ?? restLayout(isMobile), "hint");
			layoutBeforeFightHint = null;
		}
		layoutHint = null;
	}

	function dismissLayoutHint(): void {
		if (layoutHint === "rest") layoutBeforeFightHint = null;
		layoutHint = null;
	}

	// Pack reaching stage highlights its first row (`Pack.svelte`'s own
	// `selectedId ?? items[0]?.id` fallback) but nothing had asked for that
	// row's detail — the live app sat on "Loading what you can do with
	// this…" until the player clicked (verifier finding, sk-jay0.1.8.6). Ask
	// for the CURRENTLY-active item's detail once whenever the Pack tile is
	// at stage — same read as a click, "read on selection" unchanged for
	// every later change — guarded by `lastRequestedItemId` so reopening an
	// already-detailed tile, or an unrelated view refresh, never re-fires it
	// within the same reader generation. A replacement reader requests fresh
	// authorized handles/revisions; a missing selection falls back to the first row.
	$effect(() => {
		if (levelOf("pack") !== "stage") return;
		const activeId = selectedItemId !== null && packById.has(selectedItemId)
			? selectedItemId
			: pack[0]?.id ?? null;
		if (activeId !== null) requestItem(activeId);
	});

	// ── Mosaic resize: explicit splitters own pointer drags, pinch on touch.
	// `mosaic.ts` owns every share computation; this only turns the splitter
	// movement into row/column deltas. A 6px dead zone before a drag counts as
	// a drag. The `dragging` flag (styles.css) disables the grid-track
	// transition for the duration so tracks follow the pointer every frame;
	// releasing re-enables it, and the 240ms transition carries the snap. ──
	let dragging = $state(false);

	type DragKind = "row" | "col" | "corner";
	interface EdgeGrab {
		id: TileId;
		kind: DragKind;
		edge?: "top" | "bottom";
		side?: "left" | "right";
		x: number;
		y: number;
		base: MosaicLayout;
		rowPixels?: [number, number];
		rowAvailablePixels?: number;
		colPixels?: [number, number];
		moved: boolean;
	}
	let drag: EdgeGrab | null = null;

	interface PinchGrab {
		id: TileId;
		d0: number;
		t: number;
	}
	let pinch: PinchGrab | null = null;

	function rowSplitterPixels(id: TileId): [number, number] | undefined {
		const lower = belowSibling(id, isMobile);
		const upperRect = document.querySelector<HTMLElement>(`.tile[data-tile="${id}"]`)?.getBoundingClientRect();
		const lowerRect = lower === null
			? undefined
			: document.querySelector<HTMLElement>(`.tile[data-tile="${lower}"]`)?.getBoundingClientRect();
		return upperRect && lowerRect ? [upperRect.height, lowerRect.height] : undefined;
	}

	function rowAvailablePixels(id: TileId): number | undefined {
		return document
			.querySelector<HTMLElement>(`.tile[data-tile="${id}"]`)
			?.closest<HTMLElement>(".mosaic-col")
			?.getBoundingClientRect().height;
	}

	function columnSplitterPixels(handle: HTMLElement, id: TileId): [number, number] | undefined {
		const mosaic = handle.closest<HTMLElement>(".mosaic");
		const columns = mosaic === null ? [] : Array.from(mosaic.querySelectorAll<HTMLElement>(":scope > .mosaic-col"));
		const column = columnIndexOf(id);
		const nextColumn = columns[column + 1];
		const currentColumn = columns[column];
		return currentColumn && nextColumn
			? [currentColumn.getBoundingClientRect().width, nextColumn.getBoundingClientRect().width]
			: undefined;
	}

	function startSplitterDrag(
		event: PointerEvent,
		id: TileId,
		kind: DragKind,
		edge?: "top" | "bottom",
		side?: "left" | "right",
	): void {
		event.preventDefault();
		event.stopPropagation();
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture?.(event.pointerId);
		drag = {
			id,
			kind,
			edge,
			side,
			x: event.clientX,
			y: event.clientY,
			base: layout,
			rowPixels: kind === "row" || kind === "corner" ? rowSplitterPixels(id) : undefined,
			rowAvailablePixels: kind === "row" || kind === "corner" ? rowAvailablePixels(id) : undefined,
			colPixels: kind === "col" || kind === "corner" ? columnSplitterPixels(handle, id) : undefined,
			moved: false,
		};
	}

	function resetFromSplitter(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		drag = null;
		dragging = false;
		setLayout(restLayout(isMobile), "reset");
	}

	function onWindowPointerMove(event: PointerEvent): void {
		if (!drag) return;
		const dx = event.clientX - drag.x;
		const dy = event.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < 6) return;
		if (!drag.moved) {
			drag.moved = true;
			dragging = true;
		}
		const edgeDrag: {
			row?: {
				edge: "top" | "bottom";
				delta: number;
				pixels?: [number, number];
				availablePixels?: number;
			};
			col?: { side: "left" | "right"; delta: number; pixels?: [number, number] };
		} = {};
		if ((drag.kind === "row" || drag.kind === "corner") && drag.edge !== undefined) {
			edgeDrag.row = {
				edge: drag.edge,
				delta: dy,
				pixels: drag.rowPixels,
				availablePixels: drag.rowAvailablePixels,
			};
		}
		if ((drag.kind === "col" || drag.kind === "corner") && drag.side !== undefined) {
			edgeDrag.col = { side: drag.side, delta: drag.side === "right" ? dx : -dx, pixels: drag.colPixels };
		}
		layout = applyEdgeDrag(drag.base, drag.id, edgeDrag, isMobile);
	}

	function endDrag(): void {
		if (!drag) return;
		const { moved } = drag;
		drag = null;
		dragging = false;
		if (!moved) return; // short of the dead zone: the head's own click already jumped or rested it
		// A splitter is a pane boundary, not a zoom gesture: retain exactly the
		// continuous layout the player released. Reset and tile-header focus
		// remain the deliberate routes to the named rest/stage arrangements.
		setLayout(layout, "drag");
	}

	function touchDistance(touches: TouchList): number {
		const a = touches[0];
		const b = touches[1];
		if (!a || !b) return 0;
		return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
	}

	function onMosaicTouchStart(event: TouchEvent): void {
		if (event.touches.length !== 2 || !(event.target instanceof Element)) return;
		const tile = event.target.closest<HTMLElement>(".tile");
		const id = tile?.dataset.tile as TileId | undefined;
		if (id === undefined) return;
		drag = null; // a second finger landing cancels any single-finger edge drag
		pinch = { id, d0: touchDistance(event.touches), t: tileSizeInLayout(layout, id, isMobile) };
		dragging = true;
	}

	// touchmove stays passive except while a pinch is actually in flight, so
	// ordinary scrolling/tapping elsewhere on the page is never blocked.
	function onWindowTouchMove(event: TouchEvent): void {
		if (!pinch || event.touches.length !== 2) return;
		event.preventDefault();
		const d = touchDistance(event.touches);
		if (d === 0 || pinch.d0 === 0) return;
		pinch.t = Math.max(0, Math.min(1, pinch.t + (d / pinch.d0 - 1) * 1.2));
		layout = lerpLayout(restLayout(isMobile), focusedLayout(pinch.id), pinch.t);
	}

	function endPinch(): void {
		if (!pinch) return;
		const { id, t } = pinch;
		pinch = null;
		dragging = false;
		setLayout(t >= 0.5 ? focusedLayout(id) : restLayout(isMobile), "pinch");
	}

	onMount(() => {
		window.addEventListener("pointermove", onWindowPointerMove);
		window.addEventListener("pointerup", endDrag);
		window.addEventListener("pointercancel", endDrag);
		window.addEventListener("touchmove", onWindowTouchMove, { passive: false });
		window.addEventListener("touchend", endPinch);
		window.addEventListener("touchcancel", endPinch);
		return () => {
			window.removeEventListener("pointermove", onWindowPointerMove);
			window.removeEventListener("pointerup", endDrag);
			window.removeEventListener("pointercancel", endDrag);
			window.removeEventListener("touchmove", onWindowTouchMove);
			window.removeEventListener("touchend", endPinch);
			window.removeEventListener("touchcancel", endPinch);
		};
	});

	// A stage transcript makes speech reachable; a combat frame alone does not.
	// Card-outside-a-fight semantics are unchanged (Thread is still that
	// case's own renderer); at stage, and now at card DURING a fight too
	// (sk-jay0.1.8.63.13: `Thread` no longer mounts there — the same shared
	// stream and selection row do), this means "the shared stream is mounted
	// while a dialogue is open or the fight has speech to show" — `thread`
	// stays the truth proxy for "has speech" even though its own lines no
	// longer render directly in that branch (mirrors stage's own pre-existing
	// approach from sk-jay0.1.8.63.1 Part B: a different DOM, same truth
	// conditions).
	const conversationMounted = $derived(
		levelOf("table") === "card"
			? combat !== null
				? dialogue !== null || thread.lines.length > 0
				: dialogue !== null
			: tableIsStage && (dialogue !== null || (combat !== null && thread.lines.length > 0)),
	);
	const conversationLines = $derived(
		!conversationMounted
			? 0
			: levelOf("table") === "card" && combat === null
				? thread.lines.slice(-2).length
				: // Stage, and card during a fight: the number of SPEECH entries
					// the shared stream currently renders under the active filter —
					// `visibleExploreStream` is the same filtered array `ActivityFeed`
					// is handed below.
					visibleExploreStream.filter((entry) => entry.kind === "speech").length,
	);
	// The turn bar's own economy strip (S4, sk-jay0.1.8.40 mount step): it
	// mounts only where `Combat` itself mounts (both card's and stage's
	// `{#if combat}` branch — neither fires at the table's own "strip"
	// zoom) and only when the read returned at least one channel row
	// (`Economy`'s own honest-absence rule: a fresh turn commonly starts
	// with none, `Combat.svelte`'s `hasEconomy`). Counts only, bounded, no
	// channel ids — the same closed vocabulary `conversation_lines` uses.
	const economyMounted = $derived(
		combat !== null && levelOf("table") !== "strip" && (view.economy?.length ?? 0) > 0,
	);
	const economyLines = $derived(economyMounted ? (view.economy?.length ?? 0) : 0);
	$effect(() => {
		playObservation.record({
			phase: "presentation", interaction: 0,
			conversation_mounted: conversationMounted, conversation_lines: conversationLines,
			economy_mounted: economyMounted, economy_lines: economyLines,
		});
	});
	let lastActivityObservation = "";
	$effect(() => {
		// The effect runs after the DOM update; mounted does not claim viewport visibility.
		const operations = view.operations;
		const expanded = levelOf("table") !== "strip";
		const mounted = expanded && tableRoot?.querySelector('[data-slot="activity-status"]') != null;
		const event = activityObservation(operations, mounted);
		const signature = JSON.stringify(event);
		if (signature !== lastActivityObservation) {
			lastActivityObservation = signature;
			playObservation.record(event);
		}
	});
	let seenSpeechCount = $state(0);
	let seenEventsCount = $state(0);
	$effect(() => {
		if (tableIsStage) {
			// Explore's chronology is always fully mounted now (no "Earlier here"
			// disclosure to expand first), so it counts as seen the same way
			// Talk's unfiltered transcript already does.
			if ((conversationMounted && activeViewFilterId === null) || (!combat && !dialogue)) {
				seenSpeechCount = view.speech.length;
			}
			seenEventsCount = view.events.length;
		} else if (combat !== null && dialogue !== null && levelOf("table") === "card") {
			// Task C (sk-jay0.1.8.37): the fight's own card mounts the same
			// Thread content Talk alone shows at card, so the conversation is
			// legible without ever reaching stage — the table's unread badge
			// must catch up here too, the same way it already does once the
			// table reaches stage, or a whole fight (permanently at card,
			// `fightLayout`) would show a badge no stage view is ever taken
			// to clear.
			seenSpeechCount = view.speech.length;
			seenEventsCount = view.events.length;
		}
	});
	const tableBadge = $derived(
		Math.max(0, view.speech.length - seenSpeechCount) +
			Math.max(0, view.events.length - seenEventsCount),
	);

	// The hero carries the downed fact (`heroDownedFromView`: an exact condition
	// id, no HP check). It ranks directly above Talk in the three scene-head
	// derivations below and tells the composer the hero cannot act right now.
	// It adds no dock notice (sk-jay0.1.8.101).
	const downed = $derived(heroDownedFromView(view));
	const tableGlyph = $derived(
		view.reaction !== null || combat ? "melee" : downed ? "person" : dialogue ? "speak" : "walk",
	);
	// A category, not the precise turn status — the stage widget (Combat's own
	// "Your turn" / "Waiting" meta) already carries that; the head just says
	// which scene the table is showing right now, by priority: Reaction,
	// Fight, Down, Talk, Activity, Explore.
	const tableModeLabel = $derived(
		view.reaction !== null
			? "Reaction"
			: combat
				? "Fight"
				: downed
					? playCopy.table.downLabel
					: dialogue
						? "Talk"
						: view.operations?.selected && !view.operations.selected.terminal
							? "Activity"
							: "Explore",
	);
	const lastHeard = $derived([...view.speech].reverse().find((line) => !line.mine) ?? null);
	const tableSummaryText = $derived(
		view.reaction !== null
			? `${view.reaction.originatingActorName ?? "Someone"} acts. The world holds the moment open.`
			: (combat?.status ?? (downed ? playCopy.table.downSummary : null) ?? dialogue?.dialog.prompt ?? (view.operations?.selected && !view.operations.selected.terminal ? `${view.operations.selected.label}: ${view.operations.selected.phase}` : null) ?? lastHeard?.text ?? "Choose what to do."),
	);
	const wornCount = $derived(pack.filter((item) => item.equipped).length);
	const modeText: Record<TileId, string> = $derived({
		table: tableModeLabel,
		map: scenePlace?.name ?? mapFrame.placeName,
		place: scenePlace ? `${scenePlace.exits.length} ${scenePlace.exits.length === 1 ? "way out" : "ways out"}` : "—",
		hero: view.hero.hp === undefined ? view.hero.name : `HP ${view.hero.hp}`,
		pack: `${wornCount} worn`,
	});
	const glyphOf: Record<TileId, string> = {
		table: "walk",
		map: "map",
		place: "compass",
		hero: "person",
		pack: "thing",
	};
</script>

{#snippet head(id: TileId)}
	<!-- Pointer convenience only: the head's click is a shortcut for the same
	     jump the explicit, keyboard-reachable zoom button already offers below
	     with its own aria-label, so the head itself stays out of tab order. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<header class="tile-head" data-head={id} onclick={() => toggleTile(id)}>
		<MosaicGlyph name={id === "table" ? tableGlyph : glyphOf[id]} class="tile-icon" />
		<span class="tile-label">{TILE_TITLES[id]}</span>
		{#if id === "table" && tableBadge > 0}
			<span class="tile-badge">{tableBadge}</span>
		{/if}
		<span class="tile-spacer"></span>
		<span class="tile-mode">{modeText[id]}</span>
		<button
			type="button"
			class="tile-zoom"
			aria-label={tileFillsViewport(layout, id, isMobile) ? `Shrink ${TILE_TITLES[id]}` : `Open ${TILE_TITLES[id]}`}
			onclick={(event) => {
				event.stopPropagation();
				toggleTile(id);
			}}
		>
			<MosaicGlyph name={tileFillsViewport(layout, id, isMobile) ? "shrink" : "grow"} class="tile-icon" />
		</button>
	</header>
{/snippet}

<!-- One link per name (sk-jay0.1.8.63.7/.10, retargeted at axiom A1/W5): a
	     present occupant's name is its own `InfoLink` (information only —
	     never wrapped by `DefLinkText`, the two links would compete for the
	     same name), wrapped so a click OR a keyboard activation additionally
	     SELECTS that occupant (the map, the turn order and now every name in
	     the stream all select the same way; the dock is the one place that
	     acts — the `⋯` action menu this name used to carry is gone). A click
	     inside an opened info card never reaches this handler: `InfoCardProvider`
	     portals a card's content elsewhere in the DOM, so it is never a
	     descendant of the wrapping span the click would have to bubble
	     through. A name with no live occupant handle (a departed speaker)
	     stays plain text — it opens and selects nothing. `InfoLink` takes no
	     accessible-name override of its own, so an appended visually-hidden
	     "details" word disambiguates this button's accessible name ("<name>
	     details" — the accessible-name-from-content algorithm always joins a
	     button's child text runs with one space, which is why this is a
	     separate word rather than leading punctuation) from
	     `TalkParticipants`' own button for the same occupant while Talk is
	     open — the same disambiguation `EntityReaderDialog` used to supply
	     via its own `triggerAriaLabel`. -->
<!-- The snippet body hugs its tags on purpose: whitespace around the
     blocks renders as a text node, which put a gap between a name and the
     comma after it. -->
{#snippet entityNameNode(name: string, occupantId: string | null | undefined)}{#if occupantId != null && occupantsById.has(occupantId)}<!-- svelte-ignore a11y_no_static_element_interactions --><span
			onclick={() => setSelection({ kind: "actor", actorId: occupantId })}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === " ") setSelection({ kind: "actor", actorId: occupantId });
			}}
			><InfoLink refId={`occupant:${occupantId}`}>{name}<span class="sr-only">{" details"}</span></InfoLink
			></span
		>{:else}{name}{/if}{/snippet}

{#snippet streamFilters()}
	<!-- A compact segmented control rather than a row of full-size stream
	     actions: `Button`'s xs size keeps its 44px pointer target while the
	     visible control stays out of the journal's way. The filled segment and
	     aria-pressed state make a narrowed stream legible at a glance. -->
	<ul class="flex shrink-0 self-start overflow-hidden rounded-md border border-border bg-background/75" aria-label="Filter the stream">
		<li><Button size="xs" variant={streamFilter === null ? "secondary" : "ghost"} class="rounded-none" aria-pressed={streamFilter === null} onclick={() => { streamFilter = null; setViewFilter(null); }}>All</Button></li>
		{#each Object.entries(CHRONICLE_CHIP_LABELS) as [id, label] (id)}
			<li><Button size="xs" variant={streamFilter === id ? "secondary" : "ghost"} class="rounded-none" aria-pressed={streamFilter === id} onclick={() => (streamFilter = streamFilter === id ? null : id as ChronicleFilterChip)}>{label}</Button></li>
		{/each}
	</ul>
{/snippet}

{#snippet exploreStreamLine(entry: ExploreStreamEntry)}
	{#if entry.kind === "place"}
		<!-- The macOS/iOS grouped-list pattern (sk-jay0.1.8.63.5): a place
		     change is a relevant event, so its row is a section header,
		     clearly stronger than the old quiet hairline — `ActivityFeed`'s own
		     `isSectionHeader` (below) marks the row's section-divider hook; this
		     snippet only supplies the header's look (`ActivitySectionHeader`,
		     `@spellkave/ui-widgets`). `level={4}`: the Place tile's own place
		     name is already a level-3 heading, so a level-4 heading here keeps
		     both reachable by their own distinct query. Only the newest place
		     row carries `entry.company` (`exploreStreamFromView`'s own rule) —
		     an older arrival never claims who is present now. `detailContent`
		     (sk-jay0.1.8.63.6) carries the company prose; each present
		     occupant's own NAME inside it is now its own detail-reader button
		     (sk-jay0.1.8.63.7, `entityNameNode`) rather than the whole sentence
		     going through `DefLinkText` as one span — the connective words
		     (" and ", " are nearby") stay plain, never reference-linked. Only
		     THIS row's own names carry the ⋯ action menu (sk-jay0.1.8.63.10):
		     it is the newest place row, the one place `entry.companyParts`
		     is ever populated (`exploreStreamFromView`'s own rule). -->
		{@const company = entry.company}
		{@const companyParts = entry.companyParts}
		{#if company && companyParts}
			{#snippet placeCompanyDetail()}
				<!-- One line on purpose: a line break between the parts renders as a
				     space, which put a gap before the comma after a name button. -->
				<span>{#each companyParts as part, index (`${index}:${part.text}`)}{#if part.kind === "name"}{@render entityNameNode(part.text, part.occupantId ?? null)}{:else}{part.text}{/if}{/each}</span>
			{/snippet}
			<ActivitySectionHeader title={entry.heading} detailContent={placeCompanyDetail} level={4} />
		{:else}
			<ActivitySectionHeader title={entry.heading} level={4} />
		{/if}
	{:else if entry.kind === "speech"}
		<!-- One message shape for outgoing and incoming speech: its heading,
		     actual addressee (when supplied), and words stay separately
		     inspectable instead of collapsing an outgoing message into a prose
		     echo such as “You said …”. -->
		<div data-slot="explore-speech-line" data-speech-direction={entry.mine ? "outgoing" : "incoming"}>
			{#snippet speakerHeading()}{#if entry.mine}You{:else}{@render entityNameNode(entry.speaker ?? "", entry.speakerId ?? null)}{/if}{/snippet}
			<SpeechBubble speaker={entry.mine ? "You" : entry.speaker ?? ""} heading={speakerHeading} outgoing={entry.mine} continued={!entry.startsBurst}>

				{#if entry.addresseeName !== null && entry.addresseeName !== undefined}
					<p class="sk-label sk-play-muted m-0">to {entry.addresseeName}</p>
				{:else if entry.addressing === "room"}
					<p class="sk-label sk-play-muted m-0">to the room</p>
				{:else if entry.addressing === "self"}
					<p class="sk-label sk-play-muted m-0">to yourself</p>
				{/if}
				{#if entry.isChoice}
					<p class="sk-play-prose italic m-0">
						<span class="sk-play-muted not-italic">Chose ·</span>{" "}<DefLinkText text={entry.body ?? ""} enabled={referencesEnabled} />
					</p>
				{:else}
					<p class="sk-play-prose m-0"><DefLinkText text={entry.body ?? ""} enabled={referencesEnabled} /></p>
				{/if}
				{#if entry.outcome !== null && entry.outcome !== undefined}
					<p class="sk-play-muted m-0 text-sm">{entry.outcome}</p>
				{/if}
			</SpeechBubble>
		</div>
	{:else if entry.kind === "event"}
		<!-- World facts as journal lines (sk-jay0.1.8.63.2): quieter than
		     speech and own acts — one small-text line, a leading chip label
		     (the same wording the stream's filter chips
		     use, shared via `CHRONICLE_CHIP_LABELS` rather than a second copy
		     of those four strings), the sentence itself at normal weight when
		     `entry.important` and muted otherwise — the Chronicle card's own
		     importance split, carried onto this surface. No `InfoLink` on an
		     actor name here: the row shows Play's own sentence
		     (`chronicleSentence`), built from the entry's structured fields
		     with every name resolved at ingest; a link per named actor is
		     not wired. -->
		<p class="m-0 text-sm" class:sk-play-muted={!entry.important}>
			<span class="sk-label sk-play-muted">{CHRONICLE_CHIP_LABELS[entry.chip ?? "things"]} ·</span>{" "}<DefLinkText
				text={entry.heading}
				enabled={referencesEnabled}
			/>
		</p>
	{:else}
		<div class="play-explore-activity__line">
			<!-- `entry.heading` is the action's own label (or, for a spoken
			     activity, the "You said "…"" line — sk-jay0.1.8.63.6 leaves
			     both plain, exactly as before: a heading is never prose, and
			     the "You said" form already quotes the player's own words
			     verbatim). Only `entry.body` — the outcome/refusal prose — gets
			     the reference treatment. -->
			<p class="sk-play-prose m-0">{entry.heading}</p>
			{#if entry.body !== null}
				<!-- `whitespace-pre-line`: an input-field row's body is its
				     entered values and, on a second line, the outcome. -->
				<p class="sk-play-muted m-0 whitespace-pre-line text-sm">
					<DefLinkText text={entry.body} enabled={referencesEnabled} />{" "}{#if entry.refusal}<InfoHint
							label={`Why: ${entry.refusal.code}${entry.refusal.detail ? ` — ${entry.refusal.detail}` : ""}`}
						/>{/if}
				</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet exploreContextHeader()}
	<header class="table-context">
		<span class="table-context__place">{exploreContext.placeName}</span>
		{#if exploreContext.company}
			<span class="table-context__company sk-play-muted"><DefLinkText text={exploreContext.company} enabled={referencesEnabled} /></span>
		{/if}
	</header>
{/snippet}

{#snippet activeActivityStatus()}
	{#if view.operations?.state !== "failed" && view.operations?.selected && !view.operations.selected.terminal}
		<!-- This is deliberately inside the scrolling chronology, after its
		     completed entries. A travel session is what is happening now, not a
		     persistent banner that pushes the newest events away from the reader. -->
		<div class="play-explore-active-status border-t border-[var(--border)] pt-3 mt-4">
			<ActivityStatus {...view.operations.selected} />
		</div>
	{/if}
{/snippet}

{#snippet tableTile()}
	<section class="tile" data-tile="table" data-zoom={levelOf("table")} aria-label={TILE_TITLES.table} bind:this={tableRoot}>
		{@render head("table")}
		<div class="tile-body">
			{#if levelOf("table") !== "strip" && view.operations}
				{#if view.operations.state === "failed"}
					<p role="status">Activity status is unavailable. Reconnecting or refreshing will retry.</p>
				{/if}
				{#if levelOf("table") === "stage" && onSelectOperation}
					<div class="flex flex-wrap gap-2">
						{#each view.operations.items.filter((activity) => activity.id !== view.operations?.selected?.id) as activity (activity.id)}
							<Button size="sm" variant="outline" aria-pressed={view.operations.selected?.id === activity.id} onclick={() => void onSelectOperation?.(activity.id)}>{activity.label}: {activity.phase}</Button>
						{/each}
						{#if view.operations.nextCursor}
							<Button size="sm" variant="outline" onclick={() => void onSelectOperation?.(view.operations?.selected?.id ?? null, view.operations?.nextCursor ?? undefined)}>More activities</Button>
						{/if}
						{#if view.operations.total !== null && view.operations.total > view.operations.items.length}
							<p>{view.operations.items.length} of {view.operations.total} ongoing activities on this page.</p>
						{/if}
						{#if view.operations.state === "failed"}
							<!-- A finished activity needs no player-facing "refresh"; the
							     control read as a developer button at the top of the Table. -->
							<Button size="sm" variant="outline" onclick={() => void onSelectOperation?.(null)}>Refresh activities</Button>
						{/if}
					</div>
				{/if}
			{/if}
			{#if levelOf("table") === "card"}
				{#if combat}
					<!-- The fight Table at card level (sk-jay0.1.8.63.13): a
					     compact turn bar (tracker + End turn only —
					     `selectionMode` drops the verb row and standalone chips,
					     since acting now happens through the selection row
					     below, never a second scene) sticky above the SAME
					     stream stage renders, plus the selection row itself.
					     `Thread` is no longer mounted here: the fight's own
					     speech already merges into this stream
					     (`dialogueBurstIds`/`alwaysAdmitIds` in
					     `exploreStreamFromView`'s caller), so a card-level
					     conversation is never hidden — it just no longer gets a
					     second, separate transcript. -->
					<Combat
						combat={combatForWidget!}
						targets={combatTargets}
						selectedTargetRef={combatSelectedTargetRef}
						onSelectTarget={selectTurnOrderTarget}
						onEndTurn={() => void onEndTurn()}
						selectionMode
						{busy}
						density="card"
						chrome="bare"
					/>
					<!-- Scroll-follow at card level (sk-jay0.1.8.63.2 task 7): the ONE
					     `followExplore` controller already built for the stage stream
					     (`createFollowScroll`) is bound here too, rather than a second
					     instance — card and stage never both mount the Table stream at
					     once (`levelOf("table")` is exactly one of them), so
					     `exploreStreamEl` always resolves to whichever container is
					     actually on screen. Simpler than tracking which instance owns
					     which container, and the controller's own `getScrollHost` is
					     already lazy for exactly this reason. -->
					{@render streamFilters()}
					<div class="table-card-stream sk-stream-scroll" bind:this={exploreStreamEl}>
						{#if exploreStream.length > 0}
							<div bind:this={exploreStreamContentEl}>
								<ActivityFeed
										readable
									items={visibleExploreStream}
									ariaLabel="What has been said"
									emptyText={streamFilter === null ? "Nothing has happened here yet." : "No visible events match this filter."}
									renderItem={exploreStreamLine}
									isSectionHeader={(entry) => entry.kind === "place"}
								/>
							</div>
						{/if}
						{@render activeActivityStatus()}
					</div>
				{:else if dialogue}
					<!-- Talk's own card content (sk-jay0.1.8.12 task 6): the last two
					     lines — not the single-line paper quote every other scene
					     still uses below. It only tells (axiom A1): the open prompt's
					     answers are the dock's, at every tile size, so no chip and no
					     `onAct` reaches the Table. -->
						<Thread lines={thread.lines} density="card" chips={false} {busy} {referencesEnabled} />
				{:else}
					{@render exploreContextHeader()}
					<div class="tile-card-paper" data-play-frame="paper">
						<p class="tile-card-line">{tableSummaryText}</p>
					</div>
				{/if}
			{:else if levelOf("table") === "stage"}
				<!-- Combat and conversation can coexist. A reaction prompt is the
				     dock's (axiom A7), so the scene below is never dimmed. -->
				<div class="table-scene">
					{#if combat}
						<Combat
							combat={combatForWidget!}
							targets={combatTargets}
							selectedTargetRef={combatSelectedTargetRef}
							onSelectTarget={selectTurnOrderTarget}
							onEndTurn={() => void onEndTurn()}
							selectionMode
							{busy}
							density="stage"
							chrome="bare"
						/>
					{/if}
					{#if dialogue !== null}
						<!-- The participant head (sk-jay0.1.8.12): a Talk-only header
						     ABOVE the shared stream (sk-jay0.1.8.63.1 Part B) — tap sets
						     who the composer addresses, a second tap filters the
						     stream's own speech entries. The dock — the present decision
						     point, per the Table design note's "one dock language for
						     Explore and Talk" — holds the open prompt's answers, any
						     line-bound offer, and everything else. -->
						<TalkParticipants
							participants={talkParticipants}
							portrait={participantPortrait}
							targetName={selectedActorId === null
								? null
								: (talkParticipants.find((participant) => participant.id === selectedActorId)?.name ?? null)}
							onSetTarget={tapParticipant}
							filterId={activeViewFilterId}
							onToggleFilter={setViewFilter}
						/>
					{/if}
					<!-- The ONE stream every scene shares at stage (sk-jay0.1.8.63.1
					     Part B): Explore, Talk and Fight all render the same
					     `ActivityFeed` instance shape here — entering/leaving a
					     conversation never swaps the list renderer or loses scroll
					     position/history. No fixed context header (sk-jay0.1.8.63.5):
					     the current place already shows as the stream's own newest
					     section-header row, so a second, non-scrolling "where
					     am I" line above it would only repeat that place twice — the
					     card level (`tile-card-paper`, above) still shows one, since
					     it has no stream of its own. -->
					{@render streamFilters()}
					<div class="table-explore-shell">
						<div
							class="table-explore-stream sk-stream-scroll"
							bind:this={exploreStreamEl}
						>
							{#if exploreStream.length > 0}
								<section class="play-explore-activity" bind:this={exploreStreamContentEl}>
									<!-- The "Recent activity" label named this section for a
									     sighted reader before the place headers made a
									     place row read as a heading in its own right; the list's
									     own `aria-label` below already names it for a screen
									     reader, so the heading is visually hidden rather than
									     removed. -->
									<h3 class="sr-only">Recent activity</h3>
									<ActivityFeed
										readable
										items={visibleExploreStream}
										ariaLabel="What has been said"
										emptyText={streamFilter === null ? "Nothing has happened here yet." : "No visible events match this filter."}
										renderItem={exploreStreamLine}
										isSectionHeader={(entry) => entry.kind === "place"}
									/>
								</section>
							{/if}
							{@render activeActivityStatus()}
						</div>
					</div>
				</div>
			{/if}
		</div>
		{#if (levelOf("table") === "stage" || (levelOf("table") === "card" && combat !== null)) && followExplore.unread > 0}
			<!-- One catch-up pill for the stream in every scene (sk-jay0.1.8.63.1
			     Part B): the Explore catch-up pill is now THE pill, in its own row
			     outside the scroll body so it can never cover the dock below. Now
			     also the card-level fight stream (sk-jay0.1.8.63.2 task 7): this
			     block is a sibling AFTER `.tile-body` closes, so it renders below
			     the card's own selection row rather than over it — the same
			     "own row, never fixed" shape the stage pill already had. -->
			<div class="shrink-0 border-t border-[var(--border)] px-3 py-2 text-center" data-slot="explore-catch-up">
				<Button type="button" variant="woven-secondary" size="sm" onclick={() => followExplore.jumpToLatest()}>
					{followExplore.unread} new {followExplore.unread === 1 ? "line" : "lines"} ↓
				</Button>
			</div>
		{/if}
	</section>
{/snippet}

{#snippet mapTile()}
	<section class="tile" data-tile="map" data-zoom={levelOf("map")} aria-label={TILE_TITLES.map}>
		{@render head("map")}
		<div class="tile-body">
			<!-- Card level, and a fight at any level, stay the world's own
			     `spellkave_map` plate — ADR-0052's tactical grid during combat.
			     Exploring at stage swaps to the maps canvas instead (MapTile,
			     mounted always so its lazy-loaded module survives a card/stage
			     toggle — it renders nothing while `open` is false). -->
			{#if !mapOpen}
				{#if hasTacticalSession(view) && svg !== undefined && hasGridCells(svg)}
					<!-- The session grid, played on the world's own plate (S2,
					     sk-jay0.1.8.38, design doc §5.1): `PlaceMap`'s passive
					     drawing gives way to the interactive `BattleMap` widget
					     the moment the fetched plate carries composed grid
					     cells. Falls back to `PlaceMap` for a tactical session
					     without a grid (sessionless brawls, ADR-0052). -->
					<BattleMap
						plate={svg}
						ownNodeId={view.place?.id ?? null}
						exits={battleMapReachableExits}
						onStep={(handle) => move(handle, "map")}
						refusal={mapRefusal}
						selectedNodeId={selectionCellId}
						onSelectCell={selectBattleMapCell}
						tokens={battleMapTokens}
						viewKey={`fight:${view.session?.id ?? "grid"}`}
					/>
				{:else}
					<!-- The passive plate never moves: a neighbouring place that is
					     the destination of an offered exit is a button, and a click
					     highlights it and writes its go sentence into the composer
					     (`fillGo`). Enter there dispatches through `move()`, so the
					     travel line still lands in the stream. -->
					<PlaceMap
						frame={mapFrame}
						density={levelOf("map")}
						chrome="bare"
						exits={placeMapExits}
						onTravel={travelFromMap}
						disabled={busy}
					/>
				{/if}
			{/if}
			<MapTile
				open={mapOpen}
				mode={mapMode}
				{gatewayOrigin}
				{slug}
				{token}
				placeNodeId={view.place?.id}
				onPlaceClick={(place) => {
					selectedMapNode = place.nodeId;
					if (place.nodeId !== null) selectMapPlace(place.nodeId);
				}}
				controls={mapControls}
				{mapHref}
				overlay={mapWatch?.overlay === true}
				minePlaces={mapWatch?.places ?? []}
				mineEntityIds={mapWatch?.mineEntityIds ?? []}
				occupancyPlaces={mapWatch?.occupancy ?? []}
				watch={mapWatch}
			/>
			<!-- MapTile carries its own "Open the full map" link, on the same
			     row as its whole-world note, once it is open. A fight at stage
			     never opens it (the tactical grid stays instead), so this is
			     that case's own fallback. -->
			{#if mapHref !== null && levelOf("map") === "stage" && !mapOpen}
				<p class="play-map-link">
					<a href={mapHref}>Open the full map →</a>
				</p>
			{/if}
			{#if levelOf("map") === "stage" && !mapOpen}{@render mapControls()}{/if}
		</div>
	</section>
{/snippet}

{#snippet occupantArtwork(id: string)}
	{@const occupant = view.occupants.find((entry) => entry.id === id)}
	{#if occupant}
		<WorldArt art={occupant.art} {gatewayOrigin} {slug} {token} label={occupant.name} surface="place" ordinal={view.occupants.indexOf(occupant) + 1} />
	{/if}
{/snippet}

{#snippet placeProse(text: string)}<DefLinkText {text} />{/snippet}
{#snippet placeReference(id: string)}
	<PlaceReference definitionRef={occupantsById.get(id)?.defId ?? (view.occupantDetail?.id === id ? view.occupantDetail.defId : undefined)} shownDescription={view.occupantDetail?.id === id ? view.occupantDetail.description : undefined} />
{/snippet}

{#snippet placeTile()}
	<section class="tile" data-tile="place" data-zoom={levelOf("place")} aria-label={TILE_TITLES.place}>
		{@render head("place")}
		<div class="tile-body">
			{@render actionFeedback("place")}
			{#if levelOf("place") !== "strip"}
				<PlacePanel
					selectionOnly
					showDetailActions={!legacyActionFallback}
					place={scenePlace}
					placeState={view.placeState ?? (scenePlace ? "ready" : "missing")}
					{occupants}
					selectedId={selectedOccupant}
					onSelect={selectPlaceOccupant}
					infoRefFor={(occupant) => `occupant:${occupant.id}`}
					detail={placeOccupantDetail}
					artwork={occupantArtwork}
					selectedExitId={selection?.kind === "exit" ? selection.handle : null}
					onSelectExit={(handle) => {
						requestOccupant(null);
						const marked = selection?.kind === "exit" && selection.handle === handle;
						if (marked && keptExitFill === handle && !legacyActionFallback) { insertMove(handle); return; }
						keptExitFill = null;
						setSelection(marked ? null : { kind: "exit", handle }, false);
					}}
					onAct={insertDetailAction}
					onInsertMove={legacyActionFallback ? undefined : levelOf("place") === "card" ? chooseExit : insertMove}
					renderProse={placeProse}
					reference={placeReference}
					{busy}
					density={levelOf("place")}
					chrome="bare"
					isSecondaryVerb={isOccupantSecondaryVerb}
					secondaryVerbsLabel="Checks"
				/>
			{/if}
		</div>
	</section>
{/snippet}

{#snippet heroTile()}
	<section class="tile" data-tile="hero" data-zoom={levelOf("hero")} aria-label={TILE_TITLES.hero} bind:this={heroRoot}>
		{@render head("hero")}
		<div class="tile-body">
			<Hero self={hero} density={levelOf("hero")} chrome="bare" infoCards />
		</div>
	</section>
{/snippet}

{#snippet participantPortrait(participant: ThreadParticipant)}
	<WorldArt art={view.occupants.find((occupant) => occupant.id === participant.id)?.art} {gatewayOrigin} {slug} {token} label={participant.name} compact surface="table" ordinal={view.occupants.findIndex((occupant) => occupant.id === participant.id) + 1} />
{/snippet}

{#snippet itemReference(id: string)}<PlaceReference definitionRef={view.itemDetail?.id === id ? view.itemDetail.definitionRef : undefined} shownDescription={view.itemDetail?.id === id ? view.itemDetail.description : undefined} />{/snippet}

{#snippet itemArtwork(id: string)}
	{#if packDetail?.id === id}
		<WorldArt art={packDetail.art} {gatewayOrigin} {slug} {token} label={pack.find((item) => item.id === id)?.name ?? "Item"} surface="pack" ordinal={pack.findIndex((item) => item.id === id) + 1} />
	{/if}
{/snippet}

{#snippet packTile()}
	<section class="tile" data-tile="pack" data-zoom={levelOf("pack")} aria-label={TILE_TITLES.pack} bind:this={packRoot}>
		{@render head("pack")}
		<div class="tile-body">
			{@render actionFeedback("pack")}
			<Pack
				selectionOnly
				items={pack}
				artwork={itemArtwork}
				renderProse={placeProse}
				reference={itemReference}
				selectedId={selectedItemId}
				onSelect={selectItem}
				detail={packDetail}
				density={levelOf("pack")}
				chrome="bare"
			/>
		</div>
	</section>
{/snippet}

{#snippet actionFeedback(surface: ActionSurface)}
	<!-- Place/map/pack keep their own inline caption: unlike the dock (now
	     `DockNotice`), each is the one surface still visible when that tile,
	     not the Table, is what the player is looking at (e.g. the Place tile
	     zoomed to stage while Table sits elsewhere) — the Explore stream
	     only renders while the Table itself is at stage. An arrival's prose
	     IS the place description the tile already shows below it; saying it
	     twice in a row read as a glitch in play. -->
	{@const text =
		localFeedback?.surface === surface
			? localFeedback.pending
				? "Working…"
				: surface === "place" && localFeedback.text === (scenePlace?.description ?? null)
					? null
					: localFeedback.text
			: null}
	{#if levelOf(surface) !== "strip" && text !== null}
		<p class="play-action-status" data-action-feedback={surface}>{text}</p>
	{/if}
{/snippet}

{#snippet mapControls()}
	{@render actionFeedback("map")}
	<!-- The map tile carries no travel control: a MapLibre place click sets
	     `selection` and, for the destination of exactly one current way out,
	     writes its go sentence into the composer (`selectMapPlace`). The
	     "Offered here" palette this tile also carried is gone too
	     (sk-jay0.1.8.63.43, axiom A1): what a place offers is the dock's HERE
	     group, and a second copy of it under the map was a second act
	     surface. -->
{/snippet}

{#snippet rowSplitter(id: TileId)}
	{@const lower = belowSibling(id, isMobile)}
	{@const column = columnIndexOf(id)}
	{@const cornerSide = column === 0 ? "right" : column === DESKTOP_COLUMNS.length - 1 ? "left" : null}
	{@const rowCanResize = canResizeRowBoundary(layout, id, isMobile)}
	{#if lower !== null}
		<!-- The visible rule sits in the true grid gap; its larger transparent
		     surface becomes a resize target only when the pair has flexible room. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class:mosaic-splitter--inactive={!rowCanResize}
			class="mosaic-splitter mosaic-splitter--row"
			role="separator"
			aria-orientation="horizontal"
			aria-label={rowCanResize
				? `Resize ${TILE_TITLES[id]} and ${TILE_TITLES[lower]}`
				: `Divider between ${TILE_TITLES[id]} and ${TILE_TITLES[lower]}`}
			onpointerdown={(event) => {
				if (rowCanResize) startSplitterDrag(event, id, "row", "bottom");
			}}
			ondblclick={(event) => {
				if (rowCanResize) resetFromSplitter(event);
			}}
		></div>
		{#if rowCanResize && !isMobile && cornerSide !== null}
			<!-- A true grid intersection changes both adjacent panes together. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class:mosaic-splitter--corner-left={cornerSide === "left"}
				class="mosaic-splitter mosaic-splitter--corner"
				role="separator"
				aria-label={`Resize ${TILE_TITLES[id]} corner`}
				onpointerdown={(event) => startSplitterDrag(event, id, "corner", "bottom", cornerSide)}
				ondblclick={resetFromSplitter}
			></div>
		{/if}
	{/if}
{/snippet}

{#snippet tileFor(id: TileId)}
	<div class="mosaic-tile">
		{#if id === "table"}
			{@render tableTile()}
		{:else if id === "map"}
			{@render mapTile()}
		{:else if id === "place"}
			{@render placeTile()}
		{:else if id === "hero"}
			{@render heroTile()}
		{:else if id === "pack"}
			{@render packTile()}
		{/if}
		{@render rowSplitter(id)}
	</div>
{/snippet}

<!-- One `InfoCardProvider` for the whole Play surface (sk-jay0.1.8.63.10): mounted
     here, at this component's own root, it covers every `InfoLink` in both
     the Table stream (inside the mosaic below) and `PlayDock` — the two
     surfaces this bead scopes information cards to. `resolveCard` is the
     one `InfoCardResolve` every one of them shares. -->
<InfoCardProvider resolve={resolveCard}>
{#if isMobile}
	<!-- Pointer/touch resize is a supplementary gesture over the edge/corner
	     bands; every tile it resizes is also reachable via the keyboard
	     head/zoom button below, so the mosaic itself carries no new role. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="mosaic mosaic--mobile"
		class:dragging
		style={`grid-template-rows: ${mobileRows};`}
		ontouchstart={onMosaicTouchStart}
	>
		{#each MOBILE_ORDER as id (id)}
			{@render tileFor(id)}
		{/each}
	</div>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="mosaic mosaic--desktop"
		class:dragging
		style={`grid-template-columns: ${columnTemplate};`}
		ontouchstart={onMosaicTouchStart}
	>
		{#each DESKTOP_COLUMNS as ids, i (i)}
			{@const columnTile = ids[0] ?? "table"}
			{@const nextColumnTile = DESKTOP_COLUMNS[i + 1]?.[0] ?? "table"}
			<div
				class="mosaic-col"
				data-narrow={columnNarrow[i] || undefined}
				data-row-active={columnHasActiveRows[i] || undefined}
				style={`grid-template-rows: ${rowTemplates[i]};`}
			>
				{#each ids as id (id)}
					{@render tileFor(id)}
				{/each}
				{#if i < DESKTOP_COLUMNS.length - 1}
					<!-- One column splitter spans the actual gap, rather than each
					     tile edge pretending to own a vertical resize affordance. -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="mosaic-splitter mosaic-splitter--column"
						role="separator"
						aria-orientation="vertical"
						aria-label={`Resize ${TILE_TITLES[columnTile]} and ${TILE_TITLES[nextColumnTile]} columns`}
						onpointerdown={(event) => startSplitterDrag(event, columnTile, "col", undefined, "right")}
						ondblclick={resetFromSplitter}
					></div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<!-- The one bottom orientation + action surface, no matter which tile is
     on stage — the Table tile itself renders only the stream/thread now. -->
<PlayDock
	{statusMessage}
	bind:this={dock}
	heroHp={view.hero.hp}
	heroAc={view.hero.ac}
	heroDrafting={view.hero.drafting === true}
	heroConditions={dockHeroConditions}
	placeId={scenePlace?.id ?? null}
	placeName={scenePlace?.name ?? null}
	exits={dockPlaceExits}
	onChooseExit={chooseExit}
	hotbar={hotbar}
	pips={resourcePips}
	slotKeys={slotKeyLabels}
	activeSlotId={composerSlotValue?.id ?? null}
	onSlot={pressSlot}
	showEndTurn={hasTacticalSession(view) && view.session.myTurn}
	onEndTurn={() => void onEndTurn()}
		composerLabel={composerLabel}
		composerInput={composerInput}
	composerPlaceholder={composerPlaceholder}
	composerDisabled={composerSlotValue === null}
	onSay={submitSay}
		factComposer={{
		draft: factComposerDraft,
		actions: factComposerActions,
		targets: factComposerTargets,
		prompts: factComposerPrompts,
		senseActions: view.actions.filter((action) => action.verb === "sensing"),
		exits: view.place?.exits ?? [],
		canEndTurn: hasTacticalSession(view) && view.session.myTurn,
		selectedPromptId: selectedComposerPrompt?.occurrenceId ?? null,
		insertion: detailInsertion,
		prefillTargetRef: factComposerPrefillTargetRef,
		clearToken: factComposerClearToken,
			revision: manipulationContext.status === "ready" ? manipulationContext.revision : 0,
			keymap,
			factsUnavailable: manipulationContext.status === "unavailable",
			suspended: view.reaction !== null,
			downed,
		onExecutableChange: (executable) =>
			(factComposerDraft = { ...factComposerDraft, ...executable, semanticContext: executable.semanticContext }),
		onAttemptSense: (actionId) => {
			const action = byId.get(actionId);
			if (action?.verb === "sensing") void act(actionId, undefined, "table");
		},
		onAttemptMove: (exitHandle) => move(exitHandle),
		onInsertionKept: (exitHandle) => { keptExitFill = exitHandle; },
		onAttemptEndTurn: () => {
			if (hasTacticalSession(view) && view.session.myTurn && !busy) void onEndTurn();
		},
			onChangeDetails: (details) => (factComposerDraft = { ...factComposerDraft, ...details }),
			onAttempt: attemptFactComposer,
			outcome:
				localFeedback?.surface === "table" && !localFeedback.pending && localFeedback.text !== null
					? {
							text: localFeedback.text,
							// A rejected receipt is a world decision. A failed client
							// observation is deliberately separate: Play keeps the draft
							// but must not claim the world refused it.
							// An attempt Play stopped before sending was never
							// in doubt: "not sent", not "result unknown".
							kind:
								statusKind === "rejected"
									? "rejected"
									: statusKind === "blocked"
										? "blocked"
										: statusKind === "failed"
											? "unobserved"
											: "accepted",
						}
				: null,
		}}
	legacyActionFallback={legacyActionFallback}
	replySuggestionName={replySuggestion?.name ?? null}
	onAcceptReply={acceptReply}
	onClearSelection={() => setSelection(null)}
	notice={dockNotice}
	urgent={dockUrgent}
	{busy}
	{busyActionId}
	{seal}
	extras={dockExtras}
/>
</InfoCardProvider>
