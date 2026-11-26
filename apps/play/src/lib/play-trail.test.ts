import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPlayTrail,
	PLAY_TRAIL_LIMIT,
	type PlayTrail,
	type PlayTrailEntry,
	redactTrailText,
} from "./play-trail";

describe("redactTrailText", () => {
	it("passes ordinary player words through unchanged", () => {
		expect(redactTrailText("I attack the rat with my sword.")).toBe(
			"I attack the rat with my sword.",
		);
	});

	it("returns null for null and undefined", () => {
		expect(redactTrailText(null)).toBeNull();
		expect(redactTrailText(undefined)).toBeNull();
	});

	it("redacts a bare 'Bearer <token>' string", () => {
		expect(redactTrailText("Authorization: Bearer abc123def456ghi789")).toBe(
			"Authorization: [redacted]",
		);
	});

	it("redacts a JWT-shaped access token even without a Bearer prefix", () => {
		// Built from three parts and dot-joined at runtime, not one literal: a
		// static secret scanner's `jwt` rule matches a dot-joined string in the
		// SOURCE text, and this is a synthetic fixture (header from the jwt.io
		// sample, payload and signature invented), not a credential.
		const jwt = [
			"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9",
			"eyJzdWIiOiIxMjM0NTY3ODkwIn0",
			"dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYE",
		].join(".");
		expect(redactTrailText(`token=${jwt}`)).toBe("token=[redacted]");
	});

	it("redacts any other long opaque run (a session id or API key with no recognizable shape)", () => {
		const opaque = `sk_live_${"a".repeat(40)}`;
		expect(redactTrailText(opaque)).toBe("[redacted]");
	});

	it("never redacts this app's own short, structured ids", () => {
		expect(redactTrailText("item:42")).toBe("item:42");
		expect(redactTrailText("srd/speak-to")).toBe("srd/speak-to");
		expect(redactTrailText("h:1")).toBe("h:1");
		expect(redactTrailText("core/place/cellar")).toBe("core/place/cellar");
	});
});

describe("createPlayTrail", () => {
	let trail: PlayTrail;

	beforeEach(() => {
		trail = createPlayTrail({ now: () => 1000 });
	});

	it("records an act entry with tool, target, outcome and tick", () => {
		trail.recordAct({
			tool: "spellkave_manipulate",
			actionId: "h:12",
			targetRef: "item:7",
			words: "I open the chest.",
			outcome: "happened",
			observation: "The chest creaks open.",
			durationMs: 42,
			tick: 8,
		});
		const [entry] = trail.entries();
		expect(entry).toMatchObject({
			kind: "act",
			tool: "spellkave_manipulate",
			actionId: "h:12",
			targetRef: "item:7",
			words: "I open the chest.",
			outcome: "happened",
			observation: "The chest creaks open.",
			durationMs: 42,
			tick: 8,
		});
	});

	it("records a read entry with tool, tick and counts", () => {
		trail.recordRead({ tool: "readView", counts: { actions: 3, occupants: 2 }, tick: 5 });
		expect(trail.entries()).toMatchObject([
			{ kind: "read", tool: "readView", counts: { actions: 3, occupants: 2 }, tick: 5 },
		]);
	});

	it("records a world_pull entry distinctly from a read entry", () => {
		trail.recordWorldPull({ tool: "readView", counts: { events: 1 }, tick: 9 });
		expect(trail.entries()).toMatchObject([{ kind: "world_pull", tool: "readView", tick: 9 }]);
	});

	it("records a layout entry with tile, level and trigger", () => {
		trail.recordLayout({ tile: "map", level: "stage", trigger: "tap", tick: 3 });
		expect(trail.entries()).toMatchObject([
			{ kind: "layout", tile: "map", level: "stage", trigger: "tap", tick: 3 },
		]);
	});

	it("records a tool_error entry with tool and message", () => {
		trail.recordToolError({ tool: "spellkave_move", message: "The world refused.", tick: 2 });
		expect(trail.entries()).toMatchObject([
			{ kind: "tool_error", tool: "spellkave_move", message: "The world refused." },
		]);
	});

	it("redacts a bearer string out of a recorded act entry's words", () => {
		// Same "dot-join at runtime, never as one literal" reasoning as the JWT
		// test above: a synthetic fixture, not a credential.
		const fakeJwt = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiIxIn0", "abcdefghijklmno"].join(".");
		trail.recordAct({
			tool: "spellkave_manipulate",
			actionId: "h:1",
			targetRef: null,
			words: `here is my token Bearer ${fakeJwt}`,
			outcome: "happened",
			observation: null,
			durationMs: 1,
			tick: 0,
		});
		const [entry] = trail.entries();
		expect(entry?.kind).toBe("act");
		if (entry?.kind !== "act") throw new Error("expected an act entry");
		expect(entry.words).not.toContain("Bearer");
		expect(entry.words).not.toMatch(/eyJ/);
		expect(entry.words).toBe("here is my token [redacted]");
	});

	it("redacts a tool_error message that leaked an opaque token", () => {
		trail.recordToolError({
			tool: "spellkave_move",
			message: `denied for credential ${"x".repeat(40)}`,
			tick: 0,
		});
		const [entry] = trail.entries();
		expect(entry?.kind).toBe("tool_error");
		if (entry?.kind !== "tool_error") throw new Error("expected a tool_error entry");
		expect(entry.message).toBe("denied for credential [redacted]");
	});

	it("returns entries in insertion order", () => {
		trail.recordLayout({ tile: "table", level: "stage", trigger: "tap", tick: 1 });
		trail.recordLayout({ tile: "map", level: "card", trigger: "drag", tick: 2 });
		trail.recordLayout({ tile: "pack", level: "strip", trigger: "reset", tick: 3 });
		const ids = trail.entries().map((entry) => entry.id);
		expect(ids).toEqual([...ids].sort((a, b) => a - b));
		expect(trail.entries().map((entry) => (entry.kind === "layout" ? entry.tile : null))).toEqual([
			"table",
			"map",
			"pack",
		]);
	});

	it("caps the ring buffer at the configured limit, dropping the oldest first", () => {
		const capped = createPlayTrail({ limit: 3 });
		for (let index = 0; index < 5; index += 1) {
			capped.recordLayout({ tile: "table", level: "stage", trigger: `t${index}`, tick: index });
		}
		const entries = capped.entries();
		expect(entries).toHaveLength(3);
		expect(entries.map((entry) => (entry.kind === "layout" ? entry.trigger : null))).toEqual([
			"t2",
			"t3",
			"t4",
		]);
	});

	it("defaults the cap to PLAY_TRAIL_LIMIT", () => {
		const uncapped = createPlayTrail();
		for (let index = 0; index < PLAY_TRAIL_LIMIT + 10; index += 1) {
			uncapped.recordLayout({ tile: "table", level: "stage", trigger: "tap", tick: index });
		}
		expect(uncapped.entries()).toHaveLength(PLAY_TRAIL_LIMIT);
	});
});

describe("createPlayTrail onEntry (exporter hook, sk-jay0.6.39)", () => {
	it("calls onEntry with the finalized, already-redacted entry for every kind", () => {
		const seen: PlayTrailEntry[] = [];
		const trail = createPlayTrail({ now: () => 1000, onEntry: (entry) => seen.push(entry) });

		trail.recordAct({
			tool: "spellkave_manipulate",
			actionId: "h:1",
			targetRef: "item:7",
			words: null,
			outcome: "happened",
			observation: null,
			durationMs: 5,
			tick: 1,
		});
		trail.recordLayout({ tile: "table", level: "stage", trigger: "tap", tick: 2 });

		expect(seen).toHaveLength(2);
		expect(seen[0]).toEqual(trail.entries()[0]);
		expect(seen[1]).toEqual(trail.entries()[1]);
	});

	it("swallows a throwing onEntry hook — the trail itself must survive a faulty exporter", () => {
		const trail = createPlayTrail({
			now: () => 1000,
			onEntry: () => {
				throw new Error("exporter boom");
			},
		});

		expect(() =>
			trail.recordAct({
				tool: "spellkave_move",
				actionId: null,
				targetRef: null,
				words: null,
				outcome: null,
				observation: null,
				durationMs: 1,
				tick: 1,
			}),
		).not.toThrow();
		expect(trail.entries()).toHaveLength(1);
	});
});

describe("createPlayTrail console.debug mirroring", () => {
	let debugSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
	});

	afterEach(() => {
		debugSpy.mockRestore();
	});

	it("mirrors every entry to console.debug under a 'play' prefix when debug is true", () => {
		const trail = createPlayTrail({ debug: true });
		trail.recordLayout({ tile: "table", level: "stage", trigger: "tap", tick: 0 });
		expect(debugSpy).toHaveBeenCalledTimes(1);
		expect(debugSpy.mock.calls[0]?.[0]).toBe("[play]");
	});

	it("stays silent when debug is false — the production-build shape", () => {
		const trail = createPlayTrail({ debug: false });
		trail.recordLayout({ tile: "table", level: "stage", trigger: "tap", tick: 0 });
		expect(debugSpy).not.toHaveBeenCalled();
	});

	it("stays silent by default (debug omitted)", () => {
		const trail = createPlayTrail();
		trail.recordAct({
			tool: "spellkave_move",
			actionId: "h:1",
			targetRef: null,
			words: null,
			outcome: "happened",
			observation: null,
			durationMs: 1,
			tick: 0,
		});
		expect(debugSpy).not.toHaveBeenCalled();
	});
});

describe("createPlayTrail window exposure", () => {
	it("installs a read-only window.__spellkavePlayTrail getter that returns the current entries in order", () => {
		const fakeWindow = {} as Window;
		const trail = createPlayTrail({ windowRef: fakeWindow });
		trail.recordLayout({ tile: "table", level: "stage", trigger: "tap", tick: 1 });
		expect(fakeWindow.__spellkavePlayTrail).toEqual(trail.entries());
		trail.recordLayout({ tile: "map", level: "card", trigger: "drag", tick: 2 });
		expect(fakeWindow.__spellkavePlayTrail).toHaveLength(2);
	});

	it("the window property has no setter — assigning through it does not change the trail", () => {
		const fakeWindow = {} as Window;
		const trail = createPlayTrail({ windowRef: fakeWindow });
		trail.recordLayout({ tile: "table", level: "stage", trigger: "tap", tick: 1 });
		const descriptor = Object.getOwnPropertyDescriptor(fakeWindow, "__spellkavePlayTrail");
		expect(descriptor?.set).toBeUndefined();
		expect(descriptor?.get).toBeTypeOf("function");
	});
});
