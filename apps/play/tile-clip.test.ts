import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { layoutProbes } from "./scripts/tile-clip-layout.ts";
import {
	allCards,
	layoutProbeBeats,
	layoutProbeCards,
	selectCards,
	selectLayoutProbes,
	sweepBeats,
} from "./scripts/tile-clip-selection.ts";

describe("tile clipping card selection", () => {
	// keep(K5): fail-closed selection is a CI coverage contract, independent of widget rendering.
	it("checks every card for shared, unknown, deleted, or unavailable input attribution", () => {
		for (const files of [
			[],
			["apps/play/src/styles.css"],
			["toString"],
			["constructor"],
			["__proto__"],
			["apps/play/src/components/PlayTable.svelte"],
			["packages/spellkave-ui/src/InfoCard.svelte"],
			["apps/play/src/test/sample-view.ts"],
			["packages/spellkave-ui-widgets/src/Hero.svelte", "pnpm-lock.yaml"],
			["packages/spellkave-ui-widgets/src/FormerHero.svelte"],
		]) {
			expect(selectCards(files)).toEqual(allCards);
		}
	});
	// keep(K5): direct widget edits may narrow cards but never beat/viewport combinations.
	it("selects the union of explicitly attributable card widgets", () => {
		expect(selectCards(["packages/spellkave-ui-widgets/src/Hero.svelte"])).toEqual(["hero"]);
		expect(
			selectCards([
				"packages/spellkave-ui-widgets/src/Pack.svelte",
				"packages/spellkave-ui-widgets/src/Place.svelte",
			]),
		).toEqual(["pack", "place"]);
	});
});

describe("tile clipping layout probes (batch 7, G6)", () => {
	// keep(K5): a narrowed card selection must keep exactly its own layout probes.
	it("runs every probe for the full selection and only a card's own probes when narrowed", () => {
		expect(selectLayoutProbes(allCards)).toEqual([
			"place-card-rows",
			"stream-under-filter",
			"hero-drafting-vitals",
		]);
		expect(
			selectLayoutProbes(selectCards(["packages/spellkave-ui-widgets/src/Place.svelte"])),
		).toEqual(["place-card-rows"]);
		expect(
			selectLayoutProbes(selectCards(["packages/spellkave-ui-widgets/src/Hero.svelte"])),
		).toEqual(["hero-drafting-vitals"]);
		expect(
			selectLayoutProbes(selectCards(["packages/spellkave-ui-widgets/src/Pack.svelte"])),
		).toEqual([]);
	});
	// keep(K5): every probe names a real card and a beat; an unknown demo beat
	// silently falls back to explore, which would measure the wrong fixture.
	it("loads only beats that demo.html defines", () => {
		expect(Object.keys(layoutProbeBeats).sort()).toEqual(Object.keys(layoutProbeCards).sort());
		for (const card of Object.values(layoutProbeCards)) expect(allCards).toContain(card);
		const demo = readFileSync(resolve(import.meta.dirname, "src/demo.ts"), "utf8");
		const defined = (beat: string) =>
			["explore", "talk", "fight", "reaction", "brawl"].includes(beat) ||
			demo.includes(`"${beat}":`);
		for (const beat of [...sweepBeats, ...Object.values(layoutProbeBeats)])
			expect(defined(beat), beat).toBe(true);
		expect(sweepBeats).toEqual(expect.arrayContaining(["place-long", "hero-drafting"]));
	});
	// keep(K5): the probe is serialized into the browser; it must stay one
	// self-contained function expression.
	it("serializes the layout probe as a self-contained function", () => {
		const source = layoutProbes.toString();
		expect(source).not.toMatch(/\bimport\b|\brequire\(/);
		expect(typeof new Function(`return (${source});`)()).toBe("function");
	});
});
