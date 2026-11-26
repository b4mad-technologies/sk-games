import { describe, expect, it, vi } from "vitest";
import worker, { assetRequest } from "./worker";

const HOST = "https://chat.spellkave.com";

function req(path: string, init: RequestInit = {}): Request {
	return new Request(`${HOST}${path}`, init);
}

describe("assetRequest", () => {
	it("forwards GET and HEAD to assets", () => {
		expect(assetRequest(req("/"))?.method).toBe("GET");
		expect(assetRequest(req("/auth/callback", { method: "HEAD" }))?.method).toBe("HEAD");
	});

	it("rejects methods assets cannot serve", () => {
		expect(assetRequest(req("/", { method: "POST" }))).toBeNull();
		expect(assetRequest(req("/", { method: "PUT" }))).toBeNull();
	});
});

describe("worker fetch", () => {
	it("serves GET from ASSETS and 405s writes", async () => {
		const fetchAsset = vi.fn(async () => new Response("ok", { status: 200 }));
		const env = { ASSETS: { fetch: fetchAsset } };

		const get = await worker.fetch(req("/"), env);
		expect(get.status).toBe(200);
		expect(fetchAsset).toHaveBeenCalledTimes(1);

		const post = await worker.fetch(req("/", { method: "POST" }), env);
		expect(post.status).toBe(405);
		expect(fetchAsset).toHaveBeenCalledTimes(1);
	});
});
