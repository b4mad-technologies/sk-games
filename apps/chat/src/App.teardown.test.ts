import { MARKER_SEEN_STORAGE_KEY, SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.svelte";
import { catalogEntry } from "./lib/llm/catalog";
import type { BrowserModelProvider } from "./lib/llm/provider";

const disconnect = vi.hoisted(() => vi.fn(async () => undefined));
const connectSpellkaveMcp = vi.hoisted(() =>
	vi.fn(async () => ({
		agentTools: () => [],
		listTools: async () => [],
		callTool: async () => undefined,
		disconnect,
	})),
);

vi.mock("./lib/has-webgpu", () => ({ hasWebGpu: () => true }));
vi.mock("./lib/mcp/client", () => ({ connectSpellkaveMcp }));
vi.mock("./lib/llm/webllm", () => ({
	createWebLlmProvider: (): BrowserModelProvider => {
		const entry = catalogEntry();
		return {
			id: entry.id,
			label: entry.label,
			supportsTools: entry.supportsTools,
			load: async (onProgress) => {
				onProgress({ progress: 1, text: "Ready" });
			},
			createStreamFn: () => () => {
				throw new Error("no turn expected");
			},
			dispose: () => undefined,
		};
	},
}));

afterEach(() => {
	disconnect.mockClear();
	connectSpellkaveMcp.mockClear();
	document.cookie = "sk_signed_in=; max-age=0";
	window.sessionStorage.clear();
	vi.unstubAllEnvs();
});

describe("chat sign-out tears down the MCP connection", () => {
	it("disconnects the MCP client when the sign-in marker disappears", async () => {
		vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_test");
		vi.stubEnv("VITE_WORKOS_ISSUER", "https://tenant.authkit.app");
		document.cookie = "sk_signed_in=1";
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
		await fireEvent.click(await screen.findByTestId("model-load"));
		await waitFor(() => expect(connectSpellkaveMcp).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(screen.getByTestId("world-status").textContent).toMatch(/connected/),
		);
		expect(window.sessionStorage.getItem(MARKER_SEEN_STORAGE_KEY)).toBe("1");
		expect(disconnect).not.toHaveBeenCalled();

		document.cookie = "sk_signed_in=; max-age=0";
		window.dispatchEvent(new Event("focus"));

		expect(await screen.findByRole("button", { name: /sign in/i })).toBeTruthy();
		expect(screen.queryByTestId("chat-pane")).toBeNull();
		await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
		expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});
});
