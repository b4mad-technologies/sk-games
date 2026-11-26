interface Env {
	ASSETS: { fetch(request: Request): Promise<Response> };
	ACCOUNT_API_ORIGIN: string;
}

const API_PREFIX = "/api";

/**
 * Every Account API path Play is allowed to reach, and the method it may use.
 *
 * This is an ALLOWLIST, not a prefix rewrite. A path missing from here does not
 * fail loudly — `assetRequest` matches every other path next and the SPA
 * fallback answers `200 text/html`, so the caller gets an HTML page where it
 * expected JSON. That is exactly how the seat board shipped broken on
 * 2026-08-26: the join path was added without a proxy entry, `response.ok`
 * was true, and `response.json()` threw a DOMException the player saw as "The
 * way into this world is closed".
 *
 * ADDING AN API CALL TO PLAY MEANS ADDING ITS PATH HERE, IN THE SAME CHANGE.
 */
const PROXY_ROUTES: { method: string; pattern: RegExp }[] = [
	{ method: "GET", pattern: /^\/v1\/account$/ },
	{ method: "GET", pattern: /^\/v1\/worlds\/[^/]+\/seats$/ },
	{ method: "POST", pattern: /^\/v1\/worlds\/[^/]+\/seats\/[^/]+\/claim$/ },
	{ method: "POST", pattern: /^\/v1\/worlds\/[^/]+\/seats\/release$/ },
];

/**
 * Map a browser request onto the Account API, or null when it is not proxied.
 *
 * The Worker is a transport, never a principal (ADR-0110 D-2): it forwards the
 * caller's Authorization header unchanged and holds no credential of its own.
 */
export function accountApiRequest(request: Request, origin: string): Request | null {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(`${API_PREFIX}/`)) return null;
	const apiPath = url.pathname.slice(API_PREFIX.length);
	const allowed = PROXY_ROUTES.some(
		(route) => route.method === request.method && route.pattern.test(apiPath),
	);
	if (!allowed) return null;
	return new Request(new URL(apiPath, `${origin.replace(/\/+$/, "")}/`), {
		method: request.method,
		headers: {
			authorization: request.headers.get("authorization") ?? "",
			accept: "application/json",
		},
	});
}

export function assetRequest(request: Request): Request | null {
	const url = new URL(request.url);
	if (request.method !== "GET" && request.method !== "HEAD") return null;
	// An unproxied API path must never fall through to the SPA shell: answering
	// 200 text/html to a JSON caller is what made the failure unreadable before.
	if (url.pathname.startsWith(`${API_PREFIX}/`) || url.pathname === API_PREFIX) return null;
	return new Request(url, { method: request.method, headers: request.headers });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const accountRequest = accountApiRequest(request, env.ACCOUNT_API_ORIGIN);
		if (accountRequest !== null) return fetch(accountRequest);
		const rewritten = assetRequest(request);
		if (rewritten === null) return new Response(null, { status: 404 });
		return env.ASSETS.fetch(rewritten);
	},
};
