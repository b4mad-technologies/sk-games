import { expect, it, vi } from "vitest";
import { openPlaySession } from "./play-session";

const state = vi.hoisted(() => ({
	disconnect: undefined as undefined | ((error?: Error) => void),
	live: undefined as unknown,
	tools: new Map<string, { execute: ReturnType<typeof vi.fn> }>(),
}));
vi.mock("@spellkave/session", () => ({
	openSession: vi.fn((_binding, callbacks) => {
		state.disconnect = callbacks.onDisconnect;
		return state.live === undefined ? new Promise(() => {}) : Promise.resolve(state.live);
	}),
	PLAY_CONNECT_PHASE_TIMEOUT_MS: 30_000,
}));
vi.mock("./browser-role-tools", () => ({
	createLiveBrowserRoleTools: async () => ({ byName: state.tools }),
}));

it("reports a clean unexpected socket close instead of retaining a ready screen", () => {
	const onError = vi.fn();
	void openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError,
	});
	state.disconnect?.();
	expect(onError).toHaveBeenCalledWith(
		expect.objectContaining({ message: expect.stringMatching(/connection.*closed/i) }),
	);
});

it("routes a socket drop to onDisconnect instead of onError when the caller handles reconnects", () => {
	const onError = vi.fn();
	const onDisconnect = vi.fn();
	void openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView: vi.fn(),
		onError,
		onDisconnect,
	});
	state.disconnect?.();
	expect(onDisconnect).toHaveBeenCalledWith(
		expect.objectContaining({ message: expect.stringMatching(/connection.*closed/i) }),
	);
	expect(onError).not.toHaveBeenCalled();
});

it("does not publish an in-flight read or dispatch a write after disconnect", async () => {
	state.live = {
		actorId: "1",
		session: {
			conn: {
				db: {
					visible_entity_tag: { iter: () => [] },
					visible_entity_tag_coverage: {
						iter: () => [{ status: "complete", projectionVersion: 1 }],
					},
				},
			},
			worldEvents: { diffAndAdvance: () => [] },
		},
		onUpdate: () => () => {},
		close: vi.fn(),
	};
	const onView = vi.fn();
	const handle = await openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView,
		onError: vi.fn(),
	});
	let finish!: (value: unknown) => void;
	state.tools.set("spellkave_scene", {
		execute: vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		),
	});
	const write = vi.fn();
	state.tools.set("spellkave_end_turn", { execute: write });
	const refresh = handle.refresh();
	state.disconnect?.();
	onView.mockClear();
	finish({ details: {} });
	await refresh;
	expect(onView).not.toHaveBeenCalled();
	await expect(handle.endTurn()).rejects.toThrow(/connection.*closed/i);
	expect(write).not.toHaveBeenCalled();
	handle.disconnect();
});
