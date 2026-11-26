import { beforeEach, expect, it, vi } from "vitest";
import { openPlaySession } from "./play-session";
import { packFromPayload } from "./play-view";

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

beforeEach(() => tools.clear());

it.each([
	"ready",
	"failed",
	"cleared",
])("preserves current item detail when a delayed map becomes %s", async (outcome) => {
	let release!: (value: unknown) => void;
	const map = new Promise((resolve) => {
		release = resolve;
	});
	tools.set("spellkave_map", { execute: vi.fn(() => map) });
	tools.set("spellkave_item_detail", {
		execute: vi.fn(async () => ({
			details: { status: "ok", item: { entity_id: "42", kind: "item", states: [] } },
		})),
	});
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
	try {
		await handle.selectItem({ id: "i:selected", handle: "i:selected", rev: "r1", name: "Rations" });
		if (outcome === "cleared") {
			await handle.refresh();
			await handle.selectItem(null);
		}
		const expected = onView.mock.lastCall?.[0].itemDetail;
		if (outcome === "cleared") expect(expected).toBeNull();
		else expect(expected).toMatchObject({ id: "i:selected", entityId: "42" });
		onView.mockClear();
		release(outcome === "failed" ? null : { details: { svg: "<svg></svg>" } });
		await vi.waitFor(() => expect(onView).toHaveBeenCalled());
		for (const [view] of onView.mock.calls) expect(view.itemDetail).toEqual(expected);
		expect(onView.mock.lastCall?.[0].mapState).toBe(outcome === "failed" ? "failed" : "ready");
	} finally {
		handle.disconnect();
	}
});

it("keeps same-name tree items distinct and joins authorized detail to the selected row", async () => {
	const pack = packFromPayload({
		items: [
			{ handle: "i:first", rev: "r1", name: "Torch" },
			{ handle: "i:second", rev: "r2", name: "Torch" },
		],
	});
	expect(pack.map((item) => item.id)).toEqual(["i:first", "i:second"]);
	tools.set("spellkave_item_detail", {
		execute: vi.fn(async () => ({
			details: {
				status: "ok",
				item: { entity_id: "42", kind: "item", states: [] },
			},
		})),
	});
	const actions = vi.fn(async () => ({
		manipulation_context: {
			status: "ready",
			schema_version: 1,
			revision: 1,
			actions: [{ action_id: "inspect", display_name: "Inspect" }],
			targets: ["item:42", "entity:42", "entity:99"].map((target_ref) => ({
				target_ref,
				target_fact_id: target_ref,
			})),
			participants: [],
		},
	}));
	tools.set("spellkave_manipulation_context", { execute: actions });
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
	try {
		await handle.selectItem(pack[1]!);
		expect(actions).toHaveBeenCalledTimes(1);
		expect(actions).toHaveBeenCalledWith("play", { detail: "full" });
		expect(onView.mock.lastCall?.[0].itemDetail).toMatchObject({
			id: "i:second",
			entityId: "42",
			verbs: [
				{ id: "factored:inspect:item:42", targetRef: "item:42" },
				{ id: "factored:inspect:entity:42", targetRef: "entity:42" },
			],
		});
		await handle.refresh();
		expect(onView.mock.lastCall?.[0].itemDetail.id).toBe("i:second");
	} finally {
		handle.disconnect();
	}
});

it.each(["replace", "cancel"])("discards late detail after selection %s", async (change) => {
	let release!: (value: unknown) => void;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const detailRead = vi.fn(async (_call, { handle }) =>
		handle === "i:first"
			? pending
			: {
					details: {
						status: "ok",
						item: { entity_id: "42", kind: "item", states: [] },
					},
				},
	);
	tools.set("spellkave_item_detail", { execute: detailRead });
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
	try {
		const first = handle.selectItem({ id: "i:first", handle: "i:first", rev: "r1", name: "Torch" });
		await vi.waitFor(() =>
			expect(detailRead).toHaveBeenCalledWith("play", { handle: "i:first", rev: "r1" }),
		);
		await handle.selectItem(
			change === "cancel" ? null : { id: "i:second", handle: "i:second", rev: "r2", name: "Torch" },
		);
		release({
			details: {
				status: "ok",
				item: { entity_id: "41", kind: "item", states: [] },
			},
		});
		await first;
		const detail = onView.mock.lastCall?.[0].itemDetail;
		if (change === "cancel") expect(detail).toBeNull();
		else expect(detail).toMatchObject({ id: "i:second", entityId: "42", verbs: [] });
	} finally {
		handle.disconnect();
	}
});

it("keeps participant-based item candidates current when factual context changes", async () => {
	let participates = true;
	tools.set("spellkave_item_detail", {
		execute: vi.fn(async () => ({
			status: "ok",
			item: { entity_id: "42", kind: "item", states: [] },
		})),
	});
	tools.set("spellkave_manipulation_context", {
		execute: vi.fn(async () => ({
			manipulation_context: {
				status: "ready",
				schema_version: 1,
				revision: participates ? 1 : 2,
				actions: [{ action_id: "orbital/repair", display_name: "Repair" }],
				targets: [{ target_fact_id: "beacon", target_ref: "entity:99" }],
				participants: participates
					? [
							{
								context_id: "mpc:1",
								action_id: "orbital/repair",
								binding_count: 1,
								bindings: [{ role_id: "tool", entity_id: "42" }],
							},
						]
					: [],
			},
		})),
	});
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
	try {
		await handle.selectItem({ id: "i:42", handle: "i:42", rev: "r1", name: "Repair kit" });
		expect(onView.mock.lastCall?.[0].itemDetail.verbs).toEqual([
			expect.objectContaining({ descriptor: "orbital/repair", targetRef: "entity:99" }),
		]);
		participates = false;
		await handle.refresh();
		expect(onView.mock.lastCall?.[0].itemDetail.verbs).toEqual([]);
	} finally {
		handle.disconnect();
	}
});
