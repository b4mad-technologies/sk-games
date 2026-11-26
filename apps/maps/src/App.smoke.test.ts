import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MARKER_SEEN_STORAGE_KEY, PKCE_STORAGE_KEY, SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import { tryReadGatewayUrl } from "./lib/env";

const demoData = resolve(import.meta.dirname, "../public/demo-data");
const hasGateway =
	tryReadGatewayUrl(import.meta.env as Record<string, string | undefined>) !== null;

function sampleFetch(): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith("/index.json") || url.includes("/demo-data/index.json")) {
			return new Response(readFileSync(resolve(demoData, "index.json"), "utf8"), { status: 200 });
		}
		return new Response("", { status: 404 });
	}) as unknown as typeof fetch;
}

describe("maps App (smoke)", () => {
	afterEach(() => {
		window.sessionStorage.clear();
		document.cookie = "sk_signed_in=; max-age=0";
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("has no product top navigation", () => {
		render(App);
		expect(screen.getByTestId("maps-app")).toBeTruthy();
		expect(screen.queryByRole("navigation", { name: "Spellkave product navigation" })).toBeNull();
	});

	it("mounts the sign-in gate without a session", async () => {
		vi.stubGlobal("fetch", sampleFetch());
		render(App);
		expect(screen.getByTestId("maps-app")).toBeTruthy();
		await waitFor(() => {
			const body = document.body.textContent ?? "";
			expect(
				body.includes("Opening the world map") ||
					body.includes("Sign in") ||
					body.includes("DEV token") ||
					body.includes("Sign-in is temporarily unavailable") ||
					body.includes("VITE_SPELLKAVE_GATEWAY_URL"),
			).toBe(true);
		});
		expect(screen.queryByTestId("maps-canvas")).toBeNull();
	});

	it("does not fetch world catalog when session is null", async () => {
		const fetchMock = vi.fn(sampleFetch());
		vi.stubGlobal("fetch", fetchMock);
		render(App);
		expect(screen.getByTestId("maps-app")).toBeTruthy();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("opens the map canvas for a signed-in session without observer drawers", async () => {
		window.sessionStorage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({
				access_token: "test-token",
				id_token: "",
				expires_at: Date.now() + 60_000,
				display_name: "Test Player",
			}),
		);
		const fetchMock = vi.fn(sampleFetch());
		vi.stubGlobal("fetch", fetchMock);
		render(App);
		if (!hasGateway) {
			await waitFor(() => {
				expect(document.body.textContent ?? "").toMatch(/VITE_SPELLKAVE_GATEWAY_URL/);
			});
			expect(screen.queryByTestId("maps-canvas")).toBeNull();
			return;
		}
		await waitFor(() => {
			expect(screen.getByTestId("maps-canvas")).toBeTruthy();
		});
		expect(screen.getByTestId("map-canvas")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Map layers" })).toBeTruthy();
		expect(screen.queryByTestId("maps-drawer-inspect")).toBeNull();
		expect(screen.queryByTestId("maps-drawer-radar")).toBeNull();
		const fetched = fetchMock.mock.calls.map((call) => String(call[0]));
		expect(fetched.some((url) => url.includes("/index.json"))).toBe(true);
		expect(fetched.some((url) => url.includes("api.spellkave.com"))).toBe(false);
	});

	function storeSession(): void {
		window.sessionStorage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({
				access_token: "test-token",
				id_token: "",
				expires_at: Date.now() + 60_000,
				display_name: "Test Player",
			}),
		);
	}

	function stubAuthEnv(): void {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
	}

	it("shows the sign-in button without navigating when nobody is signed in", async () => {
		stubAuthEnv();
		vi.stubGlobal("fetch", sampleFetch());
		render(App);
		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
		expect(window.sessionStorage.getItem(PKCE_STORAGE_KEY)).toBeNull();
	});

	it("signs out by POSTing a form to the login site", async () => {
		stubAuthEnv();
		vi.stubEnv("VITE_SPELLKAVE_LOGIN_ORIGIN", "http://127.0.0.1:18081");
		vi.stubGlobal("fetch", sampleFetch());
		storeSession();
		let form: HTMLFormElement | undefined;
		vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
			this: HTMLFormElement,
		) {
			form = this;
		});
		render(App);
		const signOut = await screen.findByText("Sign out");
		signOut.click();
		await waitFor(() => expect(form).toBeDefined());
		expect(form?.method.toLowerCase()).toBe("post");
		expect(form?.action).toBe("http://127.0.0.1:18081/logout");
		const fields = Object.fromEntries(
			Array.from(form?.querySelectorAll("input") ?? []).map((i) => [i.name, i.value]),
		);
		expect(fields).toEqual({ return_to: "https://spellkave.com/", token: "test-token" });
		expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
	});

	it("drops the session and shows the signed-out gate when the sign-in marker disappears", async () => {
		stubAuthEnv();
		vi.stubGlobal("fetch", sampleFetch());
		document.cookie = "sk_signed_in=1";
		storeSession();
		render(App);
		await waitFor(() => expect(window.sessionStorage.getItem(MARKER_SEEN_STORAGE_KEY)).toBe("1"));
		expect(screen.queryByRole("button", { name: /^sign in/i })).toBeNull();
		document.cookie = "sk_signed_in=; max-age=0";
		window.dispatchEvent(new Event("focus"));
		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
		expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
		expect(screen.queryByTestId("maps-canvas")).toBeNull();
	});

	it("asserts browse pill, query rail, preview card, no ProductMasthead, and no mosaic shell", () => {
		const table = readFileSync(resolve(import.meta.dirname, "components/MapsTable.svelte"), "utf8");
		const app = readFileSync(resolve(import.meta.dirname, "App.svelte"), "utf8");
		const canvas = readFileSync(
			resolve(import.meta.dirname, "../node_modules/@spellkave/map-canvas/src/MapCanvas.svelte"),
			"utf8",
		);
		expect(canvas).toContain("search-pill");
		expect(canvas).toContain("rounded-[var(--radius)]");
		expect(canvas).toContain('data-testid="search-input"');
		expect(canvas).toContain('data-testid="search-results"');
		expect(canvas).toContain('data-testid="maps-rail"');
		expect(canvas).toContain("33.333vw");
		expect(table).toContain("openRail");
		expect(table).toContain("People");
		expect(table).toContain("Graphs");
		expect(table).not.toContain("ProductMasthead");
		expect(table).not.toContain("mosaic");
		expect(app).not.toContain("ProductMasthead");
		expect(app).not.toContain("mosaic");
		expect(table).not.toContain("maps-sheet--place");
		const css = readFileSync(resolve(import.meta.dirname, "styles.css"), "utf8");
		expect(css).not.toMatch(/\[data-testid="place-panel"\][^}]*display:\s*none/);
	});
});
