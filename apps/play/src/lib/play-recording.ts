import {
	BoundedRecording,
	type JsonValue,
	parseRecordingEnvelope,
	type RecordingEnvelope,
} from "@spellkave/sdk/replay";
import { type MosaicLayout, TILE_IDS } from "./mosaic";
import { actionAcceptsUtterance, type PlayView } from "./play-view";

export const PLAY_RECORDING_SURFACE = "spellkave.play";

export type PlayRecordingPayload = {
	view: JsonValue;
	presentation: JsonValue | null;
	[key: string]: JsonValue;
};

/** The mosaic is presentation state, never a world command. `mobile` makes a
 * saved desktop arrangement unambiguous when it is opened on a phone. */
export interface PlayPresentation {
	layout: MosaicLayout;
	mobile: boolean;
}

export function createPlayRecording(options: { now?: () => number; id?: string } = {}) {
	return new BoundedRecording<PlayRecordingPayload>({
		limit: 24,
		maxAgeMs: 5 * 60_000,
		...options,
	});
}

/** Capture the display model, not the connection/session handle. JSON cloning
 * removes callbacks, but is NOT redaction: visible dialogue and names can still
 * be private. Review recordings before sharing or committing them. */
export function capturePlayView(
	view: PlayView,
	presentation?: PlayPresentation,
): PlayRecordingPayload {
	// Playback provenance belongs to the replay adapter, not to a captured
	// world snapshot. A recording is marked again when it is restored.
	const { interactionOrigin: _interactionOrigin, ...capturedView } = view;
	return {
		view: JSON.parse(JSON.stringify(capturedView)) as JsonValue,
		presentation:
			presentation === undefined ? null : (JSON.parse(JSON.stringify(presentation)) as JsonValue),
	};
}

export function parsePlayRecording(value: unknown): RecordingEnvelope<PlayRecordingPayload> | null {
	return parseRecordingEnvelope(value, {
		surface: PLAY_RECORDING_SURFACE,
		parsePayload: (payload) => {
			if (!isRecord(payload)) return null;
			const view = payload.view;
			if (view === undefined || !isPlayView(view)) return null;
			const presentation = payload.presentation;
			if (presentation !== undefined && presentation !== null && !isPlayPresentation(presentation))
				return null;
			return { view, presentation: presentation ?? null };
		},
	});
}

export function playViewFromPayload(payload: PlayRecordingPayload): PlayView {
	const view = JSON.parse(JSON.stringify(payload.view)) as JsonValue;
	if (!isPlayView(view)) throw new Error("Play recording contains an invalid view");
	const restored = view as unknown as PlayView;
	// `acceptsUtterance` is a client display derivation, not world evidence. Older
	// captures persisted the then-buggy `false` for actor-carried
	// `srd/speak-aloud` when the tool reported `verb_class: manipulate`.
	// Re-establish the canonical descriptor invariant when replaying, without
	// changing any captured world-facing field or inventing an action.
	return {
		...restored,
		interactionOrigin: "legacy-recording",
		actions: restored.actions.map((action) =>
			action.acceptsUtterance ||
			!actionAcceptsUtterance(action.verb, action.descriptor, action.label)
				? action
				: { ...action, acceptsUtterance: true },
		),
	};
}

export function playPresentationFromPayload(
	payload: PlayRecordingPayload,
): PlayPresentation | undefined {
	if (payload.presentation === null || !isPlayPresentation(payload.presentation)) return undefined;
	return JSON.parse(JSON.stringify(payload.presentation)) as PlayPresentation;
}

function isRecord(value: unknown): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * This is a structural admission check, not a second Play model: it mirrors
 * only the fields the existing components dereference. Extra recorded fields
 * remain forward-compatible, but malformed nested rows never reach Svelte.
 */
function isPlayView(value: JsonValue): value is JsonValue & PlayView {
	if (!isRecord(value)) return false;
	const hero = value.hero;
	const session = value.session;
	const place = value.place;
	const reaction = value.reaction;
	const mapSvg = value.mapSvg;
	if (hero === undefined || session === undefined || !isHero(hero) || !isSession(session))
		return false;
	if (place === undefined || (place !== null && !isPlace(place))) return false;
	if (reaction === undefined || (reaction !== null && !isReaction(reaction))) return false;
	if (mapSvg === undefined || (mapSvg !== null && typeof mapSvg !== "string")) return false;
	if (!isFiniteNumber(value.actionCount)) return false;
	if (!isArray(value.occupants, isOccupant) || !isArray(value.actions, isAction)) return false;
	if (
		!isArray(value.pack, isPackItem) ||
		!isArray(value.speech, isSpeech) ||
		!isArray(value.events, isEvent)
	)
		return false;
	return (
		optional(value, "itemDetail", isNullable(isItemDetail)) &&
		optional(value, "occupantDetail", isNullable(isOccupantDetail)) &&
		optional(value, "placeState", isOneOf("ready", "failed", "missing")) &&
		optional(value, "mapState", isOneOf("loading", "ready", "empty", "failed")) &&
		optional(
			value,
			"economy",
			isNullable((entry) => isArray(entry, isEconomyChannel)),
		) &&
		optional(value, "operations", isOperations) &&
		optional(value, "turnSession", isNullable(isOperation))
	);
}

type ValueGuard = (value: JsonValue) => boolean;

function isFiniteNumber(value: JsonValue | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isArray(value: JsonValue | undefined, guard: ValueGuard): boolean {
	return Array.isArray(value) && value.every(guard);
}

function optional(record: JsonValue, key: string, guard: ValueGuard): boolean {
	return isRecord(record) && (record[key] === undefined || guard(record[key]));
}

function isNullable(guard: ValueGuard): ValueGuard {
	return (value) => value === null || guard(value);
}

function isOneOf(...values: string[]): ValueGuard {
	return (value) => typeof value === "string" && values.includes(value);
}

function fields(record: JsonValue, checks: Record<string, ValueGuard>): boolean {
	if (!isRecord(record)) return false;
	return Object.entries(checks).every(
		([key, guard]) => record[key] !== undefined && guard(record[key]),
	);
}

const isString: ValueGuard = (value) => typeof value === "string";
const isBoolean: ValueGuard = (value) => typeof value === "boolean";
const isStringOrNull = isNullable(isString);

function isHero(value: JsonValue): boolean {
	return (
		fields(value, {
			actorId: isString,
			name: isString,
			vitals: (v) => isArray(v, isVital),
			abilities: (v) => isArray(v, isAbility),
			skills: (v) => isArray(v, isChip),
			masteries: (v) => isArray(v, isChip),
			conditions: (v) => isArray(v, isString),
			appearance: isString,
			backstory: isString,
			placeId: isStringOrNull,
		}) &&
		optional(value, "quest", (v) => isArray(v, isVital)) &&
		optional(value, "conditionDetails", (v) => isArray(v, isCondition)) &&
		optional(value, "identityDetails", (v) => isArray(v, isIdentityDetail)) &&
		optional(value, "descriptionReads", isDescriptionReads) &&
		optional(value, "suppliedFields", isSuppliedFields) &&
		["species", "className", "background", "proficiencyDescription"].every((key) =>
			optional(value, key, isString),
		) &&
		["level", "hp", "ac", "xp", "proficiency"].every((key) => optional(value, key, isFiniteNumber))
	);
}

function isVital(value: JsonValue): boolean {
	return (
		fields(value, { id: isString, label: isString, value: isString }) &&
		optional(value, "description", isString)
	);
}
function isAbility(value: JsonValue): boolean {
	return (
		fields(value, {
			id: isString,
			label: isString,
			score: isFiniteNumber,
			modifier: isFiniteNumber,
		}) && optional(value, "description", isString)
	);
}
function isChip(value: JsonValue): boolean {
	return fields(value, { id: isString, label: isString });
}
function isIdentityDetail(value: JsonValue): boolean {
	return fields(value, { id: isString, label: isString, description: isString });
}
function isCondition(value: JsonValue): boolean {
	return (
		fields(value, { id: isString, label: isString }) &&
		["description"].every((key) => optional(value, key, isString)) &&
		["stackCount", "expiresAtTick"].every((key) => optional(value, key, isFiniteNumber))
	);
}
function isDescriptionReads(value: JsonValue): boolean {
	return (
		isRecord(value) &&
		["values", "identity", "conditions"].every((key) =>
			optional(value, key, isOneOf("ready", "failed")),
		)
	);
}
function isSuppliedFields(value: JsonValue): boolean {
	return fields(value, {
		vitals: isFiniteNumber,
		quest: isFiniteNumber,
		conditions: isFiniteNumber,
	});
}

function isSession(value: JsonValue): boolean {
	return (
		fields(value, {
			inSession: isBoolean,
			myTurn: isBoolean,
			lifecycle: isStringOrNull,
			currentActor: isStringOrNull,
			currentActorName: isStringOrNull,
			roster: (v) => isArray(v, isRoster),
		}) && optional(value, "id", isString)
	);
}
function isRoster(value: JsonValue): boolean {
	return fields(value, {
		actorId: isString,
		name: isString,
		ordinal: isFiniteNumber,
		isMe: isBoolean,
		isCurrent: isBoolean,
	});
}
function isPlace(value: JsonValue): boolean {
	return fields(value, {
		id: isString,
		name: isString,
		description: isString,
		exits: (v) => isArray(v, isExit),
	});
}
function isExit(value: JsonValue): boolean {
	return (
		fields(value, {
			handle: isString,
			rev: isString,
			label: isString,
			to: isStringOrNull,
			toName: isString,
			gates: (v) => isArray(v, isString),
		}) && optional(value, "toNodeId", isString)
	);
}
function isOccupant(value: JsonValue): boolean {
	return (
		fields(value, {
			id: isString,
			handle: isString,
			rev: isString,
			kind: isOneOf("person", "creature", "thing"),
			sceneKind: isString,
			name: isString,
			conditions: (v) => isArray(v, isString),
			note: isString,
		}) && optional(value, "art", isArt)
	);
}
function isAction(value: JsonValue): boolean {
	return (
		fields(value, {
			id: isString,
			label: isString,
			verb: isString,
			descriptor: isString,
			targetName: isString,
			targetRef: isString,
			acceptsUtterance: isBoolean,
		}) &&
		["description", "group"].every((key) => optional(value, key, isString)) &&
		optional(value, "groups", (v) => isArray(v, isString)) &&
		optional(value, "slot", isFiniteNumber)
	);
}
function isReaction(value: JsonValue): boolean {
	return fields(value, {
		windowKind: isOneOf("reaction", "intervention"),
		handle: isString,
		rev: isString,
		originatingActionId: isString,
		originatingActor: isStringOrNull,
		originatingActorName: isStringOrNull,
		remainingMs: isNullable(isFiniteNumber),
		faces: Array.isArray,
	});
}
function isPackItem(value: JsonValue): boolean {
	return fields(value, {
		id: isString,
		name: isString,
		detail: isString,
		quantity: isFiniteNumber,
		equipped: isStringOrNull,
		handle: isString,
		rev: isString,
	});
}
function isSpeech(value: JsonValue): boolean {
	return (
		fields(value, {
			id: isString,
			tick: isFiniteNumber,
			speakerId: isStringOrNull,
			speaker: isString,
			text: isString,
			mine: isBoolean,
		}) &&
		optional(value, "addressee", isNullable(isFiniteNumber)) &&
		optional(value, "addresseeName", isStringOrNull) &&
		optional(value, "choiceSlot", isFiniteNumber)
	);
}
function isEvent(value: JsonValue): boolean {
	return fields(value, { id: isString, tick: isFiniteNumber, kind: isString, summary: isString });
}
function isEconomyChannel(value: JsonValue): boolean {
	return fields(value, {
		channelId: isString,
		spentMs: isFiniteNumber,
		windowStartMs: isFiniteNumber,
	});
}
function isArt(value: JsonValue): boolean {
	return fields(value, { path: isString, hash: isString, license: isString });
}
function isFacet(value: JsonValue): boolean {
	return fields(value, { id: isString, label: isString, value: isString });
}
function isItemDetail(value: JsonValue): boolean {
	return (
		fields(value, {
			id: isString,
			kind: isString,
			slot: isStringOrNull,
			facts: (v) => isArray(v, isFacet),
			verbs: (v) => isArray(v, isAction),
		}) &&
		optional(value, "art", isArt) &&
		optional(value, "suppliedFields", isFiniteNumber) &&
		optional(value, "entityId", isString) &&
		optional(value, "description", isString) &&
		optional(value, "failed", isBoolean)
	);
}
function isOccupantDetail(value: JsonValue): boolean {
	return (
		fields(value, {
			id: isString,
			handle: isString,
			rev: isString,
			facts: (v) => isArray(v, isFacet),
			verbs: (v) => isArray(v, isAction),
		}) &&
		optional(value, "art", isArt) &&
		optional(value, "entityId", isString) &&
		optional(value, "description", isString) &&
		optional(value, "failed", isBoolean)
	);
}
function isOperation(value: JsonValue): boolean {
	return (
		fields(value, {
			id: isString,
			label: isString,
			phase: isString,
			description: isStringOrNull,
			progress: isNullable(isFiniteNumber),
			terminal: isBoolean,
			worldTimed: isBoolean,
			turnRule: isStringOrNull,
			fields: (v) => isArray(v, (entry) => fields(entry, { label: isString, value: isString })),
		}) &&
		optional(value, "observedWorldTick", isStringOrNull) &&
		optional(value, "clockUnchanged", isBoolean) &&
		optional(value, "notice", isString)
	);
}
function isOperations(value: JsonValue): boolean {
	return fields(value, {
		state: isOneOf("ready", "failed"),
		selected: isNullable(isOperation),
		items: (v) =>
			isArray(v, (entry) => fields(entry, { id: isString, label: isString, phase: isString })),
		total: isNullable(isFiniteNumber),
		nextCursor: isStringOrNull,
	});
}

function isPlayPresentation(value: JsonValue): boolean {
	if (!isRecord(value) || typeof value.mobile !== "boolean" || !isRecord(value.layout))
		return false;
	const { colShare, rowShare } = value.layout;
	if (!Array.isArray(colShare) || colShare.length !== 3 || !isRecord(rowShare)) return false;
	if (!colShare.every(isShare)) return false;
	return TILE_IDS.every((id) => isShare(rowShare[id]));
}

function isShare(value: JsonValue | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
