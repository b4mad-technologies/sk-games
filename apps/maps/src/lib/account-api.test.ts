import { describe, expect, it } from "vitest";
import { readAccountApiUrl, worldIsReachable } from "./account-api";

describe("readAccountApiUrl", () => {
	it("defaults to the hosted Account API", () => {
		expect(readAccountApiUrl({})).toBe("https://api.spellkave.com");
	});

	it("accepts an explicit https origin", () => {
		expect(readAccountApiUrl({ VITE_SPELLKAVE_API_URL: "https://api.example/" })).toBe(
			"https://api.example",
		);
	});
});

describe("worldIsReachable", () => {
	it("accepts play, oversee, or join", () => {
		expect(worldIsReachable(["world.play"])).toBe(true);
		expect(worldIsReachable(["world.oversee"])).toBe(true);
		expect(worldIsReachable(["world.join"])).toBe(true);
		expect(worldIsReachable(["token.create"])).toBe(false);
	});
});
