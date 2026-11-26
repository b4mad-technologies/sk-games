import { describe, expect, it } from "vitest";

import { parsePublicSiteIndex, publicSiteBaseUrl } from "./public-site";

describe("public-site", () => {
	it("defaults to /demo-data when unset", () => {
		expect(publicSiteBaseUrl({})).toBe("/demo-data");
		expect(publicSiteBaseUrl({ VITE_SPELLKAVE_PUBLIC_SITE_URL: "https://x.example/" })).toBe(
			"https://x.example",
		);
	});

	it("parses a catalog index", () => {
		const index = parsePublicSiteIndex({
			v: "spellkave-public-site/v1",
			generated_at: "t",
			sample: true,
			mcp: { url: "https://mcp.spellkave.com/mcp", scope: "openid" },
			worlds: [{ slug: "demo1", name: "Demo", db: "db1", transcript_url: "x" }],
		});
		expect(index.worlds[0]).toMatchObject({ slug: "demo1", db: "db1" });
		expect(index.sample).toBe(true);
	});
});
