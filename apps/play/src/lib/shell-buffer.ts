/**
 * The Play shell's local editing model.
 *
 * This module intentionally knows no reducer names, action eligibility, or
 * world lookup. It retains the distinction the UI needs: player-owned text,
 * syntactic spans in that text, and optional explicit bindings to already
 * disclosed facts. A binding is invalidated by editing its text; it is never
 * reconstructed from a label.
 */

export type ShellTokenKind =
	| "action"
	| "actor"
	| "world_ref"
	| "field"
	| "payload"
	| "reaction"
	| "participant"
	| "unknown";

export interface ShellSpan {
	start: number;
	end: number;
}

export interface ShellToken extends ShellSpan {
	kind: ShellTokenKind;
	text: string;
}

/** The canonical identity is opaque to this parser. It must originate in a
 * caller-visible fact; a repeated label is therefore never enough to restore
 * it after text changes. */
export interface ShellBinding extends ShellSpan {
	kind: Exclude<ShellTokenKind, "unknown" | "payload">;
	text: string;
	canonical: string;
	semanticContext?: Readonly<{ source_ref: string; occurrence_id: string }>;
}

export interface ShellBuffer {
	text: string;
	bindings: readonly ShellBinding[];
}

export interface ShellCandidate {
	/** Exact player-facing text to insert, including its grammar sigil. */
	text: string;
	kind: Exclude<ShellTokenKind, "unknown" | "payload">;
	/** Opaque id/ref from the disclosed source, never derived from `text`. */
	canonical: string;
	semanticContext?: Readonly<{ source_ref: string; occurrence_id: string }>;
}

/** A selection replacement or committed browser input edit. `text` may be a
 * paste or completed IME value; composition events themselves stay in the DOM
 * and do not need a parallel model. */
export interface ShellEdit {
	range: ShellSpan;
	text: string;
}

/**
 * The span that a completion owns at the native input's current selection.
 * An explicit selection wins so completion has normal replace-selection
 * semantics. A collapsed caret owns the complete parser token containing it;
 * this deliberately keeps quoted references, quoted field values, and payloads
 * intact rather than treating whitespace inside a quote as a token boundary.
 */
export function shellCompletionRange(text: string, selection: ShellSpan): ShellSpan {
	if (!validRange(text, selection)) return { start: text.length, end: text.length };
	if (selection.start !== selection.end) return selection;
	const caret = selection.start;
	for (const token of parseShellBuffer(text)) {
		if (token.start <= caret && caret <= token.end) {
			return { start: token.start, end: token.end };
		}
	}
	return { start: caret, end: caret };
}

/**
 * True when a completion range lies in a value the player writes: a quoted
 * payload, or a detail (`name:"…"`, `count:4`). A completion replaces its
 * whole range, so there it would destroy written words; the composer offers
 * no completion for such a range (sk-jay0.1.8.109). A quoted name (`@"…"`,
 * `#"…"`) is a pick, never a value.
 *
 * A collapsed caret counts from behind the opening quote or the detail's colon
 * up to the token's end. Any wider range counts as soon as it overlaps that
 * part, which includes the whole-token range `shellCompletionRange` returns
 * for a caret anywhere in a detail.
 */
export function shellRangeInValue(text: string, range: ShellSpan): boolean {
	if (!validRange(text, range)) return false;
	return parseShellBuffer(text).some((token) => {
		if (token.kind !== "payload" && token.kind !== "field") return false;
		const valueStart =
			token.kind === "payload" ? token.start : token.start + token.text.indexOf(":");
		return range.start === range.end
			? range.start > valueStart && range.start <= token.end
			: range.start < token.end && range.end > valueStart;
	});
}

/**
 * The words of one value as the player means them. `raw` is a payload token
 * or the part of a detail behind its colon. The enclosing quotes are dropped
 * and the two escapes the tokeniser honours are undone: a backslash before a
 * quote gives the quote, two backslashes give one. A backslash before any
 * other character stays as typed, and so does an unquoted value. An unclosed
 * quote yields what has been written so far.
 */
export function shellQuotedValue(raw: string): string {
	if (!raw.startsWith('"')) return raw.replace(/"$/, "");
	let value = "";
	let cursor = 1;
	while (cursor < raw.length) {
		const character = raw[cursor] ?? "";
		const next = raw[cursor + 1];
		if (character === "\\" && (next === '"' || next === "\\")) {
			value += next;
			cursor += 2;
			continue;
		}
		cursor += 1;
		if (character === '"') break;
		value += character;
	}
	// Text behind the closing quote of a detail stays part of its value.
	return value + raw.slice(cursor);
}

export function emptyShellBuffer(text = ""): ShellBuffer {
	return { text, bindings: [] };
}

function isWhitespace(character: string): boolean {
	return /\s/.test(character);
}

function consumeQuoted(text: string, start: number): number {
	let cursor = start + 1;
	while (cursor < text.length) {
		if (text[cursor] === "\\") {
			cursor += 2;
			continue;
		}
		if (text[cursor] === '"') return cursor + 1;
		cursor += 1;
	}
	return text.length;
}

function consumeToken(text: string, start: number): number {
	let cursor = start;
	while (cursor < text.length && !isWhitespace(text[cursor] ?? "")) {
		if (text[cursor] === '"') cursor = consumeQuoted(text, cursor);
		else cursor += 1;
	}
	return cursor;
}

function tokenKind(token: string): ShellTokenKind {
	if (token.startsWith("/")) return "action";
	if (token.startsWith("@")) return "actor";
	if (token.startsWith("#")) return "world_ref";
	if (token.startsWith(":")) return "reaction";
	if (token.startsWith("+")) return "participant";
	if (token.startsWith('"')) return "payload";
	return /^[A-Za-z_][A-Za-z0-9_-]*:/.test(token) ? "field" : "unknown";
}

/** Parses player text only. An unterminated quote remains one payload/token so
 * a live editor can render and repair it without rejecting the entire buffer. */
export function parseShellBuffer(text: string): readonly ShellToken[] {
	const tokens: ShellToken[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		while (cursor < text.length && isWhitespace(text[cursor] ?? "")) cursor += 1;
		if (cursor >= text.length) break;
		const start = cursor;
		const end = text[cursor] === '"' ? consumeQuoted(text, cursor) : consumeToken(text, cursor);
		const tokenText = text.slice(start, end);
		tokens.push({ start, end, text: tokenText, kind: tokenKind(tokenText) });
		cursor = end;
	}
	return tokens;
}

function validRange(text: string, range: ShellSpan): boolean {
	return (
		Number.isInteger(range.start) &&
		Number.isInteger(range.end) &&
		range.start >= 0 &&
		range.start <= range.end &&
		range.end <= text.length
	);
}

function shiftBinding(binding: ShellBinding, delta: number): ShellBinding {
	return { ...binding, start: binding.start + delta, end: binding.end + delta };
}

/** Applies one explicit replacement. Bindings intersecting the changed range
 * are deliberately dropped. Bindings wholly after it shift without changing
 * identity; bindings before it remain untouched. */
export function applyShellEdit(buffer: ShellBuffer, edit: ShellEdit): ShellBuffer {
	if (!validRange(buffer.text, edit.range))
		throw new Error("Shell edit range is outside the buffer");
	const text = `${buffer.text.slice(0, edit.range.start)}${edit.text}${buffer.text.slice(edit.range.end)}`;
	const delta = edit.text.length - (edit.range.end - edit.range.start);
	const bindings = buffer.bindings.flatMap((binding) => {
		if (binding.end <= edit.range.start) return [binding];
		if (binding.start >= edit.range.end) return [shiftBinding(binding, delta)];
		return [];
	});
	return { text, bindings };
}

/** Reconciles a committed native-input value (typing, paste, undo/redo, or an
 * IME commit). It finds the minimal changed range and applies the same binding
 * invalidation rule. Undo restores text, not a guessed world binding. */
export function reconcileShellText(buffer: ShellBuffer, nextText: string): ShellBuffer {
	if (nextText === buffer.text) return buffer;
	let start = 0;
	while (
		start < buffer.text.length &&
		start < nextText.length &&
		buffer.text[start] === nextText[start]
	) {
		start += 1;
	}
	let oldEnd = buffer.text.length;
	let nextEnd = nextText.length;
	while (oldEnd > start && nextEnd > start && buffer.text[oldEnd - 1] === nextText[nextEnd - 1]) {
		oldEnd -= 1;
		nextEnd -= 1;
	}
	return applyShellEdit(buffer, {
		range: { start, end: oldEnd },
		text: nextText.slice(start, nextEnd),
	});
}

function exactCandidateToken(candidate: ShellCandidate): ShellToken {
	const tokens = parseShellBuffer(candidate.text);
	const token = tokens[0];
	if (
		tokens.length !== 1 ||
		token === undefined ||
		token.start !== 0 ||
		token.end !== candidate.text.length
	) {
		throw new Error("A shell candidate must insert exactly one token");
	}
	if (token.kind !== candidate.kind)
		throw new Error("A shell candidate kind must match its token syntax");
	return token;
}

/** Completion changes only its requested span. The returned binding is tied to
 * that exact inserted text and disclosed canonical identity. */
export function bindShellCandidate(
	buffer: ShellBuffer,
	range: ShellSpan,
	candidate: ShellCandidate,
): ShellBuffer {
	exactCandidateToken(candidate);
	const edited = applyShellEdit(buffer, { range, text: candidate.text });
	const start = range.start;
	const binding: ShellBinding = {
		start,
		end: start + candidate.text.length,
		text: candidate.text,
		kind: candidate.kind,
		canonical: candidate.canonical,
		...(candidate.semanticContext === undefined
			? {}
			: { semanticContext: candidate.semanticContext }),
	};
	return {
		...edited,
		bindings: [...edited.bindings, binding].sort((left, right) => left.start - right.start),
	};
}

/** Drops bindings whose stored span no longer represents their original text.
 * This is defensive for callers restoring a persisted draft or applying a DOM
 * edit without `reconcileShellText`; it never attempts a label-based repair. */
export function validShellBindings(buffer: ShellBuffer): readonly ShellBinding[] {
	return buffer.bindings.filter(
		(binding) =>
			validRange(buffer.text, binding) &&
			buffer.text.slice(binding.start, binding.end) === binding.text,
	);
}

/** Attempt previews may inspect canonical identities but must not format or
 * mutate the raw buffer. Dispatch integration remains outside this module. */
export function shellAttemptPreview(buffer: ShellBuffer): Readonly<{
	text: string;
	tokens: readonly ShellToken[];
	bindings: readonly ShellBinding[];
}> {
	return {
		text: buffer.text,
		tokens: parseShellBuffer(buffer.text),
		bindings: validShellBindings(buffer),
	};
}
