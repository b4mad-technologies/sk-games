import { readSession } from "@spellkave/authkit";
import { describe, expect, it } from "vitest";
import { devLocalProps, devLocalSession, parseDevLocalConfig } from "./dev-local";

const RAW = JSON.stringify({
	url: "http://127.0.0.1:7883",
	db: "spellkave-dev",
	actorId: "1",
	token: "a.b.c",
	slug: "elven-mini",
	displayName: "Elven Mini",
});

describe("parseDevLocalConfig", () => {
	it("reads a complete config", () => {
		expect(parseDevLocalConfig(RAW)).toEqual({
			url: "http://127.0.0.1:7883",
			db: "spellkave-dev",
			actorId: "1",
			token: "a.b.c",
			slug: "elven-mini",
			displayName: "Elven Mini",
		});
	});

	it("falls back to the slug when no display name is given", () => {
		const raw = JSON.stringify({
			url: "http://127.0.0.1:7883",
			db: "spellkave-dev",
			actorId: "1",
			token: "a.b.c",
			slug: "elven-mini",
		});
		expect(parseDevLocalConfig(raw)?.displayName).toBe("elven-mini");
	});

	// A production build defines the literal `null`; a build with no profile
	// leaves it undefined. Both mean "no local play", never a partial session.
	it.each([
		["production define", "null"],
		["undefined", undefined],
		["empty", ""],
		["not json", "{"],
		["not an object", '"nope"'],
	])("returns null for %s", (_label, raw) => {
		expect(parseDevLocalConfig(raw)).toBeNull();
	});

	it("rejects a config missing any required field", () => {
		for (const key of ["url", "db", "actorId", "token", "slug"]) {
			const partial = JSON.parse(RAW) as Record<string, unknown>;
			delete partial[key];
			expect(parseDevLocalConfig(JSON.stringify(partial))).toBeNull();
		}
	});

	it("rejects a blank required field rather than connecting nowhere", () => {
		expect(parseDevLocalConfig(JSON.stringify({ ...JSON.parse(RAW), url: "   " }))).toBeNull();
	});
});

describe("devLocalSession", () => {
	it("carries the node credential as the access token", () => {
		const config = parseDevLocalConfig(RAW);
		if (config === null) throw new Error("fixture must parse");
		const session = devLocalSession(config);
		expect(session.access_token).toBe("a.b.c");
		// Milliseconds, like completeLogin — readSession compares against
		// Date.now(), so a seconds-shaped value would read as long expired.
		expect(session.expires_at).toBeGreaterThan(Date.now());
		expect(session.display_name).toContain("local");

		const restored = readSession({
			getItem: () => JSON.stringify(session),
			setItem: () => {},
			removeItem: () => {},
		} as unknown as Storage);
		expect(restored?.access_token).toBe("a.b.c");
	});
});

describe("devLocalProps", () => {
	it("offers exactly one world, already seated on the staged hero", async () => {
		const config = parseDevLocalConfig(RAW);
		if (config === null) throw new Error("fixture must parse");
		const props = devLocalProps(config);

		const account = await props.accountLoader();
		expect(account.worlds).toHaveLength(1);
		expect(account.worlds[0]?.slug).toBe("elven-mini");
		// world.play is what App requires to treat the world as enterable.
		expect(account.worlds[0]?.capabilities).toContain("world.play");
		expect(account.seat).toEqual({ slug: "elven-mini", actor_id: "1", role: "player" });

		const catalog = await props.catalogLoader();
		expect(catalog).toEqual([{ slug: "elven-mini", name: "Elven Mini", db: "spellkave-dev" }]);
	});

	it("reports the staged seat as already mine so no board is shown", async () => {
		const config = parseDevLocalConfig(RAW);
		if (config === null) throw new Error("fixture must parse");
		const seats = await devLocalProps(config).seatsLoader();
		expect(seats).toEqual([{ actor_id: "1", claimed: true, mine: true }]);
	});
});
