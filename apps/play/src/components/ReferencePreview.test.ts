import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { clearReferencePreviewCache } from "../lib/reference-preview";
import ReferencePreview from "./ReferencePreview.svelte";

afterEach(() => {
	vi.restoreAllMocks();
	clearReferencePreviewCache();
});
const props = {
	text: "Fighter",
	href: "https://docs.test/docs/classes/fighter",
	target: {
		label: "Fighter",
		kind: "class",
		ref: "fighter",
		href: "/docs/classes/fighter",
		previewHref: "/compendium/docs/catalogue/srd/classes/fighter.json",
	},
};

it("loads only on opening, renders escaped catalogue text, and reuses the result", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
		async () =>
			new Response(
				JSON.stringify({
					display_name: "Fighter",
					description: "A warrior. <script>bad()</script>",
				}),
			),
	);
	render(ReferencePreview, { props });
	expect(fetcher).not.toHaveBeenCalled();
	const trigger = screen.getByRole("button", { name: "Fighter" });
	await fireEvent.click(trigger);
	expect(await screen.findByText("A warrior. <script>bad()</script>")).toBeTruthy();
	expect(
		screen.getByRole("dialog", { name: "Fighter reference" }).querySelector("script"),
	).toBeNull();
	await fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await fireEvent.click(trigger);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("opens with Enter, closes with Escape, and retains a full-reference fallback", async () => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
	render(ReferencePreview, { props });
	const trigger = screen.getByRole("button", { name: "Fighter" });
	trigger.focus();
	await fireEvent.keyDown(trigger, { key: "Enter" });
	const dialog = await screen.findByRole("dialog", { name: "Fighter reference" });
	expect(await screen.findByText("Read the full entry in the reference guide.")).toBeTruthy();
	expect(screen.getByRole("link", { name: /Full reference/ }).getAttribute("href")).toBe(
		props.href,
	);
	expect(screen.getByRole("link", { name: /Full reference/ }).getAttribute("target")).toBe(
		"spellkave-reference",
	);
	await fireEvent.keyDown(dialog, { key: "Escape" });
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("ignores touch hover and opens on the subsequent tap/click", async () => {
	const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
	render(ReferencePreview, { props });
	const trigger = screen.getByRole("button", { name: "Fighter" });
	const event = new Event("pointerenter", { bubbles: false });
	Object.defineProperty(event, "pointerType", { value: "touch" });
	await fireEvent(trigger, event);
	await new Promise((resolve) => setTimeout(resolve, 450));
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(fetcher).not.toHaveBeenCalled();
	await fireEvent.click(trigger);
	expect(await screen.findByRole("dialog", { name: "Fighter reference" })).toBeTruthy();
});
