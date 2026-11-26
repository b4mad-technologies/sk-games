/**
 * The Play page's view model, and the pure mappers that build it from PLAYER
 * tool payloads. Every field here is read through a `spellkave_*` tool — the
 * same tools the MCP gateway and the Pi extension bind — never from a table
 * row. Keeping the mappers pure lets tests feed recorded tool answers.
 */

import {
	type DialogueGuide,
	type ManipulationActionDescriptor,
	type ObservedContainerContents,
	parseDialogueGuide,
} from "@spellkave/sdk";
import type { SpeechHeardEvent, WorldEvent } from "@spellkave/tool-runtime";
import type { PlayChronicleEntry } from "./play-chronicle";
import { channelLabel } from "./play-economy";
import type { PlayOperation, PlayOperations } from "./play-operations";
import { playerTargetName } from "./player-copy";

export interface PlayExit {
	/** `spellkave_scene` exit handle, e.g. `s:exit:276`. */
	handle: string;
	/** The exit's own rev, required by `spellkave_move`. */
	rev: string;
	/** Compass direction or edge label as the world reports it. */
	label: string;
	/** Destination node id, path-shortened by the scene tool; null when unknown. */
	to: string | null;
	/** Canonical destination identity for joining a map selection to this offered exit. */
	toNodeId?: string;
	/** Destination display name (`to_name`), humanised id as a fallback. */
	toName: string;
	/** Traversal gate template ids standing on this edge (advisory, ADR-0101). */
	gates: string[];
}

export interface PlayPlace {
	id: string;
	name: string;
	description: string;
	exits: PlayExit[];
	/**
	 * The place's own floor height inside its graph (`spellkave_scene`'s
	 * `pose_elevation`: 0 ground, negative below it), when the world sends
	 * one. Play passes it to the map read so a multi-floor graph draws the
	 * floor the hero stands on (sk-jay0.1.8.111); absent means the map tool's
	 * own default floor.
	 */
	elevation?: number;
	/** The place's own authored picture (`spellkave_scene`'s `art`, ADR-0073),
	 * when the world sends one. Loaded through the gateway like occupant art. */
	art?: PlayArt;
}

export type PlayOccupantKind = "person" | "creature" | "thing";

export interface PlayArt {
	path: string;
	hash: string;
	license: string;
}

function artFromPayload(value: unknown): PlayArt | undefined {
	if (!isRecord(value)) return undefined;
	const path = str(value, "path");
	const hash = str(value, "hash");
	const license = str(value, "license");
	return path && /^[a-f0-9]{64}$/.test(hash) && license ? { path, hash, license } : undefined;
}

function scalarInputValues(value: unknown): Record<string, string | number> | undefined {
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value);
	if (entries.some(([, entry]) => typeof entry !== "string" && typeof entry !== "number"))
		return undefined;
	return Object.fromEntries(entries) as Record<string, string | number>;
}

export interface PlayOccupant {
	art?: PlayArt;
	id: string;
	handle: string;
	rev: string;
	kind: PlayOccupantKind;
	/** Authorized `spellkave_scene` item kind (`actor`, `entity`, …). */
	sceneKind: string;
	name: string;
	/** Condition ids the scene listing carries (e.g. `srd/condition/dead`). */
	conditions: string[];
	note: string;
	/**
	 * Authored definition id (e.g. `srd/creature/goblin-warrior`), when the
	 * scene listing carries one for this occupant — actor-kind occupants only
	 * today (sk-jay0.1.8.63.9). Lets an occupant's `def:<defId>` info card
	 * (sk-jay0.1.8.63.10, `info-cards.ts`) resolve a public compendium
	 * reference exactly, instead of matching by display name alone. Absent,
	 * never `""`, when the scene did not carry it.
	 */
	defId?: string;
}

export type PlayActionProvider = "place" | "entity" | "actor";

export interface PlayActionInputField {
	name: string;
	label: string;
	control: "text" | "textarea" | "number";
	placeholder?: string;
	required?: boolean;
	min?: number;
	max?: number;
	maxLength?: number;
	/** Authored PLAYER transport. Omitted rows retain the pre-channel
	 * compatibility behavior: render their values as utterance text. */
	channel?: "utterance" | "args_json";
}

/** A world-authored form schema projected by the PLAYER tool. Play only maps
 * controls to widgets; it never assigns action meaning to a field name. */
export interface PlayActionInput {
	fields: readonly PlayActionInputField[];
	submitLabel?: string;
}

export interface PlayAction {
	/** Authored name before target-qualified presentation. */
	name?: string;
	/** Original authored action id when its communication descriptor differs. */
	actionId?: string;
	/** Client-local identity for a direct typed attempt; never a server handle. */
	id: string;
	label: string;
	description?: string;
	/** Exact definition card supplied by the action's author, never text-matched. */
	infoRef?: string;
	/** `verb_class`: communicate | manipulate | sensing | movement … */
	verb: string;
	/** `descriptor_value`, the authored action id (e.g. `srd/speak-to`). */
	descriptor: string;
	targetName: string;
	targetRef: string;
	/** Bundle-authored group from `ui.affordance_group` (e.g. `combat`). */
	group?: string;
	/** All public authored classifications, including groups unknown to Play. */
	groups?: string[];
	/** Public authored source templates; facts, never selected offers. */
	templateIds?: string[];
	/** Speech affordances carry their words in `utterance`; they need a field.
	 * The tool's own `accepts_utterance` when the row carries it; derived here only
	 * for a payload recorded before the tool had the field. */
	acceptsUtterance: boolean;
	/** Explicit public input contract. `undefined` is a legacy action;
	 * `{ fields: [] }` explicitly means invoke without text. */
	input?: PlayActionInput;
	/** Direct sensing visibility, present only for a `verb: "sensing"` candidate. */
	senseVisibility?: string;
	/**
	 * Who offers this affordance (the tool's `provider`, ADR-0021's niche
	 * provider): the `place` the actor stands in, the target `entity` itself,
	 * or the `actor`'s own body (a self-verb such as Dodge, carried
	 * everywhere). The dock groups its action row by this
	 * (`ledger/designs/play-interaction-axioms.md`). Absent on a payload
	 * recorded before the tool had the field.
	 */
	provider?: PlayActionProvider;
	/** A numbered DM dialogue answer (`Answer 3`), when this action is one. */
	slot?: number;
	/** A server-issued dialogue-prompt occurrence bound to this particular
	 * attempt. It is carried unchanged into the Player-tool arguments; Play
	 * never manufactures or repairs it from prose. */
	semanticContext?: { source_ref: string; occurrence_id: string };
}

/** One authored action descriptor from ADR-0139's action-independent
 * manipulation context. It deliberately has no target: Play chooses a visible
 * target only when the player makes one attempt. */
export interface PlayManipulationAction {
	actionId: string;
	displayName: string;
	description?: string;
	groups?: string[];
	/** Public authored source templates; facts, never selected offers. */
	templateIds?: string[];
	acceptsUtterance?: boolean;
	input?: PlayActionInput;
	definitionRef?: string;
	/** Public presentation-only action cue. */
	cue?: { rank?: number; hint?: string };
	/** Author-published, caller-scoped draft values. They are visibly
	 * overridable suggestions, never eligibility or prompt context. */
	defaults?: {
		target?: { targetRef: string; kind: "actor" | "reference" };
		inputValues?: Record<string, string | number>;
		provenance: { namespace: string; templateId: string; attachmentId: string; contentKey: string };
	};
	/** A communication action is dispatched through `spellkave_communicate`. */
	communicationSpeechActId?: string;
	responseSlot?: number;
	tags: string[];
	nicheRequirements?: ManipulationActionDescriptor["niche_requirements"];
	selfOnly: boolean;
	selfEligible: boolean;
}

/** One independently disclosed target. `targetName` is resolved only from the
 * same authorized scene/pack view that Play already holds; it is never an
 * eligibility label. */
export interface PlayManipulationTarget {
	targetFactId: string;
	targetRef: string;
	targetName: string;
	tags: string[];
	nicheIds?: string[];
}

export interface PlayManipulationParticipantContext {
	contextId: string;
	actionId: string;
	bindingCount: number;
	bindings: Array<{ roleId: string; entityId: string }>;
}

/** One caller-authorised open prompt occurrence. This is a world fact used to
 * rank and bind a response draft, never a local conclusion that a response is
 * eligible. Presentation of the question itself awaits the authoritative
 * prompt presentation carrier; Play does not recover it from speech prose. */
export interface PlayManipulationPrompt {
	occurrenceId: string;
	promptDefId: string;
	contractVersion: number;
	sourceRef: string;
	responseActionIds: string[];
	openedAtTick: number;
	consumed: boolean;
	/** Author-owned metadata presentation joined by the SDK from the prompt
	 * definition. It is optional while old recordings and the additive server
	 * rollout coexist; Play never falls back to transcript matching. */
	presentation?: {
		question?: string;
		labels: Record<string, string>;
		responseRefs?: Record<string, string>;
		/** The speaker's machine side of a guided question: outline, draft so
		 * far, picks left. Shown as sent; never a reason to branch on a step id. */
		guide?: DialogueGuide;
	};
}

export type PlayManipulationContext =
	| { status: "unavailable" }
	| {
			status: "ready";
			schemaVersion: number;
			revision: number;
			actions: PlayManipulationAction[];
			targets: PlayManipulationTarget[];
			participants: PlayManipulationParticipantContext[];
			prompts?: PlayManipulationPrompt[];
	  };

/** Direct sensing syntax discovered from visible place and capability facts. */
export type PlaySenseContext =
	| { status: "unavailable" }
	| {
			status: "ready";
			queries: Array<{
				queryKind: string;
				visibility: string;
				displayName: string;
				outcomeTemplateId: string;
			}>;
	  };

/** A numbered dialogue slot is an invocation, not a text field. Its action can
 * still carry dispatch text at the transport layer because it is a
 * communication speech act, but the slot itself already supplies the answer.
 * For every other action, an authored input schema wins over the legacy
 * `acceptsUtterance` carriage bit. */
export function actionTakesInput(action: PlayAction): boolean {
	if (action.slot !== undefined) return false;
	return action.input === undefined ? action.acceptsUtterance : action.input.fields.length > 0;
}

export interface PlayVital {
	id: string;
	label: string;
	value: string;
	description?: string;
}

/**
 * One of the six SRD abilities, from `spellkave_self_states` (`kind: "state"`).
 * The substrate persists only the raw score (`srd/str`, `srd/dex`, …) — the
 * modifier is never itself a stored state ("no modifier is persisted as
 * derived state",
 * `packages/spellkave-srd-cc/src/chapters/playing-the-game/modifier-units.ts`)
 * — so `modifier` here is the SRD's own published formula applied to the
 * reported score, not a value the client invented.
 */
export interface PlayAbility {
	id: string;
	label: string;
	description?: string;
	score: number;
	modifier: number;
}

/** A skill proficiency or weapon mastery grant, from `spellkave_self_states`
 * (`kind: "capability"`). */
export interface PlayCapabilityChip {
	id: string;
	label: string;
}

/** One channel's current-window standing, from `spellkave_self_states`
 * (`kind: "economy"`) — `{channel_id, spent_ms, window_start_ms}` on the
 * wire. Only channels the read actually returns are ever represented; a
 * channel the world has not bound (e.g. movement, pending `sk-0m4.123`)
 * stays absent rather than invented as zero. */
export interface EconomyChannel {
	channelId: string;
	spentMs: number;
	windowStartMs: number;
}

/** A channel's per-row disclosure state, from `spellkave_self_states`
 * (`kind: "economy_budget"`) — the world's own `readSelfEconomyBudget`
 * (`self_economy_budget.ts`), not a client guess. `unknown_channel` marks a
 * row the world declines to size (numeric fields omitted on the wire, same
 * as `pending_boundary`). */
export type EconomyBudgetChannelStatus = "ok" | "pending_boundary" | "unknown_channel";

/**
 * One channel's disclosed remaining capacity, from `spellkave_self_states`
 * (`kind: "economy_budget"`). Unlike `EconomyChannel` above (spend history
 * only, `kind: "economy"`), this carries the world's own authoritative
 * "how much is left" (ledger/designs/play-interaction-axioms.md, "Decided
 * details" 5). `poolMs`/`remainingMs` are `null` whenever the world has not
 * disclosed a number for this row yet (`status` other than `"ok"`) — never
 * invented as zero or copied from `pool_ms_per_round`.
 */
export interface PlayEconomyBudgetChannel {
	channelId: string;
	/** Short human label derived from the channel id's last segment
	 * (`channelLabel`, `play-economy.ts`) — the same derivation the dock's
	 * pip helper uses, so the two never disagree on wording. */
	label: string;
	poolMs: number | null;
	remainingMs: number | null;
	spentMs: number;
	status: EconomyBudgetChannelStatus;
	offTurnEligible: boolean;
}

/**
 * The resource-strip source, from `spellkave_self_states`
 * (`kind: "economy_budget"`). `unavailable: true` mirrors the envelope's own
 * `status: "unavailable"` (`readSelfEconomyBudget`'s `reason: "world_time"`
 * gap — no world tick observed yet) — distinct from a channel's own
 * `pending_boundary`, which still returns a row, just without disclosed
 * numbers. `channels` is `[]` under `unavailable`.
 */
export interface PlayEconomyBudget {
	channels: PlayEconomyBudgetChannel[];
	unavailable: boolean;
}

export interface PlayHero {
	descriptionReads?: {
		values?: "ready" | "failed";
		identity?: "ready" | "failed";
		conditions?: "ready" | "failed";
	};
	/** Counts at the tool boundary, before presentation mapping. */
	suppliedFields?: { vitals: number; quest: number; conditions: number };
	actorId: string;
	name: string;
	/** Authored identity facets (`self_summary`'s `identity` glance), parsed
	 * from the world's own `srd.species.*`/`srd.class.*`/`srd.background.*`
	 * tags — `readSelfIdentity`'s own doc comment invites this: "rendering a
	 * phrase like 'Human Fighter (Soldier)' from these rows stays the
	 * consumer's job." */
	species?: string;
	className?: string;
	background?: string;
	level?: number;
	hp?: number;
	ac?: number;
	xp?: number;
	/**
	 * True while the hero is still being drafted (the world's
	 * `HERO_DRAFTING_CONDITION_ID` is on them). `hp`, `ac` and `xp` are then
	 * left unset and their `vitals` rows left out (`hideDraftVitals`), so no
	 * surface shows the world's seed zeros (sk-jay0.1.8.102 s3). Absent
	 * otherwise.
	 */
	drafting?: true;
	/** `srd/proficiency_bonus` — the one modifier the substrate DOES persist
	 * (a baked per-entity stat, unlike the ability modifiers above). */
	proficiency?: number;
	proficiencyDescription?: string;
	identityDetails?: { id: string; label: string; description: string }[];
	/** Every vital the world buckets for display (`ui.self_summary`), in order. */
	vitals: PlayVital[];
	quest?: PlayVital[];
	conditionDetails?: {
		id: string;
		label: string;
		description?: string;
		stackCount?: number;
		expiresAtTick?: number;
	}[];
	/** The six abilities, from `spellkave_self_states`. Empty until that read
	 * runs (`heroFromSelfSummary` alone never populates this). */
	abilities: PlayAbility[];
	skills: PlayCapabilityChip[];
	masteries: PlayCapabilityChip[];
	conditions: string[];
	appearance: string;
	backstory: string;
	placeId: string | null;
}

export interface PlayRosterEntry {
	actorId: string;
	name: string;
	ordinal: number;
	isMe: boolean;
	isCurrent: boolean;
}

export interface PlaySessionState {
	id?: string;
	inSession: boolean;
	myTurn: boolean;
	lifecycle: string | null;
	currentActor: string | null;
	currentActorName: string | null;
	roster: PlayRosterEntry[];
}

export interface PlayReaction {
	windowKind: "reaction" | "intervention";
	handle: string;
	rev: string;
	originatingActionId: string;
	originatingActor: string | null;
	originatingActorName: string | null;
	remainingMs: number | null;
	faces: unknown[];
}

export interface PlayPackItem {
	id: string;
	name: string;
	detail: string;
	quantity: number;
	equipped: string | null;
	/** Containment depth from the inventory walk: 0 at the top, 1 inside a
	 * carried container ("Explorer's Pack"), and so on. */
	depth?: number;
	/** Stable inventory handle + the item's OWN rev (`spellkave_inventory`'s
	 * row), copied verbatim to `spellkave_item_detail` on selection — that
	 * tool requires both. */
	handle: string;
	rev: string;
}

export interface PlayItemStateFacet {
	id: string;
	label: string;
	value: string;
}

/**
 * On-demand rich detail for the pack's currently-selected item
 * (`spellkave_item_detail`, joined to current factual action candidates) —
 * the read runs on selection, not on every view refresh (`play-session.ts`'s
 * `selectItem`). `id` lets a consumer gate a stale detail from a previous
 * selection against the new one.
 *
 * Authored description and state labels come from the authorized item
 * detail tool. Older or unauthored answers retain the identifier fallback.
 */
export interface PlayItemDetail {
	/** Exact authored definition from the authorized item-detail read. */
	definitionRef?: string;
	art?: PlayArt;
	suppliedFields?: number;
	id: string;
	/** Authorized entity identity, separate from the inventory selection handle. */
	entityId?: string;
	description?: string;
	kind: string;
	slot: string | null;
	facts: PlayItemStateFacet[];
	verbs: PlayAction[];
	/** The on-demand `spellkave_item_detail`
	 * read for this item errored, rather than answering an honest empty
	 * page — `selectItem` (`play-session.ts`) sets this instead of leaving
	 * the pack tile stuck on "Loading" forever (sk-jay0.1.8.11 item 7). */
	failed?: boolean;
}

export interface PlayOccupantDetail {
	art?: PlayArt;
	id: string;
	handle: string;
	rev: string;
	entityId?: string;
	/** Authored definition id (e.g. `srd/creature/goblin-warrior`), absent when
	 * unresolved — see `PlayOccupant.defId`'s doc comment (sk-jay0.1.8.63.9). */
	defId?: string;
	description?: string;
	/** Authorized direct children; unavailable never means empty. */
	contents?: ObservedContainerContents;
	facts: PlayItemStateFacet[];
	verbs: PlayAction[];
	failed?: boolean;
}

export interface PlaySpeech {
	id: string;
	tick: number;
	speakerId: string | null;
	speaker: string;
	text: string;
	mine: boolean;
	/**
	 * Who this line was aimed at — payload, never routing: everyone at the
	 * node hears everything, so this never scopes what a line renders, only
	 * the "to <name>" suffix. Optional: `speech_heard`'s `addressee`/
	 * `addressee_name` and a backfilled trace's payload supply these fields
	 * only when present. The thread never issues per-line detail reads just
	 * to enrich the display, and it never infers an addressee from prose.
	 */
	addressee?: number | null;
	addresseeName?: string | null;
	/** A legacy numbered choice. Empty world-authored text stays a neutral slot
	 * label because the event does not identify the answered occurrence. */
	choiceSlot?: number;
}

export interface PlayView {
	/** Set only by the read-only recording adapter. A current session that has
	 * not yet received manipulation facts must not impersonate a historical
	 * action-list recording. */
	interactionOrigin?: "legacy-recording";
	hero: PlayHero;
	place: PlayPlace | null;
	occupants: PlayOccupant[];
	actions: PlayAction[];
	actionCount: number;
	/** ADR-0140's independently disclosed ordinary-manipulation facts. */
	manipulationContext: PlayManipulationContext;
	/** Direct sensing candidates, deliberately separate from manipulation facts. */
	senseContext?: PlaySenseContext;
	session: PlaySessionState;
	operations?: PlayOperations;
	/** Detail for the compact turn selection, independent of the open activity reader. */
	turnSession?: PlayOperation | null;
	reaction: PlayReaction | null;
	pack: PlayPackItem[];
	/** The currently-selected pack item's rich detail, read on demand — see
	 * `PlayItemDetail`'s own doc comment. Optional (not just nullable): every
	 * `PlayView` literal elsewhere in the codebase predates this field. */
	itemDetail?: PlayItemDetail | null;
	/** On-demand `spellkave_scene_detail` + targeted actions for a selected occupant. */
	occupantDetail?: PlayOccupantDetail | null;
	placeState?: "ready" | "failed" | "missing";
	speech: PlaySpeech[];
	events: PlayChronicleEntry[];
	mapSvg: string | null;
	mapState?: "loading" | "ready" | "empty" | "failed";
	/**
	 * `spellkave_self_states kind=economy` — one row per action-economy
	 * channel this actor has touched in the current window. `null` when the
	 * read failed or has not run yet (never thrown as an error, see
	 * `play-session.ts`'s `readView`); `[]` is an honest "no channel spent
	 * yet" answer. Optional (not just nullable): every `PlayView` literal
	 * elsewhere in the codebase predates this field.
	 */
	economy?: EconomyChannel[] | null;
	/**
	 * `spellkave_self_states kind=economy_budget` — the world's own disclosed
	 * remaining capacity per action-economy channel (plan row W6). `null`
	 * when the read failed or has not run yet (never thrown as an error,
	 * mirrors `economy` above); a present value's own `unavailable` flag
	 * carries the world's honest "no tick observed yet" answer, distinct
	 * from a per-channel `pending_boundary`. Optional (not just nullable):
	 * every `PlayView` literal elsewhere in the codebase predates this
	 * field.
	 */
	economyBudget?: PlayEconomyBudget | null;
	/**
	 * `spellkave_map`'s `session_tokens` (sk-jay0.4.2), parsed alongside
	 * `mapSvg` from the SAME map response — see `sessionTokensFromPayload`'s
	 * own doc comment. `[]` both outside a tactical session and while one is
	 * open with nobody placed yet; the map tile has no reason to tell those
	 * apart. Optional (not just an always-present `[]`): every `PlayView`
	 * literal elsewhere in the codebase predates this field.
	 */
	sessionTokens?: PlaySessionToken[];
}

export type ToolPayload = unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** PLAYER tools answer `{ details }`; tolerate a bare payload in tests. */
export function toolDetails(result: unknown): unknown {
	if (isRecord(result) && "details" in result) return result.details;
	return result;
}

function str(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	return typeof value === "string" ? value : "";
}

function num(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function items(page: unknown): Record<string, unknown>[] {
	const list = Array.isArray(page)
		? page
		: isRecord(page) && Array.isArray(page.items)
			? page.items
			: [];
	return list.filter(isRecord);
}

/** `inn/common_room` → `Common Room`. Only a fallback for a name the world did not author. */
export function humaniseNodeId(id: string): string {
	const last = id.split("/").pop() ?? id;
	const spaced = last.replace(/[_-]+/g, " ").trim();
	if (spaced === "") return id;
	return spaced.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function intFromState(row: Record<string, unknown>): number | undefined {
	const direct = num(row, "value_int");
	if (direct !== undefined) return direct;
	const raw = row.value;
	if (typeof raw === "string" && raw.trim() !== "") {
		const parsed = Number(raw);
		if (Number.isFinite(parsed)) return parsed;
	}
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	return undefined;
}

/** `event_channel_spend`/`visible_economy_channel_spend`'s `spent_ms` and
 * `window_start_ms` serialize as decimal strings on the wire (u64), like
 * every other tick/ms field this app reads — tolerate a bare number too
 * (a hand-built fixture) and default a missing/malformed field to `0`
 * rather than dropping the whole row. */
function msFromRecord(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

/** Same wire tolerance as `msFromRecord`, but a missing/malformed field stays
 * `null` — used for `effective_pool_ms`/`remaining_ms`, which
 * `self_economy_budget.ts` omits on purpose when a channel does not disclose
 * a number yet. Defaulting those to `0` would read as "fully spent", which
 * is not what the world said. */
function msOrNull(record: Record<string, unknown>, key: string): number | null {
	const value = record[key];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function stateStem(id: string): string {
	return (id.split("/").pop() ?? id).toLowerCase();
}

/** `srd.species.human` + prefix `srd.species.` → `Human`; the tag's own
 * declared facet prefix (`self.identity` items' `prefix` field) tells which
 * facet a tag belongs to, never a hand-guessed split. */
const IDENTITY_FACET_PREFIXES: Record<"species" | "className" | "background", string> = {
	species: "srd.species",
	className: "srd.class",
	background: "srd.background",
};

function identityFacetValue(tags: string[], prefix: string): string | undefined {
	const dotted = `${prefix}.`;
	const hit = tags.find((tag) => tag.startsWith(dotted));
	if (hit === undefined) return undefined;
	const slug = hit.slice(dotted.length);
	return slug === "" ? undefined : humaniseNodeId(slug);
}

/** `spellkave_self_summary` → hero. */
export function heroFromSelfSummary(
	actorId: string,
	payload: ToolPayload,
	statePayload?: ToolPayload,
	identityPayload?: ToolPayload,
	conditionPayload?: ToolPayload,
): PlayHero {
	const details = toolDetails(payload);
	const self = isRecord(details) && isRecord(details.self) ? details.self : null;
	const hero: PlayHero = {
		actorId,
		name: actorId,
		vitals: [],
		quest: [],
		conditionDetails: [],
		abilities: [],
		skills: [],
		masteries: [],
		conditions: [],
		appearance: "",
		backstory: "",
		placeId: null,
	};
	if (self === null) return hero;
	const descriptionRead = (result: ToolPayload): "ready" | "failed" | undefined => {
		if (result === undefined) return undefined;
		const data = toolDetails(result);
		return isRecord(data) && Array.isArray(data.items) ? "ready" : "failed";
	};
	hero.descriptionReads = {
		values: descriptionRead(statePayload),
		identity: descriptionRead(identityPayload),
		conditions: descriptionRead(conditionPayload),
	};
	// Enrich only summary-selected values, retaining authored membership/order.
	// Prose stays on the existing detail tool rather than the recurring glance.
	const stateDescriptions = new Map(
		items(statePayload ? toolDetails(statePayload) : null).map((row) => [
			str(row, "state_id"),
			str(row, "description"),
		]),
	);
	const conditionId = (row: Record<string, unknown>) =>
		str(row, "condition_definition_id") || str(row, "condition_id") || str(row, "id");
	// One entry per condition id: the world may hold several instances of the
	// same condition on one body (an initial condition plus one another actor
	// applied), and the YOU tile keys its rows by id (sk-jay0.1.1.16).
	//
	// Membership comes from the summary — except when the summary itself says
	// its page is only a bounded sample (`listing: "examples"`: the SDK cuts
	// the page to a few rows sorted by id, which dropped
	// `srd/condition/unconscious` behind its own implied rows,
	// sk-jay0.1.8.101). Then the already-fetched `spellkave_self_states
	// kind=condition` page is the list, provided that read is ready; a failed
	// read keeps the summary's sample. A complete summary still controls
	// membership, and its detail page only supplies descriptions.
	const summaryIsSample =
		isRecord(self.conditions) && str(self.conditions, "listing") === "examples";
	const conditionSource =
		summaryIsSample && descriptionRead(conditionPayload) === "ready"
			? items(conditionPayload ? toolDetails(conditionPayload) : null)
			: items(self.conditions);
	const conditionRows = conditionSource.filter(
		(row, index, rows) =>
			rows.findIndex((other) => conditionId(other) === conditionId(row)) === index,
	);
	const conditionDescriptions = new Map(
		items(conditionPayload ? toolDetails(conditionPayload) : null).map((row) => [
			conditionId(row),
			str(row, "description").trim() ? str(row, "description") : undefined,
		]),
	);
	hero.suppliedFields = {
		vitals: items(self.vitals).reduce(
			(count, row) => count + 1 + (stateDescriptions.get(str(row, "state_id")) ? 1 : 0),
			0,
		),
		quest: items(self.quest).reduce(
			(count, row) => count + 1 + (stateDescriptions.get(str(row, "state_id")) ? 1 : 0),
			0,
		),
		conditions: conditionRows.reduce(
			(count, row) =>
				count +
				1 +
				(Number(row.stack_count) > 0 ? 1 : 0) +
				(Number(row.expires_at_tick) > 0 ? 1 : 0) +
				(conditionDescriptions.get(conditionId(row)) ? 1 : 0),
			0,
		),
	};
	const identityTags = items(self.identity)
		.map((row) => str(row, "tag"))
		.filter((tag) => tag !== "");
	hero.species = identityFacetValue(identityTags, IDENTITY_FACET_PREFIXES.species);
	hero.className = identityFacetValue(identityTags, IDENTITY_FACET_PREFIXES.className);
	hero.background = identityFacetValue(identityTags, IDENTITY_FACET_PREFIXES.background);
	const identityDescriptions = new Map(
		items(identityPayload ? toolDetails(identityPayload) : null).map((row) => [
			str(row, "tag"),
			str(row, "description"),
		]),
	);
	hero.identityDetails = identityTags.flatMap((id) => {
		const prefix = Object.values(IDENTITY_FACET_PREFIXES).find((value) =>
			id.startsWith(`${value}.`),
		);
		const description = identityDescriptions.get(id);
		return prefix && description
			? [{ id, label: identityFacetValue([id], prefix) ?? id, description }]
			: [];
	});
	hero.name = str(self, "entity_name") || actorId;
	hero.appearance = str(self, "appearance");
	hero.backstory = str(self, "backstory");
	hero.placeId = str(self, "current_node_id") || null;
	for (const row of items(self.vitals)) {
		const id = str(row, "state_id");
		if (id === "") continue;
		const value = intFromState(row);
		hero.vitals.push({
			id,
			label: str(row, "display_name") || humaniseNodeId(id),
			value: value === undefined ? str(row, "value") : String(value),
			...(stateDescriptions.get(id) ? { description: stateDescriptions.get(id) } : {}),
		});
		if (value === undefined) continue;
		switch (stateStem(id)) {
			case "hp":
				hero.hp = value;
				break;
			case "ac":
				hero.ac = value;
				break;
			case "level":
				hero.level = value;
				break;
			case "xp":
				hero.xp = value;
				break;
			default:
				break;
		}
	}
	for (const row of items(self.quest)) {
		const id = str(row, "state_id");
		if (id)
			hero.quest?.push({
				id,
				label: str(row, "display_name") || humaniseNodeId(id),
				value: str(row, "value"),
				...(stateDescriptions.get(id) ? { description: stateDescriptions.get(id) } : {}),
			});
	}
	for (const row of conditionRows) {
		const id = conditionId(row);
		// The DM's own turn plumbing ("core/condition/controlled") and its
		// creation/level-up workflow conditions (`dm/…`) are not conditions
		// the player has; they showed in the YOU tile mid-fight and during
		// creation.
		if (id !== "" && !isDmInternalCondition(id)) {
			hero.conditions.push(id);
			const stackCount = Number(row.stack_count);
			const expiresAtTick = Number(row.expires_at_tick);
			hero.conditionDetails?.push({
				id,
				label: str(row, "display_name") || conditionLabel(id),
				...(conditionDescriptions.get(id) ? { description: conditionDescriptions.get(id) } : {}),
				...(Number.isSafeInteger(stackCount) && stackCount > 0 ? { stackCount } : {}),
				...(Number.isSafeInteger(expiresAtTick) && expiresAtTick > 0 ? { expiresAtTick } : {}),
			});
		}
	}
	if (conditionRows.some((row) => conditionId(row) === HERO_DRAFTING_CONDITION_ID))
		hero.drafting = true;
	return hideDraftVitals(hero);
}

/**
 * The condition the world keeps on a hero while character creation is still
 * drafting them (authored in
 * `packages/spellkave-adventure-runtime/src/author/dm/`). Matched by exact
 * id on the hero's own condition rows, never by label.
 *
 * TEMPORARY (owner decision 2026-11-12, sk-jay0.1.8.102 s3): naming an
 * adventure-runtime workflow id in the app is a stand-in until the world
 * itself says that a vital is not set yet (sk-jay0.1.8.108). Remove this id
 * and `hideDraftVitals` when that signal exists.
 */
export const HERO_DRAFTING_CONDITION_ID = "dm/creation/drafting";

/** The vitals a drafted hero has not been given yet; the world seeds them 0. */
const DRAFT_HIDDEN_VITAL_STEMS: ReadonlySet<string> = new Set(["hp", "ac", "xp"]);

/**
 * Hides HP, AC and XP on a hero that is still being drafted
 * (`hero.drafting`): the three numbers are left unset and their rows leave
 * `vitals`, so the tile, the card, the sheet and the dock footer all show
 * nothing instead of 0. Every other hero is returned unchanged. Safe to
 * apply twice; `play-session.ts` applies it again after it merges
 * `selfStateFacetsFromPayload`, which can carry `xp` on its own.
 */
export function hideDraftVitals<
	T extends Pick<PlayHero, "drafting" | "hp" | "ac" | "xp" | "vitals">,
>(hero: T): T {
	if (hero.drafting !== true) return hero;
	const { hp: _hp, ac: _ac, xp: _xp, ...rest } = hero;
	return {
		...rest,
		vitals: hero.vitals.filter((vital) => !DRAFT_HIDDEN_VITAL_STEMS.has(stateStem(vital.id))),
	} as T;
}

/** SRD ability state ids, in the sheet's own display order — six raw scores
 * (`packages/spellkave-srd-cc/src/chapters/playing-the-game/modifier-units.ts`'s
 * `ACTOR_ABILITY_MODIFIER_MACROS`, `abilityId` column). */
const ABILITY_LABELS: readonly [string, string][] = [
	["srd/str", "STR"],
	["srd/dex", "DEX"],
	["srd/con", "CON"],
	["srd/int", "INT"],
	["srd/wis", "WIS"],
	["srd/cha", "CHA"],
];
const ABILITY_LABEL_BY_ID = new Map(ABILITY_LABELS);
const ABILITY_ORDER = new Map(ABILITY_LABELS.map(([id], index) => [id, index]));

/** The baked, per-entity Proficiency Bonus STAT (a `resource_definitions`
 * row, not a live macro result) — the one modifier the substrate DOES
 * persist as a state (`playing-the-game/modifier-units.ts`'s own
 * "DERIVED-STATE CONTRACT" note). */
const PROFICIENCY_BONUS_STATE_ID = "srd/proficiency_bonus";
const XP_STATE_ID = "srd/xp";

/** SRD ability modifier: `floor((score - 10) / 2)`. The DSL's own `/` is
 * truncating (Rust i64 division), so this mirrors the sister correction
 * idiom the SRD content package uses for the SAME formula (`modifier-units.ts`,
 * "score 9: trunc -> 0, table -> -1") rather than reproducing the bug. */
function abilityModifier(score: number): number {
	const diff = score - 10;
	const quotient = Math.trunc(diff / 2);
	return diff < 0 && diff % 2 !== 0 ? quotient - 1 : quotient;
}

export interface SelfStateFacets {
	abilities: PlayAbility[];
	proficiency?: number;
	proficiencyDescription?: string;
	/** `srd/xp` when the world persists it but the authored self summary
	 * left it out (live rig: 25 XP for a kill, nowhere on the sheet). */
	xp?: number;
}

/** `spellkave_self_states` (`kind: "state"`, the default) → the six
 * abilities (with modifiers computed from the reported score — never
 * persisted as their own state, see `PlayAbility`'s doc comment) plus the
 * one baked modifier the substrate does report, Proficiency Bonus. Every
 * other row (`srd/hp`, `srd/hp_per_level`, `srd/ac`, `srd/level`, `srd/xp`,
 * `srd/reach_mm`) is already covered by `heroFromSelfSummary`'s `vitals` or
 * has no sheet slot yet — ignored here, not dropped silently: F6
 * (`ledger/designs/play-click-ui-gap.md`) already records the complete
 * self-state id set, and it has no `srd/speed`, so the sheet cannot show one. */
export function selfStateFacetsFromPayload(payload: ToolPayload): SelfStateFacets {
	const details = toolDetails(payload);
	const rows = isRecord(details) ? items(details.items) : [];
	const abilities: PlayAbility[] = [];
	let proficiency: number | undefined;
	let proficiencyDescription: string | undefined;
	let xp: number | undefined;
	for (const row of rows) {
		const id = str(row, "state_id");
		const value = intFromState(row);
		if (id === "" || value === undefined) continue;
		const label = ABILITY_LABEL_BY_ID.get(id);
		if (label !== undefined) {
			abilities.push({
				id,
				label,
				score: value,
				modifier: abilityModifier(value),
				...(str(row, "description") ? { description: str(row, "description") } : {}),
			});
			continue;
		}
		if (id === PROFICIENCY_BONUS_STATE_ID) {
			proficiency = value;
			proficiencyDescription = str(row, "description") || undefined;
		}
		if (id === XP_STATE_ID) xp = value;
	}
	abilities.sort((a, b) => (ABILITY_ORDER.get(a.id) ?? 0) - (ABILITY_ORDER.get(b.id) ?? 0));
	return {
		abilities,
		...(proficiency === undefined ? {} : { proficiency }),
		...(proficiencyDescription ? { proficiencyDescription } : {}),
		...(xp === undefined ? {} : { xp }),
	};
}

const SKILL_CAPABILITY_PREFIX = "srd/skill/";
/** The live rig's `display_name` for a skill capability carries its own
 * "Skill: " lead-in ("Skill: Athletics") — every id in this branch already
 * starts with `srd/skill/`, so the chip need not repeat it (sk-jay0.1.8.11
 * item 7, co-play live-14-pack.png). */
const SKILL_LABEL_PREFIX = /^skill:\s*/i;
/** Weapon mastery grants are not yet mechanized in the substrate (per-weapon
 * mastery properties — Vex/Topple/Push/Sap/Slow/etc. — are recorded as
 * pending Equipment-chapter work,
 * `packages/spellkave-srd-cc/src/chapters/classes/fighter-units.ts`); no
 * `srd/mastery/…`-style capability id exists to grep for today. Read the cue
 * defensively anyway, mirroring `occupantKindForActor` above: a capability id
 * containing "mastery" surfaces here with no further client change once that
 * work lands, and until then this is a correct, honest no-op — never a
 * hand-typed prefix for an id that does not exist yet. */
const MASTERY_CAPABILITY_HINT = /mastery/i;

export interface CapabilityChips {
	skills: PlayCapabilityChip[];
	masteries: PlayCapabilityChip[];
}

/** `spellkave_self_states` (`kind: "capability"`) → skill and (eventually)
 * weapon-mastery chips. */
export function capabilityChipsFromPayload(payload: ToolPayload): CapabilityChips {
	const details = toolDetails(payload);
	const rows = isRecord(details) ? items(details.items) : [];
	const skills: PlayCapabilityChip[] = [];
	const masteries: PlayCapabilityChip[] = [];
	for (const row of rows) {
		const id = str(row, "capability_id");
		if (id === "") continue;
		const label = str(row, "display_name") || humaniseNodeId(id);
		if (id.startsWith(SKILL_CAPABILITY_PREFIX)) {
			skills.push({ id, label: label.replace(SKILL_LABEL_PREFIX, "") });
			continue;
		}
		if (MASTERY_CAPABILITY_HINT.test(id)) masteries.push({ id, label });
	}
	return { skills, masteries };
}

/**
 * `spellkave_self_states` (`kind: "economy"`) → one `EconomyChannel` per row
 * the read actually returned, in the order the tool answered (server-sorted
 * by `channel_id`, `readSelfEconomyChannelSpends`). `null` for a failed or
 * not-yet-run read (`play-session.ts`'s `execute` swallows a rejected call
 * into `null`, which `toolDetails` passes straight through); `[]` for an
 * honest empty page (no channel spent yet this window). A row with no
 * `channel_id` is dropped — never rendered as a nameless pip.
 */
export function economyFromPayload(payload: ToolPayload): EconomyChannel[] | null {
	const details = toolDetails(payload);
	if (!isRecord(details)) return null;
	const rows = items(details.items);
	const channels: EconomyChannel[] = [];
	for (const row of rows) {
		const channelId = str(row, "channel_id");
		if (channelId === "") continue;
		channels.push({
			channelId,
			spentMs: msFromRecord(row, "spent_ms"),
			windowStartMs: msFromRecord(row, "window_start_ms"),
		});
	}
	return channels;
}

/**
 * `spellkave_self_states` (`kind: "economy_budget"`) → `PlayEconomyBudget`.
 * `null` for a failed or not-yet-run read (`play-session.ts`'s `execute`
 * swallows a rejected call into `null`, same contract as `economyFromPayload`
 * above); `{ channels: [], unavailable: true }` when the envelope itself
 * reports `status: "unavailable"` (`readSelfEconomyBudget`'s `reason:
 * "world_time"` gap — no world tick observed yet). Otherwise every row the
 * tool returned becomes one `PlayEconomyBudgetChannel`, carrying its own
 * per-channel `status` (`"ok" | "pending_boundary" | "unknown_channel"`) —
 * `poolMs`/`remainingMs` come through only when the row actually disclosed
 * them (`msOrNull`), never defaulted to zero. A row with no `channel_id` is
 * dropped, same as `economyFromPayload`.
 */
export function economyBudgetFromPayload(payload: ToolPayload): PlayEconomyBudget | null {
	const details = toolDetails(payload);
	if (!isRecord(details)) return null;
	if (details.status === "unavailable") return { channels: [], unavailable: true };
	const rows = items(details.items);
	const channels: PlayEconomyBudgetChannel[] = [];
	for (const row of rows) {
		const channelId = str(row, "channel_id");
		if (channelId === "") continue;
		const rawStatus = str(row, "status");
		const status: EconomyBudgetChannelStatus =
			rawStatus === "pending_boundary" || rawStatus === "unknown_channel" ? rawStatus : "ok";
		channels.push({
			channelId,
			label: channelLabel(channelId),
			poolMs: msOrNull(row, "effective_pool_ms"),
			remainingMs: msOrNull(row, "remaining_ms"),
			spentMs: msFromRecord(row, "spent_ms"),
			status,
			offTurnEligible: row.off_turn_eligible === true,
		});
	}
	return { channels, unavailable: false };
}

/** `spellkave_scene` → place and occupants (traces are not occupants). */
export function sceneFromPayload(
	payload: ToolPayload,
	selfActorId: string,
): { place: PlayPlace | null; occupants: PlayOccupant[] } {
	const details = toolDetails(payload);
	if (!isRecord(details) || details.scene_resolved === false) return { place: null, occupants: [] };
	const nodeId = str(details, "node_id");
	if (nodeId === "") return { place: null, occupants: [] };
	const exits: PlayExit[] = [];
	const occupants: PlayOccupant[] = [];
	for (const item of items(details.items)) {
		const kind = str(item, "kind");
		const handle = str(item, "handle");
		const rev = str(item, "rev");
		const id = str(item, "id");
		if (kind === "exit") {
			const to = str(item, "to") || null;
			const gates = Array.isArray(item.traversal_gates)
				? item.traversal_gates
						.filter(isRecord)
						.map((gate) => str(gate, "template_id"))
						.filter((gate) => gate !== "")
				: [];
			exits.push({
				handle,
				rev,
				label: str(item, "label"),
				to,
				...(str(item, "to_node_id") ? { toNodeId: str(item, "to_node_id") } : {}),
				toName: str(item, "to_name") || (to === null ? str(item, "label") : humaniseNodeId(to)),
				gates,
			});
			continue;
		}
		if (kind === "trace") continue;
		if (id === selfActorId) continue;
		const conditions = Array.isArray(item.conditions)
			? item.conditions.filter((entry): entry is string => typeof entry === "string")
			: [];
		const defId = str(item, "entity_def_id");
		occupants.push({
			...(artFromPayload(item.art) ? { art: artFromPayload(item.art) } : {}),
			id,
			handle,
			rev,
			kind: kind === "actor" ? occupantKindForActor(item) : "thing",
			sceneKind: kind,
			name: str(item, "label") || `${kind}:${id}`,
			conditions,
			note: occupantNote(kind, conditions),
			...(defId ? { defId } : {}),
		});
	}
	return {
		place: {
			id: nodeId,
			name: str(details, "node_display_name") || humaniseNodeId(nodeId),
			description: str(details, "node_description") || str(details, "graph_description"),
			exits,
			...(typeof details.pose_elevation === "number" && Number.isFinite(details.pose_elevation)
				? { elevation: details.pose_elevation }
				: {}),
			...(artFromPayload(details.art) ? { art: artFromPayload(details.art) } : {}),
		},
		occupants,
	};
}

/**
 * `spellkave_scene`'s actor listing carries no species/creature signal today
 * (verified against a live recorded payload, `play-view.test.ts`): the SDK
 * reader's own actor detail is `{entity_id, name, faction, description,
 * appearance, conditions}` (`packages/spellkave-sdk/src/core/readers/
 * scene.ts`'s `actorTargets`), and the PLAYER tool's listing narrows that
 * further to `{handle, rev, kind, id, label, conditions?}`
 * (`packages/spellkave-tool-player/src/tools.ts`'s `sceneListItem`) — no
 * `entity_kind`/`identity` field ever reaches this mapper, so Cellar Rat 1-3
 * still render as `person` in live play (sk-jay0.1.7 item 2, tool-contract
 * gap: `spellkave_scene` needs a creature/species cue on actor items, e.g.
 * the server-side niche tag `srd.creature` — `CREATURE_NICHE_TAG`,
 * `packages/spellkave-adventure-elven-mini/author/hero.ts`).
 *
 * Read the cue defensively anyway, mirroring `spellkave_self_summary`'s own
 * identity-tag vocabulary (`self.identity` carries `srd.creature` for a
 * creature's own body, `packages/spellkave-tool-player/src/tools.ts`'s
 * `selfSummaryToolDef`) — an `entity_kind`/`identity` field a future tool
 * version adds is picked up with no further client change; today's payload
 * carries neither, so this stays a no-op until the gap above is closed.
 */
function occupantKindForActor(item: Record<string, unknown>): PlayOccupantKind {
	if (item.entity_kind === "creature") return "creature";
	const identity = item.identity;
	if (Array.isArray(identity)) {
		const isCreature = identity.some((entry) => {
			const tag = typeof entry === "string" ? entry : isRecord(entry) ? entry.tag : undefined;
			return typeof tag === "string" && /creature/i.test(tag);
		});
		if (isCreature) return "creature";
	}
	return "person";
}

/** DM-internal bookkeeping conditions, never meant for player-facing prose
 * (the DM's own turn machinery, not a rules-facing SRD condition) — a
 * consumer that maps every condition to a label must drop these rather than
 * narrate the DM's plumbing to the player (sk-jay0.1.7 item 4). */
export const DM_INTERNAL_CONDITION_IDS: ReadonlySet<string> = new Set([
	"core/condition/controlled",
]);

/** The DM persona's own workflow namespace: character creation and level-up
 * put `dm/creation/drafting`, `dm/creation/pending/<field>` and
 * `dm/level-up/drafting` on the hero as ordinary conditions (authored in
 * `packages/spellkave-adventure-runtime/src/author/dm/`). They steer the
 * DM's dialogue; they are not conditions the hero has. */
const DM_WORKFLOW_CONDITION_PREFIX = "dm/";

/**
 * The one predicate every surface that lists or narrates a condition asks
 * (sk-jay0.1.8.96): the YOU tile (`heroFromSelfSummary`), the chronicle
 * (`playChronicleEntry`, play-chronicle.ts) and the fight roster chips
 * (`rosterConditions`, play-table.ts). True for the exact bookkeeping ids in
 * `DM_INTERNAL_CONDITION_IDS` and for every id in the DM's `dm/` workflow
 * namespace. An id-based stand-in until the world itself flags a condition
 * definition as bookkeeping.
 */
export function isDmInternalCondition(id: string): boolean {
	return DM_INTERNAL_CONDITION_IDS.has(id) || id.startsWith(DM_WORKFLOW_CONDITION_PREFIX);
}

/**
 * The condition ids that put a body down (sk-jay0.1.8.101 s2, owner decision
 * 2026-11-12): the SRD bundle's Unconscious, as the world sends it. Matched
 * by exact id, never by label. Naming an SRD id is fine at this layer (Play
 * is the SRD-aware consumer), the same posture `HP_RESOURCE_ID`
 * (play-chronicle.ts) takes. Lives here so both the Table's `downed` scene
 * fact (play-table.ts) and the chronicle's sentence (play-chronicle.ts) read
 * one set.
 */
export const DOWNED_CONDITION_IDS: ReadonlySet<string> = new Set(["srd/condition/unconscious"]);

const CONDITION_LABELS: Record<string, string> = {
	"srd/condition/dead": "Dead",
	"srd/condition/unconscious": "Unconscious",
	"srd/condition/prone": "Prone",
	"srd/condition/grappled": "Grappled",
	"srd/condition/restrained": "Restrained",
	"srd/condition/stunned": "Stunned",
	"srd/condition/paralyzed": "Paralyzed",
	"srd/condition/petrified": "Petrified",
	"srd/condition/poisoned": "Poisoned",
	"srd/condition/frightened": "Frightened",
	"srd/condition/charmed": "Charmed",
	"srd/condition/blinded": "Blinded",
	"srd/condition/deafened": "Deafened",
	"srd/condition/incapacitated": "Incapacitated",
	"srd/condition/invisible": "Invisible",
	"srd/condition/exhaustion": "Exhausted",
};

/** Condition id → short player-facing label. Falls back to humanising the
 * id's own trailing segment for a condition outside the closed vocabulary
 * above, so an unmapped id still never reaches the player raw. */
export function conditionLabel(id: string): string {
	return CONDITION_LABELS[id] ?? humaniseNodeId(id);
}

/**
 * One filter chip at the Chronicle's stage level (sk-jay0.1.8.13 task 3):
 * each world-event kind maps to a category without inspecting its prose.
 */
export type ChronicleFilterChip = "speech" | "fight" | "conditions" | "comings" | "things";

interface ChronicleKindRule {
	chip: ChronicleFilterChip;
	/** Card-level ("important") facts, newest first, capped — sk-jay0.1.8.13
	 * task 2. `false` still shows at the Chronicle's stage level, under its
	 * own chip; it only drops out of the card's short list. */
	important: boolean;
}

/**
 * How important a non-speech world-event kind is for the Chronicle card,
 * and which stage filter chip it falls under — one row per kind in the
 * CLOSED `WorldEvent` union (`@spellkave/world-events`), reviewed by the
 * operator (sk-jay0.1.8.13 task 2). The `Record` literal is exhaustive over
 * `WorldEvent["kind"]`, so a kind the substrate adds later fails to compile
 * here rather than silently falling through unclassified.
 *
 * The shape brief (`ledger/designs/play-zoomed-table.md`, "Chronicle half")
 * names five importance classes against a FUTURE, richer place-fact
 * vocabulary: arrivals/departures, damage/death, session open/close,
 * take/drop, world pull. The vocabulary the substrate actually emits today
 * gained a real DEPARTURE kind with the departure trace
 * (sk-jay0.1.23.35.4) and still has no arrival or take/drop kind — a
 * tool-contract gap, not something this table papers over with an invented
 * analogue: `session_lifecycle` stands in for BOTH "session open/close" and,
 * loosely, the arrival half of "comings and goings";
 * `reaction_window` opening is the closest real "world pull" — a window
 * that pulls the table's own focus to stage (`App.svelte`'s own reaction
 * priority); `self_resource_spent` (an ability-resource spend, e.g. a spell
 * slot — never an inventory item) is deliberately left NOT important, since
 * marking it so would misrepresent it as the take/drop fact it is not.
 * `speech_heard` is listed only for the `Record`'s own exhaustiveness — the
 * Chronicle never reaches this table for a speech event; every heard line
 * folds into a burst instead (`foldSpeechBursts`, play-chronicle.ts), and
 * `view.events` (this table's only input, via `chronicleFactsFromEvents`)
 * never carries a `speech_heard` entry (`play-session.ts` filters it out
 * before it reaches the chronicle ring).
 */
export const CHRONICLE_KIND_RULES: Record<WorldEvent["kind"], ChronicleKindRule> = {
	session_lifecycle: { chip: "comings", important: true },
	turn_transition: { chip: "fight", important: false },
	self_hit: { chip: "fight", important: true },
	dealt_hit: { chip: "fight", important: true },
	self_condition_changed: { chip: "conditions", important: true },
	dealt_condition: { chip: "conditions", important: true },
	xp_gained: { chip: "things", important: false },
	self_resource_spent: { chip: "things", important: false },
	reaction_window: { chip: "fight", important: true },
	advancement_available: { chip: "things", important: true },
	speech_heard: { chip: "speech", important: true },
	// A companion command is a table-facing signal, not a fight or a thing:
	// it belongs with speech, the chip the player already reads for "someone
	// said something to someone". Not important — the player who issued it
	// already saw their own act's result, and a bystander's card should not
	// be dominated by another table's traffic.
	trace_addressed: { chip: "speech", important: false },
	// The first REAL coming-and-going fact this table has had. Not important:
	// every traverse by every body in the room inscribes one, so marking them
	// important would flood the card with foot traffic and bury the facts the
	// five importance classes exist to raise.
	trace_departure: { chip: "comings", important: false },
};

/**
 * Human label for each Chronicle filter chip — the exact wording
 * PlayTable uses these same labels for its filters and event stream lines.
 */
export const CHRONICLE_CHIP_LABELS: Record<ChronicleFilterChip, string> = {
	speech: "Speech",
	fight: "Fight",
	conditions: "Conditions",
	comings: "Comings and goings",
	things: "Things",
};

/**
 * `CHRONICLE_KIND_RULES` keyed by a `PlayChronicleEntry.kind` string. That
 * field types as the closed `WorldEvent["kind"]` union only at its SOURCE
 * (`playChronicleEntry`, play-chronicle.ts); once it reaches a
 * `PlayChronicleEntry` it is a plain `string`, and a fixture is free to
 * author any value (`apps/play/src/test/sample-view.ts` does, deliberately,
 * for a kind the live substrate does not ship). An unrecognized kind falls
 * back to the "Things" chip, not important — visible at the Chronicle's
 * stage level, never at card, never a crash.
 */
export function chronicleKindRule(kind: string): ChronicleKindRule {
	return (
		(CHRONICLE_KIND_RULES as Record<string, ChronicleKindRule>)[kind] ?? {
			chip: "things",
			important: false,
		}
	);
}

/** The shipped SRD bundle's own equipment slot ids
 * (`packages/spellkave-srd-cc/src/chapters/equipment/index.ts`,
 * `verb-runner-observability.test.ts`). Falls back to humanising an
 * unrecognized slot id's trailing segment, mirroring `conditionLabel`. */
const SLOT_LABELS: Record<string, string> = {
	"srd/slot/chest": "Chest",
	"srd/slot/main-hand": "Main Hand",
	"srd/slot/off-hand": "Off Hand",
};

/** Equipment slot id → short player-facing label. Pack rows and item detail
 * showed the raw id (`srd/slot/main-hand`, uppercased by the `sk-label`
 * style into `SRD/SLOT/MAIN-HAND`) instead of a label (sk-jay0.1.8.11 item
 * 4, co-play live-14-pack.png). */
export function slotLabel(id: string): string {
	return SLOT_LABELS[id] ?? humaniseNodeId(id);
}

function occupantNote(kind: string, conditions: string[]): string {
	if (conditions.some((id) => /\/dead$/.test(id))) return "Dead";
	const shown = conditions.filter((id) => !isDmInternalCondition(id));
	if (shown.length > 0) return shown.map((id) => conditionLabel(id)).join(" · ");
	return kind === "actor" ? "Here with you" : "Something here";
}

function actionLabel(displayName: string, targetName: string, descriptor: string): string {
	const name = displayName || humaniseNodeId(descriptor);
	if (name !== "" && targetName !== "" && !name.toLowerCase().includes(targetName.toLowerCase())) {
		return `${name} — ${targetName}`;
	}
	return name || targetName;
}

/**
 * Replay-only normalization for old recorded PlayViews. Live discovery uses
 * the authored `accepts_utterance` fact directly in
 * `actionsFromManipulationContext`; it never guesses from action names.
 * `play-recording.ts` retains this fallback for checked-in historical scenes.
 */
export function actionAcceptsUtterance(
	verb: string,
	descriptor: string,
	displayName: string,
): boolean {
	if (/^srd\/(speak-to|speak-aloud|speak)/.test(descriptor)) return true;
	if (verb !== "communicate") return false;
	return /^(say|speak)\b/i.test(displayName);
}

function inputFromRow(row: Record<string, unknown>): { input?: PlayActionInput } {
	const source = row.input;
	if (!isRecord(source) || !Array.isArray(source.fields)) return {};
	const fields: PlayActionInputField[] = [];
	for (const value of source.fields) {
		if (!isRecord(value)) return {};
		const name = str(value, "name");
		const label = str(value, "label");
		const control = str(value, "control");
		if (
			name === "" ||
			label === "" ||
			(control !== "text" && control !== "textarea" && control !== "number")
		)
			return {};
		fields.push({
			name,
			label,
			control,
			...(str(value, "placeholder") ? { placeholder: str(value, "placeholder") } : {}),
			...(value.required === true ? { required: true } : {}),
			...(num(value, "min") === undefined ? {} : { min: num(value, "min") }),
			...(num(value, "max") === undefined ? {} : { max: num(value, "max") }),
			...(num(value, "maxLength") === undefined ? {} : { maxLength: num(value, "maxLength") }),
			...(value.channel === "utterance" || value.channel === "args_json"
				? { channel: value.channel }
				: {}),
		});
	}
	if (new Set(fields.map((field) => field.name)).size !== fields.length) return {};
	return {
		input: {
			fields,
			...(str(source, "submitLabel") ? { submitLabel: str(source, "submitLabel") } : {}),
		},
	};
}

/** The hero's own target row: "You (Brannoch)", or "You" while the hero has
 * no name of its own yet (during creation the summary's name is empty and
 * `heroFromSelfSummary` falls back to the raw actor id). */
export function selfTargetLabel(heroName: string): string {
	const name = heroName.trim();
	return name === "" || /^\d+$/.test(name) ? "You" : `You (${name})`;
}

/** `spellkave_manipulation_context` → action and target facts, without
 * rebuilding any action × target pairs. Target display names are resolved from
 * the already-authorized Play scene and pack payloads only. */
export function manipulationContextFromPayload(
	payload: ToolPayload,
	context: Pick<PlayView, "place" | "occupants" | "pack"> & {
		/** The controlled hero's own entity id and name. The hero is never one
		 * of its own `occupants` (`sceneFromPayload` skips the self actor), so
		 * without this its target ref had no name at all (sk-jay0.1.8.92).
		 * Optional: a caller that does not know the hero still never shows a
		 * raw ref (`playerTargetName`, player-copy.ts). */
		self?: { entityId: string; name: string };
	},
): PlayManipulationContext {
	const details = toolDetails(payload);
	const raw =
		isRecord(details) && isRecord(details.manipulation_context)
			? details.manipulation_context
			: null;
	if (raw === null || raw.status !== "ready") return { status: "unavailable" };

	const names = new Map<string, string>();
	if (context.place) {
		names.set(`place_node:${context.place.id}`, context.place.name);
		for (const exit of context.place.exits) {
			if (exit.toNodeId) names.set(`place_node:${exit.toNodeId}`, exit.toName);
		}
	}
	for (const occupant of context.occupants) names.set(`entity:${occupant.id}`, occupant.name);
	for (const item of context.pack) {
		names.set(`entity:${item.id}`, item.name);
		names.set(`item:${item.id}`, item.name);
	}
	// Last, so the hero's own ref always reads as the hero, whatever an
	// occupant or pack row with the same id said.
	if (context.self !== undefined && context.self.entityId !== "")
		names.set(`entity:${context.self.entityId}`, selfTargetLabel(context.self.name));

	return {
		status: "ready",
		schemaVersion: num(raw, "schema_version") ?? 0,
		revision: num(raw, "revision") ?? 0,
		actions: (Array.isArray(raw.actions) ? raw.actions.filter(isRecord) : [])
			.map((row) => ({
				actionId: str(row, "action_id"),
				displayName: str(row, "display_name"),
				...(str(row, "description") ? { description: str(row, "description") } : {}),
				...(Array.isArray(row.groups)
					? { groups: row.groups.filter((group): group is string => typeof group === "string") }
					: {}),
				...(Array.isArray(row.template_ids)
					? { templateIds: row.template_ids.filter((id): id is string => typeof id === "string") }
					: {}),
				...(typeof row.accepts_utterance === "boolean"
					? { acceptsUtterance: row.accepts_utterance }
					: {}),
				...inputFromRow(row),
				...(str(row, "definition_ref") ? { definitionRef: str(row, "definition_ref") } : {}),
				...(isRecord(row.cue)
					? {
							cue: {
								...(typeof row.cue.rank === "number" ? { rank: row.cue.rank } : {}),
								...(str(row.cue, "hint") ? { hint: str(row.cue, "hint") } : {}),
							},
						}
					: {}),
				...(isRecord(row.defaults) && isRecord(row.defaults.provenance)
					? {
							defaults: {
								...(isRecord(row.defaults.target) &&
								str(row.defaults.target, "target_ref") &&
								(row.defaults.target.kind === "actor" || row.defaults.target.kind === "reference")
									? {
											target: {
												targetRef: str(row.defaults.target, "target_ref"),
												kind: row.defaults.target.kind as "actor" | "reference",
											},
										}
									: {}),
								...(scalarInputValues(row.defaults.input_values) !== undefined
									? {
											inputValues: scalarInputValues(row.defaults.input_values),
										}
									: {}),
								provenance: {
									namespace: str(row.defaults.provenance, "namespace"),
									templateId: str(row.defaults.provenance, "template_id"),
									attachmentId: str(row.defaults.provenance, "attachment_id"),
									contentKey: str(row.defaults.provenance, "content_key"),
								},
							},
						}
					: {}),
				...(str(row, "communication_speech_act_id") === ""
					? {}
					: { communicationSpeechActId: str(row, "communication_speech_act_id") }),
				...(num(row, "response_slot") === undefined
					? {}
					: { responseSlot: num(row, "response_slot") }),
				tags: Array.isArray(row.tags)
					? row.tags.filter((tag): tag is string => typeof tag === "string")
					: [],
				nicheRequirements: (Array.isArray(row.niche_requirements)
					? row.niche_requirements.filter(isRecord)
					: []
				).map((requirement) => ({
					niche_id: str(requirement, "niche_id"),
					requires_spatial_attachment: requirement.requires_spatial_attachment !== false,
					admits_targets_without_membership: requirement.admits_targets_without_membership === true,
				})),
				selfOnly: row.self_only === true,
				selfEligible: row.self_eligible === true,
			}))
			.filter((action) => action.actionId !== ""),
		targets: (Array.isArray(raw.targets) ? raw.targets.filter(isRecord) : [])
			.map((row) => {
				const targetRef = str(row, "target_ref");
				return {
					targetFactId: str(row, "target_fact_id"),
					targetRef,
					// A target ref (`entity:168`, `place_node:inn/stairs`) is an
					// identity, never a label: a target Play has no authorized name
					// for gets a neutral one (sk-jay0.1.8.92, sk-jay0.1.70).
					targetName: playerTargetName(names.get(targetRef), targetRef),
					nicheIds: Array.isArray(row.niche_ids)
						? row.niche_ids.filter((id): id is string => typeof id === "string")
						: [],
					...(num(row, "response_slot") === undefined
						? {}
						: { responseSlot: num(row, "response_slot") }),
					tags: Array.isArray(row.tags)
						? row.tags.filter((tag): tag is string => typeof tag === "string")
						: [],
				};
			})
			.filter((target) => target.targetFactId !== "" && target.targetRef !== ""),
		participants: (Array.isArray(raw.participants) ? raw.participants.filter(isRecord) : [])
			.map((row) => ({
				contextId: str(row, "context_id"),
				actionId: str(row, "action_id"),
				bindingCount: num(row, "binding_count") ?? 0,
				bindings: (Array.isArray(row.bindings) ? row.bindings.filter(isRecord) : [])
					.map((binding) => ({
						roleId: str(binding, "role_id"),
						entityId: str(binding, "entity_id"),
					}))
					.filter((binding) => binding.roleId !== "" && binding.entityId !== ""),
			}))
			.filter((participant) => participant.contextId !== "" && participant.actionId !== ""),
		prompts: (Array.isArray(raw.prompts) ? raw.prompts.filter(isRecord) : [])
			.map((row) => ({
				occurrenceId: str(row, "occurrence_id"),
				promptDefId: str(row, "prompt_def_id"),
				contractVersion: num(row, "contract_version") ?? 0,
				sourceRef: str(row, "source_ref"),
				responseActionIds: Array.isArray(row.response_action_ids)
					? row.response_action_ids.filter((id): id is string => typeof id === "string")
					: [],
				openedAtTick: num(row, "opened_at_tick") ?? 0,
				consumed: row.consumed === true,
				...(isRecord(row.presentation)
					? {
							presentation: {
								...(str(row.presentation, "question")
									? { question: str(row.presentation, "question") }
									: {}),
								...(parseDialogueGuide(row.presentation.guide)
									? { guide: parseDialogueGuide(row.presentation.guide) }
									: {}),
								...(isRecord(row.presentation.response_refs)
									? {
											responseRefs: Object.fromEntries(
												Object.entries(row.presentation.response_refs).filter(
													(entry): entry is [string, string] => typeof entry[1] === "string",
												),
											),
										}
									: {}),
								labels: Object.entries(
									isRecord(row.presentation.labels) ? row.presentation.labels : {},
								).reduce<Record<string, string>>((labels, [actionId, label]) => {
									if (actionId !== "" && typeof label === "string" && label !== "")
										labels[actionId] = label;
									return labels;
								}, {}),
							},
						}
					: {}),
			}))
			.filter(
				(prompt) =>
					prompt.occurrenceId !== "" &&
					prompt.promptDefId !== "" &&
					prompt.sourceRef !== "" &&
					prompt.responseActionIds.length > 0,
			),
	};
}

/**
 * Play's presentation candidates from ADR-0140's independent facts. This is
 * a local heuristic, not an authority claim: each direct pair is still
 * checked by the reducer.
 */
function playActionFromFacts(
	action: PlayManipulationAction,
	target: PlayManipulationTarget,
	provider: PlayActionProvider,
): PlayAction | null {
	const speechActId = action.communicationSpeechActId;
	const groups = [
		...new Set([...(action.groups ?? []), ...action.tags].filter((tag) => tag.length > 0)),
	];
	const label = actionLabel(action.displayName, target.targetName, action.actionId);
	if (label === "") return null;
	const candidate: PlayAction = {
		actionId: action.actionId,
		id: `factored:${action.actionId}:${target.targetFactId}`,
		label,
		name: action.displayName,
		...(action.description ? { description: action.description } : {}),
		verb: speechActId === undefined ? "manipulate" : "communicate",
		descriptor: speechActId ?? action.actionId,
		targetName: target.targetName,
		targetRef: target.targetRef,
		acceptsUtterance: action.acceptsUtterance === true,
		...(action.input === undefined ? {} : { input: action.input }),
		...(action.definitionRef ? { infoRef: `def:${action.definitionRef}` } : {}),
		provider,
		...(groups.includes("combat") ? { group: "combat" } : groups[0] ? { group: groups[0] } : {}),
		...(groups.length === 0 ? {} : { groups }),
	};
	if (action.responseSlot !== undefined) candidate.slot = action.responseSlot;
	return candidate;
}

function targetFitsNiches(action: PlayManipulationAction, target: PlayManipulationTarget): boolean {
	const requirements = action.nicheRequirements ?? [];
	if (requirements.length === 0) return true;
	if (requirements.some((requirement) => requirement.admits_targets_without_membership))
		return true;
	const needed = requirements.filter((requirement) => requirement.requires_spatial_attachment);
	if (needed.length === 0) return true;
	const niches = new Set(target.nicheIds ?? []);
	return needed.every((requirement) => niches.has(requirement.niche_id));
}

/**
 * Play's presentation candidates from ADR-0140's independent facts. This is
 * a local heuristic, not an authority claim: each direct pair is still
 * checked by the reducer. Self verbs stay on ME (`provider: "actor"`); entity
 * inspect/attack pairs are not exploded here — selection joins them.
 * Communication speech acts still attach to disclosed entity targets (dialogue).
 */
export function actionsFromManipulationContext(
	context: PlayManipulationContext,
	selfEntityId?: string,
): {
	actions: PlayAction[];
	total: number;
} {
	if (context.status !== "ready") return { actions: [], total: 0 };
	const actions: PlayAction[] = [];
	const selfRef = selfEntityId === undefined ? undefined : `entity:${selfEntityId}`;
	const selfTarget =
		selfRef === undefined
			? undefined
			: (context.targets.find((target) => target.targetRef === selfRef) ?? {
					targetFactId: `self:${selfEntityId}`,
					targetRef: selfRef,
					targetName: "you",
					tags: [],
					nicheIds: [],
				});
	for (const action of context.actions) {
		if (action.selfOnly && !action.selfEligible) continue;
		if (action.selfEligible || action.selfOnly) {
			if (selfTarget === undefined) continue;
			const candidate = playActionFromFacts(action, selfTarget, "actor");
			if (candidate !== null) actions.push(candidate);
			continue;
		}
		const attachToEntities = action.communicationSpeechActId !== undefined;
		for (const target of context.targets) {
			if (target.targetRef.startsWith("entity:") && !attachToEntities) continue;
			if (!targetFitsNiches(action, target)) continue;
			const provider: PlayActionProvider = target.targetRef.startsWith("entity:")
				? "entity"
				: "place";
			const candidate = playActionFromFacts(action, target, provider);
			if (candidate !== null) actions.push(candidate);
		}
	}
	return { actions, total: actions.length };
}

/** Join disclosed non-self actions onto one selected entity (pack or occupant). */
export function actionsForDisclosedEntity(
	context: PlayManipulationContext,
	entityId: string,
): PlayAction[] {
	if (context.status !== "ready") return [];
	const refs = new Set([`entity:${entityId}`, `item:${entityId}`]);
	const targets = context.targets.filter((target) => refs.has(target.targetRef));
	if (targets.length === 0) return [];
	const out: PlayAction[] = [];
	for (const action of context.actions) {
		if (action.selfOnly || action.selfEligible) continue;
		for (const target of targets) {
			if (!targetFitsNiches(action, target)) continue;
			const candidate = playActionFromFacts(action, target, "entity");
			if (candidate !== null) out.push(candidate);
		}
	}
	return out;
}

/** Join actions where the selected entity is a participant binding, not the target. */
export function actionsForParticipatingEntity(
	context: PlayManipulationContext,
	entityId: string,
): PlayAction[] {
	if (context.status !== "ready") return [];
	const actionIds = new Set(
		context.participants
			.filter((participant) =>
				participant.bindings.some((binding) => binding.entityId === entityId),
			)
			.map((participant) => participant.actionId),
	);
	if (actionIds.size === 0) return [];
	const out: PlayAction[] = [];
	for (const action of context.actions) {
		if (!actionIds.has(action.actionId)) continue;
		for (const target of context.targets) {
			if (!targetFitsNiches(action, target)) continue;
			const candidate = playActionFromFacts(action, target, "entity");
			if (candidate !== null) out.push(candidate);
		}
	}
	return out;
}

/** `spellkave_sense_context` → direct sensing candidates, not cache rows. */
export function senseContextFromPayload(payload: ToolPayload): PlaySenseContext {
	const details = toolDetails(payload);
	const raw = isRecord(details) && isRecord(details.sense_context) ? details.sense_context : null;
	if (raw === null || raw.status !== "ready") return { status: "unavailable" };
	return {
		status: "ready",
		queries: (Array.isArray(raw.queries) ? raw.queries.filter(isRecord) : [])
			.map((query) => ({
				queryKind: str(query, "query_kind"),
				visibility: str(query, "visibility"),
				displayName: str(query, "display_name"),
				outcomeTemplateId: str(query, "outcome_template_id"),
			}))
			.filter((query) => query.queryKind !== "" && query.visibility !== ""),
	};
}

/** Local direct sensing actions from factual query syntax. */
export function actionsFromSenseContext(context: PlaySenseContext): PlayAction[] {
	if (context.status !== "ready") return [];
	return context.queries.map((query) => ({
		id: `sense:${query.queryKind}:${query.visibility}`,
		label: query.displayName || query.queryKind,
		verb: "sensing",
		descriptor: query.queryKind,
		targetName: "here",
		targetRef: "world",
		acceptsUtterance: false,
		senseVisibility: query.visibility,
		provider: "place",
	}));
}

/** `spellkave_session_status` → turn state. Names resolve through the scene. */
export function sessionFromPayload(
	payload: ToolPayload,
	selfActorId: string,
	nameOf: (actorId: string) => string,
): PlaySessionState {
	const details = toolDetails(payload);
	const empty: PlaySessionState = {
		inSession: false,
		myTurn: false,
		lifecycle: null,
		currentActor: null,
		currentActorName: null,
		roster: [],
	};
	if (!isRecord(details)) return empty;
	const session = isRecord(details.session) ? details.session : details;
	if (session.session_id === undefined && session.in_session !== true) return empty;
	const currentActor = str(session, "current_actor") || null;
	const roster = items(session.roster)
		.map((row) => {
			const actorId = str(row, "actor_id");
			return {
				actorId,
				// The SDK names a participant it can see; the scene-derived map is
				// the fallback (a fight on a session grid lists no occupants).
				name: str(row, "name") || nameOf(actorId),
				ordinal: num(row, "ordinal") ?? 0,
				isMe: actorId === selfActorId,
				isCurrent: actorId === currentActor,
			};
		})
		.sort((a, b) => a.ordinal - b.ordinal);
	return {
		inSession: true,
		id: str(session, "session_id") || undefined,
		myTurn: session.my_turn === true,
		lifecycle: str(session, "lifecycle") || null,
		currentActor,
		currentActorName:
			currentActor === null
				? null
				: (roster.find((entry) => entry.actorId === currentActor)?.name ?? nameOf(currentActor)),
		roster,
	};
}

/** First open reaction or intervention window, if any. */
export function reactionFromPayloads(
	reactionPayload: ToolPayload,
	interventionPayload: ToolPayload,
	nameOf: (actorId: string) => string,
): PlayReaction | null {
	const reactionDetails = toolDetails(reactionPayload);
	const reactions = isRecord(reactionDetails) ? items(reactionDetails.items) : [];
	const reactionRev = isRecord(reactionDetails) ? str(reactionDetails, "rev") : "";
	const first = reactions[0];
	if (first !== undefined) {
		const actor = str(first, "originating_actor") || null;
		return {
			windowKind: "reaction",
			handle: str(first, "handle"),
			rev: str(first, "rev") || reactionRev,
			originatingActionId: str(first, "originating_action_id"),
			originatingActor: actor,
			originatingActorName: actor === null ? null : nameOf(actor),
			remainingMs: num(first, "remaining_ms") ?? null,
			faces: Array.isArray(first.faces) ? first.faces : [],
		};
	}
	const interventionDetails = toolDetails(interventionPayload);
	const windows = isRecord(interventionDetails) ? items(interventionDetails.items) : [];
	const interventionRev = isRecord(interventionDetails) ? str(interventionDetails, "rev") : "";
	const window = windows[0];
	if (window === undefined) return null;
	const actor = str(window, "originating_actor") || null;
	return {
		windowKind: "intervention",
		handle: str(window, "handle"),
		rev: str(window, "rev") || interventionRev,
		originatingActionId: str(window, "originating_action_id"),
		originatingActor: actor,
		originatingActorName: actor === null ? null : nameOf(actor),
		remainingMs: num(window, "remaining_ms") ?? null,
		faces: Array.isArray(window.faces) ? window.faces : [],
	};
}

/** `spellkave_inventory` (complete or paginated) → pack items, flattened. */
export function packFromPayload(payload: ToolPayload): PlayPackItem[] {
	const details = toolDetails(payload);
	const out: PlayPackItem[] = [];
	const walk = (rows: unknown, depth: number): void => {
		for (const row of items(rows)) {
			const id = str(row, "entity_id") || str(row, "id") || str(row, "handle");
			const name = str(row, "name") || str(row, "display_name");
			if (id === "" && name === "") continue;
			const quantity = num(row, "quantity") ?? 1;
			// No bare kind word as the lead line (sk-jay0.1.8.102): the row's
			// generic entity kind ("item") is not a description, and Pack prints
			// `detail` as prose under the name. Only a real description, or the
			// one structural fact this walk knows by itself, is shown.
			const containment = depth > 0 ? "carried inside" : "";
			const equippedSlotId = str(row, "equipped_slot") || str(row, "slot");
			out.push({
				id: id || name,
				name: name || id,
				detail: str(row, "description") || containment,
				quantity,
				equipped: equippedSlotId === "" ? null : slotLabel(equippedSlotId),
				depth,
				handle: str(row, "handle"),
				rev: str(row, "rev"),
			});
			if (Array.isArray(row.contents) || Array.isArray(row.children)) {
				walk(row.contents ?? row.children, depth + 1);
			}
		}
	};
	walk(details, 0);
	return out;
}

/** `spellkave_scene_detail` → authorized fields for a selected scene target. */
export function occupantDetailFromPayload(
	payload: ToolPayload,
	selection: { id: string; handle: string; rev: string },
): Omit<PlayOccupantDetail, "verbs"> | null {
	const details = toolDetails(payload);
	if (!isRecord(details) || details.status !== "ok" || !isRecord(details.target)) return null;
	const target = details.target;
	const detail = isRecord(target.detail) ? target.detail : {};
	const entityId = str(target, "id") || str(detail, "entity_id");
	const facts: PlayItemStateFacet[] = [];
	const appearance = str(detail, "appearance");
	if (appearance) facts.push({ id: "appearance", label: "Appearance", value: appearance });
	const faction = str(detail, "faction");
	if (faction) facts.push({ id: "faction", label: "Faction", value: faction });
	const quantity = num(detail, "quantity");
	// "Quantity: 1" on a hearth or a person says nothing; only a stack counts.
	if (quantity !== undefined && quantity > 1)
		facts.push({ id: "quantity", label: "Quantity", value: String(quantity) });
	const conditions = Array.isArray(detail.conditions) ? detail.conditions.filter(isRecord) : [];
	for (const row of conditions) {
		const id = str(row, "condition_definition_id");
		if (id === "" || isDmInternalCondition(id)) continue;
		const stack = num(row, "stack_count");
		const expires = num(row, "expires_at_tick");
		const parts = [conditionLabel(id)];
		if (stack !== undefined && stack > 1) parts.push(`×${stack}`);
		if (expires !== undefined) parts.push(`until tick ${expires}`);
		facts.push({ id, label: "Condition", value: parts.join(" · ") });
	}
	const defId = str(detail, "entity_def_id");
	const contents = isRecord(detail.contents) ? detail.contents : undefined;
	return {
		id: selection.id,
		handle: str(details, "handle") || selection.handle,
		rev: str(details, "rev") || selection.rev,
		...(entityId ? { entityId } : {}),
		...(defId ? { defId } : {}),
		...(artFromPayload(detail.art) || artFromPayload(target.art)
			? { art: artFromPayload(detail.art) ?? artFromPayload(target.art) }
			: {}),
		...(str(detail, "description") ? { description: str(detail, "description") } : {}),
		...(contents &&
		["available", "empty", "unavailable", "truncated"].includes(str(contents, "status"))
			? {
					contents: {
						container_ref: str(contents, "container_ref"),
						scope: "direct" as const,
						revision: str(contents, "revision"),
						status: str(contents, "status") as ObservedContainerContents["status"],
						items: Array.isArray(contents.items)
							? contents.items.filter(isRecord).map((item) => ({
									target_ref: str(item, "target_ref"),
									parent_ref: str(item, "parent_ref"),
									name: str(item, "name"),
									quantity: num(item, "quantity") ?? 0,
									entity_def_id: str(item, "entity_def_id"),
								}))
							: [],
					},
				}
			: {}),
		facts,
	};
}

/** `spellkave_item_detail` → the sheet-facing item facts, minus verbs (a
 * selection of locally composed direct candidates) — `null` on
 * `item_unavailable` or a malformed payload, never a
 * half-built detail. */
/**
 * A raw state id's trailing `_<unit>` token, for the small set of
 * measurement units already grounded in the shipped SRD content package
 * (`srd/reach_mm`, `srd/attack_range_mm`,
 * `packages/spellkave-srd-cc/src/chapters/playing-the-game/`) — `mm` is the
 * one verified case; the rest are the same SI/imperial units the SRD's own
 * item stat blocks use, added defensively (the same "read the cue, no-op
 * until it exists" discipline as `MASTERY_CAPABILITY_HINT` above), never a
 * unit this mapper invents a MEANING for.
 */
const FACT_UNIT_SUFFIXES: ReadonlySet<string> = new Set(["mm", "cm", "g", "kg", "ft", "lb"]);

/** `srd/weight_g` → `{ label: "Weight", unit: "g" }`. No recognized trailing
 * unit token ⇒ `humaniseNodeId` alone, unit `null` — leaves e.g. `srd/damage`
 * (a dice-notation value like `1d8`, not a measurement) untouched. */
function splitFactUnit(stateId: string): { label: string; unit: string | null } {
	const stem = stateId.split("/").pop() ?? stateId;
	const parts = stem.split("_");
	const last = parts.at(-1)?.toLowerCase() ?? "";
	if (parts.length < 2 || !FACT_UNIT_SUFFIXES.has(last)) {
		return { label: humaniseNodeId(stateId), unit: null };
	}
	return { label: humaniseNodeId(parts.slice(0, -1).join("_")), unit: last };
}

/** A recognized unit ⇒ the reported number, thousands-separated, with the
 * unit appended (`"1360"` + `"g"` → `"1,360 g"`); a non-numeric value (or no
 * recognized unit) passes through exactly as reported — never reformatted
 * into something the world did not say. */
function formatFactValue(rawValue: string, unit: string | null): string {
	const value = untagFactValue(rawValue);
	if (unit === null) return value;
	const numeric = Number(value);
	return Number.isFinite(numeric) ? `${numeric.toLocaleString("en-US")} ${unit}` : value;
}

/** A state value can arrive as the substrate's tagged JSON (`{"tag":"Int",
 * "value":"3000"}`) rather than the bare scalar. The player never reads the
 * tag; unwrap it. Anything that is not that exact shape passes through. */
function untagFactValue(rawValue: string): string {
	const trimmed = rawValue.trim();
	if (!trimmed.startsWith("{")) return rawValue;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (isRecord(parsed) && typeof parsed.tag === "string" && "value" in parsed) {
			const inner = parsed.value;
			if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") {
				return String(inner);
			}
		}
	} catch {
		// Not JSON: an ordinary authored string.
	}
	return rawValue;
}

/** Authored unit phrases in a fact's display name ("Cost (copper)",
 * "Weight (tenths of a pound)") name a storage unit, not a player unit.
 * Present the two the SRD ships in the player's terms; anything else is
 * left exactly as authored. */
function presentAuthoredUnit(label: string, value: string): { label: string; value: string } {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return { label, value };
	const copper = /^(.*?)\s*\((?:copper|cp)\)\s*$/i.exec(label);
	if (copper !== null) return { label: copper[1] ?? label, value: formatCoins(numeric) };
	const tenths = /^(.*?)\s*\(tenths? of a pound\)\s*$/i.exec(label);
	if (tenths !== null) {
		const pounds = numeric / 10;
		return {
			label: tenths[1] ?? label,
			value: `${Number.isInteger(pounds) ? pounds : pounds.toFixed(1)} lb`,
		};
	}
	return { label, value };
}

/** 3000 copper → "30 gp"; 1250 → "12 gp 5 sp"; 7 → "7 cp". */
function formatCoins(copper: number): string {
	const gp = Math.floor(copper / 100);
	const sp = Math.floor((copper % 100) / 10);
	const cp = copper % 10;
	const parts = [
		gp > 0 ? `${gp} gp` : "",
		sp > 0 ? `${sp} sp` : "",
		cp > 0 ? `${cp} cp` : "",
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" ") : "0 cp";
}

export function itemDetailFromPayload(payload: ToolPayload): Omit<PlayItemDetail, "verbs"> | null {
	const details = toolDetails(payload);
	if (!isRecord(details) || details.status !== "ok" || !isRecord(details.item)) return null;
	const item = details.item;
	const id = str(item, "entity_id");
	if (id === "") return null;
	const equipment = isRecord(item.equipment) ? item.equipment : null;
	const slotLabelText = equipment === null ? "" : str(equipment, "slot_label");
	const slotId = equipment === null ? "" : str(equipment, "slot_id");
	const slot = slotLabelText || (slotId === "" ? null : slotLabel(slotId));
	const facts = items(item.states)
		.map((row) => {
			const stateId = str(row, "state_id");
			if (stateId === "") return null;
			const { label, unit } = splitFactUnit(stateId);
			const presented = presentAuthoredUnit(
				str(row, "display_name") || label,
				formatFactValue(str(row, "value"), unit),
			);
			return { id: stateId, label: presented.label, value: presented.value };
		})
		.filter((row): row is PlayItemStateFacet => row !== null);
	return {
		id,
		...(str(item, "entity_def_id") ? { definitionRef: str(item, "entity_def_id") } : {}),
		suppliedFields: items(item.states).length + (str(item, "description") ? 1 : 0) + (slot ? 1 : 0),
		...(artFromPayload(item.art) ? { art: artFromPayload(item.art) } : {}),
		...(str(item, "description") ? { description: str(item, "description") } : {}),
		kind: humaniseNodeId(str(item, "kind")),
		slot,
		facts,
	};
}

/**
 * `speech_heard` world events → dialogue lines, keyed so a later merge
 * (`mergeSpeech`) can dedupe by trace id across this live path and the
 * trace backfill below — same id shape as `speechFromTraceDetail`'s
 * (`speech:<trace id>`), never a per-call sequence number (the previous
 * `speech:<trace id>:<seq>` id made every live event its own line even when
 * the same trace had already arrived via backfill — sk-jay0.1.8.12).
 *
 * A line with empty world-authored text and no dialog-choice `action_id` is
 * dropped (the DM's own quiet bookkeeping, nothing to show); one with a
 * dialog-choice `action_id` is kept even with empty text — `choiceSlot`
 * marks it. Without an occurrence link, empty choice text remains neutral.
 *
 * `knownSpeakerNames` (sk-jay0.1.8.96 s8, owner decision 2026-11-12): the
 * world names a speaker only while the hearer perceives them, so a line
 * heard just after leaving arrives unnamed. When the event carries no name,
 * a name Play already learned for that speaker id this visit is shown
 * instead; an id it never learned stays "Someone". The world's own name
 * always wins. Speakers only: no other event kind reads this map.
 */
export function speechFromEvents(
	events: readonly WorldEvent[],
	selfActorId: string,
	knownSpeakerNames?: ReadonlyMap<string, string>,
): PlaySpeech[] {
	const lines: PlaySpeech[] = [];
	for (const event of events) {
		if (event.kind !== "speech_heard") continue;
		const slot = event.response?.slot;
		if (event.text === "" && slot === undefined) continue;
		const speakerId = event.inscribed_by;
		const line: PlaySpeech = {
			id: `speech:${event.trace_id}`,
			tick: event.observed_at_tick,
			speakerId,
			speaker:
				event.inscribed_by_name ??
				(speakerId === null ? undefined : knownSpeakerNames?.get(speakerId)) ??
				"Someone",
			text: event.text || event.response?.label || "",
			mine: speakerId !== null && speakerId === selfActorId,
		};
		if (slot !== undefined) line.choiceSlot = slot;
		// Optional world-supplied addressee information is display-only.
		const withAddressee = event as SpeechHeardEvent & {
			addressee?: number | null;
			addressee_name?: string | null;
		};
		if (withAddressee.addressee !== undefined && withAddressee.addressee !== null) {
			line.addressee = withAddressee.addressee;
		}
		if (typeof withAddressee.addressee_name === "string" && withAddressee.addressee_name !== "") {
			line.addresseeName = withAddressee.addressee_name;
		}
		lines.push(line);
	}
	return lines;
}

/**
 * `speechFromEvents` over one drained batch, with the visit's speaker memory
 * applied and grown in ONE pass in event order: each line is resolved from
 * what `known` held before it, and only then is its own name learned. So an
 * unnamed line never takes a name the world first gave in a LATER event of
 * the same batch (the world withheld it at that moment); it stays "Someone".
 */
export function speechFromEventsRemembering(
	events: readonly WorldEvent[],
	selfActorId: string,
	known: Map<string, string>,
): PlaySpeech[] {
	const lines: PlaySpeech[] = [];
	for (const event of events) {
		if (event.kind !== "speech_heard") continue;
		lines.push(...speechFromEvents([event], selfActorId, known));
		learnSpeakerNames([event], known);
	}
	return lines;
}

/**
 * Adds every speaker name these `speech_heard` events carry to `known`
 * (speaker id to name), newest name winning. `play-session.ts` keeps the map
 * for the visit; `speechFromEventsRemembering` is how it reads and grows it.
 */
export function learnSpeakerNames(events: readonly WorldEvent[], known: Map<string, string>): void {
	for (const event of events) {
		if (event.kind !== "speech_heard" || event.inscribed_by === null) continue;
		const name = event.inscribed_by_name;
		if (typeof name === "string" && name !== "") known.set(event.inscribed_by, name);
	}
}

export const PLAY_SPEECH_LIMIT = 40;

/**
 * The one world-ordered speech stream (sk-jay0.1.8.12, operator decision
 * D1): merges freshly-read lines into what the page already holds, keyed by
 * `id` (the trace id, shared between the live-event and trace-backfill
 * paths above) so the SAME trace arriving twice — once as a `speech_heard`
 * event, once from the backfill — collapses to one line rather than two.
 * Sorted by `(tick, id)` — world order, trace id as the tie-break for two
 * lines inscribed on the same tick — never insertion order, so a burst
 * delivered out of sequence (or a backfilled line arriving after a live one
 * with a lower tick) still renders in the world's own order.
 */
/**
 * `speech:10` → `10`; `null` when the trace id after the `speech:` prefix
 * is not a plain non-negative integer (the world's trace id is a string,
 * not guaranteed numeric forever — a non-numeric id falls back to the
 * string compare below rather than crashing or reordering arbitrarily).
 */
function traceOrderKey(id: string): number | null {
	const raw = id.slice(id.indexOf(":") + 1);
	return /^\d+$/.test(raw) ? Number(raw) : null;
}

/**
 * The tie-break for two lines sharing one tick (one burst): NUMERIC on the
 * trace id, never a string compare — `"speech:10" < "speech:6"` lexically
 * (the digit `1` sorts before `6`), so a burst of six-plus lines put trace
 * 10 (a later line in the SAME burst) before traces 6–9 on the live rig
 * (verifier finding, sk-jay0.1.8.12 follow-up: Aldwin's "Which species?"
 * rendered before the player's own earlier answers in the same burst).
 * Only ids sharing the SAME non-numeric-vs-numeric shape ever reach the
 * string fallback; two numeric ids always compare as numbers.
 */
function compareSpeechIds(a: string, b: string): number {
	const na = traceOrderKey(a);
	const nb = traceOrderKey(b);
	if (na !== null && nb !== null) return na - nb;
	return a < b ? -1 : a > b ? 1 : 0;
}

export function mergeSpeech(
	previous: readonly PlaySpeech[],
	incoming: readonly PlaySpeech[],
	limit = PLAY_SPEECH_LIMIT,
): PlaySpeech[] {
	if (incoming.length === 0) return [...previous];
	const byId = new Map<string, PlaySpeech>(previous.map((line) => [line.id, line]));
	for (const line of incoming) byId.set(line.id, line);
	return [...byId.values()]
		.sort((a, b) => a.tick - b.tick || compareSpeechIds(a.id, b.id))
		.slice(-limit);
}

/** `spellkave_map` (svg) → the svg markup, or null. */
export function mapSvgFromPayload(payload: ToolPayload): string | null {
	const details = toolDetails(payload);
	if (!isRecord(details)) return null;
	const svg = details.svg;
	return typeof svg === "string" && svg.trim().startsWith("<svg") ? svg : null;
}

/** `spellkave_map`'s `session_tokens` row (sk-jay0.4.2): one roster
 * participant placed on a drawn grid cell. */
export interface PlaySessionToken {
	nodeId: string;
	actorId: string;
	name: string;
	isMe: boolean;
}

/**
 * `spellkave_map`'s `session_tokens` field → the roster's own placed tokens,
 * parsed from the SAME payload `mapSvgFromPayload` reads (`play-session.ts`
 * publishes both from one map response, never out of step). Absent field or
 * a non-array (no tactical session open, or a failed/not-yet-run read) →
 * `[]`, the same honest-empty shape the field itself uses for "session open,
 * nobody placed yet" — the map tile has no reason to distinguish the two.
 */
export function sessionTokensFromPayload(payload: ToolPayload): PlaySessionToken[] {
	const details = toolDetails(payload);
	if (!isRecord(details) || !Array.isArray(details.session_tokens)) return [];
	const tokens: PlaySessionToken[] = [];
	for (const row of details.session_tokens) {
		if (!isRecord(row)) continue;
		const nodeId = str(row, "node_id");
		const actorId = str(row, "actor_id");
		if (nodeId === "" || actorId === "") continue;
		tokens.push({
			nodeId,
			actorId,
			name: str(row, "name") || actorId,
			isMe: row.is_me === true,
		});
	}
	return tokens;
}

/**
 * `spellkave_trace_detail` of a speech trace → one dialogue line. The
 * detail carries the parsed `payload` (`text`, `action_id`); `payload_json`
 * itself never leaves the tool. Mirrors the DM's own restart reconcile.
 */
export function speechFromTraceDetail(
	payload: ToolPayload,
	nameOf: (actorId: string) => string,
	selfActorId: string,
): PlaySpeech | null {
	const details = toolDetails(payload);
	if (!isRecord(details) || details.status !== "ok" || !isRecord(details.trace)) return null;
	const trace = details.trace;
	const body = isRecord(trace.payload) ? trace.payload : null;
	const text = body === null ? "" : str(body, "text");
	const response = isRecord(trace.response) ? trace.response : undefined;
	const slot = response === undefined ? undefined : num(response, "slot");
	const traceId = str(trace, "trace_id");
	// A quiet trace (no words, no dialog choice) is nothing to backfill; a
	// dialog choice keeps its empty-text row the same way the live event
	// path does above (empty choice text remains neutral without an occurrence link).
	if (traceId === "" || (text === "" && slot === undefined)) return null;
	const speakerId = str(trace, "inscribed_by") || null;
	const tick = num(trace, "inscribed_at") ?? 0;
	const line: PlaySpeech = {
		id: `speech:${traceId}`,
		tick,
		speakerId,
		speaker: speakerId === null ? "Someone" : nameOf(speakerId),
		text: text || (response === undefined ? "" : str(response, "label")),
		mine: speakerId === selfActorId,
	};
	if (slot !== undefined) line.choiceSlot = slot;
	if (typeof body?.addressee === "number") line.addressee = body.addressee;
	return line;
}

/** Trace listing rows of a kind, as `{handle, rev, id}` for detail follow-ups. */
export function traceRefsFromListing(
	payload: ToolPayload,
	kind: string,
): { handle: string; rev: string; id: string; tick: number }[] {
	const details = toolDetails(payload);
	if (!isRecord(details)) return [];
	return items(details.items)
		.filter((row) => str(row, "kind") === kind)
		.map((row) => ({
			handle: str(row, "handle"),
			rev: str(row, "rev"),
			id: str(row, "handle").replace(/^t:/, ""),
			tick: num(row, "inscribed_at") ?? 0,
		}))
		.filter((row) => row.handle.length >= 2 && row.rev !== "");
}
