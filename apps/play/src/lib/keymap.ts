/**
 * Play's keyboard seam (axiom A8, `ledger/designs/play-interaction-axioms.md`).
 *
 * Every key Play reacts to is a NAMED COMMAND looked up in one keymap; no
 * handler tests `event.key` itself. The defaults ship here, a player's
 * overrides live in `localStorage` (a per-viewer convenience: the page works
 * without it), and the rebinding dialog is a later package that only has to
 * write that one storage entry.
 *
 * `Tab` is never rebindable: inside the shell it completes or opens the
 * finder. Escape restores native Tab traversal; Shift+Tab stays native.
 * The defaults for walking the
 * selection are `.` and `,` because they are unshifted on every layout
 * (brackets need AltGr on a German keyboard). The composer also accepts the
 * fzf-like Ctrl-J/Ctrl-K chords; those chords are named here rather than
 * decoded in a component.
 */

export const SLOT_COUNT = 9;

const SLOT_COMMANDS = [
	"slot.1",
	"slot.2",
	"slot.3",
	"slot.4",
	"slot.5",
	"slot.6",
	"slot.7",
	"slot.8",
	"slot.9",
] as const;

export const PLAY_COMMANDS = [
	"select.next",
	"select.prev",
	"select.clear",
	...SLOT_COMMANDS,
	"composer.focus",
	"composer.next",
	"composer.prev",
	"shell.next",
	"shell.prev",
	"shell.accept",
	"shell.attempt",
	"turn.end",
	"hint.accept",
	"hint.dismiss",
	"dock.toggle",
] as const;

export type PlayCommand = (typeof PLAY_COMMANDS)[number];

export type Keymap = Readonly<Record<PlayCommand, readonly string[]>>;

/** Keys are `KeyboardEvent.key` values. A command may have several. */
export const DEFAULT_KEYMAP: Keymap = {
	"select.next": ["."],
	"select.prev": [","],
	"select.clear": ["Escape"],
	"slot.1": ["1"],
	"slot.2": ["2"],
	"slot.3": ["3"],
	"slot.4": ["4"],
	"slot.5": ["5"],
	"slot.6": ["6"],
	"slot.7": ["7"],
	"slot.8": ["8"],
	"slot.9": ["9"],
	"composer.focus": ["Enter"],
	"composer.next": ["Ctrl+j"],
	"composer.prev": [],
	"shell.next": ["ArrowDown", "Ctrl+n"],
	"shell.prev": ["ArrowUp", "Ctrl+p"],
	"shell.accept": ["Enter"],
	"shell.attempt": ["Enter"],
	"turn.end": [],
	"hint.accept": ["y"],
	"hint.dismiss": ["n"],
	// Compact (composer plus one line) or every group in its own row.
	"dock.toggle": ["b"],
};

/** V2 scopes shell commands separately from global selection commands. */
export const KEYMAP_STORAGE_KEY = "spellkave.play.keymap.v2";
export const LEGACY_KEYMAP_STORAGE_KEY = "spellkave.play.keymap";
export const KEYMAP_CHANGE_EVENT = "spellkave:play-keymap-change";

/** Keys no override may claim: the browser's own navigation. */
const RESERVED_KEYS = new Set(["Tab"]);

function isCommand(value: string): value is PlayCommand {
	return (PLAY_COMMANDS as readonly string[]).includes(value);
}

/**
 * The defaults with a player's overrides applied. `overrides` is untrusted
 * (it comes out of storage): anything that is not `{ command: string[] }`
 * with known commands and non-reserved keys is dropped, never thrown on. A
 * key an override claims is taken away from every command the player did NOT
 * override, so rebinding `select.next` to `1` does not leave `1` firing two
 * commands.
 */
export function keymapWithOverrides(overrides: unknown): Keymap {
	if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
		return DEFAULT_KEYMAP;
	}
	const accepted = new Map<PlayCommand, string[]>();
	for (const [command, keys] of Object.entries(overrides)) {
		if (!isCommand(command) || !Array.isArray(keys)) continue;
		accepted.set(
			command,
			keys.filter(
				(key): key is string =>
					typeof key === "string" && key.length > 0 && !RESERVED_KEYS.has(key),
			),
		);
	}
	if (accepted.size === 0) return DEFAULT_KEYMAP;
	const claimed = new Set([...accepted.values()].flat());
	const next = {} as Record<PlayCommand, readonly string[]>;
	for (const command of PLAY_COMMANDS) {
		next[command] =
			accepted.get(command) ?? DEFAULT_KEYMAP[command].filter((key) => !claimed.has(key));
	}
	return next;
}

/** Reads the stored overrides. Storage can be missing, blocked or hold
 * anything (a private window, cleared site data), so this never throws. */
export function loadKeymap(storage: Pick<Storage, "getItem"> | undefined): Keymap {
	try {
		const raw = storage?.getItem(KEYMAP_STORAGE_KEY) ?? storage?.getItem(LEGACY_KEYMAP_STORAGE_KEY);
		if (!raw) return DEFAULT_KEYMAP;
		return keymapWithOverrides(JSON.parse(raw));
	} catch {
		return DEFAULT_KEYMAP;
	}
}

/** Persist a complete keymap and notify an already-mounted Play surface. */
export function saveKeymap(keymap: Keymap, storage?: Pick<Storage, "setItem">): void {
	try {
		storage?.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(keymap));
		if (typeof window !== "undefined") window.dispatchEvent(new Event(KEYMAP_CHANGE_EVENT));
	} catch {
		// Private windows and blocked storage are best-effort conveniences.
	}
}

export interface KeyPress {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}

export type ShellKeyScope = "input" | "finder";
export type ShellCommand = "shell.next" | "shell.prev" | "shell.accept" | "shell.attempt";

/** The text input owns these commands. Printable keys and OS/Alt chords never
 * leak into application shortcuts while the player is composing text. */
export function shellCommandForKey(
	keymap: Keymap,
	press: KeyPress & { isComposing?: boolean },
	scope: ShellKeyScope,
): ShellCommand | null {
	if (press.isComposing || press.metaKey || press.altKey || press.shiftKey) return null;
	const key = press.ctrlKey
		? `Ctrl+${press.key.length === 1 ? press.key.toLocaleLowerCase() : press.key}`
		: press.key;
	const allowed: readonly ShellCommand[] =
		scope === "finder"
			? ["shell.next", "shell.prev", "shell.accept", "shell.attempt"]
			: ["shell.next", "shell.prev", "shell.attempt"];
	return allowed.find((command) => keymap[command].includes(key)) ?? null;
}

/**
 * The command a key press means, or `null`. Meta and Alt chords always belong
 * to the browser/OS (Cmd+1 switches tabs); the two explicit Ctrl composer
 * chords are represented as `Ctrl+<key>` in the shared map. The first command
 * in `PLAY_COMMANDS` order wins a doubly-bound key.
 */
export function commandForKey(keymap: Keymap, press: KeyPress): PlayCommand | null {
	if (press.metaKey || press.altKey) return null;
	const key = press.ctrlKey
		? `Ctrl+${press.key.length === 1 ? press.key.toLocaleLowerCase() : press.key}`
		: press.key;
	for (const command of PLAY_COMMANDS) {
		if (keymap[command].includes(key)) return command;
	}
	return null;
}

/** `slot.3` → `2`; any other command → `null`. */
export function slotIndexOf(command: PlayCommand): number | null {
	const index = (SLOT_COMMANDS as readonly string[]).indexOf(command);
	return index === -1 ? null : index;
}

/** The first key bound to a command, for a pill's digit or a hint's label. */
export function keyLabelFor(keymap: Keymap, command: PlayCommand): string | null {
	return keymap[command][0] ?? null;
}
