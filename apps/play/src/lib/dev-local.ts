/**
 * DEV-only local play against a `just play-stage` node.
 *
 * `apps/play` is a pure cloud client: without WorkOS config it fails closed
 * ("The way into this world is closed"), and with it the Account API resolves
 * HOSTED worlds — never a node on 127.0.0.1. That left the shipped surface
 * unplayable on a developer's machine, so nobody could click through a beat
 * they had just staged.
 *
 * `apps/maps` already solved the same problem with a DEV-only token file. This
 * is the Play equivalent, with one difference: the single knob is the profile
 * TOML that `just play-stage` already writes, so url, db, actor and credential
 * come from one generated file instead of four hand-copied env vars.
 *
 * Everything here is inert in a production build: `vite.config.ts` only defines
 * `__SPELLKAVE_DEV_LOCAL__` when mode !== "production" AND the profile resolves,
 * and `main.ts` only consults it under `import.meta.env.DEV`.
 *
 * It replaces authentication and the Account API — NOT the world. The real
 * `openPlaySession`, the real SDK session and the real reducers still do the work,
 * which is the whole point: what you click here is what a hosted player clicks.
 */

import type { AccountGetResponse, ClaimSeatResponse, SeatBoardRow } from "./account-api";
import { type OpenPlaySessionArgs, openPlaySession, type PlaySessionHandle } from "./play-session";
import type { CatalogWorld } from "./world-catalog";

/** Resolved by `vite.config.ts` from a `just play-stage` profile. */
export interface DevLocalConfig {
	/** SpacetimeDB HTTP origin of the local node, e.g. http://127.0.0.1:7883 */
	url: string;
	/** Module name, e.g. spellkave-dev */
	db: string;
	/** The staged hero's in-world entity id, e.g. "1" */
	actorId: string;
	/** Credential minted and actor-claimed by play-stage. */
	token: string;
	/** Adventure slug, used as the world slug the app thinks it entered. */
	slug: string;
	/** What the header shows instead of a hosted world name. */
	displayName: string;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Validate what vite injected. A half-filled config is a rig bug and must read
 * as "no local play" rather than as a session that fails deep inside the SDK.
 */
export function parseDevLocalConfig(raw: unknown): DevLocalConfig | null {
	if (typeof raw !== "string" || raw.trim() === "" || raw.trim() === "null") return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const url = nonEmptyString(record.url);
	const db = nonEmptyString(record.db);
	const actorId = nonEmptyString(record.actorId);
	const token = nonEmptyString(record.token);
	const slug = nonEmptyString(record.slug);
	if (url === null || db === null || actorId === null || token === null || slug === null) {
		return null;
	}
	return {
		url,
		db,
		actorId,
		token,
		slug,
		displayName: nonEmptyString(record.displayName) ?? slug,
	};
}

/**
 * The session the app would have received from WorkOS. `access_token` is the
 * node credential, so the token that reaches SpacetimeDB is the real one the
 * staged seat was claimed with.
 */
export function devLocalSession(config: DevLocalConfig): {
	access_token: string;
	id_token: string;
	expires_at: number;
	display_name: string;
} {
	return {
		access_token: config.token,
		id_token: "",
		// MILLISECONDS since the epoch, matching `completeLogin` — `readSession`
		// compares this against `Date.now()`, so a seconds-shaped value reads as
		// expired and the app silently clears the session and fails closed.
		expires_at: Date.now() + 86_400_000,
		display_name: `${config.displayName} (local)`,
	};
}

/**
 * The `App.svelte` props that stand in for auth and the Account API. The world
 * opener is the REAL one — only its connection target is forced onto the local
 * node, because `readWorldUrl` would otherwise resolve the vite dev origin.
 */
export function devLocalProps(config: DevLocalConfig): {
	accountLoader: () => Promise<AccountGetResponse>;
	catalogLoader: () => Promise<CatalogWorld[]>;
	seatsLoader: () => Promise<SeatBoardRow[]>;
	seatClaimer: () => Promise<ClaimSeatResponse>;
	worldOpener: (args: OpenPlaySessionArgs) => Promise<PlaySessionHandle>;
} {
	const seat = { slug: config.slug, actor_id: config.actorId, role: "player" };
	return {
		accountLoader: () =>
			Promise.resolve({
				sub: `local:${config.actorId}`,
				capabilities: ["world.play"],
				worlds: [
					{
						slug: config.slug,
						display_name: config.displayName,
						role: "owner" as const,
						capabilities: ["world.play"],
					},
				],
				seat,
			}),
		catalogLoader: () =>
			Promise.resolve([{ slug: config.slug, name: config.displayName, db: config.db }]),
		// The seat is already claimed by play-stage, so the board is never shown.
		// These stay defined so a slug typo lands on an honest empty board rather
		// than an unhandled rejection.
		seatsLoader: () => Promise.resolve([{ actor_id: config.actorId, claimed: true, mine: true }]),
		seatClaimer: () => Promise.resolve({ seat }),
		worldOpener: (args) =>
			openPlaySession({ ...args, url: config.url, db: config.db, token: config.token }),
	};
}
