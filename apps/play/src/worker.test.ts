import { describe, expect, it, vi } from "vitest";

import worker, { accountApiRequest, assetRequest } from "./worker";

describe("play asset worker", () => {
	it("serves the SPA and static assets at their real root paths", () => {
		expect(assetRequest(new Request("https://play.spellkave.com/?world=demo1"))?.url).toBe(
			"https://play.spellkave.com/?world=demo1",
		);
		expect(assetRequest(new Request("https://play.spellkave.com/assets/app.js"))?.url).toBe(
			"https://play.spellkave.com/assets/app.js",
		);
	});

	it("refuses non-GET/HEAD asset requests", () => {
		expect(assetRequest(new Request("https://play.spellkave.com/", { method: "POST" }))).toBeNull();
	});

	it("proxies only the read-only account bootstrap without exposing a cross-origin token", () => {
		const source = new Request("https://play.spellkave.com/api/v1/account", {
			headers: { authorization: "Bearer test-token" },
		});
		const request = accountApiRequest(source, "https://api.spellkave.com");
		expect(request?.url).toBe("https://api.spellkave.com/v1/account");
		expect(request?.headers.get("authorization")).toBe("Bearer test-token");
		expect(
			accountApiRequest(
				new Request("https://play.spellkave.com/api/v1/admin/worlds"),
				"https://api.spellkave.com",
			),
		).toBeNull();
	});

	it("proxies the seat board and the claim the join path needs", () => {
		// Regression: these shipped on 2026-08-26 without a proxy entry. The
		// request then fell through to the SPA shell and answered 200 text/html,
		// so response.ok was true and response.json() threw a DOMException that
		// reached a player as "The way into this world is closed".
		const seats = accountApiRequest(
			new Request("https://play.spellkave.com/api/v1/worlds/elven-mini-1/seats", {
				headers: { authorization: "Bearer test-token" },
			}),
			"https://api.spellkave.com",
		);
		expect(seats?.url).toBe("https://api.spellkave.com/v1/worlds/elven-mini-1/seats");
		expect(seats?.headers.get("authorization")).toBe("Bearer test-token");

		const claim = accountApiRequest(
			new Request("https://play.spellkave.com/api/v1/worlds/elven-mini-1/seats/7/claim", {
				method: "POST",
				headers: { authorization: "Bearer test-token" },
			}),
			"https://api.spellkave.com",
		);
		expect(claim?.method).toBe("POST");
		expect(claim?.url).toBe("https://api.spellkave.com/v1/worlds/elven-mini-1/seats/7/claim");

		const release = accountApiRequest(
			new Request("https://play.spellkave.com/api/v1/worlds/elven-mini-1/seats/release", {
				method: "POST",
				headers: { authorization: "Bearer test-token" },
			}),
			"https://api.spellkave.com",
		);
		expect(release?.method).toBe("POST");
		expect(release?.url).toBe("https://api.spellkave.com/v1/worlds/elven-mini-1/seats/release");
	});

	it("refuses methods and paths outside the allowlist", () => {
		const cases: [string, string][] = [
			// The claim is POST-only; a GET must not be proxied.
			["GET", "/api/v1/worlds/w/seats/7/claim"],
			// The seat board is GET-only.
			["POST", "/api/v1/worlds/w/seats"],
			// Operator surface is not Play's to reach.
			["GET", "/api/v1/admin/deploy/status"],
			// Nested paths must not slip past the seats pattern.
			["GET", "/api/v1/worlds/w/seats/extra"],
			["POST", "/api/v1/worlds/w/seats/7/claim/again"],
			["GET", "/api/v1/worlds/w/seats/release"],
		];
		for (const [method, path] of cases) {
			expect(
				accountApiRequest(
					new Request(`https://play.spellkave.com${path}`, { method }),
					"https://api.spellkave.com",
				),
			).toBeNull();
		}
	});

	it("never answers an unproxied api path with the SPA shell", () => {
		// The fallback is what made the original failure unreadable: a JSON caller
		// received an HTML page with status 200. An unknown /api/ path must
		// 404 instead, so the defect is visible where it happens.
		expect(
			assetRequest(new Request("https://play.spellkave.com/api/v1/worlds/w/members")),
		).toBeNull();
		expect(assetRequest(new Request("https://play.spellkave.com/api"))).toBeNull();
		// Ordinary app paths still resolve.
		expect(assetRequest(new Request("https://play.spellkave.com/assets/x.js"))?.url).toBe(
			"https://play.spellkave.com/assets/x.js",
		);
	});

	it("is no longer special: /app/... is just an ordinary asset path", () => {
		// ADR-0136 D-2: no /app alias or redirect is kept after the cutover.
		expect(assetRequest(new Request("https://play.spellkave.com/app/"))?.url).toBe(
			"https://play.spellkave.com/app/",
		);
		expect(
			accountApiRequest(
				new Request("https://play.spellkave.com/app/api/v1/account"),
				"https://api.spellkave.com",
			),
		).toBeNull();
	});
});

describe("worker fetch handler (ADR-0136)", () => {
	it("serves GET / as the SPA from the asset binding", async () => {
		const assetsFetch = vi.fn(async (_request: Request) => new Response("<html>play</html>"));
		const response = await worker.fetch(new Request("https://play.spellkave.com/"), {
			ASSETS: { fetch: assetsFetch },
			ACCOUNT_API_ORIGIN: "https://api.spellkave.com",
		});
		expect(response.status).toBe(200);
		expect(assetsFetch).toHaveBeenCalledTimes(1);
		expect(assetsFetch.mock.calls[0]?.[0]?.url).toBe("https://play.spellkave.com/");
	});

	it("proxies GET /api/v1/account to the Account API instead of the asset binding", async () => {
		const assetsFetch = vi.fn(async (_request: Request) => new Response("<html>play</html>"));
		const upstream = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify({ sub: "x" }), { status: 200 }),
		);
		vi.stubGlobal("fetch", upstream);
		try {
			const response = await worker.fetch(
				new Request("https://play.spellkave.com/api/v1/account", {
					headers: { authorization: "Bearer test-token" },
				}),
				{ ASSETS: { fetch: assetsFetch }, ACCOUNT_API_ORIGIN: "https://api.spellkave.com" },
			);
			expect(response.status).toBe(200);
			expect(assetsFetch).not.toHaveBeenCalled();
			expect(upstream).toHaveBeenCalledTimes(1);
			expect((upstream.mock.calls[0]?.[0] as Request).url).toBe(
				"https://api.spellkave.com/v1/account",
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
