import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearReferenceVocabularyCache,
	findReferenceTargetByRef,
	loadReferenceMatcher,
	referenceVocabularyUrl,
	safeReferenceHref,
} from "./reference-vocabulary";

afterEach(() => {
	clearReferenceVocabularyCache();
	vi.useRealTimers();
});

describe("public reference vocabulary", () => {
	it("uses the docs origin and rejects malformed configuration", () => {
		expect(referenceVocabularyUrl({})).toBe(
			"https://spellkave.com/compendium/docs/references.json",
		);
		expect(referenceVocabularyUrl({ VITE_SPELLKAVE_DOCS_URL: "https://docs.example/" })).toBe(
			"https://docs.example/compendium/docs/references.json",
		);
		expect(referenceVocabularyUrl({ VITE_SPELLKAVE_DOCS_URL: "not a url" })).toBe(
			"https://spellkave.com/compendium/docs/references.json",
		);
	});

	it("allows only same-origin player-readable documentation paths", () => {
		expect(safeReferenceHref("/docs/classes/fighter", "https://docs.example")).toBe(
			"https://docs.example/docs/classes/fighter",
		);
		expect(
			safeReferenceHref("https://elsewhere.example/docs/classes/fighter", "https://docs.example"),
		).toBeNull();
		expect(safeReferenceHref("javascript:alert(1)", "https://docs.example")).toBeNull();
		expect(safeReferenceHref("/catalogue/srd/classes/fighter", "https://docs.example")).toBeNull();
	});

	it("returns no matcher for malformed payloads and unsafe targets", async () => {
		const fetchImpl = vi.fn(
			async () => new Response(JSON.stringify({ version: 2, targets: [] }), { status: 200 }),
		);
		await expect(loadReferenceMatcher("https://docs.example/feed", fetchImpl)).resolves.toBeNull();
		clearReferenceVocabularyCache();
		const malformed = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						version: 1,
						targets: [{ label: "Fighter", kind: "class", ref: "fighter", href: "" }],
					}),
					{ status: 200 },
				),
		);
		await expect(loadReferenceMatcher("https://docs.example/feed", malformed)).resolves.toBeNull();
	});

	it("omits credentials and referrer data", async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn(
			async () => new Response(JSON.stringify({ version: 1, targets: [] }), { status: 200 }),
		);
		await loadReferenceMatcher("https://docs.example/feed", fetchImpl);
		await loadReferenceMatcher("https://docs.example/feed", fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://docs.example/feed",
			expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
		);
	});

	it("handles synchronous fetch failures", async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn(() => {
			throw new Error("offline");
		});
		await expect(loadReferenceMatcher("https://docs.example/feed", fetchImpl)).resolves.toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("bounds a request even when its transport ignores cancellation", async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
		const pending = loadReferenceMatcher("https://docs.example/feed", fetchImpl);
		await vi.advanceTimersByTimeAsync(2_001);
		await expect(pending).resolves.toBeNull();
	});

	it("times out while reading a response body", async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn(
			async () => ({ ok: true, json: () => new Promise<unknown>(() => {}) }) as Response,
		);
		const pending = loadReferenceMatcher("https://docs.example/feed", fetchImpl);
		await vi.advanceTimersByTimeAsync(2_001);
		await expect(pending).resolves.toBeNull();
	});
});

// sk-jay0.1.8.63.9: exact definition-id lookup, sharing the matcher's own
// one-fetch-per-URL cache rather than issuing a second request.
describe("findReferenceTargetByRef", () => {
	const target = {
		label: "Goblin Warrior",
		kind: "entity_definition",
		ref: "srd/creature/goblin-warrior",
		href: "/docs/srd/creature/goblin-warrior",
	};

	it("resolves an exact ref match", async () => {
		const fetchImpl = vi.fn(
			async () => new Response(JSON.stringify({ version: 1, targets: [target] }), { status: 200 }),
		);
		await expect(
			findReferenceTargetByRef(
				"https://docs.example/feed",
				"srd/creature/goblin-warrior",
				fetchImpl,
			),
		).resolves.toEqual(target);
	});

	it("returns null when no target carries that exact ref", async () => {
		const fetchImpl = vi.fn(
			async () => new Response(JSON.stringify({ version: 1, targets: [target] }), { status: 200 }),
		);
		await expect(
			findReferenceTargetByRef("https://docs.example/feed", "srd/creature/unknown", fetchImpl),
		).resolves.toBeNull();
	});

	it("shares the vocabulary fetch with loadReferenceMatcher", async () => {
		const fetchImpl = vi.fn(
			async () => new Response(JSON.stringify({ version: 1, targets: [target] }), { status: 200 }),
		);
		await loadReferenceMatcher("https://docs.example/feed", fetchImpl);
		await findReferenceTargetByRef("https://docs.example/feed", target.ref, fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
