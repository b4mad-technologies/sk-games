<script lang="ts">
	import {
		type AuthSession,
		completeLogin,
		endAuthSession,
		readAuthConfig,
		readSession,
		type SessionRenewalState,
		startLogin,
		startSessionRenewal,
	} from "@spellkave/authkit";
	import {
		type ActorPlace,
		type OccupancyPlace,
		parseMapsLocator,
		publishWorldLocator,
	} from "@spellkave/map-canvas";
	import { Button, PRODUCT_APP_URLS, wovenTextureUrls } from "@spellkave/ui";
	import { initTheme, ThemeSwitcher } from "@spellkave/ui/theme";
	import { onMount } from "svelte";
	import MapsGate, { type MapsPhase } from "./components/MapsGate.svelte";
	import MapsTable from "./components/MapsTable.svelte";
	import SeatBoard from "./components/SeatBoard.svelte";
	import { fetchAccount, readAccountApiUrl, worldIsReachable } from "./lib/account-api";
	import { CALLBACK_PATH } from "./lib/auth-routes";
	import {
		applyDevSession,
		isDevAuthEnabled,
		maybeAutoSeedDevToken,
		readDevTokenHint,
	} from "./lib/dev-auth";
	import { tryReadGatewayUrl } from "./lib/env";
	import { readPlayUrl } from "./lib/play";
	import {
		fetchPublicSiteIndex,
		type PublicWorld,
		publicSiteBaseUrl,
	} from "./lib/public-site";
	import { type MineWatchArgs, retainSelection } from "./lib/watch-view";

	initTheme();

	const env = import.meta.env as Record<string, string | undefined>;
	const authConfig = readAuthConfig(env);
	const accountApiUrl = readAccountApiUrl(env);
	const base = publicSiteBaseUrl(env);
	const playUrl = readPlayUrl(env);
	const gatewayOrigin = tryReadGatewayUrl(env);
	const gatewayError =
		gatewayOrigin === null ? "VITE_SPELLKAVE_GATEWAY_URL is required" : null;
	const devAuth = isDevAuthEnabled();
	const devTokenHint = readDevTokenHint(env) ?? "";
	const devDb =
		import.meta.env.DEV === true ? (env.VITE_SPELLKAVE_DEV_DB?.trim() ?? "") : "";

	const initialSession = typeof window === "undefined" ? null : readSession(window.sessionStorage);
	let session = $state<AuthSession | null>(initialSession);
	const bootLocator =
		typeof window === "undefined"
			? { world: null, place: null, person: null, thing: null }
			: parseMapsLocator(window.location.href);
	let requestedSlug = $state<string | null>(bootLocator.world);
	let linkedPlace = $state<string | null>(bootLocator.place);

	let phase = $state<MapsPhase>(initialSession === null ? "auth" : "loading");
	let status = $state("Opening the world map…");
	let showSignIn = $state(false);
	let retry = $state(0);
	let catalogWorlds = $state<PublicWorld[]>([]);
	let accountUsed = $state(false);
	let selectedSlug = $state<string | null>(bootLocator.world);
	let openWorld = $state<typeof import("./lib/world-client").openWorld | undefined>(undefined);
	let minePlaces = $state<ActorPlace[]>([]);
	let mineEntityIds = $state<string[]>([]);
	let overlay = $state(false);
	let occupancyPlaces = $state<OccupancyPlace[]>([]);
	let watchArgs = $state<MineWatchArgs | null>(null);
	let selectedEntityId = $state<string | null>(bootLocator.person);
	let selectedThingId = $state<string | null>(bootLocator.thing);
	/** True once a populated watch frame carried the current selection. A
	 * pending (un-vouched) deep-link selection survives boot-time place
	 * clears; any user pick arrives from a live marker, i.e. after a populated
	 * frame already set this true. */
	let selectionVouched = $state(false);
	const selectionPending = $derived(selectedEntityId !== null && !selectionVouched);
	let renewalStatus: SessionRenewalState["status"] = "signed-out";
	let authRenewal: ReturnType<typeof startSessionRenewal> | null = null;
	let showDevPaste = $state(false);
	let devTokenDraft = $state("");

	const worlds = $derived.by((): PublicWorld[] => {
		if (devDb === "") return catalogWorlds;
		return catalogWorlds.map((world, i) =>
			i === 0 || (typeof world.db === "string" && world.db !== "")
				? { ...world, db: devDb }
				: world,
		);
	});
	const selected = $derived(
		worlds.find((world) => world.slug === selectedSlug) ?? worlds[0] ?? null,
	);

	$effect(() => {
		const slug = selectedSlug;
		if (slug === null || typeof window === "undefined") return;
		const loc = parseMapsLocator(window.location.href);
		if (loc.world === slug) return;
		publishWorldLocator(slug);
	});

	onMount(() => {
		let disposed = false;
		if (devAuth && import.meta.env.MODE !== "test" && typeof window !== "undefined") {
			maybeAutoSeedDevToken(
				window.sessionStorage,
				env,
				readSession(window.sessionStorage) !== null,
			);
			session = readSession(window.sessionStorage);
		}
		if (authConfig !== null) {
			authRenewal = startSessionRenewal({
				config: authConfig,
				storage: window.sessionStorage,
				fetch,
				window,
				document,
				onChange: (next) => {
					session = next.session;
					renewalStatus = next.status;
					if (next.session === null) {
						phase = "auth";
						status =
							next.status === "signed-out"
								? "Sign in to open a world map."
								: "Reconnecting your session…";
						showSignIn = next.status === "signed-out";
					}
				},
			});
		}
		void (authRenewal?.ready ?? Promise.resolve(session)).then(() => {
			if (!disposed && renewalStatus !== "retrying") initializeAuth();
		});
		const onPop = (): void => {
			const loc = parseMapsLocator(window.location.href);
			if (loc.world !== null) {
				requestedSlug = loc.world;
				selectedSlug = loc.world;
			}
			linkedPlace = loc.place;
			selectedEntityId = loc.person;
			selectedThingId = loc.thing;
		};
		window.addEventListener("popstate", onPop);
		return () => {
			disposed = true;
			window.removeEventListener("popstate", onPop);
			authRenewal?.stop();
		};
	});

	function initializeAuth(): void {
		if (session !== null) return;
		if (authConfig === null) {
			if (devAuth) {
				phase = "auth";
				status = "Sign in or paste a DEV token to open a world map.";
				showSignIn = false;
				return;
			}
			phase = "error";
			status = "Sign-in is temporarily unavailable. Return to Spellkave and try again later.";
			return;
		}
		if (window.location.pathname === CALLBACK_PATH) {
			phase = "auth";
			status = "Finishing sign-in…";
			void completeLogin(authConfig, window.location.href, window.sessionStorage, fetch)
				.then((next) => {
					session = next;
					void authRenewal?.check();
					window.history.replaceState(
						{},
						"",
						requestedSlug === null ? "/" : `/w/${encodeURIComponent(requestedSlug)}`,
					);
				})
				.catch((cause: unknown) => {
					phase = "error";
					status = cause instanceof Error ? cause.message : String(cause);
				});
			return;
		}
		phase = "auth";
		status = "Sign in to open a world map.";
		showSignIn = true;
	}

	function signIn(): void {
		if (authConfig === null) return;
		void startLogin(
			authConfig,
			window.location.origin,
			window.sessionStorage,
			(url) => {
				window.location.assign(url);
			},
			CALLBACK_PATH,
		).catch((cause: unknown) => {
			phase = "error";
			status = cause instanceof Error ? cause.message : String(cause);
		});
	}

	function applyDevToken(): void {
		if (!devAuth || typeof window === "undefined") return;
		const ok = applyDevSession(window.sessionStorage, devTokenDraft, "dev-paste");
		if (!ok) {
			phase = "error";
			status = "Paste a non-empty play-stage token.";
			return;
		}
		session = readSession(window.sessionStorage);
		showDevPaste = false;
		devTokenDraft = "";
		retry += 1;
	}

	$effect(() => {
		if (playUrl === null || session === null) {
			openWorld = undefined;
			return;
		}
		let cancelled = false;
		void import("./lib/world-client").then((mod) => {
			if (!cancelled) openWorld = mod.openWorld;
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const token = session?.access_token;
		void retry;
		if (token === undefined) {
			catalogWorlds = [];
			accountUsed = false;
			return;
		}
		if (gatewayError !== null) {
			phase = "error";
			status = `${gatewayError}. Set it in .env (see .env.example).`;
			return;
		}
		let cancelled = false;
		phase = "loading";
		status = "Finding the worlds open to you…";
		void (async () => {
			try {
				const index = await fetchPublicSiteIndex(base);
				if (cancelled) return;
				let nextWorlds = index.worlds;
				// Local DEV pin: do not filter the catalog through the hosted Account API.
				if (devDb === "") {
					try {
						const account = await fetchAccount(accountApiUrl, token);
						if (cancelled) return;
						accountUsed = true;
						const allowed = new Set(
							account.worlds
								.filter((row) => worldIsReachable(row.capabilities))
								.map((row) => row.slug),
						);
						nextWorlds = nextWorlds.filter((world) => allowed.has(world.slug));
						if (requestedSlug === null && account.seat !== null) {
							requestedSlug = account.seat.slug;
						}
					} catch {
						accountUsed = false;
					}
				} else {
					accountUsed = false;
				}
				if (cancelled) return;
				catalogWorlds = nextWorlds;
				if (nextWorlds.length === 0) {
					phase = "empty";
					status = accountUsed
						? "No world is open to this account yet."
						: "No worlds in the catalog.";
					return;
				}
				const destination =
					nextWorlds.find((world) => world.slug === requestedSlug) ?? nextWorlds[0];
				selectedSlug = destination?.slug ?? null;
				phase = "ready";
				status = "";
			} catch (cause) {
				if (cancelled) return;
				phase = "error";
				status = cause instanceof Error ? cause.message : String(cause);
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function onMinePlace(args: MineWatchArgs | null): void {
		if (args === null) {
			minePlaces = [];
			mineEntityIds = [];
			overlay = false;
			occupancyPlaces = [];
			watchArgs = null;
			// Seat-less emission (view.mine is null until the seat resolves — the
			// FIRST thing SeatBoard fires): only world-derived state is cleared;
			// the boot selection stays pending (sk-jay0.4.4.1).
			const retained = retainSelection(selectedEntityId, null, false);
			if (retained !== selectedEntityId) selectedEntityId = retained;
			const retainedThing = retainSelection(selectedThingId, null, false);
			if (retainedThing !== selectedThingId) selectedThingId = retainedThing;
			return;
		}
		if (selected !== null && args.slug !== selected.slug) return;
		minePlaces = args.places;
		mineEntityIds = args.mineEntityIds;
		overlay = args.overlay;
		occupancyPlaces = args.occupancy;
		watchArgs = args;
		// A deep link's selection stays PENDING until a populated frame carries
		// the id (retainSelection owns every selection transition);
		// selectionVouched gates MapsTable's onPlaceClear so a boot-time
		// clearPlace cannot wipe a selection no frame has vouched for yet.
		const retained = retainSelection(selectedEntityId, args.actors, args.framePopulated);
		if (retained !== selectedEntityId) selectedEntityId = retained;
		selectionVouched = retained !== null && args.framePopulated;
		// A thing is vouched by a populated frame whose items carry it.
		const retainedThing = retainSelection(selectedThingId, args.items ?? [], args.framePopulated);
		if (retainedThing !== selectedThingId) selectedThingId = retainedThing;
	}

	function logOut(): void {
		const home = "https://spellkave.com/";
		// Drop the session first: the map table unmounts and closes its gateway
		// connection before the form POST navigates away.
		session = null;
		phase = "auth";
		status = "Sign in to open a world map.";
		showSignIn = true;
		endAuthSession(window.sessionStorage, authConfig ?? {}, home);
	}

	let seatMenuOpen = $state(false);
	let menuPosition = $state<{ left: number; top: number } | null>(null);
	const seatName = $derived(session?.display_name ?? "");
	const seatInitial = $derived(seatName.trim().charAt(0).toUpperCase() || "?");
	const seatWorldName = $derived(selected?.name ?? "Spellkave");

	function closeSeatMenu(): void {
		seatMenuOpen = false;
	}
	function signOutFromSeatMenu(): void {
		closeSeatMenu();
		logOut();
	}

	const SEAT_MENU_WIDTH = 448;
	const SEAT_MENU_HEIGHT = 512;
	const SEAT_MENU_GAP = 8;

	function toggleSeatMenu(event: MouseEvent): void {
		if (seatMenuOpen) {
			closeSeatMenu();
			return;
		}
		const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const left = Math.max(
			SEAT_MENU_GAP,
			Math.min(anchor.left, window.innerWidth - SEAT_MENU_WIDTH - SEAT_MENU_GAP),
		);
		const top =
			anchor.bottom + SEAT_MENU_GAP + SEAT_MENU_HEIGHT > window.innerHeight
				? Math.max(SEAT_MENU_GAP, anchor.top - SEAT_MENU_GAP - SEAT_MENU_HEIGHT)
				: anchor.bottom + SEAT_MENU_GAP;
		menuPosition = { left, top };
		seatMenuOpen = true;
	}
</script>

{#snippet sealButton()}
	<Button
		variant="woven-icon"
		size="seal"
		type="button"
		class="seat-seal"
		aria-haspopup="dialog"
		aria-expanded={seatMenuOpen}
		aria-label={`${seatName || "Player"}, seat menu`}
		onclick={toggleSeatMenu}
	>
		{seatInitial}
	</Button>
{/snippet}

<svelte:head>
	<title>{selected ? `${selected.name} · Maps · Spellkave` : "Maps · Spellkave"}</title>
</svelte:head>

<main
	class="maps-shell"
	data-testid="maps-app"
	style={`--woven-midnight: url(${wovenTextureUrls.midnight}); --woven-paper: url(${wovenTextureUrls.paper});`}
>
	{#if session !== null}
		{#if phase !== "ready" || selected === null || gatewayOrigin === null}
			<div class="seat-seal-gate">{@render sealButton()}</div>
		{/if}
		{#if seatMenuOpen}
			<button
				type="button"
				class="seat-menu-scrim"
				aria-hidden="true"
				tabindex="-1"
				onclick={closeSeatMenu}
			></button>
		{/if}
		<dialog
			class="seat-menu"
			open={seatMenuOpen}
			aria-label="Seat menu"
			style={menuPosition ? `left: ${menuPosition.left}px; top: ${menuPosition.top}px;` : "visibility: hidden; pointer-events: none;"}
			onkeydown={(event) => {
				if (event.key === "Escape") closeSeatMenu();
			}}
		>
			<div class="seat-menu__who">
				<p class="seat-menu__name sk-display">{seatName || "Player"}</p>
				<p class="seat-menu__world">{seatWorldName}</p>
			</div>
			<div class="seat-menu__seats">
				<SeatBoard
					{worlds}
					{playUrl}
					{session}
					{openWorld}
					bind:selectedSlug
					{onMinePlace}
				/>
			</div>
			<a class="seat-menu-row" href={PRODUCT_APP_URLS.account}>Account</a>
			<a class="seat-menu-row" href={PRODUCT_APP_URLS.play}>Play</a>
			<div class="seat-menu-row">
				<ThemeSwitcher compact />
			</div>
			<button type="button" class="seat-menu-row" onclick={signOutFromSeatMenu}>Sign out</button>
			<a class="seat-menu-row" href="https://spellkave.com">spellkave.com</a>
		</dialog>
	{/if}

	{#if phase !== "ready" || selected === null || gatewayOrigin === null}
		<MapsGate
			{phase}
			{status}
			{showSignIn}
			signedIn={session !== null}
			{devAuth}
			{devTokenHint}
			{showDevPaste}
			bind:devTokenDraft
			onSignIn={signIn}
			onRetry={() => {
				if (session === null) void authRenewal?.check();
				else retry += 1;
			}}
			onToggleDevPaste={() => {
				showDevPaste = !showDevPaste;
			}}
			onApplyDevToken={applyDevToken}
		/>
	{:else}
		<MapsTable
			{gatewayOrigin}
			slug={selected.slug}
			token={session?.access_token ?? ""}
			placeNodeId={linkedPlace ?? undefined}
			{minePlaces}
			{mineEntityIds}
			{occupancyPlaces}
			{overlay}
			{watchArgs}
			bind:selectedEntityId
			bind:selectedThingId
			{selectionPending}
			seal={session !== null ? sealButton : undefined}
		/>
	{/if}
</main>
