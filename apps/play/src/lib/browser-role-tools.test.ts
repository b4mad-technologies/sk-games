import { snapshotDbFromFixture } from "@spellkave/sdk";
import {
	AUTHOR_OFFLINE_TOOL_NAMES,
	BROWSER_AUTHOR_TOOL_NAMES,
} from "@spellkave/tool-authoring/browser";
import { DESCRIBE_TOOL, GET_TOOL, toolContractsForRole } from "@spellkave/tool-contracts";
import {
	EXPORT_GRANTS_TOOL,
	GRANT_ROLE_TOOL,
	HAND_OVER_ROLE_TOOL,
	LIST_GRANTS_TOOL,
	PREPARE_HAND_OVER_TOOL,
	RENDER_SCENE_TOOL,
	REVOKE_ROLE_TOOL,
	STAGE_SCENE_TOOL,
} from "@spellkave/tool-contracts/schemas";
import type { SpellkaveToolContext } from "@spellkave/tool-player";
import { describe, expect, it, vi } from "vitest";

import { createBrowserRoleTools, createMemoryAuthorWorkspace } from "./browser-role-tools";

function playerContext(): SpellkaveToolContext {
	return {
		db: snapshotDbFromFixture({
			world_time: [{ tick: 1n }],
			visible_manifest_authored_entity: [],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		}),
		act: { actorId: "actor:browser" },
	};
}

describe("browser role tool composition", () => {
	it("binds PLAYER, DM, and AUTHOR in the canonical contract order", () => {
		const tools = createBrowserRoleTools({
			authorizedRoles: ["PLAYER", "DM", "AUTHOR"],
			player: playerContext(),
			author: { workspace: createMemoryAuthorWorkspace() },
		});

		expect(tools.tools.map((tool) => tool.name)).toEqual([
			...toolContractsForRole("PLAYER").map((contract) => contract.name),
			...toolContractsForRole("DM").map((contract) => contract.name),
			...BROWSER_AUTHOR_TOOL_NAMES.filter(
				(name) =>
					AUTHOR_OFFLINE_TOOL_NAMES.includes(name) &&
					name !== GRANT_ROLE_TOOL &&
					name !== RENDER_SCENE_TOOL,
			),
			GET_TOOL,
			DESCRIBE_TOOL,
			GRANT_ROLE_TOOL,
			REVOKE_ROLE_TOOL,
			LIST_GRANTS_TOOL,
			EXPORT_GRANTS_TOOL,
			PREPARE_HAND_OVER_TOOL,
			HAND_OVER_ROLE_TOOL,
			RENDER_SCENE_TOOL,
			STAGE_SCENE_TOOL,
		]);
		expect(tools.byName.has("spellkave_map_graph")).toBe(false);
		expect(tools.byName.has("spellkave_attach_map_layer")).toBe(false);
		expect(tools.byName.has("spellkave_export")).toBe(false);
		expect(tools.byName.has("spellkave_diff")).toBe(false);
		expect(tools.byName.has(GET_TOOL)).toBe(true);
		expect(tools.byName.has(DESCRIBE_TOOL)).toBe(true);
	});

	it("offers scene tools but refuses staging without a selected caller connection", async () => {
		const workspace = createMemoryAuthorWorkspace();
		const tools = createBrowserRoleTools({
			authorizedRoles: ["AUTHOR"],
			player: playerContext(),
			author: { workspace },
		});
		expect(tools.byName.has(RENDER_SCENE_TOOL)).toBe(true);
		expect(tools.byName.has(STAGE_SCENE_TOOL)).toBe(true);
		await expect(
			tools.byName.get(STAGE_SCENE_TOOL)?.execute("scene", {
				plan: {},
				expected_world_instance_id: "fixture-world",
			}),
		).rejects.toThrow("scene staging requires a supporting caller connection");
		expect(workspace.readToml()).toBeNull();
	});

	it("connected grant tools refuse without a caller port and leave the scratch bundle unchanged", async () => {
		const workspace = createMemoryAuthorWorkspace();
		const tools = createBrowserRoleTools({
			authorizedRoles: ["AUTHOR"],
			player: playerContext(),
			author: { workspace },
		});
		for (const [name, params] of [
			[REVOKE_ROLE_TOOL, { binding_id: "unavailable" }],
			[LIST_GRANTS_TOOL, {}],
			[EXPORT_GRANTS_TOOL, {}],
			[PREPARE_HAND_OVER_TOOL, { binding_id: "unavailable", subject: "backup" }],
			[
				HAND_OVER_ROLE_TOOL,
				{
					binding_id: "unavailable",
					subject: "backup",
					expected_digest: "0".repeat(64),
					expected_merged_role_digest: "0".repeat(64),
					expected_incarnation: "unavailable",
					expected_revision: "1",
					request_id: "00000000-0000-4000-8000-000000000001",
					reason: "missing caller port probe",
				},
			],
		] as const) {
			await expect(tools.byName.get(name)?.execute("grant", params)).rejects.toThrow(
				"grant protocol unsupported",
			);
		}
		expect(workspace.readToml()).toBeNull();
	});

	it("get and describe refuse without a publisher read and do not fall back to export", async () => {
		const tools = createBrowserRoleTools({
			authorizedRoles: ["AUTHOR"],
			player: playerContext(),
			author: { workspace: createMemoryAuthorWorkspace() },
		});
		const got = (await tools.byName.get(GET_TOOL)?.execute("t", { kind: "entities" })) as
			| { details?: { ok?: boolean; code?: string } }
			| undefined;
		const described = (await tools.byName.get(DESCRIBE_TOOL)?.execute("t", {
			kind: "entities",
			key: "x",
		})) as { details?: { ok?: boolean; code?: string } } | undefined;
		expect(got?.details).toMatchObject({ ok: false, code: "not_publisher" });
		expect(described?.details).toMatchObject({ ok: false, code: "not_publisher" });
		expect(JSON.stringify(got)).not.toMatch(/export/i);
		expect(JSON.stringify(described)).not.toMatch(/export/i);
	});

	it("executes one authorized tool for every role through the shared runtime", async () => {
		const onFinding = vi.fn();
		const tools = createBrowserRoleTools({
			authorizedRoles: ["PLAYER", "DM", "AUTHOR"],
			player: playerContext(),
			author: { workspace: createMemoryAuthorWorkspace(), onFinding },
		});

		await expect(
			tools.byName.get("spellkave_session_status")?.execute("player", {}),
		).resolves.toBeDefined();
		await expect(tools.byName.get("spellkave_status")?.execute("dm", {})).resolves.toBeDefined();
		await expect(
			tools.byName.get("spellkave_note_doc_gap")?.execute("author", {
				doc: "tool-reference",
				expected: "one shared browser contract",
				actual: "one shared browser contract",
			}),
		).resolves.toBeDefined();
		expect(onFinding).toHaveBeenCalledOnce();
	});

	it("never exposes a role that the product host did not authorize", () => {
		const tools = createBrowserRoleTools({
			authorizedRoles: ["PLAYER"],
			player: playerContext(),
		});

		expect(tools.tools.map((tool) => tool.name)).toEqual(
			toolContractsForRole("PLAYER").map((contract) => contract.name),
		);
		expect(tools.byName.has("spellkave_status")).toBe(false);
		expect(tools.byName.has("spellkave_docs")).toBe(false);
		for (const name of [
			GRANT_ROLE_TOOL,
			REVOKE_ROLE_TOOL,
			LIST_GRANTS_TOOL,
			EXPORT_GRANTS_TOOL,
			PREPARE_HAND_OVER_TOOL,
			HAND_OVER_ROLE_TOOL,
		]) {
			expect(tools.byName.has(name)).toBe(false);
		}
	});
});
