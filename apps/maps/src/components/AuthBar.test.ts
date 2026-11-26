import { SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import AuthBar from "./AuthBar.svelte";

afterEach(() => {
	cleanup();
	sessionStorage.clear();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it("renews expired credentials before treating the person as signed out", async () => {
	vi.stubEnv("DEV", false);
	vi.stubEnv("VITE_WORKOS_CLIENT_ID", "test-client");
	vi.stubEnv("VITE_WORKOS_ISSUER", "https://issuer.example");
	sessionStorage.setItem(
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
		.fn<typeof globalThis.fetch>()
		.mockResolvedValue(new Response(JSON.stringify({ access_token: "renewed", expires_in: 3600 })));
	vi.stubGlobal("fetch", fetch);
	render(AuthBar);
	await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy());
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(String(fetch.mock.calls[0]?.[0])).toBe("https://issuer.example/oauth2/token");
	expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "{}").access_token).toBe(
		"renewed",
	);
});
