import { describe, expect, it, vi } from "vitest";
import {
	commandForKey,
	DEFAULT_KEYMAP,
	KEYMAP_CHANGE_EVENT,
	KEYMAP_STORAGE_KEY,
	keyLabelFor,
	keymapWithOverrides,
	loadKeymap,
	saveKeymap,
	shellCommandForKey,
	slotIndexOf,
} from "./keymap";

describe("commandForKey", () => {
	it("maps the default keys to their commands", () => {
		expect(commandForKey(DEFAULT_KEYMAP, { key: "." })).toBe("select.next");
		expect(commandForKey(DEFAULT_KEYMAP, { key: "," })).toBe("select.prev");
		expect(commandForKey(DEFAULT_KEYMAP, { key: "Escape" })).toBe("select.clear");
		expect(commandForKey(DEFAULT_KEYMAP, { key: "3" })).toBe("slot.3");
		expect(commandForKey(DEFAULT_KEYMAP, { key: "x" })).toBeNull();
	});

	it("leaves browser/OS chords alone and reserves editing chords for the shell", () => {
		expect(commandForKey(DEFAULT_KEYMAP, { key: "1", metaKey: true })).toBeNull();
		expect(commandForKey(DEFAULT_KEYMAP, { key: "1", ctrlKey: true })).toBeNull();
		expect(commandForKey(DEFAULT_KEYMAP, { key: "1", altKey: true })).toBeNull();
		expect(commandForKey(DEFAULT_KEYMAP, { key: "k", ctrlKey: true })).toBeNull();
	});

	it("never binds Tab by default: it is the browser's focus navigation", () => {
		expect(commandForKey(DEFAULT_KEYMAP, { key: "Tab" })).toBeNull();
	});
});

describe("shellCommandForKey", () => {
	it("scopes finder keys to the input and never captures printable text or IME", () => {
		expect(shellCommandForKey(DEFAULT_KEYMAP, { key: "ArrowDown" }, "finder")).toBe("shell.next");
		expect(shellCommandForKey(DEFAULT_KEYMAP, { key: "Enter" }, "finder")).toBe("shell.accept");
		expect(shellCommandForKey(DEFAULT_KEYMAP, { key: "Enter" }, "input")).toBe("shell.attempt");
		expect(shellCommandForKey(DEFAULT_KEYMAP, { key: "x" }, "finder")).toBeNull();
		expect(
			shellCommandForKey(DEFAULT_KEYMAP, { key: "Enter", isComposing: true }, "finder"),
		).toBeNull();
		expect(
			shellCommandForKey(DEFAULT_KEYMAP, { key: "Enter", shiftKey: true }, "finder"),
		).toBeNull();
		expect(
			shellCommandForKey(DEFAULT_KEYMAP, { key: "Enter", ctrlKey: true, shiftKey: true }, "input"),
		).toBeNull();
	});
});

describe("keymapWithOverrides", () => {
	it("rebinds a command and frees the key from the default that held it", () => {
		const keymap = keymapWithOverrides({ "select.next": ["1"] });
		expect(commandForKey(keymap, { key: "1" })).toBe("select.next");
		expect(commandForKey(keymap, { key: "." })).toBeNull();
		expect(keymap["slot.1"]).toEqual([]);
		expect(commandForKey(keymap, { key: "2" })).toBe("slot.2");
	});

	it("drops unknown commands, non-array values, non-string keys and Tab", () => {
		const keymap = keymapWithOverrides({
			"no.such.command": ["q"],
			"select.prev": "x",
			"select.next": ["Tab", 7, "", "n"],
		});
		expect(keymap["select.next"]).toEqual(["n"]);
		expect(keymap["select.prev"]).toEqual([","]);
		expect(commandForKey(keymap, { key: "q" })).toBeNull();
		expect(commandForKey(keymap, { key: "Tab" })).toBeNull();
	});

	it("falls back to the defaults for anything that is not an object", () => {
		expect(keymapWithOverrides(null)).toBe(DEFAULT_KEYMAP);
		expect(keymapWithOverrides("nope")).toBe(DEFAULT_KEYMAP);
		expect(keymapWithOverrides([["select.next", ["n"]]])).toBe(DEFAULT_KEYMAP);
		expect(keymapWithOverrides({})).toBe(DEFAULT_KEYMAP);
	});
});

describe("loadKeymap", () => {
	it("applies overrides stored under the keymap key", () => {
		const storage = {
			getItem: (key: string) =>
				key === KEYMAP_STORAGE_KEY ? JSON.stringify({ "select.next": ["n"] }) : null,
		};
		expect(commandForKey(loadKeymap(storage), { key: "n" })).toBe("select.next");
	});

	it("migrates a legacy preference when no V2 preference exists", () => {
		const storage = {
			getItem: (key: string) =>
				key === "spellkave.play.keymap" ? JSON.stringify({ "select.next": ["n"] }) : null,
		};
		expect(commandForKey(loadKeymap(storage), { key: "n" })).toBe("select.next");
	});

	it("survives missing, throwing and corrupt storage", () => {
		expect(loadKeymap(undefined)).toBe(DEFAULT_KEYMAP);
		expect(
			loadKeymap({
				getItem: () => {
					throw new Error("blocked");
				},
			}),
		).toBe(DEFAULT_KEYMAP);
		expect(loadKeymap({ getItem: () => "{not json" })).toBe(DEFAULT_KEYMAP);
	});
});

describe("saveKeymap", () => {
	it("persists the complete map and announces live consumers", () => {
		const writes: string[] = [];
		const onChange = vi.fn();
		window.addEventListener(KEYMAP_CHANGE_EVENT, onChange);
		saveKeymap(
			{ ...DEFAULT_KEYMAP, "turn.end": ["e"] },
			{ setItem: (_key, value) => writes.push(value) },
		);
		window.removeEventListener(KEYMAP_CHANGE_EVENT, onChange);
		expect((JSON.parse(writes[0] ?? "{}") as Record<string, unknown>)["turn.end"]).toEqual(["e"]);
		expect(onChange).toHaveBeenCalledOnce();
	});
});

describe("slotIndexOf / keyLabelFor", () => {
	it("turns a slot command into its zero-based index", () => {
		expect(slotIndexOf("slot.1")).toBe(0);
		expect(slotIndexOf("slot.9")).toBe(8);
		expect(slotIndexOf("select.next")).toBeNull();
	});

	it("labels a command with its first bound key, or null when unbound", () => {
		expect(keyLabelFor(DEFAULT_KEYMAP, "slot.4")).toBe("4");
		expect(keyLabelFor(DEFAULT_KEYMAP, "turn.end")).toBeNull();
	});
});
