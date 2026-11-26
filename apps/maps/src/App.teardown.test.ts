import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MARKER_SEEN_STORAGE_KEY, SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";

// playUrl is read at module load, so the env is stubbed in vi.hoisted, before
// the static App import. The cold import (~3 s of transform, more on a loaded
// runner) then runs at collection, outside the 5 s test timeout (sk-jay0.7.297).
vi.hoisted(() => {
	vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
	vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
	vi.stubEnv("VITE_SPELLKAVE_GATEWAY_URL", "https://mcp.example.test");
	vi.stubEnv("VITE_SPELLKAVE_PLAY_URL", "wss://play.example.test");
});

const demoData = resolve(import.meta.dirname, "../public/demo-data");

const opened = vi.hoisted(() => [] as { disconnect: ReturnType<typeof vi.fn> }[]);
const openWorld = vi.hoisted(() =>
	vi.fn(async () => {
		const handle = {
			seats: () => [],
			actorPlaces: () => [],
			watch: {
				oldestTick: () => 0,
				latestTick: () => 0,
				cursor: () => ({ kind: "live" }),
				frameAtCursor: () => null,
				pause: () => undefined,
				play: () => undefined,
				scrub: () => undefined,
			},
			overlayAdmitted: () => false,
			whenReady: Promise.resolve(),
			claim: async () => undefined,
			release: async () => undefined,
			disconnect: vi.fn(),
		};
		opened.push(handle);
		return handle;
	}),
);
vi.mock("./lib/world-client", () => ({ openWorld }));

afterEach(() => {
	opened.length = 0;
	openWorld.mockClear();
	window.sessionStorage.clear();
	document.cookie = "sk_signed_in=; path=/; max-age=0";
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function stubFetch() {
	vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
		if (String(input).includes("/index.json")) {
			return new Response(readFileSync(resolve(demoData, "index.json"), "utf8"), {
				status: 200,
			});
		}
		return new Response("", { status: 404 });
	}) as unknown as typeof fetch);
}

describe("maps sign-out tears down the world connections", () => {
	it("disconnects every opened world handle when the sign-in marker disappears", async () => {
		stubFetch();
		(window as Window & { spellkaveMapsReady?: boolean }).spellkaveMapsReady = true;
		document.cookie = "sk_signed_in=1; path=/";
		window.sessionStorage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({
				access_token: "test-token",
				id_token: "",
				expires_at: Date.now() + 60_000,
				display_name: "Test Player",
			}),
		);
		render(App);
		await waitFor(() => expect(openWorld).toHaveBeenCalled());
		await waitFor(() => expect(window.sessionStorage.getItem(MARKER_SEEN_STORAGE_KEY)).toBe("1"));
		expect(opened.length).toBeGreaterThan(0);
		for (const handle of opened) expect(handle.disconnect).not.toHaveBeenCalled();

		document.cookie = "sk_signed_in=; path=/; max-age=0";
		window.dispatchEvent(new Event("focus"));

		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
		for (const handle of opened) {
			await waitFor(() => expect(handle.disconnect).toHaveBeenCalled());
		}
		expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});
});
