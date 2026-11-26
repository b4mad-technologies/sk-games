import { describe, expect, it } from "vitest";
import { looksLikeRawRef, playCopy, playerTargetName } from "./player-copy";
import type { ShellFinderSource } from "./shell-finder";

/** Words that belong to the implementation, not to a player. */
const JARGON =
	/spellkave_|\bhandles?\b|\bfacts?\b|\bdrafts?\b|\bcall\b|\btokens?\b|\bbind(ing|s)?\b|\bintent\b|\bdisclosed\b|\bcanonical\b|\bsnapshot\b|\bauthored\b|\bentity:|\bref\b/i;

const SAMPLE_ARGS: Record<string, readonly unknown[]> = {
	"playCopy.defaults.summary": [['@"Aldwin"', "count:2"]],
	"playCopy.composer.keys.unpicked": ["Tab", "→", "↑/↓"],
	"playCopy.composer.keys.open": ["↑/↓", "Enter"],
	"playCopy.composer.keys.ready": ["Enter"],
	"playCopy.composer.keys.value": ["Enter"],
	"playCopy.composer.keys.write": ["↑/↓", "→"],
	"playCopy.composer.fieldHint": ["Name"],
	"playCopy.composer.goHint": ["Stairs"],
	"playCopy.composer.draftKept": ["Stairs"],
	"playCopy.candidates.numberRange": [8, 15],
	"playCopy.candidates.goTo": ["Stairs", "north"],
	"playCopy.attemptBlock.pickAction": ["/soldier"],
	"playCopy.attemptBlock.routeExtra": ["/go-stairs", '#"Cellar"'],
	"playCopy.attemptBlock.pickTarget": ["@Aldwin"],
	"playCopy.attemptBlock.quoteWords": ["Good morning, brother."],
	"playCopy.attemptBlock.fieldMissing": ["Name", 'name:"…"'],
	"playCopy.attemptBlock.strayForField": ["Brannoch", "Name", 'name:"Brannoch"'],
};
const DEFAULT_ARGS = ["Aldwin", "Inspect"];
/** Builders whose single argument is optional. */
const OPTIONAL_ARG = new Set([
	"playCopy.attemptBlock.chooseTarget",
	"playCopy.attemptBlock.quoteWords",
	"playCopy.session.repeatRefusal",
]);

function leaves(value: unknown, path: string): Array<[string, string]> {
	if (typeof value === "string") return [[path, value]];
	if (typeof value === "function") {
		const fn = value as (...args: unknown[]) => unknown;
		const outputs: Array<[string, string]> = [
			[`${path}(…)`, String(fn(...(SAMPLE_ARGS[path] ?? DEFAULT_ARGS)))],
		];
		if (OPTIONAL_ARG.has(path)) outputs.push([`${path}()`, String(fn())]);
		return outputs;
	}
	if (Array.isArray(value))
		return value.flatMap((entry, index) => leaves(entry, `${path}[${index}]`));
	if (value !== null && typeof value === "object") {
		return Object.entries(value).flatMap(([key, entry]) => leaves(entry, `${path}.${key}`));
	}
	throw new Error(`Unexpected copy value at ${path}`);
}

describe("playCopy", () => {
	const all = leaves(playCopy, "playCopy");

	it("has player sentences in every slot", () => {
		expect(all.length).toBeGreaterThan(40);
		for (const [path, text] of all) {
			expect(text.trim(), path).not.toBe("");
			expect(text, path).not.toContain("undefined");
		}
	});

	it("keeps implementation jargon and instructions to tools off the page", () => {
		for (const [path, text] of all) {
			expect(text, path).not.toMatch(JARGON);
		}
	});

	it("names every finder source", () => {
		const sources: ShellFinderSource[] = [
			"actions",
			"targets",
			"prompts",
			"sensing",
			"movement",
			"turn",
			"participants",
			"history",
			"pack",
			"fields",
		];
		for (const source of sources) expect(playCopy.sources[source].trim()).not.toBe("");
		expect(playCopy.sources).toMatchObject({
			prompts: "Answer",
			actions: "Do",
			targets: "Here",
			sensing: "Notice",
			movement: "Go",
			turn: "Turn",
			pack: "Pack",
			history: "Recent",
			fields: "Fill in",
		});
	});

	it("says that Tab picks and Enter sends, for a typed word that is not picked", () => {
		expect(playCopy.attemptBlock.pickAction("/soldier")).toBe(
			"“/soldier” is not picked yet. Press Tab to pick it from the suggestions, then Enter to send.",
		);
		expect(playCopy.attemptBlock.pickTarget("@Aldwin")).toBe(
			"“@Aldwin” is not picked yet. Press Tab to pick it from the suggestions, then Enter to send.",
		);
		expect(playCopy.attemptBlock.chooseAnswer).toBe(
			"Pick an answer: press Tab to see the answers, then Enter to send.",
		);
		expect(playCopy.attemptBlock.chooseAction).toBe(
			"What do you do? Type / and press Tab to pick, then Enter to send.",
		);
		expect(playCopy.composer.idleHint).toMatch(/Tab picks, Enter sends\.$/);
		// The line for a sentence nothing stops never promises that it is accepted.
		expect(playCopy.composer.sendHint).toBe("Press Enter to send.");
	});

	it("has one key legend per state", () => {
		expect(playCopy.composer.keys.unpicked("Tab", "→", "↑/↓")).toBe(
			"Tab pick · → take grey text · ↑/↓ browse",
		);
		expect(playCopy.composer.keys.open("↑/↓", "Enter")).toBe(
			"↑/↓ move · Enter or Tab put it in · Esc close",
		);
		expect(playCopy.composer.keys.ready("Enter")).toBe("Enter send · Tab more choices");
		// Inside a value, and for a blocker that asks for words, no picking key is named.
		expect(playCopy.composer.keys.value("Enter")).toBe("Enter send");
		expect(playCopy.composer.keys.write("↑/↓")).toBe("↑/↓ browse");
		expect(playCopy.composer.keys.write("↑/↓", "→")).toBe("→ take grey text · ↑/↓ browse");
	});

	it("asks for quotes around loose words and echoes them", () => {
		expect(playCopy.attemptBlock.quoteWords("Good morning, brother.")).toBe(
			'Put what you say in quotes: "Good morning, brother."',
		);
		const long = playCopy.attemptBlock.quoteWords(
			"I have walked a very long way to stand here before you today",
		);
		expect(long).toMatch(/^Put what you say in quotes: "I have walked .*…"$/);
		expect(long.length).toBeLessThan(80);
		expect(long).not.toMatch(JARGON);
		const quoted = playCopy.attemptBlock.quoteWords('he said "no');
		expect(quoted).toBe('Put what you say in quotes, like "hello".');
		expect(quoted).not.toMatch(JARGON);
		expect(playCopy.attemptBlock.quoteWords()).toBe(quoted);
		expect(playCopy.attemptBlock.oneQuote).toBe(
			"Put all of what you say inside one pair of quotes.",
		);
	});

	it("names a missing detail and its spelling", () => {
		expect(playCopy.attemptBlock.fieldMissing("Name", 'name:"…"')).toBe(
			'“Name” is missing. Add it as name:"…".',
		);
		expect(playCopy.attemptBlock.strayForField("Brannoch", "Name", 'name:"Brannoch"')).toBe(
			'“Brannoch” is not part of anything yet. For the Name, write name:"Brannoch".',
		);
		expect(playCopy.composer.fieldHint("Name")).toBe(
			"Write the Name between the quotes, then press Enter to send.",
		);
	});

	it("names the destination of a way out and keeps unsent words", () => {
		expect(playCopy.composer.goHint("Stairs")).toBe("Go to Stairs. Press Enter to set off.");
		expect(playCopy.composer.draftKept("Stairs")).toBe(
			"You have unsent words in the box. Send or clear them, then choose Stairs again.",
		);
	});

	it("names each outcome state in words", () => {
		expect(playCopy.outcome.rejected).toMatch(/^Refused/);
		expect(playCopy.outcome.unobserved).toMatch(/^Result unknown/);
		expect(playCopy.outcome.blocked).toMatch(/^Not sent/);
	});

	it("names the chosen action when asking for a target", () => {
		expect(playCopy.attemptBlock.chooseTarget("Inspect")).toBe(
			"Inspect: who or what? Type @ for someone here, # for a place or thing.",
		);
		expect(playCopy.attemptBlock.chooseTarget()).toBe(
			"Who or what? Type @ for someone here, # for a place or thing.",
		);
	});

	it("repeats the earlier refusal when it is known", () => {
		expect(playCopy.session.repeatRefusal("The door is locked.")).toBe(
			"That was already refused: The door is locked. Try something else, or wait until something changes.",
		);
		expect(playCopy.session.repeatRefusal()).toMatch(/^That was already refused\./);
	});
});

describe("raw reference guard", () => {
	it("detects missing and raw names", () => {
		expect(looksLikeRawRef(undefined)).toBe(true);
		expect(looksLikeRawRef("  ")).toBe(true);
		expect(looksLikeRawRef("entity:168")).toBe(true);
		expect(looksLikeRawRef("item:4")).toBe(true);
		expect(looksLikeRawRef("Hearth", "place_node:Hearth")).toBe(false);
		expect(looksLikeRawRef("x7", "x7")).toBe(true);
		expect(looksLikeRawRef("Aldwin")).toBe(false);
	});

	it("replaces a raw name with a neutral one", () => {
		expect(playerTargetName("entity:168", "entity:168")).toBe("Someone here");
		expect(playerTargetName(undefined, "item:4")).toBe("Something here");
		expect(playerTargetName(" Aldwin ", "entity:2")).toBe("Aldwin");
	});

	it("names a way out by its destination and keeps the direction in brackets", () => {
		expect(playCopy.candidates.goTo("Stairs", "north")).toBe("Go — Stairs (north)");
		expect(playCopy.candidates.goTo("Stairs")).toBe("Go — Stairs");
		// A way out with no destination name is named by its direction once.
		expect(playCopy.candidates.goTo("North", "north")).toBe("Go — North");
		expect(playCopy.candidates.goTo("Stairs", " ")).toBe("Go — Stairs");
	});

	it("says in plain words that a hero who is down cannot act", () => {
		expect(playCopy.composer.downed).toBe("You are down and cannot act right now.");
	});
});
