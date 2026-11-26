import { MARKER_SEEN_STORAGE_KEY, PKCE_STORAGE_KEY, SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { PRODUCT_APP_URLS } from "@spellkave/ui";
import { render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.cookie = "sk_signed_in=; max-age=0";
	window.sessionStorage.clear();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("chat page gate", () => {
	it("recovers expired credentials before opening the chat pane", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		window.sessionStorage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({
				access_token: "expired",
				refresh_token: "refresh",
				id_token: "",
				display_name: "Ada",
				expires_at: 1,
			}),
		);
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ access_token: "renewed", expires_in: 3600 })),
			);
		vi.stubGlobal("fetch", fetch);
		render(App);
		await waitFor(() => expect(screen.getByTestId("chat-pane")).toBeTruthy());
		expect(
			JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "{}").access_token,
		).toBe("renewed");
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("offers sign-in when nobody is signed in", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		render(App);
		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
		expect(screen.queryByTestId("chat-pane")).toBeNull();
		expect(screen.queryByTestId("tile-column")).toBeNull();
	});

	it("shows Play · Chat · Account · Admin · Maps with Chat current", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		render(App);
		const nav = await screen.findByRole("navigation", { name: "Spellkave product navigation" });
		const links = Array.from(nav.querySelectorAll("a"));
		expect(links.map((link) => link.textContent?.replaceAll("◆", "").trim())).toEqual([
			"Play",
			"Chat",
			"Account",
			"Admin",
			"Maps",
		]);
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			PRODUCT_APP_URLS.play,
			PRODUCT_APP_URLS.chat,
			PRODUCT_APP_URLS.account,
			PRODUCT_APP_URLS.admin,
			PRODUCT_APP_URLS.maps,
		]);
		expect(links[1]?.getAttribute("aria-current")).toBe("page");
		for (const [index, link] of links.entries()) {
			if (index !== 1) expect(link.getAttribute("aria-current")).toBeNull();
		}
	});

	it("says so plainly when the build has no WorkOS configuration", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "");
		vi.stubEnv("VITE_WORKOS_ISSUER", "");
		render(App);
		expect(await screen.findByText(/not configured/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
	});

	it("shows the signed-out UI without navigating when nobody is signed in", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		render(App);
		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
		expect(window.sessionStorage.getItem(PKCE_STORAGE_KEY)).toBeNull();
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

	it("signs out by POSTing a form to the login site", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		vi.stubEnv("VITE_SPELLKAVE_LOGIN_ORIGIN", "http://127.0.0.1:18081");
		storeSession();
		let form: HTMLFormElement | undefined;
		vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
			this: HTMLFormElement,
		) {
			form = this;
		});
		render(App);
		expect(await screen.findByTestId("chat-pane")).toBeTruthy();
		screen.getByRole("button", { name: /sign out/i }).click();
		await waitFor(() => expect(form).toBeDefined());
		expect(form?.method.toLowerCase()).toBe("post");
		expect(form?.action).toBe("http://127.0.0.1:18081/logout");
		const fields = Object.fromEntries(
			Array.from(form?.querySelectorAll("input") ?? []).map((i) => [i.name, i.value]),
		);
		expect(fields).toEqual({ return_to: `${window.location.origin}/`, token: "test-token" });
		expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
	});

	it("drops the session and closes the chat pane when the sign-in marker disappears", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		document.cookie = "sk_signed_in=1";
		storeSession();
		render(App);
		expect(await screen.findByTestId("chat-pane")).toBeTruthy();
		expect(window.sessionStorage.getItem(MARKER_SEEN_STORAGE_KEY)).toBe("1");
		document.cookie = "sk_signed_in=; max-age=0";
		window.dispatchEvent(new Event("focus"));
		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
		expect(screen.queryByTestId("chat-pane")).toBeNull();
		expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});
});
