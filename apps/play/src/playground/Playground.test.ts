import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import { focusedLayout } from "../lib/mosaic";
import {
	capturePlayView,
	createPlayRecording,
	PLAY_RECORDING_SURFACE,
} from "../lib/play-recording";
import { sampleView } from "./fixtures";
import Playground from "./Playground.svelte";

afterEach(async () => {
	// bits-ui menus restore focus on a timeout; let it run while jsdom lives.
	await new Promise((resolve) => setTimeout(resolve, 50));
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	window.sessionStorage.clear();
});

it("uses the production shell, switches and resets without reading credentials or fetching a world", async () => {
	window.history.replaceState(null, "", "/playground.html");
	window.sessionStorage.setItem("existing-login", "leave-me-alone");
	const read = vi.spyOn(Storage.prototype, "getItem");
	const write = vi.spyOn(Storage.prototype, "setItem");
	const fetch = vi.fn((input: RequestInfo | URL) => {
		if (String(input).endsWith("/compendium/docs/references.json"))
			return Promise.resolve(
				new Response(JSON.stringify({ version: 1, targets: [] }), { status: 200 }),
			);
		throw new Error("Playground must not fetch a world");
	});
	vi.stubGlobal("fetch", fetch);
	render(Playground);
	await screen.findByRole("button", { name: "1 Fighter" });
	await fireEvent.click(screen.getByRole("button", { name: "1 Fighter" }));
	await screen.findByRole("button", { name: "1 Human" });
	await fireEvent.click(screen.getByRole("button", { name: "1 Human" }));
	await fireEvent.click(await screen.findByRole("button", { name: "1 Soldier" }));
	// "Adopt the recommended array" targets Aldwin specifically (axiom A1: the
	// dock's SELECTION group is what the chosen thing offers) — this recorded
	// frame carries no open dialogue for it to ride HERE on its own, so the
	// player selects him first, the same way a click on any other name does
	// (his own speech-burst heading, already in the stream from the opening
	// arrival).
	await fireEvent.click(
		(
			await screen.findAllByRole("button", { name: "Aldwin, keeper of the hearth-ledger details" })
		)[0] as HTMLElement,
	);
	await fireEvent.click(
		await screen.findByRole("button", { name: "1 Adopt the recommended array" }),
	);
	await fireEvent.input(await screen.findByRole("textbox", { name: /Say or do something/ }), {
		target: { value: "name=Mira" },
	});
	await fireEvent.click(screen.getByRole("button", { name: "Send" }));
	// The recorded confirmation targets entity:4 (Aldwin), so keep his
	// selection: the confirmation belongs to his dock group too.
	await fireEvent.click(await screen.findByRole("button", { name: /Confirm character creation/ }));
	await screen.findByRole("button", { name: "Mira, seat menu" });

	// Every scene/frame change remounts `<App>` (the Playground's own
	// `{#key generation}`), so the trigger is re-queried fresh each time
	// rather than reused across an action that replaces it.
	await fireEvent.keyDown(screen.getByRole("button", { name: "Mock scene menu" }), {
		key: "Enter",
	});
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Reset scene" }));
	await screen.findByRole("button", { name: "1 Fighter" });

	await fireEvent.keyDown(screen.getByRole("button", { name: "Mock scene menu" }), {
		key: "Enter",
	});
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Scene" }));
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Combat" }));
	await waitFor(() => expect(window.location.search).toBe("?scene=combat"));
	expect(fetch).toHaveBeenCalledTimes(1);
	// Theme/layout preferences may use localStorage; credentials must not be touched.
	expect(read.mock.contexts.filter((context) => context === window.sessionStorage)).toHaveLength(0);
	expect(write.mock.contexts.filter((context) => context === window.sessionStorage)).toHaveLength(
		0,
	);
});

it("imports a validated local recording into the existing mock shell", async () => {
	window.history.replaceState(null, "", "/playground.html");
	const socket = vi.fn(() => {
		throw new Error("Replay must not open a world socket");
	});
	vi.stubGlobal("WebSocket", socket);
	const recording = createPlayRecording({ now: () => 1 });
	recording.record(capturePlayView(sampleView, { layout: focusedLayout("map"), mobile: false }));
	recording.record(capturePlayView(sampleView, { layout: focusedLayout("table"), mobile: false }));
	const file = new File([JSON.stringify(recording.export(PLAY_RECORDING_SURFACE))], "play.json", {
		type: "application/json",
	});
	Object.defineProperty(file, "text", {
		value: async () => JSON.stringify(recording.export(PLAY_RECORDING_SURFACE)),
	});
	render(Playground);
	await screen.findByRole("button", { name: "1 Fighter" });
	await fireEvent.change(screen.getByLabelText("Import Play recording"), {
		target: { files: [file] },
	});
	// The import, and every frame seek below, remounts `<App>`; re-query the
	// trigger fresh each time rather than reuse a now-replaced node.
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Mock scene menu" }).textContent).toBe("Recording ▴"),
	);
	await fireEvent.keyDown(screen.getByRole("button", { name: "Mock scene menu" }), {
		key: "Enter",
	});
	expect(await screen.findByText("play.json")).toBeTruthy();
	expect(screen.getByRole("menuitem", { name: /^Next frame/ }).getAttribute("aria-disabled")).toBe(
		"true",
	);
	await fireEvent.click(screen.getByRole("menuitem", { name: "Previous frame" }));
	await screen.findByRole("button", { name: "Shrink Map" });
	await fireEvent.keyDown(screen.getByRole("button", { name: "Mock scene menu" }), {
		key: "Enter",
	});
	expect(
		screen.getByRole("menuitem", { name: "Previous frame" }).getAttribute("aria-disabled"),
	).toBe("true");
	await fireEvent.click(screen.getByRole("menuitem", { name: /^Next frame/ }));
	await screen.findByRole("button", { name: "Shrink Table" });
	expect(socket).not.toHaveBeenCalled();
});

it("selects a creation checkpoint and returns focus when closing the controls", async () => {
	window.history.replaceState(null, "", "/playground.html?scene=creation&step=class");
	render(Playground);
	await screen.findByRole("button", { name: "1 Fighter" });
	await fireEvent.keyDown(screen.getByRole("button", { name: "Mock scene menu" }), {
		key: "Enter",
	});
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Start at" }));
	await fireEvent.click(await screen.findByRole("menuitem", { name: "Species" }));
	await screen.findByRole("button", { name: "1 Human" });
	expect(window.location.search).toBe("?scene=creation&step=species");

	// The checkpoint change above remounted `<App>`; query the now-current
	// trigger fresh, then hold this reference — closing via Escape does not
	// remount, so bits' own focus-return targets this exact node.
	const trigger = screen.getByRole("button", { name: "Mock scene menu" });
	// bits restores focus to whichever element actually held it when the menu
	// opened; a synthetic keyDown alone never moves jsdom's activeElement.
	trigger.focus();
	await fireEvent.keyDown(trigger, { key: "Enter" });
	await fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
	await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("rejects invalid imports without replacing the current scene", async () => {
	window.history.replaceState(null, "", "/playground.html");
	render(Playground);
	await screen.findByRole("button", { name: "1 Fighter" });
	const file = new File(["{}"], "invalid.json", { type: "application/json" });
	Object.defineProperty(file, "text", { value: async () => "{}" });
	await fireEvent.change(screen.getByLabelText("Import Play recording"), {
		target: { files: [file] },
	});
	await screen.findByRole("alert");
	expect(screen.getByRole("button", { name: "1 Fighter" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Mock scene menu" }).textContent).toBe("Mock ▴");
});
