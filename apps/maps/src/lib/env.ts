/**
 * Required runtime env for maps.spellkave.com.
 * Gateway URL is mandatory — without it style/tiles/Overpass have no origin.
 */

export function readGatewayUrl(env: Record<string, string | undefined>): string {
	const raw = env.VITE_SPELLKAVE_GATEWAY_URL?.trim() ?? "";
	if (raw === "") {
		throw new Error("VITE_SPELLKAVE_GATEWAY_URL is required");
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`VITE_SPELLKAVE_GATEWAY_URL is not a valid URL: ${raw}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`VITE_SPELLKAVE_GATEWAY_URL must be http(s): ${raw}`);
	}
	// Drop trailing slash and accidental /mcp suffix so /w/<slug>/… joins cleanly.
	return url.origin;
}

export function tryReadGatewayUrl(env: Record<string, string | undefined>): string | null {
	try {
		return readGatewayUrl(env);
	} catch {
		return null;
	}
}
