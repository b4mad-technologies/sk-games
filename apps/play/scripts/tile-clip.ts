import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { build, preview } from "vite";
import { sweep } from "./tile-clip-browser.ts";
import { layoutProbes } from "./tile-clip-layout.ts";
import {
	allCards,
	layoutProbeBeats,
	selectCards,
	selectLayoutProbes,
	sweepBeats,
	sweepViewports,
} from "./tile-clip-selection.ts";

const started = performance.now();
const elapsed = () => Math.round(performance.now() - started);
const output = mkdtempSync(resolve(tmpdir(), "play-tile-clip-"));
const env = {
	...process.env,
	FORCE_COLOR: "0",
	NO_COLOR: "1",
	AGENT_BROWSER_SESSION: `tile-clip-${process.pid}`,
};
function browser(args: string[], input?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("agent-browser", args, { env, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (data) => {
			stdout += data;
		});
		child.stderr.on("data", (data) => {
			stderr += data;
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve(stdout)
				: reject(new Error(`agent-browser ${args[0]} (${code}): ${stderr}`)),
		);
		child.stdin.end(input);
	});
}
let cards = allCards;
const base = process.env.TILE_CLIP_BASE;
if (base && /^[0-9a-f]{40}$/.test(base)) {
	try {
		try {
			execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], { stdio: "pipe" });
		} catch (error) {
			// Local worktrees share a Git store; do not make it shallow for a repro.
			if (process.env.CI !== "true") throw error;
			execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", base], { stdio: "pipe" });
		}
		const files = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, "HEAD"], {
			encoding: "utf8",
		})
			.split("\0")
			.filter(Boolean);
		cards = selectCards(files);
	} catch (error) {
		console.warn(`Card selection unavailable; full sweep: ${error}`);
	}
}
const probes = selectLayoutProbes(cards);
console.log(
	`tile-clip selection: ${cards.join(",")} (${base ? "PR/merge-group base" : "full/default"}); layout probes: ${probes.join(",") || "none"}`,
);
let server: Awaited<ReturnType<typeof preview>> | undefined;
try {
	// Development mode preserves demo semantics; the dedicated temporary output
	// never adds the fixture entry to the deployable production assets.
	await build({
		mode: "development",
		build: { outDir: output, emptyOutDir: true, rollupOptions: { input: resolve("demo.html") } },
	});
	writeFileSync(
		resolve(output, "tile-clip.html"),
		'<!doctype html><html><head><title>Tile clip gate</title></head><body style="margin:0;display:flex;flex-wrap:wrap"></body></html>',
	);
	console.log(`tile-clip phase build: ${elapsed()}ms`);
	server = await preview({
		mode: "development",
		build: { outDir: output },
		preview: { host: "127.0.0.1", port: Number(process.argv[2]), strictPort: true },
	});
	const address = server.httpServer.address();
	if (!address || typeof address === "string") throw new Error("Missing preview address");
	const url = `http://127.0.0.1:${address.port}`;
	const browserStart = elapsed();
	await browser(["open", `${url}/tile-clip.html`]);
	console.log(`tile-clip phase browser-start: ${elapsed() - browserStart}ms`);
	const sweepStart = elapsed();
	const rows = JSON.parse(
		await browser(
			["eval", "--stdin"],
			`(${sweep.toString()})(${JSON.stringify(url)}, ${JSON.stringify(cards)}, ${JSON.stringify(sweepBeats)})`,
		),
	) as Awaited<ReturnType<typeof sweep>>;
	const expected = cards.length * sweepBeats.length * sweepViewports;
	if (rows.length !== expected)
		throw new Error(`Expected ${expected} measurements, got ${rows.length}`);
	let failures = 0;
	for (const row of rows) {
		const clipped = row.zoom !== "stage" && row.scrollHeight > row.clientHeight && !row.remainder;
		console.log(
			`${clipped ? "FAIL" : row.zoom === "stage" ? "stage" : "ok"} ${JSON.stringify(row)}`,
		);
		if (clipped) failures++;
	}
	console.log(
		`tile-clip phase sweep: ${elapsed() - sweepStart}ms; measurements=${rows.length}; failures=${failures}; remainder-probes=6 passed`,
	);
	// Layout probes (batch 7, G6): one fresh frame per probe and viewport.
	const probeStart = elapsed();
	let probeFailures = 0;
	if (probes.length > 0) {
		const probeRows = JSON.parse(
			await browser(
				["eval", "--stdin"],
				`(${layoutProbes.toString()})(${JSON.stringify(url)}, ${JSON.stringify(probes)}, ${JSON.stringify(layoutProbeBeats)})`,
			),
		) as Awaited<ReturnType<typeof layoutProbes>>;
		if (probeRows.length !== probes.length * sweepViewports)
			throw new Error(
				`Expected ${probes.length * sweepViewports} layout probes, got ${probeRows.length}`,
			);
		for (const row of probeRows) {
			console.log(`${row.ok ? "ok" : "FAIL"} layout ${JSON.stringify(row)}`);
			if (!row.ok) probeFailures++;
		}
	}
	console.log(
		`tile-clip phase layout-probes: ${elapsed() - probeStart}ms; probes=${probes.length * sweepViewports}; failures=${probeFailures}`,
	);
	if (failures || probeFailures) process.exitCode = 1;
} finally {
	await browser(["close"]).catch((error) => console.error(error));
	if (server)
		await new Promise<void>((resolve, reject) =>
			server?.httpServer.close((error) => (error ? reject(error) : resolve())),
		);
	rmSync(output, { recursive: true, force: true });
	console.log(`tile-clip phase total: ${elapsed()}ms`);
}
