import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spellkaveThemeBoot } from "@spellkave/ui/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { parse as parseToml } from "smol-toml";
import type { Plugin } from "vite";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Serve a constant as a virtual module (same reason as apps/play/vite.config.ts:
 * a `define` is not substituted for a bare identifier in the dev server). */
function constantModule(id: string, value: unknown): Plugin {
	const resolved = `\0${id}`;
	return {
		name: `classic:${id}`,
		resolveId: (source) => (source === id ? resolved : null),
		load: (source) => (source === resolved ? `export default ${JSON.stringify(value)};\n` : null),
	};
}

/**
 * DEV-only: play the world `just play-stage <adventure>` staged, from the same
 * profile TOML `just play-dev-local` reads (apps/play/src/lib/dev-local.ts).
 * It stands in for sign-in and the Account API only; the world session is the
 * real one. Every failure warns and returns `null`, which the app shows as
 * "no staged world". A production build never carries a profile.
 */
function readStagedProfile(mode: string): Record<string, string> | null {
	if (mode === "production") return null;
	const adventure = process.env.SPELLKAVE_DEV_SLUG?.trim() || "elven-mini";
	const path =
		process.env.SPELLKAVE_DEV_PROFILE?.trim() ||
		resolve(repoRoot, `.local/profiles/${adventure}-candidate.toml`);
	if (!existsSync(path)) return null;

	let profile: Record<string, unknown>;
	try {
		profile = parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch (cause) {
		console.warn(`[classic] staged profile is not valid TOML: ${path} (${String(cause)})`);
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
		console.warn(`[classic] staged profile is missing connection/identity fields: ${path}`);
		return null;
	}
	// A sibling worktree staging the same adventure can repoint the shared
	// profile at another node (sk-jay0.7.35); refuse rather than play there.
	const worktreeUrl = process.env.SPELLKAVE_URL?.trim() ?? "";
	if (worktreeUrl !== "" && url !== worktreeUrl) {
		console.warn(
			`[classic] staged profile points at '${url}', this worktree's node is '${worktreeUrl}': re-run 'just play-stage'`,
		);
		return null;
	}
	const tokenAbs = resolve(dirname(path), tokenPath);
	if (!existsSync(tokenAbs)) {
		console.warn(`[classic] staged credential not found: ${tokenAbs}: re-run 'just play-stage'`);
		return null;
	}
	const slug = process.env.SPELLKAVE_DEV_SLUG?.trim() || basename(dirname(tokenAbs));
	console.info(`[classic] local play: ${slug} @ ${url}/${db} as actor ${actorId}`);
	return { url, db, actorId, token: readFileSync(tokenAbs, "utf8").trim(), slug };
}

export default defineConfig(({ mode }) => ({
	plugins: [
		spellkaveThemeBoot(),
		tailwindcss(),
		svelte(),
		svelteTesting(),
		constantModule("virtual:classic-dev-local", readStagedProfile(mode)),
		// The Play session library imports these two; this app turns both off.
		constantModule("virtual:spellkave-run-events-config", JSON.stringify({ enabled: false })),
		constantModule("virtual:spellkave-local-rum", null),
	] as ViteUserConfig["plugins"],
	build: {
		rollupOptions: {
			input: {
				main: resolve("index.html"),
				demo: resolve("demo.html"),
				stage: resolve("stage.html"),
			},
		},
	},
	// SRD art is read from packages/spellkave-srd-cc/assets.
	server: { fs: { allow: [repoRoot] } },
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
	},
}));
