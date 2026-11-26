/**
 * Pure derivations from `PlayView` to what the table shows: which actions
 * lead, which wait behind "everything possible", the dialogue a speaker has
 * open, the fight frame, the map plate. Nothing here talks to the world.
 */
import type {
	CombatState,
	DialogChoice,
	MapFrame,
	OfferedAction,
	SpeechState,
} from "@spellkave/ui-widgets";
import { chronicleFactsFromEvents, type PlayChronicleEntry } from "./play-chronicle";
import {
	type ChronicleFilterChip,
	conditionLabel,
	DOWNED_CONDITION_IDS,
	isDmInternalCondition,
	type PlayAction,
	type PlayOccupant,
	type PlaySessionToken,
	type PlaySpeech,
	type PlayView,
} from "./play-view";
import { playerTargetName } from "./player-copy";

const COMBAT_GROUP = "combat";

function baseLabel(action: PlayAction): string {
	const separator = " — ";
	const index = action.label.indexOf(separator);
	return (index === -1 ? action.label : action.label.slice(0, index)).trim().toLowerCase();
}

/** Play's prominence policy consumes semantic classes, never display labels. */
export function isFeaturedAction(action: PlayAction, inCombat = false): boolean {
	// A combat-classified offer alone does not make the current place a fight.
	// Outside a tactical session it remains reachable in the ordinary catalog,
	// but must not displace the next meaningful exploration action.
	if (action.group === COMBAT_GROUP || action.groups?.includes(COMBAT_GROUP)) return inCombat;
	if (action.verb === "communicate" || action.verb === "sensing") return true;
	// Existing SRD attack-family interpretation belongs to this app, not attachments.
	if (attackDescriptorFamily(action.descriptor) === "srd/attack") return inCombat;
	return false;
}

export function partitionActions(
	actions: readonly PlayAction[],
	inCombat = false,
): {
	featured: PlayAction[];
	rest: PlayAction[];
} {
	const featured: PlayAction[] = [];
	const rest: PlayAction[] = [];
	for (const action of actions) {
		if (isFeaturedAction(action, inCombat)) featured.push(action);
		else rest.push(action);
	}
	return { featured, rest };
}

/**
 * `"srd/attack/melee"` → `"srd/attack"`, `"srd/attack/unarmed-strike/damage"`
 * → `"srd/attack"` — a descriptor's capability family, its first two path
 * segments. ADR-0045 documents these as siblings of the same capability
 * (`srd/attack/{unarmed-strike/damage,opportunity-attack,melee,ranged}`),
 * so two actions sharing a family are the same kind of strike regardless of
 * which weapon (or none) backs the label.
 */
function attackDescriptorFamily(descriptor: string): string {
	return descriptor.split("/").slice(0, 2).join("/");
}

/** `PlayAction` → the widget's `OfferedAction` (verb stays the world's verb class). */
export function offeredAction(action: PlayAction): OfferedAction {
	const offered: OfferedAction = { id: action.id, label: action.label, verb: action.verb };
	if (action.description) offered.description = action.description;
	if (action.group !== undefined) offered.group = action.group;
	if (action.acceptsUtterance) {
		offered.takesWords = true;
		// The label may already carry the world's " — <target>" suffix; the
		// widget appends `target` too, which doubled it in play.
		if (action.targetName !== "" && !action.label.endsWith(` — ${action.targetName}`)) {
			offered.target = action.targetName;
		}
	}
	return offered;
}

export interface PlayDialogue {
	speakerId: string | null;
	dialog: SpeechState;
	/** The numbered answers, keyed by slot, to fire on choose. */
	choiceActions: Map<number, PlayAction>;
	/** The `Speak To <speaker>` action carrying free words, if offered. */
	sayAction: PlayAction | null;
	/** Ids of the actions the dialogue frame already presents. */
	consumed: Set<string>;
	/**
	 * The `PlaySpeech` line `dialog.prompt` was read from — the thread's own
	 * anchor for the numbered-answer chips ("the line that offered them",
	 * sk-jay0.1.8.12 task 3/4). `null` when the dialogue opened with no
	 * heard line at all (a fresh `Speak To` offer with nobody having spoken
	 * yet).
	 */
	anchorSpeechId: string | null;
}

/** Labels join structured source and response action identities only. */
function promptLabel(view: PlayView, action: PlayAction): string | undefined {
	const prompts =
		view.manipulationContext?.status === "ready" ? (view.manipulationContext.prompts ?? []) : [];
	const matching = prompts.filter(
		(prompt) =>
			!prompt.consumed &&
			prompt.sourceRef === action.targetRef &&
			prompt.responseActionIds.includes(action.actionId ?? action.descriptor),
	);
	return matching.length === 1
		? matching[0]?.presentation?.labels[action.actionId ?? action.descriptor]
		: undefined;
}

/**
 * The dialogue a speaker holds open: their latest words plus the numbered
 * answers the world offers toward them. Absent when nobody spoke and no
 * answer is offered.
 *
 * Talk is open when the world offers numbered answers, or when the last
 * heard line is still live: a `Speak To` action targets that same speaker,
 * and nothing else has happened in the world since they spoke (no event's
 * tick is newer than the line's). Absent both signals a lingering last line
 * is explore's own paper quote, not an open dialogue — without the second
 * clause the table showed Talk forever off one stale line the moment
 * anything else spoke or moved (sk-jay0.1.8.5 finding 3; a `Speak To`
 * affordance is offered whenever the speaker is present, live or not, so it
 * alone cannot carry this — recency is what actually distinguishes an
 * open exchange from an ambient one).
 */
export function dialogueFromView(view: PlayView): PlayDialogue | null {
	const allNumbered = view.actions.filter((action) => action.slot !== undefined);
	const lastHeard = [...view.speech].reverse().find((line) => !line.mine) ?? null;
	// Two speakers can hold open prompts at once (live rig: Aldwin's cellar
	// and Brother Caddoc's shrine, both "1: … 2: …"). The dialogue follows the
	// one who asked most recently — the same speaker the composer defaults
	// to — never merely the first numbered action the world happened to list.
	const numberedSpeakerIds = new Set(
		allNumbered.map((action) => action.targetRef.replace(/^entity:/, "")),
	);
	const lastAsker = [...view.speech]
		.reverse()
		.find(
			(line) => !line.mine && line.speakerId !== null && numberedSpeakerIds.has(line.speakerId),
		);
	const speakerId =
		lastAsker?.speakerId ||
		allNumbered[0]?.targetRef.replace(/^entity:/, "") ||
		lastHeard?.speakerId ||
		null;
	// Slot numbers are local to a conversation target, not global action keys.
	const numbered = allNumbered.filter(
		(action) => action.targetRef.replace(/^entity:/, "") === speakerId,
	);
	const speakerName =
		numbered[0]?.targetName ||
		lastHeard?.speaker ||
		(speakerId === null ? "" : view.occupants.find((entry) => entry.id === speakerId)?.name) ||
		"";
	const sayAction =
		view.actions.find(
			(action) =>
				action.acceptsUtterance &&
				(speakerId === null || action.targetRef === `entity:${speakerId}`),
		) ?? null;
	const latestEventTick = view.events.reduce((max, event) => Math.max(max, event.tick), -Infinity);
	const stillLive = lastHeard !== null && sayAction !== null && lastHeard.tick >= latestEventTick;
	if (numbered.length === 0 && !stillLive) return null;
	const spokenBySpeaker = [...view.speech]
		.reverse()
		.find((line) => !line.mine && (speakerId === null || line.speakerId === speakerId));
	const prompt = spokenBySpeaker?.text ?? lastHeard?.text ?? "";
	const choiceActions = new Map<number, PlayAction>();
	const choices: DialogChoice[] = numbered
		.map((action) => {
			const slot = action.slot ?? 0;
			choiceActions.set(slot, action);
			return { slot, text: promptLabel(view, action) ?? action.label };
		})
		.sort((a, b) => a.slot - b.slot);
	const consumed = new Set<string>(numbered.map((action) => action.id));
	if (sayAction !== null) consumed.add(sayAction.id);
	return {
		speakerId,
		dialog: {
			speaker: speakerName || "Someone",
			prompt: prompt || (choices.length > 0 ? "Waits for your answer." : ""),
			choices,
			sayEnabled: sayAction !== null,
			// The generic shell renders authored fields. Legacy conversation prose
			// cannot opt into a special name-entry control.
			nameField: false,
		},
		choiceActions,
		sayAction,
		consumed,
		anchorSpeechId: spokenBySpeaker?.id ?? lastHeard?.id ?? null,
	};
}

export interface SayTarget {
	/** The offered action this target fires when the field is submitted. */
	action: PlayAction;
	/** Chip label: the target's name, or "The room" for a broadcast. */
	label: string;
}

/**
 * Give a second words-taking handle for the same target a useful chip name.
 * The target name is the stable part of the chip; the action's own verb is
 * only a disambiguator ("Aldwin", then "Aldwin (whisper)"). Keeping the
 * action id on `SayTarget.action` is important: two handles may share a
 * target ref but dispatch through different world affordances.
 */
function sayTargetLabel(action: PlayAction, duplicate: boolean): string {
	const target = action.targetName || "The room";
	if (!duplicate) return target;
	const suffix = action.targetName === "" ? "" : ` — ${action.targetName}`;
	const verb = (
		suffix !== "" && action.label.endsWith(suffix)
			? action.label.slice(0, -suffix.length)
			: action.label
	)
		.trim()
		.replace(/\s+/g, " ");
	return verb === "" ? target : `${target} (${verb.toLowerCase()})`;
}

/**
 * Every `acceptsUtterance` action the world currently offers becomes one
 * target for the table's shared say field. This keeps distinct handles (for
 * example `Speak To` and `Whisper`) reachable even when they share a target
 * reference; the chip gets a verb suffix only when needed to distinguish a
 * duplicate target. The dialogue's own `Speak To` action, when a dialogue is
 * open, leads the list so the open speaker is the field's default target.
 */
export function sayTargetsFromView(view: PlayView, dialogue: PlayDialogue | null): SayTarget[] {
	const targets: SayTarget[] = [];
	const seenActionIds = new Set<string>();
	const targetCounts = new Map<string, number>();
	function push(action: PlayAction): void {
		// A dialogue's sayAction is normally also present in view.actions. Avoid
		// duplicating that exact handle, but never collapse distinct handles just
		// because they happen to address the same entity or room.
		if (seenActionIds.has(action.id)) return;
		seenActionIds.add(action.id);
		const key = action.targetName !== "" ? `target:${action.targetRef}` : "room";
		const duplicate = targetCounts.get(key) ?? 0;
		targetCounts.set(key, duplicate + 1);
		targets.push({ action, label: sayTargetLabel(action, duplicate > 0) });
	}
	if (dialogue?.sayAction) push(dialogue.sayAction);
	for (const action of view.actions) {
		if (action.acceptsUtterance) push(action);
	}
	return targets;
}

export type ThreadChipKind = "choice" | "action";

export interface ThreadChip {
	description?: string;
	kind: ThreadChipKind;
	/** The offered action id this chip fires through the table's own `onAct`. */
	actionId: string;
	slot?: number;
	label: string;
}

export interface ThreadLine {
	id: string;
	speakerId: string | null;
	/** "You" for the player's own lines, the world's speaker name otherwise. */
	speaker: string;
	mine: boolean;
	/** A choice line ("You · 5 Fighter"), never rendered as spoken words. */
	isChoice: boolean;
	text: string;
	addresseeName: string | null;
	/** True on the first line of a burst (a new speaker, or a hand-off
	 * between the world and the player) — the thread groups a burst under
	 * one name instead of repeating it per line. */
	startsBurst: boolean;
	chips: ThreadChip[];
}

/** Whether a speech line starts a new burst relative to the one right before
 * it: a different speaker, or a hand-off between the world and the player
 * (mine vs not). `previous` is `undefined` for the very first line, and also
 * for a speech line whose immediate predecessor in the rendered stream is
 * NOT speech at all (an activity or a place divider in the Explore stream —
 * sk-jay0.1.8.63.1) — either way a burst always starts fresh. Shared by
 * `threadFromView`'s `ThreadLine.startsBurst` and `exploreStreamFromView`'s
 * speech entries so the two derivations group bursts identically; do not
 * duplicate this rule at either call site. */
export function startsSpeechBurst(
	previous: { speakerId: string | null; mine: boolean } | undefined,
	current: { speakerId: string | null; mine: boolean },
): boolean {
	return (
		previous === undefined ||
		current.speakerId === null ||
		previous.speakerId !== current.speakerId ||
		previous.mine !== current.mine
	);
}

export interface ThreadResult {
	lines: ThreadLine[];
	/** Offered action ids the thread already renders as a line-bound chip —
	 * the caller's generic action list (`partitionActions`, the composer's
	 * "+" menu) must exclude these so nothing is offered twice. */
	claimedActionIds: Set<string>;
}

/** `dm/dialog/choice/…`, `srd/adopt-recommended-array`, … → `["adopt",
 * "recommended", "array"]` — words long enough to be a real cue, never the
 * generic "srd"/"dm" namespace segments a descriptor always carries. */
function descriptorKeywords(action: PlayAction): string[] {
	const stem = action.descriptor.split("/").pop() ?? "";
	return stem
		.split(/[-_]/)
		.map((word) => word.toLowerCase())
		.filter((word) => word.length > 3);
}

/** A currently-offered action that belongs to ONE of the speaker's own
 * lines, not the free "what you can do" tail — the DM's own array-adopt /
 * confirm / discard offers bundled beside a dialogue (sk-jay0.1.8.12 task
 * 4). Numbered answers are handled separately (`choiceActions`); a
 * `acceptsUtterance`/combat action never anchors to a line. */
function isLineBoundAction(action: PlayAction): boolean {
	if (action.slot !== undefined || action.acceptsUtterance || action.group === COMBAT_GROUP)
		return false;
	return /^(confirm|discard|adopt)\b/.test(baseLabel(action));
}

/** The current speaker's own contiguous run of lines ending at the anchor
 * (the burst the open prompt belongs to) — the only lines a line-bound chip
 * may attach to; a chip never reaches back past a hand-off to the player or
 * to someone else. Exported for `PlayTable.svelte`'s own
 * `alwaysAdmitIds` (sk-jay0.1.8.63.1 Part B): the same burst that anchors a
 * line-bound chip is what the unified stream must always admit, so the
 * player still sees the open prompt even when it predates the current
 * place's arrival. */
export function currentBurst(speech: readonly PlaySpeech[], anchorId: string): PlaySpeech[] {
	const anchorIndex = speech.findIndex((line) => line.id === anchorId);
	if (anchorIndex === -1) return [];
	const speakerId = speech[anchorIndex]?.speakerId ?? null;
	const burst: PlaySpeech[] = [];
	for (let index = anchorIndex; index >= 0; index -= 1) {
		const candidate = speech[index];
		if (candidate === undefined || candidate.mine || candidate.speakerId !== speakerId) break;
		burst.unshift(candidate);
	}
	return burst;
}

/** Which line, within the current burst, an offered action's own wording
 * belongs to — the newest burst line whose text shares one of the action's
 * descriptor keywords, falling back to the anchor line so the chip is never
 * lost, only mis-anchored, when no line matches (e.g. a burst the thread's
 * own `PLAY_SPEECH_LIMIT` window no longer holds in full). */
function lineForAction(burst: readonly PlaySpeech[], anchorId: string, action: PlayAction): string {
	const keywords = descriptorKeywords(action);
	for (let index = burst.length - 1; index >= 0; index -= 1) {
		const candidate = burst[index];
		if (candidate === undefined) continue;
		const lower = candidate.text.toLowerCase();
		if (keywords.some((word) => lower.includes(word))) return candidate.id;
	}
	return anchorId;
}

/**
 * The Talk scene's place channel as a thread (sk-jay0.1.8.12): the world-
 * ordered `view.speech` (already deduped and merged, see `mergeSpeech`),
 * grouped into bursts, with the numbered answers and any line-bound offered
 * action attached as chips under the line that offered them. Superseded
 * prompts from an earlier turn are not retained across calls (this is a
 * pure, stateless derivation, matching every other function in this file);
 * only the CURRENTLY open prompt's chips render — a deliberate, documented
 * simplification, not an oversight (see the bead's implementer report).
 */
export function threadFromView(view: PlayView): ThreadResult {
	const dialogue = dialogueFromView(view);
	const claimedActionIds = new Set<string>();
	const chipsByLineId = new Map<string, ThreadChip[]>();

	if (dialogue !== null && dialogue.anchorSpeechId !== null) {
		const choiceChips: ThreadChip[] = dialogue.dialog.choices.map((choice) => {
			const action = dialogue.choiceActions.get(choice.slot);
			if (action !== undefined) claimedActionIds.add(action.id);
			return {
				kind: "choice",
				actionId: action?.id ?? `slot:${choice.slot}`,
				slot: choice.slot,
				label: choice.text,
				...(action?.description ? { description: action.description } : {}),
			};
		});
		if (choiceChips.length > 0) chipsByLineId.set(dialogue.anchorSpeechId, choiceChips);

		if (dialogue.speakerId !== null) {
			const burst = currentBurst(view.speech, dialogue.anchorSpeechId);
			for (const action of view.actions) {
				if (!isLineBoundAction(action)) continue;
				if (action.targetRef !== `entity:${dialogue.speakerId}`) continue;
				const lineId = lineForAction(burst, dialogue.anchorSpeechId, action);
				const chip: ThreadChip = {
					kind: "action",
					actionId: action.id,
					label: action.label.replace(/ — .*$/, ""),
					...(action.description ? { description: action.description } : {}),
				};
				chipsByLineId.set(lineId, [...(chipsByLineId.get(lineId) ?? []), chip]);
				claimedActionIds.add(action.id);
			}
		}
	}

	const lines: ThreadLine[] = view.speech.map((line, index) => {
		const previous = view.speech[index - 1];
		const startsBurst = startsSpeechBurst(
			previous === undefined ? undefined : { speakerId: previous.speakerId, mine: previous.mine },
			{ speakerId: line.speakerId, mine: line.mine },
		);
		return {
			id: line.id,
			speakerId: line.speakerId,
			speaker: line.mine ? "You" : line.speaker,
			mine: line.mine,
			isChoice: line.choiceSlot !== undefined,
			text: line.choiceSlot === undefined ? line.text : line.text || `Answer ${line.choiceSlot}`,
			addresseeName: line.addresseeName ?? null,
			startsBurst,
			chips: chipsByLineId.get(line.id) ?? [],
		};
	});

	return { lines, claimedActionIds };
}

/**
 * The Talk dock's own three buckets (sk-jay0.1.8, round 3, "the Talk dock as
 * the decision point"): the open prompt's numbered answers (primary), any
 * line-bound offer bundled beside them (secondary), and everything else the
 * world currently offers (behind "More actions"). Pure over (view, dialogue)
 * alone — the same inputs `threadFromView` and `sayTargetsFromView` already
 * take — so every one of Talk's decision buckets is defined without reaching
 * into `PlayTable.svelte`'s own combat/pack/place context. Generic for every
 * conversation: nothing here is keyed on a particular speaker, descriptor, or
 * label text beyond the existing `isLineBoundAction` confirm/discard/adopt
 * pattern `threadFromView` already used for its own "action" chips.
 */
export interface TalkDock {
	/** The open prompt's numbered answers, in slot order. Each action's own
	 * `label` is overridden to `"<slot> <word>"` — the same text
	 * `threadFromView`'s chips already show — so the primary dock row reads
	 * identically to the (now stage-hidden) thread chip it replaces. Empty
	 * without an open dialogue. */
	answers: PlayAction[];
	/** Line-bound actions targeted at the open dialogue's speaker that are
	 * not numbered answers (today's thread "action" chips: "Adopt the
	 * recommended array", "Discard the drafted character", …), in world
	 * order. Empty without an open dialogue. */
	offers: PlayAction[];
	/** Every other currently offered action: neither an answer, an offer,
	 * nor the dialogue's own say action, in `partitionActions` order
	 * (featured before rest) — today's `featured` + `rest` behind "+ What
	 * you can do". This bucket only knows the dialogue itself; a caller with
	 * its own wider scoping (say-target collapsing across the whole view,
	 * live combat handles) should further exclude those ids before
	 * rendering — see `PlayTable.svelte`'s own dock assembly. */
	more: PlayAction[];
}

export function talkDockFromView(view: PlayView, dialogue: PlayDialogue | null): TalkDock {
	if (dialogue === null) {
		const { featured, rest } = partitionActions(view.actions);
		return { answers: [], offers: [], more: [...featured, ...rest] };
	}
	const answers: PlayAction[] = dialogue.dialog.choices
		.map((choice) => {
			const action = dialogue.choiceActions.get(choice.slot);
			return action === undefined ? null : { ...action, label: `${choice.slot} ${choice.text}` };
		})
		.filter((action): action is PlayAction => action !== null);
	const offers: PlayAction[] =
		dialogue.speakerId === null
			? []
			: view.actions
					.filter(
						(action) =>
							isLineBoundAction(action) && action.targetRef === `entity:${dialogue.speakerId}`,
					)
					// The dock already names the speaker (composer chip); the
					// " — <target>" suffix would only wrap every offer to two lines.
					// Same trim `threadFromView` applies to its action chips.
					.map((action) => ({ ...action, label: action.label.replace(/ — .*$/, "") }));
	const claimedIds = new Set<string>([
		...answers.map((action) => action.id),
		...offers.map((action) => action.id),
		...(dialogue.sayAction !== null ? [dialogue.sayAction.id] : []),
	]);
	const { featured, rest } = partitionActions(
		view.actions.filter((action) => !claimedIds.has(action.id)),
	);
	return { answers, offers, more: [...featured, ...rest] };
}

/**
 * Which of a thread's claimed action ids are actually reachable right now
 * (sk-jay0.1.8.12 verifier finding, card level): `threadFromView`'s own
 * `claimedActionIds` marks a line-bound action as claimed everywhere the
 * thread renders it as a chip — correct at stage, where every line is in
 * the DOM (`visibleLineIds: null`, everything counts). At card, though, the
 * caller renders only the last two lines; a burst whose line-bound chip
 * (e.g. "Adopt the recommended array") sits on an EARLIER line scrolled out
 * of that window still had the action excluded from the generic "+" menu by
 * the caller's own `remaining` filter — reachable at stage, unreachable at
 * card. A claim whose own line is not in `visibleLineIds` falls back OUT of
 * the claimed set here, so the caller's generic list picks it back up
 * instead of the action vanishing.
 */
export function claimedActionIdsForWindow(
	thread: ThreadResult,
	visibleLineIds: ReadonlySet<string> | null,
): Set<string> {
	if (visibleLineIds === null) return thread.claimedActionIds;
	const ids = new Set<string>();
	for (const line of thread.lines) {
		if (!visibleLineIds.has(line.id)) continue;
		for (const chip of line.chips) ids.add(chip.actionId);
	}
	return ids;
}

/** The fight frame: a live tactical session's roster and turn state.
 * Available combat-group offers alone are not a fight, hostility, or a
 * guaranteed outcome (sk-jay0.1.8.34.19). */
export function hasTacticalSession(view: PlayView): boolean {
	if (!view.session.inSession) return false;
	// Recorded legacy views predate authorized details. Live reads always set this field.
	if (view.turnSession === undefined) return true;
	return (
		view.turnSession !== null &&
		view.turnSession.id === view.session.id &&
		!view.turnSession.worldTimed &&
		view.turnSession.turnRule === "Sequential" &&
		view.actions.some((action) => action.group === COMBAT_GROUP)
	);
}

// The condition ids that put the hero down live in play-view.ts, so the
// chronicle's sentence reads the same set; re-exported for existing importers.
export { DOWNED_CONDITION_IDS };

/**
 * The Table's `downed` scene fact: true while the hero's own condition list
 * (`view.hero.conditions`, the YOU tile's source) carries a
 * `DOWNED_CONDITION_IDS` id. It does not look at HP: an unconscious hero
 * cannot act whatever their hit points. `PlayTable.svelte` ranks the 'Down'
 * scene above Talk on it and tells the composer the hero cannot act now.
 */
export function heroDownedFromView(view: Pick<PlayView, "hero">): boolean {
	return view.hero.conditions.some((id) => DOWNED_CONDITION_IDS.has(id));
}

/** A `…/dead` condition id — the same pattern `play-view.ts`'s own
 * `occupantNote` tests, kept local here rather than exported since only the
 * dead/other split below needs it. */
const DEAD_CONDITION_PATTERN = /\/dead$/;

/**
 * A roster member's own co-located `spellkave_scene` occupant's disclosed
 * conditions, regrouped for the tracker chip (S5, sk-jay0.1.8.41, design
 * doc §9/§10 row S5): "dead" becomes the chip's own strike-through flag
 * instead of a glyph token (matching the Occupants widget's "Dead"
 * wording); every other disclosed, non-DM-internal condition becomes a
 * `{id, label}` pair, `conditionLabel` resolving the same player-facing
 * text `play-view.ts` and the Occupants widget's own note already use. No
 * occupant match (not co-located this tick, or the scene read never
 * disclosed it) ⇒ neither — never invented.
 */
function rosterConditions(
	occupants: readonly PlayOccupant[],
	actorId: string,
): { dead: boolean; conditions: { id: string; label: string }[] } {
	const occupant = occupants.find((candidate) => candidate.id === actorId);
	if (occupant === undefined) return { dead: false, conditions: [] };
	const dead = occupant.conditions.some((id) => DEAD_CONDITION_PATTERN.test(id));
	const conditions = occupant.conditions
		.filter((id) => !DEAD_CONDITION_PATTERN.test(id) && !isDmInternalCondition(id))
		.map((id) => ({ id, label: conditionLabel(id) }));
	return { dead, conditions };
}

export function combatFromView(view: PlayView): CombatState | null {
	const session = view.session;
	if (!hasTacticalSession(view)) return null;
	const others = session.roster.filter((entry) => !entry.isMe);
	const enemy =
		(session.currentActorName && session.currentActor !== view.hero.actorId
			? session.currentActorName
			: others[0]?.name) ?? "The fight";
	const status = session.myTurn
		? "Your turn. Strike, step, or end it — the others wait on you."
		: session.currentActorName === null
			? "The fight is open. Waiting on the world."
			: `${session.currentActorName} acts. Your turn comes around the table.`;
	return {
		mode: session.myTurn ? "your-turn" : "waiting",
		enemy,
		status,
		roster: session.roster.map((entry) => {
			const { dead, conditions } = rosterConditions(view.occupants, entry.actorId);
			return {
				name: entry.name,
				ordinal: entry.ordinal,
				isMe: entry.isMe,
				isCurrent: entry.isCurrent,
				...(dead ? { dead: true } : {}),
				...(conditions.length > 0 ? { conditions } : {}),
			};
		}),
	};
}

export function mapFrameFromView(view: PlayView, svg: string | undefined): MapFrame {
	const placeName = view.place?.name ?? "Between places";
	const frame: MapFrame = {
		mode: hasTacticalSession(view) ? "full" : "peek",
		placeName,
		state: view.mapState,
		description: view.place?.description,
		nearby: view.place?.exits.map((exit) => exit.toName),
		focusNodeId: view.place?.id,
		nearbyNodeIds: view.place?.exits.flatMap((exit) => (exit.toNodeId ? [exit.toNodeId] : [])),
		caption: hasTacticalSession(view)
			? "The battle grid, as the world lays it out."
			: svg === undefined
				? "No map is drawn for this place yet."
				: "What you know of the ground around you.",
	};
	if (svg !== undefined) frame.svg = svg;
	return frame;
}

/**
 * `view.sessionTokens` (sk-jay0.4.2) grouped by cell — a battle-map widget's
 * own lookup for "which tokens sit on this node", never a re-derivation of
 * the roster or a wider scan. Multiple tokens may share one node (a shoved
 * combatant occupying the same cell as its attacker, say); insertion order
 * within a cell follows `view.sessionTokens`' own order.
 */
export function tokensByNode(view: PlayView): Map<string, PlaySessionToken[]> {
	const byNode = new Map<string, PlaySessionToken[]>();
	for (const token of view.sessionTokens ?? []) {
		const existing = byNode.get(token.nodeId);
		if (existing === undefined) byNode.set(token.nodeId, [token]);
		else existing.push(token);
	}
	return byNode;
}

/**
 * The drawn cell a given roster actor stands on, or `null` when that actor
 * carries no token this map (not placed, or `view.sessionTokens` is empty —
 * no tactical session, or a participant staged outside the drawn set;
 * `sessionRosterOccupants`'s own doc comment on the tool side).
 */
export function nodeOfActor(view: PlayView, actorId: string): string | null {
	// Tokens are a fight's own placement. A view can still carry the last
	// session's tokens for a moment after it closed; read then, a creature
	// that is still in the room resolved to a grid cell that no longer
	// exists, and selecting it showed the player's own place instead (seen
	// live: the fallen Crypt Warden became "Here", sk-jay0.1.8.63.44).
	if (!hasTacticalSession(view)) return null;
	return (view.sessionTokens ?? []).find((token) => token.actorId === actorId)?.nodeId ?? null;
}

/**
 * One target's own row in the turn bar: a stable identity (`targetRef`, the
 * offered actions' own `PlayAction.targetRef` — never invented here), a
 * label to show on the chip, and the verbs offered against it. `S3
 * (sk-jay0.1.8.39)`.
 */
export interface TargetGroup {
	/** The `PlayAction.targetRef` every action in this group shares (e.g.
	 * `"entity:123"`), or `UNTARGETED_TARGET_REF` for the group that holds
	 * actions with no target name at all. */
	targetRef: string;
	label: string;
	actions: PlayAction[];
}

/**
 * `TargetGroup.targetRef` for the group of actions with no target name
 * (Dodge, a self-only check) — distinct from every real `targetRef` string
 * the world sends (`"entity:<id>"`, `"item:<id>"`, …), so it never collides
 * with an offered target's own key.
 */
export const UNTARGETED_TARGET_REF = "";

/**
 * "More actions" as one flat list scaled with targets × verbs: a cellar with
 * four rats listed 91 rows. Group the catalog by target instead — the
 * untargeted offers first under "Here", then each named target in the order
 * the world listed it — so the disclosure reads as a few short lists.
 */
export function groupActionsByTarget(actions: readonly PlayAction[]): TargetGroup[] {
	const untargeted: PlayAction[] = [];
	const byRef = new Map<string, TargetGroup>();
	for (const action of actions) {
		if (action.targetName === "") {
			untargeted.push(action);
			continue;
		}
		const group = byRef.get(action.targetRef);
		if (group === undefined) {
			byRef.set(action.targetRef, {
				targetRef: action.targetRef,
				label: action.targetName,
				actions: [action],
			});
		} else {
			group.actions.push(action);
		}
	}
	const groups = [...byRef.values()];
	if (untargeted.length > 0)
		groups.unshift({ targetRef: UNTARGETED_TARGET_REF, label: "Here", actions: untargeted });
	return groups;
}

/**
 * The fight's offered `PlayAction`s regrouped by target (S3,
 * sk-jay0.1.8.39, design doc §6 item 4 / §10 row S3): roster members first,
 * in the tracker's own ordinal order (`view.session.roster`, already
 * ordinal-sorted by `sessionFromPayload`, play-view.ts — the same ordering
 * `combatFromView` renders the strip in; that function's own `roster` field
 * drops `actorId`, so this reads `view.session.roster` directly instead of
 * going through it), then any other named target the offered actions
 * carry (first-offered order), then one trailing "untargeted" group for
 * actions with no target name (Dodge; a self-only check like "Check:
 * Arcana" whose `targetRef` still names the acting entity itself, e.g.
 * `entity:7` for the hero's own Dodge, but whose `targetName` is empty —
 * that emptiness, not the ref, is what "no target" means here).
 *
 * Target identity is never invented: it is `PlayAction.targetRef`/
 * `targetName` exactly as the factual-context mapper already sets them
 * (`str(item, "target_ref")`, `presentableTarget(str(item, "target"))`,
 * play-view.ts) — the same fields today's flat action list already uses to
 * build a label like "Melee Attack — Cellar Rat 1" (`actionLabel`) and the
 * same shape `combatFromView` would have to read if it looked at actions
 * instead of the roster to find "the enemy". Selecting a chip is the
 * caller's own client state, never persisted here; the handle a caller
 * dispatches through `onAct` is still the world's own `action.id`,
 * unchanged.
 *
 * Scoped to a live tactical session (`hasTacticalSession`): outside a
 * fight every offered action already reaches the player through the
 * ordinary Actions palette (`partitionActions`), so grouping by target
 * would only be noise. `combatHandles` below relies on this gate too — see
 * its own comment for why every action counts as a "combat handle" here.
 */
export function targetsFromView(view: PlayView): TargetGroup[] {
	if (!hasTacticalSession(view)) return [];
	const actionsByRef = new Map<string, PlayAction[]>();
	const labelByRef = new Map<string, string>();
	const untargeted: PlayAction[] = [];
	for (const action of view.actions) {
		// Free text remains the single shared composer, even in a tactical
		// session. The SRD's actor-carried `srd/speak-aloud` has sometimes
		// arrived with `verb_class: manipulate`; `acceptsUtterance` is already the
		// descriptor-aware normalization boundary, so never infer another
		// combat verb row from that transport classification here.
		if (action.acceptsUtterance) continue;
		if (action.targetName === "") {
			untargeted.push(action);
			continue;
		}
		const existing = actionsByRef.get(action.targetRef);
		if (existing === undefined) {
			actionsByRef.set(action.targetRef, [action]);
			labelByRef.set(action.targetRef, action.targetName);
		} else {
			existing.push(action);
		}
	}
	const groups: TargetGroup[] = [];
	const claimedRefs = new Set<string>();
	for (const entry of view.session.roster) {
		const targetRef = `entity:${entry.actorId}`;
		const actions = actionsByRef.get(targetRef);
		if (actions === undefined) continue;
		groups.push({ targetRef, label: labelByRef.get(targetRef) ?? entry.name, actions });
		claimedRefs.add(targetRef);
	}
	for (const [targetRef, actions] of actionsByRef) {
		if (claimedRefs.has(targetRef)) continue;
		// `labelByRef` is filled with every key of `actionsByRef` above; the
		// fallback is unreachable and, like every label here, never a raw ref.
		groups.push({
			targetRef,
			label: playerTargetName(labelByRef.get(targetRef), targetRef),
			actions,
		});
	}
	if (untargeted.length > 0) {
		groups.push({ targetRef: UNTARGETED_TARGET_REF, label: "No target", actions: untargeted });
	}
	return groups;
}

/** The one group's own verbs — `targetsFromView(view)` filtered to the
 * chip the caller selected. Empty when the target key names no group
 * (nothing offered against it right now, or the session left combat). */
export function verbsForTarget(view: PlayView, targetRef: string): PlayAction[] {
	return targetsFromView(view).find((group) => group.targetRef === targetRef)?.actions ?? [];
}

/**
 * Every offered action id the turn bar already renders as a `TargetGroup`
 * row — what the Actions palette (`partitionActions`'s callers) must hide
 * so nothing is offered twice (S3 acceptance: "the cross product of
 * buttons is gone"). Outside a tactical session this is empty, so the
 * palette is untouched.
 *
 * Inside one, it is every non-free-text action the fight offers. Free-text
 * speech is the one known exception: it belongs to `sayTargetsFromView` and
 * the shared composer, not a target-first turn-bar verb button. Everything
 * else remains partitioned by `targetsFromView` exactly as supplied.
 */
export function combatHandles(view: PlayView): Set<string> {
	const ids = new Set<string>();
	for (const group of targetsFromView(view)) {
		for (const action of group.actions) ids.add(action.id);
	}
	return ids;
}

/**
 * The action's own display name — the part of `action.label` before the
 * world's own " — <target>" suffix (`actionLabel`, play-view.ts ~line 958)
 * — for the turn bar's verb button (S3): the target is already the
 * selected chip, so the button need not repeat it. Strips the exact
 * `" — ${action.targetName}"` suffix `actionLabel` appends, and only when
 * the label actually ends with it — `actionLabel` skips the suffix
 * entirely when the display name already mentions the target
 * case-insensitively, so a label like that (or any label with no target
 * name at all, e.g. Dodge) is returned unchanged rather than mis-trimmed.
 * `action.label` itself stays the caller's own accessible name
 * (`aria-label`/`title`) — this is presentation only, never a replacement
 * for it.
 */
export function verbName(action: PlayAction): string {
	if (action.targetName === "") return action.label;
	const suffix = ` — ${action.targetName}`;
	return action.label.endsWith(suffix) ? action.label.slice(0, -suffix.length) : action.label;
}

/**
 * One piece of the "who's nearby" sentence: a `"name"` part carries the
 * occupant id it names (for a caller that wants to turn it into a handle to
 * that occupant's own detail — sk-jay0.1.8.63.7), a `"text"` part is
 * connective prose ("`and`", "`, `", "`are nearby`") that is never a link.
 * Joining every part's `text` in order reproduces the exact sentence this
 * function's own predecessor (the now-removed, flat `nearbyProse` helper)
 * always rendered — this is that same sentence, structured instead of
 * flattened, not a different one.
 */
export interface CompanyPart {
	kind: "name" | "text";
	text: string;
	/** Set only on a `"name"` part. */
	occupantId?: string;
}

/** "Aldwin" → "Aldwin is nearby"; "Aldwin", "Mira" → "Aldwin and Mira are
 * nearby"; three or more → "Aldwin, Mira and 2 more are nearby" — each name
 * its own part, so a caller can turn it into a handle without re-parsing the
 * joined prose. `null` for an empty list — the caller omits the right side
 * entirely rather than showing an empty sentence. */
export function companyPartsFromOccupants(
	occupants: readonly { id: string; name: string }[],
): CompanyPart[] | null {
	if (occupants.length === 0) return null;
	const name = (occupant: { id: string; name: string }): CompanyPart => ({
		kind: "name",
		occupantId: occupant.id,
		text: occupant.name,
	});
	const text = (value: string): CompanyPart => ({ kind: "text", text: value });
	const [first, second] = occupants;
	if (first === undefined) return null;
	if (occupants.length === 1) return [name(first), text(" is nearby")];
	if (second === undefined) return [name(first), text(" is nearby")];
	if (occupants.length === 2)
		return [name(first), text(" and "), name(second), text(" are nearby")];
	return [
		name(first),
		text(", "),
		name(second),
		text(` and ${occupants.length - 2} more are nearby`),
	];
}

/** Joining every part's `text` reproduces the exact sentence
 * `companyPartsFromOccupants` describes — the one way this module derives
 * `ExploreContext.company` (plain text, for a caller that has no use for the
 * per-name handles) from the structured form, so the two can never drift
 * apart from each other. */
function companyPartsToText(parts: readonly CompanyPart[]): string {
	return parts.map((part) => part.text).join("");
}

/** The Table design note's stable "PLACE / STAGE CONTEXT" line: the place
 * name, and prose naming who else is here — never a raw list or an id. */
export interface ExploreContext {
	placeName: string;
	/** `companyPartsFromOccupants` of the occupants currently addressable
	 * through the shared say composer (`sayTargetsFromView`'s own targets —
	 * the same "relevant" the composer and Talk's own participant head
	 * already use), excluding the player, flattened to plain text. `null`
	 * when nobody addressable is here. */
	company: string | null;
	/** The same occupants, structured (sk-jay0.1.8.63.7): each name carries
	 * the occupant id a caller can open a detail reader against. `null`
	 * exactly when `company` is `null`. */
	companyParts: CompanyPart[] | null;
}

/**
 * "Where am I, who/what is relevant" (Table design note) — never every
 * occupant in the scene, only the ones the world currently lets the player
 * address, since that is what "relevant" already means everywhere else on
 * this tile. Two consumers (sk-jay0.1.8.63.5): the card level's own
 * non-scrolling context header, and — for the stage's place rows —
 * `exploreStreamFromView`'s own newest-entry-only `company`/`companyParts`
 * fields.
 */
export function exploreContextFromView(view: PlayView): ExploreContext {
	const targets = sayTargetsFromView(view, null);
	const addressableIds = new Set(
		targets
			.map((target) => target.action.targetRef)
			.filter((ref) => ref.startsWith("entity:"))
			.map((ref) => ref.slice("entity:".length)),
	);
	const present = view.occupants
		.filter((occupant) => occupant.id !== view.hero.actorId && addressableIds.has(occupant.id))
		.map((occupant) => ({ id: occupant.id, name: occupant.name }));
	const parts = companyPartsFromOccupants(present);
	return {
		placeName: view.place?.name ?? "Between places",
		company: parts === null ? null : companyPartsToText(parts),
		companyParts: parts,
	};
}

/**
 * The player's own local record of one returned action, kept client-side
 * because Explore has no world-confirmed stream of its own the way Talk's
 * `view.speech` is (sk-jay0.1.8, Table design note). `words` is set only
 * when this activity records a say — the raw spoken text, kept so
 * `exploreStreamFromView` can recognise the world's own echo of the SAME
 * words as a duplicate rather than a second line. `tick` is the best
 * available current-world-tick reading at record time (`PlayTable.svelte`'s
 * `currentTrailTick`, the same max-of-events/speech reading the trail
 * already uses) — never a client wall-clock timestamp, which the world does
 * not share. Two activities recorded on the same tick (no world tick moved
 * between them) keep their append order: `exploreStreamFromView`'s sort is
 * stable, so ties never reorder.
 */
/** One entered input-field value as the stream shows it. */
export interface ExploreActivityDisplayValue {
	/** The field's own authored label ("Name"). */
	label: string;
	value: string;
}

/** "Name: Brannoch", several fields joined as "Strength: 15 · Dexterity: 12".
 * A field without a label shows its value alone; an empty value is left
 * out. */
export function inputDisplayText(display: readonly ExploreActivityDisplayValue[]): string {
	return display
		.filter((field) => field.value.trim() !== "")
		.map((field) =>
			field.label.trim() === ""
				? field.value.trim()
				: `${field.label.trim()}: ${field.value.trim()}`,
		)
		.join(" · ");
}

export interface ExploreActivity {
	id: string;
	placeId: string | null;
	action: string;
	outcome: string;
	tick: number;
	/** Local record order, shared with place dividers: see
	 * `ExplorePlaceDivider.recordSeq`. */
	recordSeq?: number;
	words?: string;
	/**
	 * What the player entered into an action's input fields, as labelled
	 * values in field order (sk-jay0.1.8.96, sk-jay0.1.8.92). When set, the
	 * row is an ordinary activity (heading = the action's label, body =
	 * "Label: value" per field), never a "You" speech bubble — even if
	 * `words` is also set, since the utterance of an input-field action is
	 * only the transport for those values (a JSON string). Free speech (the
	 * Talk slot, a words-taking action without input fields) leaves this
	 * unset and keeps its speech behaviour.
	 */
	display?: readonly ExploreActivityDisplayValue[];
	/** The selected conversation target at dispatch time. This is local UI
	 * provenance until the world confirms the matching speech trace, whose own
	 * addressee then carries the same information. */
	addresseeName?: string;
	/** A local composer route with no named entity: room speech and self speech
	 * are still meaningful destinations, unlike an older trace that simply
	 * omitted addressee data. */
	addressing?: "room" | "self";
	/** The world's own raw refusal code (and, when present, its
	 * `failure_detail`) for a rejected/failed outcome — sk-j8e.4: kept
	 * alongside the already-rendered prose so the stream's ⓘ hover can show
	 * the engine's own reason a blind player otherwise cannot learn. */
	refusal?: { code: string; detail?: string };
}

/** How many of the player's own local `ExploreActivity` rows, place-arrival
 * dividers, `view.speech` tail lines and (sk-jay0.1.8.63.2) accumulated
 * world events `exploreStreamFromView` folds into the Explore chronology
 * (`PlayTable.svelte`'s own recording rings). One continuous journal spans
 * every place visited this session (sk-jay0.1.8.60), not just the current
 * one, so one generous bound serves all four rings — there is no longer a
 * reason for activities, speech and events to carry separate limits. */
export const EXPLORE_ACTIVITY_LIMIT = 1000;

/** One line of the Explore chronology (Table design note): the player's own
 * local outcomes, the world's heard speech and place-arrival dividers
 * (sk-jay0.1.8.60), merged into one world-tick-ordered stream — never
 * separate per-place lists. `heading` is the line's own lead text (a local
 * action's line, a speaker's name — "You" for the player's own stray speech
 * — or a place's name for a divider); `body` is the secondary line (an
 * activity's outcome, or a speech line's words), always `null` for a
 * divider. */
export interface ExploreStreamEntry {
	id: string;
	kind: "activity" | "speech" | "place" | "event";
	tick: number;
	heading: string;
	body: string | null;
	/** Carried straight from the recorded `ExploreActivity`, `undefined` for
	 * every speech/place/event entry and every activity that was not a
	 * refusal. */
	refusal?: { code: string; detail?: string };
	/**
	 * Stream category. World events reuse `chronicleKindRule` via
	 * `chronicleFactsFromEvents`; speech and spoken activities use Speech,
	 * other local activities use Things. Place dividers use Comings at render.
	 */
	chip?: ChronicleFilterChip;
	/**
	 * Event-entry-only: `chronicleKindRule(kind).important` — an important
	 * fact (a hit, a condition, a session opening) renders at normal weight;
	 * everything else (a turn transition, a resource spend) renders muted,
	 * matching the Chronicle card's own importance split. `undefined` on
	 * every other entry kind.
	 */
	important?: boolean;
	/**
	 * Speech-entry-only fields (sk-jay0.1.8.63.1), `undefined` on every
	 * activity/place entry: the same line-form data `ThreadLine` carries, so
	 * a non-mine speech entry can render as a Thread-style burst (speaker
	 * heading once, "to <name>", "Chose ·") instead of the flat
	 * `heading`/`body` pair above. `mine`/`heading`/`body` keep their
	 * existing meaning (the player's own line still reads "You said
	 * "…""); `speaker` mirrors `ThreadLine.speaker` ("You" for mine lines).
	 * `startsBurst` follows `startsSpeechBurst`, but is also reset by any
	 * non-speech entry (an activity or a place divider) between two speech
	 * lines — the one way this burst rule differs from Talk's, where every
	 * line is speech.
	 */
	mine?: boolean;
	speaker?: string;
	/** The speech entry's own `PlaySpeech.speakerId`, carried straight
	 * through (sk-jay0.1.8.63.7) so a caller can tell whether `speaker`
	 * names someone still present — and, if so, open their detail — without
	 * a name-string lookup back into `view.occupants`. `undefined` on every
	 * non-speech entry; `null` on a speech entry the world itself reported
	 * with no speaker id. */
	speakerId?: string | null;
	addresseeName?: string | null;
	/** Local composer routing retained until (and independently of) a world
	 * speech trace. Absent means the world gave no route information. */
	addressing?: "room" | "self";
	/** A local speech attempt's outcome, retained next to its structured
	 * speaker/addressee/text fields when the world did not confirm it. */
	outcome?: string | null;
	isChoice?: boolean;
	startsBurst?: boolean;
	/**
	 * Place-entry-only (sk-jay0.1.8.63.5): who is currently addressable here,
	 * exactly `exploreContextFromView(view).company`. Set on the NEWEST
	 * `"place"` entry only — an older arrival's own divider names a place the
	 * player has since left, so it never claims who is present now (the
	 * Table's section-header rows render this as their own trailing
	 * detail; see `PlayTable.svelte`'s `exploreStreamLine`). `undefined` on
	 * every other entry, and on the newest place entry too when nobody is
	 * currently addressable.
	 */
	company?: string;
	/** The same newest-place-entry-only rule as `company`, structured
	 * (sk-jay0.1.8.63.7): `exploreContextFromView(view).companyParts`, so the
	 * place header can turn each name into a detail-reader handle. */
	companyParts?: CompanyPart[];
}

/**
 * One place-arrival divider (sk-jay0.1.8.60): recorded by `PlayTable.svelte`
 * every time the observed place changes — including the very first
 * observation, so the journal always opens with where the player is, never a
 * blank page waiting for a first move. `tick` is the same
 * best-available-current-world-tick reading `ExploreActivity.tick` uses.
 */
export interface ExplorePlaceDivider {
	id: string;
	placeId: string | null;
	placeName: string;
	tick: number;
	/**
	 * The position of this entry in the ONE counter the recorder
	 * (`PlayTable.svelte`) shares between place dividers and local activities
	 * (sk-jay0.1.8.96 s10, owner decision 2026-11-12): each recorded local
	 * entry takes the next number. `exploreStreamFromView` uses it only to
	 * order two LOCAL entries that share a tick, so an attempt made before
	 * leaving stays above the divider of the place then entered. It is never
	 * compared with a world line: world lines keep their order and stay below
	 * the divider of their tick (`keepLocalRecordOrder`). Optional: an entry
	 * without it keeps the kind order.
	 */
	recordSeq?: number;
}

/**
 * Puts the local entries of one tick back into the order they were recorded
 * in (`recordSeq`). `merged` is already sorted by `sortKey`, and inside each
 * run of equal keys by kind: place dividers, heard speech, world events, own
 * activities. That kind order already files the world lines of a tick under
 * the place opened on that tick and above what the player did there.
 *
 * Only one thing is out of recorded order in such a run: an own entry
 * recorded BEFORE a divider of the same tick (an attempt made before
 * leaving) sits below that divider. So only those entries move. Each goes,
 * in recorded order, among the dividers at the head of the run, directly
 * above the first divider recorded after it. Nothing else changes place:
 *
 * - the world lines keep their order and stay below every divider of the
 *   tick, so a line heard on arrival never reads above the place it was
 *   heard in, and no world line is re-sequenced against another;
 * - an own entry recorded after the last divider stays below the world
 *   lines, as before;
 * - an entry without a number keeps its kind slot.
 *
 * An attempt made before leaving therefore reads above the world lines of
 * that tick. That is the kind order's own reading of them (they belong to
 * the place entered), not a recorded fact: Play has no order between a local
 * entry and a world line on one tick.
 */
function keepLocalRecordOrder(
	merged: readonly ExploreStreamEntry[],
	sortKey: (entry: ExploreStreamEntry) => number,
	recordSeqById: ReadonlyMap<string, number>,
): ExploreStreamEntry[] {
	if (recordSeqById.size < 2) return [...merged];
	const seqOf = (entry: ExploreStreamEntry): number | undefined => recordSeqById.get(entry.id);
	const ordered: ExploreStreamEntry[] = [];
	let start = 0;
	while (start < merged.length) {
		const key = sortKey(merged[start] as ExploreStreamEntry);
		let end = start + 1;
		while (end < merged.length && sortKey(merged[end] as ExploreStreamEntry) === key) end += 1;
		const run = merged.slice(start, end);
		start = end;
		const lastDividerSeq = Math.max(
			-1,
			...run.filter((entry) => entry.kind === "place").map((entry) => seqOf(entry) ?? -1),
		);
		const isEarlyOwn = (entry: ExploreStreamEntry): boolean => {
			const seq = seqOf(entry);
			return entry.kind !== "place" && seq !== undefined && seq < lastDividerSeq;
		};
		if (!run.some(isEarlyOwn)) {
			ordered.push(...run);
			continue;
		}
		// Dividers without a number keep the very front (their kind slot); the
		// numbered ones and the early own entries follow in recorded order.
		const numberedHead = run
			.filter(
				(entry) => (entry.kind === "place" && seqOf(entry) !== undefined) || isEarlyOwn(entry),
			)
			.sort((x, y) => (seqOf(x) ?? 0) - (seqOf(y) ?? 0));
		ordered.push(
			...run.filter((entry) => entry.kind === "place" && seqOf(entry) === undefined),
			...numberedHead,
			...run.filter((entry) => entry.kind !== "place" && !isEarlyOwn(entry)),
		);
	}
	return ordered;
}

/** Optional inputs to `exploreStreamFromView` beyond the required
 * activities: the place-arrival dividers to fold in, and the speech
 * retention state that makes "once shown, never removed" possible. */
export interface ExploreStreamOptions {
	/** The folded Chronicle must retain every authorized speech line, including
	 * backfill from speakers who have since left. Preserve its true world tick. */
	includeRetainedSpeech?: boolean;
	/** Place-arrival dividers, in the order `PlayTable.svelte` recorded them
	 * — folded in exactly like `activities`, bounded the same way. */
	dividers?: readonly ExplorePlaceDivider[];
	/**
	 * Ids of `view.speech` lines the journal has already admitted in an
	 * earlier call this visit (sk-jay0.1.8.60, "speech never disappears"):
	 * once a line's id is in this set, it stays in the stream even after its
	 * speaker has left or the arrival window that first admitted it
	 * (`sinceTick`) has moved on to a later place. The admission RULE below
	 * only decides whether a line NOT already in this set gets pulled in
	 * now — never whether an already-admitted line stays. The caller grows
	 * this set from the speech entries this function already returned; the
	 * function itself never mutates it.
	 */
	admittedSpeechIds?: ReadonlySet<string>;
	/** Speech heard before this world tick belongs to a place the player has
	 * since left, so it does not get admitted the FIRST time (an already-
	 * admitted line is unaffected — see `admittedSpeechIds`). `null` (a
	 * reload, no arrival observed yet) keeps present speakers only. */
	sinceTick?: number | null;
	/**
	 * Ids of `view.speech` lines admitted regardless of `sinceTick`/presence
	 * (sk-jay0.1.8.63.1 Part B, "Talk still shows the open prompt"): the
	 * Table's own Talk scene now renders through this one stream, but a
	 * present speaker's open prompt can predate the player's arrival at this
	 * place (the session backfills it from traces) — Talk's dialogue must
	 * still surface it even though the ordinary admission rule (present-or-
	 * heard-since-arrival) would otherwise hold it back. The caller passes
	 * the current dialogue's open burst (`currentBurst` at its own
	 * `anchorSpeechId`); a line admitted only through this set, rather than
	 * the ordinary rule, sorts as though it arrived right after the newest
	 * place row instead of at its own true (pre-arrival) tick — see the
	 * function body for why. `tick` on the returned entry is never altered,
	 * only its position in the merged/sorted stream.
	 */
	alwaysAdmitIds?: ReadonlySet<string>;
	/**
	 * Non-speech world facts to fold in as `"event"` entries (sk-jay0.1.8.63.2):
	 * `view.events` is a bounded 40-entry ring (`PLAY_CHRONICLE_LIMIT`,
	 * play-chronicle.ts), so the caller (`PlayTable.svelte`) accumulates every
	 * event it has ever seen this visit — the same "once shown, never
	 * removed" contract `admittedSpeechIds` already gives speech — and passes
	 * that growing array here. This function stays pure: it only ever reads
	 * the accumulated array, it never remembers one itself. Defaults to
	 * empty, so every existing caller (and every existing test) that predates
	 * this option keeps seeing no event entries at all.
	 */
	events?: readonly PlayChronicleEntry[];
}

/**
 * One `ExploreStreamEntry` per non-speech world fact, reusing the
 * Chronicle's own classification (`chronicleFactsFromEvents`,
 * play-chronicle.ts) rather than a second kind→chip/important table — the two
 * surfaces must never drift apart on what "fight"/"comings"/"things" means,
 * or how important a kind is. `body` is always `null`: every fact the
 * Chronicle renders is one finished sentence (`chronicleSentence`,
 * play-chronicle.ts — Play's own, free of entity and template ids), so there
 * is no secondary line to split it into, unlike a local activity's own
 * heading/outcome pair. `names` (the current session roster) only fills in
 * an actor that had no name when its event was ingested.
 */
function eventStreamEntries(
	events: readonly PlayChronicleEntry[],
	names: ReadonlyMap<string, string>,
): ExploreStreamEntry[] {
	return chronicleFactsFromEvents(events, names).map((fact) => ({
		id: fact.id,
		kind: "event",
		tick: fact.tick,
		heading: fact.summary,
		body: null,
		chip: fact.chip,
		important: fact.important,
	}));
}

/**
 * The target name off an activity's own heading ("Melee Attack — Goblin
 * Minion 1" → "Goblin Minion 1") — the same " — <target>" suffix
 * `actionLabel` (play-view.ts) appends and `verbName` above strips. `null`
 * for an untargeted heading (Dodge, a spoken or travel line), which never has
 * a matching world event to begin with.
 */
function activityTargetName(heading: string): string | null {
	const separator = " — ";
	const index = heading.indexOf(separator);
	return index === -1 ? null : heading.slice(index + separator.length).trim();
}

/**
 * The two event kinds that carry the SAME numbers a matching local activity
 * already summarised in prose. Both fire only when THIS actor is the source
 * (`isCausedByActor`, `@spellkave/world-events`) — `dealt_hit`/
 * `dealt_condition` are always the player's own action's consequence, never
 * an NPC's, so no attacker check is needed here beyond the tick/target match
 * below.
 */
const ACTIVITY_DUPLICATE_EVENT_KINDS: ReadonlySet<string> = new Set([
	"dealt_hit",
	"dealt_condition",
]);

/**
 * The sk-jay0.1.8.63.2 duplicate rule (task 4 below): an own attack yields
 * BOTH a local activity line ("Melee Attack — Goblin Minion 1 · You hit…")
 * and a world event (`dealt_hit`, "You hit Goblin Minion 1 for 4 damage.").
 * The world event carries the real numbers, so it wins — `exploreStreamFromView`
 * drops the activity's own outcome BODY when this returns true, keeping only
 * its heading ("what I did"); the event line supplies the rest. Matched by
 * target NAME, not id (the activity's own heading carries only a name): an
 * ingested entry's structured `fields.targetName` is compared, and a
 * hand-built entry without `fields` (a fixture, an older recording) has its
 * summary text searched for the name instead. This legacy activity
 * deduplication does not supply answer labels; those use structured prompts. A refusal never reaches this check
 * (`exploreStreamFromView` only calls it for a non-refusal activity): a
 * refused act keeps its own reason and never produces a `dealt_hit`/
 * `dealt_condition` event to match anyway.
 */
function hasMatchingWorldEvent(
	tick: number,
	targetName: string,
	events: readonly PlayChronicleEntry[],
): boolean {
	const needle = targetName.toLowerCase();
	return events.some(
		(event) =>
			event.tick === tick &&
			ACTIVITY_DUPLICATE_EVENT_KINDS.has(event.kind) &&
			(event.fields?.targetName ?? event.summary).toLowerCase().includes(needle),
	);
}

/**
 * Folds the player's local `ExploreActivity` rows, `PlayTable.svelte`'s
 * place-arrival dividers, the world's `view.speech`, and (sk-jay0.1.8.63.2)
 * its accumulated non-speech world events into the one continuous journal
 * the Table design note calls for — one chronology across every place
 * visited this session (sk-jay0.1.8.60), not scoped to whichever place is
 * current. Dedupe (deterministic):
 *
 * 1. A spoken local activity (`words` set) whose `outcome` echoes the
 *    world's own confirmation (starts with `"You say:"`) renders as ONE
 *    line — its `action` heading alone, `body` dropped. A spoken activity
 *    whose outcome is a refusal (anything else) keeps that outcome as its
 *    `body` — the world's reason the words did not land.
 * 2. A `mine` speech line whose text matches a spoken local activity's own
 *    words is dropped: the local line already carries it, refusal included
 *    (rule 1).
 * 3. Every other speech line — every non-mine line, and any `mine` line
 *    with no matching local activity (a stray backfill) — renders as its
 *    own speaker block (`heading` the speaker, `body` the words).
 * 4. A non-refusal activity whose own outcome a `dealt_hit`/`dealt_condition`
 *    world event on the SAME tick already narrates for the SAME target
 *    (`hasMatchingWorldEvent`) drops its `body` too, the same way rule 1
 *    drops a confirmed say's — the world event's own entry carries the
 *    numbers instead; the activity's heading is untouched.
 * 5. A local activity recorded with `display` (the values entered into an
 *    action's input fields) renders as an `"activity"` row — heading the
 *    action's label, body "Label: value" — never as a "You" speech bubble,
 *    and its `words` (the JSON transport string) are never shown. Rule 2
 *    still drops the world's `mine` echo of those words.
 *
 * Bounded to the last `EXPLORE_ACTIVITY_LIMIT` local activities, dividers,
 * speech lines and world events, merged and sorted by tick ascending. Two
 * entries sharing one tick keep a divider before speech before event before
 * activity (a place opening reads above anything heard or done there; what
 * the world narrates before what the player's own line adds on top, unless
 * rule 4 dropped that line's body entirely) via a stable sort over
 * divider-then-speech-then-event-then-activity insertion order. No sequence
 * number is fabricated for a WORLD line: heard speech and world events are
 * never re-sequenced. The one narrowing (sk-jay0.1.8.96 s10, owner decision
 * 2026-11-12) is local against local: two of the player's own entries on one
 * tick (an activity row, a place divider) that both carry `recordSeq` keep
 * the order they were recorded in, so an attempt made before leaving reads
 * above the divider of the place then entered (`keepLocalRecordOrder`). The
 * divider and the world lines under it keep their slots; only that earlier
 * own entry moves, to directly above the divider.
 * That number is the recorder's own count of what it recorded, not a claim
 * about world order. Two events sharing a tick keep their relative
 * order for the same reason `mergeChronicleFacts` (play-chronicle.ts) does
 * not need its own tie-break: the caller's accumulated `events` array is
 * already in world-observed order (`chronicleSeq`, play-session.ts), and a
 * stable sort never reorders inputs that were already correct relative to
 * each other.
 *
 * The NEWEST `"place"` entry (sk-jay0.1.8.63.5, section-header rows)
 * additionally carries `company` — `exploreContextFromView(view).company`,
 * the current place's own live "who's addressable" prose — so only the
 * current place claims who is present now; every earlier arrival's own
 * divider is returned unchanged.
 *
 * `alwaysAdmitIds` (sk-jay0.1.8.63.1 Part B, Talk mounts this same stream at
 * stage) admits a line the ordinary rule above would otherwise hold back —
 * the current open dialogue's own burst, so an open prompt from before this
 * arrival still shows. Such a line sorts as though it arrived right after
 * the newest place row (see the option's own doc comment) rather than at its
 * true tick, which would otherwise place it above a place row it was never
 * heard at.
 */
export function exploreStreamFromView(
	view: PlayView,
	activities: readonly ExploreActivity[],
	options: ExploreStreamOptions = {},
): ExploreStreamEntry[] {
	const {
		includeRetainedSpeech = false,
		dividers = [],
		admittedSpeechIds = new Set<string>(),
		sinceTick = null,
		alwaysAdmitIds = new Set<string>(),
		events = [],
	} = options;
	const recentActivities = activities.slice(-EXPLORE_ACTIVITY_LIMIT);
	const spokenWords = new Set(
		recentActivities
			.filter((entry): entry is ExploreActivity & { words: string } => entry.words !== undefined)
			.map((entry) => entry.words.trim()),
	);
	const dividerEntries: ExploreStreamEntry[] = dividers
		.slice(-EXPLORE_ACTIVITY_LIMIT)
		.map((divider) => ({
			id: divider.id,
			kind: "place",
			tick: divider.tick,
			heading: divider.placeName,
			body: null,
		}));
	// Where a line admitted ONLY through `alwaysAdmitIds` sorts: just after the
	// newest place row, rather than its own true (pre-arrival) tick — see
	// `alwaysAdmitIds`'s own doc comment. `undefined` when the journal has no
	// divider yet (nothing to clamp against; the line keeps its own tick).
	const newestDividerTick = dividerEntries.at(-1)?.tick;
	// With no arrival observed (a reload) the player's own lines and present
	// speakers decide, so the journal never opens on the common room's
	// conversation. After an arrival only lines heard since then are new.
	// Once a line clears this rule
	// (or was already in `admittedSpeechIds`), it is remembered by the caller
	// forever after — this function only ever decides admission for a line
	// not already in that set.
	const present = new Set(view.occupants.map((occupant) => occupant.id));
	const passesOrdinaryAdmission = (line: PlaySpeech): boolean =>
		includeRetainedSpeech ||
		admittedSpeechIds.has(line.id) ||
		(sinceTick === null
			? line.mine || line.speakerId === null || present.has(line.speakerId)
			: // After an observed arrival the journal only grows forward. The
				// session backfills a place's earlier speech from traces on
				// arrival; those lines carry old ticks and would otherwise sort
				// retroactively under a place they were never heard in. Only
				// `alwaysAdmitIds` (the open dialogue's own burst) pulls one of
				// those backfilled lines in anyway.
				line.tick >= sinceTick);
	// A line admitted ONLY because it is in `alwaysAdmitIds` — never one that
	// already clears the ordinary rule — is the one whose SORT position gets
	// clamped below; an ordinarily-admitted line always keeps its true tick.
	const sortTickOverrides = new Map<string, number>();
	const speechEntries: ExploreStreamEntry[] = view.speech
		.filter((line) => passesOrdinaryAdmission(line) || alwaysAdmitIds.has(line.id))
		.slice(-EXPLORE_ACTIVITY_LIMIT)
		.filter((line) => !(line.mine && spokenWords.has(line.text.trim())))
		.map((line) => {
			if (
				newestDividerTick !== undefined &&
				line.tick < newestDividerTick &&
				alwaysAdmitIds.has(line.id) &&
				!passesOrdinaryAdmission(line)
			) {
				sortTickOverrides.set(line.id, newestDividerTick);
			}
			const shared = {
				chip: "speech" as const,
				mine: line.mine,
				speaker: line.mine ? "You" : line.speaker,
				// sk-jay0.1.8.63.7: carried on the public entry itself (rather than
				// a side map keyed by id, as an earlier version of this code did)
				// so a caller can tell whether `speaker` still names someone
				// present without a name-string lookup, and the burst-continuity
				// pass below can read it back off the already-merged entry.
				speakerId: line.speakerId,
				addresseeName: line.addresseeName ?? null,
				isChoice: line.choiceSlot !== undefined,
			};
			return {
				id: line.id,
				kind: "speech",
				tick: line.tick,
				heading: line.mine ? "You" : line.speaker,
				body: line.choiceSlot === undefined ? line.text : line.text || `Answer ${line.choiceSlot}`,
				...shared,
			};
		});
	// Bounded and reused for both the event entries themselves and rule 4's
	// own-activity dedupe check below — one slice, not two independent reads
	// of `options.events`.
	const recentEvents = events.slice(-EXPLORE_ACTIVITY_LIMIT);
	const eventEntries: ExploreStreamEntry[] = eventStreamEntries(
		recentEvents,
		new Map(view.session.roster.map((entry) => [entry.actorId, entry.name])),
	);
	const activityEntries: ExploreStreamEntry[] = recentActivities.map((entry) => {
		const spokenConfirmed = entry.words !== undefined && entry.outcome.startsWith("You say:");
		// Rule 5: an input-field attempt is an activity, never a speech bubble.
		// Its `words` (the JSON transport) are not shown; a confirmed echo of
		// them ("You say: …") is dropped like rule 1's, any other outcome (a
		// refusal, a result) follows the entered values on its own line.
		const entered = entry.display === undefined ? "" : inputDisplayText(entry.display);
		if (entry.display !== undefined && entered !== "") {
			return {
				id: entry.id,
				kind: "activity",
				chip: "things",
				tick: entry.tick,
				heading: entry.action,
				body:
					spokenConfirmed || entry.outcome.trim() === "" ? entered : `${entered}\n${entry.outcome}`,
				...(entry.refusal ? { refusal: entry.refusal } : {}),
			};
		}
		if (entry.words !== undefined) {
			return {
				id: entry.id,
				kind: "speech",
				chip: "speech",
				tick: entry.tick,
				heading: "You",
				body: entry.words,
				mine: true,
				speaker: "You",
				speakerId: view.hero.actorId,
				addresseeName: entry.addresseeName ?? null,
				...(entry.addressing ? { addressing: entry.addressing } : {}),
				isChoice: false,
				...(spokenConfirmed ? {} : { outcome: entry.outcome }),
				...(entry.refusal ? { refusal: entry.refusal } : {}),
			};
		}
		// Rule 4: a refusal never reaches the world-event check (its own
		// reason always stays), so `targetName` is only computed for a
		// non-refusal activity's own heading.
		const targetName = entry.refusal === undefined ? activityTargetName(entry.action) : null;
		const duplicatesWorldEvent =
			targetName !== null && hasMatchingWorldEvent(entry.tick, targetName, recentEvents);
		return {
			id: entry.id,
			kind: "activity",
			chip: "things",
			tick: entry.tick,
			heading: entry.action,
			body: spokenConfirmed || duplicatesWorldEvent ? null : entry.outcome,
			...(entry.refusal ? { refusal: entry.refusal } : {}),
		};
	});
	// `tick` itself is never rewritten (callers/tests may still read a
	// backfilled line's own true tick); only the sort uses the override.
	const sortKey = (entry: ExploreStreamEntry): number =>
		sortTickOverrides.get(entry.id) ?? entry.tick;
	const recordSeqById = new Map<string, number>();
	for (const local of [...dividers.slice(-EXPLORE_ACTIVITY_LIMIT), ...recentActivities])
		if (local.recordSeq !== undefined) recordSeqById.set(local.id, local.recordSeq);
	const merged = keepLocalRecordOrder(
		[...dividerEntries, ...speechEntries, ...eventEntries, ...activityEntries].sort(
			(a, b) => sortKey(a) - sortKey(b),
		),
		sortKey,
		recordSeqById,
	);
	// A second pass over the FINAL merged order (not `speechEntries`' own
	// order) so a burst also breaks across an activity, event or place
	// divider that tick-sorts between two same-speaker lines — the one way
	// this rule differs from `threadFromView`'s (every Talk line is speech,
	// so no other kind can ever sit between two of them).
	let previousSpeech: { speakerId: string | null; mine: boolean } | undefined;
	const withBursts = merged.map((entry) => {
		if (entry.kind !== "speech") {
			previousSpeech = undefined;
			return entry;
		}
		const current = { speakerId: entry.speakerId ?? null, mine: entry.mine ?? false };
		const startsBurst = startsSpeechBurst(previousSpeech, current);
		previousSpeech = current;
		return { ...entry, startsBurst };
	});
	// The section-header pattern (sk-jay0.1.8.63.5): only the NEWEST
	// place entry — the divider for wherever the player is now — carries who
	// is currently addressable. An older arrival's own divider is left alone;
	// it names a place the player has since left and must not claim its
	// company is still there.
	const newestPlaceId = [...withBursts].reverse().find((entry) => entry.kind === "place")?.id;
	if (newestPlaceId === undefined) return withBursts;
	const { company, companyParts } = exploreContextFromView(view);
	if (!company || !companyParts) return withBursts;
	return withBursts.map((entry) =>
		entry.id === newestPlaceId ? { ...entry, company, companyParts } : entry,
	);
}

/**
 * Where the tile-level `play-status` line belongs (round 3, sk-jay0.1.8,
 * "the outcome line belongs to the dock in Talk"): `"quiet"` (the world's own
 * "nothing changes" default) and `"delta"` (something happened — in Talk,
 * typically the NPC's own reply, which the thread already renders) both hide
 * at the top; `"rejected"` (the world declined the act) and `"failed"` (the
 * call itself never reached a classification — a thrown/caught client error)
 * both belong in the dock instead, next to the composer, since that IS the
 * decision point; `"blocked"` (Play itself stopped the attempt before sending
 * it — `PlayAttemptBlockedError`, `play-session.ts` — so nothing reached the
 * world and no result is pending) belongs there too; `"other"` (`classifyActResult`'s own `"undescribable"`, or
 * no act has happened yet) is left exactly where it renders today.
 */
export type ActStatusKind = "quiet" | "delta" | "rejected" | "failed" | "blocked" | "other";

/**
 * `PlaySessionHandle.act`/`move`/`react`/`endTurn` only ever resolve to an
 * already-rendered string (`messageForAct` et al., `@spellkave/tool-runtime`)
 * — the `ActPlayerResult.kind` a dispatch actually classified to is computed
 * and recorded onto `play-trail.ts`'s ring buffer for telemetry, then
 * discarded before the caller ever sees it. Rather than widen that return
 * contract (touching every implementation and every test's mocked handle),
 * this reads the SAME already-recorded classification back off the trail's
 * own `outcome` field (`App.svelte` calls this with `playTrail.entries().at(-1)
 * ?.outcome` right after an act settles) — "the closest existing
 * classification", not a new one. `null`/an unrecognised string (the trail
 * predates this call, or carries some other kind entirely) reads as
 * `"other"`, never a guess.
 */
export function actStatusKindFromOutcome(outcome: string | null): ActStatusKind {
	switch (outcome) {
		case "quiet":
			return "quiet";
		case "happened":
			return "delta";
		case "rejected":
			return "rejected";
		default:
			return "other";
	}
}

/**
 * The one dock notice surface: reconnecting always wins (the whole page is
 * stale), then a genuinely slow pending act. `null` otherwise — the dock
 * stays silent for an ordinary act. A refusal is never a notice: every scene
 * mounts the one Table stream, so a refusal is a stream line there
 * (sk-jay0.1.8.63.13 retired the Talk/Fight refusal notice).
 */
export interface DockNoticeInput {
	reconnecting: boolean;
	slowPending: boolean;
}

export function dockNoticeFrom(
	input: DockNoticeInput,
): { text: string; tone: "info" | "warn" } | null {
	if (input.reconnecting) return { text: "Reconnecting to the world…", tone: "info" };
	if (input.slowPending) return { text: "The world is still thinking…", tone: "info" };
	return null;
}

/** SRD 5.2 experience thresholds: XP needed to REACH level 2..20. An SRD
 * sheet supplement that belongs to this app (the substrate persists only
 * the raw `srd/xp` figure); index n-2 is the threshold for level n. */
const SRD_XP_TO_REACH_LEVEL: readonly number[] = [
	300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000,
	195000, 225000, 265000, 305000, 355000,
];

/** "25 / 300" — the raw figure against the next level's threshold, so a
 * kill's XP reads as progress rather than a bare number. Level 20 (or an
 * unknown level) shows the figure alone. */
export function xpProgressLabel(xp: number, level: number | undefined): string {
	if (level === undefined || level < 1 || level >= 20) return String(xp);
	const next = SRD_XP_TO_REACH_LEVEL[level - 1];
	return next === undefined ? String(xp) : `${xp} / ${next}`;
}

/**
 * Which heard lines belong in THIS place's thread. `view.speech` is the
 * actor's whole recent transcript, so walking from the common room to the
 * bar opened the thread on Aldwin's and Caddoc's prompts above Mira's.
 * A line stays when it is the player's own, when its speaker is still here
 * (they can be answered), or when it was heard after the player arrived
 * (`sinceTick`; `null` on a reload keeps everything). Lines by someone who
 * has left and spoke before the arrival drop out of the thread only — the
 * dialogue's own answer resolution still reads the unfiltered transcript.
 */
export function threadLineIdsForPlace(view: PlayView, sinceTick: number | null): Set<string> {
	if (sinceTick === null) return new Set(view.speech.map((line) => line.id));
	const present = new Set(view.occupants.map((occupant) => occupant.id));
	return new Set(
		view.speech
			.filter(
				(line) =>
					line.mine ||
					line.speakerId === null ||
					present.has(line.speakerId) ||
					line.tick >= sinceTick,
			)
			.map((line) => line.id),
	);
}

/** One of the open dialogue's numbered answers, `number` and `text` kept
 * apart (unlike `TalkDock.answers`' fused `"<slot> <word>"` label) so the
 * dock can render a key badge separately from a word-boundary-shortened
 * button label. */
export interface DockAnswer {
	id: string;
	number: number;
	text: string;
}

/**
 * BG3-style answer buttons (sk-jay0.1.8, dock-as-menu-bar round): the dock
 * shows only the first `limit` answers as buttons, each shortened to
 * `maxChars` on a word boundary with a trailing "…" when cut; every other
 * answer moves to `overflow`, full text intact, for the "More…" menu.
 */
export function splitDockAnswers(
	answers: readonly DockAnswer[],
	limit = 3,
	maxChars = 24,
): { shown: DockAnswer[]; overflow: DockAnswer[] } {
	const shorten = (text: string): string => {
		if (text.length <= maxChars) return text;
		const truncated = text.slice(0, maxChars);
		const lastSpace = truncated.lastIndexOf(" ");
		const cut = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
		return `${cut}…`;
	};
	return {
		shown: answers.slice(0, limit).map((answer) => ({ ...answer, text: shorten(answer.text) })),
		overflow: answers.slice(limit),
	};
}
