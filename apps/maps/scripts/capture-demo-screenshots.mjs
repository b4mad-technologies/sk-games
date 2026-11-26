#!/usr/bin/env node
/**
 * Puppeteer screenshots for openspec/.../demos/maps-app/
 * Expects maps vite on MAPS_URL (default http://127.0.0.1:5173) and
 * local-demo-gateway on GATEWAY (default http://127.0.0.1:18080).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// puppeteer-core is deliberately NOT a workspace dependency (npm audit: its
// @puppeteer/browsers pulls a vulnerable extract-zip). Run ad hoc:
//   npx -y -p puppeteer-core@latest node apps/maps/scripts/capture-demo-screenshots.mjs
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(
	here,
	"../../../openspec/changes/world-map-viewer/demos/maps-app/screenshots",
);
const mapsUrl = process.env.MAPS_URL ?? "http://127.0.0.1:5173";
const gateway = process.env.VITE_SPELLKAVE_GATEWAY_URL ?? "http://127.0.0.1:18080";
const token = process.env.MAPS_DEMO_TOKEN ?? "demo-local-token";
const chromePath =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
	executablePath: chromePath,
	headless: true,
	args: ["--no-sandbox", "--disable-gpu"],
	defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();

// Seed sessionStorage before any app script runs.
await page.evaluateOnNewDocument(
	(tok) => {
		const session = {
			access_token: tok,
			id_token: "",
			expires_at: Date.now() + 86_400_000,
			display_name: "demo-player",
		};
		sessionStorage.setItem("spellkave.workos.session", JSON.stringify(session));
	},
	token,
);

async function shot(name) {
	const path = join(outDir, name);
	await page.screenshot({ path, fullPage: false });
	process.stderr.write(`wrote ${path}\n`);
}

// World picker / login shell first (cold load without session is separate).
await page.goto(mapsUrl, { waitUntil: "networkidle0", timeout: 60_000 });
await page.waitForSelector("[data-testid='maps-app']", { timeout: 30_000 });
// Wait for map ready event or status.
await page
	.waitForFunction(
		() => {
			const st = document.querySelector("[data-testid='map-status']");
			return st && !/loading/i.test(st.textContent ?? "");
		},
		{ timeout: 45_000 },
	)
	.catch(() => {});

await shot("01-world-picker-map.png");

// Search
const search = await page.$("[data-testid='search-input']");
if (search) {
	await search.click({ clickCount: 3 });
	await search.type("Inn", { delay: 40 });
	await page.waitForSelector("[data-testid='search-results']", { timeout: 15_000 }).catch(() => {});
	await new Promise((r) => setTimeout(r, 800));
	await shot("02-search-result.png");
	const first = await page.$("[data-testid='search-results'] button");
	if (first) {
		await first.click();
		await new Promise((r) => setTimeout(r, 1500));
	}
}

// Floor switch
const floorBtns = await page.$$("[data-testid='floor-picker'] button");
if (floorBtns.length > 1) {
	await floorBtns[1].click();
	await new Promise((r) => setTimeout(r, 800));
	await shot("03-inn-level-switch.png");
}

// Hamlet-ish zoom out
await page.evaluate(() => {
	// MapLibre instance is not exposed; zoom via keyboard-ish wheel on canvas.
	const canvas = document.querySelector(".maplibregl-canvas");
	if (canvas) {
		canvas.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 800, bubbles: true, cancelable: true }),
		);
	}
});
await new Promise((r) => setTimeout(r, 1200));
await shot("04-hamlet-with-art.png");

// Seat panel
await shot("05-seat-panel.png");

await writeFile(
	join(outDir, "meta.json"),
	JSON.stringify({ mapsUrl, gateway, at: new Date().toISOString() }, null, 2),
);

await browser.close();
process.stderr.write("done\n");
