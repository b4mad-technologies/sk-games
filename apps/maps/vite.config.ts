import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { requireLoginOrigin } from "@spellkave/authkit/vite";
import { spellkaveThemeBoot } from "@spellkave/ui/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { loadEnv } from "vite";
import { defineConfig, type ViteUserConfig } from "vitest/config";

function readDevTokenFromFile(mode: string): string {
	const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
	const file = env.VITE_SPELLKAVE_DEV_TOKEN_FILE?.trim() ?? "";
	if (file === "") return env.VITE_SPELLKAVE_DEV_TOKEN?.trim() ?? "";
	const abs = resolve(file);
	if (!existsSync(abs)) {
		console.warn(`[maps] VITE_SPELLKAVE_DEV_TOKEN_FILE not found: ${abs}`);
		return "";
	}
	return readFileSync(abs, "utf8").trim();
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
	const devToken = mode === "production" ? "" : readDevTokenFromFile(mode);
	return {
		plugins: [
			requireLoginOrigin(),
			spellkaveThemeBoot(),
			tailwindcss(),
			svelte(),
			svelteTesting(),
		] as ViteUserConfig["plugins"],
		envPrefix: ["VITE_"],
		define:
			devToken === ""
				? undefined
				: {
						"import.meta.env.VITE_SPELLKAVE_DEV_TOKEN": JSON.stringify(devToken),
					},
		test: {
			environment: "jsdom",
			setupFiles: ["@spellkave/ui/vitest-jsdom-teardown"],
			include: ["src/**/*.test.ts"],
		},
	};
});
