<script lang="ts">
	import {
		type AuthSession,
		completeLogin,
		decodeJwtPayload,
		endAuthSession,
		readAuthConfig,
		readSession,
		type SessionRenewalState,
		startLogin,
		startSessionRenewal,
	} from "@spellkave/authkit";
	import type { IntentInputValues } from "@spellkave/sdk";
	import type { ToolRole } from "@spellkave/tool-contracts";
	import type { DockBarEntry, DockBarSection, SeatBoardSeat } from "@spellkave/ui";
	import { DockBar, DockBarMenu, DockTick, PRODUCT_APP_URLS, wovenTextureUrls } from "@spellkave/ui";
	import { initTheme, ThemeSwitcher } from "@spellkave/ui/theme";
	import { onMount, type Snippet, tick, untrack } from "svelte";
	import FeedbackDialog from "./components/FeedbackDialog.svelte";
	import KeymapDialog from "./components/KeymapDialog.svelte";
	import PlayGate from "./components/PlayGate.svelte";
	import PlayTable from "./components/PlayTable.svelte";
	import SwitchHeroDialog from "./components/SwitchHeroDialog.svelte";
	import {
		AccountApiError,
		type AccountGetResponse,
		type AccountWorldSummary,
		claimSeat,
		fetchAccount,
		fetchSeats,
		readAccountApiUrl,
		releaseSeat,
	} from "./lib/account-api";
	import { CALLBACK_PATH, PLAY_PATH } from "./lib/auth-routes";
	import { tryReadGatewayUrl, tryReadMapsUrl } from "./lib/env";
	import type { PlayMapWatch } from "./lib/map-watch";
	import { pendingWorld, rememberWorld } from "./lib/pending-world";
	import type { ActionSurface } from "./lib/play-action-context";
	import {
		type ConnectAttempt,
		createConnectionObserver,
		observationView,
		playObservation,
		viewHasData,
	} from "./lib/play-observation";
	import {
		capturePlayView,
		createPlayRecording,
		PLAY_RECORDING_SURFACE,
		type PlayPresentation,
	} from "./lib/play-recording";
	import { playRumProducer } from "./lib/play-rum";
	import {
		isPlayAttemptBlocked,
		type OpenPlaySessionArgs,
		openPlaySession,
		type PlaySessionHandle,
		readWorldUrl,
		type SelectedPackItem,
	} from "./lib/play-session";
	import { type ActStatusKind, actStatusKindFromOutcome } from "./lib/play-table";
	import { playTrail } from "./lib/play-trail";
	import type { PlayAction, PlayExit, PlayView } from "./lib/play-view";
	import {
		chooseActor,
		displaySeatName,
		heldSeatsFromAccount,
		mySeat,
		type PlaySeat,
		parseSeatKey,
		playSeatsFromBoard,
		rememberSeat,
		SEAT_CAP_MESSAGE,
		seatIsClaimable,
		seatKey,
		selectedSeat,
	} from "./lib/seats";
	import {
		actorFromSearch,
		type CatalogWorld,
		fetchWorldCatalog,
		publicSiteBaseUrl,
		worldFromSearch,
	} from "./lib/world-catalog";

	initTheme();

	type AccountLoader = typeof fetchAccount;
	type CatalogLoader = typeof fetchWorldCatalog;
	type SeatsLoader = typeof fetchSeats;
	type SeatClaimer = typeof claimSeat;
	type SeatReleaser = typeof releaseSeat;
	type WorldOpener = (args: OpenPlaySessionArgs) => Promise<PlaySessionHandle>;

	/** sk-jay0.1.1.13: how long to wait before re-reading /v1/account while a
	 * claimed seat's world is still scheduling. Fixed and short by design —
	 * this is a "world is starting" poll, not a distributed retry policy. Test
	 * seam only; production never overrides it. */
	const DEFAULT_WORLD_STARTING_RETRY_MS = 3_000;
	/** sk-jay0.1.1.13: total wall-clock time a seat's world may spend polling
	 * as "starting" before Play gives up and shows the error gate instead of
	 * polling forever (an npc-host that never schedules, or a catalog status
	 * stuck by a bug, must not spin the player's tab indefinitely). Test seam
	 * only; production never overrides it. */
	const DEFAULT_WORLD_STARTING_MAX_MS = 5 * 60_000;
	/** sk-jay0.1.24: a dropped world socket reconnects on its own at most once
	 * per this window; a second drop inside it shows the error gate, so a
	 * server that accepts and immediately closes cannot spin a reconnect loop. */
	const DROP_RECONNECT_COOLDOWN_MS = 30_000;
	/** A stored token this close to expiry is renewed before a (re)connect. */
	const CONNECT_TOKEN_MARGIN_MS = 5_000;

	/** The account a token speaks for. SpacetimeDB checks the JWT only when a
	 * socket opens, so a renewed token for the same issuer/subject must not
	 * replace an open world connection (sk-jay0.1.24). A token without a
	 * decodable issuer/subject is its own key, so it still reconnects. */
	function subjectKey(current: AuthSession | null): string | undefined {
		if (current === null) return undefined;
		const claims = decodeJwtPayload(current.access_token);
		return typeof claims.iss === "string" && claims.iss !== "" &&
			typeof claims.sub === "string" && claims.sub !== ""
			? `${claims.iss}\u0000${claims.sub}`
			: current.access_token;
	}

	let {
		sandbox: sandboxProp,
		dockExtras,
		accountLoader = fetchAccount,
		catalogLoader = fetchWorldCatalog,
		seatsLoader = fetchSeats,
		seatClaimer = claimSeat,
		seatReleaser = releaseSeat,
		worldOpener = openPlaySession,
		worldStartingRetryMs = DEFAULT_WORLD_STARTING_RETRY_MS,
		worldStartingMaxMs = DEFAULT_WORLD_STARTING_MAX_MS,
	}: {
		sandbox?: import("./lib/play-sandbox").PlaySandbox;
		dockExtras?: Snippet;
		accountLoader?: AccountLoader;
		catalogLoader?: CatalogLoader;
		seatsLoader?: SeatsLoader;
		seatClaimer?: SeatClaimer;
		seatReleaser?: SeatReleaser;
		worldOpener?: WorldOpener;
		worldStartingRetryMs?: number;
		worldStartingMaxMs?: number;
	} = $props();

	const env = import.meta.env as Record<string, string | undefined>;
	// The connection mode is mount-scoped; scene changes remount this component.
	const sandbox = untrack(() => sandboxProp);
	const authConfig = sandbox ? null : readAuthConfig(env);
	const origin = typeof window === "undefined" ? "https://play.spellkave.com" : window.location.origin;
	const accountApiUrl = readAccountApiUrl(env, origin);
	const catalogUrl = publicSiteBaseUrl(env);
	const worldUrl = readWorldUrl(env, origin);
	/** Gateway origin for the map tile's canvas; `null` degrades to the tile's own blocked state. */
	const gatewayOrigin = sandbox ? null : tryReadGatewayUrl(env);
	/** Hosted maps site unless `VITE_SPELLKAVE_MAPS_URL` names another origin
	 * or is `off` (`null`: no link, for a local world the hosted site does
	 * not show). */
	const mapsOrigin = tryReadMapsUrl(env);
	// A map/art gateway may deliberately provide no feedback MCP transport.
	const feedbackGatewayOrigin = env.VITE_SPELLKAVE_FEEDBACK_ENABLED === "false" ? null : gatewayOrigin;
	const initialSession = sandbox?.session ?? (typeof window === "undefined" ? null : readSession(window.sessionStorage));

	let session = $state<AuthSession | null>(initialSession);
	let requestedSlug = $state<string | null>(
		sandbox ? sandbox.world.slug : typeof window === "undefined"
			? null
			: (worldFromSearch(window.location.search) ?? pendingWorld(window.sessionStorage)),
	);
	// `?actor=<id>` next to `?world=` names the hero to play. It is remembered
	// like the seat menu's choice and stays a preference: the module checks the
	// binding (ADR-0161 D-6).
	if (!sandbox && typeof window !== "undefined") {
		rememberSeat(window.sessionStorage, untrack(() => requestedSlug), actorFromSearch(window.location.search));
	}
	let phase = $state<
		"auth" | "loading" | "choose-hero" | "empty" | "error" | "ready" | "world-starting"
	>(initialSession === null ? "auth" : "loading");
	let status = $state("Opening your world…");
	let world = $state<CatalogWorld | null>(null);
	let view = $state<PlayView | null>(null);
	const recording = createPlayRecording();
	let recordingPresentation: PlayPresentation | undefined = sandbox?.presentation;
	let mapWatch = $state<PlayMapWatch | null>(null);
	/** Live `world_time` tick (sk-jay0.1.1.14), for the seal cluster's readout.
	 * `null` before a session has reported one at least once — the readout
	 * stays hidden rather than showing a misleading 0. */
	let worldTick = $state<number | null>(null);
	let worldHandle: PlaySessionHandle | null = null;
	/** Pending re-read of /v1/account while the seat's world is scheduling
	 * (sk-jay0.1.1.13). Cleared at the top of every connect attempt and on
	 * teardown so a stale timer never fires a `retry` after the component or
	 * attempt it belongs to is gone. */
	let worldStartingTimer: ReturnType<typeof setTimeout> | null = null;
	function clearWorldStartingTimer(): void {
		if (worldStartingTimer !== null) {
			clearTimeout(worldStartingTimer);
			worldStartingTimer = null;
		}
	}
	/** Wall-clock start of the CURRENT world-starting poll sequence
	 * (sk-jay0.1.1.13), tracked across every `retry`-driven attempt for the
	 * SAME destination — each poll reruns this whole effect (a brand-new
	 * connect attempt), so the elapsed time cannot live in a `let` the effect
	 * body resets. `worldStartingSlug` scopes it to one destination: switching
	 * worlds while a poll is in flight must not inherit its elapsed time, and
	 * the world reporting "running" (or no longer needing to poll at all)
	 * clears both so a later poll for the same world starts its budget over. */
	let worldStartingSlug: string | null = null;
	let worldStartingSince: number | null = null;
	/** Turns connect attempts' `onPhase`/error callbacks into the
	 * `connected`/`error`/`stalled` `play_connection` milestones (sk-jay0.6.38.25).
	 * One instance reused across reconnects: `start()` returns a handle scoped
	 * to that one attempt, so a stale/superseded attempt's late callbacks
	 * cannot settle or suppress a different, newer attempt's own milestones
	 * (#3477 RUM-lane review). */
	const connectionObserver = createConnectionObserver();
	let itemDetailGeneration = $state(0);
	let occupantDetailGeneration = $state(0);
	let busyId = $state<string | null>(null);
	/** Identity the world connection belongs to; the token itself is read at
	 * connect time, so a same-subject renewal never reopens the world. */
	let connectionSubject = $state(subjectKey(initialSession));
	let reconnecting = $state(false);
	// Only the session's socket-disconnect callback sets this.
	let disconnected = $state(false);
	let waiting = $state(false);
	let actionLabel = $state<string | null>(null);
	$effect(() => {
		const pending = busyId;
		waiting = false;
		if (pending === null) return;
		const timer = setTimeout(() => { waiting = true; }, 2000);
		return () => clearTimeout(timer);
	});
	const gameStatus = $derived(disconnected ? "disconnected" : reconnecting ? "reconnecting" : waiting ? "waiting" : "running");
	const connectionMessage = $derived(disconnected
		? { text: "Disconnected from the world.", tone: "error" as const }
		: reconnecting ? { text: "Reconnecting to the world…", tone: "stale" as const }
		: waiting ? { text: "The world is still thinking…", tone: "stale" as const } : undefined);
	/** Set by a dropped socket just before it bumps `retry`: the next connect
	 * keeps the mounted view instead of resetting to the loading gate. */
	let reconnectAfterDrop = false;
	let lastDropReconnectAt = Number.NEGATIVE_INFINITY;
	let renewalStatus: SessionRenewalState["status"] = "signed-out";
	let authRenewal: ReturnType<typeof startSessionRenewal> | null = null;
	let moveStatus = $state<string | null>(null);
	/** Where `moveStatus` belongs (round 3, sk-jay0.1.8): read off the trail
	 * entry the SAME dispatch just recorded (`playTrail.recordAct`,
	 * `play-session.ts`), never re-classified here — see
	 * `actStatusKindFromOutcome`'s own doc for why the trail, not a widened
	 * `PlaySessionHandle` return type. `"failed"` is set directly in each
	 * handler's own catch branch: a thrown/caught error never reaches
	 * `classifyActResult` at all, so no trail entry answers for it. */
	let moveStatusKind = $state<ActStatusKind>("other");
	/** The just-appended `act`-kind trail entry's own classification, or
	 * `"other"` when the trail (a test double, or a call this component does
	 * not itself dispatch) carries no such entry. */
	function lastActStatusKind(): ActStatusKind {
		const last = playTrail.entries().at(-1);
		return last?.kind === "act" ? actStatusKindFromOutcome(last.outcome) : "other";
	}
	/** The last act's raw refusal code (+ optional `failure_detail`), read
	 * back off the same trail entry `lastActStatusKind` reads (sk-j8e.4) —
	 * never a widened `PlaySessionHandle` return contract. `null` on
	 * anything that was not a rejection. */
	let lastRefusal = $state<{ code: string; detail?: string } | null>(null);
	function lastActRefusal(): { code: string; detail?: string } | null {
		const last = playTrail.entries().at(-1);
		if (last?.kind !== "act" || last.refusalCode === null) return null;
		return last.refusalDetail === null
			? { code: last.refusalCode }
			: { code: last.refusalCode, detail: last.refusalDetail };
	}
	let retry = $state(0);
	function recordView(nextView: PlayView): void {
		recording.record(capturePlayView(nextView, recordingPresentation));
	}
	function recordLayout(layout: import("./lib/mosaic").MosaicLayout, mobile: boolean): void {
		recordingPresentation = { layout, mobile };
		if (view !== null) recordView(view);
	}
	/** Round 4 (refusals into the stream): an action's own result no longer
	 * mounts as a status paragraph — it becomes an Explore stream line, or,
	 * in Talk/Fight/Reaction, the dock's one notice. Either counts as
	 * "the player has something to see" for this milestone. */
	function feedbackMounted(): boolean {
		return (
			moveStatus !== null &&
			(document.querySelector('[data-slot="dock-notice"]') !== null ||
				document.querySelector(".play-explore-activity") !== null)
		);
	}

	// Runs after Svelte has committed this view. This proves a DOM update,
	// not that the player saw pixels or read the feedback.
	$effect(() => {
		const currentView = view;
		const currentPhase = phase;
		if (currentPhase !== "ready" && currentPhase !== "error" && currentPhase !== "loading") return;
		untrack(() => playObservation.record({ phase: "view", interaction: 0, state: currentPhase, ...observationView(currentView) }));
	});

	/** Worlds this account may enter or join, in the order they should be offered. */
	let reachable = $state<AccountGetResponse["worlds"]>([]);
	/** Seat board of the world currently being chosen from. */
	let heroes = $state<PlaySeat[]>([]);
	let claimingActor = $state<string | null>(null);
	let claimStatus = $state<string | null>(null);
	let confirmRelease = $state(false);
	let releasing = $state(false);
	let releaseError = $state<string | null>(null);
	const heldHero = $derived(mySeat(heroes));
	/** Set when the seat was claimed but the catalog could not record membership. */
	let membershipUnrecorded = $state(false);
	let showSignIn = $state(false);

	const mapHref = $derived(
		mapsOrigin === null
			? null
			: world === null
				? mapsOrigin
				: `${mapsOrigin}/?world=${encodeURIComponent(world.slug)}`,
	);
	const recapWorldName = $derived(world?.name.replace(/^The\s+/, "the ") ?? "the world");

	onMount(() => {
		let disposed = false;
		if (authConfig !== null) {
			authRenewal = startSessionRenewal({
				config: authConfig, storage: window.sessionStorage, fetch, window, document,
				onChange: (next) => {
					renewalStatus = next.status;
					if (next.session !== null) {
						session = next.session;
						return;
					}
					// An access token that lapsed while its refresh grant is still
					// renewable (a hidden tab throttled past expiry) is not a sign-out:
					// keep the last session and the open world while renewal runs
					// (sk-jay0.1.24). Only an actual sign-out shows the auth gate.
					if (next.status !== "signed-out" && session !== null) return;
					session = null;
					phase = "auth";
					status = next.status === "signed-out" ? "Sign in to continue playing." : "Reconnecting your session…";
					showSignIn = next.status === "signed-out";
				},
			});
		}
		void (authRenewal?.ready ?? Promise.resolve(session)).then(() => {
			if (!disposed && renewalStatus !== "retrying") initializeAuth();
		});
		return () => { disposed = true; authRenewal?.stop(); };
	});

	function initializeAuth(): void {
		if (session !== null) return;
		if (authConfig === null) {
			phase = "error";
			status = "Sign-in is temporarily unavailable. Return to Spellkave and try again later.";
			return;
		}

		rememberWorld(window.sessionStorage, requestedSlug);
		if (window.location.pathname === CALLBACK_PATH) {
			phase = "auth";
			status = "Finishing sign-in…";
			void completeLogin(authConfig, window.location.href, window.sessionStorage, fetch)
				.then((next) => {
					session = next;
					void authRenewal?.check();
					requestedSlug = pendingWorld(window.sessionStorage);
					window.history.replaceState(
						{},
						"",
						requestedSlug === null ? PLAY_PATH : `${PLAY_PATH}?world=${encodeURIComponent(requestedSlug)}`,
					);
				})
				.catch((cause: unknown) => {
					phase = "error";
					status = cause instanceof Error ? cause.message : String(cause);
				});
			return;
		}

		// No silent login (ADR-0161 D-9): the person signs in through the Spellkave
		// login site, one "Continue" click while its session lives.
		phase = "auth";
		status = "Sign in to enter the world.";
		showSignIn = true;
	}

	function signIn(): void {
		if (authConfig === null) return;
		void startLogin(authConfig, window.location.origin, window.sessionStorage, (url) => {
			window.location.assign(url);
		}, CALLBACK_PATH).catch((cause: unknown) => {
			phase = "error";
			status = cause instanceof Error ? cause.message : String(cause);
		});
	}

	$effect(() => {
		// Complete an in-flight action before replacing its transport. HTTP
		// consumers (account API, feedback, assets) read the current token
		// through `session`; a same-subject renewal leaves the key unchanged.
		const next = subjectKey(session);
		if (busyId === null || next === undefined) connectionSubject = next;
	});

	/** The bearer for a (re)connect: the current session token, renewed first
	 * when it has lapsed or is about to (e.g. a socket that dropped while the
	 * tab was hidden past expiry). */
	async function connectToken(): Promise<string | undefined> {
		const current = untrack(() => session);
		if (current !== null && current.expires_at - Date.now() > CONNECT_TOKEN_MARGIN_MS) {
			return current.access_token;
		}
		const renewed = authRenewal === null ? null : await authRenewal.check();
		return renewed?.access_token ?? untrack(() => session?.access_token);
	}

	$effect(() => {
		const subject = connectionSubject;
		void retry;
		clearWorldStartingTimer();
		if (subject === undefined) {
			reconnectAfterDrop = false;
			reconnecting = false;
			// This run itself calls no `start()` — the effect's cleanup above
			// (which always runs before this body) already `stop()`ed whatever
			// attempt was previously in flight. `stop()` must disable that handle
			// immediately, before its caller can know whether a later attempt
			// will supersede it, so a cancellation with nothing to supersede it
			// (e.g. a failed session renewal, or sign-out, while
			// `setContext`'s "loading" was in flight) would otherwise leave
			// "loading" with nothing after it forever (#3482 re-review of #3477
			// nit). `abandon()` is a no-op unless exactly that happened.
			connectionObserver.abandon();
			return;
		}
		// Only a dropped socket reconnects under the mounted view; a subject
		// change, world switch or explicit retry starts from the loading gate.
		const preserve = reconnectAfterDrop && untrack(() => view !== null);
		reconnectAfterDrop = false;
		let cancelled = false;
		/** Set as soon as `connectionObserver.start()` runs — BEFORE
		 * `playRumProducer.setContext(...)` (the call that actually sends the
		 * "loading" RUM action) is even awaited, so a cancellation landing
		 * inside that await still has a live handle to close through instead of
		 * leaving "loading" with nothing after it (#3482 re-review of #3477
		 * nit). Shared between the `.then()` body and the outer `.catch` below
		 * so a failure that never goes through `onError`/`onPhase` (e.g.
		 * `worldOpener` rejecting from a path that skips
		 * `OpenPlaySessionArgs.onError`, or a throw between "loading" and the
		 * `openSession` call) can still close this attempt's "loading"
		 * milestone. `null` only before `start()` runs (i.e. before this whole
		 * attempt was ever created, or if it was already cancelled by then). */
		let attempt: ConnectAttempt | null = null;
		reconnecting = preserve;
		disconnected = false;
		if (!preserve) {
			phase = "loading";
			status = "Finding your hero and the world around them…";
			view = null;
			world = null;
			moveStatus = null;
			actionLabel = null;
		}
		worldHandle?.disconnect();
		worldHandle = null;
		mapWatch = null;
		worldTick = null;
		// sk-jay0.1.1.14: `first_data` fires at most once per attempt — reset
		// alongside every other per-attempt flag above.
		let firstDataReported = false;

		void connectToken()
			.then(async (token) => {
				if (cancelled || token === undefined) return;
				const [nextAccount, worlds] = await Promise.all([
					sandbox ? Promise.resolve(sandbox.account) : accountLoader(accountApiUrl, token),
					sandbox ? Promise.resolve([sandbox.world]) : catalogLoader(catalogUrl),
				]);
				if (cancelled) return;
				// Two capability tiers, and Play needs BOTH. `world.play`/`world.oversee`
				// mean "you already belong here"; `world.join` means "you may claim a
				// hero here". Filtering to the first tier only — as Play did until
				// sk-jay0.5.1.5.1 — makes every joinable world invisible and sends a
				// seatless player to the website. Measured live: sim1 holds world.join
				// on three worlds with no seat and world.play on the one it sits in.
				const enterable = nextAccount.worlds.filter(
					(candidate) =>
						candidate.capabilities.includes("world.play") ||
						candidate.capabilities.includes("world.oversee"),
				);
				const joinable = nextAccount.worlds.filter(
					(candidate) =>
						candidate.capabilities.includes("world.join") && !enterable.includes(candidate),
				);
				reachable = [...enterable, ...joinable];
				const destination =
					reachable.find((candidate) => candidate.slug === requestedSlug) ??
					reachable.find((candidate) => candidate.slug === nextAccount.seat?.slug) ??
					reachable[0];
				if (destination === undefined) {
					phase = "empty";
					status = "No world is open to this account yet.";
					return;
				}
				// Create the attempt handle BEFORE awaiting `setContext` (the call
				// that actually sends the "loading" RUM action) rather than after —
				// BEFORE any code that can throw (e.g. `rememberWorld`'s
				// `sessionStorage.setItem`) or that can close the attempt without
				// ever calling `openSession` (`world_not_ready`, `no_seat`). Every
				// terminal branch below, including those two and the outer `.catch`,
				// closes through this same handle so "loading" never dangles no
				// matter where the attempt ends (#3482 re-review of #3477).
				// `start()` returns a handle scoped to THIS attempt: if a dropped-socket
				// reconnect or world switch starts a later attempt while this one is
				// still in flight, this handle's callbacks below become no-ops
				// instead of settling (or suppressing the `stalled` warning of) the
				// newer attempt. Creating it here (rather than after `setContext`)
				// also means a cancellation landing inside that await already has a
				// real handle for the effect cleanup below to `stop()` — see
				// `connectionObserver.abandon()` at this effect's `token ===
				// undefined` bail-out for how a `stop()`ed-but-never-superseded
				// attempt still gets its terminal (#3482 re-review of #3477 nit).
				attempt = connectionObserver.start();
				const thisAttempt = attempt;
				if (!sandbox) await playRumProducer.setContext(nextAccount.sub, destination.slug);
				if (cancelled) return;
				requestedSlug = destination.slug;
				if (!sandbox) rememberWorld(window.sessionStorage, destination.slug);
				const nextWorld = worlds.find((candidate) => candidate.slug === destination.slug) ?? null;
				if (nextWorld === null || nextWorld.db === undefined) {
					// No `openSession` attempt happens on this path either.
					thisAttempt.settle("world_not_ready");
					phase = "error";
					status = "This world is not ready for browser play yet.";
					return;
				}
				world = nextWorld;
				// One identity may hold several seats in a world (ADR-0161 D-6).
				// The account reports one; the world's seat board lists them all as
				// `mine`. The board is read only when it can change the answer: a
				// remembered selection, or no account seat in this world.
				const accountSeat =
					nextAccount.seat !== null && nextAccount.seat.slug === destination.slug
						? nextAccount.seat
						: null;
				const selected = sandbox ? null : selectedSeat(window.sessionStorage);
				const selectedHere = selected !== null && selected.slug === destination.slug;
				// `account.seats` (when the API has it and this world was readable) is
				// the held set; the board is then not needed to find `mine` rows.
				const accountHeld = sandbox ? null : heldSeatsFromAccount(nextAccount, destination.slug);
				if (!sandbox) lastAccount = nextAccount;
				let board: PlaySeat[] | null = null;
				if (!sandbox && accountHeld === null && (selectedHere || accountSeat === null)) {
					try {
						board = playSeatsFromBoard(await seatsLoader(accountApiUrl, token, destination.slug));
					} catch {
						// Unreadable board: fall back to the account's seat, or let the
						// hero chooser surface the error.
						board = null;
					}
					if (cancelled) return;
				}
				const actorId = chooseActor({
					slug: destination.slug,
					mine: accountHeld ?? (board === null ? null : board.filter((candidate) => candidate.mine)),
					selected,
					// The legacy seat names a BODY id; with seats[] the held list
					// (actor ids, newest first) already decides the default.
					accountSeat: accountHeld === null ? nextAccount.seat : null,
				});
				if (actorId === null) {
					// No `openSession` attempt happens on this path either.
					worldStartingSlug = null;
					worldStartingSince = null;
					thisAttempt.settle("no_seat");
					await showHeroes(nextWorld.name, destination.slug, token, board ?? undefined);
					return;
				}
				activeActorId = actorId;
				const seat =
					accountHeld !== null
						? ((nextAccount.seats ?? []).find(
								(held) => held.slug === destination.slug && held.actor_id === actorId,
							) ?? null)
						: accountSeat !== null && accountSeat.actor_id === actorId
							? accountSeat
							: null;
				// The world session resolves its subject by BODY id. seats[] names the
				// seat by actor id (the board's and the claim route's id) and carries
				// the body; the legacy seat already names the body (#4178).
				const sessionActorId =
					seat !== null && "body_id" in seat && seat.body_id !== "" ? String(seat.body_id) : actorId;
				if (seat?.world_paused === true || (seat === null && destination.paused === true)) {
					worldStartingSlug = null;
					worldStartingSince = null;
					thisAttempt.settle("world_paused");
					phase = "error";
					status = `${nextWorld.name} is paused by its operator. Try again after it resumes.`;
					return;
				}
				// sk-jay0.1.1.13: the seat exists but its world's npc-host has not
				// finished scheduling yet (catalog status carried additively on the
				// seat — absent means running, for callers on an older API). Do not
				// call `openSession` against it; poll the account instead of ever
				// showing the hero chooser for a seat the player already holds.
				const startingSeat = accountHeld !== null ? seat : accountSeat;
				if (startingSeat?.world_status !== undefined && startingSeat.world_status !== "running") {
					const nowMs = Date.now();
					if (worldStartingSlug !== destination.slug) {
						worldStartingSlug = destination.slug;
						worldStartingSince = nowMs;
					}
					if (nowMs - (worldStartingSince ?? nowMs) >= worldStartingMaxMs) {
						// Bounded (sk-jay0.1.1.13): an npc-host that never finishes
						// scheduling, or a catalog status stuck by a bug, must not spin
						// this tab forever. Give up polling and show the same error gate
						// (with its existing "Try again" retry) every other terminal
						// branch above uses — no `openSession` attempt happens on this
						// path either.
						worldStartingSlug = null;
						worldStartingSince = null;
						thisAttempt.settle("world_start_timeout");
						phase = "error";
						status = `${nextWorld.name} is taking longer than expected to start. Try again in a few minutes.`;
						return;
					}
					// No `openSession` attempt happens on this path either.
					thisAttempt.settle("world_starting");
					phase = "world-starting";
					status = `${nextWorld.name} is starting up. We'll open it as soon as it's ready…`;
					clearWorldStartingTimer();
					worldStartingTimer = setTimeout(() => {
						worldStartingTimer = null;
						if (!cancelled) retry += 1;
					}, worldStartingRetryMs);
					return;
				}
				// The world is running (or its status is absent, i.e. an older API):
				// clear any in-progress world-starting budget for this destination so
				// a LATER scheduling cycle for the same world starts its own fresh.
				worldStartingSlug = null;
				worldStartingSince = null;

				status = `Entering ${nextWorld.name}…`;
				const authorizedToolRoles: ToolRole[] = [];
				if (destination.capabilities.includes("world.play")) authorizedToolRoles.push("PLAYER");
				if (destination.capabilities.includes("world.oversee")) authorizedToolRoles.push("DM");
				// This path (an actual `openSession` call) closes with exactly one
				// of `connected`/`error`, with `stalled` a non-terminal warning if
				// neither has landed within CONNECT_STALLED_MS (sk-jay0.6.38.25).
				const handle = await (sandbox?.openWorld ?? worldOpener)({
					url: worldUrl,
					db: nextWorld.db,
					token,
					actorId: sessionActorId,
					authorizedToolRoles,
					onView: (nextView) => {
						if (cancelled) return;
						recordView(nextView);
						view = nextView;
						phase = "ready";
						reconnecting = false;
						disconnected = false;
						status = "";
						// sk-jay0.1.1.14: the first non-empty view after `connected`,
						// once per attempt — `ConnectAttempt.firstData()` itself also
						// guards stop()/supersession/pre-`connected` ordering, so this
						// call site only needs its own once-per-attempt latch.
						if (!firstDataReported && viewHasData(nextView)) {
							firstDataReported = true;
							thisAttempt.firstData();
						}
					},
					onWatch: (next) => {
						if (!cancelled) mapWatch = next;
					},
					onWorldTick: (tick) => {
						if (!cancelled) worldTick = tick;
					},
					onPhase: (sessionPhase, elapsedMs) => thisAttempt.onPhase(sessionPhase, elapsedMs),
					onError: (error) => {
						thisAttempt.onError(error);
						if (cancelled) return;
						console.error("[play] world session error", error);
						reconnecting = false;
						phase = "error";
						status = error.message || String(error);
					},
					onDisconnect: (error) => {
						if (cancelled) return;
						const now = Date.now();
						if (untrack(() => view !== null) && now - lastDropReconnectAt >= DROP_RECONNECT_COOLDOWN_MS) {
							// The socket dropped; reopen it with the current token under
							// the mounted view (sk-jay0.1.24).
							lastDropReconnectAt = now;
							console.warn("[play] world connection dropped; reconnecting", error);
							reconnecting = true;
							reconnectAfterDrop = true;
							retry += 1;
							return;
						}
						disconnected = true;
						reconnecting = false;
						thisAttempt.onError(error);
						console.error("[play] world session error", error);
						phase = "error";
						status = error.message || String(error);
					},
				});
				if (cancelled) {
					handle.disconnect();
					return;
				}
				worldHandle = handle;
				if (!sandbox) void refreshHeldSeats(token, () => cancelled);
				// The selected item must be read by this new, now-available handle.
				itemDetailGeneration += 1;
				occupantDetailGeneration += 1;
			})
			.catch((cause: unknown) => {
				// Close this attempt's "loading" milestone even when the failure
				// never reached `OpenPlaySessionArgs.onError` — e.g. `worldOpener`
				// rejecting from a setup step after `connect()` succeeded but before
				// any phase/error callback fired, OR a throw between `start()` and
				// `worldOpener` (e.g. `rememberWorld` hitting blocked/quota storage,
				// #3482 re-review of #3477). A no-op if no attempt was ever started
				// (the failure happened before "loading" was ever emitted) or if
				// this attempt already settled (including through `settle()`).
				attempt?.onError(cause instanceof Error ? cause : new Error(String(cause)));
				if (cancelled) return;
				// The status line is for the player; the cause is for whoever debugs.
				console.error("[play] could not open the world", cause);
				reconnecting = false;
				phase = "error";
				status = cause instanceof Error ? cause.message || String(cause) : String(cause);
			});

		return () => {
			cancelled = true;
			// Permanently disables this attempt's handle (#3482 re-review of
			// #3477): without this, a cancelled attempt that nothing has
			// superseded yet (e.g. the new destination ends in
			// `no_seat`/`world_not_ready`/`world_starting`, so no later `start()`
			// ever runs) could still record a late `connected`/`error` of its own
			// after this cleanup ran. Svelte runs this cleanup before the effect's
			// next run, so it always fires before that next attempt's own
			// "loading".
			attempt?.stop();
			clearWorldStartingTimer();
			worldHandle?.disconnect();
			worldHandle = null;
		};
	});

	/** Actor the open (or opening) world session acts for. */
	let activeActorId = $state<string | null>(null);
	type HeldSeatRow = SeatBoardSeat & { slug: string; actorId: string };
	/** Every seat this person holds across reachable worlds: `account.seats` when
	 * the API reports it, else the `mine` rows of each world's board. Presentation
	 * for "Switch hero" only; never authority. */
	let heldSeats = $state<HeldSeatRow[]>([]);
	/** Claimable rows of the current world's board, for the dialog's "Free heroes". */
	let freeHeroes = $state<PlaySeat[]>([]);
	let claimingFree = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	/** The last account answer, so the held set needs no second read at connect. */
	let lastAccount: AccountGetResponse | null = null;
	let switchOpen = $state(false);
	let pendingSwitch = $state<{ slug: string; actorId: string } | null>(null);
	const activeKey = $derived(
		requestedSlug !== null && activeActorId !== null ? seatKey(requestedSlug, activeActorId) : null,
	);
	/** Hero names seen on boards, so a held seat keeps its name between refreshes. */
	const heroNames = new Map<string, string>();

	/**
	 * Refresh the held-seat set. With `account.seats` the set is known at once
	 * (names fall back to what boards showed before) and boards are read only
	 * afterwards, for names and for the current world's free heroes; without it
	 * (older API, or a world in `seats_unread`) the board is the source.
	 * `fresh` re-reads /v1/account so a seat claimed after connect shows up.
	 */
	async function refreshHeldSeats(
		token: string,
		isCancelled: () => boolean,
		fresh = false,
	): Promise<void> {
		if (fresh) {
			try {
				lastAccount = await accountLoader(accountApiUrl, token);
			} catch {
				// Keep the previous answer.
			}
			if (isCancelled()) return;
		}
		const acct = lastAccount;
		const currentSlug = untrack(() => requestedSlug);
		const playable = untrack(() => reachable).filter(
			(candidate) =>
				candidate.capabilities.includes("world.play") || candidate.capabilities.includes("world.oversee"),
		);
		const toRow = (candidate: AccountWorldSummary, actorId: string, name?: string): HeldSeatRow => {
			const key = seatKey(candidate.slug, actorId);
			if (name !== undefined) heroNames.set(key, name);
			return {
				key,
				hero: name ?? heroNames.get(key) ?? displaySeatName({ actor_id: actorId }),
				world: candidate.display_name,
				slug: candidate.slug,
				actorId,
			};
		};
		const known = new Map<string, PlaySeat[]>();
		for (const candidate of playable) {
			const held = acct === null ? null : heldSeatsFromAccount(acct, candidate.slug);
			if (held !== null) known.set(candidate.slug, held);
		}
		if (known.size > 0) {
			// Do not wait for names: publish what the account already says.
			const previous = untrack(() => heldSeats);
			heldSeats = playable.flatMap((candidate) => {
				const held = known.get(candidate.slug);
				return held === undefined
					? previous.filter((row) => row.slug === candidate.slug)
					: held.map((row) => toRow(candidate, row.actor_id));
			});
		}
		const boards = new Map<string, PlaySeat[] | null>(
			await Promise.all(
				playable
					.filter(
						(candidate) =>
							!known.has(candidate.slug) ||
							(known.get(candidate.slug)?.length ?? 0) > 0 ||
							candidate.slug === currentSlug,
					)
					.map(async (candidate): Promise<[string, PlaySeat[] | null]> => {
						try {
							return [
								candidate.slug,
								playSeatsFromBoard(await seatsLoader(accountApiUrl, token, candidate.slug)),
							];
						} catch {
							return [candidate.slug, null];
						}
					}),
			),
		);
		if (isCancelled()) return;
		heldSeats = playable.flatMap((candidate) => {
			const board = boards.get(candidate.slug) ?? null;
			const held = known.get(candidate.slug);
			if (held !== undefined) {
				return held.map((row) =>
					toRow(candidate, row.actor_id, board?.find((b) => b.actor_id === row.actor_id)?.name),
				);
			}
			return (board ?? [])
				.filter((row) => row.mine)
				.map((row) => toRow(candidate, row.actor_id, row.name));
		});
		freeHeroes = (currentSlug === null ? null : (boards.get(currentSlug) ?? null))?.filter(seatIsClaimable) ?? [];
	}

	/** Claim another hero from the "Switch hero" dialog, then play it on the same token. */
	async function claimFromSwitchDialog(key: string): Promise<void> {
		const target = parseSeatKey(key);
		const token = session?.access_token;
		if (target === null || token === undefined || claimingFree !== null) return;
		claimingFree = target.actorId;
		switchError = null;
		try {
			const claimed = await seatClaimer(accountApiUrl, token, target.slug, target.actorId);
			membershipUnrecorded = claimed.membership_not_persisted === true;
			switchOpen = false;
			pendingSwitch = target;
		} catch (cause) {
			switchError =
				cause instanceof AccountApiError && cause.code === "seat_cap_reached"
					? SEAT_CAP_MESSAGE
					: cause instanceof Error
						? cause.message
						: String(cause);
			// A lost race or a refused claim: show who is actually left.
			if (cause instanceof AccountApiError && cause.status === 409) {
				void refreshHeldSeats(token, () => session === null, true);
			}
		} finally {
			claimingFree = null;
		}
	}

	/** The person chose a hero in the "Switch hero" view: reopen on the same token. */
	function selectHero(key: string): void {
		const target = parseSeatKey(key);
		switchOpen = false;
		if (target === null || key === activeKey) return;
		pendingSwitch = target;
	}

	// An in-flight action finishes before its transport is replaced (as for a
	// subject change above). Same world or another: the connect effect resolves
	// the destination from the remembered seat, so no new login is needed.
	$effect(() => {
		const target = pendingSwitch;
		if (target === null || busyId !== null) return;
		untrack(() => {
			pendingSwitch = null;
			rememberSeat(window.sessionStorage, target.slug, target.actorId);
			requestedSlug = target.slug;
			rememberWorld(window.sessionStorage, target.slug);
			claimStatus = null;
			confirmRelease = false;
			releaseError = null;
			reconnectAfterDrop = false;
			retry += 1;
		});
	});

	/** Show the seat board of a world this account may join but has no seat in. */
	async function showHeroes(
		worldName: string,
		slug: string,
		token: string,
		preloaded?: PlaySeat[],
	): Promise<void> {
		phase = "choose-hero";
		status = `Choose a hero to play in ${worldName}.`;
		heroes = [];
		try {
			heroes = preloaded ?? playSeatsFromBoard(await seatsLoader(accountApiUrl, token, slug));
		} catch (cause) {
			phase = "error";
			status = cause instanceof Error ? cause.message : String(cause);
			return;
		}
		// A board row marked `mine` means the account response we read was stale.
		// Say so rather than showing a hero the player cannot claim again.
		if (mySeat(heroes) !== null) {
			status = `You already hold a hero in ${worldName}.`;
			return;
		}
		if (!heroes.some(seatIsClaimable)) {
			status = `Every hero in ${worldName} is taken right now.`;
		}
	}

	/** Switch which reachable world the player is choosing from. */
	function chooseWorld(slug: string): void {
		if (slug === requestedSlug) return;
		requestedSlug = slug;
		rememberWorld(window.sessionStorage, slug);
		claimStatus = null;
		confirmRelease = false;
		releaseError = null;
		retry += 1;
	}

	async function releaseHeldHero(): Promise<void> {
		const token = session?.access_token;
		const slug = requestedSlug;
		if (token === undefined || slug === null || releasing) return;
		releasing = true;
		releaseError = null;
		try {
			await seatReleaser(accountApiUrl, token, slug);
			confirmRelease = false;
			await showHeroes(world?.name ?? "this world", slug, token);
		} catch (cause) {
			releaseError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			releasing = false;
		}
	}

	async function claim(actorId: string): Promise<void> {
		const token = session?.access_token;
		const claimSubject = subjectKey(session);
		const slug = requestedSlug;
		if (token === undefined || slug === null || claimingActor !== null) return;
		claimingActor = actorId;
		claimStatus = null;
		try {
			const claimed = await seatClaimer(accountApiUrl, token, slug, actorId);
			// A claim that could not be written to the world catalog is still a
			// claim: the seat is bound and playable (ADR-0107; the API returns 200
			// with this flag rather than failing). Let the player in and say it.
			membershipUnrecorded = claimed.membership_not_persisted === true;
			retry += 1;
		} catch (cause) {
			// A failed response does not prove the claim failed to commit (Run174).
			// Reconcile through the account contract; never repeat the write here.
			claimStatus = "Checking whether this hero is yours…";
			try {
				const current = await accountLoader(accountApiUrl, token);
				if (subjectKey(session) !== claimSubject || requestedSlug !== slug) return;
				const heldNow = heldSeatsFromAccount(current, slug);
				if (heldNow !== null) {
					// seats[] lists every held seat: the claim landed when it names it.
					// Holding other heroes is normal now, never a reason to stop.
					if (heldNow.some((held) => held.actor_id === actorId)) {
						claimStatus = null;
						retry += 1;
						return;
					}
				} else if (current.seat?.slug === slug && current.seat.actor_id === actorId) {
					claimStatus = null;
					// Normal bootstrap still owns capability and actor verification.
					retry += 1;
					return;
				} else if (current.seat !== null) {
					claimStatus = null;
					phase = "error";
					status = "Your account already holds another hero. Try again to refresh your account.";
					return;
				}
			} catch {
				if (subjectKey(session) !== claimSubject || requestedSlug !== slug) return;
				claimStatus = null;
				phase = "error";
				status = "We could not confirm whether this hero is yours. Try again to check your account before choosing a hero.";
				return;
			}
			if (!(cause instanceof AccountApiError) || cause.status >= 500 || cause.status === 408) {
				claimStatus = null;
				phase = "error";
				status = "We could not confirm whether this hero is yours. Try again to check your account before choosing a hero.";
				return;
			}
			// 409 is a lost race, not a fault. Re-read the board so the player sees
			// who is actually left instead of being stranded on a stale list.
			if (cause instanceof AccountApiError && cause.code === "seat_cap_reached") {
				claimStatus = SEAT_CAP_MESSAGE;
			} else if (cause instanceof AccountApiError && cause.status === 409) {
				claimStatus = "Someone else took that hero first.";
				await showHeroes(world?.name ?? "this world", slug, token);
			} else {
				claimStatus = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			claimingActor = null;
		}
	}

	async function move(exit: PlayExit, actionSurface: ActionSurface = "place"): Promise<void> {
		if (worldHandle === null || busyId !== null) return;
		let outcome: "returned" | "error" = "returned";
		const interaction = playObservation.begin("move", { ...observationView(view), action_surface: actionSurface, selection: Math.max(0, (view?.place?.exits.indexOf(exit) ?? -1) + 1) });
		busyId = exit.handle;
		actionLabel = exit.label;
		moveStatus = null;
		moveStatusKind = "other";
		lastRefusal = null;
		try {
			moveStatus = await worldHandle.move(exit, interaction);
			moveStatusKind = lastActStatusKind();
			lastRefusal = lastActRefusal();
		} catch (cause) {
			outcome = "error";
			moveStatus = cause instanceof Error ? cause.message : String(cause);
			moveStatusKind = "failed";
		} finally {
			busyId = null;
			await tick();
			playObservation.finish(interaction, { ...observationView(view), outcome, feedback: feedbackMounted() });
		}
	}

	async function act(
		action: PlayAction,
		utterance?: string,
		actionSurface: ActionSurface = "table",
		inputValues?: IntentInputValues,
	): Promise<boolean> {
		if (worldHandle === null || busyId !== null) return false;
		let outcome: "returned" | "error" = "returned";
		const interaction = playObservation.begin(action.slot !== undefined ? "dialog_choice" : action.acceptsUtterance ? "say" : "act", { ...observationView(view), action_surface: actionSurface, choice: action.slot, selection: Math.max(0, (view?.actions.indexOf(action) ?? -1) + 1) });
		busyId = action.id;
		actionLabel = action.label;
		moveStatus = null;
		moveStatusKind = "other";
		lastRefusal = null;
		try {
			moveStatus = await worldHandle.act(action, utterance, interaction, inputValues);
			moveStatusKind = lastActStatusKind();
			lastRefusal = lastActRefusal();
			return moveStatusKind !== "rejected";
		} catch (cause) {
			outcome = "error";
			moveStatus = cause instanceof Error ? cause.message : String(cause);
			// Play's own check stopped it before sending: "not sent", never an
			// unknown result.
			moveStatusKind = isPlayAttemptBlocked(cause) ? "blocked" : "failed";
			return false;
		} finally {
			busyId = null;
			await tick();
			playObservation.finish(interaction, { ...observationView(view), outcome, feedback: feedbackMounted() });
		}
	}

	async function endTurn(): Promise<void> {
		if (worldHandle === null || busyId !== null) return;
		let outcome: "returned" | "error" = "returned";
		const interaction = playObservation.begin("end_turn", observationView(view));
		busyId = "end-turn";
		actionLabel = "End turn";
		moveStatus = null;
		moveStatusKind = "other";
		lastRefusal = null;
		try {
			moveStatus = await worldHandle.endTurn(interaction);
			moveStatusKind = lastActStatusKind();
		} catch (cause) {
			outcome = "error";
			moveStatus = cause instanceof Error ? cause.message : String(cause);
			moveStatusKind = "failed";
		} finally {
			busyId = null;
			await tick();
			playObservation.finish(interaction, { ...observationView(view), outcome, feedback: feedbackMounted() });
		}
	}

	async function react(handle: string, rev: string, responseIntent: string): Promise<void> {
		if (worldHandle === null || busyId !== null) return;
		let outcome: "returned" | "error" = "returned";
		const interaction = playObservation.begin("react", observationView(view));
		busyId = handle;
		actionLabel = "Respond to reaction";
		moveStatus = null;
		moveStatusKind = "other";
		lastRefusal = null;
		try {
			moveStatus = await worldHandle.react(handle, rev, responseIntent, interaction);
			moveStatusKind = lastActStatusKind();
			lastRefusal = lastActRefusal();
		} catch (cause) {
			outcome = "error";
			moveStatus = cause instanceof Error ? cause.message : String(cause);
			moveStatusKind = "failed";
		} finally {
			busyId = null;
			await tick();
			playObservation.finish(interaction, { ...observationView(view), outcome, feedback: feedbackMounted() });
		}
	}

	/**
	 * Pack item selection (`spellkave_item_detail` on demand, joined to current
	 * factual candidates by `PlaySessionHandle.selectItem`) — unlike `move`/`act`/`endTurn`/
	 * `react` above, this is a read, not a world-mutating action: it neither
	 * gates on nor sets `busyId`/`moveStatus`, so picking a different pack item
	 * never disables the rest of the page. The Pack tile owns the detail or
	 * unavailable state; RUM records whether that selection reached it.
	 */
	async function selectItem(item: SelectedPackItem | null): Promise<void> {
		if (worldHandle === null) return;
		const interaction = playObservation.begin("inspect_item", { ...observationView(view), selection: item === null ? 0 : (view?.pack.findIndex((p) => p.id === item.id) ?? -1) + 1 });
		let outcome: "returned" | "error" | "unavailable" = "returned";
		try {
			await worldHandle.selectItem(item);
			if (item !== null && (view?.itemDetail?.id !== item.id || view.itemDetail.failed)) outcome = "unavailable";
		} catch {
			outcome = "error";
		} finally {
			await tick();
			playObservation.finish(interaction, { ...observationView(view), outcome });
		}
	}

	async function selectOccupant(
		occupant: { id: string; handle: string; rev: string; name: string } | null,
	): Promise<void> {
		if (worldHandle === null) return;
		await worldHandle.selectOccupant?.(occupant);
	}

	function logOut(): void {
		if (sandbox) return;
		worldHandle?.disconnect();
		playRumProducer.clearContext();
		// Clears this tab and POSTs to the login site's /logout, which ends the
		// login session for every app and returns to the website.
		endAuthSession(window.sessionStorage, authConfig ?? {}, "https://spellkave.com/");
	}

	// No masthead any more (sk-jay0.1.8.3): account, theme, sign-out and the
	// link back to the website live behind the seat seal instead. The seal
	// is not a reserved band above the mosaic, it lives at the right end of
	// PlayDock's status row (PlayTable places `sealButton`, see its `seal`
	// prop); while PlayGate is on screen it has no dock to sit in, so it
	// stays fixed top-right there instead.
	const seatName = $derived(view?.hero.name ?? session?.display_name ?? "");
	const seatInitial = $derived(seatName.trim().charAt(0).toUpperCase() || "?");
	const seatWorldName = $derived(world?.name ?? "Spellkave");
	const seatMenuReady = $derived(phase === "ready" && view !== null);

	function signOutFromSeatMenu(): void {
		logOut();
	}

	// "Reset layout" (sk-jay0.1.8.14 task a): the only way back to
	// `restLayout` after a boundary drag used to be toggling the table head
	// twice. App owns no mosaic state itself — PlayTable does — so this is a
	// plain incrementing counter, the same "please act again" shape `retry`
	// above already uses; PlayTable's own effect on `resetLayoutRequest`
	// turns each change into a reset.
	let resetLayoutRequest = $state(0);
	function resetLayoutFromSeatMenu(): void {
		resetLayoutRequest += 1;
	}

	// "Send feedback" (sk-jay0.1.14): `FeedbackDialog` is mounted OUTSIDE the
	// seat menu itself, so the menu closing on select (bits-ui's own default)
	// does not tear the dialog down before it has a chance to open — only its
	// `open` state, bound here, controls whether it shows.
	let feedbackOpen = $state(false);
	let keymapOpen = $state(false);
	function openFeedbackFromSeatMenu(): void {
		feedbackOpen = true;
	}

	function downloadRecording(): void {
		if (view === null) return;
		const recordingExport = recording.export(PLAY_RECORDING_SURFACE, {
			provenance: {
				source: sandbox ? "fixture" : "live",
				...(env.VITE_SPELLKAVE_RUM_VERSION ? { build: env.VITE_SPELLKAVE_RUM_VERSION } : {}),
			},
		});
		const blob = new Blob([JSON.stringify(recordingExport, null, 2)], { type: "application/json" });
		const href = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = href;
		link.download = `spellkave-play-${new Date(recordingExport.capturedAt).toISOString().replaceAll(":", "-")}.json`;
		link.click();
		URL.revokeObjectURL(href);
	}

	const seatMenuSections = $derived.by((): DockBarSection[] => {
		const sections: DockBarSection[] = [];
		const layout: DockBarEntry[] = [];
		if (seatMenuReady) layout.push({ id: "reset-layout", label: "Reset layout" });
		if (seatMenuReady) layout.push({ id: "keyboard-shortcuts", label: "Keyboard shortcuts" });
		if (!sandbox && seatMenuReady) {
			layout.push({ id: "download-recording", label: "Download UI recording" });
		}
		if (layout.length > 0) sections.push({ entries: layout });

		const account: DockBarEntry[] = [];
		if (!sandbox && seatMenuReady) {
			account.push({ id: "switch-hero", label: "Switch hero" });
		}
		if (!sandbox) account.push({ id: "send-feedback", label: "Send feedback" });
		if (!sandbox) account.push({ id: "sign-out", label: "Sign out" });
		if (account.length > 0) sections.push({ entries: account });

		const site: DockBarEntry[] = [];
		if (!sandbox) site.push({ id: "account", label: "Account" });
		site.push({ id: "site", label: "spellkave.com" });
		sections.push({ entries: site });

		return sections;
	});

	function onSelectSeatMenuItem(id: string): void {
		switch (id) {
			case "account":
				window.location.assign(PRODUCT_APP_URLS.account);
				break;
			case "reset-layout":
				resetLayoutFromSeatMenu();
				break;
			case "keyboard-shortcuts":
				keymapOpen = true;
				break;
			case "download-recording":
				downloadRecording();
				break;
			case "switch-hero": {
				switchOpen = true;
				switchError = null;
				// A seat claimed after connect must show up; the previous list stays
				// visible until the refreshed one replaces it.
				const token = session?.access_token;
				if (token !== undefined && token !== "") {
					void refreshHeldSeats(token, () => session === null, true);
				}
				break;
			}
			case "send-feedback":
				openFeedbackFromSeatMenu();
				break;
			case "sign-out":
				signOutFromSeatMenu();
				break;
			case "site":
				window.location.assign("https://spellkave.com");
				break;
		}
	}
</script>

{#snippet sealMenuHeader()}
	<div class="seat-menu__who">
		<p class="seat-menu__name sk-display">{seatName || "Player"}</p>
		<p class="seat-menu__world">{seatWorldName}</p>
	</div>
	<div class="seat-menu__theme">
		<ThemeSwitcher compact />
	</div>
{/snippet}

{#snippet sealTrigger()}
	<div class="seat-seal-cluster">
		<span class="seat-seal" aria-hidden="true">{seatInitial}</span>
	</div>
{/snippet}

{#snippet sealButton()}
	{#if worldTick !== null || gameStatus !== "running"}<DockTick tick={worldTick} state={gameStatus} runningText={worldTick === null ? undefined : String(worldTick)} connection={disconnected ? "Disconnected" : reconnecting ? "Reconnecting" : "Connected"} action={actionLabel ?? "No action sent."} />{/if}
	<DockBarMenu
		trigger={sealTrigger}
		accessibleLabel={`${seatName || "Player"}, seat menu`}
		header={sealMenuHeader}
		sections={seatMenuSections}
		onSelect={onSelectSeatMenuItem}
		side={seatMenuReady ? "top" : "bottom"}
	/>
{/snippet}

<svelte:head>
	<title>{world ? `${world.name} · Play · Spellkave` : "Play · Spellkave"}</title>
</svelte:head>

<main
	class="play-shell"
	style={`--woven-midnight: url(${wovenTextureUrls.midnight}); --woven-paper: url(${wovenTextureUrls.paper});`}
>
	<h1 class="sr-only">{world ? `${world.name} Play` : "Spellkave Play"}</h1>
	{#if session !== null}
		{#if phase !== "ready" || view === null}
			<!-- PlayGate has no dock to place the seal in — same fixed
			     top-right spot the seal always used before the shell. It
			     also has no ancestor DockBar, so wrap the seal in one here
			     purely for the Menubar context. -->
			<div class="seat-seal-gate">
				<DockBar>{@render sealButton()}</DockBar>
			</div>
		{/if}
		{#if !sandbox}<FeedbackDialog bind:open={feedbackOpen} gatewayOrigin={feedbackGatewayOrigin} accessToken={session?.access_token ?? ""} />{/if}
		<KeymapDialog bind:open={keymapOpen} />
		{#if !sandbox}
			<SwitchHeroDialog
				bind:open={switchOpen}
				seats={heldSeats}
				{activeKey}
				onSelect={selectHero}
				freeSeats={freeHeroes.map((row) => ({
					key: seatKey(requestedSlug ?? "", row.actor_id),
					hero: row.name,
					world: world?.name ?? "this world",
				}))}
				worldName={world?.name ?? "this world"}
				claiming={claimingFree !== null}
				error={switchError}
				onClaim={(key) => void claimFromSwitchDialog(key)}
			/>
		{/if}
	{/if}

	{#if phase !== "ready" || view === null}
		<PlayGate
			{phase}
			{status}
			{showSignIn}
			{reachable}
			{requestedSlug}
			{claimingActor}
			{releasing}
			{heldHero}
			bind:confirmRelease
			{releaseError}
			{heroes}
			{claimStatus}
			worldName={world?.name ?? "this world"}
			signedIn={session !== null}
			onSignIn={signIn}
			onChooseWorld={chooseWorld}
			onRelease={() => void releaseHeldHero()}
			onClaim={(actorId) => void claim(actorId)}
			onRetry={() => { if (session === null) void authRenewal?.check(); else retry += 1; }}
		/>
	{:else}
		<h2 class="sr-only">Current world</h2>
		{#if membershipUnrecorded}
			<p class="membership-note" role="status">
				Your hero is yours and this world is open to you. Your membership was not
				written to the world catalog, so it may not appear in lists elsewhere yet.
			</p>
		{/if}
		<PlayTable
			{view}
			busy={busyId !== null || reconnecting}
			busyActionId={busyId}
			status={moveStatus}
			statusKind={moveStatusKind}
			{reconnecting}
			statusMessage={connectionMessage}
			refusal={lastRefusal}
			{recapWorldName}
			{mapHref}
			{gatewayOrigin}
			slug={world?.slug ?? ""}
			token={session?.access_token ?? ""}
			mapWatch={mapWatch}
			seal={session !== null ? sealButton : undefined}
			{dockExtras}
			{resetLayoutRequest}
			initialLayout={sandbox?.presentation?.layout}
			initialLayoutMobile={sandbox?.presentation?.mobile}
			onLayoutChange={recordLayout}
			onAct={act}
			onMove={move}
			onEndTurn={endTurn}
			onReact={react}
			{itemDetailGeneration}
			{occupantDetailGeneration}
			onSelectItem={selectItem}
			onSelectOccupant={selectOccupant}
			onSelectOperation={async (id, cursor) => { await worldHandle?.selectOperation?.(id, cursor); }}
		/>
	{/if}
</main>
