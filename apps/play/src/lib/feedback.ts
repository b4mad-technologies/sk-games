/**
 * The Send feedback dialog's transport (sk-jay0.1.14): one `spellkave_feedback`
 * MCP tool call per submission, over the same gateway origin the map tile's
 * canvas already uses (`tryReadGatewayUrl`, `env.ts`) — POST `<gatewayOrigin>/mcp`,
 * Streamable HTTP, the seat's own bearer (`session.access_token`, the same
 * WorkOS audience the MCP resource expects, per `apps/play/CLAUDE.md`).
 *
 * Transport precedent: `apps/chat/src/lib/mcp/client.ts` already connects a
 * browser to this exact gateway with `@modelcontextprotocol/sdk`'s `Client` +
 * `StreamableHTTPClientTransport`
 * (the gateway's deployment configuration — play.spellkave.com is already on
 * the gateway's CORS allowlist, alongside the comment "chat.spellkave.com
 * talks to POST /mcp from the browser"). This module mirrors that pairing for
 * one stateless call instead of a persistent tool-listing session.
 *
 * The wire contract (`packages/spellkave-mcp/src/feedback-constants.ts`
 * `FEEDBACK_TOOL_INPUT_SCHEMA`) accepts an optional `client` section
 * alongside `message` / `category` / `include_report` (sk-jay0.5.8):
 * `gatherFeedbackClientSection` below assembles the trail/viewport/layout
 * section plus the RUM run id and sampled flag (sk-jay0.6.38.24), and `submitFeedback` attaches it — as `buildFeedbackClientWirePayload`
 * shapes it onto the wire — on every Play submission. The dialog explains
 * the report before Send, and Play always requests the server-built bundle.
 *
 * `@modelcontextprotocol/sdk` itself (`Client`, `StreamableHTTPClientTransport`)
 * is loaded with a dynamic `import()`, not a static one (sk-jay0.1.15): it
 * added ~82 kB gzip to the main chunk, all of it dead weight for a seat that
 * never opens the dialog. `loadFeedbackSdk` below is the same lazy-module
 * shape `MapTile.svelte` uses for `@spellkave/map-canvas` — a memoised
 * promise so a second caller (Send after a failed attempt) reuses the same
 * in-flight or resolved import instead of re-fetching the chunk.
 */
import type { Client as MpcClient } from "@modelcontextprotocol/sdk/client/index.js";
import type { StreamableHTTPClientTransport as MpcTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TileId } from "./mosaic";
import { type PlayRumDiagnostics, playRumProducer } from "./play-rum";
import type { PlayTrailEntry } from "./play-trail";

/**
 * Mirrors `packages/spellkave-mcp/src/feedback-constants.ts`. Duplicated
 * rather than imported: that package is a Node gateway (`node:crypto`,
 * `@spellkave/session/node`) and importing its index into a browser bundle
 * risks dragging server-only code along with it — the same reason
 * `feedback-constants.ts` keeps zero imports of its own inside that package.
 * Only the three fields the wire contract accepts are duplicated here.
 */
export const SPELLKAVE_FEEDBACK_TOOL = "spellkave_feedback" as const;
export const FEEDBACK_MESSAGE_MAX_BYTES = 4 * 1024;

export type FeedbackCategory = "bug" | "confusing" | "idea";

export const FEEDBACK_CATEGORIES: readonly {
	readonly value: FeedbackCategory;
	readonly label: string;
}[] = [
	{ value: "bug", label: "Bug" },
	{ value: "confusing", label: "Confusing" },
	{ value: "idea", label: "Idea" },
];

/** UTF-8 byte length, matching the server's own cap (`utf8ByteLength` in `feedback.ts`). */
export function feedbackMessageByteLength(message: string): number {
	return new TextEncoder().encode(message).byteLength;
}

// ── The client section ──────────────────────────────────────────────────

export interface FeedbackClientSection {
	readonly trail: readonly PlayTrailEntry[];
	readonly viewport: { readonly width: number; readonly height: number };
	/** Latest known level per tile, derived from the trail's own `layout`
	 * entries — no new state wiring needed in `PlayTable.svelte`, since
	 * `play-trail.ts` already records every settled level change there. */
	readonly layout: Readonly<Partial<Record<TileId, string>>>;
	/** Links the report to this page's hosted RUM rows (`sko11y rum timeline`). */
	readonly rum?: PlayRumDiagnostics;
}

export interface FeedbackClientWindow {
	readonly innerWidth: number;
	readonly innerHeight: number;
	readonly __spellkavePlayTrail?: readonly PlayTrailEntry[];
}

export function gatherFeedbackClientSection(
	windowRef: FeedbackClientWindow = window,
	rum: PlayRumDiagnostics = playRumProducer.diagnostics(),
): FeedbackClientSection {
	const trail = windowRef.__spellkavePlayTrail ?? [];
	const layout: Partial<Record<TileId, string>> = {};
	for (const entry of trail) {
		if (entry.kind === "layout") layout[entry.tile as TileId] = entry.level;
	}
	return {
		trail,
		viewport: { width: windowRef.innerWidth, height: windowRef.innerHeight },
		layout,
		rum,
	};
}

/**
 * The last N trail entries sent, not the full ring buffer (`PLAY_TRAIL_LIMIT`,
 * 100): a courtesy cap well under the gateway's own
 * `FEEDBACK_CLIENT_SECTION_MAX_BYTES` (32 KiB serialised,
 * `packages/spellkave-mcp/src/feedback-constants.ts`) so a normal submission
 * does not routinely brush the server's hard cap and its text-backed
 * `client_section_too_large` error.
 */
export const FEEDBACK_CLIENT_TRAIL_LIMIT = 40;

/** Drops `null`/`undefined` fields from one trail entry: the gateway's
 * `client` schema declares every optional field as a plain `string`/`number`
 * (no `null` variant — keeping the schema to well-supported JSON Schema
 * keywords, `packages/spellkave-mcp/src/feedback-constants.ts`), so a field
 * a given entry kind does not carry (e.g. `act`'s `targetRef: string | null`
 * when nothing was targeted) is omitted rather than sent as an explicit
 * `null`. */
function wireTrailEntry(entry: PlayTrailEntry): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(entry)) {
		if (value === null || value === undefined) continue;
		out[key] = value;
	}
	return out;
}

/** Shapes a gathered `FeedbackClientSection` onto the wire, matching
 * `FEEDBACK_TOOL_INPUT_SCHEMA`'s `client` property exactly. */
export function buildFeedbackClientWirePayload(
	section: FeedbackClientSection,
): Record<string, unknown> {
	return {
		trail: section.trail.slice(-FEEDBACK_CLIENT_TRAIL_LIMIT).map(wireTrailEntry),
		viewport: section.viewport,
		layout: section.layout,
		...(section.rum === undefined
			? {}
			: {
					rum: {
						...(section.rum.runId === undefined ? {} : { run_id: section.rum.runId }),
						sampled: section.rum.sampled,
					},
				}),
	};
}

// ── Submitting ──────────────────────────────────────────────────────────

export interface SubmitFeedbackInput {
	readonly message: string;
	readonly category: FeedbackCategory;
}

export type SubmitFeedbackResult =
	| { readonly ok: true; readonly issueUrl: string }
	| { readonly ok: false; readonly reason: "rate_limited"; readonly message: string }
	| { readonly ok: false; readonly reason: "failed"; readonly message: string };

export type FeedbackToolCaller = (args: Record<string, unknown>) => Promise<CallToolResult>;

export interface SubmitFeedbackOptions {
	readonly gatewayOrigin: string;
	readonly accessToken: string;
	/** Test seam; defaults to a real MCP Streamable HTTP call. */
	readonly callTool?: FeedbackToolCaller;
	/** Test seam / injection point; defaults to gathering from the real window. */
	readonly clientSection?: FeedbackClientSection;
}

function mcpUrlFromGatewayOrigin(gatewayOrigin: string): string {
	return `${gatewayOrigin.replace(/\/+$/, "")}/mcp`;
}

interface FeedbackSdk {
	readonly Client: typeof MpcClient;
	readonly StreamableHTTPClientTransport: typeof MpcTransport;
}

/** Memoised across calls within one page load: `FeedbackDialog`'s first
 * `open` starts this (see the dialog's own `$effect`), and `submitFeedback`
 * awaits the same promise on Send — a second dialog open, or a retried
 * Send, reuses whatever is already in flight or resolved instead of
 * re-fetching the chunk. Module-level `let`, not a `$state`: this module has
 * no reactive framework of its own to opt into, plain memoisation is enough. */
let feedbackSdkPromise: Promise<FeedbackSdk> | null = null;

/** Starts (or returns the already-started) dynamic import of
 * `@modelcontextprotocol/sdk`'s `Client` and `StreamableHTTPClientTransport`
 * — the two exports `callFeedbackTool` needs. Exported so `FeedbackDialog`
 * can kick this off on first open, ahead of Send, the same way
 * `MapTile.svelte` starts `@spellkave/map-canvas`'s import as soon as the
 * map tile reaches its stage level rather than waiting for a click inside
 * it. Calling this is optional: `callFeedbackTool` also calls it itself, so
 * a caller that skips preloading still gets a correct (just later) import. */
export function loadFeedbackSdk(): Promise<FeedbackSdk> {
	feedbackSdkPromise ??= Promise.all([
		import("@modelcontextprotocol/sdk/client/index.js"),
		import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
	])
		.then(([clientModule, transportModule]) => ({
			Client: clientModule.Client,
			StreamableHTTPClientTransport: transportModule.StreamableHTTPClientTransport,
		}))
		.catch((cause) => {
			// A failed fetch of the chunk itself (offline, stale deploy) must not
			// wedge every later attempt behind one cached rejection — clear the
			// memo so the next open or Send starts a fresh import instead of
			// replaying this failure forever.
			feedbackSdkPromise = null;
			throw cause;
		});
	return feedbackSdkPromise;
}

async function callFeedbackTool(
	gatewayOrigin: string,
	accessToken: string,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	const { Client, StreamableHTTPClientTransport } = await loadFeedbackSdk();
	const transport = new StreamableHTTPClientTransport(
		new URL(mcpUrlFromGatewayOrigin(gatewayOrigin)),
		{ requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } },
	);
	const mcp = new Client({ name: "spellkave-play", version: "0.0.0" });
	await mcp.connect(transport);
	try {
		// `Client.callTool`'s return type also covers task-based streaming
		// (`toolResult` instead of `content`) — spellkave_feedback never uses
		// that path, so this is a narrowing cast, not an unchecked one.
		return (await mcp.callTool({
			name: SPELLKAVE_FEEDBACK_TOOL,
			arguments: args,
		})) as CallToolResult;
	} finally {
		await mcp.close();
	}
}

const GENERIC_FAILURE_MESSAGE = "Could not send feedback right now. Try again in a moment.";

interface FeedbackStructuredSuccess {
	readonly ok: true;
	readonly reference: string;
	readonly include_report?: boolean;
}
interface FeedbackStructuredError {
	readonly ok?: false;
	readonly error?: { readonly code?: string; readonly message?: string };
}

function textContentOf(result: CallToolResult): string | undefined {
	const entry = result.content?.find((item) => item.type === "text");
	return entry !== undefined && "text" in entry ? entry.text : undefined;
}

function resultFromCallToolResult(result: CallToolResult): SubmitFeedbackResult {
	const structured = result.structuredContent as
		| FeedbackStructuredSuccess
		| FeedbackStructuredError
		| undefined;
	if (
		result.isError !== true &&
		structured !== undefined &&
		"ok" in structured &&
		structured.ok === true &&
		typeof structured.reference === "string" &&
		structured.reference.trim() !== ""
	) {
		if (structured.include_report !== true) {
			return {
				ok: false,
				reason: "failed",
				message:
					"Feedback was recorded, but its diagnostic report was not confirmed. Please do not resend it.",
			};
		}
		return { ok: true, issueUrl: structured.reference };
	}
	const errorStructured = structured as FeedbackStructuredError | undefined;
	const message =
		errorStructured?.error?.message ?? textContentOf(result) ?? GENERIC_FAILURE_MESSAGE;
	const reason = errorStructured?.error?.code === "rate_limited" ? "rate_limited" : "failed";
	return { ok: false, reason, message };
}

/**
 * Every Play submission includes client diagnostics and requests the standard
 * server report. Gathering must succeed before anything is submitted.
 */
export async function submitFeedback(
	input: SubmitFeedbackInput,
	options: SubmitFeedbackOptions,
): Promise<SubmitFeedbackResult> {
	let client: Record<string, unknown>;
	try {
		client = buildFeedbackClientWirePayload(options.clientSection ?? gatherFeedbackClientSection());
	} catch {
		return {
			ok: false,
			reason: "failed",
			message:
				"Could not prepare the diagnostic report. Feedback was not sent. Try again in a moment.",
		};
	}
	const call =
		options.callTool ??
		((args: Record<string, unknown>) =>
			callFeedbackTool(options.gatewayOrigin, options.accessToken, args));
	try {
		const args: Record<string, unknown> = {
			message: input.message,
			category: input.category,
			include_report: true,
			client,
		};
		const result = await call(args);
		return resultFromCallToolResult(result);
	} catch {
		return { ok: false, reason: "failed", message: GENERIC_FAILURE_MESSAGE };
	}
}

/** `true` for an absolute http(s) URL — guards against rendering a non-URL
 * `reference` (e.g. the in-memory dev sink's `local-feedback-1`) as a link. */
export function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
