/**
 * Hosted-browser RUM producer (sk-jay0.6.40).
 *
 * The OpenObserve client token is intentionally public: it is a RUM token,
 * not an OTLP ingest or OpenObserve service credential. The surrounding
 * boundary is therefore defense in depth: production config or an explicit
 * private local diagnostic mode,
 * tracking consent withheld until a pseudonymous account context exists,
 * fixed sampling/privacy settings, a closed trail projection, and the
 * Cloudflare origin/rate-limit rules in `infra/cloudflare/telemetry.ts`.
 */

import localRumConfig from "virtual:spellkave-local-rum";
import type { RumInitConfiguration } from "@openobserve/browser-rum-slim";
import type { LocalRumConfig } from "./local-rum-config";
import { type PlayObservation, playObservation, projectObservation } from "./play-observation";
import { mapTrailEntryToEmit, projectPlayEventData } from "./play-telemetry";
import type { PlayTrailEntry } from "./play-trail";

export const PLAY_RUM_SITE = "telemetry.spellkave.com";
export const PLAY_RUM_ORGANIZATION = "default";
export const PLAY_RUM_SERVICE = "spellkave-play";
/**
 * Default production session sample rate (percent). Beta samples every
 * session (operator decision 2026-09-15, sk-jay0.6.38.24); a deployment lowers
 * it through `VITE_SPELLKAVE_RUM_SESSION_SAMPLE_RATE` without a code change.
 */
export const PLAY_RUM_SESSION_SAMPLE_RATE = 100;

export interface PlayRumConfig {
	enabled: boolean;
	applicationId: string;
	clientToken: string;
	version: string;
	sessionSampleRate: number;
	local?: LocalRumConfig;
}

/** What a feedback report needs to find this page's RUM rows again. */
export interface PlayRumDiagnostics {
	/** The `spellkave_run` id of the current player/world context, if any. */
	runId?: string;
	/** True only when the SDK tracks this session (sampled and consented). */
	sampled: boolean;
}

interface RumSdk {
	init(config: RumInitConfiguration): void;
	addAction(name: string, context?: object): void;
	setUser(user: { id: string }): void;
	clearUser(): void;
	setGlobalContextProperty(key: string, value: unknown): void;
	removeGlobalContextProperty(key: string): void;
	setTrackingConsent(consent: "granted" | "not-granted"): void;
	getInternalContext(): { session_id?: string } | undefined;
}

/** The SDK's `contract_shape_mismatch` diagnostic fields Play forwards. */
export interface PlayContractShapeMismatch {
	readonly shape_item: string;
	readonly shape_detail: string;
	readonly shape_database: string;
	readonly client_epoch: number;
}

export interface PlayRumProducer {
	initialize(): void;
	setContext(subject: string, worldSlug: string): Promise<void>;
	clearContext(): void;
	record(entry: PlayTrailEntry): void;
	observe?(event: PlayObservation): void;
	/** One `play_contract_shape_mismatch` RUM action per world-module shape the
	 * SDK connected past in "warn" mode (sk-jay0.7.389.3). Schema names only. */
	contractShapeMismatch?(fields: PlayContractShapeMismatch): void;
	diagnostics(): PlayRumDiagnostics;
}

/** Empty or invalid input falls back to the default; valid range is 0–100. */
export function readPlayRumSessionSampleRate(value: string | undefined): number {
	const trimmed = value?.trim() ?? "";
	if (trimmed === "") return PLAY_RUM_SESSION_SAMPLE_RATE;
	const rate = Number(trimmed);
	return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : PLAY_RUM_SESSION_SAMPLE_RATE;
}

/** RUM never runs in dev-local or tests. Missing build inputs fail closed. */
export function readPlayRumConfig(
	env: Record<string, string | undefined>,
	production: boolean,
): PlayRumConfig {
	const sessionSampleRate = readPlayRumSessionSampleRate(
		env.VITE_SPELLKAVE_RUM_SESSION_SAMPLE_RATE,
	);
	if (!production) {
		return { enabled: false, applicationId: "", clientToken: "", version: "", sessionSampleRate };
	}
	const applicationId = env.VITE_SPELLKAVE_RUM_APPLICATION_ID?.trim() ?? "";
	const clientToken = env.VITE_SPELLKAVE_RUM_CLIENT_TOKEN?.trim() ?? "";
	const version = env.VITE_SPELLKAVE_RUM_VERSION?.trim() ?? "";
	return {
		enabled: applicationId !== "" && clientToken !== "" && version !== "",
		applicationId,
		clientToken,
		version,
		sessionSampleRate,
	};
}

/** Same stable SHA-256 prefix used by the server-side player telemetry. */
export async function hashRumSubject(
	subject: string,
	subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<string | null> {
	if (subject === "" || subtle === undefined) return null;
	const bytes = new TextEncoder().encode(subject);
	const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
	return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface MutableRumEvent {
	type?: string;
	view?: { url?: string; referrer?: string };
}

function withoutQueryOrFragment(value: string): string {
	try {
		const url = new URL(value);
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return "[redacted-url]";
	}
}

/**
 * The Trail already captures handled tool failures without their message.
 * Drop automatic SDK error/resource rows, and remove URL query/fragment data
 * from the remaining view/action rows before they leave the browser.
 */
export function filterPlayRumEvent(event: MutableRumEvent): boolean {
	if (event.type === "error" || event.type === "resource") return false;
	if (event.view?.url !== undefined) event.view.url = withoutQueryOrFragment(event.view.url);
	if (event.view?.referrer !== undefined) {
		event.view.referrer = withoutQueryOrFragment(event.view.referrer);
	}
	return true;
}

const WORLD_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export interface PlayRumAction {
	name: string;
	context: Record<string, string | number | boolean>;
}

/** Closed custom-action projection. No words, observations, error messages, or raw subject. */
export function playRumAction(entry: PlayTrailEntry, worldSlug: string): PlayRumAction | null {
	if (!WORLD_SLUG_PATTERN.test(worldSlug)) return null;
	const mapped = mapTrailEntryToEmit(entry, worldSlug);
	const data = projectPlayEventData(mapped.data);
	const toolName = typeof data.tool_name === "string" ? data.tool_name : `play_${entry.kind}`;
	const outcome =
		typeof data.outcome === "string" ? data.outcome : data.is_error === true ? "error" : "observed";
	const durationMs = typeof data.duration_ms === "number" ? data.duration_ms : 0;
	const context: Record<string, string | number | boolean> = {
		spellkave_world_slug: worldSlug,
		spellkave_tool_name: toolName,
		spellkave_outcome: outcome,
		spellkave_duration_ms: durationMs,
	};
	for (const key of ["client_kind", "tile", "level", "trigger"] as const) {
		const value = data[key];
		if (typeof value === "string") context[`spellkave_${key}`] = value;
	}
	return { name: `play_${entry.kind}`, context };
}

export function createPlayRumProducer(
	config: PlayRumConfig,
	sdk: RumSdk,
	subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): PlayRumProducer {
	let initialized = false;
	let contextReady = false;
	let contextVersion = 0;
	// Comparison only, held in memory; never forwarded to the SDK or storage.
	let activeSubject: string | null = null;
	let activeWorld: string | null = null;
	let worldSlug = "";
	let run = "";
	let sequence = 0;
	function emit(name: string, context: Record<string, string | number | boolean>) {
		if (!initialized || !contextReady) return;
		sdk.addAction(name, {
			...context,
			spellkave_world_slug: worldSlug,
			spellkave_run: run,
			spellkave_sequence: ++sequence,
			spellkave_observed_at_ms: Date.now(),
			spellkave_schema: 1,
		});
	}

	return {
		initialize() {
			if (!config.enabled || initialized) return;
			sdk.init({
				applicationId: config.applicationId,
				clientToken: config.clientToken,
				site: PLAY_RUM_SITE,
				organizationIdentifier: PLAY_RUM_ORGANIZATION,
				service: PLAY_RUM_SERVICE,
				env: config.local?.environment ?? "production",
				version: config.version,
				sessionSampleRate: config.local ? 100 : config.sessionSampleRate,
				...(config.local
					? {
							proxy: ({ parameters }: { parameters: string }) => `/__rum?${parameters}`,
							compressIntakeRequests: false,
						}
					: {}),
				sessionReplaySampleRate: 0,
				profilingSampleRate: 0,
				traceSampleRate: 0,
				telemetrySampleRate: 0,
				defaultPrivacyLevel: "mask-user-input",
				trackUserInteractions: false,
				trackResources: false,
				trackLongTasks: true,
				trackAnonymousUser: false,
				sessionPersistence: "memory",
				storeContextsAcrossPages: false,
				startSessionReplayRecordingManually: true,
				enablePrivacyForActionName: true,
				trackingConsent: "not-granted",
				beforeSend: filterPlayRumEvent,
			});
			initialized = true;
		},
		async setContext(subject, nextWorldSlug) {
			if (!initialized) return;
			if (contextReady && activeSubject === subject && activeWorld === nextWorldSlug) {
				// Token renewal replaces the transport, not the player/world context.
				// Keep the existing sampled SDK session and correlate the reconnect.
				emit("play_connection", {
					spellkave_phase: "connection",
					spellkave_state: "loading",
					spellkave_interaction: 0,
				});
				return;
			}
			const nextContextVersion = ++contextVersion;
			contextReady = false;
			activeSubject = null;
			activeWorld = null;
			worldSlug = "";
			sdk.setTrackingConsent("not-granted");
			sdk.clearUser();
			sdk.removeGlobalContextProperty("spellkave_world_slug");
			if (!WORLD_SLUG_PATTERN.test(nextWorldSlug)) return;
			try {
				const subjectPrefix = await hashRumSubject(subject, subtle);
				if (subjectPrefix === null || contextVersion !== nextContextVersion) return;
				worldSlug = nextWorldSlug;
				worldSlug = config.local?.worldSlug ?? worldSlug;
				run = crypto.randomUUID();
				sequence = 0;
				sdk.setUser({ id: subjectPrefix });
				sdk.setGlobalContextProperty("spellkave_world_slug", worldSlug);
				sdk.setTrackingConsent("granted");
				activeSubject = subject;
				activeWorld = nextWorldSlug;
				contextReady = true;
				emit("play_connection", {
					spellkave_phase: "connection",
					spellkave_state: "loading",
					spellkave_interaction: 0,
				});
			} catch {
				// Telemetry must never block play; consent remains withheld on failure.
			}
		},
		clearContext() {
			if (!initialized) return;
			contextVersion += 1;
			contextReady = false;
			activeSubject = null;
			activeWorld = null;
			worldSlug = "";
			sdk.setTrackingConsent("not-granted");
			sdk.clearUser();
			sdk.removeGlobalContextProperty("spellkave_world_slug");
		},
		contractShapeMismatch(fields) {
			emit("play_contract_shape_mismatch", {
				spellkave_shape_mode: "warn",
				spellkave_shape_item: fields.shape_item.slice(0, 200),
				spellkave_shape_detail: fields.shape_detail.slice(0, 400),
				spellkave_shape_database: fields.shape_database.slice(0, 100),
				spellkave_client_epoch: fields.client_epoch,
			});
		},
		record(entry) {
			if (!initialized || !contextReady) return;
			const action = playRumAction(entry, worldSlug);
			if (action !== null)
				emit(action.name, {
					...action.context,
					spellkave_tick: entry.tick,
					spellkave_trail_sequence: entry.id,
				});
		},
		observe(event) {
			emit(`play_${event.phase}`, projectObservation(event));
		},
		diagnostics() {
			if (!initialized || !contextReady) return { sampled: false };
			let sampled = false;
			try {
				sampled = sdk.getInternalContext()?.session_id !== undefined;
			} catch {
				// Diagnostics must never block feedback; report "not sampled".
			}
			return { runId: run, sampled };
		},
	};
}

const playRumConfig = readPlayRumConfig(
	import.meta.env as Record<string, string | undefined>,
	import.meta.env.PROD,
);
if (localRumConfig !== null && !import.meta.env.PROD) {
	Object.assign(playRumConfig, localRumConfig, { enabled: true, local: localRumConfig });
}

let loadedPlayRumProducer: PlayRumProducer | null = null;
let playRumLoad: Promise<PlayRumProducer | null> | null = null;

async function loadPlayRumProducer(): Promise<PlayRumProducer | null> {
	if (!playRumConfig.enabled) return null;
	if (loadedPlayRumProducer !== null) return loadedPlayRumProducer;
	playRumLoad ??= import("@openobserve/browser-rum-slim")
		.then(({ openobserveRum }) => {
			const producer = createPlayRumProducer(playRumConfig, openobserveRum);
			producer.initialize();
			loadedPlayRumProducer = producer;
			playObservation.subscribe((event) => producer.observe?.(event));
			return producer;
		})
		.catch(() => null);
	return playRumLoad;
}

/** Load the SDK asynchronously so it cannot hold up Play's first paint. */
export const playRumProducer: PlayRumProducer = {
	initialize() {
		void loadPlayRumProducer();
	},
	async setContext(subject, worldSlug) {
		await (await loadPlayRumProducer())?.setContext(subject, worldSlug);
	},
	clearContext() {
		if (loadedPlayRumProducer !== null) {
			loadedPlayRumProducer.clearContext();
			return;
		}
		void playRumLoad?.then((producer) => producer?.clearContext());
	},
	record(entry) {
		loadedPlayRumProducer?.record(entry);
	},
	contractShapeMismatch(fields) {
		loadedPlayRumProducer?.contractShapeMismatch?.(fields);
	},
	diagnostics() {
		return loadedPlayRumProducer?.diagnostics() ?? { sampled: false };
	},
};
