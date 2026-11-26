/**
 * A bounded, redacted trail of what the client did and saw — built after a
 * co-play (2026-09-03) where the coordinator watching the operator's headed
 * browser could not see what was clicked: `apps/play` logged nothing per
 * action, so every check was a DOM diff plus a trip to the world's own trace
 * table. The trail is the client half of the feedback report (the
 * feedback-button bead reads `window.__spellkavePlayTrail` to attach it).
 *
 * Five kinds, one entry each:
 * - `act` — a player-issued write (`spellkave_move`, `spellkave_manipulate`,
 *   `spellkave_end_turn`, `spellkave_react_option`), recorded in `play-session.ts`.
 * - `read` — a view refresh the player's OWN action asked for (including the
 *   session's first bootstrap read), recorded in `play-session.ts`.
 * - `world_pull` — a view refresh the WORLD pushed unprompted (`live.onUpdate`
 *   firing with nobody having just acted), recorded in `play-session.ts`.
 * - `layout` — a mosaic tile settling on a new level (strip/card/stage),
 *   recorded from `PlayTable.svelte`'s own layout-mutation sites only, never
 *   the continuous in-flight frames of a drag or a pinch.
 * - `tool_error` — a `spellkave_*` tool call that threw or came back
 *   unavailable, recorded in `play-session.ts`.
 *
 * The trail only ever observes; it is never a place to put anything the
 * world did not already tell the player (D1, no optimistic writes —
 * `ledger/designs/play-zoomed-table.md`, "Talk as thread, Chronicle as
 * logbook"). It reads and writes nothing of its own to the world.
 */

// Value imports only for the singleton's `onEntry` wiring — see the doc on
// `playTrail` below for why these are the Vite/env-specific couplings this
// otherwise framework-free module carries.
import { playRumProducer } from "./play-rum";
import { playTelemetryProducer } from "./play-telemetry";

export const PLAY_TRAIL_LIMIT = 100;

export type PlayTrailKind = "act" | "read" | "world_pull" | "layout" | "tool_error";

interface PlayTrailEntryBase {
	/** Monotonic per-trail sequence number — stable render key, insertion order. */
	id: number;
	/** Wall-clock `Date.now()` at the moment of recording. Display/ordering
	 * only; `tick` is the world-authoritative time. */
	at: number;
	/** The freshest world tick known to the caller when this entry was
	 * recorded, or `0` before any tick-carrying fact has arrived. */
	tick: number;
}

export interface PlayTrailActEntry extends PlayTrailEntryBase {
	kind: "act";
	tool: string;
	actionId: string | null;
	targetRef: string | null;
	words: string | null;
	outcome: string | null;
	observation: string | null;
	durationMs: number;
	/** The world's own raw refusal code, `null` unless this act's outcome was
	 * a rejection/failure with one (sk-j8e.4). Read back by `App.svelte`'s
	 * `lastActRefusal()` the same way `lastActStatusKind()` already reads
	 * `outcome` — never a widened `PlaySessionHandle` return contract. */
	refusalCode: string | null;
	/** The world's own `failure_detail` alongside `refusalCode`, when it had one. */
	refusalDetail: string | null;
}

export interface PlayTrailReadEntry extends PlayTrailEntryBase {
	kind: "read";
	tool: string;
	counts: Readonly<Record<string, number>>;
}

export interface PlayTrailWorldPullEntry extends PlayTrailEntryBase {
	kind: "world_pull";
	tool: string;
	counts: Readonly<Record<string, number>>;
}

export interface PlayTrailLayoutEntry extends PlayTrailEntryBase {
	kind: "layout";
	tile: string;
	level: string;
	trigger: string;
}

export interface PlayTrailToolErrorEntry extends PlayTrailEntryBase {
	kind: "tool_error";
	tool: string;
	message: string;
}

export type PlayTrailEntry =
	| PlayTrailActEntry
	| PlayTrailReadEntry
	| PlayTrailWorldPullEntry
	| PlayTrailLayoutEntry
	| PlayTrailToolErrorEntry;

// ── Redaction ─────────────────────────────────────────────────────────────

const BEARER_PATTERN = /\bBearer\s+\S+/gi;
// WorkOS AuthKit access/refresh tokens are JWTs: three base64url segments
// joined by dots. Matched independently of the `Bearer ` prefix above so a
// token pasted bare (e.g. copied into a say field by mistake) is still caught.
const JWT_PATTERN = /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
// Any other long opaque run (session ids, API keys, profile secrets) — every
// id this app's own domain mints (entity refs, node ids, trace/affordance
// handles) is short and structured (`item:42`, `srd/speak-to`, `h:1`), so a
// bare 32+ character alphanumeric run is never one of ours.
const OPAQUE_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;
const REDACTED = "[redacted]";

/**
 * Scrubs anything that reads as a bearer/JWT/opaque-token secret out of one
 * string field. Applied to every free-text field an entry carries before it
 * ever reaches the ring buffer — this is the function the bead's unit test
 * proves ("no secret or bearer string can enter an entry").
 */
export function redactTrailText(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	return value
		.replace(BEARER_PATTERN, REDACTED)
		.replace(JWT_PATTERN, REDACTED)
		.replace(OPAQUE_TOKEN_PATTERN, REDACTED);
}

function redactedOrNull(value: string | null): string | null {
	return value === null ? null : redactTrailText(value);
}

// ── The ring buffer ──────────────────────────────────────────────────────

export interface RecordActInput {
	tool: string;
	actionId?: string | null;
	targetRef?: string | null;
	words?: string | null;
	outcome?: string | null;
	observation?: string | null;
	durationMs: number;
	tick: number;
	refusalCode?: string | null;
	refusalDetail?: string | null;
}

export interface RecordReadInput {
	tool: string;
	counts: Readonly<Record<string, number>>;
	tick: number;
}

export interface RecordLayoutInput {
	tile: string;
	level: string;
	trigger: string;
	tick: number;
}

export interface RecordToolErrorInput {
	tool: string;
	message: string;
	tick: number;
}

export interface PlayTrail {
	recordAct(entry: RecordActInput): void;
	recordRead(entry: RecordReadInput): void;
	recordWorldPull(entry: RecordReadInput): void;
	recordLayout(entry: RecordLayoutInput): void;
	recordToolError(entry: RecordToolErrorInput): void;
	/** A snapshot copy, oldest first — never the live internal array, so a
	 * caller (or `window.__spellkavePlayTrail`'s own getter) cannot mutate
	 * the trail by holding onto what this returns. */
	entries(): readonly PlayTrailEntry[];
}

export interface CreatePlayTrailOptions {
	/** Ring-buffer cap. Defaults to `PLAY_TRAIL_LIMIT`. */
	limit?: number;
	/**
	 * Mirror every recorded entry to `console.debug` under a `"play"` prefix.
	 * A plain boolean rather than this module reading `import.meta.env.DEV`
	 * itself, so `play-trail.ts` stays a framework-free unit under test; wire
	 * it from `import.meta.env.DEV` at the call site (`play-session.ts`) —
	 * that call site is Vite-processed, so the flag is the literal `false`
	 * constant in a production build and the mirroring never fires.
	 */
	debug?: boolean;
	/** Test seam: replaces `Date.now`. */
	now?: () => number;
	/**
	 * Test seam: replaces the `window` the read-only getter installs onto.
	 * Omit to use the real `window`; installation is skipped entirely when
	 * neither this nor a real `window` is available (there is no such
	 * environment in this browser-only app, but the guard costs nothing).
	 */
	windowRef?: Window;
	/**
	 * Exporter hook: called with every finalized (already redacted) entry
	 * right after it lands in the ring buffer. `play-telemetry.ts` is the
	 * only consumer today — this module stays framework/Vite-free itself
	 * (see the module doc), so it exposes a plain callback rather than
	 * importing anything telemetry-specific. A throwing hook is swallowed:
	 * an exporter fault must never break the trail it observes.
	 */
	onEntry?: (entry: PlayTrailEntry) => void;
}

declare global {
	interface Window {
		/** Read-only: `Object.defineProperty` installs a getter with no
		 * setter, so an assignment to this from the console is a silent
		 * no-op (non-strict) or a `TypeError` (strict) — either way the
		 * trail itself never changes. */
		__spellkavePlayTrail?: readonly PlayTrailEntry[];
	}
}

function installWindowTrail(trail: PlayTrail, windowRef: Window | undefined): void {
	const target = windowRef ?? (typeof window === "undefined" ? undefined : window);
	if (target === undefined) return;
	Object.defineProperty(target, "__spellkavePlayTrail", {
		configurable: true,
		enumerable: true,
		get: () => trail.entries(),
	});
}

/**
 * Builds one trail: a bounded ring buffer, a `console.debug` mirror gated by
 * `debug`, and (unless `windowRef` says otherwise) the read-only
 * `window.__spellkavePlayTrail` getter. `play-session.ts` and
 * `PlayTable.svelte` both import the module-level `playTrail` singleton
 * below rather than calling this directly, so every entry — acts, reads,
 * world pulls, layout changes and tool errors alike — lands on the SAME
 * ring buffer the one `window.__spellkavePlayTrail` getter reads. Exported
 * mainly so this bead's own tests can build an isolated trail with
 * deterministic `now`/`windowRef` seams instead of touching the real page.
 */
export function createPlayTrail(options: CreatePlayTrailOptions = {}): PlayTrail {
	const limit = options.limit ?? PLAY_TRAIL_LIMIT;
	const debug = options.debug ?? false;
	const now = options.now ?? (() => Date.now());
	const onEntry = options.onEntry;
	let stored: PlayTrailEntry[] = [];
	let nextId = 1;

	function push(entry: PlayTrailEntry): void {
		stored = [...stored, entry].slice(-limit);
		if (debug) console.debug("[play]", entry.kind, entry);
		if (onEntry !== undefined) {
			try {
				onEntry(entry);
			} catch {
				// The trail itself must survive a faulty/throwing exporter.
			}
		}
	}

	function nextBase(tick: number): PlayTrailEntryBase {
		const id = nextId;
		nextId += 1;
		return { id, at: now(), tick };
	}

	const trail: PlayTrail = {
		recordAct(entry) {
			push({
				...nextBase(entry.tick),
				kind: "act",
				tool: redactTrailText(entry.tool) ?? entry.tool,
				actionId: redactedOrNull(entry.actionId ?? null),
				targetRef: redactedOrNull(entry.targetRef ?? null),
				words: redactedOrNull(entry.words ?? null),
				outcome: redactedOrNull(entry.outcome ?? null),
				observation: redactedOrNull(entry.observation ?? null),
				durationMs: entry.durationMs,
				refusalCode: redactedOrNull(entry.refusalCode ?? null),
				refusalDetail: redactedOrNull(entry.refusalDetail ?? null),
			});
		},
		recordRead(entry) {
			push({
				...nextBase(entry.tick),
				kind: "read",
				tool: redactTrailText(entry.tool) ?? entry.tool,
				counts: entry.counts,
			});
		},
		recordWorldPull(entry) {
			push({
				...nextBase(entry.tick),
				kind: "world_pull",
				tool: redactTrailText(entry.tool) ?? entry.tool,
				counts: entry.counts,
			});
		},
		recordLayout(entry) {
			push({
				...nextBase(entry.tick),
				kind: "layout",
				tile: redactTrailText(entry.tile) ?? entry.tile,
				level: redactTrailText(entry.level) ?? entry.level,
				trigger: redactTrailText(entry.trigger) ?? entry.trigger,
			});
		},
		recordToolError(entry) {
			push({
				...nextBase(entry.tick),
				kind: "tool_error",
				tool: redactTrailText(entry.tool) ?? entry.tool,
				message: redactedOrNull(entry.message) ?? "",
			});
		},
		entries() {
			return stored;
		},
	};

	installWindowTrail(trail, options.windowRef);
	return trail;
}

/**
 * The one trail the running app shares: `play-session.ts` records act/read/
 * world_pull/tool_error entries, `PlayTable.svelte` records layout entries,
 * and both see each other's entries through this same instance — a second,
 * independently-constructed trail would install its OWN
 * `window.__spellkavePlayTrail` getter and silently orphan the first one's
 * entries. `import.meta.env.DEV` is read here, at module scope, in this
 * Vite-processed app module — the same pattern `main.ts` already uses for
 * `devLocal` — so a production build's `debug` is the literal `false`
 * constant and the console.debug mirror never fires. `MODE !== "test"` keeps
 * the mirror out of `vitest` runs too: Vite's own convention makes `DEV`
 * true for every non-production mode, `"test"` included, and every existing
 * suite that exercises `play-session.ts`/`PlayTable.svelte` would otherwise
 * drown in trail lines that have nothing to do with what that suite tests.
 *
 * `onEntry` wires both telemetry producers onto the same singleton: the
 * local-only world-actor producer (`playTelemetryProducer`, sk-jay0.6.39)
 * and the production-only OpenObserve RUM producer (`playRumProducer`,
 * sk-jay0.6.40). Both are no-ops unless their own config and context gates
 * are open.
 */
export const playTrail: PlayTrail = createPlayTrail({
	debug: import.meta.env.DEV && import.meta.env.MODE !== "test",
	onEntry: (entry) => {
		playTelemetryProducer.record(entry);
		playRumProducer.record(entry);
	},
});
