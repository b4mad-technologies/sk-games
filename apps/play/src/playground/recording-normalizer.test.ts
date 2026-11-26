import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	capturePlayView,
	createPlayRecording,
	PLAY_RECORDING_SURFACE,
} from "../lib/play-recording";
import { sampleView } from "./fixtures";

const root = resolve(import.meta.dirname, "../../../..");
const cli = resolve(root, "apps/play/scripts/normalize-play-recording.ts");
let directory: string | undefined;

afterEach(() => {
	if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
	directory = undefined;
});

function paths() {
	directory ??= mkdtempSync(join(tmpdir(), "play-recording-normalizer-"));
	return { source: join(directory, "source.json"), output: join(directory, "output.json") };
}

/** Deliberately produce the v1 shape emitted by the previous live exporter. */
function v1Recording(frameCount = 2): string {
	const recording = createPlayRecording({ now: () => 1, id: "normalizer_fixture" });
	for (let index = 0; index < frameCount; index += 1) recording.record(capturePlayView(sampleView));
	const v2 = recording.export(PLAY_RECORDING_SURFACE);
	return JSON.stringify({
		kind: v2.kind,
		version: 1,
		surface: v2.surface,
		capturedAt: v2.capturedAt,
		frames: v2.frames.map(({ id: _id, ...frame }) => frame),
	});
}

function run(input: string, output: string, ...options: string[]) {
	return spawnSync(process.execPath, ["--import", "tsx", cli, input, output, ...options], {
		cwd: root,
		encoding: "utf8",
	});
}

describe("normalize Play recording CLI", () => {
	it("migrates v1 to stable v2 IDs without touching its source", () => {
		const { source, output } = paths();
		const input = v1Recording();
		writeFileSync(source, input);
		expect(run(source, output, "--privacy-reviewed", "--source", "legacy").status).toBe(0);
		const normalized = JSON.parse(readFileSync(output, "utf8"));
		expect(normalized).toMatchObject({ version: 2, provenance: { source: "legacy" } });
		expect(normalized.id).toMatch(/^legacy_/);
		expect(normalized.frames.map((frame: { id: string }) => frame.id)).toEqual(
			expect.arrayContaining([expect.stringMatching(/^legacy_frame_/)]),
		);
		expect(readFileSync(source, "utf8")).toBe(input);

		const repeat = join(directory!, "repeat.json");
		expect(run(source, repeat, "--privacy-reviewed", "--source", "legacy").status).toBe(0);
		expect(JSON.parse(readFileSync(repeat, "utf8"))).toMatchObject({
			id: normalized.id,
			frames: normalized.frames.map((frame: { id: string }) => ({ id: frame.id })),
		});
	});

	it("requires a privacy acknowledgement and refuses an existing output", () => {
		const { source, output } = paths();
		writeFileSync(source, v1Recording());
		const missingReview = run(source, output, "--source", "legacy");
		expect(missingReview.status).not.toBe(0);
		expect(missingReview.stderr).toContain("--privacy-reviewed");

		writeFileSync(output, "do not replace");
		const existing = run(source, output, "--privacy-reviewed", "--source", "legacy");
		expect(existing.status).not.toBe(0);
		expect(readFileSync(output, "utf8")).toBe("do not replace");
	});

	it("samples existing stable frame IDs rather than making new ones", () => {
		const { source, output } = paths();
		writeFileSync(source, v1Recording(5));
		expect(run(source, output, "--privacy-reviewed", "--source", "legacy").status).toBe(0);
		const full = JSON.parse(readFileSync(output, "utf8"));
		const sampledPath = join(directory!, "sampled.json");
		expect(
			run(source, sampledPath, "--privacy-reviewed", "--source", "legacy", "--sample", "3").status,
		).toBe(0);
		const sampled = JSON.parse(readFileSync(sampledPath, "utf8"));
		expect(sampled.frames.map((frame: { id: string }) => frame.id)).toEqual([
			full.frames[0].id,
			full.frames[2].id,
			full.frames[4].id,
		]);
	});
});
