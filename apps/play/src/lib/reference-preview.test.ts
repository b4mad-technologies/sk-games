import { afterEach, expect, it, vi } from "vitest";
import { clearReferencePreviewCache, loadReferencePreview, previewUrl } from "./reference-preview";

afterEach(() => {
	clearReferencePreviewCache();
	vi.useRealTimers();
});
it("allows only same-origin catalogue JSON artifacts", () => {
	expect(
		previewUrl("/compendium/docs/catalogue/srd/classes/fighter.json", "https://docs.test"),
	).toBe("https://docs.test/compendium/docs/catalogue/srd/classes/fighter.json");
	for (const href of [
		undefined,
		3,
		"https://evil.test/file.json",
		"/compendium/docs/catalogue/../secret.json",
		"/compendium/docs/catalogue/a.json?token=x",
		"/compendium/docs/catalogue/\\evil.json",
	]) {
		expect(previewUrl(href, "https://docs.test")).toBeNull();
	}
});
it("caches minimal text-only previews without credentials or referrer", async () => {
	const fetcher = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					display_name: "Fighter",
					description: "A warrior.",
					record: { hidden: true },
				}),
			),
	);
	expect(await loadReferencePreview("https://docs.test/fighter", fetcher)).toEqual({
		title: "Fighter",
		description: "A warrior.",
	});
	await loadReferencePreview("https://docs.test/fighter", fetcher);
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(fetcher).toHaveBeenCalledWith(
		"https://docs.test/fighter",
		expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
	);
});
it("bounds body reads and caches failure", async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response);
	const result = loadReferencePreview("https://docs.test/slow", fetcher);
	await vi.advanceTimersByTimeAsync(2001);
	expect(await result).toBeNull();
	expect(await loadReferencePreview("https://docs.test/slow", fetcher)).toBeNull();
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(0);
});
it("degrades malformed data and rejected transports to unavailable", async () => {
	for (const value of [null, {}, { display_name: "Fighter", description: 4 }]) {
		clearReferencePreviewCache();
		expect(
			await loadReferencePreview(
				"https://docs.test/a",
				async () => new Response(JSON.stringify(value)),
			),
		).toBeNull();
	}
	clearReferencePreviewCache();
	expect(
		await loadReferencePreview("https://docs.test/a", () => {
			throw new Error("offline");
		}),
	).toBeNull();
});
