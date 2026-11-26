// SDK connect-time shape check mode (sk-jay0.7.389.3), from the build. The
// SDK reads `globalThis.SPELLKAVE_SHAPE_CHECK`; this sets it from
// VITE_SPELLKAVE_SHAPE_CHECK (hosted publish: "warn"). Unset or empty keeps the
// default, strict. vite.config.ts already fails the build on an unknown value;
// this throws too, so a bundle built around that check cannot guess either.
export function applyShapeCheckBuildMode(
	value: string | undefined,
	target: { SPELLKAVE_SHAPE_CHECK?: string } = globalThis as { SPELLKAVE_SHAPE_CHECK?: string },
): void {
	if (value === undefined || value === "") return;
	if (value !== "strict" && value !== "warn") {
		throw new Error(
			`VITE_SPELLKAVE_SHAPE_CHECK must be "strict" or "warn", got ${JSON.stringify(value)}`,
		);
	}
	target.SPELLKAVE_SHAPE_CHECK = value;
}
