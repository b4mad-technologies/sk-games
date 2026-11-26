import { describe, expect, it } from "vitest";
import {
	applyShellEdit,
	bindShellCandidate,
	emptyShellBuffer,
	parseShellBuffer,
	reconcileShellText,
	shellAttemptPreview,
	shellCompletionRange,
	shellQuotedValue,
	shellRangeInValue,
	validShellBindings,
} from "./shell-buffer";

const inspect = { text: "/inspect", kind: "action" as const, canonical: "srd/inspect" };
const chest = { text: '@"Locked chest"', kind: "actor" as const, canonical: "entity:4" };
const sameNamedItem = { text: '#"Locked chest"', kind: "world_ref" as const, canonical: "item:4" };

describe("shell buffer", () => {
	it("parses the player-facing grammar without assigning world identities", () => {
		expect(
			parseShellBuffer(
				'/speak @"Aldwin Grey" #inn mood:formal "Good evening" :react +witness stray',
			),
		).toMatchObject([
			{ kind: "action", text: "/speak" },
			{ kind: "actor", text: '@"Aldwin Grey"' },
			{ kind: "world_ref", text: "#inn" },
			{ kind: "field", text: "mood:formal" },
			{ kind: "payload", text: '"Good evening"' },
			{ kind: "reaction", text: ":react" },
			{ kind: "participant", text: "+witness" },
			{ kind: "unknown", text: "stray" },
		]);
	});

	it("treats a prompt label as ordinary text until finder selection binds it", () => {
		expect(parseShellBuffer("Barbarian")).toMatchObject([{ kind: "unknown", text: "Barbarian" }]);
	});

	it("keeps duplicate labels distinct through the disclosed canonical reference", () => {
		let buffer = bindShellCandidate(emptyShellBuffer(), { start: 0, end: 0 }, chest);
		buffer = applyShellEdit(buffer, {
			range: { start: buffer.text.length, end: buffer.text.length },
			text: " ",
		});
		buffer = bindShellCandidate(
			buffer,
			{ start: buffer.text.length, end: buffer.text.length },
			sameNamedItem,
		);
		expect(buffer.text).toBe('@"Locked chest" #"Locked chest"');
		expect(buffer.bindings.map((binding) => binding.canonical)).toEqual(["entity:4", "item:4"]);
	});

	it("replaces only the active span for a mid-buffer completion", () => {
		let buffer = bindShellCandidate(
			emptyShellBuffer("/ins @old #here"),
			{ start: 0, end: 4 },
			inspect,
		);
		buffer = bindShellCandidate(buffer, { start: 9, end: 13 }, chest);
		expect(buffer.text).toBe('/inspect @"Locked chest" #here');
		expect(buffer.bindings.map((binding) => binding.canonical)).toEqual([
			"srd/inspect",
			"entity:4",
		]);
	});

	it("finds the parser token under a mid-sentence caret without splitting quotes, fields, or payloads", () => {
		const text = '/inspect @"Locked chest" count:"two words" "look closely"';
		expect(
			shellCompletionRange(text, { start: text.indexOf("chest"), end: text.indexOf("chest") }),
		).toEqual({
			start: 9,
			end: 24,
		});
		const fieldStart = text.indexOf("two");
		expect(shellCompletionRange(text, { start: fieldStart, end: fieldStart })).toEqual({
			start: 25,
			end: 42,
		});
		const payloadStart = text.indexOf("look");
		expect(shellCompletionRange(text, { start: payloadStart, end: payloadStart })).toEqual({
			start: 43,
			end: 57,
		});
	});

	it("preserves an explicit native selection as the completion range", () => {
		expect(shellCompletionRange('/inspect @"Locked chest"', { start: 10, end: 16 })).toEqual({
			start: 10,
			end: 16,
		});
	});

	it("clears a binding when a paste replaces its selected span and shifts later bindings", () => {
		let buffer = bindShellCandidate(emptyShellBuffer(), { start: 0, end: 0 }, inspect);
		buffer = applyShellEdit(buffer, {
			range: { start: buffer.text.length, end: buffer.text.length },
			text: " ",
		});
		buffer = bindShellCandidate(
			buffer,
			{ start: buffer.text.length, end: buffer.text.length },
			chest,
		);
		const pasted = applyShellEdit(buffer, { range: { start: 0, end: 8 }, text: "/open" });
		expect(pasted.text).toBe('/open @"Locked chest"');
		expect(pasted.bindings).toMatchObject([{ canonical: "entity:4", start: 6 }]);
	});

	it("does not restore a guessed binding across undo or redo text changes", () => {
		const bound = bindShellCandidate(emptyShellBuffer(), { start: 0, end: 0 }, chest);
		const changed = reconcileShellText(bound, '@"Open chest"');
		const undone = reconcileShellText(changed, chest.text);
		expect(changed.bindings).toEqual([]);
		expect(undone.text).toBe(chest.text);
		expect(undone.bindings).toEqual([]);
	});

	it("treats an IME commit as one text reconciliation and keeps an unterminated quote repairable", () => {
		const committed = reconcileShellText(emptyShellBuffer('/speak "'), '/speak "こんにちは');
		expect(parseShellBuffer(committed.text)).toMatchObject([
			{ kind: "action", text: "/speak" },
			{ kind: "payload", text: '"こんにちは' },
		]);
	});

	it("rejects candidates that would smuggle whitespace or the wrong grammar kind", () => {
		expect(() =>
			bindShellCandidate(
				emptyShellBuffer(),
				{ start: 0, end: 0 },
				{
					text: "@Aldwin Grey",
					kind: "actor",
					canonical: "entity:aldwin",
				},
			),
		).toThrow("exactly one token");
		expect(() =>
			bindShellCandidate(
				emptyShellBuffer(),
				{ start: 0, end: 0 },
				{
					text: "#inn",
					kind: "actor",
					canonical: "entity:aldwin",
				},
			),
		).toThrow("kind");
	});

	it("keeps unknown fields and tokens as text and never dispatches from parsing", () => {
		const buffer = emptyShellBuffer("/inspect #chest madeup:value bare");
		expect(parseShellBuffer(buffer.text).map((token) => token.kind)).toEqual([
			"action",
			"world_ref",
			"field",
			"unknown",
		]);
		expect(shellAttemptPreview(buffer)).toEqual({
			text: buffer.text,
			tokens: parseShellBuffer(buffer.text),
			bindings: [],
		});
	});

	it("keeps only bindings whose exact source span still exists", () => {
		const bound = bindShellCandidate(emptyShellBuffer(), { start: 0, end: 0 }, chest);
		expect(validShellBindings({ ...bound, text: '@"Different chest"' })).toEqual([]);
	});
	it("knows when a completion range lies in a value the player writes", () => {
		const text = '/speak @"Aldwin Grey" mood:"very formal" count:4 "Good evening"';
		const at = (needle: string, offset = 0) => text.indexOf(needle) + offset;
		const inValue = (caret: number) =>
			shellRangeInValue(text, shellCompletionRange(text, { start: caret, end: caret }));
		// Names to pick are not values, quoted or not.
		expect(inValue(at("/speak", 3))).toBe(false);
		expect(inValue(at("Aldwin Grey", 8))).toBe(false);
		// Between tokens nothing is owned.
		expect(inValue(at(" mood"))).toBe(false);
		// A detail is one token: its name, its quotes and its value.
		expect(inValue(at("mood", 2))).toBe(true);
		expect(inValue(at("very formal", 5))).toBe(true);
		expect(inValue(at("count:4", 7))).toBe(true);
		// Spoken words, also with the caret right behind the closing quote.
		expect(inValue(at("Good evening", 4))).toBe(true);
		expect(inValue(text.length)).toBe(true);
		// A collapsed caret is judged where it stands.
		expect(shellRangeInValue(text, { start: at("mood", 2), end: at("mood", 2) })).toBe(false);
		expect(shellRangeInValue(text, { start: at("very"), end: at("very") })).toBe(true);
		// A selection counts as soon as it reaches into a value.
		expect(shellRangeInValue(text, { start: 0, end: 6 })).toBe(false);
		expect(shellRangeInValue(text, { start: 0, end: text.length })).toBe(true);
		expect(shellRangeInValue(text, { start: at("very"), end: at("very", 4) })).toBe(true);
		expect(shellRangeInValue(text, { start: 3, end: 999 })).toBe(false);
		// An unclosed quote is still a value being written.
		expect(shellRangeInValue('/speak "Good mor', { start: 16, end: 16 })).toBe(true);
	});

	it("keeps an escaped quote inside one token and reads the value back as written", () => {
		const text = '/name name:"Bran \\"the Bold\\"" "He said \\"wait\\" \\\\ twice"';
		const tokens = parseShellBuffer(text);
		expect(tokens.map((token) => token.kind)).toEqual(["action", "field", "payload"]);
		expect(shellQuotedValue(tokens[1]?.text.slice("name:".length) ?? "")).toBe('Bran "the Bold"');
		expect(shellQuotedValue(tokens[2]?.text ?? "")).toBe('He said "wait" \\ twice');
		// Plain, empty and unclosed values.
		expect(shellQuotedValue('"hello"')).toBe("hello");
		expect(shellQuotedValue('""')).toBe("");
		expect(shellQuotedValue('"Good mor')).toBe("Good mor");
		expect(shellQuotedValue("4")).toBe("4");
		// A backslash before any other character stays as typed.
		expect(shellQuotedValue('"C:\\temp"')).toBe("C:\\temp");
		// An unclosed value ending in an escaped quote keeps that quote.
		expect(shellQuotedValue('"say \\"')).toBe('say "');
	});
});
