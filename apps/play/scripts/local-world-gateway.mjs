#!/usr/bin/env node
/** Local co-play gateway: live topology, installed adventure assets, staged seat auth.
 * Run via `just play-gateway-local <adventure> <world-assets-root>`.
 * No fixture/source asset fallback and no hosted identity bypass.
 */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";
import { createLiveWorldOsmCache } from "../../../packages/spellkave-mcp/src/osm-model.ts";
import { parseWorldApiPath, serveOsmApi } from "../../../packages/spellkave-mcp/src/osm-api.ts";
import { serveOverpass } from "../../../packages/spellkave-mcp/src/overpass.ts";
import {
	defaultFontsRoot, defaultMapsDemoPath, handleWorldTilesRequest,
	openTilesCorsHeaders, parseWorldTilesPath, tilesPreflightResponse,
} from "../../../packages/spellkave-mcp/src/tiles.ts";

function corsText(request, status, body) {
	return new Response(body, {
		status,
		headers: {
			...openTilesCorsHeaders(request),
			"cache-control": "no-store",
			"content-type": "text/plain;charset=UTF-8",
		},
	});
}

const profilePath = resolve(process.env.SPELLKAVE_DEV_PROFILE ?? "");
const profile = parse(await readFile(profilePath, "utf8"));
const slug = process.env.SPELLKAVE_DEV_SLUG ?? "";
const assetsRoot = process.env.SPELLKAVE_LOCAL_WORLD_ASSETS_ROOT;
const worldUrl = new URL(profile.connection?.url ?? "");
if (worldUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(worldUrl.hostname)) {
	throw new Error("local gateway requires a loopback world URL");
}
if (process.env.SPELLKAVE_URL && worldUrl.origin !== new URL(process.env.SPELLKAVE_URL).origin) {
	throw new Error("staged profile points at another worktree node");
}
if (!/^[a-z][a-z0-9-]{0,63}$/.test(slug) || !assetsRoot || !profile.connection?.db) {
	throw new Error("slug, staged database and installed world-assets root are required");
}
if (!(await stat(join(assetsRoot, slug))).isDirectory()) throw new Error("installed adventure assets missing");
const tokenPath = profile.identity?.credential?.path;
if (typeof tokenPath !== "string" || !tokenPath) throw new Error("staged seat credential path missing");
const seatToken = (await readFile(resolve(dirname(profilePath), tokenPath), "utf8")).trim();
const nodeConfigPath = join(process.cwd(), ".local", "nodes", worldUrl.port, "cli.toml");
const configPath = (await stat(nodeConfigPath).catch(() => null))?.isFile()
	? nodeConfigPath
	: (process.env.SPACETIME_CONFIG_PATH ?? "");
const cli = parse(await readFile(configPath, "utf8"));
const ownerToken = cli.spacetimedb_token;
if (!seatToken || typeof ownerToken !== "string" || !ownerToken) throw new Error("staged seat and local publisher credentials required");
const port = Number(process.env.SPELLKAVE_LOCAL_GATEWAY_PORT ?? Number(worldUrl.port) + 20000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid local gateway port");
const catalog = { v: "player-world-catalog/v1", worlds: [{
	slug, db: profile.connection.db, display_name: slug, adventure: slug,
	status: "ready", visibility: "private", owner: "local", members: [], join_policy: "invite",
}] };
const cache = createLiveWorldOsmCache({ worldUrl: worldUrl.origin, catalog, token: ownerToken });
const knownSlugs = new Set([slug]);
const bind = process.env.SPELLKAVE_LOCAL_GATEWAY_BIND ?? "127.0.0.1";
const publicBaseUrl = (process.env.SPELLKAVE_LOCAL_GATEWAY_PUBLIC_URL?.trim()
	|| ((bind === "127.0.0.1" || bind === "localhost" || bind === "::1") ? "" : `http://${bind}:${port}`))
	|| undefined;
const tilesOptions = {
	// Read the current subscription snapshot; do not retain a stale first export.
	store: { get: (world) => cache.getTiles(world), set: () => {} },
	knownSlugs, worldAssetsRoot: resolve(assetsRoot), fontsRoot: defaultFontsRoot(), mapsDemoPath: defaultMapsDemoPath(),
	loadCache: async (world) => { await cache.ensure(world); return cache.getTiles(world) ?? null; },
	...(publicBaseUrl ? { publicBaseUrl } : {}),
};

function localOrigin(origin) {
	if (!origin) return true;
	try {
		const url = new URL(origin);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return true;
		// Tailscale CGNAT + MagicDNS so a laptop can open Maps on ganymede.
		if (url.hostname.startsWith("100.")) return true;
		if (url.hostname.endsWith(".ts.net")) return true;
		return false;
	} catch {
		return false;
	}
}

const server = createServer((req, res) => {
	void (async () => {
		// Fixed authority prevents an arbitrary Host header from shaping asset URLs.
		if (!req.url?.startsWith("/") || req.url.startsWith("//")) { res.writeHead(400).end(); return; }
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
		if (!localOrigin(req.headers.origin)) { res.writeHead(403).end(); return; }
		if (url.pathname === "/health" && req.method === "GET") { res.writeHead(200).end("ok"); return; }
		const headers = new Headers();
		for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > 65536) { res.writeHead(413).end(); return; }
			chunks.push(chunk);
		}
		const method = req.method ?? "GET";
		const request = new Request(url, { method, headers, ...(!["GET", "HEAD"].includes(method) && size ? { body: Buffer.concat(chunks) } : {}) });
		let response;
		if (method === "OPTIONS") response = tilesPreflightResponse(request);
		else if (req.headers.authorization !== `Bearer ${seatToken}` && req.headers.authorization !== `Bearer ${ownerToken}`) response = corsText(request, 401, "Staged seat credential required");
		else {
			const tiles = parseWorldTilesPath(url.pathname);
			const api = parseWorldApiPath(url.pathname);
			if (tiles?.slug === slug) response = await handleWorldTilesRequest(request, tiles, tilesOptions);
			else if (api?.slug === slug) response = api.kind === "interpreter"
				? await serveOverpass(request, { cache, slug, catalogHasSlug: true })
				: await serveOsmApi(request, { cache, slug, rest: api.rest || "/", catalogHasSlug: true });
			else response = corsText(request, 404, "Not found");
		}
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	})().catch((error) => {
		const detail = error instanceof Error ? error.message : "unknown failure";
		process.stderr.write(`local world gateway: ${detail.replaceAll(seatToken, "[credential]").replaceAll(ownerToken, "[credential]")}\n`);
		res.writeHead(503).end("Local world map unavailable");
	});
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
	server.close(); void cache.close().finally(() => process.exit(0));
});
server.listen(port, bind, () => process.stderr.write(`local world gateway: http://${bind}:${port} (${slug})\n`));
