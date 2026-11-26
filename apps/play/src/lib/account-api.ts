export const DEFAULT_ACCOUNT_API_URL = "https://api.spellkave.com";

export interface AccountWorldSummary {
	slug: string;
	display_name: string;
	role: "owner" | "member" | "open";
	capabilities: string[];
	/** Desired runtime state; absent on API versions before intentional-idle support. */
	paused?: boolean;
}

export interface AccountGetResponse {
	sub: string;
	capabilities: string[];
	worlds: AccountWorldSummary[];
	seat: AccountSeat | null;
	/**
	 * Every held seat, additive (sk-jay0.5.14.5.19): an API built before it omits
	 * the field, so a missing list is "unknown", never "none".
	 */
	seats?: AccountHeldSeat[];
	/** Worlds whose seats could not be read for this answer; `seats` may miss seats there. */
	seats_unread?: string[];
}

/** One entry of `seats[]`. `actor_id` is the ACTOR id the seat board and claim routes use. */
export interface AccountHeldSeat {
	slug: string;
	actor_id: string;
	body_id: string;
	role: string;
	world_status?: string;
	world_paused?: boolean;
}

/** Catalog status of the seat's world, additive (sk-jay0.1.1.13): absent
 * from a server that predates it, which Play treats as "running". */
export interface AccountSeat {
	slug: string;
	actor_id: string;
	role: string;
	world_status?: string;
	/** An intentionally paused world is not a world still starting. */
	world_paused?: boolean;
}

/** One row of GET /v1/worlds/{slug}/seats. */
export interface SeatBoardRow {
	actor_id: string | number;
	name?: string | null;
	claimed?: boolean;
	mine?: boolean;
}

/**
 * POST claim succeeds with the seat. `membership_not_persisted` is a SUCCESS
 * flag, not an error: the seat is claimed and playable, but the world catalog
 * could not record membership (control plane read-only). The player may enter.
 * See packages/spellkave-api/src/service.ts — the claim runs in its own
 * try/catch and catalog persistence can no longer fail it.
 */
export interface ClaimSeatResponse {
	seat: AccountSeat;
	membership_not_persisted?: true;
}

/** Carries the HTTP status so the caller can tell a lost race from a real fault. */
export class AccountApiError extends Error {
	readonly status: number;
	/** The API's machine-readable `error` (e.g. `seat_cap_reached`), when it sent one. */
	readonly code: string | null;
	constructor(message: string, status: number, code: string | null = null) {
		super(message);
		this.name = "AccountApiError";
		this.status = status;
		this.code = code;
	}
}

/**
 * Reject a response that is not JSON before parsing it.
 *
 * Play reaches the Account API through its own Worker proxy, whose allowlist
 * answers unproxied paths with the SPA shell — `200 text/html`. Parsing that as
 * JSON throws a raw DOMException ("The string did not match the expected
 * pattern." in Safari), which reached a player as an unreadable error on
 * 2026-08-26. A missing proxy route is an operator-facing defect and must say
 * so, not surface as a browser internal.
 */
async function readJson<T>(response: Response, what: string): Promise<T> {
	const type = response.headers.get("content-type") ?? "";
	if (!type.includes("json")) {
		throw new AccountApiError(
			`${what} did not answer as JSON (got ${type || "no content-type"}). This usually means the request never reached the Spellkave API.`,
			response.status,
		);
	}
	return (await response.json()) as T;
}

async function readError(response: Response, fallback: string): Promise<AccountApiError> {
	let description = "";
	let code: string | null = null;
	try {
		const body = (await response.json()) as { error?: unknown; error_description?: unknown };
		if (typeof body.error_description === "string") description = body.error_description.trim();
		if (typeof body.error === "string" && body.error !== "") code = body.error;
	} catch {
		// Non-JSON body: the status alone has to carry the meaning.
	}
	return new AccountApiError(description === "" ? fallback : description, response.status, code);
}

export function readAccountApiUrl(
	env: Record<string, string | undefined>,
	playOrigin = "https://play.spellkave.com",
): string {
	const raw = env.VITE_SPELLKAVE_API_URL?.trim() ?? "";
	if (raw === "") return `${playOrigin.replace(/\/+$/, "")}/api`;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
			return DEFAULT_ACCOUNT_API_URL;
		}
		return raw.replace(/\/+$/, "");
	} catch {
		return DEFAULT_ACCOUNT_API_URL;
	}
}

export async function fetchAccount(
	baseUrl: string,
	token: string,
	fetchImpl: typeof fetch = fetch,
): Promise<AccountGetResponse> {
	const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/v1/account`, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
	});
	if (!response.ok)
		throw new Error(`Your Spellkave account is unavailable (HTTP ${response.status}).`);
	return readJson<AccountGetResponse>(response, "Your account");
}

/** Seat board for one world. Requires only that the account may see the world. */
export async function fetchSeats(
	baseUrl: string,
	token: string,
	slug: string,
	fetchImpl: typeof fetch = fetch,
): Promise<SeatBoardRow[]> {
	const response = await fetchImpl(
		`${baseUrl.replace(/\/+$/, "")}/v1/worlds/${encodeURIComponent(slug)}/seats`,
		{ headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
	);
	if (!response.ok) throw await readError(response, "The heroes of this world are unavailable.");
	return readJson<SeatBoardRow[]>(response, "The hero roster");
}

/**
 * Claim a hero. 409 means someone took the seat first — that is a lost race, not
 * a fault, and the caller should re-read the board rather than strand the player.
 */
export async function claimSeat(
	baseUrl: string,
	token: string,
	slug: string,
	actorId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ClaimSeatResponse> {
	const response = await fetchImpl(
		`${baseUrl.replace(/\/+$/, "")}/v1/worlds/${encodeURIComponent(slug)}/seats/${encodeURIComponent(actorId)}/claim`,
		{ method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
	);
	if (!response.ok) throw await readError(response, "This hero could not be claimed.");
	return readJson<ClaimSeatResponse>(response, "The claim");
}

/** Give up the hero this account currently holds in the world. */
export async function releaseSeat(
	baseUrl: string,
	token: string,
	slug: string,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	const response = await fetchImpl(
		`${baseUrl.replace(/\/+$/, "")}/v1/worlds/${encodeURIComponent(slug)}/seats/release`,
		{ method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
	);
	if (!response.ok) throw await readError(response, "This hero could not be released.");
	await readJson<{ ok: true }>(response, "The release");
}
