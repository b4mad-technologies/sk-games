/** Validate and normalize a Play recording without modifying its source file.
 *
 * Usage:
 *   pnpm exec tsx apps/play/scripts/normalize-play-recording.ts INPUT OUTPUT \
 *     --privacy-reviewed --source live --build BUILD [--title TITLE]
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parsePlayRecording } from "../src/lib/play-recording";

const [input, output, ...options] = process.argv.slice(2);
if (input === undefined || output === undefined) {
	throw new Error(
		"Usage: normalize-play-recording.ts INPUT OUTPUT --privacy-reviewed --source live|legacy|fixture [--build BUILD] [--title TITLE]",
	);
}
const source = option("--source");
if (source !== "live" && source !== "legacy" && source !== "fixture")
	throw new Error("--source must be live, legacy, or fixture");
if (!options.includes("--privacy-reviewed"))
	throw new Error(
		"Refusing to write: manually review the input for private content, then pass --privacy-reviewed.",
	);
const inputPath = resolve(input);
const outputPath = resolve(output);
if (inputPath === outputPath)
	throw new Error("Output must be a new path; source recordings are never overwritten.");
const recording = parsePlayRecording(JSON.parse(await readFile(inputPath, "utf8")));
if (recording === null) throw new Error("Input is not a valid Play recording envelope.");
const build = option("--build");
const title = option("--title");
const sampleText = option("--sample");
const sample = sampleText === undefined ? undefined : Number(sampleText);
if (sample !== undefined && (!Number.isInteger(sample) || sample < 1))
	throw new Error("--sample must be a positive integer");
const normalized = {
	...recording,
	...(sample === undefined ? {} : { frames: representativeFrames(recording.frames, sample) }),
	provenance: {
		source,
		...(build === undefined ? {} : { build }),
		...(title === undefined ? {} : { title }),
	},
};
if (parsePlayRecording(normalized) === null)
	throw new Error("Normalized recording failed Play validation.");
await writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, { flag: "wx" });

function option(name: string): string | undefined {
	const index = options.indexOf(name);
	if (index < 0) return undefined;
	const value = options[index + 1];
	if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
	return value;
}

/** Preserve original frame IDs while keeping a review recording small. */
function representativeFrames<T>(frames: readonly T[], count: number): T[] {
	if (count >= frames.length) return [...frames];
	if (count === 1) return [frames[0]!];
	return Array.from(
		{ length: count },
		(_, index) => frames[Math.round((index * (frames.length - 1)) / (count - 1))]!,
	);
}
