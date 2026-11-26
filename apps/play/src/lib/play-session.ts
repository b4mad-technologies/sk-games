/**
 * The Play page's one seam to the world: `openSession` from `@spellkave/session`
 * (the same connect + actor-resolve + factual-context bootstrap the Pi
 * extension and the session daemon use), the PLAYER tool registry bound over
 * that session (the same `createPlayerFacingTools` the MCP gateway serves),
 * and `session.worldEvents` (the same fan-out cursor every host drains).
 *
 * Nothing on the page reads a table. Every fact in `PlayView` is the answer
 * of a `spellkave_*` tool, so a fix in a tool reaches Play, MCP and Pi alike.
 */

import {
	CACHE_APPLIED_MARKER,
	type ContextGenerationInput,
	checkDraft,
	composeFactoredManipulationAttempt,
	createAttempt,
	createRejectionLedger,
	defaultReaderManifest,
	type IntentDraft,
	type IntentInputValues,
	type ManipulationContext,
	nextContextGeneration,
	type Outcome,
	observationEpoch,
	readWatchOwnBodies,
	readWatchTick,
	snapshotDb,
	WATCH_BUFFER_REQUIRED_TABLES,
	WatchBuffer,
	watchOverlayAdmitted,
} from "@spellkave/sdk";
import { openSession, PLAY_CONNECT_PHASE_TIMEOUT_MS, type SessionPhase } from "@spellkave/session";
import {
	SPELLKAVE_COMMUNICATE_TOOL,
	SPELLKAVE_END_TURN_TOOL,
	SPELLKAVE_INTERVENTION_WINDOWS_TOOL,
	SPELLKAVE_INVENTORY_TOOL,
	SPELLKAVE_ITEM_DETAIL_TOOL,
	SPELLKAVE_MANIPULATE_TOOL,
	SPELLKAVE_MANIPULATION_CONTEXT_TOOL,
	SPELLKAVE_MAP_TOOL,
	SPELLKAVE_MOVE_TOOL,
	SPELLKAVE_REACT_OPTION_TOOL,
	SPELLKAVE_REACTION_OPTIONS_TOOL,
	SPELLKAVE_SCENE_DETAIL_TOOL,
	SPELLKAVE_SCENE_TOOL,
	SPELLKAVE_SELF_STATES_TOOL,
	SPELLKAVE_SELF_SUMMARY_TOOL,
	SPELLKAVE_SENSE_CONTEXT_TOOL,
	SPELLKAVE_SENSE_TOOL,
	SPELLKAVE_SESSION_STATUS_TOOL,
	SPELLKAVE_TRACE_DETAIL_TOOL,
	SPELLKAVE_TRACES_TOOL,
	type ToolRole,
} from "@spellkave/tool-contracts";
import { describeRefusal } from "@spellkave/tool-player";
import {
	classifyActResult,
	type DomainDeltaNote,
	renderActResultLine,
	type WorldDeltas,
	type WorldEvent,
} from "@spellkave/tool-runtime";
import { type BrowserRoleToolSet, createLiveBrowserRoleTools } from "./browser-role-tools";
import { createShapeDiagnosticSink } from "./contract-shape";
import { occupancyFromWatch, type PlayMapWatch, placesFromWatch } from "./map-watch";
import {
	appendPlayChronicle,
	type ChronicleNameContext,
	ingestFanoutForChronicle,
	PLAY_CHRONICLE_LIMIT,
	type PlayChronicleEntry,
} from "./play-chronicle";
import { playObservation } from "./play-observation";
import {
	createOperationClockObserver,
	operationReferenceFromResult,
	operationsFromPayload,
} from "./play-operations";
import { playRumProducer } from "./play-rum";
import { hasTacticalSession } from "./play-table";
import { playTrail } from "./play-trail";
import {
	actionsForDisclosedEntity,
	actionsForParticipatingEntity,
	actionsFromManipulationContext,
	actionsFromSenseContext,
	capabilityChipsFromPayload,
	economyBudgetFromPayload,
	economyFromPayload,
	heroFromSelfSummary,
	hideDraftVitals,
	humaniseNodeId,
	itemDetailFromPayload,
	manipulationContextFromPayload,
	mapSvgFromPayload,
	mergeSpeech,
	occupantDetailFromPayload,
	type PlayAction,
	type PlayExit,
	type PlayItemDetail,
	type PlayManipulationContext,
	type PlayOccupantDetail,
	type PlayPackItem,
	type PlaySessionToken,
	type PlaySpeech,
	type PlayView,
	packFromPayload,
	reactionFromPayloads,
	sceneFromPayload,
	selfStateFacetsFromPayload,
	senseContextFromPayload,
	sessionFromPayload,
	sessionTokensFromPayload,
	speechFromEventsRemembering,
	speechFromTraceDetail,
	toolDetails,
	traceRefsFromListing,
} from "./play-view";
import { playCopy } from "./player-copy";

/** Convert Play's camel-cased view facts back to the shared SDK transport
 * shape. This is a lossless boundary adapter, not a new eligibility model. */
function manipulationContextForAttempt(view: PlayView | null): ManipulationContext {
	const context = view?.manipulationContext;
	if (context?.status !== "ready") return { status: "unavailable" };
	return {
		status: "ready",
		schema_version: context.schemaVersion,
		revision: context.revision,
		actions: context.actions.map((action) => ({
			action_id: action.actionId,
			display_name: action.displayName,
			tags: [...action.tags],
			niche_requirements: action.nicheRequirements ?? [],
			template_ids: action.templateIds ?? [],
			groups: action.groups ?? [],
			self_only: action.selfOnly,
			self_eligible: action.selfEligible,
		})),
		targets: context.targets.map((target) => ({
			target_fact_id: target.targetFactId,
			target_ref: target.targetRef,
			tags: [...target.tags],
			niche_ids: target.nicheIds ?? [],
		})),
		participants: context.participants.map((participant) => ({
			context_id: participant.contextId,
			action_id: participant.actionId,
			binding_count: participant.bindingCount,
			bindings: participant.bindings.map((binding) => ({
				role_id: binding.roleId,
				entity_id: binding.entityId,
			})),
		})),
		prompts: (context.prompts ?? []).map((prompt) => ({
			occurrence_id: prompt.occurrenceId,
			prompt_def_id: prompt.promptDefId,
			contract_version: prompt.contractVersion,
			source_ref: prompt.sourceRef,
			response_action_ids: [...prompt.responseActionIds],
			opened_at_tick: prompt.openedAtTick,
			consumed: prompt.consumed,
			...(prompt.presentation === undefined
				? {}
				: {
						presentation: {
							...(prompt.presentation.question === undefined
								? {}
								: { question: prompt.presentation.question }),
							labels: { ...prompt.presentation.labels },
							...(prompt.presentation.responseRefs === undefined
								? {}
								: { response_refs: { ...prompt.presentation.responseRefs } }),
							...(prompt.presentation.guide === undefined
								? {}
								: { guide: prompt.presentation.guide }),
						},
					}),
		})),
	};
}

/** Select local candidates using disclosed target or participant identity. */
function participantContextForSelection(
	context: PlayManipulationContext | undefined,
	actionId: string,
	entityId: string | undefined,
): string | undefined {
	if (context?.status !== "ready" || actionId === "") return undefined;
	const forAction = context.participants.filter((participant) => participant.actionId === actionId);
	if (entityId !== undefined) {
		const matching = forAction.filter((participant) =>
			participant.bindings.some((binding) => binding.entityId === entityId),
		);
		if (matching[0] !== undefined) return matching[0].contextId;
	}
	return forAction.length === 1 ? forAction[0]?.contextId : undefined;
}

/** Preserve authored form values as the shared draft's explicit structured
 * input. Legacy callers that only have text may still supply a scalar JSON
 * object; arbitrary nested JSON is not assigned local semantics. */
function inputValuesFromText(
	text: string,
	supplied: IntentInputValues | undefined,
): IntentInputValues | undefined {
	if (supplied !== undefined) return supplied;
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const values: Record<string, string | number | boolean> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
				return undefined;
			values[key] = value;
		}
		return values;
	} catch {
		return undefined;
	}
}

/**
 * Play stopped an attempt before sending it (a local draft check, the
 * composer's own check, or repeat suppression). Nothing reached the world, so
 * the caller must show "not sent", never "result unknown". The message is a
 * player sentence from `player-copy.ts`.
 */
export class PlayAttemptBlockedError extends Error {
	override readonly name = "PlayAttemptBlockedError";
}

/** Name check instead of `instanceof`, so a test double or a second module
 * instance still reads as blocked. */
export function isPlayAttemptBlocked(cause: unknown): cause is PlayAttemptBlockedError {
	return cause instanceof Error && cause.name === "PlayAttemptBlockedError";
}

function draftErrorMessage(
	check: ReturnType<typeof checkDraft>,
	input: PlayAction["input"],
): string {
	if (check.status === "complete") return "";
	if (check.missing.includes("required_input")) {
		const missing = check.missing_fields ?? [];
		const label =
			missing.length === 1
				? input?.fields.find((field) => field.name === missing[0])?.label.trim()
				: undefined;
		return label === undefined || label === ""
			? playCopy.session.requiredFields
			: playCopy.session.requiredField(label);
	}
	if (check.missing.length > 0) return playCopy.session.actionAndTarget;
	return playCopy.session.malformedInput;
}

function composerErrorMessage(
	result: Exclude<
		ReturnType<typeof composeFactoredManipulationAttempt>,
		{ status: "not_assessed" }
	>,
): string {
	switch (result.status) {
		case "context_unavailable":
			return playCopy.session.loading;
		case "unknown_action":
			return playCopy.session.unknownAction;
		case "invalid_target_ref":
			return playCopy.session.invalidTarget;
		case "undisclosed_target":
			return playCopy.session.targetGone;
		case "malformed_args":
			return playCopy.session.malformedInput;
		case "participant_context_conflict":
			return playCopy.session.participantConflict;
		case "unknown_participant_context":
			return playCopy.session.participantGone;
		case "participant_context_required":
			return playCopy.session.participantRequired;
	}
}

function actionsForEntity(
	actions: readonly PlayAction[],
	context: PlayManipulationContext | undefined,
	entityId: string,
): PlayAction[] {
	const fromContext = context === undefined ? [] : actionsForDisclosedEntity(context, entityId);
	const fromParticipants =
		context === undefined ? [] : actionsForParticipatingEntity(context, entityId);
	const joined = [...fromContext, ...fromParticipants];
	const seen = new Set(joined.map((action) => action.id));
	const participatingActions = new Set(fromParticipants.map((action) => action.actionId));
	const fromPalette = actions.filter(
		(action) =>
			action.targetRef === `item:${entityId}` ||
			action.targetRef === `entity:${entityId}` ||
			participatingActions.has(action.actionId ?? action.descriptor),
	);
	return [...joined, ...fromPalette.filter((action) => !seen.has(action.id))];
}

/** What `selectItem` needs from a `PlayPackItem` — copy it from the pack row
 * the player clicked. */
export type SelectedPackItem = Pick<PlayPackItem, "id" | "handle" | "rev" | "name">;

export interface PlaySessionHandle {
	readonly roleTools: BrowserRoleToolSet;
	/** Walk through an exit of the current scene (`spellkave_move`, scene-handle mode). */
	move(exit: PlayExit, interaction?: number): Promise<string>;
	/** Submit a direct manipulate, communicate or sense attempt from a local candidate. */
	act(
		action: PlayAction,
		utterance?: string,
		interaction?: number,
		inputValues?: IntentInputValues,
	): Promise<string>;
	/** `spellkave_end_turn`. */
	endTurn(interaction?: number): Promise<string>;
	/** Answer an open reaction or intervention window (`spellkave_react_option`). */
	react(handle: string, rev: string, responseIntent: string, interaction?: number): Promise<string>;
	/**
	 * Select (or, with `null`, deselect) a Pack item for the on-demand
	 * `spellkave_item_detail` read, joined to current factual candidates — runs
	 * once per selection, not on every view refresh. `item` is copied from
	 * the pack's own `PlayPackItem` (`id`/`handle`/`rev`/`name`).
	 */
	selectItem(item: { id: string; handle: string; rev: string; name: string } | null): Promise<void>;
	/**
	 * Select (or, with `null`, deselect) a Place occupant for the on-demand
	 * `spellkave_scene_detail` read, joined to current factual candidates.
	 * Selection itself is not a gameplay action.
	 */
	selectOccupant?(occupant: PlayOccupantSelection | null): Promise<void>;
	/** Read an already supplied activity reference or its next authorized page. */
	selectOperation?(id: string | null, cursor?: string): Promise<void>;
	/** Re-read the view now (the page also re-reads on every cache update). */
	refresh(): Promise<void>;
	disconnect(): void;
}

/** A room listing supplies a revision; disclosed children use their canonical item ref. */
export type PlayOccupantSelection =
	| { id: string; handle: string; rev: string; name: string }
	| { id: string; targetRef: string; name: string };

export interface OpenPlaySessionArgs {
	url: string;
	db: string;
	token: string;
	actorId: string;
	authorizedToolRoles: readonly ToolRole[];
	/**
	 * How the place map is projected when the hero's graph has several
	 * floors. Absent (Play): the tool draws the hero's own floor (`z`).
	 * `all_floors_offset` draws every floor side by side, so a client that
	 * routes over the picture (apps/classic) sees stairs and the floors they
	 * join. Never applied to a tactical session's grid.
	 */
	mapSlice?: "all_floors_offset";
	onView(view: PlayView): void;
	onError(error: Error): void;
	/**
	 * An already-open socket dropped (sk-jay0.1.24). When supplied, a drop is
	 * reported here INSTEAD of `onError`, so the caller can reconnect with its
	 * current access token; omitted, a drop stays an `onError` as before.
	 */
	onDisconnect?(error: Error): void;
	/** MapLibre stage occupancy/radar (WatchBuffer). Omit in tests that do not mount the map. */
	onWatch?(state: PlayMapWatch | null): void;
	/**
	 * The live `world_time` tick (sk-jay0.1.1.14), for the seal cluster's
	 * always-live readout — NOT `latestTick()` below, which is a client
	 * artifact over `view.events`/`view.speech` and stays 0 for a quiet actor
	 * however far the world has actually ticked (#3487's root cause). Fires
	 * once right after connect and again on every `world_time` cache mutation
	 * — a cheap synchronous read off the already-subscribed live cache
	 * (`world_time` is in `CONNECTION_BASELINE`, so every session subscribes
	 * it regardless of `readerManifests`; see `packages/spellkave-sdk/src/
	 * reader-manifest.ts`), never a new `readView()` call. Omit in tests that
	 * do not render the readout.
	 */
	onWorldTick?(tick: number): void;
	/**
	 * Forwarded verbatim to `openSession`'s `OpenSessionDeps.onPhase`
	 * (sk-jay0.6.38.25): fires once per completed connect phase, in order
	 * `ready` -> `setup`? -> `resolve_actor` -> `factual_context`. The caller
	 * uses the last one to mark a successful connect for RUM without adding a
	 * console log per phase itself.
	 */
	onPhase?(phase: SessionPhase, elapsedMs: number): void;
	/** Test seam: replaces the wall clock used for debouncing. */
	debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 120;
// A response can commit before its successor prompt occurrence is materialised
// on the next frame. This matches tool-player's documented bounded wait and
// stays below the local/host reply window cap.
const SUCCESSOR_PROMPT_WAIT_MS = 5_000;
const SPEECH_TRACE_KIND = "srd/speech";
const SPEECH_BACKFILL_LIMIT = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Which of `view.events`/`view.speech` — both already tick-stamped —
 * carries the freshest world tick this client currently knows about. Used
 * to stamp every trail entry (`play-trail.ts`) with a real world tick rather
 * than a client-side guess; `0` before anything tick-carrying has arrived. */
export function latestTick(view: Pick<PlayView, "events" | "speech">): number {
	let max = 0;
	for (const event of view.events) if (event.tick > max) max = event.tick;
	for (const line of view.speech) if (line.tick > max) max = line.tick;
	return max;
}

/** `world_deltas` piggybacked on a dispatched tool receipt (ADR-0083 Stage 2,
 * `@spellkave/tool-runtime`'s `appendWorldDeltas`), when the host attributed
 * this call's own consequences to it. */
function worldDeltasFrom(result: unknown): WorldDeltas | null {
	const details = toolDetails(result);
	return isRecord(details) && isRecord(details.world_deltas)
		? (details.world_deltas as WorldDeltas)
		: null;
}

/** `srd/state/level` → `Level`; a raw self-state id is never player prose. */
function selfStateLabel(stateId: string): string {
	return humaniseNodeId(stateId);
}

function summarizeSelfDeltas(entries: WorldDeltas["self"]): string | null {
	if (entries === undefined || entries.length === 0) return null;
	return entries
		.slice(0, 3)
		.map((entry) => {
			const label = selfStateLabel(entry.state_id);
			return entry.prev === null
				? `${label} is now ${entry.value}.`
				: `${label}: ${entry.prev} → ${entry.value}.`;
		})
		.join(" ");
}

function summarizeDomainDeltas(
	note: DomainDeltaNote | undefined,
	verb: "carry" | "here",
): string | null {
	if (note === undefined) return null;
	const sentences: string[] = [];
	if (note.added.length > 0) {
		sentences.push(
			verb === "carry"
				? `You now carry ${note.added.join(", ")}.`
				: `${note.added.join(", ")} ${note.added.length === 1 ? "arrives" : "arrive"}.`,
		);
	}
	if (note.removed.length > 0) {
		sentences.push(
			verb === "carry"
				? `You no longer carry ${note.removed.join(", ")}.`
				: `${note.removed.join(", ")} ${note.removed.length === 1 ? "leaves" : "leave"}.`,
		);
	}
	return sentences.length > 0 ? sentences.join(" ") : null;
}

/**
 * A quiet act (accepted, no observation, no reply) is not necessarily a
 * no-op: kit picks, `confirm`, `adopt-name` and similar character-creation
 * steps change the actor's own state or inventory with no authored
 * observation line of their own (sk-jay0.1.7 item 1 — "successful acts
 * print 'Nothing you notice changes.'' though kit pick/confirm/adopt-name
 * all took effect"). Read the piggybacked `world_deltas` (self state first,
 * then what changed hands, then who came/went) before falling back to the
 * genuinely-quiet line. Self first: a confirm/adopt-name step is a self-state
 * write with no inventory or scene effect at all.
 */
function summarizeWorldDeltas(deltas: WorldDeltas): string | null {
	return (
		summarizeSelfDeltas(deltas.self) ??
		summarizeDomainDeltas(deltas.inventory, "carry") ??
		summarizeDomainDeltas(deltas.scene, "here")
	);
}

export function messageForAct(result: unknown): string {
	const classified = classifyActResult(result);
	if (classified.kind !== "quiet") return renderActResultLine(classified);
	const deltas = worldDeltasFrom(result);
	return (deltas === null ? null : summarizeWorldDeltas(deltas)) ?? renderActResultLine(classified);
}

/** `receipt.move.to_node`, the same slimmed movement receipt
 * `dispatchMovementByEdge` (`@spellkave/tool-player`) attaches — the one
 * place a destination id survives when there is no authored arrival prose. */
function moveReceipt(result: unknown): Record<string, unknown> | null {
	const details = toolDetails(result);
	const receipt = isRecord(details) ? details.receipt : undefined;
	return isRecord(receipt) && isRecord(receipt.move) ? receipt.move : null;
}

function moveDestination(result: unknown): string {
	const move = moveReceipt(result);
	const toNode = move !== null && typeof move.to_node === "string" ? move.to_node : "";
	return toNode === "" ? "" : humaniseNodeId(toNode);
}

/** `classifyActResult`'s rejection reader only inspects a dispatched
 * receipt's `manipulate`/`communicate`/`sense` nested verb result
 * (`VERB_KEYS`, `@spellkave/world-events`'s `act-result.ts`) — movement's own
 * nested key is `move`, so a REJECTED move's specific reason (the kernel's
 * `r_move`, `packages/spellkave-sdk/src/core/reducers/r_move.ts`, attaches it
 * at `failure_detail`/`reason` on that nested object) never reaches
 * `renderActResultLine`, which falls back to a generic "The world refused."
 * Read the move-shaped reason directly instead. */
function moveRejectionMessage(result: unknown): string | null {
	const move = moveReceipt(result);
	if (move === null) return null;
	const failureDetail = typeof move.failure_detail === "string" ? move.failure_detail.trim() : "";
	const playerMessage = typeof move.player_message === "string" ? move.player_message.trim() : "";
	if (failureDetail !== "") {
		// A movement refusal can carry its machine-readable reason in JSON
		// (`channel=...;{ reason: "action_budget_exhausted" }`). Keep authored
		// human prose verbatim, but never send the envelope itself to the Table
		// stream.
		try {
			const jsonStart = failureDetail.indexOf("{");
			const detail: unknown = JSON.parse(
				jsonStart === -1 ? failureDetail : failureDetail.slice(jsonStart),
			);
			if (
				detail !== null &&
				typeof detail === "object" &&
				"reason" in detail &&
				typeof (detail as { reason: unknown }).reason === "string" &&
				(detail as { reason: string }).reason !== ""
			) {
				const reason = (detail as { reason: string }).reason;
				const channel = (detail as { channel?: unknown }).channel;
				if (reason === "action_budget_exhausted" && channel === "srd/economy_channel/movement")
					return "You have no movement left.";
				return describeRefusal(reason);
			}
		} catch {
			// An authored refusal is plain prose, not JSON.
		}
		// Some older movement receipts put the bare engine code here. Codes use
		// snake_case; authored sentences do not.
		if (/^[a-z][a-z0-9_]*$/.test(failureDetail)) return describeRefusal(failureDetail);
		// A failed gate reports its evaluation trail
		// (`affordance_template=...;predicate_value=false`): `key=value` pairs
		// for debugging, never a sentence. Show the receipt's own sentence
		// instead; the trail stays reachable through `moveRefusal`.
		if (/^[a-z_]+=\S/.test(failureDetail)) {
			return playerMessage !== "" ? playerMessage : describeRefusal("predicate_rejected");
		}
		return failureDetail;
	}
	if (playerMessage !== "") return playerMessage;
	const reason = typeof move.reason === "string" ? move.reason.trim() : "";
	return reason === "" ? null : reason;
}

/**
 * `spellkave_move` answers with the SAME dispatched-receipt envelope an act
 * does (`receipt.outcome`, `observation`/`observation_gap`) — read it the
 * same way instead of guessing at fields the tool never sends
 * (`details.status`/`details.receipt.to_node` do not exist on the real
 * payload; sk-jay0.1.7 item 1, "a successful move prints 'The world did not
 * accept that move.'"). A refusal names the world's own reason; a crossed
 * graph boundary or a promoted long walk carries authored prose
 * (`describeArrival`/`describeDeparture`); an in-graph arrival with no prose
 * of its own still names the destination rather than falling through to
 * `renderActResultLine`'s generic "Nothing you notice changes."
 */
export function messageForMove(result: unknown): string {
	const classified = classifyActResult(result);
	if (classified.kind === "rejected") {
		return moveRejectionMessage(result) ?? renderActResultLine(classified);
	}
	if (classified.kind === "happened" && classified.observation !== null) {
		return classified.observation;
	}
	const destination = moveDestination(result);
	if (destination !== "") return `You arrive at ${destination}.`;
	return classified.kind === "happened"
		? renderActResultLine(classified)
		: "The world did not answer that move.";
}

/** `classifyActResult`'s rejected `reason` reads `verb.reason` for a
 * dispatched rejection — the SDK's own wrapper text ("r_manipulate rejected
 * by server") or, for a pre-dispatch refusal (`unknown_handle` and
 * siblings), the tool's own `reason`. Either way it is the world's raw code,
 * never `player_message`'s already-rendered prose — sk-j8e.4 wants exactly
 * this alongside `failure_detail`, read the same nested-then-top-level way
 * `moveRejectionMessage` already reads a move's. */
function nestedVerbFailureDetail(result: unknown): string | undefined {
	const details = toolDetails(result);
	if (!isRecord(details) || !isRecord(details.receipt)) return undefined;
	const receipt = details.receipt;
	for (const key of ["manipulate", "communicate", "sense"] as const) {
		const verb = receipt[key];
		if (
			isRecord(verb) &&
			typeof verb.failure_detail === "string" &&
			verb.failure_detail.trim() !== ""
		) {
			return verb.failure_detail.trim();
		}
	}
	return undefined;
}

/** The raw refusal code + `failure_detail` behind an act/react's rendered
 * prose (`messageForAct`), for the ⓘ hover on its stream/notice line. `null`
 * on anything that is not a rejection — a quiet/happened/undescribable act
 * has no refusal to show. */
export function actRefusal(result: unknown): { code: string; detail?: string } | undefined {
	const classified = classifyActResult(result);
	if (classified.kind !== "rejected" || classified.reason === null) return undefined;
	const detail = nestedVerbFailureDetail(result);
	return detail === undefined ? { code: classified.reason } : { code: classified.reason, detail };
}

/** `moveRefusal`'s sibling of `moveRejectionMessage` above: the same
 * `receipt.move.reason`/`failure_detail` pair, kept apart instead of already
 * folded into one sentence, plus the pre-dispatch fallback
 * `classifyActResult` itself already reads (`unknown_handle` and similar). */
export function moveRefusal(result: unknown): { code: string; detail?: string } | undefined {
	const classified = classifyActResult(result);
	if (classified.kind !== "rejected") return undefined;
	const move = moveReceipt(result);
	const moveReason = move !== null && typeof move.reason === "string" ? move.reason.trim() : "";
	const failureDetail =
		move !== null && typeof move.failure_detail === "string" ? move.failure_detail.trim() : "";
	const code = moveReason !== "" ? moveReason : (classified.reason ?? "move_rejected");
	return failureDetail === "" ? { code } : { code, detail: failureDetail };
}

export async function openPlaySession(args: OpenPlaySessionArgs): Promise<PlaySessionHandle> {
	let closed = false;
	let connected = true;
	let view: PlayView | null = null;
	const rejectionLedger = createRejectionLedger();
	let rejectionFactsRevision = 0;
	let previousRejectionFacts: string | undefined;
	let lastRefusedLine: { key: string; text: string } | null = null;
	let contextGeneration = 0;
	let previousContext: (ContextGenerationInput & { generation: number }) | undefined;
	const publishView = (nextView: PlayView): void => {
		if (closed || !connected) return;
		// Async map and item reads must compose the latest published state.
		view = nextView;
		args.onView(nextView);
	};
	let scheduled: ReturnType<typeof setTimeout> | undefined;
	let operationPoll: ReturnType<typeof setInterval> | undefined;
	const observeOperationClock = createOperationClockObserver();
	let operationId: string | undefined;
	let operationCursor: string | undefined;
	let operationGeneration = 0;
	let lastViewReadAt = 0;
	let refreshing = false;
	let refreshQueued = false;
	let listeners: (() => void) | undefined;

	// The binding's identity is a label for the session record, never a
	// credential. The Pi extension hashes its token here; a browser page on a
	// plain-HTTP dev origin has no `crypto.subtle`, and the world binds the
	// identity from the token on connect anyway, so a fixed label is honest.
	let live: Awaited<ReturnType<typeof openSession>>;
	try {
		live = await openSession(
			{
				url: args.url.replace(/\/+$/, ""),
				db: args.db,
				identity: "browser",
				actorId: args.actorId,
			},
			{
				token: args.token,
				// `buildSubscribeSet` (`packages/spellkave-sdk/src/connection.ts`)
				// treats ANY supplied `readerManifests` as a total REPLACEMENT of
				// its own default reader-scoped union, never an addition to it —
				// passing only `WATCH_BUFFER_REQUIRED_TABLES` here (as this line
				// once did) silently narrowed Play's whole subscription to just
				// those tables plus `CONNECTION_BASELINE`, dropping
				// `visible_place_node`/`visible_place_edge`/`place_edge_affordance`
				// and everything else `readCurrentScene` (`@spellkave/sdk`'s
				// `scene.ts`) needs — the actual root cause of #3487's permanently
				// empty scene for every actor, not a "quiet actor" artifact.
				// `defaultReaderManifest()` restores the same union every OTHER
				// `openSession` caller gets by passing no `readerManifests` at all;
				// the watch buffer's own tables (map/DM radar) are added on top,
				// exactly as `WATCH_BUFFER_REQUIRED_TABLES`'s own doc comment says
				// ("in addition to seat catalogs").
				readerManifests: [
					{
						requiredTables: [
							...defaultReaderManifest().requiredTables,
							...WATCH_BUFFER_REQUIRED_TABLES,
						],
					},
				],
				// Play opts into a bound `ready`/`factual_context` wait
				// (sk-jay0.6.38.25); every other `openSession` caller keeps the
				// package default of unbounded, opt-in-only timeouts (#3477
				// RUM-lane review — see `PLAY_CONNECT_PHASE_TIMEOUT_MS`'s own doc).
				readyTimeoutMs: PLAY_CONNECT_PHASE_TIMEOUT_MS,
				factualContextTimeoutMs: PLAY_CONNECT_PHASE_TIMEOUT_MS,
				onPhase: args.onPhase,
				// Shape-check "warn" mismatches reach RUM (sk-jay0.7.389.3).
				onDiagnostic: createShapeDiagnosticSink(playRumProducer),
				onError: (error) => {
					if (!closed) args.onError(error);
				},
				onDisconnect: (error) => {
					connected = false;
					if (!closed) {
						playObservation.record({ phase: "connection", interaction: 0, state: "disconnected" });
						const dropped =
							error ?? new Error("The connection to this world closed. Reconnect to continue.");
						if (args.onDisconnect) args.onDisconnect(dropped);
						else args.onError(dropped);
					}
				},
			},
		);
	} catch (cause) {
		// `openSession` never reached a live handle — nothing to close (it
		// closes its own connection on failure), but the caller's `onError`
		// otherwise never learns why: this promise's rejection alone gives
		// RUM/App.svelte no way to record a terminal `play_connection` state
		// (sk-jay0.6.38.25 / #3464's silent stall between "loading" and
		// nothing).
		const error = cause instanceof Error ? cause : new Error(String(cause));
		// `deps.onError` above may already have reported this same failure
		// (e.g. a phase error that also rejects); guard like every other
		// `args.onError` call site in this file so the UI error is not set
		// twice (nit, #3477 RUM-lane review).
		if (!closed) args.onError(error);
		throw error;
	}

	try {
		let stopWatch = (): void => {};
		const worldEvents = live.session.worldEvents;
		try {
			worldEvents.diffAndAdvance();
		} catch {
			// Courtesy channel: a snapshot race at join must not refuse the seat.
		}
		const watch = new WatchBuffer();
		const publishWatch = (): void => {
			if (closed || args.onWatch === undefined) return;
			try {
				const snap = snapshotDb(live.session);
				const overlay = watchOverlayAdmitted(snap, readWatchOwnBodies(snap));
				if (!overlay) {
					args.onWatch(null);
					return;
				}
				const frame = watch.frameAtCursor();
				const actors = frame?.actors ?? [];
				const mineEntityIds = [live.actorId];
				const oldestTick = watch.oldestTick() ?? 0;
				const latestTick = watch.latestTick() ?? 0;
				const cursor = watch.cursor();
				const liveCursor = cursor.kind !== "paused";
				const cursorTick = cursor.kind === "paused" ? cursor.tick : latestTick;
				args.onWatch({
					overlay: true,
					places: placesFromWatch(actors, mineEntityIds),
					mineEntityIds,
					occupancy: occupancyFromWatch(actors, mineEntityIds),
					actors,
					events: frame?.events ?? [],
					oldestTick,
					latestTick,
					cursorTick,
					live: liveCursor,
					pause: () => {
						watch.pause();
						publishWatch();
					},
					play: () => {
						watch.play();
						publishWatch();
					},
					scrub: (tick) => {
						watch.scrub(tick);
						publishWatch();
					},
				});
			} catch {
				args.onWatch(null);
			}
		};
		try {
			const snap = snapshotDb(live.session);
			watch.bootstrap(snap, readWatchTick(snap));
		} catch {
			// Leave the watch empty until an admitted cache arrives.
			// Missing coverage supplies no tag membership or synthetic frame.
		}
		publishWatch();
		stopWatch = live.onUpdate(() => {
			try {
				const snap = snapshotDb(live.session);
				watch.observe(snap, readWatchTick(snap));
			} catch {
				// First apply can be empty.
			}
			publishWatch();
		});

		// The seal cluster's live world-tick readout (sk-jay0.1.1.14): a
		// dedicated, cheap `onUpdate` listener rather than piggybacking on
		// `schedule()`/`readView()` below — `live.session.currentWorldTick()` is
		// a synchronous read off the already-subscribed cache
		// (`SpellkaveSession.currentWorldTick`, `packages/spellkave-sdk/src/
		// connection.ts`), so this never triggers the multi-tool `readView`
		// refresh cycle just to keep a number in the corner honest. Filtered to
		// `world_time` mutations (plus the initial `CACHE_APPLIED_MARKER` apply)
		// rather than firing on every subscribed-table update like `schedule()`
		// does — world_time is the only table this readout cares about.
		let stopTick = (): void => {};
		const publishWorldTick = (): void => {
			if (closed || args.onWorldTick === undefined) return;
			try {
				args.onWorldTick(Number(live.session.currentWorldTick()));
			} catch {
				// Never let a display-only value break the page.
			}
		};
		publishWorldTick();
		stopTick = live.onUpdate((table) => {
			if (table === "world_time" || table === CACHE_APPLIED_MARKER) publishWorldTick();
		});

		const roleTools = await createLiveBrowserRoleTools({
			live,
			authorizedRoles: args.authorizedToolRoles,
		});

		const execute = async (name: string, params: Record<string, unknown>): Promise<unknown> => {
			const tool = roleTools.byName.get(name);
			if (tool === undefined) return null;
			try {
				return toolDetails(await tool.execute("play", params));
			} catch (cause) {
				playTrail.recordToolError({
					tool: name,
					message: cause instanceof Error ? cause.message : String(cause),
					tick: view === null ? 0 : latestTick(view),
				});
				return null;
			}
		};

		let chronicle: PlayChronicleEntry[] = [];
		let chronicleSeq = 0;
		/** Hero-only sessions still open (a long walk, sk-jay0.1.8.96 s4):
		 * remembered from their `opened` row so the chronicle can also drop
		 * their turn and `closed` rows (`appendPlayChronicle`). */
		let heroOnlySessions: ReadonlySet<string> = new Set();
		/** The session already running at the first read gets no `opened` row:
		 * the event builder primes on it (a reconnect or reload mid-walk). It is
		 * remembered once, from that first read's roster, and never later: a
		 * shared scene whose roster shrinks to the hero must keep its lines. */
		let runningSessionSeeded = false;
		/** Drained, not yet ingested: held until `readView` knows the names of
		 * the moment (`ingestChronicle`). Survives a `readView` that returns
		 * early, so no event is lost — the next one ingests it. */
		let pendingChronicleEvents: WorldEvent[] = [];
		/**
		 * The one world-ordered speech stream (sk-jay0.1.8.12, operator decision
		 * D1): every line — the world's and the player's own alike — arrives
		 * here only once the world has recorded it, from a `speech_heard` event
		 * or the trace backfill below, merged and deduped by trace id
		 * (`mergeSpeech`). No optimistic client line is ever appended.
		 */
		let speech: PlaySpeech[] = [];
		/**
		 * Speaker id to the name the world last gave for it in a `speech_heard`
		 * event of this visit (sk-jay0.1.8.96 s8). The world names a speaker
		 * only while the hero perceives them; a later line that arrives unnamed
		 * keeps this name instead of "Someone" (`speechFromEventsRemembering`,
		 * one pass in event order: a name is only ever applied to a later
		 * line). Speakers only, resolved here at ingest, gone on reconnect.
		 */
		const speakerNames = new Map<string, string>();
		/** Trace ids already on the dialogue, from events or from the backfill. */
		const spokenTraceIds = new Set<string>();
		let toolClaimsInFlight = 0;
		let mapSvg: string | null = null;
		let mapState: PlayView["mapState"] = "loading";
		let mapKey = "";
		/** Graph and mode of the last map request (`refreshMap`). */
		let mapScope = "";
		let mapRequest = 0;
		/** Parsed from the SAME `spellkave_map` payload as `mapSvg`/`mapState`,
		 * never out of step with them (`refreshMap` below). `[]` while loading
		 * or failed, matching `sessionTokensFromPayload`'s own absent/empty
		 * collapse. */
		let sessionTokens: PlaySessionToken[] = [];
		/** The Pack stage's on-demand selection (`spellkave_item_detail`,
		 * joined to current locally composed candidates) — read on selection,
		 * not on every `readView` refresh (task brief: "the read runs on
		 * selection, not on every view refresh"). `selectedItem` survives a
		 * refresh so a `readView` in flight while an item is selected does not
		 * clobber `itemDetail` back to null. */
		let itemDetail: PlayItemDetail | null = null;
		let itemSelectionSeq = 0;
		let occupantDetail: PlayOccupantDetail | null = null;
		let selectedOccupant: PlayOccupantSelection | null = null;
		let occupantSelectionSeq = 0;
		// Detail reads are immutable for a particular server-provided revision.
		// Keep this cache within the connected Play session only: reconnecting
		// always starts fresh, while re-opening the same person is instant.
		const occupantDetailCache = new Map<string, PlayOccupantDetail>();
		const OCCUPANT_DETAIL_CACHE_LIMIT = 64;
		const occupantDetailCacheKey = (occupant: { handle: string; rev: string }): string =>
			`${occupant.handle}\u0000${occupant.rev}`;
		const cacheOccupantDetail = (key: string, detail: PlayOccupantDetail): void => {
			occupantDetailCache.delete(key);
			occupantDetailCache.set(key, detail);
			const oldest = occupantDetailCache.keys().next().value;
			if (occupantDetailCache.size > OCCUPANT_DETAIL_CACHE_LIMIT && oldest !== undefined)
				occupantDetailCache.delete(oldest);
		};

		const drainEvents = (): void => {
			let fresh: WorldEvent[] = [];
			try {
				fresh = ingestFanoutForChronicle(worldEvents, toolClaimsInFlight > 0);
			} catch {
				fresh = [];
			}
			const spoken = speechFromEventsRemembering(fresh, live.actorId, speakerNames);
			for (const event of fresh) {
				if (event.kind === "speech_heard") spokenTraceIds.add(event.trace_id);
			}
			speech = mergeSpeech(speech, spoken);
			pendingChronicleEvents.push(...fresh.filter((event) => event.kind !== "speech_heard"));
		};

		/**
		 * Turns the drained non-speech events into chronicle entries, resolving
		 * every actor id they carry here, at ingest (sk-jay0.1.8.96): the hero's
		 * own ids read "you", and a name comes from what the authorized reads
		 * disclose right now — the scene and session roster `readView` just
		 * read, plus the previous view's (someone who left or fell in the same
		 * step). The entry keeps that name; an id unknown now stays unnamed and
		 * is never printed. Runs after `readView`'s reads rather than inside
		 * `drainEvents`, because the first drain after an arrival would
		 * otherwise only know the place just left.
		 */
		const ingestChronicle = (context: ChronicleNameContext): void => {
			if (pendingChronicleEvents.length === 0) return;
			const next = appendPlayChronicle(
				chronicle,
				pendingChronicleEvents,
				chronicleSeq,
				PLAY_CHRONICLE_LIMIT,
				context,
				heroOnlySessions,
			);
			pendingChronicleEvents = [];
			chronicle = next.entries;
			chronicleSeq = next.seq;
			heroOnlySessions = next.heroOnlySessions;
		};

		/**
		 * `key` names what the picture was asked for (place and mode); `scope`
		 * names what it draws (graph and mode). A new key always refetches —
		 * fog may have admitted new nodes — but only a new scope, or having no
		 * ready picture, clears the tile to "loading". A move inside the same
		 * graph keeps the shown map, its tokens and "ready" until the new
		 * answer lands (stale-while-revalidate, sk-jay0.1.8.100): on one floor
		 * the drawing does not depend on where the hero stands, the widget
		 * frames it client-side.
		 *
		 * `floor` is the hero's own place elevation (sk-jay0.1.8.111). It goes
		 * out as the map tool's `z`: the tool draws a multi-floor indoor graph
		 * one floor at a time and its own default is the ground floor, so
		 * without it the Cellar showed the Common Room. `slice` stays the tool's
		 * automatic choice; a graph it does not draw by floor ignores `z`.
		 * The floor is NOT part of the `scope`: Play cannot tell which graphs
		 * the tool draws by floor, and an outdoor graph has a different
		 * elevation on almost every node, so a floor in the scope would blank
		 * the card on every such move. A floor change inside one graph
		 * therefore revalidates like any other move: the previous picture stays
		 * for the one round trip until the new floor's answer replaces it.
		 */
		const refreshMap = (key: string, scope: string, graph?: string, floor?: number): void => {
			if (key === mapKey) return;
			mapKey = key;
			const request = ++mapRequest;
			const revalidating = scope === mapScope && mapState === "ready" && mapSvg !== null;
			mapScope = scope;
			if (!revalidating) {
				mapSvg = null;
				mapState = "loading";
				sessionTokens = [];
				if (view !== null) publishView({ ...view, mapSvg, mapState, sessionTokens });
			}
			void execute(SPELLKAVE_MAP_TOOL, {
				output_type: "svg",
				...(graph ? { graph } : {}),
				...(graph && args.mapSlice ? { slice: args.mapSlice } : {}),
				...(graph && !args.mapSlice && floor !== undefined ? { z: floor } : {}),
			})
				.then((payload) => {
					if (closed || request !== mapRequest) return;
					mapSvg = mapSvgFromPayload(payload);
					mapState = payload === null ? "failed" : mapSvg === null ? "empty" : "ready";
					sessionTokens = sessionTokensFromPayload(payload);
					if (view !== null) publishView({ ...view, mapSvg, mapState, sessionTokens });
				})
				.catch(() => {
					if (closed || request !== mapRequest) return;
					mapSvg = null;
					mapState = "failed";
					sessionTokens = [];
					if (view !== null) publishView({ ...view, mapSvg: null, mapState, sessionTokens });
				});
		};

		/**
		 * Pack stage selection (or `null` to clear it): `spellkave_item_detail`
		 * for the item's own facts, joined to local direct candidates using
		 * its authorized entity id and independently disclosed participant bindings.
		 * Runs on selection only — never
		 * folded into `readView`'s own poll, per the brief. A stale response
		 * for a since-superseded selection is dropped via `itemSelectionSeq`.
		 */
		const selectItem = async (item: SelectedPackItem | null): Promise<void> => {
			itemSelectionSeq += 1;
			const seq = itemSelectionSeq;
			if (item === null) {
				itemDetail = null;
				if (view !== null) publishView({ ...view, itemDetail });
				return;
			}
			const detailPayload = await execute(SPELLKAVE_ITEM_DETAIL_TOOL, {
				handle: item.handle,
				rev: item.rev,
			});
			if (closed || seq !== itemSelectionSeq) return;
			const base = itemDetailFromPayload(detailPayload);
			if (closed || seq !== itemSelectionSeq) return;
			// `execute` swallows a rejected/malformed tool call into `null`
			// (courtesy channel above), which `itemDetailFromPayload` maps to
			// the SAME `null` a still-loading selection starts from — Pack
			// showed "Loading what you can do with this…" forever once the
			// read had actually finished and failed (sk-jay0.1.8.11 item 7,
			// live-14-pack.png). Once this promise resolves, `null` means the
			// read is DONE and came back empty/unavailable, so it now renders
			// as a failed detail keyed to this item's own id — never the
			// loading sentinel again for this selection.
			itemDetail =
				base === null
					? { id: item.id, kind: "", slot: null, facts: [], verbs: [], failed: true }
					: {
							...base,
							id: item.id,
							entityId: base.id,
							verbs: actionsForEntity(view?.actions ?? [], view?.manipulationContext, base.id),
						};
			if (view !== null) publishView({ ...view, itemDetail });
		};

		const selectOccupant = async (occupant: PlayOccupantSelection | null): Promise<void> => {
			selectedOccupant = occupant;
			occupantSelectionSeq += 1;
			const seq = occupantSelectionSeq;
			if (occupant === null) {
				occupantDetail = null;
				if (view !== null) publishView({ ...view, occupantDetail });
				return;
			}
			const cacheKey = "handle" in occupant ? occupantDetailCacheKey(occupant) : undefined;
			const current = view?.occupants.find((row) => row.id === occupant.id);
			const cached =
				cacheKey !== undefined && current && "rev" in occupant && current.rev === occupant.rev
					? occupantDetailCache.get(cacheKey)
					: undefined;
			if (cached !== undefined) {
				occupantDetail = cached;
				if (view !== null) publishView({ ...view, occupantDetail });
				return;
			}
			occupantDetail = null;
			if (view !== null) publishView({ ...view, occupantDetail });
			const detailPayload = await execute(SPELLKAVE_SCENE_DETAIL_TOOL, {
				...("targetRef" in occupant
					? { target_id: occupant.targetRef }
					: { handle: occupant.handle, rev: occupant.rev }),
			});
			if (closed || seq !== occupantSelectionSeq) return;
			const base = occupantDetailFromPayload(detailPayload, {
				id: occupant.id,
				handle: "handle" in occupant ? occupant.handle : "",
				rev: "rev" in occupant ? occupant.rev : "",
			});
			if (base === null || !base.entityId) {
				if ("targetRef" in occupant) {
					selectedOccupant = null;
					occupantDetail = null;
					if (view !== null) publishView({ ...view, occupantDetail });
					return;
				}
				occupantDetail = {
					id: occupant.id,
					handle: occupant.handle,
					rev: occupant.rev,
					facts: [],
					verbs: [],
					failed: true,
				};
				if (view !== null) publishView({ ...view, occupantDetail });
				return;
			}
			if (closed || seq !== occupantSelectionSeq) return;
			const resolvedDetail: PlayOccupantDetail = {
				...base,
				verbs: actionsForEntity(view?.actions ?? [], view?.manipulationContext, base.entityId),
			};
			occupantDetail = resolvedDetail;
			if (!resolvedDetail.failed && cacheKey !== undefined)
				cacheOccupantDetail(cacheKey, resolvedDetail);
			if (view !== null) publishView({ ...view, occupantDetail });
		};

		/**
		 * Words spoken before this page connected never arrive as events (the
		 * fan-out primes on its first read), yet the DM's open question is exactly
		 * what a player needs first. Read the durable record the way the DM's own
		 * restart reconcile does: list speech traces, detail the unseen ones.
		 */
		const backfillSpeech = async (nameOf: (actorId: string) => string): Promise<void> => {
			const listing = await execute(SPELLKAVE_TRACES_TOOL, {
				kind: SPEECH_TRACE_KIND,
				limit: SPEECH_BACKFILL_LIMIT,
			});
			const refs = traceRefsFromListing(listing, SPEECH_TRACE_KIND).filter(
				(ref) => !spokenTraceIds.has(ref.id),
			);
			if (refs.length === 0) return;
			const details = await Promise.all(
				refs.map((ref) =>
					execute(SPELLKAVE_TRACE_DETAIL_TOOL, { handle: ref.handle, rev: ref.rev }),
				),
			);
			const lines: PlaySpeech[] = [];
			details.forEach((detail, index) => {
				const ref = refs[index];
				if (ref === undefined) return;
				spokenTraceIds.add(ref.id);
				const line = speechFromTraceDetail(detail, nameOf, live.actorId);
				if (line !== null) lines.push(line);
			});
			// `mergeSpeech` sorts by (tick, id) itself and dedupes by trace id, so
			// the backfill's own listing order (most-recent-first) needs no
			// pre-sort or manual "already known" filter here any more.
			speech = mergeSpeech(speech, lines);
		};

		/**
		 * "action" — the player's own move/act/end-turn/react asked for this
		 * refresh (or it is the session's first bootstrap read). "push" — the
		 * world changed and `live.onUpdate` scheduled this refresh with nobody
		 * having just acted. `readView` logs the SAME read cycle as a trail
		 * `read` or `world_pull` entry depending on which it was — the
		 * distinction the bead's description draws between "one entry per
		 * read" and "one entry per world pull".
		 */
		type RefreshCause = "action" | "prompt-success" | "push";

		const readView = async (cause: RefreshCause): Promise<void> => {
			const generation = operationGeneration;
			drainEvents();
			const [
				selfPayload,
				selfStatePayload,
				selfCapabilityPayload,
				selfIdentityPayload,
				selfConditionPayload,
				selfEconomyPayload,
				selfEconomyBudgetPayload,
				scenePayload,
				sessionPayload,
				operationPayload,
				reactionPayload,
				interventionPayload,
				packPayload,
				manipulationContextPayload,
				senseContextPayload,
			] = await Promise.all([
				execute(SPELLKAVE_SELF_SUMMARY_TOOL, {}),
				execute(SPELLKAVE_SELF_STATES_TOOL, { kind: "state", limit: 100 }),
				execute(SPELLKAVE_SELF_STATES_TOOL, { kind: "capability", limit: 100 }),
				execute(SPELLKAVE_SELF_STATES_TOOL, { kind: "identity", limit: 100 }),
				execute(SPELLKAVE_SELF_STATES_TOOL, { kind: "condition", limit: 100 }),
				execute(SPELLKAVE_SELF_STATES_TOOL, { kind: "economy", limit: 100 }),
				execute(SPELLKAVE_SELF_STATES_TOOL, { kind: "economy_budget", limit: 100 }),
				execute(SPELLKAVE_SCENE_TOOL, { limit: 100 }),
				execute(SPELLKAVE_SESSION_STATUS_TOOL, {}),
				execute(SPELLKAVE_SESSION_STATUS_TOOL, {
					detail: true,
					...(operationId ? { session_id: operationId } : {}),
					...(operationCursor ? { cursor: operationCursor } : {}),
				}).catch(() => null),
				execute(SPELLKAVE_REACTION_OPTIONS_TOOL, {}),
				execute(SPELLKAVE_INTERVENTION_WINDOWS_TOOL, {}),
				execute(SPELLKAVE_INVENTORY_TOOL, { limit: 100 }),
				execute(
					SPELLKAVE_MANIPULATION_CONTEXT_TOOL,
					// Play reads group, template and provider facts: the full rows.
					cause === "prompt-success"
						? { detail: "full", wait_for_prompt_ms: SUCCESSOR_PROMPT_WAIT_MS }
						: { detail: "full" },
				),
				execute(SPELLKAVE_SENSE_CONTEXT_TOOL, {}),
			]);
			if (closed) return;
			// `hideDraftVitals` again after the merge: the self-state facets can
			// carry `xp` on their own, which a hero still being drafted must not
			// show (sk-jay0.1.8.102 s3).
			const hero = hideDraftVitals({
				...heroFromSelfSummary(
					args.actorId,
					selfPayload,
					selfStatePayload,
					selfIdentityPayload,
					selfConditionPayload,
				),
				...selfStateFacetsFromPayload(selfStatePayload),
				...capabilityChipsFromPayload(selfCapabilityPayload),
			});
			const { place, occupants } = sceneFromPayload(scenePayload, live.actorId);
			// Selected detail follows the latest authorized scene. A disclosed child
			// is re-admitted through scene_detail, so closing any ancestor clears it.
			if (selectedOccupant !== null) {
				if ("targetRef" in selectedOccupant) await selectOccupant(selectedOccupant);
				else {
					const current = occupants.find((row) => row.id === selectedOccupant?.id);
					if (!current) await selectOccupant(null);
					else if (current.rev !== occupantDetail?.rev)
						await selectOccupant({
							id: current.id,
							handle: current.handle,
							rev: current.rev,
							name: current.name,
						});
				}
			}
			const placeState = scenePayload === null ? "failed" : place === null ? "missing" : "ready";
			const pack = packFromPayload(packPayload);
			const manipulationContext = manipulationContextFromPayload(manipulationContextPayload, {
				place,
				occupants,
				pack,
				// The same self ref `actionsFromManipulationContext` below builds.
				// An unnamed hero's `name` is the actor id fallback, not a name.
				self: { entityId: live.actorId, name: hero.name === args.actorId ? "" : hero.name },
			});
			const contextInput: ContextGenerationInput =
				manipulationContext.status === "ready"
					? { status: "ready", revision: manipulationContext.revision }
					: { status: "unavailable", revision: null };
			contextGeneration = nextContextGeneration(previousContext, contextInput);
			previousContext = { ...contextInput, generation: contextGeneration };
			const offered = actionsFromManipulationContext(manipulationContext, live.actorId);
			const senseContext = senseContextFromPayload(senseContextPayload);
			const senseActions = actionsFromSenseContext(senseContext);
			const actions = [...offered.actions, ...senseActions];
			if (itemDetail?.entityId)
				itemDetail = {
					...itemDetail,
					verbs: actionsForEntity(actions, manipulationContext, itemDetail.entityId),
				};
			if (occupantDetail?.entityId)
				occupantDetail = {
					...occupantDetail,
					verbs: actionsForEntity(actions, manipulationContext, occupantDetail.entityId),
				};
			const economy = economyFromPayload(selfEconomyPayload);
			const economyBudget = economyBudgetFromPayload(selfEconomyBudgetPayload);
			const names = new Map<string, string>(occupants.map((entry) => [entry.id, entry.name]));
			names.set(live.actorId, hero.name);
			names.set(args.actorId, hero.name);
			const nameOf = (actorId: string): string => names.get(actorId) ?? actorId;
			const session = sessionFromPayload(sessionPayload, live.actorId, nameOf);
			const operations = operationsFromPayload(operationPayload, nameOf);
			const turnSession = session.id
				? operations.selected?.id === session.id
					? operations.selected
					: operationsFromPayload(
							await execute(SPELLKAVE_SESSION_STATUS_TOOL, { session_id: session.id }).catch(
								() => null,
							),
							nameOf,
						).selected
				: null;
			const reaction = reactionFromPayloads(reactionPayload, interventionPayload, nameOf);
			await backfillSpeech(nameOf);
			if (closed || generation !== operationGeneration) return;
			// The manipulation revision covers syntax/target/participant facts,
			// not the separately read turn and effort facts. Scope refusal memory
			// to all three: a refreshed effort window must permit another attempt
			// even when the action and target are unchanged (ADR-0141 D-6).
			// This revision is local to this Play session, never a server cursor.
			const rejectionFacts = JSON.stringify({
				context: contextInput,
				turn: [session.id, session.lifecycle, session.currentActor, session.myTurn],
				economy,
				economyBudget,
			});
			if (rejectionFacts !== previousRejectionFacts) {
				rejectionFactsRevision += 1;
				previousRejectionFacts = rejectionFacts;
			}
			const knownNames = new Map<string, string>();
			for (const known of [view, { occupants, session }]) {
				if (known === null) continue;
				for (const entry of known.occupants) knownNames.set(entry.id, entry.name);
				// A roster name falls back to the raw actor id (`nameOf`); that is
				// not a name.
				for (const entry of known.session.roster)
					if (entry.name !== entry.actorId) knownNames.set(entry.actorId, entry.name);
			}
			const selfIds = new Set([live.actorId, args.actorId]);
			if (!runningSessionSeeded) {
				runningSessionSeeded = true;
				if (
					session.id !== undefined &&
					session.roster.length > 0 &&
					session.roster.every((entry) => selfIds.has(entry.actorId))
				)
					heroOnlySessions = new Set([...heroOnlySessions, session.id]);
			}
			ingestChronicle({ selfIds, names: knownNames });
			view = {
				hero,
				place,
				occupants,
				actions,
				actionCount: offered.total + senseActions.length,
				manipulationContext,
				senseContext,
				session,
				operations: observeOperationClock(operations, performance.now()),
				turnSession,
				reaction,
				pack,
				itemDetail,
				occupantDetail,
				placeState,
				speech,
				events: chronicle,
				mapSvg,
				mapState,
				economy,
				economyBudget,
				sessionTokens,
			};
			publishView(view);
			lastViewReadAt = Date.now();
			operationId ??= view.operations?.selected?.id;
			const operationDetails = toolDetails(operationPayload);
			if (isRecord(operationDetails) && operationDetails.status === "stale_cursor")
				operationCursor = undefined;
			// Canonical place IDs are <place_graph_id>/<local_id> (the authoring
			// contract in tool-contracts/authoring-schemas.ts). Request this graph,
			// not the map tool's default H3 world overview. Combat keeps the tool's
			// own automatic tactical-grid selection. Visibility remains tool-owned.
			const separator = place?.id.lastIndexOf("/") ?? -1;
			const tactical = hasTacticalSession(view);
			const graph = !tactical && separator > 0 ? place?.id.slice(0, separator) : undefined;
			const mode = tactical ? "session" : "place";
			const floor = graph === undefined ? undefined : place?.elevation;
			refreshMap(`${place?.id ?? ""}|${mode}`, `${graph ?? ""}|${mode}`, graph, floor);
			const counts = {
				actions: view.actions.length,
				occupants: view.occupants.length,
				events: view.events.length,
				speech: view.speech.length,
				pack: view.pack.length,
			};
			const readEntry = { tool: "readView", counts, tick: latestTick(view) };
			if (cause === "push") playTrail.recordWorldPull(readEntry);
			else playTrail.recordRead(readEntry);
		};

		let refreshQueuedCause: RefreshCause = "push";

		const refresh = async (cause: RefreshCause = "action"): Promise<void> => {
			if (refreshing) {
				refreshQueued = true;
				refreshQueuedCause = cause;
				return;
			}
			refreshing = true;
			try {
				await readView(cause);
			} catch (caught) {
				if (!closed) args.onError(caught instanceof Error ? caught : new Error(String(caught)));
			} finally {
				refreshing = false;
				if (refreshQueued) {
					refreshQueued = false;
					void refresh(refreshQueuedCause);
				}
			}
		};

		const schedule = (): void => {
			if (closed) return;
			if (scheduled !== undefined) clearTimeout(scheduled);
			scheduled = setTimeout(() => {
				scheduled = undefined;
				void refresh("push");
			}, args.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		};

		listeners = live.onUpdate(() => schedule());
		await refresh("action");
		operationPoll = setInterval(() => {
			if (closed || !connected || refreshing || Date.now() - lastViewReadAt < 5000) return;
			if (
				view?.operations?.items.length ||
				view?.operations?.state === "failed" ||
				(view?.operations?.selected && !view.operations.selected.terminal)
			) {
				void refresh("push");
			}
		}, 5000);

		const runTool = async (
			name: string,
			params: Record<string, unknown>,
			interaction: number,
		): Promise<unknown> => {
			if (!connected || closed)
				throw new Error("The connection to this world closed. Reconnect to continue.");
			const started = performance.now();
			const tool = roleTools.byName.get(name);
			if (tool === undefined) {
				playObservation.record({
					phase: "tool_result",
					interaction,
					outcome: "unavailable",
					receipt: false,
				});
				const message = `${name} is not available to this seat.`;
				playTrail.recordToolError({
					tool: name,
					message,
					tick: view === null ? 0 : latestTick(view),
				});
				throw new Error(message);
			}
			toolClaimsInFlight += 1;
			try {
				const result = toolDetails(await tool.execute("play", params));
				const admittedOperation = operationReferenceFromResult(result);
				if (admittedOperation !== null) {
					operationId = admittedOperation;
					operationCursor = undefined;
					operationGeneration += 1;
				}
				const classification = classifyActResult(result);
				playObservation.record({
					phase: "tool_result",
					interaction,
					outcome:
						classification.kind === "happened" || classification.kind === "rejected"
							? classification.kind
							: "unknown",
					result_kind: classification.kind,
					...(classification.kind === "rejected" ? { admission: classification.admission } : {}),
					...(classification.kind === "happened"
						? { awaiting_response: classification.awaiting_response }
						: {}),
					receipt: isRecord(result) && isRecord(result.receipt),
					duration_ms: performance.now() - started,
					tick: view === null ? 0 : latestTick(view),
				});
				return result;
			} catch (cause) {
				playObservation.record({
					phase: "tool_result",
					interaction,
					outcome: "error",
					receipt: false,
					duration_ms: performance.now() - started,
				});
				playTrail.recordToolError({
					tool: name,
					message: cause instanceof Error ? cause.message : String(cause),
					tick: view === null ? 0 : latestTick(view),
				});
				throw cause;
			} finally {
				toolClaimsInFlight -= 1;
			}
		};

		/** Stamps one trail `act` entry — every player-issued write
		 * (`move`/`act`/`endTurn`/`react` below) shares this one recorder so
		 * the tool name, outcome and tick all read the same way. */
		const recordAct = (
			tool: string,
			startedAt: number,
			fields: {
				actionId: string | null;
				targetRef: string | null;
				words: string | null;
				outcome: string | null;
				observation: string | null;
				refusalCode?: string | null;
				refusalDetail?: string | null;
			},
		): void => {
			playTrail.recordAct({
				tool,
				...fields,
				durationMs: performance.now() - startedAt,
				tick: view === null ? 0 : latestTick(view),
			});
		};

		return {
			roleTools,
			async move(exit, interaction = 0) {
				const startedAt = performance.now();
				const result = await runTool(
					SPELLKAVE_MOVE_TOOL,
					{ handle: exit.handle, rev: exit.rev },
					interaction,
				);
				mapKey = "";
				await refresh("action");
				const classified = classifyActResult(result);
				const refusal = moveRefusal(result);
				recordAct(SPELLKAVE_MOVE_TOOL, startedAt, {
					actionId: exit.handle,
					targetRef: exit.to,
					words: null,
					outcome: classified.kind,
					observation: classified.kind === "happened" ? classified.observation : null,
					refusalCode: refusal?.code ?? null,
					refusalDetail: refusal?.detail ?? null,
				});
				return messageForMove(result);
			},
			async act(action, utterance, interaction = 0, suppliedInputValues) {
				// No optimistic line (operator decision D1): the player's own
				// words render only once the world has recorded them — the next
				// `refresh()` picks the line up from a `speech_heard` event or the
				// trace backfill, the same path every other speaker's line takes.
				const trimmed = utterance?.trim() ?? "";
				const startedAt = performance.now();
				const selectedEntityId = itemDetail?.entityId ?? occupantDetail?.entityId;
				const participantContext = participantContextForSelection(
					view?.manipulationContext,
					action.actionId ?? action.descriptor,
					selectedEntityId,
				);
				const inputValues =
					action.input === undefined
						? suppliedInputValues
						: inputValuesFromText(trimmed, suppliedInputValues);
				// A PlayAction and its form values can be assembled from Svelte reactive
				// state. Do not carry either proxy through to the SDK Attempt snapshot:
				// structuredClone rightly rejects proxies. Copy this primitive-only
				// wire shape at the UI/session boundary instead.
				const snapshotInputValues = inputValues === undefined ? undefined : { ...inputValues };
				const argsJsonInputValues =
					action.input === undefined || inputValues === undefined
						? {}
						: action.input.fields.reduce<Record<string, string | number | boolean>>(
								(values, field) => {
									const value = inputValues[field.name];
									if (field.channel === "args_json" && value !== undefined)
										values[field.name] = value;
									return values;
								},
								{},
							);
				const semanticContext =
					action.semanticContext === undefined
						? undefined
						: {
								source_ref: action.semanticContext.source_ref,
								occurrence_id: action.semanticContext.occurrence_id,
							};
				const argsJson = JSON.stringify({
					...argsJsonInputValues,
					...(trimmed === "" ? {} : { dispatch_text: trimmed }),
					...(participantContext === undefined ? {} : { participant_context: participantContext }),
					...(semanticContext === undefined ? {} : { semantic_context: semanticContext }),
				});
				const draft: IntentDraft | undefined =
					action.verb === "sensing"
						? undefined
						: action.verb === "communicate"
							? {
									kind: "communicate",
									speech_act_id: action.descriptor,
									target_ref: action.targetRef,
									args_json: argsJson,
									...(trimmed === "" ? {} : { utterance: trimmed }),
									...(snapshotInputValues === undefined
										? {}
										: { input_values: snapshotInputValues }),
									...(participantContext === undefined
										? {}
										: { participant_context: participantContext }),
									...(semanticContext === undefined ? {} : { semantic_context: semanticContext }),
								}
							: {
									kind: "manipulate",
									action_id: action.actionId ?? action.descriptor,
									target_ref: action.targetRef,
									args_json: argsJson,
									...(snapshotInputValues === undefined
										? {}
										: { input_values: snapshotInputValues }),
									...(participantContext === undefined
										? {}
										: { participant_context: participantContext }),
									...(semanticContext === undefined ? {} : { semantic_context: semanticContext }),
								};
				const draftCheck = draft === undefined ? undefined : checkDraft(draft, action.input);
				if (draftCheck !== undefined && draftCheck.status !== "complete")
					throw new PlayAttemptBlockedError(draftErrorMessage(draftCheck, action.input));
				const attempt =
					draft === undefined || draft.kind === "communicate"
						? undefined
						: composeFactoredManipulationAttempt(manipulationContextForAttempt(view), {
								action_id: draft.action_id ?? "",
								target_ref: draft.target_ref ?? "",
								args_json: draft.args_json,
								...(draft.participant_context === undefined
									? {}
									: { participant_context: draft.participant_context }),
								...(draft.semantic_context === undefined
									? {}
									: { semantic_context: draft.semantic_context }),
							});
				if (attempt !== undefined && attempt.status !== "not_assessed")
					throw new PlayAttemptBlockedError(composerErrorMessage(attempt));
				// Stamp a shared immutable Attempt at the dispatch boundary. The
				// context generation remains conservatively session-local until the
				// server projects a portable generation; ordinary revisions belong
				// beside the fingerprint, not in its observation epoch.
				const sharedAttempt =
					draft === undefined
						? undefined
						: createAttempt(
								draft,
								observationEpoch({
									world_instance_id: args.db,
									actor_id: live.actorId,
									connection_generation: 0,
									context_generation: contextGeneration,
								}),
								rejectionFactsRevision,
							);
				if (
					sharedAttempt !== undefined &&
					rejectionLedger.isSuppressed(draft!, sharedAttempt.epoch, sharedAttempt.facts_revision)
				)
					throw new PlayAttemptBlockedError(
						playCopy.session.repeatRefusal(
							lastRefusedLine?.key === JSON.stringify(draft) ? lastRefusedLine.text : undefined,
						),
					);
				const tool =
					action.verb === "communicate"
						? SPELLKAVE_COMMUNICATE_TOOL
						: action.verb === "sensing"
							? SPELLKAVE_SENSE_TOOL
							: SPELLKAVE_MANIPULATE_TOOL;
				const result = await runTool(
					tool,
					action.verb === "sensing"
						? { query_kind: action.descriptor, visibility: action.senseVisibility ?? "Local" }
						: action.verb === "communicate"
							? {
									target_id: action.targetRef,
									speech_act_id: action.descriptor,
									...(trimmed === "" ? {} : { utterance: trimmed }),
									args_json: sharedAttempt?.draft.args_json,
								}
							: attempt !== undefined
								? {
										target_id: attempt.target_ref,
										action_id: attempt.action_id,
										args_json: attempt.args_json,
										...(attempt.participant_context === undefined
											? {}
											: { participant_context: attempt.participant_context }),
									}
								: {},
					interaction,
				);
				const classified = classifyActResult(result);
				// Only a chosen occurrence-bound response is expected to create a
				// successor prompt. `happened` and `quiet` are both accepted receipts;
				// ordinary successful attempts must not turn every refresh into a
				// five-second dialogue wait; rejected text stays editable and is
				// refreshed immediately.
				await refresh(
					action.semanticContext !== undefined &&
						(classified.kind === "happened" || classified.kind === "quiet")
						? "prompt-success"
						: "action",
				);
				const outcome: Outcome =
					classified.kind === "rejected" && classified.admission === "rejected"
						? {
								status: "rejected",
								...(classified.reason === null ? {} : { reason: classified.reason }),
							}
						: classified.kind === "happened"
							? { status: "observed_result" }
							: { status: "unobserved" };
				if (sharedAttempt !== undefined) rejectionLedger.record(sharedAttempt, outcome);
				// Play-side memory of the refusal sentence just shown, so a suppressed
				// repeat can say what was refused. The shared ledger stays untouched.
				if (draft !== undefined && outcome.status === "rejected")
					lastRefusedLine = { key: JSON.stringify(draft), text: messageForAct(result) };
				const refusal = actRefusal(result);
				recordAct(tool, startedAt, {
					actionId: attempt?.action_id ?? action.descriptor,
					targetRef: action.targetRef,
					words: trimmed === "" ? null : trimmed,
					outcome: classified.kind,
					observation: classified.kind === "happened" ? classified.observation : null,
					refusalCode: refusal?.code ?? null,
					refusalDetail: refusal?.detail ?? null,
				});
				return messageForAct(result);
			},
			async endTurn(interaction = 0) {
				const startedAt = performance.now();
				const result = await runTool(SPELLKAVE_END_TURN_TOOL, {}, interaction);
				await refresh("action");
				const details = isRecord(result) ? result : {};
				const next =
					isRecord(details.session) && typeof details.session.current_actor === "string"
						? details.session.current_actor
						: "";
				const message =
					next === "" ? "Your turn is over." : `Your turn is over. ${next} acts next.`;
				recordAct(SPELLKAVE_END_TURN_TOOL, startedAt, {
					actionId: null,
					targetRef: next === "" ? null : next,
					words: null,
					outcome: "happened",
					observation: message,
				});
				return message;
			},
			async react(handle, rev, responseIntent, interaction = 0) {
				const startedAt = performance.now();
				const result = await runTool(
					SPELLKAVE_REACT_OPTION_TOOL,
					{
						handle,
						rev,
						response_intent: responseIntent,
					},
					interaction,
				);
				await refresh("action");
				const classified = classifyActResult(result);
				const refusal = actRefusal(result);
				recordAct(SPELLKAVE_REACT_OPTION_TOOL, startedAt, {
					actionId: handle,
					targetRef: responseIntent,
					words: null,
					outcome: classified.kind,
					observation: classified.kind === "happened" ? classified.observation : null,
					refusalCode: refusal?.code ?? null,
					refusalDetail: refusal?.detail ?? null,
				});
				return messageForAct(result);
			},
			selectItem,
			selectOccupant,
			async selectOperation(id, cursor) {
				if (
					id !== null &&
					id !== view?.operations?.selected?.id &&
					!view?.operations?.items.some((item) => item.id === id)
				)
					return;
				if (cursor !== undefined && cursor !== view?.operations?.nextCursor) return;
				operationId = id ?? undefined;
				operationCursor = cursor;
				operationGeneration += 1;
				await refresh("action");
			},
			refresh,
			disconnect() {
				closed = true;
				if (scheduled !== undefined) clearTimeout(scheduled);
				if (operationPoll !== undefined) clearInterval(operationPoll);
				listeners?.();
				stopWatch();
				stopTick();
				args.onWatch?.(null);
				live.close();
			},
		};
	} catch (cause) {
		closed = true;
		if (operationPoll !== undefined) clearInterval(operationPoll);
		listeners?.();
		args.onWatch?.(null);
		live.close();
		throw cause;
	}
}

export function readWorldUrl(env: Record<string, string | undefined>, origin: string): string {
	const raw = env.VITE_SPELLKAVE_WORLD_URL?.trim() ?? "";
	if (raw === "") return origin.replace(/\/+$/, "");
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" && url.protocol !== "http:") return origin.replace(/\/+$/, "");
		return raw.replace(/\/+$/, "");
	} catch {
		return origin.replace(/\/+$/, "");
	}
}
