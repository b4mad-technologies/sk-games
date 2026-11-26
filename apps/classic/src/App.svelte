<script lang="ts">
	import config from "virtual:classic-dev-local";
	import { utteranceFromInputValues } from "@spellkave/sdk";
	// The gap test: the classic world view on a real, locally staged world.
	//
	// It uses apps/play's own session library unchanged (`openPlaySession`,
	// `PlayView`), imported straight from the app directory. That import is the
	// spike's point: the product app needs this library extracted into a
	// package. Everything drawn here is something the PLAYER tools answered.
	// Where the world gives no position, the token gets a stable invented one.
	import { Button } from "@spellkave/ui";
	import { initTheme, ThemeSwitcher } from "@spellkave/ui/theme";
	import { BattleMap, hasGridCells, PlaceMap, sanitiseSvg } from "@spellkave/ui-widgets";
	import { untrack } from "svelte";
	import { openPlaySession, type PlaySessionHandle } from "../../play/src/lib/play-session";
	import { actionTakesInput, type PlayAction, type PlayExit, type PlayOccupant, type PlayView } from "../../play/src/lib/play-view";
	import CreationWizard from "./creation/CreationWizard.svelte";
	import { saveJournal } from "./creation/creation";
	import ClickMenu, { type MenuEntry, type MenuFold } from "./lib/ClickMenu.svelte";
	import { actionsOnFighter, cellClick, fightTokens, gridTokens, movementLeft, observedStepCost, turnBudget } from "./lib/fight";
	import { boundActions, inFight, menuFor, nicheFit, onePerAction } from "./lib/menu";
	import { exitsOnWalls, spreadOnStage } from "./lib/placement";
	import Sheet from "./lib/Sheet.svelte";
	import { srdArtUrl } from "./lib/srd-art";
	import { type ClickResult, inTickOrder, type StoryLine, withResults } from "./lib/story";
	import TalkPanel from "./lib/TalkPanel.svelte";
	import { canAddress, openQuestions, speechAction, spokenLines, talkPartners, withoutFreeSpeech } from "./lib/talk";
	import { exitTo, gateHint, graphFromJson, graphToJson, mapTargets, mergeGraphs, type PlateGraph, plateGraph, routeTo } from "./lib/travel";
	import { answered, heardMark, thinkingLine, WAITING_TIMEOUT_MS, type Waiting } from "./lib/waiting";
	import { gatewayFetch, gatewayOrigin, worldArtStore } from "./lib/world-art";

	initTheme();

	const srdArt = import.meta.glob<string>("../../../packages/spellkave-srd-cc/assets/srd-art/{creature,item}/*.webp", {
		query: "?url",
		import: "default",
	});

	let view = $state.raw<PlayView | null>(null);
	let handle = $state.raw<PlaySessionHandle | null>(null);
	let status = $state(config ? "Connecting…" : "No staged world found.");
	let results = $state<ClickResult[]>([]);
	let menu = $state<{ occupant: PlayOccupant; x: number; y: number } | null>(null);
	let busy = $state(false);
	// Who the hero's words go to; null means everyone here.
	let partnerId = $state<string | null>(null);
	let talkPanel = $state<{ focus: () => void }>();
	let sheetOpen = $state(false);
	// The map and the developer's fact list lie over the scene when asked for.
	let mapOpen = $state(false);
	let factsOpen = $state(false);
	// What a click on the thing under the pointer would do.
	let hover = $state("");
	// Which of the foot line's doors is open over the scene.
	let drawer = $state<"acts" | "talk" | "pack" | null>(null);
	function toggle(which: "acts" | "talk" | "pack") {
		drawer = drawer === which ? null : which;
	}
	// The newest result id when the sheet opened; the sheet shows later ones.
	let sheetMark = $state(0);
	let artUrls = $state<Record<string, string>>({});
	let nextId = 1;

	$effect(() => {
		if (!config) return;
		let closed = false;
		let opened: PlaySessionHandle | null = null;
		openPlaySession({
			url: config.url,
			db: config.db,
			token: config.token,
			actorId: config.actorId,
			authorizedToolRoles: ["PLAYER"],
			// The area map is a way to travel here, so it shows every floor.
			mapSlice: "all_floors_offset",
			onView: (next) => {
				view = next;
				status = "Connected";
			},
			onError: (error) => {
				status = `Error: ${error.message}`;
			},
		}).then(
			(session) => {
				if (closed) return session.disconnect();
				opened = session;
				handle = session;
			},
			(error: unknown) => {
				status = `Could not open the world: ${error instanceof Error ? error.message : String(error)}`;
			},
		);
		return () => {
			closed = true;
			opened?.disconnect();
		};
	});

	// DEV aid: the current view, for poking at it from the browser console.
	$effect(() => {
		if (import.meta.env.DEV) (window as unknown as { __classicView?: PlayView | null }).__classicView = view;
	});

	$effect(() => {
		if (import.meta.env.DEV) (window as unknown as { __classicHandle?: PlaySessionHandle | null }).__classicHandle = handle;
	});

	// A finished hero needs no creation journal any more. Without this, the
	// next candidate with the same id (a wiped local world) would inherit it.
	$effect(() => {
		if (!view || view.hero.drafting) return;
		try {
			saveJournal(window.sessionStorage, view.hero.actorId, []);
		} catch {
			// Storage is blocked; there is nothing to clear.
		}
	});

	// What the world said and did, oldest first.
	const worldLines = $derived<StoryLine[]>(
		inTickOrder([
			...(view ? spokenLines(view) : []),
			...(view?.events ?? []).map((line) => ({ key: `e${line.id}`, tick: line.tick, who: "", text: line.summary, mine: false })),
		]),
	);

	/** The last world line on screen: where a click's result belongs. */
	const here = () => worldLines[worldLines.length - 1]?.key ?? null;

	/** Note what a click came to. `after` is `here()` as it was at the click. */
	function note(text: string, after: string | null) {
		results = [...results.slice(-30), { id: nextId++, after, text }];
	}

	// --- Where things stand ------------------------------------------------

	// In a fight on a session grid the scene lists nobody; the other fighters
	// come from the turn roster and stand on the stage like anyone else.
	const foes = $derived(view ? fightTokens(view) : []);
	const placed = $derived(spreadOnStage<PlayOccupant>([...(view?.occupants ?? []), ...foes]));
	const exits = $derived(exitsOnWalls(view?.place?.exits ?? []));
	// What a step was last seen to cost, and the measurement in flight: the
	// hero's cell and movement at the click. The new numbers arrive with a
	// later view, so the cost is read when the hero stands somewhere else.
	let stepCost = $state<number | null>(null);
	let stepProbe: { from: string; left: number | null } | null = null;
	$effect(() => {
		if (!view || !stepProbe) return;
		if (!inFight(view.session)) {
			stepProbe = null;
			return;
		}
		if (view.place?.id === stepProbe.from) return;
		const cost = observedStepCost(stepProbe.left, movementLeft(view));
		if (cost !== null) {
			stepCost = cost;
			stepProbe = null;
		}
	});
	const budget = $derived(view ? turnBudget(view, stepCost) : []);

	function artKey(occupant: PlayOccupant): string | null {
		const match = /^srd\/(creature|item)\/(.+)$/.exec(occupant.defId ?? "");
		return match ? `../../../packages/spellkave-srd-cc/assets/srd-art/${match[1]}/${match[2]}.webp` : null;
	}

	$effect(() => {
		for (const occupant of view?.occupants ?? []) {
			const key = artKey(occupant);
			if (key && srdArt[key] && !(key in artUrls)) {
				void srdArt[key]().then((url) => {
					artUrls = { ...artUrls, [key]: url };
				});
			}
		}
	});

	// --- The world's own pictures -------------------------------------------

	// Authored art (ADR-0073) of the people and things here, and of the place,
	// by content hash. It needs the world's gateway; without one, or for a
	// picture the gateway does not give, SRD art or a glyph stands in.
	const gateway = gatewayOrigin(import.meta.env.VITE_SPELLKAVE_GATEWAY_URL);
	let worldArt = $state<Record<string, string>>({});
	$effect(() => {
		if (!config || !gateway) return;
		const store = worldArtStore(gatewayFetch(gateway, config.slug, config.token));
		artStore = store;
		return () => {
			artStore = null;
			store.close();
			worldArt = {};
		};
	});
	let artStore = $state.raw<ReturnType<typeof worldArtStore> | null>(null);
	$effect(() => {
		const store = artStore;
		if (!store) return;
		const wanted = [...(view?.occupants ?? []).map((occupant) => occupant.art), view?.place?.art];
		for (const art of wanted) {
			if (!art || art.hash in untrack(() => worldArt)) continue;
			void store.load(art).then((url) => {
				if (url && artStore === store) worldArt = { ...worldArt, [art.hash]: url };
			});
		}
	});
	const backdrop = $derived(view?.place?.art ? worldArt[view.place.art.hash] : undefined);

	// --- Acting --------------------------------------------------------------

	function open(occupant: PlayOccupant, event: MouseEvent) {
		menu = { occupant, x: event.clientX, y: event.clientY };
		// A roster token has no scene handle, so there is no detail to read.
		if (occupant.handle !== "") void handle?.selectOccupant?.({ id: occupant.id, handle: occupant.handle, rev: occupant.rev, name: occupant.name });
	}

	const menuActions = $derived.by<PlayAction[]>(() => {
		if (!menu || !view) return [];
		if (menu.occupant.handle === "") return actionsOnFighter(view, menu.occupant.id);
		const detail = view.occupantDetail;
		if (detail && detail.id === menu.occupant.id) return detail.verbs;
		return view.actions.filter((action) => action.targetRef === `entity:${menu!.occupant.id}`);
	});
	const fits = $derived(view ? nicheFit(view.manipulationContext) : undefined);
	const bound = $derived(view ? boundActions(view.manipulationContext) : undefined);
	const fighting = $derived(inFight(view?.session));
	// The hero walks the world: made, and with a world to show.
	const inWorld = $derived(view !== undefined && view !== null && !view.hero.drafting);
	const sorted = $derived(menuFor(withoutFreeSpeech(menuActions), { inFight: fighting, fits, bound }));
	const entryOf = (action: PlayAction): MenuEntry => ({ id: action.id, label: action.name ?? action.label });
	// Free speech has its own field. On someone who can be addressed, the menu
	// offers one "Talk" entry that picks them as the partner.
	const TALK = "classic:talk";
	const talkEntry = $derived<MenuEntry[]>(menu && view && canAddress(view, menu.occupant.id) ? [{ id: TALK, label: "Talk" }] : []);
	// Talking leads, except in a fight, where the click is for the attack.
	const menuEntries = $derived<MenuEntry[]>(
		fighting ? [...sorted.primary.map(entryOf), ...talkEntry] : [...talkEntry, ...sorted.primary.map(entryOf)],
	);
	const menuFolds = $derived<MenuFold[]>(sorted.groups.map((group) => ({ id: group.id, label: group.label, entries: group.actions.map(entryOf) })));

	/** How many lines the hero has spoken so far, as the world reports them. */
	const spoken = () => (view ? spokenLines(view) : []).filter((line) => line.mine).length;

	async function attempt(action: PlayAction, label = action.label) {
		if (!handle || busy) return;
		let words: string | undefined;
		if (actionTakesInput(action)) {
			words = window.prompt(`${action.label}: what do you say or enter?`) ?? undefined;
			if (words === undefined) return;
		}
		busy = true;
		const before = spoken();
		const at = here();
		try {
			const message = await handle.act(action, words);
			// A spoken answer comes back from the world as the hero's own line;
			// saying it a second time as a result would only be noise.
			if (spoken() === before) note(`${label} → ${message || "(the world answered without words)"}`, at);
		} catch (error) {
			note(`${label} → failed: ${error instanceof Error ? error.message : String(error)}`, at);
		} finally {
			busy = false;
		}
	}

	// --- Waiting for an answer ---------------------------------------------

	// Set when the hero spoke or answered; cleared when someone else speaks, a
	// question opens, or nobody answers for a while. A hint, not a lock.
	let waiting = $state<Waiting | null>(null);

	function expectAnswer(who: string) {
		if (view) waiting = { who, mark: heardMark(view) };
	}

	$effect(() => {
		if (waiting && view && answered(waiting, view)) waiting = null;
	});

	$effect(() => {
		if (!waiting) return;
		const timer = setTimeout(() => (waiting = null), WAITING_TIMEOUT_MS);
		return () => clearTimeout(timer);
	});

	const thinking = $derived(view ? thinkingLine(view, waiting) : undefined);

	/** Send one attempt for the wizard. Rejects when the attempt could not be sent. */
	async function send(action: PlayAction, values?: Record<string, string | number>): Promise<string> {
		if (!handle) throw new Error("The world is not connected.");
		busy = true;
		try {
			// Fields on the `utterance` channel travel as spoken words.
			const words = values && action.input ? utteranceFromInputValues(action.input.fields, values) : undefined;
			return await handle.act(action, words, 0, values);
		} finally {
			busy = false;
		}
	}

	// The ruleset's own condition id; the app may couple to the SRD.
	const down = $derived(view?.hero.conditions.some((condition) => condition === "srd/condition/unconscious" || condition.endsWith("/dead")) === true);

	async function endTurn() {
		if (!handle || busy) return;
		busy = true;
		const at = here();
		try {
			// The session's own reply names the next fighter by id; the turn
			// line above the stage says who acts, by name.
			await handle.endTurn();
			note("You end your turn.", at);
		} catch (error) {
			note(`End turn → failed: ${error instanceof Error ? error.message : String(error)}`, at);
		} finally {
			busy = false;
		}
	}

	async function go(exit: PlayExit) {
		if (!handle || busy) return;
		busy = true;
		const at = here();
		// On the fight grid a way out is a step onto a neighbour cell.
		const what = fighting ? `Step ${exit.label}` : `Go ${exit.label} to ${exit.toName}`;
		const from = view?.place?.id;
		if (fighting && view?.place) stepProbe = { from: view.place.id, left: movementLeft(view) };
		stepRefusal = null;
		try {
			const message = (await handle.move(exit)) || "(moved)";
			note(`${what} → ${message}`, at);
			// A step that left the hero where they stood was refused; the grid
			// shows the world's sentence under the plate.
			if (fighting && view?.place?.id === from) stepRefusal = message;
		} catch (error) {
			note(`${what} → failed: ${error instanceof Error ? error.message : String(error)}`, at);
		} finally {
			busy = false;
		}
	}

	// --- Travel by the area map ---------------------------------------------

	// The goal of a walk over several places, while it runs.
	let journey = $state<{ name: string; stop: boolean } | null>(null);
	// A walk between two places took 20 to 30 s on a local world (2026-11-14).
	const ARRIVE_TIMEOUT_MS = 90_000;

	/** Resolves true once the hero stands in that place; false after the wait. */
	function arrived(nodeId: string): Promise<boolean> {
		return new Promise((resolve) => {
			const started = Date.now();
			const check = () => {
				if (view?.place?.id === nodeId) resolve(true);
				else if (Date.now() - started > ARRIVE_TIMEOUT_MS) resolve(false);
				else setTimeout(check, 250);
			};
			check();
		});
	}

	/**
	 * Walk to a place on the map, one offered way out at a time. The route is
	 * read again from the picture at every place, and the walk ends at the
	 * first step the world does not offer or refuses.
	 */
	async function travelTo(goal: string) {
		if (!handle || busy || !view?.place) return;
		const name = known.names.get(goal) ?? goal;
		busy = true;
		journey = { name, stop: false };
		try {
			for (let steps = 0; steps < 24; steps += 1) {
				const place = view?.place;
				if (!place || place.id === goal) break;
				const at = here();
				if (journey.stop) {
					note(`You stop in ${place.name}, on the way to ${name}.`, at);
					break;
				}
				const next = routeTo(known, place.id, goal)[0];
				const exit = next === undefined ? undefined : exitTo(place, next);
				if (!exit) {
					note(`From ${place.name} the world offers no way on towards ${name}.`, at);
					break;
				}
				const message = await handle.move(exit);
				note(`Go ${exit.label} to ${exit.toName} → ${message || "(moved)"}`, at);
				if (!(await arrived(next as string))) {
					note(`You are still in ${view?.place?.name ?? "the same place"}; the walk to ${name} ends here.`, here());
					break;
				}
			}
		} catch (error) {
			note(`The walk to ${name} failed: ${error instanceof Error ? error.message : String(error)}`, here());
		} finally {
			journey = null;
			busy = false;
		}
	}

	// Open questions with their bound answers; an answer slot nobody asked for is not shown.
	const questions = $derived(view ? openQuestions(view) : []);
	const partners = $derived(talkPartners(view?.occupants ?? []));
	const words = $derived(view ? speechAction(view, partnerId) : undefined);

	async function say(text: string) {
		if (!handle || busy || !words) return;
		busy = true;
		const before = spoken();
		const at = here();
		try {
			// The hero's own line comes back from the world as speech; only a
			// refusal needs a line of its own.
			const mark = heardMark(view!);
			const who = partners.find((entry) => entry.id === partnerId)?.name ?? "";
			const message = await handle.act(words, text);
			if (spoken() === before && message) note(message, at);
			// The answer may already be there; then the mark has moved on.
			else if (view) waiting = { who, mark };
		} catch (error) {
			note(`You could not speak: ${error instanceof Error ? error.message : String(error)}`, at);
		} finally {
			busy = false;
		}
	}

	const hereAndMe = $derived(
		menuFor(
			onePerAction(
				withoutFreeSpeech(view?.actions ?? []).filter(
					(action) => !/^(entity|item):/.test(action.targetRef) || action.targetRef === `entity:${view?.hero.actorId}`,
				),
				fits,
			),
			{ inFight: fighting, fits, bound },
		),
	);
	const prompts = $derived(view?.manipulationContext.status === "ready" ? (view.manipulationContext.prompts ?? []).filter((prompt) => !prompt.consumed) : []);
	const story = $derived(withResults(worldLines, results).slice(-60));
	const lastLine = $derived.by(() => {
		const line = story.at(-1);
		return line ? (line.who ? `${line.who}: ${line.text}` : line.text) : "";
	});
	// Somebody asks: the talk opens by itself.
	$effect(() => {
		if (questions.length > 0) drawer = "talk";
	});
	const plate = $derived(view?.mapSvg ? sanitiseSvg(view.mapSvg) : undefined);
	const graph = $derived(plateGraph(plate));
	// Every place a plate has shown this hero, kept for this browser tab: the
	// plate draws only what the hero perceives now.
	const memoryKey = $derived(config ? `classic.places.${config.slug}.${config.actorId}` : null);
	let known = $state.raw<PlateGraph>(plateGraph(undefined));
	$effect(() => {
		if (!memoryKey) return;
		try {
			known = graphFromJson(window.sessionStorage.getItem(memoryKey));
		} catch {
			// Storage is blocked; the memory lasts as long as the page.
		}
	});
	$effect(() => {
		if (graph.names.size === 0 || fighting) return;
		// `known` is written here, so it must not be read as a dependency.
		const next = mergeGraphs(
			untrack(() => known),
			graph,
		);
		known = next;
		try {
			if (memoryKey) window.sessionStorage.setItem(memoryKey, graphToJson(next));
		} catch {
			// Storage is blocked.
		}
	});
	// In a fight the hero's place is a grid cell; the area map is no way out of it.
	const targets = $derived(fighting ? [] : mapTargets(known, view?.place?.id));
	const mapExits = $derived(targets.filter((target) => graph.names.has(target.nodeId)).map((target) => ({ handle: target.nodeId, toNodeId: target.nodeId, label: target.name })));
	// Known places the plate does not draw right now.
	const farther = $derived(targets.filter((target) => !graph.names.has(target.nodeId)));
	const gated = $derived((view?.place?.exits ?? []).filter((exit) => exit.gates.length > 0));

	// --- The fight on the grid ---------------------------------------------

	// The plate carries the session grid: the fight is played on it.
	const onGrid = $derived(fighting && plate !== undefined && hasGridCells(plate));
	// Each foe's SRD sprite, by fighter id, for its token on the grid.
	let foeArt = $state<Record<string, string>>({});
	$effect(() => {
		for (const foe of foes) {
			if (!foe.defId || foe.id in foeArt) continue;
			void srdArtUrl(foe.defId).then((url) => {
				if (url) foeArt = { ...foeArt, [foe.id]: url };
			});
		}
	});
	const tokensOnGrid = $derived(view && onGrid ? gridTokens(view, foeArt) : []);
	// Where the pointer last went down on the grid: the click menu opens there.
	let gridPointer = { x: 0, y: 0 };
	// What the last step on the grid came to, when the world refused it.
	let stepRefusal = $state<string | null>(null);

	function clickCell(nodeId: string) {
		if (!view || busy) return;
		const click = cellClick(view, nodeId);
		if (click.kind === "fighter") menu = { occupant: click.fighter, x: gridPointer.x, y: gridPointer.y };
		else if (click.kind === "step") void go(click.exit);
	}


	// What the world gave, counted. This is the gap test's read-out.
	const facts = $derived.by(() => {
		if (!view) return [];
		const occupants = view.occupants;
		const context = view.manipulationContext;
		return [
			["Place", view.place ? `${view.place.name} (elevation ${view.place.elevation ?? "not sent"})` : `none (${view.placeState ?? "?"})`],
			["Exits", `${view.place?.exits.length ?? 0}, compass label on ${exits.filter((entry) => entry.known).length}`],
			["Occupants", `${occupants.length}: ${occupants.filter((o) => o.kind === "person").length} persons, ${occupants.filter((o) => o.kind === "creature").length} creatures, ${occupants.filter((o) => o.kind === "thing").length} things`],
			["Position inside the place", "never sent (tokens are spread by the client)"],
			["Occupants with a definition id", `${occupants.filter((o) => o.defId).length} of ${occupants.length}`],
			["Occupants with own art", `${occupants.filter((o) => o.art).length} of ${occupants.length}, loaded ${occupants.filter((o) => o.art && worldArt[o.art.hash]).length}${gateway ? "" : " (no gateway set)"}`],
			["Place picture", view.place?.art ? (backdrop ? "loaded" : "sent, not loaded") : "not sent"],
			["Occupants with SRD art", `${occupants.filter((o) => artKey(o) && artUrls[artKey(o)!]).length} of ${occupants.length}`],
			["Paired actions", `${view.actions.length}`],
			["My actions (no target)", context.status === "ready" ? `${context.actions.length}` : "unavailable"],
			["Targets I see", context.status === "ready" ? `${context.targets.length}` : "unavailable"],
			["Open prompts", `${prompts.length}, with a question text: ${prompts.filter((prompt) => prompt.presentation?.question).length}`],
			["Pack", `${view.pack.length} items`],
			["Hero", `${view.hero.name}${view.hero.drafting ? " (still drafting)" : ""}, HP ${view.hero.hp ?? "–"}, AC ${view.hero.ac ?? "–"}, abilities ${view.hero.abilities.length}`],
			["Fight", fighting ? `in a fight, my turn: ${view.session.myTurn}` : view.session.inSession ? "no (on a journey)" : "no"],
			["Map plate", view.mapSvg ? "sent" : `not sent (${view.mapState ?? "?"})`],
		];
	});
</script>

<div class="shell">
	<!-- One line on top: where you are, how you are, and the doors to
	     everything that is not the scene. -->
	<header class="bar">
		{#if inWorld && view}
			<span class="sk-title where">{view.place?.name ?? "Nowhere"}</span>
			<span class="vitals">
				<strong>{view.hero.name}</strong>
				<span>HP {view.hero.hp ?? "–"}</span>
				<span>AC {view.hero.ac ?? "–"}</span>
				{#if fighting}
					<span class="turn" class:mine={view.session.myTurn}>
						Fight · {view.session.myTurn ? "your turn" : `${view.session.currentActorName ?? "someone"} acts…`}
					</span>
					<Button size="sm" disabled={busy || !view.session.myTurn} onclick={endTurn}>End turn</Button>
					{#each budget as chip (chip.id)}
						<span class="chip {chip.state}" title={`${chip.label}: ${chip.left}`}>{chip.label} · {chip.left}</span>
					{/each}
				{/if}
			</span>
		{:else}
			<span class="sk-title">Spellkave Classic <small>live world · {config?.slug ?? "none"}</small></span>
		{/if}
		<span class="status">
			{status}{journey ? ` · walking to ${journey.name}…` : busy ? " · working…" : ""}
			{#if journey}
				<Button size="sm" variant="outline" disabled={journey.stop} onclick={() => journey && (journey.stop = true)}>Stop here</Button>
			{/if}
		</span>
		{#if inWorld}
			<Button size="sm" variant={mapOpen ? "default" : "outline"} disabled={!plate} onclick={() => (mapOpen = !mapOpen)}>Map</Button>
			<Button size="sm" variant="outline" onclick={() => ((sheetMark = nextId), (sheetOpen = true))}>Hero and pack</Button>
			<Button size="sm" variant={factsOpen ? "default" : "outline"} onclick={() => (factsOpen = !factsOpen)}>World facts</Button>
		{/if}
		<a class="mock" href="/demo.html">Mock-up</a>
		<ThemeSwitcher compact />
	</header>

	{#if !config}
		<p class="empty">No staged world. Run <code>just play-stage elven-mini</code> at the repo root, then restart <code>dev.sh</code>.</p>
	{:else if !view}
		<p class="empty">{status}</p>
	{:else if view.hero.drafting}
		<div class="creation">
			<CreationWizard {view} {busy} onAnswer={(action) => send(action)} onSubmit={(action, values) => send(action, values)} />
		</div>
	{:else}
		<main>
			<!-- The scene takes all the room there is. Everything else is a
			     line above, a bar below, or a sheet laid over the scene. -->
			<section class="scene">
				{#if onGrid && plate}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="grid" onpointerdowncapture={(event) => (gridPointer = { x: event.clientX, y: event.clientY })}>
						<BattleMap
							{plate}
							ownNodeId={view.place?.id ?? null}
							exits={(view.place?.exits ?? []).flatMap((exit) => (exit.toNodeId ? [{ handle: exit.handle, toNodeId: exit.toNodeId, label: `Step ${exit.label}` }] : []))}
							onStep={() => {}}
							onSelectCell={clickCell}
							tokens={tokensOnGrid}
							refusal={stepRefusal}
							viewKey={`fight:${view.place?.id.split("/")[0] ?? "grid"}`}
						/>
					</div>
				{:else}
				<div class="room" class:pictured={backdrop !== undefined} style:--place-picture={backdrop ? `url("${backdrop}")` : undefined}>
					{#each exits as entry (entry.exit.handle)}
						<button
							type="button"
							class="token exit"
							class:gated={!fighting && entry.exit.gates.length > 0}
							style:left={`${entry.x}%`}
							style:top={`${entry.y}%`}
							disabled={busy}
							title={fighting ? undefined : gateHint(entry.exit)}
							onclick={() => go(entry.exit)}
							onpointerenter={() => (hover = fighting ? `Step ${entry.exit.label}` : `Walk to ${entry.exit.toName}`)}
							onpointerleave={() => (hover = "")}
							onfocus={() => (hover = fighting ? `Step ${entry.exit.label}` : `Walk to ${entry.exit.toName}`)}
							onblur={() => (hover = "")}
						>
							<span class="name">
								{#if fighting}
									<!-- On the fight grid every neighbour cell carries the step gate. -->
									Step {entry.exit.label}
								{:else}
									{entry.exit.label} → {entry.exit.toName}{entry.exit.gates.length ? " (gated)" : ""}
								{/if}
							</span>
						</button>
					{/each}
					{#each placed as entry (entry.item.id)}
						{@const key = artKey(entry.item)}
						{@const own = entry.item.art ? worldArt[entry.item.art.hash] : undefined}
						{@const dead = entry.item.conditions.some((condition) => condition.endsWith("/dead"))}
						<button
							type="button"
							class="token {entry.item.kind}"
							class:dead
							style:left={`${entry.x}%`}
							style:top={`${entry.y}%`}
							aria-label={`${entry.item.name}. ${entry.item.note}`}
							onclick={(event) => open(entry.item, event)}
							onpointerenter={() => (hover = `Look at ${entry.item.name}`)}
							onpointerleave={() => (hover = "")}
							onfocus={() => (hover = `Look at ${entry.item.name}`)}
							onblur={() => (hover = "")}
						>
							{#if own}
								<img class="portrait" src={own} alt="" />
							{:else if key && artUrls[key]}
								<img class="cm-pixel" src={artUrls[key]} alt="" />
							{:else}
								<span class="glyph" aria-hidden="true">{entry.item.kind === "thing" ? "◆" : entry.item.kind === "creature" ? "☗" : "☺"}</span>
							{/if}
							<span class="name">{entry.item.name}</span>
						</button>
					{/each}
				</div>
				{/if}
				{#if down}
					<p class="notice down" role="status">You are down. Look in the bar below for a way back.</p>
				{:else if !fighting && gated.length > 0}
					<p class="notice gates">
						{#each gated as exit (exit.handle)}
							<span>{exit.label} → {exit.toName}: {gateHint(exit)}</span>
						{/each}
					</p>
				{/if}
				{#if mapOpen && plate && view.place}
					<div class="sheet-over map cm-panel">
						<header>
							<span class="sk-label cm-muted">Area map{mapExits.length ? " · click a place to walk there" : ""}</span>
							<Button size="sm" variant="outline" onclick={() => (mapOpen = false)}>Close</Button>
						</header>
						<div class="plate">
							<PlaceMap
								frame={{ mode: "full", placeName: view.place.name, caption: "The places around you.", state: "ready", svg: plate, focusNodeId: view.place.id }}
								density="stage"
								chrome="bare"
								exits={mapExits}
								onTravel={(nodeId) => void travelTo(nodeId)}
								disabled={busy}
							/>
						</div>
						{#if farther.length > 0}
							<p class="sk-label cm-muted far">Places you have seen</p>
							<div class="buttons">
								{#each farther as target (target.nodeId)}
									<Button variant="outline" size="sm" disabled={busy} onclick={() => void travelTo(target.nodeId)}>
										{target.name} · {target.hops} steps
									</Button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				{#if factsOpen}
					<div class="sheet-over facts cm-panel">
						<header>
							<span class="sk-label cm-muted">What the world gave</span>
							<Button size="sm" variant="outline" onclick={() => (factsOpen = false)}>Close</Button>
						</header>
						<dl>
							{#each facts as [label, value] (label)}
								<dt>{label}</dt>
								<dd>{value}</dd>
							{/each}
						</dl>
					</div>
				{/if}
			</section>

			<!-- The sentence line: what a click would do, or where you stand. -->
			<!-- What the bar's buttons open lies over the foot of the scene, so
			     the scene keeps its size. -->
			<section class="drawer cm-panel" class:shut={drawer === null}>
				<div class="acts" class:shut={drawer !== "acts"}>
					<p class="sk-label cm-muted">You can</p>
					<div class="buttons">
						{#each hereAndMe.primary as action (action.id)}
							<Button variant="outline" size="sm" disabled={busy} onclick={() => attempt(action)}>{action.name ?? action.label}</Button>
						{/each}
					</div>
					{#each hereAndMe.groups as group (group.id)}
						<details>
							<summary class="sk-label cm-muted">{group.label} ({group.actions.length})</summary>
							<div class="buttons">
								{#each group.actions as action (action.id)}
									<Button variant="outline" size="sm" disabled={busy} onclick={() => attempt(action)}>{action.name ?? action.label}</Button>
								{/each}
							</div>
						</details>
					{/each}
				</div>
				<div class="talk" class:shut={drawer !== "talk"}>
					<TalkPanel
						bind:this={talkPanel}
						bind:partnerId
						lines={story}
						{questions}
						{partners}
						canSpeak={words !== undefined}
						{busy}
						{thinking}
						onAnswer={(answer, question) => {
							if (!answer.action) return;
							expectAnswer(question.asker);
							void attempt(answer.action, answer.label);
						}}
						onSay={say}
					/>
				</div>
				<div class="pack" class:shut={drawer !== "pack"}>
					<p class="sk-label cm-muted">You carry</p>
					<div class="slots">
						{#each view.pack.filter((item) => (item.depth ?? 0) === 0) as item (item.id)}
							<button type="button" class="slot" class:worn={item.equipped !== null} title={item.detail} onclick={() => ((sheetMark = nextId), (sheetOpen = true))}>
								{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}
							</button>
						{:else}
							<span class="cm-muted">Nothing.</span>
						{/each}
					</div>
				</div>
			</section>

			<!-- One narrow line at the foot: three doors and the sentence line,
			     which says what a click would do, else what happened last. -->
			<footer class="foot">
				<Button size="sm" variant={drawer === "acts" ? "default" : "outline"} onclick={() => toggle("acts")}>Do</Button>
				<Button size="sm" variant={drawer === "talk" ? "default" : "outline"} onclick={() => toggle("talk")}>
					Talk{questions.length > 0 ? ` · ${questions.length} asked` : ""}
				</Button>
				<p class="sentence" class:pointing={hover !== ""} aria-live="polite">{hover || lastLine || view.place?.description || ""}</p>
				<Button size="sm" variant={drawer === "pack" ? "default" : "outline"} onclick={() => toggle("pack")}>Pack · {view.pack.filter((item) => (item.depth ?? 0) === 0).length}</Button>
			</footer>
		</main>
	{/if}
</div>

{#if sheetOpen && view && !view.hero.drafting}
	{@const last = results[results.length - 1]}
	<Sheet
		{view}
		{busy}
		result={last && last.id >= sheetMark ? last.text : undefined}
		sortActions={(actions) => menuFor(withoutFreeSpeech(actions), { inFight: fighting, fits, bound })}
		onAct={(action, label) => void attempt(action, label)}
		onSelectItem={(item) => void handle?.selectItem({ id: item.id, handle: item.handle, rev: item.rev, name: item.name })}
		onClose={() => (sheetOpen = false)}
	/>
{/if}

{#if menu}
	<ClickMenu
		title={menu.occupant.name}
		subtitle={menuActions.length ? menu.occupant.note : "Asking the world…"}
		entries={menuEntries}
		folds={menuFolds}
		x={menu.x}
		y={menu.y}
		onPick={(id) => {
			const action = menuActions.find((entry) => entry.id === id);
			if (id === TALK && menu) {
				partnerId = menu.occupant.id;
				drawer = "talk";
				queueMicrotask(() => talkPanel?.focus());
			}
			// The pairing's own target name is often "Someone here"; the menu
			// knows whom the player clicked.
			const label = action && menu ? `${action.name ?? action.label} on ${menu.occupant.name}` : undefined;
			menu = null;
			if (action) void attempt(action, label);
		}}
		onClose={() => (menu = null)}
	/>
{/if}

<style>
	.shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto 1fr;
		height: 100%;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--card);
	}
	.bar small {
		font-size: 0.7rem;
		color: var(--muted-foreground);
		margin-left: 0.5rem;
	}
	.status {
		flex: 1;
		text-align: right;
		font-size: 0.85rem;
		color: var(--muted-foreground);
	}
	.empty {
		padding: 2rem;
	}
	.creation {
		overflow: auto;
		min-height: 0;
	}
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(12rem, 1fr) auto;
		position: relative;
		min-height: 0;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-top: 1px solid var(--border);
		background: var(--card);
	}
	.drawer {
		position: absolute;
		left: 0.75rem;
		right: 0.75rem;
		bottom: 3.4rem;
		height: min(17rem, 55%);
		z-index: 4;
		display: grid;
		min-height: 0;
	}
	.shut {
		display: none !important;
	}
	.scene {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.where {
		white-space: nowrap;
	}
	.mock {
		font-size: 0.8rem;
		color: var(--muted-foreground);
	}
	.notice {
		position: absolute;
		top: 0.6rem;
		left: 50%;
		transform: translateX(-50%);
		max-width: min(40rem, 90%);
		margin: 0;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
		z-index: 3;
	}
	.sheet-over {
		position: absolute;
		inset: 0.75rem;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		overflow: auto;
	}
	.sheet-over.facts {
		left: auto;
		width: min(22rem, calc(100% - 1.5rem));
	}
	.sheet-over header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.sentence {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-family: var(--font-body);
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--muted-foreground);
	}
	.sentence.pointing {
		color: var(--primary);
	}
	.pack {
		overflow-y: auto;
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
	}
	.pack p {
		margin: 0 0 0.3rem;
	}
	.slots {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
		gap: 0.35rem;
	}
	.slot {
		min-height: 2.75rem;
		padding: 0.2rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
		color: var(--card-foreground);
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
	}
	.slot.worn {
		border-color: var(--primary);
	}
	.slot:hover,
	.slot:focus-visible {
		border-color: var(--ring);
		outline: none;
	}
	.vitals {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.down {
		margin: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--destructive, var(--primary));
		border-radius: var(--radius-sm);
		background: var(--card);
		font-family: var(--font-body);
	}
	.turn {
		padding: 0 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.chip {
		padding: 0 0.4rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
	}
	.chip.spent {
		color: var(--muted-foreground);
		text-decoration: line-through;
	}
	.turn.mine {
		border-color: var(--primary);
		color: var(--primary);
	}
	.room {
		position: relative;
		flex: 1;
		min-height: 0;
		background-color: var(--muted);
		background-image: var(--ground-image, none);
		background-size: var(--ground-size, auto);
		overflow: hidden;
	}
	.grid {
		flex: 1;
		min-height: 14rem;
		display: flex;
		flex-direction: column;
	}
	.grid > :global(*) {
		flex: 1;
		min-height: 0;
	}
	.room.pictured {
		background-image: var(--place-picture);
		background-size: cover;
		background-position: center;
	}
	.token img.portrait {
		object-fit: cover;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
	}
	.token {
		position: absolute;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.25rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
	}
	.token:hover,
	.token:focus-visible {
		border-color: var(--ring);
		background: var(--card);
		outline: none;
		z-index: 2;
	}
	.token img {
		width: 4rem;
		height: 4rem;
	}
	.token.dead {
		opacity: 0.5;
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		font-size: 1.4rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
	}
	.name {
		font-size: 0.75rem;
		background: var(--card);
		color: var(--card-foreground);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0 0.4rem;
		white-space: nowrap;
	}
	.exit .name {
		border-color: var(--primary);
		color: var(--primary);
		min-height: 2rem;
		display: grid;
		place-items: center;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
		overflow-y: auto;
	}
	.block {
		padding: 0.6rem 0.75rem;
	}
	dl {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.1rem;
		margin: 0.4rem 0 0;
		font-size: 0.82rem;
	}
	dt {
		color: var(--muted-foreground);
		font-size: 0.72rem;
		margin-top: 0.3rem;
	}
	dd {
		margin: 0;
	}
	.plate {
		flex: 1;
		min-height: 16rem;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.plate :global([data-slot="play-map"]) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.plate :global(.sk-play-map-shell) {
		flex: 1;
		min-height: 0;
	}
	.far {
		margin: 0.5rem 0 0.3rem;
	}
	.gates {
		display: flex;
		flex-direction: column;
		font-family: var(--font-body);
		font-size: 0.85rem;
	}
	.exit.gated .name {
		border-style: dashed;
	}
	.status :global(button) {
		margin-left: 0.5rem;
	}
	.talk {
		min-height: 0;
	}
	.acts {
		overflow-y: auto;
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
	}
	.acts p {
		margin: 0 0 0.3rem;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}
</style>
