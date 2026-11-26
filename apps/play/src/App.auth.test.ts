import { AUTH_CHANGED_EVENT, SESSION_STORAGE_KEY } from "@spellkave/authkit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App.svelte";
import type { AccountGetResponse } from "./lib/account-api";
import type { OpenPlaySessionArgs, PlaySessionHandle } from "./lib/play-session";
import { fakeHandle, sampleView } from "./test/sample-view";

afterEach(async () => {
	cleanup();
	sessionStorage.clear();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await new Promise((resolve) => setTimeout(resolve, 50));
});

function token(revision: string, sub = "user_a") {
	return `e30.${btoa(JSON.stringify({ iss: "https://issuer.example", sub }))}.${revision}`;
}

function store(accessToken: string, expiresAt: number) {
	sessionStorage.setItem(
		SESSION_STORAGE_KEY,
		JSON.stringify({
			access_token: accessToken,
			refresh_token: "refresh",
			id_token: "",
			display_name: "Ada",
			expires_at: expiresAt,
		}),
	);
}

function setup(expired = false) {
	vi.stubEnv("VITE_WORKOS_CLIENT_ID", "test-client");
	vi.stubEnv("VITE_WORKOS_ISSUER", "https://issuer.example");
	store(token("initial"), expired ? 1 : Date.now() + 3_600_000);
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValue(
			new Response(JSON.stringify({ access_token: token("renewed"), expires_in: 3600 })),
		);
	vi.stubGlobal("fetch", fetch);
	const account: AccountGetResponse = {
		sub: "user_a",
		capabilities: [],
		worlds: [{ slug: "demo1", display_name: "Demo", role: "member", capabilities: ["world.play"] }],
		seat: { slug: "demo1", actor_id: "7", role: "primary" },
	};
	const accountLoader = vi.fn(async () => account);
	const disconnect = vi.fn();
	const handle = fakeHandle({ disconnect });
	const worldOpener = vi.fn(async (args: OpenPlaySessionArgs) => {
		args.onView(sampleView);
		return handle;
	});
	render(App, {
		accountLoader,
		catalogLoader: vi.fn(async () => [{ slug: "demo1", name: "Demo", db: "spellkave-demo1" }]),
		// The held-seat board read (Switch hero) is not part of these fetch counts.
		seatsLoader: vi.fn(async () => []),
		worldOpener,
	});
	return { fetch, accountLoader, worldOpener, handle, disconnect };
}

it("renews expired credentials before the account or world bootstrap", async () => {
	const r = setup(true);
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	expect(r.fetch).toHaveBeenCalledTimes(2);
	expect(r.accountLoader.mock.calls[0]).toEqual([expect.any(String), token("renewed")]);
	expect(r.worldOpener.mock.calls[0]?.[0].token).toBe(token("renewed"));
});

/** Rotate the stored token the way the shared lifecycle does near expiry. */
async function renewSameSubject() {
	store(token("initial"), Date.now() + 1000);
	window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
	await waitFor(() =>
		expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "{}").access_token).toBe(
			token("renewed"),
		),
	);
	// Let the published session reach every effect before asserting absence.
	await new Promise((resolve) => setTimeout(resolve, 50));
}

it("keeps the open world connection and view across a same-subject renewal", async () => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	await fireEvent.click(screen.getByRole("button", { name: "Open Pack" }));
	const pack = document.querySelector("[data-tile=pack]");
	await waitFor(() => expect(pack?.getAttribute("data-zoom")).toBe("stage"));
	await renewSameSubject();
	expect(r.fetch).toHaveBeenCalledTimes(1);
	expect(r.worldOpener).toHaveBeenCalledOnce();
	expect(r.accountLoader).toHaveBeenCalledOnce();
	expect(r.disconnect).not.toHaveBeenCalled();
	expect(document.querySelector("[data-tile=pack]")).toBe(pack);
	expect(pack?.getAttribute("data-zoom")).toBe("stage");
});

it("reconnects a dropped socket with the current token under the mounted view", async () => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	await fireEvent.click(screen.getByRole("button", { name: "Open Pack" }));
	const pack = document.querySelector("[data-tile=pack]");
	await waitFor(() => expect(pack?.getAttribute("data-zoom")).toBe("stage"));
	await renewSameSubject();
	expect(r.worldOpener).toHaveBeenCalledOnce();
	r.worldOpener.mock.calls[0]?.[0].onDisconnect?.(new Error("socket closed"));
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
	expect(r.worldOpener.mock.calls[1]?.[0].token).toBe(token("renewed"));
	expect(r.accountLoader.mock.calls[1]).toEqual([expect.any(String), token("renewed")]);
	expect(r.disconnect).toHaveBeenCalledTimes(1);
	expect(document.querySelector("[data-tile=pack]")).toBe(pack);
	expect(pack?.getAttribute("data-zoom")).toBe("stage");
});

it("shows the error gate when a reconnected socket drops again at once", async () => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	r.worldOpener.mock.calls[0]?.[0].onDisconnect?.(new Error("socket closed"));
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
	r.worldOpener.mock.calls[1]?.[0].onDisconnect?.(new Error("socket closed again"));
	await screen.findByText("socket closed again");
	expect(screen.getByRole("button", { name: "Game status: Disconnected" })).toBeTruthy();
	expect(r.worldOpener).toHaveBeenCalledTimes(2);
});

it.each([
	"retained",
	"changed during reconnect",
	"removed",
] as const)("restores Pack details through the connection that replaced a dropped one: %s", async (scenario) => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	const description = "One day's travel rations.";
	const detail = { id: "13", kind: "Provisions", slot: null, facts: [], verbs: [], description };
	r.handle.selectItem = vi.fn(async (item) => {
		r.worldOpener.mock.calls[0]?.[0].onView({
			...sampleView,
			itemDetail: item?.id === "13" ? detail : sampleView.itemDetail,
		});
	});
	await fireEvent.click(screen.getByRole("button", { name: "Open Pack" }));
	const pack = document.querySelector("[data-tile=pack]");
	await waitFor(() => expect(pack?.getAttribute("data-zoom")).toBe("stage"));
	await fireEvent.click(screen.getByRole("button", { name: /Rations/ }));
	await screen.findByText(description);

	const freshPack = sampleView.pack
		.filter((item) => scenario !== "removed" || item.id !== "13")
		.map((item) => ({ ...item, rev: `${item.rev}-renewed` }));
	const renewedDescription = "Detail read through the replacement connection.";
	const selectItem = vi.fn<PlaySessionHandle["selectItem"]>(async (item) => {
		r.worldOpener.mock.calls[1]?.[0].onView({
			...sampleView,
			pack: freshPack,
			itemDetail: { ...detail, id: item?.id ?? "", description: renewedDescription },
		});
	});
	const act = vi.fn(async () => "unused");
	const replacement = fakeHandle({ selectItem, act });
	let complete!: () => void;
	r.worldOpener.mockImplementationOnce(
		(args) =>
			new Promise((resolve) => {
				complete = () => {
					args.onView({ ...sampleView, pack: freshPack, itemDetail: null });
					resolve(replacement);
				};
			}),
	);
	r.worldOpener.mock.calls[0]?.[0].onDisconnect?.(new Error("socket closed"));
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
	if (scenario === "changed during reconnect") {
		await fireEvent.click(screen.getByRole("button", { name: /Torch/ }));
	}
	complete();
	await waitFor(() => expect(selectItem).toHaveBeenCalledOnce());
	const expectedId =
		scenario === "removed" ? "12" : scenario === "changed during reconnect" ? "14" : "13";
	const expected = freshPack.find((item) => item.id === expectedId);
	if (!expected) throw new Error("Missing expected inventory fixture");
	expect(selectItem).toHaveBeenCalledWith({
		id: expected.id,
		handle: expected.handle,
		rev: expected.rev,
		name: expected.name,
	});
	await screen.findByText(renewedDescription);
	expect(document.querySelector("[data-tile=pack]")).toBe(pack);
	expect(pack?.getAttribute("data-zoom")).toBe("stage");
	expect(act).not.toHaveBeenCalled();
});

it("resets the world after an in-flight action when the subject changes", async () => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	let finishMove!: (value: string) => void;
	const move = vi.fn(
		() =>
			new Promise<string>((resolve) => {
				finishMove = resolve;
			}),
	);
	r.handle.move = move;
	await fireEvent.click(await screen.findByRole("button", { name: "Open Place" }));
	const exit = await screen.findByRole("button", { name: "Stairs (southeast)" });
	await fireEvent.click(exit);
	await fireEvent.keyDown(exit, { key: "1" });
	await waitFor(() => expect(move).toHaveBeenCalledOnce());
	store(token("other", "user_b"), Date.now() + 3_600_000);
	window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
	await new Promise((resolve) => setTimeout(resolve, 50));
	expect(r.worldOpener).toHaveBeenCalledTimes(1);
	expect(r.disconnect).not.toHaveBeenCalled();
	finishMove("You arrive at Stairs.");
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
	expect(move).toHaveBeenCalledOnce();
	expect(r.disconnect).toHaveBeenCalledTimes(1);
	expect(r.worldOpener.mock.calls[1]?.[0].token).toBe(token("other", "user_b"));
	expect(r.accountLoader.mock.calls[1]).toEqual([expect.any(String), token("other", "user_b")]);
});

it("renews an expired but refreshable session on focus without the sign-in gate", async () => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	const table = document.querySelector("[data-tile=pack]");
	expect(table).not.toBeNull();
	let answer!: () => void;
	r.fetch.mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				answer = () =>
					resolve(new Response(JSON.stringify({ access_token: token("woken"), expires_in: 3600 })));
			}),
	);
	// A hidden tab throttled past expiry: the access token lapsed, the grant did not.
	store(token("initial"), Date.now() - 1);
	window.dispatchEvent(new Event("focus"));
	await waitFor(() => expect(r.fetch).toHaveBeenCalledOnce());
	expect(screen.queryByText("Reconnecting your session…")).toBeNull();
	expect(screen.queryByText("Sign in to continue playing.")).toBeNull();
	expect(document.querySelector("[data-tile=pack]")).toBe(table);
	answer();
	await waitFor(() =>
		expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "{}").access_token).toBe(
			token("woken"),
		),
	);
	await new Promise((resolve) => setTimeout(resolve, 50));
	expect(screen.queryByText("Sign in to continue playing.")).toBeNull();
	expect(document.querySelector("[data-tile=pack]")).toBe(table);
	expect(r.worldOpener).toHaveBeenCalledOnce();
	expect(r.disconnect).not.toHaveBeenCalled();
});

function setMarker(on: boolean): void {
	document.cookie = on
		? "sk_signed_in=1; path=/"
		: "sk_signed_in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

it("closes the world session and shows the sign-in gate when the login site's marker disappears (visibility)", async () => {
	setMarker(true);
	try {
		const r = setup();
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		await waitFor(() => expect(sessionStorage.getItem("spellkave.workos.marker-seen")).toBe("1"));
		expect(r.disconnect).not.toHaveBeenCalled();

		setMarker(false);
		document.dispatchEvent(new Event("visibilitychange"));

		await screen.findByText("Sign in to continue playing.");
		expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
		await waitFor(() => expect(r.disconnect).toHaveBeenCalledOnce());
		expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	} finally {
		setMarker(false);
	}
});

it("notices the vanished marker on the 10 s poll", async () => {
	setMarker(true);
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	try {
		const r = setup();
		await waitFor(() => expect(sessionStorage.getItem("spellkave.workos.marker-seen")).toBe("1"));
		await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
		setMarker(false);
		vi.advanceTimersByTime(10_000);
		await screen.findByText("Sign in to continue playing.");
		await waitFor(() => expect(r.disconnect).toHaveBeenCalledOnce());
	} finally {
		vi.useRealTimers();
		setMarker(false);
	}
});

it("does not label a generic recovery read error as an observed socket disconnect", async () => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	r.worldOpener.mockImplementationOnce(async () => r.handle);
	r.worldOpener.mock.calls[0]?.[0].onDisconnect?.(new Error("Socket closed"));
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledTimes(2));
	r.worldOpener.mock.calls[1]?.[0].onError(new Error("Read failed"));
	await waitFor(() => expect(screen.getByText("Read failed")).toBeTruthy());
	expect(screen.queryByRole("button", { name: "Game status: Disconnected" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Game status: Reconnecting" })).toBeNull();
});

it("tracks a real composer attempt at the two-second waiting boundary and clears it on completion", async () => {
	const r = setup();
	await waitFor(() => expect(r.worldOpener).toHaveBeenCalledOnce());
	let finish!: (value: string) => void;
	r.handle.act = vi.fn(
		() =>
			new Promise<string>((resolve) => {
				finish = resolve;
			}),
	);
	r.worldOpener.mock.calls[0]?.[0].onView({ ...sampleView, interactionOrigin: undefined });
	await tick();
	const input = screen.getByRole("combobox", { name: "Compose an intention" });
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	try {
		await fireEvent.input(input, { target: { value: "/srd/sense/look" } });
		await fireEvent.keyDown(input, { key: "Tab" });
		await fireEvent.keyDown(input, { key: "Enter" });
		expect(r.handle.act).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1999);
		await tick();
		expect(screen.queryByRole("button", { name: "Game status: Waiting" })).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		await tick();
		expect(screen.getByRole("button", { name: "Game status: Waiting" })).toBeTruthy();
		expect(screen.getByTestId("dock-help-line").textContent).toContain(
			"The world is still thinking…",
		);
		finish("Action received.");
		await vi.advanceTimersByTimeAsync(0);
		await tick();
		expect(screen.queryByRole("button", { name: "Game status: Waiting" })).toBeNull();
	} finally {
		vi.useRealTimers();
	}
});
