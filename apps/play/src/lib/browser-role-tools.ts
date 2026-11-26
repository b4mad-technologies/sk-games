import { snapshotDb } from "@spellkave/sdk";
import type { LiveSession } from "@spellkave/session";
import {
	type AuthorToolContext,
	type AuthorWorkspace,
	createBrowserAuthorFacingBoundTools,
	initializeBrowserAuthorTools,
} from "@spellkave/tool-authoring/browser";
import { type ToolRole, toolContractsForRole } from "@spellkave/tool-contracts";
import {
	createDmExtensionTools,
	createPlayerFacingTools,
	type SpellkaveToolContext,
} from "@spellkave/tool-player";
import type { BoundTool } from "@spellkave/tool-runtime";
import type { TSchema } from "typebox";

export type BrowserRoleTool = BoundTool<TSchema, unknown>;

/** Authorization is supplied by the product host; this composition never infers it. */
export interface BrowserRoleToolContexts {
	readonly authorizedRoles: readonly ToolRole[];
	readonly player: SpellkaveToolContext;
	readonly author?: AuthorToolContext;
}

export interface BrowserRoleToolSet {
	readonly authorizedRoles: readonly ToolRole[];
	readonly tools: readonly BrowserRoleTool[];
	readonly byName: ReadonlyMap<string, BrowserRoleTool>;
}

export interface LiveBrowserRoleToolArgs {
	/** The one open session (`@spellkave/session`'s `openSession`), actor client included. */
	readonly live: LiveSession;
	readonly authorizedRoles: readonly ToolRole[];
	readonly authorWorkspace?: AuthorWorkspace;
}

/** Bind each authorized role in its canonical contract order, without a browser roster copy. */
export function createBrowserRoleTools(contexts: BrowserRoleToolContexts): BrowserRoleToolSet {
	const implementations = new Map<string, BrowserRoleTool>();
	const add = (tools: readonly BrowserRoleTool[]): void => {
		for (const tool of tools) implementations.set(tool.name, tool);
	};

	if (contexts.authorizedRoles.includes("PLAYER")) add(createPlayerFacingTools(contexts.player));
	if (contexts.authorizedRoles.includes("DM")) add(createDmExtensionTools(contexts.player));
	if (contexts.authorizedRoles.includes("AUTHOR")) {
		if (contexts.author === undefined) {
			throw new Error("AUTHOR tools require an explicit browser author context.");
		}
		add(createBrowserAuthorFacingBoundTools(contexts.author));
	}

	const tools = contexts.authorizedRoles.flatMap((role) =>
		toolContractsForRole(role).flatMap((contract) => {
			const tool = implementations.get(contract.name);
			if (tool === undefined) {
				if (role === "AUTHOR") return [];
				throw new Error(`${role} contract '${contract.name}' has no browser execution body.`);
			}
			return [tool];
		}),
	);
	return {
		authorizedRoles: [...contexts.authorizedRoles],
		tools,
		byName: new Map(tools.map((tool) => [tool.name, tool])),
	};
}

/** Own the browser scratch bundle in memory; persistence remains a host policy. */
export function createMemoryAuthorWorkspace(initialToml: string | null = null): AuthorWorkspace {
	let toml = initialToml;
	return {
		readToml: () => toml,
		writeToml(nextToml) {
			toml = nextToml;
			return "browser-memory";
		},
	};
}

/** Compose every authorized role over the page's one open session — the same
 * `ActorClient` `openSession` built (with `successOnProvenance`), never a second one. */
export async function createLiveBrowserRoleTools(
	args: LiveBrowserRoleToolArgs,
): Promise<BrowserRoleToolSet> {
	const session = args.live.session;
	const player: SpellkaveToolContext = {
		db: () => snapshotDb(session),
		act: { actorId: args.live.actorId, actorClient: args.live.actorClient },
		worldEvents: {
			builder: session.worldEvents,
			replyDelivery: "events",
			estimator: session.estimator,
		},
	};

	let author: AuthorToolContext | undefined;
	if (args.authorizedRoles.includes("AUTHOR")) {
		await initializeBrowserAuthorTools();
		const applyDelta = async (toml: string): Promise<{ ok: boolean; detail?: string }> => {
			try {
				await session.conn.reducers.rApplyManifestDelta({ toml });
				return { ok: true };
			} catch (cause) {
				return { ok: false, detail: cause instanceof Error ? cause.message : String(cause) };
			}
		};
		author = {
			workspace: args.authorWorkspace ?? createMemoryAuthorWorkspace(),
			applyDelta,
		};
	}

	return createBrowserRoleTools({ authorizedRoles: args.authorizedRoles, player, author });
}
