/**
 * The dock's one action row (axioms A1, A4, A6,
 * `ledger/designs/play-interaction-axioms.md`): maps and names select, the
 * dock acts. This module is the pure translation from the current `PlayView`
 * and the one global selection into the hotbar's groups, rows and digits.
 *
 * The three groups are the world's three niche providers (ADR-0021): what the
 * SELECTED thing offers (`entity`), what HERE offers (`place`), what the
 * player's own body carries everywhere (`actor`, the ME group). ME is the same
 * wherever the player stands, which is where muscle memory lives; a slot the
 * world does not offer right now is DIMMED, not removed, so a digit keeps its
 * meaning. Nothing here dispatches a world action.
 */
import { isGenericCheckAction } from "./play-action-context";
import { UNTARGETED_TARGET_REF, verbName } from "./play-table";
import { actionTakesInput, type PlayAction } from "./play-view";
import type { SelectionMenuEntry, SelectionRow } from "./selection";

export interface HotbarSlot {
	/** A `PlayAction.id`, a `move:<handle>` id (`selection.ts`), or a
	 * `dimmed:<groupKey>:<descriptor>` placeholder that never acts. */
	id: string;
	label: string;
	/** The world's own full label, when it differs from `label`. */
	accessibleLabel?: string;
	descriptor: string;
	/** Pressing it sets the composer's mode instead of acting. */
	acceptsUtterance: boolean;
	/** A structured, world-authored form must be opened deliberately. It is
	 * never the composer's ambient speech fallback. */
	requiresExplicitComposerMode?: true;
	/** Known for this group, not offered right now. */
	dimmed: boolean;
}

export interface HotbarGroup {
	/** `answers`, `me`, `here`, or `subject:<id>` for a selected thing. */
	id: string;
	/** Registry key for remembered slots; `null` for a group that is never
	 * remembered (answers, a bare move). */
	key: string | null;
	label: string;
	infoRef?: string;
	slots: HotbarSlot[];
	more: SelectionMenuEntry[];
	/** An honest sentence when the group has nothing to offer. */
	note?: string;
}

export interface HotbarAnswer {
	id: string;
	number: number;
	text: string;
}

/** Descriptor → label, per group key. Grow-only; the caller keeps it. */
export type HotbarMemory = ReadonlyMap<string, ReadonlyMap<string, string>>;

export interface HotbarInput {
	actions: readonly PlayAction[];
	/** The player's own actor id, for the ME fallback on a payload that
	 * predates the tool's `provider` field. */
	heroActorId: string;
	placeId: string | null;
	selectionRow: SelectionRow | null;
	answers: readonly HotbarAnswer[];
	answersLabel: string | null;
	/** Answers past the dock's own inline cap (`splitDockAnswers`'s
	 * `overflow`) — folded into the answers group's own `more` menu instead
	 * of a slot, so a crowded prompt never pushes the digit row past 9. */
	answersOverflow?: readonly HotbarAnswer[];
	/**
	 * The open dialogue's own speaker, when one is open. A line-bound offer
	 * targeted at them (e.g. "Adopt the recommended array") is what THIS
	 * conversation currently offers, same as a place's own untargeted verbs
	 * — so it joins HERE rather than waiting for the player to separately
	 * select the speaker first (a gap the Playground's own character-
	 * creation flow surfaced: nothing else ever selects that speaker before
	 * the offer needs pressing).
	 */
	talkSpeakerId?: string | null;
	memory: HotbarMemory;
}

export interface Hotbar {
	chip: { name: string; infoRef?: string } | null;
	answers: HotbarGroup | null;
	selection: HotbarGroup[];
	here: HotbarGroup;
	me: HotbarGroup;
}

function isAnswer(action: PlayAction): boolean {
	return action.slot !== undefined;
}

/**
 * ME holds what the player's own body carries AND does to itself or to
 * nobody in particular (Dodge, Dash, Speak Aloud). The actor also carries its
 * attacks, but an attack is one offered row PER TARGET ("Unarmed Strike —
 * World Operator"): that row belongs to the selection of that target, never
 * to ME, or ME would attack whoever happens to stand here at the press of a
 * digit with nothing selected (seen live 2026-09-19).
 */
function isMine(action: PlayAction, heroActorId: string): boolean {
	const own = `entity:${heroActorId}`;
	if (action.targetRef.startsWith("entity:") && action.targetRef !== own) return false;
	// The same act is also offered once UNGROUNDED, as its reach ("anything
	// within 9 m": `place_node_set:<origin>:<range>:<template>`, the SDK's
	// spelling of `TargetRef::PlaceNodeSet`). That row names no one to hit, and
	// the kernel's manipulate path does not resolve a node set today, so it is
	// no slot at all; the grounded row per target is. A real area act would
	// need its own place in the dock once the world can commit one.
	if (action.targetRef.startsWith("place_node_set:")) return false;
	if (action.provider !== undefined) return action.provider === "actor";
	return action.targetRef === own;
}

/** Selecting the player's own cell/token folds the SAME union `selection.ts`'s
 * `cellRow` already shows for "You" (mine, this cell's own untargeted verbs,
 * and the world-scoped group) into the SELECTION group — not only `isMine`,
 * or a own-cell "Search the cellar" (`place_node:<id>`) or a world-scoped
 * check (`targetRef: "world"`) offered while standing there would silently
 * vanish the moment the player selects themselves instead of leaving nothing
 * selected. */
function isSelfScoped(action: PlayAction, heroActorId: string, placeId: string | null): boolean {
	if (isMine(action, heroActorId)) return true;
	if (placeId !== null && action.targetRef === `place_node:${placeId}`) return true;
	return action.targetRef === "world";
}

function isHere(
	action: PlayAction,
	heroActorId: string,
	talkSpeakerId: string | null | undefined,
): boolean {
	if (isMine(action, heroActorId)) return false;
	if (talkSpeakerId != null && action.targetRef === `entity:${talkSpeakerId}`) return true;
	if (action.provider === "place") return !action.targetRef.startsWith("entity:");
	return (
		action.targetRef === UNTARGETED_TARGET_REF ||
		action.targetRef === "world" ||
		action.targetRef.startsWith("place_node:")
	);
}

function toSlot(action: PlayAction): HotbarSlot {
	const label = verbName(action);
	return {
		id: action.id,
		label,
		...(label === action.label ? {} : { accessibleLabel: action.label }),
		descriptor: action.descriptor,
		acceptsUtterance: actionTakesInput(action),
		...(action.input?.fields.length ? { requiresExplicitComposerMode: true as const } : {}),
		dimmed: false,
	};
}

/** An explicit empty input schema plus text carriage means the world already
 * supplied the complete utterance. These are menu invocations, not composer
 * modes. Keep a newly offered menu ahead of remembered, now-unavailable
 * choices when a conversation advances. */
function isPrefilledInvocation(action: PlayAction): boolean {
	return action.acceptsUtterance && action.input?.fields.length === 0;
}

/** Stable per action id: the same descriptor lands in the same place for
 * every target. Generic checks fold into one "Checks" submenu. */
function groupFromActions(
	id: string,
	key: string | null,
	label: string,
	actions: readonly PlayAction[],
	memory: HotbarMemory,
): HotbarGroup {
	const checks: PlayAction[] = [];
	const rest: PlayAction[] = [];
	for (const action of actions) (isGenericCheckAction(action) ? checks : rest).push(action);
	const prefilled = rest
		.filter(isPrefilledInvocation)
		.sort((left, right) => left.descriptor.localeCompare(right.descriptor));
	// A structured form is a deliberate next step the world has offered. It
	// must stay reachable in the compact row instead of being buried below
	// remembered, now-stale verbs; the app knows only the input shape, never
	// the action's domain meaning.
	const forms = rest
		.filter((action) => actionTakesInput(action) && action.input?.fields.length)
		.sort((left, right) => left.descriptor.localeCompare(right.descriptor));
	const ordinary = rest.filter(
		(action) => !isPrefilledInvocation(action) && !forms.includes(action),
	);
	const live = new Map<string, HotbarSlot>();
	for (const action of ordinary)
		if (!live.has(action.descriptor)) live.set(action.descriptor, toSlot(action));
	const remembered = key === null ? undefined : memory.get(key);
	// A digit must never move under the player's finger. Slots this group
	// has shown before keep their place, in the order they were first seen
	// (`rememberHotbar` inserts in slot order and only ever appends); a
	// descriptor seen for the first time goes AFTER them, so a new offer
	// (Stand Up appearing once the actor is Prone) takes the next free digit
	// instead of pushing Long Rest from 8 to 9. Only the first sight of a
	// group is sorted, by descriptor, so the same act lands in the same
	// place for every target.
	const known = [...(remembered?.keys() ?? [])];
	const fresh = [...live.keys()].filter((descriptor) => !remembered?.has(descriptor)).sort();
	const ordinarySlots = [...known, ...fresh].map(
		(descriptor): HotbarSlot =>
			live.get(descriptor) ?? {
				id: `dimmed:${key}:${descriptor}`,
				label: remembered?.get(descriptor) ?? descriptor,
				descriptor,
				acceptsUtterance: false,
				dimmed: true,
			},
	);
	// Forms lead the compact row: an authored input request is the clearest
	// actionable next step. Complete invocations and remembered actions still
	// follow without changing their own relative order.
	const slots = [...forms.map(toSlot), ...prefilled.map(toSlot), ...ordinarySlots];
	const more: SelectionMenuEntry[] =
		checks.length === 0
			? []
			: [
					{
						id: "checks",
						label: "Checks",
						submenu: checks.map((action) => {
							const slot = toSlot(action);
							return {
								id: slot.id,
								label: slot.label,
								...(slot.accessibleLabel ? { accessibleLabel: slot.accessibleLabel } : {}),
							};
						}),
					},
				];
	return { id, key, label, slots, more };
}

/**
 * One group per selected subject. An actor subject shows EVERY offered act
 * on that actor, speech included (the composer follows the selection, so
 * Speak and Whisper are slots here, not a separate chip). A free cell or a
 * neighbouring place keeps the one move/travel entry `selection.ts` built
 * (legacy recordings only; live travel is a go sentence in the composer).
 */
function selectionGroups(input: HotbarInput): HotbarGroup[] {
	const row = input.selectionRow;
	if (row === null) return [];
	return row.subjects.map((subject): HotbarGroup => {
		const isMove = subject.primary.some((entry) => entry.id.startsWith("move:"));
		const isSelf = subject.id === "self" || subject.id === input.heroActorId;
		if (isMove || subject.id.startsWith("exit:") || subject.id.startsWith("place:")) {
			return {
				id: `subject:${subject.id}`,
				key: null,
				label: subject.name,
				...(subject.infoRef ? { infoRef: subject.infoRef } : {}),
				slots: subject.primary.map((entry) => ({
					id: entry.id,
					label: entry.label,
					descriptor: entry.id,
					acceptsUtterance: false,
					dimmed: false,
				})),
				more: [],
				...(row.note ? { note: row.note } : {}),
			};
		}
		const actions =
			subject.itemActions ??
			(isSelf
				? input.actions.filter(
						(action) => !isAnswer(action) && isSelfScoped(action, input.heroActorId, input.placeId),
					)
				: input.actions.filter(
						(action) =>
							!isAnswer(action) &&
							(action.targetRef === `entity:${subject.id}` ||
								action.targetRef === `item:${subject.id}`),
					));
		const group = groupFromActions(
			`subject:${subject.id}`,
			subject.itemActions ? subject.id : isSelf ? "me" : `entity:${subject.id}`,
			subject.name,
			actions,
			input.memory,
		);
		return {
			...group,
			...(subject.infoRef ? { infoRef: subject.infoRef } : {}),
			...(group.slots.length === 0 && group.more.length === 0
				? { note: row.note ?? "Nothing is offered from here." }
				: {}),
		};
	});
}

export function hotbarFromView(input: HotbarInput): Hotbar {
	const open = input.actions.filter((action) => !isAnswer(action));
	const selection = selectionGroups(input);
	const first = input.selectionRow?.subjects[0];
	const selectedSubjectCount = input.selectionRow?.subjects.length ?? 0;
	return {
		chip:
			first === undefined
				? null
				: {
						name:
							selectedSubjectCount === 1
								? first.name
								: `${first.name} +${selectedSubjectCount - 1}`,
						...(first.infoRef ? { infoRef: first.infoRef } : {}),
					},
		answers:
			input.answers.length === 0
				? null
				: {
						id: "answers",
						key: null,
						label: input.answersLabel ?? "Answers",
						slots: input.answers.map((answer) => ({
							id: answer.id,
							label: answer.text,
							descriptor: `answer:${answer.number}`,
							acceptsUtterance: false,
							dimmed: false,
						})),
						more: (input.answersOverflow ?? []).map((answer) => ({
							id: answer.id,
							label: answer.text,
						})),
					},
		selection,
		here: groupFromActions(
			"here",
			input.placeId === null ? null : `here:${input.placeId}`,
			"Here",
			open.filter((action) => isHere(action, input.heroActorId, input.talkSpeakerId)),
			input.memory,
		),
		me: groupFromActions(
			"me",
			"me",
			"Me",
			open.filter((action) => isMine(action, input.heroActorId)),
			input.memory,
		),
	};
}

/** Adds every live slot to the memory. Returns the SAME map when nothing is
 * new, so a caller can assign it to reactive state without a loop. */
export function rememberHotbar(memory: HotbarMemory, hotbar: Hotbar): HotbarMemory {
	let next: Map<string, Map<string, string>> | null = null;
	for (const group of [...hotbar.selection, hotbar.here, hotbar.me]) {
		if (group.key === null) continue;
		for (const slot of group.slots) {
			if (slot.dimmed || memory.get(group.key)?.has(slot.descriptor)) continue;
			next ??= new Map([...memory].map(([key, slots]) => [key, new Map(slots)]));
			const slots = next.get(group.key) ?? new Map<string, string>();
			slots.set(slot.descriptor, slot.label);
			next.set(group.key, slots);
		}
	}
	return next ?? memory;
}

/** How many slots one group shows while the dock is compact. A real body
 * offers nine acts and a selected creature eight, several with long authored
 * names; all of them on one line wrapped the "compact" dock to four lines
 * (live, 2026-09-19, sk-jay0.1.8.63.45). */
export const COMPACT_GROUP_SLOTS = 4;

/** The group as the compact dock shows it: its first `COMPACT_GROUP_SLOTS`
 * slots, the rest folded to the front of its own "…" menu. A slot's place in
 * the order never changes (`rememberHotbar`), so the slots that stay keep
 * the digits they have when expanded. A folded dimmed slot is dropped: a
 * menu lists what can be done, and "not offered right now" is a fact about
 * a visible slot. An open prompt's answers are never folded. */
function compactGroup(group: HotbarGroup): HotbarGroup {
	if (group.slots.length <= COMPACT_GROUP_SLOTS) return group;
	const folded = group.slots
		.slice(COMPACT_GROUP_SLOTS)
		.filter((slot) => !slot.dimmed)
		.map(
			(slot): SelectionMenuEntry => ({ id: slot.id, label: slot.accessibleLabel ?? slot.label }),
		);
	return {
		...group,
		slots: group.slots.slice(0, COMPACT_GROUP_SLOTS),
		more: [...folded, ...group.more],
	};
}

/**
 * The visual rows, top first. Compact (one row): the open prompt's answers
 * if any, then the SELECTION group(s), or — with nothing selected — HERE and
 * ME. Expanded adds the groups the first row left out, one row each. A
 * group with neither slots, overflow nor a note is dropped.
 */
export function hotbarRows(hotbar: Hotbar, expanded: boolean): HotbarGroup[][] {
	const shown = (group: HotbarGroup): boolean =>
		group.slots.length > 0 || group.more.length > 0 || group.note !== undefined;
	const lead = hotbar.answers === null ? [] : [hotbar.answers];
	const groups = hotbar.selection.length > 0 ? hotbar.selection : [hotbar.here, hotbar.me];
	const first = [...lead, ...(expanded ? groups : groups.map(compactGroup))];
	const rows = [first.filter(shown)];
	if (expanded && hotbar.selection.length > 0) {
		rows.push([hotbar.here].filter(shown), [hotbar.me].filter(shown));
	}
	return rows.filter((row, index) => index === 0 || row.length > 0);
}

/**
 * Digits live only on the first row (axiom A6), one per slot in reading
 * order, up to `slotKeys.length`. A dimmed slot KEEPS its digit — that is
 * what makes the digits stable — but the returned `ids` holds `null` for it,
 * so the key does nothing. An open prompt's answers lead the row, so an
 * answer's position is its own authored number.
 */
export function assignSlotKeys(
	rows: readonly (readonly HotbarGroup[])[],
	slotKeys: readonly (string | null)[],
): { keyBySlotId: Map<string, string>; ids: (string | null)[] } {
	const keyBySlotId = new Map<string, string>();
	const ids: (string | null)[] = [];
	for (const group of rows[0] ?? []) {
		for (const slot of group.slots) {
			if (ids.length >= slotKeys.length) return { keyBySlotId, ids };
			const key = slotKeys[ids.length];
			if (key) keyBySlotId.set(slot.id, key);
			ids.push(slot.dimmed ? null : slot.id);
		}
	}
	return { keyBySlotId, ids };
}

/**
 * What the composer speaks through. The player's own pick (`modeId`, set by
 * pressing a words-taking slot) wins while that slot is still offered;
 * otherwise the first words-taking slot of the selection, then of HERE, then
 * of ME — so with nothing selected the words go to the room.
 */
export function composerSlot(
	hotbar: Hotbar,
	modeId: string | null,
): (HotbarSlot & { groupLabel: string }) | null {
	// An answer may also appear in the general affordance listing with the
	// same handle. The answer row owns that handle while its dialogue is open;
	// never let the duplicate turn the numbered invocation into a composer
	// target.
	const answerIds = new Set(hotbar.answers?.slots.map((slot) => slot.id) ?? []);
	const candidates = [...hotbar.selection, hotbar.here, hotbar.me].flatMap((group) =>
		group.slots
			.filter((slot) => slot.acceptsUtterance && !slot.dimmed && !answerIds.has(slot.id))
			.map((slot) => ({ ...slot, groupLabel: group.label })),
	);
	return (
		candidates.find((slot) => slot.id === modeId) ??
		candidates.find((slot) => !slot.requiresExplicitComposerMode) ??
		null
	);
}
