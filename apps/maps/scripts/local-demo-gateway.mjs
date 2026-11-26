#!/usr/bin/env node
/**
 * Local-only tiles + Overpass gateway for maps app screenshots / live proof.
 * Serves the checked-in kavemouth OSM rows through the same handlers as
 * packages/spellkave-mcp — accepts any non-empty Bearer (NOT for production).
 *
 *   pnpm exec tsx apps/maps/scripts/local-demo-gateway.mjs
 *   → http://127.0.0.1:18080/w/kavemouth/style.json
 * Set MAPS_DEMO_GATEWAY_HOST to a specific Tailscale address for remote review.
 */
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorldApiPath, serveOsmApi } from "../../../packages/spellkave-mcp/src/osm-api.ts";
import {
	createStaticWorldOsmCache,
	snapshotFromExport,
} from "../../../packages/spellkave-mcp/src/osm-model.ts";
import { serveOverpass } from "../../../packages/spellkave-mcp/src/overpass.ts";
import {
	defaultFontsRoot,
	defaultMapsDemoPath,
	handleWorldTilesRequest,
	parseWorldTilesPath,
	tilesPreflightResponse,
} from "../../../packages/spellkave-mcp/src/tiles.ts";
import {
	buildWorldTilesCache,
	TilesModelStore,
} from "../../../packages/spellkave-mcp/src/osm-model.ts";
import { exportWorld } from "../../../packages/spellkave-world-map/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const port = Number(process.env.MAPS_DEMO_GATEWAY_PORT ?? 18080);
const host = process.env.MAPS_DEMO_GATEWAY_HOST?.trim() || "127.0.0.1";
const slug = "kavemouth";

const rowsPath = join(
	repoRoot,
	"packages/spellkave-mcp/src/__tests__/fixtures/kavemouth-rows.json",
);
const rows = JSON.parse(await readFile(rowsPath, "utf8"));
const tilesCache = buildWorldTilesCache(slug, rows, {
	tick: 42,
	timestamp: "2026-08-22T00:00:00Z",
});
const exportResult = exportWorld(rows, { tick: 42, timestamp: "2026-08-22T00:00:00Z" });
const osmCache = createStaticWorldOsmCache({
	[slug]: snapshotFromExport(exportResult, {
		tick: 42,
		timestamp: "2026-08-22T00:00:00Z",
	}),
});

const store = new TilesModelStore();
store.set(tilesCache);
// Alias common catalog sample slugs onto the kavemouth fixture for local UI.
for (const alias of ["demo1", "demo2", "kavemouth-1"]) {
	store.set({ ...tilesCache, slug: alias });
}

const bakedArt = join(repoRoot, "packages/spellkave-adventure-kavemouth/assets");
const worldAssetsRoot = join(repoRoot, ".local/maps-demo-world-assets");
mkdirSync(worldAssetsRoot, { recursive: true });
for (const name of [slug, "demo1", "demo2", "kavemouth-1"]) {
	const link = join(worldAssetsRoot, name);
	if (!existsSync(link)) symlinkSync(bakedArt, link);
}

const tilesOpts = {
	store,
	loadCache: async (s) => store.get(s) ?? null,
	worldAssetsRoot,
	fontsRoot: defaultFontsRoot(),
	mapsDemoPath: defaultMapsDemoPath(),
	knownSlugs: new Set([slug, "demo1", "demo2", "kavemouth-1"]),
};

function bearerOk(req) {
	const h = req.headers.authorization ?? "";
	return /^Bearer\s+\S+/i.test(h);
}

async function readBody(req) {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	return Buffer.concat(chunks);
}

async function toNodeResponse(webRes, nodeRes) {
	nodeRes.statusCode = webRes.status;
	webRes.headers.forEach((value, key) => {
		if (key.toLowerCase() === "transfer-encoding") return;
		nodeRes.setHeader(key, value);
	});
	const buf = Buffer.from(await webRes.arrayBuffer());
	nodeRes.end(buf);
}

const server = createServer((req, res) => {
	void (async () => {
		// Build absolute links (tiles.json, art, fonts) from the Host the client
		// actually used — a LAN/forwarded client must not get 127.0.0.1 back.
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
		const method = req.method ?? "GET";
		const headers = new Headers();
		for (const [k, v] of Object.entries(req.headers)) {
			if (v === undefined) continue;
			headers.set(k, Array.isArray(v) ? v.join(", ") : v);
		}
		const body =
			method === "GET" || method === "HEAD" || method === "OPTIONS"
				? undefined
				: await readBody(req);
		const request = new Request(url, { method, headers, body });

		if (method === "OPTIONS") {
			await toNodeResponse(tilesPreflightResponse(request), res);
			return;
		}

		if (url.pathname === "/health") {
			res.statusCode = 200;
			res.end("ok");
			return;
		}

		const needsAuth =
			parseWorldTilesPath(url.pathname) !== null || parseWorldApiPath(url.pathname) !== null;
		if (needsAuth && !bearerOk(req)) {
			res.statusCode = 401;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ error: "invalid_token", error_description: "Bearer required" }));
			return;
		}

		const tilesPath = parseWorldTilesPath(url.pathname);
		if (tilesPath !== null) {
			await toNodeResponse(await handleWorldTilesRequest(request, tilesPath, tilesOpts), res);
			return;
		}

		const apiPath = parseWorldApiPath(url.pathname);
		if (apiPath !== null) {
			if (apiPath.kind === "interpreter") {
				await toNodeResponse(
					await serveOverpass(request, {
						cache: osmCache,
						slug: apiPath.slug,
						catalogHasSlug: apiPath.slug === slug,
					}),
					res,
				);
				return;
			}
			await toNodeResponse(
				await serveOsmApi(request, {
					cache: osmCache,
					slug: apiPath.slug,
					rest: apiPath.rest || "/",
					catalogHasSlug: apiPath.slug === slug,
				}),
				res,
			);
			return;
		}

		res.statusCode = 404;
		res.end("not found");
	})().catch((err) => {
		res.statusCode = 500;
		res.end(String(err?.stack ?? err));
	});
});

server.listen(port, host, () => {
	process.stderr.write(`maps local-demo-gateway on http://${host}:${port} slug=${slug}\n`);
});
