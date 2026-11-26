import type { Plugin } from "vite";
import type { LocalRumConfig } from "./src/lib/local-rum-config.ts";

/**
 * Private diagnostic relay. The destination comes from the dev server's own
 * environment (`SPELLKAVE_RUM_DIAGNOSTIC_UPSTREAM`), never from a request, and
 * stays out of the browser module. No credentials, no public route.
 */
export function localRumPlugin(config: LocalRumConfig | null, upstreamUrl: string | null): Plugin {
	const id = "virtual:spellkave-local-rum";
	if (upstreamUrl === null) config = null;
	return {
		name: "spellkave-local-rum",
		resolveId: (source) => (source === id ? `\0${id}` : null),
		load: (source) => (source === `\0${id}` ? `export default ${JSON.stringify(config)};` : null),
		configureServer(server) {
			if (config === null || upstreamUrl === null) return;
			console.info(`[play] diagnostic RUM enabled: ${config.environment}, 100% sampling`);
			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url ?? "/", "http://localhost");
				if (url.pathname !== "/__rum") return next();
				const host = req.headers.host ?? "";
				const origin = req.headers.origin;
				if (
					!/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
					origin !== `http://${host}` ||
					req.method !== "POST"
				) {
					res.statusCode = 403;
					res.end();
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				try {
					for await (const chunk of req) {
						size += Buffer.byteLength(chunk);
						if (size > 256_000) {
							res.statusCode = 413;
							res.end();
							return;
						}
						chunks.push(Buffer.from(chunk));
					}
					// Token is the public RUM token. Reader credentials are never used.
					const upstream = new URL(upstreamUrl);
					upstream.search = url.search;
					const response = await fetch(upstream, {
						method: "POST",
						body: Buffer.concat(chunks),
						headers: { "content-type": "text/plain" },
						signal: AbortSignal.timeout(5000),
						redirect: "error",
					});
					res.statusCode = response.status;
					await response.body?.cancel();
					res.end();
				} catch {
					res.statusCode = 502;
					res.end();
				}
			});
		},
	};
}
