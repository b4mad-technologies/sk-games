import { describe, expect, it, vi } from "vitest";

import { AccountApiError, claimSeat, readAccountApiUrl, releaseSeat } from "./account-api";

describe("account API location", () => {
	it("uses the same-origin Play bootstrap proxy by default", () => {
		expect(readAccountApiUrl({}, "https://play.spellkave.com")).toBe(
			"https://play.spellkave.com/api",
		);
	});

	it("keeps an explicit local API override for development", () => {
		expect(readAccountApiUrl({ VITE_SPELLKAVE_API_URL: "http://127.0.0.1:8787/" })).toBe(
			"http://127.0.0.1:8787",
		);
	});
});

describe("claimSeat", () => {
	it("posts the claim and returns the seat", async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe("https://api.spellkave.com/v1/worlds/demo1/seats/7/claim");
			expect(init?.method).toBe("POST");
			return new Response(
				JSON.stringify({ seat: { slug: "demo1", actor_id: "7", role: "primary" } }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		await expect(
			claimSeat("https://api.spellkave.com", "jwt", "demo1", "7", fetchImpl),
		).resolves.toMatchObject({
			seat: { actor_id: "7" },
		});
	});

	it("maps 409 as a typed AccountApiError", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ error_description: "taken" }), {
					status: 409,
					headers: { "content-type": "application/json" },
				}),
		);
		await expect(
			claimSeat("https://api.spellkave.com", "jwt", "demo1", "7", fetchImpl),
		).rejects.toMatchObject({
			name: "AccountApiError",
			status: 409,
			message: "taken",
		});
	});
});

describe("releaseSeat", () => {
	it("posts the release", async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe("https://api.spellkave.com/v1/worlds/demo1/seats/release");
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				Authorization: "Bearer jwt",
				Accept: "application/json",
			});
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});
		await expect(
			releaseSeat("https://api.spellkave.com", "jwt", "demo1", fetchImpl),
		).resolves.toBeUndefined();
	});

	it("maps 403 and other HTTP errors", async () => {
		const forbidden = vi.fn(
			async () =>
				new Response(JSON.stringify({ error_description: "no" }), {
					status: 403,
					headers: { "content-type": "application/json" },
				}),
		);
		await expect(
			releaseSeat("https://api.spellkave.com", "jwt", "demo1", forbidden),
		).rejects.toMatchObject({
			name: "AccountApiError",
			status: 403,
			message: "no",
		});

		const boom = vi.fn(async () => new Response(null, { status: 500 }));
		await expect(
			releaseSeat("https://api.spellkave.com", "jwt", "demo1", boom),
		).rejects.toBeInstanceOf(AccountApiError);
	});
});
