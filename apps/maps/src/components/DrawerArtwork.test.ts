import { loadWorldImage } from "@spellkave/map-canvas/world-assets";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import DrawerArtwork from "./DrawerArtwork.svelte";

vi.mock("@spellkave/map-canvas/world-assets", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@spellkave/map-canvas/world-assets")>();
	return { ...actual, loadWorldImage: vi.fn() };
});

const props = {
	art: { path: "kavemouth-art/aldwin.webp", hash: "a".repeat(64), license: "CC0-1.0" },
	gatewayOrigin: "https://gateway.example",
	slug: "kavemouth",
	token: "maps-token",
	label: "Aldwin",
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

it("delegates authenticated artwork loading and object URL cleanup to WorldArtwork", async () => {
	const revoke = vi.fn();
	vi.stubGlobal(
		"URL",
		class extends URL {
			static override createObjectURL() {
				return "blob:aldwin";
			}
			static override revokeObjectURL = revoke;
		},
	);
	vi.mocked(loadWorldImage).mockResolvedValue(new Blob());
	const view = render(DrawerArtwork, props);
	await waitFor(() =>
		expect(view.getByRole("img", { name: "Aldwin" }).getAttribute("src")).toBe("blob:aldwin"),
	);
	await fireEvent.load(view.getByRole("img", { name: "Aldwin" }));
	expect(loadWorldImage).toHaveBeenCalledWith(
		props.art,
		props.gatewayOrigin,
		props.slug,
		props.token,
		expect.any(AbortSignal),
	);
	view.unmount();
	expect(revoke).toHaveBeenCalledWith("blob:aldwin");
});
