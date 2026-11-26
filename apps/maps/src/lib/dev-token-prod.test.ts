import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Production bundles must not embed the DEV token path.
 * Mirrors apps/website: vite.config only injects VITE_SPELLKAVE_DEV_TOKEN
 * when mode !== "production".
 */
describe("DEV token dead in production builds", () => {
	it("vite.config skips define inject in production mode", () => {
		const src = readFileSync(resolve(import.meta.dirname, "../../vite.config.ts"), "utf8");
		expect(src).toMatch(/mode === "production" \? "" : readDevTokenFromFile/);
		expect(src).toMatch(/import\.meta\.env\.VITE_SPELLKAVE_DEV_TOKEN/);
	});

	it("dev-auth is gated on import.meta.env.DEV", () => {
		const src = readFileSync(resolve(import.meta.dirname, "./dev-auth.ts"), "utf8");
		expect(src).toMatch(/import\.meta\.env\.DEV === true/);
		expect(src).toMatch(/isDevAuthEnabled/);
	});
});
