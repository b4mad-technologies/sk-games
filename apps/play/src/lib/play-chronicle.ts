import {
	renderWorldEventLine,
	type WorldEvent,
	type WorldEventFanout,
} from "@spellkave/tool-runtime";
import {
	type ChronicleFilterChip,
	chronicleKindRule,
	conditionLabel,
	DOWNED_CONDITION_IDS,
	humaniseNodeId,
	isDmInternalCondition,
	type PlaySpeech,
	type PlayView,
} from "./play-view";
import { playCopy } from "./player-copy";

/**
 * An actor an event names by id. `name` is the name Play knew when the event
 * was ingested (`play-session.ts`), so the line keeps naming someone who has
 * since left; `self` marks the controlled hero. An id with neither reads
 * "someone" — the id itself is never shown.
 */
export interface PlayChronicleActorRef {
	id: string;
	name?: string;
	self?: true;
}

/**
 * The structured facts of one world event, copied off the closed `WorldEvent`
 * at ingest (sk-jay0.1.8.96). Play renders its own sentence from these
 * (`chronicleSentence`); ids and template ids (`resourceId`, `attackKind`,
 * `source`, `originatingActionId`, `conditionId`) are data for a consumer
 * that matches or groups on them, and are never printed raw. Every field is
 * optional: which ones are set follows the event kind.
 */
export interface PlayChronicleFields {
	/** `session_lifecycle`, `turn_transition`. */
	sessionId?: string;
	/** `session_lifecycle`, `reaction_window`. */
	phase?: "opened" | "closed";
	/** `session_lifecycle`: participant actor ids (empty on `closed`). */
	participants?: readonly string[];
	/** `session_lifecycle`: the actor id that opened the session. */
	openedBy?: string;
	/** `turn_transition`: `null` when the turn opens with `toActor`. */
	fromActor?: PlayChronicleActorRef | null;
	toActor?: PlayChronicleActorRef;
	/** `self_hit`, `self_resource_spent`. */
	resourceId?: string;
	/** `self_hit`, `dealt_hit`, `xp_gained`, `self_resource_spent`. */
	amount?: number;
	newValue?: number;
	/** `self_hit`: the authored attack template id. */
	attackKind?: string;
	/** `self_hit`, `dealt_hit`: `null` when the world named no source. */
	attacker?: PlayChronicleActorRef | null;
	/** `self_resource_spent`: the authored template id that spent it. */
	source?: string;
	/** `self_condition_changed`, `dealt_condition`. On a folded
	 * `self_condition_changed` entry (`foldHeroConditionRows`) the leading
	 * row's id. */
	conditionId?: string;
	/**
	 * `self_condition_changed` only, and only on an entry that folds several
	 * same-drain, same-tick, same-`applied` rows (sk-jay0.1.8.96 s7): every
	 * folded condition id in the order the drain delivered them, the leading
	 * `conditionId` first, without duplicates. Absent on a single-row entry.
	 */
	conditionIds?: readonly string[];
	applied?: boolean;
	sourceEntityId?: string | null;
	/** `dealt_hit`, `dealt_condition`: the world's own perceived name. */
	targetName?: string;
	/** `reaction_window`. */
	windowKind?: "reaction" | "intervention";
	originatingActor?: PlayChronicleActorRef;
	originatingActionId?: string;
}

/** One chronicle line in the Play rail. Same shape `PlayView.events` already uses. */
export interface PlayChronicleEntry {
	id: string;
	tick: number;
	kind: string;
	/**
	 * The finished sentence. For an entry ingested from a world event it is
	 * Play's own sentence as rendered at ingest (`chronicleSentence`), free of
	 * entity ids and template ids. A hand-built entry (a fixture, an older
	 * recording) carries whatever prose it was given.
	 */
	summary: string;
	/** The event's structured facts; absent on a hand-built entry. */
	fields?: PlayChronicleFields;
	/**
	 * The authored trace kind, present only for a `kind: "trace_addressed"`
	 * entry (`playChronicleEntry` below copies `WorldEvent.trace_kind`
	 * verbatim). `chronicleKindRule` (play-view.ts) classifies by `kind`
	 * alone and cannot see this — it is read only by this file's own
	 * `isAttackMissEntry` override (sk-jay0.1.8.63.40), so a `trace_addressed`
	 * shape play-view.ts does not already special-case (e.g. a companion
	 * command) keeps its existing Speech/not-important classification.
	 */
	traceKind?: string;
}

type EventNames = ReadonlyMap<string, string>;

/**
 * What Play knows about names when it ingests an event (`play-session.ts`):
 * the controlled hero's own ids, and the names of the actors the current
 * authorized reads disclose (scene occupants, session roster). Resolving at
 * ingest keeps the name known when the event happened; an id unknown then
 * stays unnamed.
 */
export interface ChronicleNameContext {
	selfIds: ReadonlySet<string>;
	names: EventNames;
}

const NO_NAME_CONTEXT: ChronicleNameContext = { selfIds: new Set(), names: new Map() };

function actorRef(id: string, context: ChronicleNameContext): PlayChronicleActorRef {
	if (context.selfIds.has(id)) return { id, self: true };
	const name = context.names.get(id);
	// A "name" equal to the id is a caller's own id fallback, not a name.
	return name === undefined || name === "" || name === id ? { id } : { id, name };
}

/** How an actor reads inside a sentence. Never the id. */
function actorLabel(
	ref: PlayChronicleActorRef,
	names: EventNames,
	unknown: "someone" | "something" = "someone",
): string {
	if (ref.self) return "you";
	const late = names.get(ref.id);
	return ref.name ?? (late !== undefined && late !== "" && late !== ref.id ? late : unknown);
}

/** The hit-point resource of the shipped SRD bundle. Naming an SRD id is
 * fine at this layer (Play is the SRD-aware consumer), the same posture
 * `ATTACK_MISS_TRACE_KIND` below takes. */
const HP_RESOURCE_ID = "srd/hp";

function resourceLabel(resourceId: string): string {
	return resourceId.toLowerCase() === HP_RESOURCE_ID ? "HP" : humaniseNodeId(resourceId);
}

/** "A", "A and B", "A, B and C" — the label list of a folded condition line.
 * Player wording; a candidate for `player-copy.ts` (composer lane). */
function listLabel(labels: readonly string[]): string {
	if (labels.length <= 1) return labels[0] ?? "";
	return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** The going-down line; its wording lives in `player-copy.ts`. */
const FALL_UNCONSCIOUS_SENTENCE = playCopy.stream.fellUnconscious;

function remainingClause(newValue: number | undefined, suffix: string): string {
	return newValue === undefined ? "." : ` — ${newValue} ${suffix}.`;
}

/**
 * Play's own sentence for an ingested event, built from its structured
 * fields (sk-jay0.1.8.96). No entity id and no template id reaches the
 * sentence: an actor reads as its name, "you", or "someone"/"something"; a
 * resource or action id reads as its humanised label; an attack or spend
 * template id (`attackKind`, `source`) is left out entirely. Returns `null`
 * for a kind whose shared-renderer line already carries only names and
 * numbers (`dealt_hit`, `xp_gained`, `session_lifecycle`,
 * `advancement_available`, the trace kinds) — the caller keeps that line.
 */
function sentenceFromFields(
	kind: string,
	fields: PlayChronicleFields,
	names: EventNames,
): string | null {
	switch (kind) {
		case "turn_transition": {
			if (fields.toActor === undefined) return null;
			const to = actorLabel(fields.toActor, names);
			return fields.fromActor === null || fields.fromActor === undefined
				? `The turn opens with ${to}.`
				: `The turn passes from ${actorLabel(fields.fromActor, names)} to ${to}.`;
		}
		case "self_hit": {
			if (fields.amount === undefined) return null;
			const from =
				fields.attacker === null || fields.attacker === undefined || fields.attacker.self
					? ""
					: ` from ${actorLabel(fields.attacker, names, "something")}`;
			const hp = (fields.resourceId ?? HP_RESOURCE_ID).toLowerCase() === HP_RESOURCE_ID;
			return hp
				? `You take ${fields.amount} damage${from}${remainingClause(fields.newValue, "HP left")}`
				: `You lose ${fields.amount} ${resourceLabel(fields.resourceId ?? "")}${from}${remainingClause(fields.newValue, "left")}`;
		}
		case "self_resource_spent": {
			if (fields.amount === undefined || fields.resourceId === undefined) return null;
			return `You spend ${fields.amount} ${resourceLabel(fields.resourceId)}${remainingClause(fields.newValue, "left")}`;
		}
		case "self_condition_changed": {
			if (fields.conditionId === undefined) return null;
			const ids = fields.conditionIds ?? [fields.conditionId];
			// Going down (sk-jay0.1.8.102, owner decision 2026-11-12): a group
			// that applies the world's unconscious condition reads as the one
			// thing that happened, not as the list of its implied rows. Matched
			// on the condition id, never on a label. Every other group, and a
			// group that removes conditions, keeps the list sentence.
			if (fields.applied !== false && ids.some((id) => DOWNED_CONDITION_IDS.has(id)))
				return FALL_UNCONSCIOUS_SENTENCE;
			const label = listLabel(ids.map((id) => conditionLabel(id)));
			return fields.applied === false
				? `You are no longer affected by ${label}.`
				: `You are now affected by ${label}.`;
		}
		case "dealt_condition": {
			if (fields.conditionId === undefined || fields.targetName === undefined) return null;
			const label = conditionLabel(fields.conditionId);
			return fields.applied === false
				? `${fields.targetName} is no longer affected by ${label}.`
				: `${fields.targetName} is now affected by ${label}.`;
		}
		case "reaction_window": {
			const window = fields.windowKind ?? "reaction";
			if (fields.phase === "closed") return `The ${window} window closes.`;
			if (fields.originatingActor === undefined || fields.originatingActionId === undefined)
				return null;
			const who = fields.originatingActor.self
				? "your"
				: `${actorLabel(fields.originatingActor, names)}'s`;
			return `A ${window} window opens — ${who} ${humaniseNodeId(fields.originatingActionId)}.`;
		}
		default:
			return null;
	}
}

/** An authored id with a namespace: `srd/hp`, `srd/dm/set/srd.speed-walk/success`. */
const NAMESPACED_ID_PATTERN = /\b[a-z][a-z0-9_.-]*(?:\/[a-z0-9_.-]+)+/gi;

/**
 * A hand-built entry (a fixture, an older recording) has only prose. Keep
 * the 2026-09-19 presentation for it (sk-jay0.1.8.63.41) without that fix's
 * two holes: it no longer depends on a roster being present, and a dotted
 * template id is replaced whole. A token is only swapped when it is a known
 * id or a bare number — prose that already names someone is left alone.
 */
function presentLegacySummary(event: PlayChronicleEntry, names: EventNames): string {
	let summary = event.summary;
	if (event.kind === "turn_transition") {
		const match = summary.match(/(?:opens with|from) ([^. ]+)(?: to ([^. ]+))?\.?$/);
		for (const token of [match?.[1], match?.[2]]) {
			if (token === undefined || token === "") continue;
			const name = names.get(token);
			const replacement = name ?? (/^\d+$/.test(token) ? "someone" : undefined);
			if (replacement === undefined) continue;
			const whole = new RegExp(
				`(?<![\\w/])${token.replace(/[\\^$*+?()[\]{}|]/g, "\\$&")}(?![\\w/])`,
				"g",
			);
			summary = summary.replace(whole, () => replacement);
		}
	} else if (event.kind === "self_hit" || event.kind === "self_resource_spent") {
		summary = summary.replace(NAMESPACED_ID_PATTERN, (ref) => resourceLabel(ref));
	} else if (event.kind === "reaction_window") {
		const action = summary.match(/'s ([^.]+)\.$/)?.[1];
		if (action?.includes("/")) summary = summary.split(action).join(humaniseNodeId(action));
	}
	return summary;
}

/**
 * The sentence the stream and the Chronicle show for one entry. `names` is
 * only a late fallback for an actor whose name was not known at ingest (the
 * current session roster); a name resolved at ingest always wins.
 */
export function chronicleSentence(
	entry: PlayChronicleEntry,
	names: EventNames = NO_NAME_CONTEXT.names,
): string {
	if (entry.fields === undefined) return presentLegacySummary(entry, names);
	return sentenceFromFields(entry.kind, entry.fields, names) ?? entry.summary;
}

/**
 * sk-jay0.1.8.63.40: the one `trace_addressed` shape this file special-cases
 * — an attack miss (`srd/attack-miss`, authored once in
 * `packages/spellkave-srd-cc/src/chapters/playing-the-game/weapon-attack-units.ts`).
 * Hardcoding an SRD trace-kind id here is fine at THIS layer (Play is the
 * SRD-aware consumer; `@spellkave/world-events`'s own renderer stays
 * setting-neutral and payload-blind, per that package's CLAUDE.md) — the
 * same posture `DM_INTERNAL_CONDITION_IDS` (play-view.ts) already takes for
 * `core/condition/controlled`.
 */
const ATTACK_MISS_TRACE_KIND = "srd/attack-miss";

/** A miss belongs under the Fight chip, and matters at the card level — the
 * default `trace_addressed` row (play-view.ts's `CHRONICLE_KIND_RULES`,
 * Speech/not-important) is tuned for a companion command, not a whiffed
 * attack the target needs to notice. */
function isAttackMissEntry(entry: PlayChronicleEntry): boolean {
	return entry.kind === "trace_addressed" && entry.traceKind === ATTACK_MISS_TRACE_KIND;
}

/**
 * Bounds the non-speech ring `appendPlayChronicle` keeps (`play-session.ts`).
 * Originally matched the previous `readRecentEvents(db, 6)` window a small
 * rail-strip list was sized for; the Chronicle's stage level now wants the
 * full unfiltered place log (sk-jay0.1.8.13 task 3, "everything at the
 * place"), so this is widened to the same order of magnitude as the speech
 * side's own window (`PLAY_SPEECH_LIMIT`, play-view.ts) rather than staying
 * sized for a six-line rail that no longer exists.
 */
export const PLAY_CHRONICLE_LIMIT = 40;

/** A world event that carries a raw condition id (`self_condition_changed`,
 * `dealt_condition`) — the shared renderer prints the id verbatim
 * (sk-jay0.1.7 item 4: "Cellar Rat 1 is now affected by
 * core/condition/controlled."). */
function isConditionEvent(
	event: WorldEvent,
): event is Extract<WorldEvent, { condition_id: string }> {
	return event.kind === "self_condition_changed" || event.kind === "dealt_condition";
}

/**
 * Project one closed `WorldEvent` into a Play rail row, or `null` for a line
 * the player chronicle drops entirely: a DM-internal condition change (e.g.
 * `core/condition/controlled`, the turn machinery's own bookkeeping) is
 * never narrated to the player, and neither is a DM workflow condition
 * (`isDmInternalCondition`). The entry carries the event's structured
 * `fields` with every actor id resolved through `context` once, here, and a
 * `summary` rendered from them (`chronicleSentence`): the shared renderer's
 * line is kept only for kinds that print nothing but perceived names and
 * numbers, with its leading 🌍 stripped so the woven chronicle stays prose.
 */
export function playChronicleEntry(
	event: WorldEvent,
	seq: number,
	context: ChronicleNameContext = NO_NAME_CONTEXT,
): PlayChronicleEntry | null {
	if (isConditionEvent(event) && isDmInternalCondition(event.condition_id)) return null;
	const rendered = renderWorldEventLine(event);
	const stripped = rendered.startsWith("🌍 ") ? rendered.slice("🌍 ".length) : rendered;
	// The shared renderer prints an unlabelled trace's authored kind verbatim
	// ("… signals you (bundle/trace/kind)."); Play shows its humanised label.
	const shared =
		event.kind === "trace_addressed" && event.label === undefined
			? stripped.split(`(${event.trace_kind})`).join(`(${humaniseNodeId(event.trace_kind)})`)
			: stripped;
	const fields = fieldsFromEvent(event, context);
	const entry: PlayChronicleEntry = {
		id: `${event.kind}:${event.observed_at_tick}:${seq}`,
		tick: event.observed_at_tick,
		kind: event.kind,
		summary: shared,
		...(fields === undefined ? {} : { fields }),
		...(event.kind === "trace_addressed" ? { traceKind: event.trace_kind } : {}),
	};
	// `summary` stays populated with the id-free sentence as known at ingest,
	// for a consumer that only reads prose.
	entry.summary = chronicleSentence(entry);
	return entry;
}

/** Copies the closed event's own facts; resolves every actor id once, here. */
function fieldsFromEvent(
	event: WorldEvent,
	context: ChronicleNameContext,
): PlayChronicleFields | undefined {
	const optionalRef = (id: string | null): PlayChronicleActorRef | null =>
		id === null ? null : actorRef(id, context);
	// `self_hit` may carry the attacker's name as the producer resolved it
	// when the hit happened (`attacker_name`, optional). A name Play's own
	// authorized reads disclose wins; the event's name fills in when they have
	// none (an attacker that already left the scene). Without either the
	// sentence stays "from something".
	const attackerRef = (id: string | null, eventName?: string): PlayChronicleActorRef | null => {
		const ref = optionalRef(id);
		if (ref === null || ref.self || ref.name !== undefined) return ref;
		return eventName === undefined || eventName === "" || eventName === ref.id
			? ref
			: { ...ref, name: eventName };
	};
	const value = (newValue: number | undefined): { newValue?: number } =>
		newValue === undefined ? {} : { newValue };
	switch (event.kind) {
		case "session_lifecycle":
			return {
				sessionId: event.session_id,
				phase: event.phase,
				participants: [...event.participants],
				openedBy: event.opened_by,
			};
		case "turn_transition":
			return {
				sessionId: event.session_id,
				fromActor: optionalRef(event.from_actor),
				toActor: actorRef(event.to_actor, context),
			};
		case "self_hit":
			return {
				resourceId: event.resource_id,
				amount: event.amount,
				...value(event.new_value),
				attackKind: event.attack_kind,
				attacker: attackerRef(event.attacker_id, event.attacker_name),
			};
		case "dealt_hit":
			return {
				targetName: event.target_name,
				amount: event.amount,
				attacker: optionalRef(event.attacker_id),
			};
		case "self_condition_changed":
			return {
				conditionId: event.condition_id,
				applied: event.applied,
				sourceEntityId: event.source_entity_id,
			};
		case "dealt_condition":
			return {
				targetName: event.target_name,
				conditionId: event.condition_id,
				applied: event.applied,
				sourceEntityId: event.source_entity_id,
			};
		case "xp_gained":
			return { amount: event.amount, ...value(event.new_value) };
		case "self_resource_spent":
			return {
				resourceId: event.resource_id,
				amount: event.amount,
				...value(event.new_value),
				source: event.source,
			};
		case "reaction_window":
			return {
				windowKind: event.window_kind,
				phase: event.phase,
				originatingActor: actorRef(event.originating_actor, context),
				originatingActionId: event.originating_action_id,
			};
		// Their shared-renderer line carries only perceived names and authored
		// labels; nothing structured is needed to render or match them.
		case "advancement_available":
		case "speech_heard":
		case "trace_addressed":
		case "trace_departure":
			return undefined;
	}
}

/**
 * True for the `opened` lifecycle row of a session whose ONLY participant is
 * the controlled hero (sk-jay0.1.8.96 s4, owner decision 2026-11-12): the
 * world opens such a session for a long walk (ADR-0092 travel), and Play
 * already tells the walk through its own travel line. A session with any
 * other participant is a scene the player must see open.
 */
function opensHeroOnlySession(event: WorldEvent, context: ChronicleNameContext): boolean {
	return (
		event.kind === "session_lifecycle" &&
		event.phase === "opened" &&
		event.participants.length === 1 &&
		context.selfIds.has(event.participants[0] ?? "")
	);
}

/**
 * True for a turn row that names an actor other than the controlled hero.
 * The world can add a participant to a running session without a second
 * `opened` row (`JoinSession`, auto-join on targeting), so such a row is the
 * only sign that a remembered hero-only session became a shared scene.
 */
function namesSomeoneElse(
	event: Extract<WorldEvent, { kind: "turn_transition" }>,
	context: ChronicleNameContext,
): boolean {
	return (
		!context.selfIds.has(event.to_actor) ||
		(event.from_actor !== null && !context.selfIds.has(event.from_actor))
	);
}

/**
 * Folds the hero's own condition rows of ONE drain into one entry per
 * (tick, applied) pair (sk-jay0.1.8.96 s7, owner decision 2026-11-12):
 * going down applies Unconscious plus its implied rows in one step, which
 * otherwise reads as five lines. Only `self_condition_changed` entries
 * fold; the first row in the order the drain delivered them leads and
 * keeps its id and position, the others are dropped from the batch.
 *
 * Only rows of one RUN fold: any entry of another kind between two condition
 * rows ends the run and the next condition row leads a new line. The drain
 * interleaves hits and conditions by event id, so a condition that a later
 * hit of the same tick caused must stay after that hit ("prone", second
 * blow, "unconscious"), never be pulled up to the first condition line.
 *
 * That order is the SDK's (`computeNewEvents`, `@spellkave/sdk`'s world-event
 * builder), which since 2026-11-12 delivers the resource and condition rows
 * of one drain oldest first by event id: the lead is the row the world wrote
 * first. Play neither sorts nor reverses a drain.
 */
function foldHeroConditionRows(entries: readonly PlayChronicleEntry[]): PlayChronicleEntry[] {
	// The leads of the current run, by (tick, applied); emptied by any entry
	// that is not one of the hero's condition rows.
	const leads = new Map<string, PlayChronicleEntry>();
	const allLeads: PlayChronicleEntry[] = [];
	const folded: PlayChronicleEntry[] = [];
	for (const entry of entries) {
		const fields = entry.fields;
		if (entry.kind !== "self_condition_changed" || fields?.conditionId === undefined) {
			leads.clear();
			folded.push(entry);
			continue;
		}
		const key = `${entry.tick}:${fields.applied === false ? "removed" : "applied"}`;
		const lead = leads.get(key);
		if (lead === undefined) {
			leads.set(key, entry);
			allLeads.push(entry);
			folded.push(entry);
			continue;
		}
		const leadFields = lead.fields ?? {};
		const ids = leadFields.conditionIds ?? [leadFields.conditionId ?? fields.conditionId];
		if (ids.includes(fields.conditionId)) continue;
		leadFields.conditionIds = [...ids, fields.conditionId];
		lead.fields = leadFields;
	}
	for (const lead of allLeads) lead.summary = chronicleSentence(lead);
	return folded;
}

/**
 * Append newly drained events onto a bounded ring. `seq` is the caller’s
 * monotonic counter so Svelte keyed each-rows stay unique when two events
 * share a kind and tick; it advances by the full incoming count even when a
 * DM-internal line is dropped, so a later event's seq never collides with
 * one a dropped line would have used.
 *
 * `heroOnlySessions` is the caller's memory of the hero-only sessions
 * (`opensHeroOnlySession`) still open: their `session_lifecycle` and
 * `turn_transition` rows are dropped. A `closed` row carries no
 * participants, so only the id remembered from `opened` can recognise it;
 * the returned set forgets a session once its `closed` row was seen. A
 * session that was already running when the page connected has no `opened`
 * row here; `openPlaySession` seeds the set once from its first read when
 * that session's roster is the hero alone. A session the first read does not
 * show as hero-only keeps its lines. A remembered
 * session stops being hidden at the first turn row that names anyone but the
 * hero (`namesSomeoneElse`): that row and every later row of it show; the
 * rows already dropped are not brought back.
 */
export function appendPlayChronicle(
	previous: readonly PlayChronicleEntry[],
	incoming: readonly WorldEvent[],
	seq: number,
	limit = PLAY_CHRONICLE_LIMIT,
	context: ChronicleNameContext = NO_NAME_CONTEXT,
	heroOnlySessions: ReadonlySet<string> = new Set(),
): { entries: PlayChronicleEntry[]; seq: number; heroOnlySessions: ReadonlySet<string> } {
	if (incoming.length === 0) return { entries: [...previous], seq, heroOnlySessions };
	const hidden = new Set(heroOnlySessions);
	const closed: string[] = [];
	const added = foldHeroConditionRows(
		incoming
			.map((event, index) => {
				if (opensHeroOnlySession(event, context) && event.kind === "session_lifecycle")
					hidden.add(event.session_id);
				// Someone joined a running session: it is a scene from here on.
				if (event.kind === "turn_transition" && namesSomeoneElse(event, context))
					hidden.delete(event.session_id);
				if (
					(event.kind === "session_lifecycle" || event.kind === "turn_transition") &&
					hidden.has(event.session_id)
				) {
					if (event.kind === "session_lifecycle" && event.phase === "closed")
						closed.push(event.session_id);
					return null;
				}
				return playChronicleEntry(event, seq + index, context);
			})
			.filter((entry): entry is PlayChronicleEntry => entry !== null),
	);
	// Forgotten only after the whole drain, so a turn row the drain delivers
	// after the `closed` row is still recognised.
	for (const sessionId of closed) hidden.delete(sessionId);
	return {
		entries: [...previous, ...added].slice(-limit),
		seq: seq + incoming.length,
		heroOnlySessions: hidden,
	};
}

/**
 * Play chronicle ingest: copy every observed event (including a
 * `speech_heard` the communicate reply window just claimed), then leftover-drain
 * the claim hold only when no takeWhere is in flight.
 */
export function ingestFanoutForChronicle(
	fanout: WorldEventFanout,
	claiming: boolean,
): WorldEvent[] {
	fanout.observe();
	const observed = fanout.drainObserved();
	if (!claiming) fanout.diffAndAdvance();
	return observed;
}

/**
 * One row of the Chronicle's merged, world-ordered fact log (sk-jay0.1.8.13
 * task 1): either a folded speech burst (`kind: "speech"`) or a non-speech
 * world fact, classified through `CHRONICLE_KIND_RULES`
 * (`chronicleKindRule`, play-view.ts).
 */
export interface PlayChronicleFact {
	id: string;
	tick: number;
	kind: string;
	summary: string;
	/** Full retained text when the compact summary folds multiple lines. */
	detail?: string;
	important: boolean;
	chip: ChronicleFilterChip;
	/** Speech line id for explicit conversation navigation; a folded burst
	 * points to its first retained line. Opening the reader does not navigate. */
	scrollToSpeechId?: string;
}

/** "<speaker> said: "<text>"" — the folded voice for exactly one line, shared
 * between a single-line burst (`foldSpeechBursts`) and every unfolded stage
 * line (`unfoldSpeechLines`) below, so the two views read as one consistent
 * voice, not two different summarizers. */
function describeSpeechLine(speakerLabel: string, text: string): string {
	return `${speakerLabel} said: "${text}"`;
}

/**
 * Groups `view.speech` — the SAME world-ordered stream `threadFromView`
 * (play-table.ts) reads, already deduped and merged by `mergeSpeech`
 * (play-view.ts) — into one fact per speaker burst, the identical grouping
 * rule `threadFromView` uses for its own `startsBurst` (a new speaker, or a
 * hand-off between the world and the player, starts a new burst). The
 * CARD's own view (`chronicleCardFacts` below) — the ledger's own "Talk as
 * thread, Chronicle as logbook" design note: "speech folded" at card. A
 * single line reads as a plain quote; a longer burst folds to one line,
 * "<speaker> said <N> things · <the burst's last line>", the shape brief's
 * own "Aldwin said 4 things · Which species?" (its exact wording is the
 * speaker's own last line, not a paraphrase of it — the card's row uses CSS
 * line-clamping, not a hand-built text summarizer, to keep this honest).
 * Every burst is `important: true`: it already IS the card's own unit of "a
 * place fact, distilled" (sk-jay0.1.8.13 task 2).
 */
export function foldSpeechBursts(speech: readonly PlaySpeech[]): PlayChronicleFact[] {
	const facts: PlayChronicleFact[] = [];
	let index = 0;
	while (index < speech.length) {
		const first = speech[index];
		if (first === undefined) break;
		let end = index + 1;
		while (end < speech.length) {
			const candidate = speech[end];
			if (candidate === undefined) break;
			if (candidate.speakerId !== first.speakerId || candidate.mine !== first.mine) break;
			end += 1;
		}
		const burst = speech.slice(index, end);
		const last = burst.at(-1) ?? first;
		const speakerLabel = first.mine ? "You" : first.speaker;
		const summary =
			burst.length === 1
				? describeSpeechLine(speakerLabel, first.text)
				: `${speakerLabel} said ${burst.length} things · ${last.text}`;
		facts.push({
			id: `chronicle:burst:${first.id}`,
			tick: last.tick,
			kind: "speech",
			summary,
			...(burst.length > 1
				? { detail: burst.map((line) => describeSpeechLine(speakerLabel, line.text)).join("\n\n") }
				: {}),
			important: true,
			chip: "speech",
			scrollToSpeechId: first.id,
		});
		index = end;
	}
	return facts;
}

/**
 * One fact per RAW speech line, never folded — the STAGE view's own reading
 * of `view.speech` (the ledger's design note: "stage shows everything at
 * the place unfiltered, speech unfolded"). Every line is `important: true`
 * for the same reason a burst is: irrelevant at stage anyway, since stage
 * never applies the importance filter (`chronicleStageFacts` below).
 */
export function unfoldSpeechLines(speech: readonly PlaySpeech[]): PlayChronicleFact[] {
	return speech.map((line) => ({
		id: `chronicle:line:${line.id}`,
		tick: line.tick,
		kind: "speech",
		summary: describeSpeechLine(line.mine ? "You" : line.speaker, line.text),
		important: true,
		chip: "speech",
		scrollToSpeechId: line.id,
	}));
}

/** Non-speech place facts (`view.events`) through the per-kind
 * importance/chip table. Each summary is Play's own sentence
 * (`chronicleSentence`); `names` is only the late fallback for an actor
 * that had no name at ingest, and an empty map changes nothing else. */
export function chronicleFactsFromEvents(
	events: readonly PlayChronicleEntry[],
	names: EventNames = new Map(),
): PlayChronicleFact[] {
	return events.map((event) => {
		// sk-jay0.1.8.63.40: an attack miss overrides the generic
		// trace_addressed row (Speech/not-important, tuned for a companion
		// command) — a miss belongs under Fight and matters at the card level.
		const rule = isAttackMissEntry(event)
			? { chip: "fight" as const, important: true }
			: chronicleKindRule(event.kind);
		return {
			id: `chronicle:event:${event.id}`,
			tick: event.tick,
			kind: event.kind,
			summary: chronicleSentence(event, names),
			important: rule.important,
			chip: rule.chip,
		};
	});
}

/**
 * Sorted by tick only — deliberately no secondary id-based tie-break.
 * `Array.prototype.sort` has been stable since ES2019, and both inputs
 * arrive ALREADY in correct relative order for a tie: `foldSpeechBursts`/
 * `unfoldSpeechLines` walk `view.speech`, which `mergeSpeech` (play-view.ts)
 * already sorts with a NUMERIC trace-id tie-break
 * (`compareSpeechIds`/`traceOrderKey`, sk-jay0.1.8.12 follow-up — a naive
 * lexicographic compare put `speech:10` before `speech:6` on the live rig).
 * A second, lexicographic tie-break here on this function's OWN
 * `chronicle:line:speech:<n>`-shaped ids would silently reintroduce that
 * exact bug one level up; relying on stability plus already-correct input
 * order avoids re-deriving (or drifting from) `mergeSpeech`'s own fix.
 *
 * **Cross-type same-tick convention (sk-jay0.1.8.18, verifier addendum on
 * sk-jay0.1.8.13):** when a speech fact and a non-speech event fact land on
 * the SAME tick, the speech fact sorts first — not because either is a truer
 * world order, but because `facts = [...speechFacts, ...eventFacts]` puts
 * every speech fact ahead of every event fact before the stable sort ever
 * runs, and `sort`'s stability then preserves that relative order for any
 * tie. The world (today) exposes only one tick per event, with no finer
 * intra-tick sequence number shared between the speech and event streams, so
 * this concatenation order is a real decision, not an accident: it reads as
 * "what was said, then what changed" rather than the other way round. If the
 * substrate ever exposes a finer intra-tick key (e.g. a trace seq comparable
 * to an event seq), sort on THAT instead of relying on concatenation order.
 */
function mergeChronicleFacts(
	speechFacts: readonly PlayChronicleFact[],
	eventFacts: readonly PlayChronicleFact[],
): PlayChronicleFact[] {
	const facts = [...speechFacts, ...eventFacts];
	facts.sort((a, b) => a.tick - b.tick);
	return facts;
}

/**
 * The Chronicle CARD's one world-ordered fact log (sk-jay0.1.8.13 task 1):
 * the folded speech bursts plus the place's non-speech world facts, oldest
 * → newest. Exported for the strip level's own "what's the oldest fact
 * here" badge (`PlayTable.svelte`); `chronicleCardFacts` below is the
 * card's own reversed, important-only, capped reading of this same array.
 */
export function chronicleFactsFromView(view: PlayView): PlayChronicleFact[] {
	const names = new Map((view.session?.roster ?? []).map((entry) => [entry.actorId, entry.name]));
	return mergeChronicleFacts(
		foldSpeechBursts(view.speech),
		chronicleFactsFromEvents(view.events, names),
	);
}

/** The card's own cap (sk-jay0.1.8.13 task 3) — a handful of important
 * facts, not the whole log. */
export const CHRONICLE_CARD_LIMIT = 8;

/** Card level: important facts only, newest first, capped, speech folded to
 * one fact per burst. */
export function chronicleCardFacts(
	view: PlayView,
	limit = CHRONICLE_CARD_LIMIT,
): PlayChronicleFact[] {
	return chronicleFactsFromView(view)
		.filter((fact) => fact.important)
		.slice(-limit)
		.reverse();
}

/**
 * Stage level: everything at the place, newest first, speech UNFOLDED (one
 * fact per raw line, not per burst — the ledger's own design note),
 * optionally narrowed to one filter chip, never capped (sk-jay0.1.8.13 task
 * 3, "everything at the place unfiltered with filter chips").
 */
export function chronicleStageFacts(
	view: PlayView,
	chip: ChronicleFilterChip | null = null,
): PlayChronicleFact[] {
	const facts = mergeChronicleFacts(
		unfoldSpeechLines(view.speech),
		chronicleFactsFromEvents(
			view.events,
			new Map((view.session?.roster ?? []).map((entry) => [entry.actorId, entry.name])),
		),
	);
	const scoped = chip === null ? facts : facts.filter((fact) => fact.chip === chip);
	return [...scoped].reverse();
}
