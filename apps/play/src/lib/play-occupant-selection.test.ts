import { beforeEach, expect, it, vi } from "vitest";
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

beforeEach(() => tools.clear());

// keep(K2): injected tools control revision changes and withdrawal at the browser host boundary.
it("refreshes selected contents on revision changes and clears withdrawn children", async () => {
	let rev = "open";
	let visible = true;
	const contents = () => ({
		container_ref: "entity:4",
		scope: "direct",
		revision: rev,
		status: visible ? "available" : "unavailable",
		items: visible
			? [
					{
						target_ref: "item:9",
						parent_ref: "entity:4",
						name: "Gem",
						quantity: 2,
						entity_def_id: "gem",
					},
				]
			: [],
	});
	tools.set("spellkave_scene", {
		execute: vi.fn(async () => ({
			details: {
				scene_resolved: true,
				node_id: "room",
				items: [{ kind: "entity", id: "4", label: "Chest", handle: "s:entity:4", rev }],
			},
		})),
	});
	const detailRead = vi.fn(async (_call, params) => {
		if (params.target_id)
			return visible
				? sceneTarget("9", "s:item:9", "child")
				: { details: { status: "unknown_target" } };
		const result = sceneTarget("4", "s:entity:4", rev);
		return {
			details: {
				...result.details,
				target: {
					...result.details.target,
					detail: { ...result.details.target.detail, contents: contents() },
				},
			},
		};
	});
	tools.set("spellkave_scene_detail", { execute: detailRead });
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
		await handle.selectOccupant?.({ id: "4", handle: "s:entity:4", rev, name: "Chest" });
		expect(onView.mock.lastCall?.[0].occupantDetail.contents).toMatchObject({
			status: "available",
			items: [{ name: "Gem", quantity: 2 }],
		});
		await handle.refresh();
		expect(detailRead).toHaveBeenCalledTimes(1);
		rev = "closed";
		visible = false;
		await handle.refresh();
		expect(onView.mock.lastCall?.[0].occupantDetail.contents).toMatchObject({
			status: "unavailable",
			items: [],
		});
		visible = true;
		await handle.selectOccupant?.({ id: "9", targetRef: "item:9", name: "Gem" });
		expect(detailRead).toHaveBeenLastCalledWith("play", { target_id: "item:9" });
		expect(onView.mock.lastCall?.[0].occupantDetail.entityId).toBe("9");
		visible = false;
		await handle.refresh();
		expect(onView.mock.lastCall?.[0].occupantDetail).toBeNull();
	} finally {
		handle.disconnect();
	}
});

function sceneTarget(id: string, handle: string, rev: string) {
	return {
		details: {
			status: "ok",
			handle,
			rev,
			target: {
				kind: "actor",
				id,
				label: "Aldwin",
				detail: { entity_id: id, description: "Keeper." },
			},
		},
	};
}

it("does not use the selection id as an action target when scene_detail fails", async () => {
	tools.set("spellkave_scene_detail", {
		execute: vi.fn(async () => ({ details: { status: "error" } })),
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
		await handle.selectOccupant?.({ id: "4", handle: "s:actor:4", rev: "a4", name: "Aldwin" });
		expect(onView.mock.lastCall?.[0].occupantDetail).toMatchObject({
			id: "4",
			failed: true,
			verbs: [],
		});
	} finally {
		handle.disconnect();
	}
});

it("selects direct candidates by authorized entity id without further discovery reads", async () => {
	tools.set("spellkave_scene_detail", {
		execute: vi.fn(async () => sceneTarget("42", "s:entity:31", "e31")),
	});
	const actions = vi.fn(async () => ({
		manipulation_context: {
			status: "ready",
			schema_version: 1,
			revision: 1,
			actions: [{ action_id: "inspect", display_name: "Inspect" }],
			targets: ["item:42", "entity:42", "entity:31"].map((target_ref) => ({
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
		await handle.selectOccupant?.({ id: "31", handle: "s:entity:31", rev: "e31", name: "Hearth" });
		expect(actions).toHaveBeenCalledTimes(1);
		expect(actions).toHaveBeenCalledWith("play", { detail: "full" });
		expect(onView.mock.lastCall?.[0].occupantDetail).toMatchObject({
			id: "31",
			entityId: "42",
			verbs: [
				{ id: "factored:inspect:item:42", targetRef: "item:42" },
				{ id: "factored:inspect:entity:42", targetRef: "entity:42" },
			],
		});
	} finally {
		handle.disconnect();
	}
});

it.each([
	"replace",
	"cancel",
])("discards late occupant detail after selection %s", async (change) => {
	let release!: (value: unknown) => void;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const detailRead = vi.fn(async (_call, { handle }) =>
		handle === "s:actor:4" ? pending : sceneTarget("9", handle, "a9"),
	);
	tools.set("spellkave_scene_detail", { execute: detailRead });
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
		const first = handle.selectOccupant?.({
			id: "4",
			handle: "s:actor:4",
			rev: "a4",
			name: "Aldwin",
		});
		await vi.waitFor(() =>
			expect(detailRead).toHaveBeenCalledWith("play", { handle: "s:actor:4", rev: "a4" }),
		);
		await handle.selectOccupant?.(
			change === "cancel" ? null : { id: "9", handle: "s:actor:9", rev: "a9", name: "Caddoc" },
		);
		release(sceneTarget("4", "s:actor:4", "a4"));
		await first;
		const detail = onView.mock.lastCall?.[0].occupantDetail;
		if (change === "cancel") expect(detail).toBeNull();
		else expect(detail).toMatchObject({ id: "9", entityId: "9", verbs: [] });
	} finally {
		handle.disconnect();
	}
});

it("clears stale occupant actions when the same id is re-read at a new revision", async () => {
	tools.set("spellkave_scene_detail", {
		execute: vi.fn(async (_call, { rev }) => sceneTarget("4", "s:actor:4", rev)),
	});
	const actions = vi.fn(async () => ({
		manipulation_context: {
			status: "ready",
			schema_version: 1,
			revision: 1,
			actions: [{ action_id: "inspect", display_name: "Inspect" }],
			targets: [{ target_fact_id: "entity:4", target_ref: "entity:4" }],
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
		await handle.selectOccupant?.({ id: "4", handle: "s:actor:4", rev: "a4", name: "Aldwin" });
		expect(onView.mock.lastCall?.[0].occupantDetail.verbs).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "factored:inspect:entity:4" })]),
		);
		const pending = handle.selectOccupant?.({
			id: "4",
			handle: "s:actor:4",
			rev: "a5",
			name: "Aldwin",
		});
		await vi.waitFor(() =>
			expect(onView.mock.calls.some((call) => call[0].occupantDetail === null)).toBe(true),
		);
		await pending;
		expect(onView.mock.lastCall?.[0].occupantDetail).toMatchObject({ id: "4", rev: "a5" });
	} finally {
		handle.disconnect();
	}
});
