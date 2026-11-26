import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openPlaySession } from "./play-session";

const tools = vi.hoisted(() => new Map<string, { execute: ReturnType<typeof vi.fn> }>());
vi.mock("@spellkave/session", () => ({
	openSession: async () => ({
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
	}),
	PLAY_CONNECT_PHASE_TIMEOUT_MS: 30_000,
}));
vi.mock("./browser-role-tools", () => ({
	createLiveBrowserRoleTools: async () => ({ byName: tools }),
}));
beforeEach(() => {
	tools.clear();
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const open = (onView: ReturnType<typeof vi.fn>) =>
	openPlaySession({
		url: "http://localhost:9450",
		db: "test",
		token: "test",
		actorId: "1",
		authorizedToolRoles: ["PLAYER"],
		onView,
		onError: vi.fn(),
	});

it("follows the observed operation through scheduled completion and stops polling on disconnect", async () => {
	let phase = "active";
	const execute = vi.fn(async (_call: string, params: Record<string, unknown>) => ({
		details: params.detail
			? {
					status: "session_detail",
					session: {
						session_id: "7",
						lifecycle: phase,
						timing: {
							basis: "world_ticks",
							duration_ticks: "4",
							estimated_remaining_ticks: phase === "active" ? "4" : "0",
						},
					},
					ongoing: {
						items: phase === "active" ? [{ session_id: "7", lifecycle: phase }] : [],
						matched: phase === "active" ? 1 : 0,
						next_cursor: null,
					},
				}
			: { session: null },
	}));
	tools.set("spellkave_session_status", { execute });
	const onView = vi.fn();
	const handle = await open(onView);
	try {
		expect(onView.mock.lastCall?.[0].operations.selected.phase).toBe("active");
		phase = "completed";
		await vi.advanceTimersByTimeAsync(5000);
		expect(execute).toHaveBeenCalledWith("play", { detail: true, session_id: "7" });
		expect(onView.mock.lastCall?.[0].operations.selected).toMatchObject({
			phase: "completed",
			terminal: true,
		});
	} finally {
		handle.disconnect();
	}
	const count = execute.mock.calls.length;
	await vi.advanceTimersByTimeAsync(15000);
	expect(execute).toHaveBeenCalledTimes(count);
});

it("only selects activity ids and cursors already supplied by the authorized page", async () => {
	const execute = vi.fn(async (_call: string, params: Record<string, unknown>) => ({
		details: params.detail
			? {
					status: "session_detail",
					session: { session_id: params.session_id ?? "7", lifecycle: "active" },
					ongoing: {
						items: [
							{ session_id: "7", lifecycle: "active" },
							{ session_id: "12", lifecycle: "active" },
						],
						matched: 3,
						next_cursor: "page-next",
					},
				}
			: { session: null },
	}));
	tools.set("spellkave_session_status", { execute });
	const handle = await open(vi.fn());
	try {
		const count = execute.mock.calls.length;
		await handle.selectOperation?.("999");
		await handle.selectOperation?.("7", "foreign-cursor");
		expect(execute).toHaveBeenCalledTimes(count);
		await handle.selectOperation?.("12");
		expect(execute).toHaveBeenCalledWith("play", { detail: true, session_id: "12" });
		await handle.selectOperation?.("12", "page-next");
		expect(execute).toHaveBeenCalledWith("play", {
			detail: true,
			session_id: "12",
			cursor: "page-next",
		});
	} finally {
		handle.disconnect();
	}
});

it("keeps a stationary world-time estimate unchanged across wall-clock polls and read recovery", async () => {
	let unavailable = false;
	const execute = vi.fn(async (_call: string, params: Record<string, unknown>) => {
		if (!params.detail) return { details: { session: null } };
		if (unavailable) throw new Error("temporary detail read failure");
		return {
			details: {
				status: "session_detail",
				session: {
					session_id: "7",
					lifecycle: "active",
					timing: {
						basis: "world_ticks",
						observed_at: "11",
						opened_at: "10",
						duration_ticks: "4",
						estimated_remaining_ticks: "3",
					},
				},
				ongoing: {
					items: [{ session_id: "7", lifecycle: "active" }],
					matched: 1,
					next_cursor: null,
				},
			},
		};
	});
	tools.set("spellkave_session_status", { execute });
	const onView = vi.fn();
	const handle = await open(onView);
	try {
		await vi.advanceTimersByTimeAsync(60000);
		expect(onView.mock.lastCall?.[0].operations.selected).toMatchObject({
			phase: "active",
			progress: 25,
			terminal: false,
			clockUnchanged: true,
		});
		unavailable = true;
		await vi.advanceTimersByTimeAsync(5000);
		expect(onView.mock.lastCall?.[0].operations.state).toBe("failed");
		unavailable = false;
		await vi.advanceTimersByTimeAsync(5000);
		expect(execute).toHaveBeenLastCalledWith("play", { detail: true, session_id: "7" });
		expect(onView.mock.lastCall?.[0].operations).toMatchObject({
			state: "ready",
			selected: { id: "7", progress: 25, terminal: false },
		});
	} finally {
		handle.disconnect();
	}
});
