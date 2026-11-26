// keep-file(K2): inject the public reference adapter to exercise absent and stale asynchronous reads.
import { render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PlaceReference from "./PlaceReference.svelte";

const read = vi.hoisted(() => vi.fn());
vi.mock("../lib/reference-adapter", () => ({
	readDefinitionCard: read,
	loadDefLinkMatcher: async () => null,
}));
describe("Place documentation", () => {
	it("does nothing without an exact reference, even with a readable name elsewhere", () => {
		render(PlaceReference, {});
		expect(read).not.toHaveBeenCalled();
		expect(screen.queryByRole("link")).toBeNull();
	});
	it("uses only the exact definition reference and discards superseded reads", async () => {
		let resolveFirst!: (value: { title: string; href: string; description: string }) => void;
		read.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		read.mockResolvedValueOnce({
			title: "Second",
			href: "https://example.org/second",
			description: "Exact snippet.",
		});
		const view = render(PlaceReference, { definitionRef: "opaque/one" });
		await view.rerender({ definitionRef: "opaque/two" });
		await waitFor(() => expect(screen.getByText("Exact snippet.")).toBeTruthy());
		resolveFirst({ title: "Old", href: "https://example.org/old", description: "Stale snippet." });
		await waitFor(() => expect(screen.queryByText("Stale snippet.")).toBeNull());
		expect(read.mock.calls).toEqual([["opaque/one"], ["opaque/two"]]);
		expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.org/second");
	});
	it("skips the card description when the detail already shows the same text", async () => {
		const card = {
			title: "Rope",
			href: "https://example.org/rope",
			description: "Fifty feet of  hempen rope.",
		};
		read.mockResolvedValueOnce(card);
		const same = render(PlaceReference, {
			definitionRef: "opaque/rope",
			shownDescription: " Fifty feet of hempen rope.\n",
		});
		await waitFor(() => expect(screen.getByRole("link")).toBeTruthy());
		expect(screen.queryByText(/hempen rope/)).toBeNull();
		same.unmount();

		// A different description is still documentation worth showing.
		read.mockResolvedValueOnce(card);
		render(PlaceReference, { definitionRef: "opaque/rope", shownDescription: "A coil you carry." });
		await waitFor(() => expect(screen.getByText(/hempen rope/)).toBeTruthy());
	});
});
