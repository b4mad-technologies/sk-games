/** Hop-by-hop / proxy identity headers Tailscale serve injects. */
export const MCP_DEV_PROXY_STRIP_HEADERS = [
	"origin",
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-proto",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-real-ip",
] as const;

export interface McpProxyOutgoingRequest {
	removeHeader(name: string): void;
	setHeader(name: string, value: string): void;
}

/**
 * Make a proxied /mcp request look Origin-less and not forwarded, and pin Host
 * to the gateway's canonical hostname (JWT aud / Host allowlist).
 */
export function prepareMcpProxyRequest(proxyReq: McpProxyOutgoingRequest, host: string): void {
	for (const name of MCP_DEV_PROXY_STRIP_HEADERS) {
		proxyReq.removeHeader(name);
	}
	proxyReq.setHeader("host", host);
}
