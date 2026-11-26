import { describe, expect, it } from "vitest";

import {
	actorFromSearch,
	fetchWorldCatalog,
	publicSiteBaseUrl,
	worldFromSearch,
} from "./world-catalog";

describe("world catalog", () => {
	it("reads the requested hero next to the world", () => {
		expect(actorFromSearch("?world=demo1&actor=9")).toBe("9");
		expect(actorFromSearch("actor=%20")).toBeNull();
		expect(actorFromSearch("?world=demo1")).toBeNull();
	});

	it("keeps the selected world in an ordinary query string", () => {
		expect(worldFromSearch("?world=demo1")).toBe("demo1");
		expect(worldFromSearch("world=%20")).toBeNull();
	});

	it("uses local demo data unless a public catalog is configured", () => {
		expect(publicSiteBaseUrl({})).toBe("/demo-data");
		expect(
			publicSiteBaseUrl({ VITE_SPELLKAVE_PUBLIC_SITE_URL: "https://spellkave.com/data/" }),
		).toBe("https://spellkave.com/data");
	});

	it("accepts only the public-site catalog contract", async () => {
		const fetchImpl = async () =>
			new Response(
				JSON.stringify({
					v: "spellkave-public-site/v1",
					worlds: [{ slug: "demo1", name: "Woven Marches", db: "spellkave-demo1" }],
				}),
				{ status: 200 },
			);
		await expect(
			fetchWorldCatalog("https://example.test", fetchImpl as typeof fetch),
		).resolves.toEqual([{ slug: "demo1", name: "Woven Marches", db: "spellkave-demo1" }]);
	});
});
