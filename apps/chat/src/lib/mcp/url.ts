export const DEFAULT_SPELLKAVE_MCP_URL = "https://mcp.spellkave.com/mcp";

function normalizeAbsoluteMcpUrl(raw: string): string {
	const url = new URL(raw);
	if (url.pathname === "" || url.pathname === "/") url.pathname = "/mcp";
	return url.toString().replace(/\/$/, "");
}

function normalizeRelativeMcpUrl(raw: string): string {
	if (raw === "/") return "/mcp";
	return raw.replace(/\/$/, "") || "/mcp";
}

/** MCP Streamable HTTP URL. Absolute, or same-origin relative (`/mcp`). */
export function readMcpUrl(env: Record<string, string | undefined>): string {
	const raw = env.VITE_SPELLKAVE_MCP_URL?.trim() ?? "";
	if (raw === "") return DEFAULT_SPELLKAVE_MCP_URL;
	if (raw.startsWith("/")) return normalizeRelativeMcpUrl(raw);
	try {
		return normalizeAbsoluteMcpUrl(raw);
	} catch {
		return DEFAULT_SPELLKAVE_MCP_URL;
	}
}

/**
 * RFC 8707 resource / JWT `aud`. Relative MCP URLs keep the production
 * resource unless `VITE_SPELLKAVE_MCP_RESOURCE` is set.
 */
export function readMcpResource(env: Record<string, string | undefined>): string {
	const explicit = env.VITE_SPELLKAVE_MCP_RESOURCE?.trim() ?? "";
	if (explicit !== "") return explicit;
	const mcpUrl = readMcpUrl(env);
	if (mcpUrl.startsWith("/")) return DEFAULT_SPELLKAVE_MCP_URL;
	return mcpUrl;
}

/** Turn a relative `/mcp` path into a request URL against the page origin. */
export function resolveMcpRequestUrl(mcpUrl: string, origin: string): string {
	if (mcpUrl.startsWith("/")) return new URL(mcpUrl, origin).toString();
	return mcpUrl;
}
