import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { requireLoginOrigin } from "@spellkave/authkit/vite";
import { spellkaveThemeBoot } from "@spellkave/ui/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { parse as parseToml } from "smol-toml";
import { loadEnv } from "vite";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import { localRumPlugin } from "./rum-local.ts";
import { readLocalRumConfig, readLocalRumUpstream } from "./src/lib/local-rum-config.ts";

/**
 * DEV-only: resolve a local-play config from a `just play-stage` profile TOML.
 *
 * One knob instead of four. The profile that `just play-stage <adventure>`
 * already writes carries the node url, the module name, the staged hero's
 * entity id and the path to its minted credential, so pointing at that file is
 * enough to play the world you just staged. See `src/lib/dev-local.ts` for why
 * this exists at all, and `apps/maps/vite.config.ts` for the precedent.
 *
 * Every failure warns and returns `null`: a broken rig must read as "no local
 * play", never as a half-built session that fails deep inside the SDK.
 */
function readDevLocal(mode: string): string | null {
	if (mode === "production") return null;
	const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
	const profilePath = env.SPELLKAVE_DEV_PROFILE?.trim() ?? "";
	if (profilePath === "") return null;

	const abs = resolve(profilePath);
	if (!existsSync(abs)) {
		console.warn(`[play] SPELLKAVE_DEV_PROFILE not found: ${abs}`);
		return null;
	}

	let profile: Record<string, unknown>;
	try {
		profile = parseToml(readFileSync(abs, "utf8")) as Record<string, unknown>;
	} catch (cause) {
		console.warn(`[play] SPELLKAVE_DEV_PROFILE is not valid TOML: ${abs} (${String(cause)})`);
		return null;
	}

	const connection = (profile.connection ?? {}) as Record<string, unknown>;
	const identity = (profile.identity ?? {}) as Record<string, unknown>;
	const credential = (identity.credential ?? {}) as Record<string, unknown>;

	const url = typeof connection.url === "string" ? connection.url : "";
	const db = typeof connection.db === "string" ? connection.db : "";
	const actorId = typeof identity.in_world_self === "string" ? identity.in_world_self : "";
	const tokenPath = typeof credential.path === "string" ? credential.path : "";
	if (url === "" || db === "" || actorId === "" || tokenPath === "") {
		console.warn(`[play] SPELLKAVE_DEV_PROFILE is missing connection/identity fields: ${abs}`);
		return null;
	}

	// sk-jay0.7.35: `just play-stage` writes this profile per-adventure, not
	// per-worktree (docs/development.md, parallel worktrees) — a sibling
	// worktree staging the same adventure into the SHARED
	// `~/.config/spellkave/profiles/` copy can repoint it at another node.
	// `just play-dev-local` already guards this before it ever launches vite;
	// this is the same check run again here so a stale profile still cannot
	// silently wire up a session against the wrong node on a hot vite restart
	// (the original failure mode: vite kept the old profile in memory and only
	// re-read this file, and so only broke, on its next restart).
	const worktreeUrl = env.SPELLKAVE_URL?.trim() ?? "";
	if (worktreeUrl !== "" && url !== worktreeUrl) {
		console.warn(
			`[play] SPELLKAVE_DEV_PROFILE at ${abs} points at '${url}', but this worktree's node is '${worktreeUrl}' — re-run 'just play-stage' in this worktree`,
		);
		return null;
	}

	const tokenAbs = resolve(dirname(abs), tokenPath);
	if (!existsSync(tokenAbs)) {
		console.warn(`[play] play-stage credential not found: ${tokenAbs} — re-run 'just play-stage'`);
		return null;
	}

	// The profile is named after its adventure (elven-mini-candidate.toml), and
	// play-stage keeps the credential under .local/player-credentials/<slug>/,
	// so the slug is the credential directory rather than a fifth env var.
	const slug = env.SPELLKAVE_DEV_SLUG?.trim() || basename(dirname(tokenAbs));
	console.info(`[play] local play enabled: ${slug} @ ${url}/${db} as actor ${actorId}`);
	return JSON.stringify({
		url,
		db,
		actorId,
		token: readFileSync(tokenAbs, "utf8").trim(),
		slug,
		displayName: env.SPELLKAVE_DEV_WORLD_NAME?.trim() || slug,
	});
}

/**
 * Serve the resolved config as a real module rather than a `define`.
 *
 * Vite 8 does not text-substitute `define` for a bare identifier in the
 * dev-served module — verified 2026-08-27: the config resolved and logged, and
 * `__SPELLKAVE_DEV_LOCAL__` still reached the browser unreplaced. A virtual
 * module behaves the same in dev, in a production build and under vitest, so
 * the value cannot silently go missing in exactly the mode that needs it.
 */
const DEV_LOCAL_ID = "virtual:spellkave-dev-local";

function devLocalModule(devLocal: string | null): NonNullable<ViteUserConfig["plugins"]>[number] {
	const resolved = `\0${DEV_LOCAL_ID}`;
	return {
		name: "spellkave-dev-local",
		resolveId: (source: string) => (source === DEV_LOCAL_ID ? resolved : null),
		load: (id: string) =>
			id === resolved ? `export default ${JSON.stringify(devLocal)};\n` : null,
	};
}

/**
 * DEV-only: resolve the local browser producer for `world_actor_run_events`
 * (sk-jay0.6.39) from shell env — the same "one generated/derived value
 * instead of hand-copied vars" idiom `readDevLocal` above uses.
 *
 * `enabled` requires ALL of: the flag (`VITE_SPELLKAVE_RUN_EVENTS` or the
 * non-prefixed `SPELLKAVE_RUN_EVENTS`, either `otlp` or `jsonl+otlp` — the
 * same vocabulary the Node bootstrap reads,
 * `.agents/skills/sk-o11y/references/instrumentation.md`)
 * AND a configured `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT` AND a non-empty
 * `SPELLKAVE_WORLD_SLUG` AND `mode !== "production"`. Any missing piece
 * degrades to "off", exactly like an empty endpoint degrades the Node
 * bootstrap to "network projection disabled" — never a half-built export
 * path. The collector endpoint itself is returned separately
 * (`proxyTarget`) and never reaches the client config below: it is
 * `server.proxy`'s target only, so the browser bundle never carries a
 * collector address.
 */
function readRunEvents(mode: string): {
	enabled: boolean;
	worldSlug: string;
	proxyTarget: URL | null;
} {
	if (mode === "production") return { enabled: false, worldSlug: "", proxyTarget: null };
	const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
	const flag = (env.VITE_SPELLKAVE_RUN_EVENTS ?? env.SPELLKAVE_RUN_EVENTS ?? "").trim();
	const flagEnabled = flag === "otlp" || flag === "jsonl+otlp";
	const worldSlug = env.SPELLKAVE_WORLD_SLUG?.trim() ?? "";
	if (!flagEnabled) return { enabled: false, worldSlug, proxyTarget: null };

	const endpointRaw = env.SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT?.trim() ?? "";
	if (endpointRaw === "") {
		console.warn(
			"[play] SPELLKAVE_RUN_EVENTS=otlp but SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT is unset — run-events telemetry stays off",
		);
		return { enabled: false, worldSlug, proxyTarget: null };
	}
	if (worldSlug === "") {
		console.warn(
			"[play] SPELLKAVE_RUN_EVENTS=otlp but SPELLKAVE_WORLD_SLUG is unset — run-events telemetry stays off",
		);
		return { enabled: false, worldSlug, proxyTarget: null };
	}

	let proxyTarget: URL;
	try {
		proxyTarget = new URL(endpointRaw);
	} catch (cause) {
		console.warn(
			`[play] SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT is not a valid URL: ${endpointRaw} (${String(cause)})`,
		);
		return { enabled: false, worldSlug, proxyTarget: null };
	}

	console.info(
		`[play] run-events telemetry enabled: world ${worldSlug} → /otlp → ${proxyTarget.origin}${proxyTarget.pathname}`,
	);
	return { enabled: true, worldSlug, proxyTarget };
}

const RUN_EVENTS_CONFIG_ID = "virtual:spellkave-run-events-config";

function runEventsConfigModule(config: {
	enabled: boolean;
	worldSlug: string;
}): NonNullable<ViteUserConfig["plugins"]>[number] {
	const resolved = `\0${RUN_EVENTS_CONFIG_ID}`;
	const serialized = JSON.stringify(JSON.stringify(config));
	return {
		name: "spellkave-run-events-config",
		resolveId: (source: string) => (source === RUN_EVENTS_CONFIG_ID ? resolved : null),
		load: (id: string) => (id === resolved ? `export default ${serialized};\n` : null),
	};
}

/** SDK connect-time shape check mode (sk-jay0.7.389.3): a typo must fail the build, never ship a strict bundle silently. */
function requireShapeCheckMode(mode: string): void {
	const value =
		{ ...loadEnv(mode, process.cwd(), ""), ...process.env }.VITE_SPELLKAVE_SHAPE_CHECK ?? "";
	if (value !== "" && value !== "strict" && value !== "warn") {
		throw new Error(
			`VITE_SPELLKAVE_SHAPE_CHECK must be "strict" or "warn" (or unset), got ${JSON.stringify(value)}`,
		);
	}
}

export default defineConfig(({ mode }) => {
	requireShapeCheckMode(mode);
	const devLocal = readDevLocal(mode);
	const runEvents = readRunEvents(mode);
	const localRum = readLocalRumConfig(
		{ ...loadEnv(mode, process.cwd(), ""), ...process.env },
		mode,
		devLocal !== null,
	);
	return {
		base: "/",
		build: {
			rollupOptions: {
				input: { main: resolve("index.html"), playground: resolve("playground.html") },
			},
		},
		plugins: [
			localRumPlugin(localRum, readLocalRumUpstream({ ...loadEnv(mode, process.cwd(), ""), ...process.env })),
			requireLoginOrigin(),
			spellkaveThemeBoot(),
			tailwindcss(),
			svelte(),
			svelteTesting(),
			devLocalModule(devLocal),
			runEventsConfigModule({ enabled: runEvents.enabled, worldSlug: runEvents.worldSlug }),
		] as ViteUserConfig["plugins"],
		server: {
			proxy: runEvents.proxyTarget
				? {
						// Browser posts to the relative `/otlp` path only — the
						// collector address never reaches the client bundle, it lives
						// here, server-side, as the proxy target.
						"/otlp": {
							target: runEvents.proxyTarget.origin,
							changeOrigin: true,
							rewrite: (path: string) =>
								path.replace(/^\/otlp/, (runEvents.proxyTarget as URL).pathname),
						},
					}
				: undefined,
		},
		test: {
			environment: "jsdom",
			include: ["src/**/*.test.ts", "*.test.ts"],
			setupFiles: ["src/test/setup.ts", "@spellkave/ui/vitest-jsdom-teardown"],
		},
	};
});
