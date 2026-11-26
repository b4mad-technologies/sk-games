/**
 * chat.spellkave.com — assets-only Worker.
 *
 * Serves the SPA. Login is client-side AuthKit; there is no Account API
 * proxy and no `/app` prefix. The custom-domain binding is Pulumi, not this
 * file (no `routes` in wrangler.jsonc).
 */

interface Env {
	ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Map a browser request onto static assets, or null when assets cannot serve it. */
export function assetRequest(request: Request): Request | null {
	if (request.method !== "GET" && request.method !== "HEAD") return null;
	return request;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const assets = assetRequest(request);
		if (assets === null) return new Response(null, { status: 405 });
		return env.ASSETS.fetch(assets);
	},
};
