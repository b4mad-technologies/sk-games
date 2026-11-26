/**
 * Browser Account API client for Maps. Unlike Play, Maps is a static SPA
 * (no Worker proxy), so this talks to the API origin directly.
 */

export const DEFAULT_ACCOUNT_API_URL = "https://api.spellkave.com";

export interface AccountWorldSummary {
	slug: string;
	display_name: string;
	role: "owner" | "member" | "open";
	capabilities: string[];
}

export interface AccountGetResponse {
	sub: string;
	capabilities: string[];
	worlds: AccountWorldSummary[];
	seat: { slug: string; actor_id: string; role: string } | null;
}

export class AccountApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "AccountApiError";
		this.status = status;
	}
}

async function readJson<T>(response: Response, what: string): Promise<T> {
	const type = response.headers.get("content-type") ?? "";
	if (!type.includes("json")) {
		throw new AccountApiError(
			`${what} did not answer as JSON (got ${type || "no content-type"}).`,
			response.status,
		);
	}
	return (await response.json()) as T;
}

export function readAccountApiUrl(env: Record<string, string | undefined>): string {
	const raw = env.VITE_SPELLKAVE_API_URL?.trim() ?? "";
	if (raw === "") return DEFAULT_ACCOUNT_API_URL;
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

export function worldIsReachable(capabilities: readonly string[]): boolean {
	return (
		capabilities.includes("world.play") ||
		capabilities.includes("world.oversee") ||
		capabilities.includes("world.join")
	);
}

export async function fetchAccount(
	baseUrl: string,
	token: string,
	fetchImpl: typeof fetch = fetch,
): Promise<AccountGetResponse> {
	const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/v1/account`, {
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
	});
	if (!response.ok) {
		throw new AccountApiError(
			`Your Spellkave account is unavailable (HTTP ${response.status}).`,
			response.status,
		);
	}
	return readJson<AccountGetResponse>(response, "Your account");
}
