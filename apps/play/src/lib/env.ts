/**
 * Gateway origin for the map tile's canvas (`@spellkave/map-canvas`), read the
 * same way `apps/maps/src/lib/env.ts` reads its own `VITE_SPELLKAVE_GATEWAY_URL`.
 *
 * Unlike `apps/maps` — whose entire page IS the map, so a missing gateway origin
 * fails the app closed — Play's map is one tile among six. A missing or invalid
 * origin here degrades to the map tile's own blocked state (`@spellkave/map-canvas`'s
 * `blocked()` notice) instead of taking the rest of the table down with it.
 */
export function tryReadGatewayUrl(env: Record<string, string | undefined>): string | null {
	const raw = env.VITE_SPELLKAVE_GATEWAY_URL?.trim() ?? "";
	if (raw === "") return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	// Drop trailing slash and accidental /mcp suffix so /w/<slug>/… joins cleanly.
	return url.origin;
}

/** The hosted maps app. The default of `tryReadMapsUrl`, so a build that
 * sets nothing (the hosted `play.yml` build sets nothing) keeps its link. */
export const HOSTED_MAPS_ORIGIN = "https://maps.spellkave.com";

/**
 * Origin of the standalone maps app the map tile links to ("Open the full
 * map"), from `VITE_SPELLKAVE_MAPS_URL`:
 *
 * - unset or blank: `HOSTED_MAPS_ORIGIN` (what every build linked to before
 *   the variable existed);
 * - an http(s) URL: its origin (a local Maps app);
 * - `off`, or anything that is not an http(s) URL: `null`, meaning no link
 *   and no site name. A local co-play session uses `off`, because the hosted
 *   maps site does not show a locally staged world (sk-jay0.1.8.100).
 *
 * Never throws.
 */
export function tryReadMapsUrl(env: Record<string, string | undefined>): string | null {
	const raw = env.VITE_SPELLKAVE_MAPS_URL?.trim() ?? "";
	if (raw === "") return HOSTED_MAPS_ORIGIN;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	return url.origin;
}
