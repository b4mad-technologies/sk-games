import { loadWorldImage, WorldAssetError } from "@spellkave/map-canvas/world-assets";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { type PlayObservation, playObservation } from "../lib/play-observation";
import WorldArt from "./WorldArt.svelte";

vi.mock("@spellkave/map-canvas/world-assets", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@spellkave/map-canvas/world-assets")>();
	return { ...actual, loadWorldImage: vi.fn() };
});
const art = { path: "orbital/crew.webp", hash: "a".repeat(64), license: "CC0-1.0" };
const props = {
	art,
	gatewayOrigin: "https://gateway.example",
	slug: "orbital",
	token: "seat",
	label: "Pilot",
};
afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetAllMocks();
	playObservation.subscribe(() => {});
});

it("keeps an unchanged image across world refreshes and revokes its object URL on unmount", async () => {
	const revoke = vi.fn();
	vi.stubGlobal(
		"URL",
		class extends URL {
			static override createObjectURL() {
				return "blob:pilot";
			}
			static override revokeObjectURL = revoke;
		},
	);
	vi.mocked(loadWorldImage).mockResolvedValue(new Blob());
	const events: PlayObservation[] = [];
	playObservation.subscribe((event) => events.push(event));
	const view = render(WorldArt, { ...props, surface: "pack", ordinal: 2 });
	await waitFor(() =>
		expect(view.getByRole("img", { name: "Pilot" }).getAttribute("src")).toBe("blob:pilot"),
	);
	expect(events.some((event) => event.art_state === "ready")).toBe(false);
	await fireEvent.load(view.getByRole("img", { name: "Pilot" }));
	await waitFor(() =>
		expect(events).toContainEqual({
			phase: "presentation",
			interaction: 0,
			art_surface: "pack",
			art_slot: 2,
			art_state: "ready",
		}),
	);
	await view.rerender({ ...props, art: { ...art } });
	expect(loadWorldImage).toHaveBeenCalledTimes(1);
	await fireEvent.error(view.getByRole("img", { name: "Pilot" }));
	await waitFor(() =>
		expect(view.getByRole("img", { name: "Pilot — Image could not be displayed" })).toBeTruthy(),
	);
	expect(JSON.stringify(events)).not.toContain("crew.webp");
	expect(JSON.stringify(events)).not.toContain("Pilot");
	view.unmount();
	expect(revoke).toHaveBeenCalledWith("blob:pilot");
});

it("shows an accessible fallback when the authenticated image read fails", async () => {
	vi.mocked(loadWorldImage).mockRejectedValue(new Error("unavailable"));
	const view = render(WorldArt, props);
	await waitFor(() =>
		expect(view.getByRole("img", { name: "Pilot — Image could not be loaded" })).toBeTruthy(),
	);
	expect(view.container.querySelector("img")).toBeNull();
});

it.each([
	["missing", "Image missing from this world"],
	["access", "Image access denied"],
	["integrity", "Image does not match this world version"],
] as const)("explains %s failures without asset paths", async (reason, copy) => {
	vi.mocked(loadWorldImage).mockRejectedValue(new WorldAssetError(reason));
	const view = render(WorldArt, props);
	await waitFor(() => expect(view.getByRole("img", { name: `Pilot — ${copy}` })).toBeTruthy());
	expect(view.getByText(copy)).toBeTruthy();
	expect(view.container.textContent).not.toContain(art.path);
});

it("ignores an old request failure after token renewal", async () => {
	let failOld: (error: Error) => void = () => {};
	vi.mocked(loadWorldImage).mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				failOld = reject;
			}),
	);
	vi.mocked(loadWorldImage).mockResolvedValue(new Blob());
	vi.stubGlobal(
		"URL",
		class extends URL {
			static override createObjectURL() {
				return "blob:renewed";
			}
			static override revokeObjectURL() {}
		},
	);
	const view = render(WorldArt, props);
	await view.rerender({ ...props, token: "renewed" });
	await waitFor(() =>
		expect(view.getByRole("img", { name: "Pilot" }).getAttribute("src")).toBe("blob:renewed"),
	);
	failOld(new WorldAssetError("access"));
	await fireEvent.load(view.getByRole("img", { name: "Pilot" }));
	expect(view.container.querySelector('[data-state="ready"]')).toBeTruthy();
	expect(view.queryByText("Image access denied")).toBeNull();
	expect(vi.mocked(loadWorldImage).mock.calls[0]?.[4].aborted).toBe(true);
});
