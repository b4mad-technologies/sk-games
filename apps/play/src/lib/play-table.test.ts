import type { WorldEvent } from "@spellkave/tool-runtime";
import { describe, expect, it } from "vitest";
import { downedHeroView } from "../playground/fixtures";
import {
	brawlView,
	fightView,
	fightWithConditionsView,
	sampleView,
	talkGroupView,
	talkView,
	threeRatsView,
} from "../test/sample-view";
import { type PlayChronicleEntry, playChronicleEntry } from "./play-chronicle";
import { operationsFromPayload } from "./play-operations";
import {
	actStatusKindFromOutcome,
	type CompanyPart,
	claimedActionIdsForWindow,
	combatFromView,
	combatHandles,
	companyPartsFromOccupants,
	type DockAnswer,
	dialogueFromView,
	dockNoticeFrom,
	EXPLORE_ACTIVITY_LIMIT,
	type ExploreActivity,
	exploreContextFromView,
	exploreStreamFromView,
	groupActionsByTarget,
	heroDownedFromView,
	inputDisplayText,
	isFeaturedAction,
	mapFrameFromView,
	nodeOfActor,
	partitionActions,
	sayTargetsFromView,
	splitDockAnswers,
	startsSpeechBurst,
	talkDockFromView,
	targetsFromView,
	threadFromView,
	threadLineIdsForPlace,
	tokensByNode,
	UNTARGETED_TARGET_REF,
	verbName,
	verbsForTarget,
	xpProgressLabel,
} from "./play-table";
import type { PlayAction, PlaySpeech, PlayView } from "./play-view";

it("passes only current scene context to a passive map preview, retaining tactical mode", () => {
	const view = {
		...sampleView,
		mapState: "loading" as const,
		place: {
			id: "example/room",
			name: "Room",
			description: "A bright room.",
			exits: [
				{
					handle: "exit",
					rev: "r",
					label: "north",
					to: "hall",
					toNodeId: "example/hall",
					toName: "Hall",
					gates: [],
				},
			],
		},
	};
	const frame = mapFrameFromView(view, undefined);
	expect(frame).toMatchObject({
		state: "loading",
		description: "A bright room.",
		nearby: ["Hall"],
		focusNodeId: "example/room",
		nearbyNodeIds: ["example/hall"],
	});
	expect(frame.svg).toBeUndefined();
	expect(mapFrameFromView(fightView, "<svg/>")).toMatchObject({ mode: "full", svg: "<svg/>" });
});

// sk-jay0.4.2: pure lookups over view.sessionTokens for a future battle-map
// widget — no component wiring in this task.
describe("tokensByNode / nodeOfActor: pure lookups over view.sessionTokens (sk-jay0.4.2)", () => {
	it("tokensByNode groups the fight fixture's own two tokens by their drawn cell", () => {
		const byNode = tokensByNode(fightView);
		expect(byNode.size).toBe(2);
		expect(byNode.get("session_grid_58/c_1_0")).toEqual([
			{ nodeId: "session_grid_58/c_1_0", actorId: "7", name: "Renn the Roadwarden", isMe: true },
		]);
		expect(byNode.get("session_grid_58/c_0_0")).toEqual([
			{ nodeId: "session_grid_58/c_0_0", actorId: "123", name: "Cellar Rat 1", isMe: false },
		]);
	});

	it("tokensByNode groups two tokens sharing one cell under that one node id", () => {
		const view: PlayView = {
			...fightView,
			sessionTokens: [
				{ nodeId: "session_grid_58/c_1_0", actorId: "7", name: "Renn the Roadwarden", isMe: true },
				{ nodeId: "session_grid_58/c_1_0", actorId: "123", name: "Cellar Rat 1", isMe: false },
			],
		};
		const byNode = tokensByNode(view);
		expect(byNode.size).toBe(1);
		expect(byNode.get("session_grid_58/c_1_0")?.map((token) => token.actorId)).toEqual([
			"7",
			"123",
		]);
	});

	it("tokensByNode answers an empty map outside a tactical session", () => {
		expect(tokensByNode(sampleView).size).toBe(0);
	});

	it("nodeOfActor finds the cell a roster actor stands on", () => {
		expect(nodeOfActor(fightView, "7")).toBe("session_grid_58/c_1_0");
		expect(nodeOfActor(fightView, "123")).toBe("session_grid_58/c_0_0");
	});

	it("nodeOfActor answers null for an actor with no token (not placed, or no session)", () => {
		expect(nodeOfActor(fightView, "not-a-participant")).toBeNull();
		expect(nodeOfActor(sampleView, "7")).toBeNull();
	});

	it("nodeOfActor ignores tokens a view still carries after its session closed (sk-jay0.1.8.63.44)", () => {
		// Seen live: the fight ended, the fallen creature stayed in the room and
		// the view still held the last session's tokens for a moment.
		const afterFight = { ...sampleView, sessionTokens: fightView.sessionTokens };
		expect(nodeOfActor(afterFight, "7")).toBeNull();
	});
});

function socialMeleeOffers(): PlayAction[] {
	return [
		{
			id: "h:melee-aldwin",
			label: "Melee Attack — Aldwin, keeper of the hearth-ledger",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			group: "combat",
		},
		{
			id: "h:melee-caddoc",
			label: "Melee Attack — Brother Caddoc",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Brother Caddoc",
			targetRef: "entity:9",
			acceptsUtterance: false,
			group: "combat",
		},
		{
			id: "h:melee-hearth",
			label: "Melee Attack — Hearth",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Hearth",
			targetRef: "entity:31",
			acceptsUtterance: false,
			group: "combat",
		},
	];
}

function answer(slot: number): PlayAction {
	return {
		id: `h:ans${slot}`,
		label: `Answer ${slot} — Aldwin, keeper of the hearth-ledger`,
		verb: "communicate",
		descriptor: `dm/dialog/choice/${slot}`,
		targetName: "Aldwin, keeper of the hearth-ledger",
		targetRef: "entity:4",
		acceptsUtterance: false,
		slot,
	};
}

describe("the table's derivations", () => {
	it("opens a dialogue with the speaker's words, numbered answers and a say field", () => {
		const view: PlayView = {
			...sampleView,
			actions: [...sampleView.actions, answer(1), answer(2)],
			speech: [
				{
					id: "s1",
					tick: 50,
					speakerId: "4",
					speaker: "Aldwin, keeper of the hearth-ledger",
					text: "Which way? 1 Cellar, 2 Bar.",
					mine: false,
				},
			],
		};
		const dialogue = dialogueFromView(view);
		expect(dialogue?.dialog.speaker).toBe("Aldwin, keeper of the hearth-ledger");
		expect(dialogue?.dialog.prompt).toBe("Which way? 1 Cellar, 2 Bar.");
		expect(dialogue?.dialog.choices).toEqual([
			{ slot: 1, text: answer(1).label },
			{ slot: 2, text: answer(2).label },
		]);
		expect(dialogue?.dialog.sayEnabled).toBe(true);
		expect(dialogue?.sayAction?.id).toBe("h:talk");
		expect(dialogue?.consumed.has("h:ans1")).toBe(true);
		expect(dialogue?.consumed.has("h:ask")).toBe(false);
	});

	it("has no dialogue when nobody spoke and nothing numbered is offered", () => {
		expect(dialogueFromView({ ...sampleView, speech: [] })).toBeNull();
	});

	it("stays explore on a lingering last line: the explore beat must not open Talk", () => {
		// sampleView (the explore fixture): Aldwin spoke at tick 40, then the
		// world moved on (an event at tick 42) — no numbered answers either.
		// dialogueFromView must read this as explore, not a stuck Talk
		// (sk-jay0.1.8.5 finding 3: "the explore beat renders as Talk").
		const lastHeardTick = sampleView.speech[0]?.tick ?? 0;
		expect(sampleView.events.some((event) => event.tick > lastHeardTick)).toBe(true);
		expect(dialogueFromView(sampleView)).toBeNull();
	});

	it("opens Talk on a fresh non-numbered line the player can still answer", () => {
		// No numbered answers this time (e.g. "adopt this name, or say
		// another"), but nothing has happened since Aldwin spoke and a Speak
		// To Aldwin action is offered — the exchange is still live.
		const view: PlayView = {
			...sampleView,
			speech: [
				{
					id: "s2",
					tick: 90,
					speakerId: "4",
					speaker: "Aldwin, keeper of the hearth-ledger",
					text: "Adopt that name, or say another as name=Your Name.",
					mine: false,
				},
			],
		};
		const dialogue = dialogueFromView(view);
		expect(dialogue).not.toBeNull();
		expect(dialogue?.dialog.nameField).toBe(false);
	});

	it("keeps Talk open on the talk fixture regardless of the tick heuristic", () => {
		// talkView carries numbered answers, so it opens Talk on that signal
		// alone even though it inherits sampleView's (later-ticked) events.
		expect(dialogueFromView(talkView)).not.toBeNull();
	});

	it("keeps skill checks and rest actions behind the fold", () => {
		const { featured, rest } = partitionActions(sampleView.actions);
		expect(featured.map((action) => action.id)).toEqual(["h:talk", "h:ask", "h:look"]);
		expect(rest.map((action) => action.id)).toEqual(["h:arcana"]);
	});

	it("keeps every words-taking handle as a composer target, while naming duplicate targets", () => {
		// ADR-0137 (amends ADR-0033 §D-2): srd/speak-aloud is addressee-less and
		// targets the place sentinel (`target_ref = "place_node:<id>"`), never an
		// entity — it materialises exactly ONE row (the speaker's own node), so
		// two rows here are a synthetic stand-in proving the dedup key is
		// `targetName` (empty -> "room"), not `targetRef`: two DIFFERENT place
		// nodes still collapse to the one field a real player would only ever
		// see one of at a time.
		const room1: PlayAction = {
			id: "h:room-aldwin",
			label: "Speak Aloud",
			verb: "communicate",
			descriptor: "srd/speak-aloud",
			targetName: "",
			targetRef: "place_node:kavemouth/inn/hearth",
			acceptsUtterance: true,
		};
		const room2: PlayAction = {
			id: "h:room-caddoc",
			label: "Speak Aloud",
			verb: "communicate",
			descriptor: "srd/speak-aloud",
			targetName: "",
			targetRef: "place_node:kavemouth/inn/loft",
			acceptsUtterance: true,
		};
		const talkToCaddoc: PlayAction = {
			id: "h:talk-caddoc",
			label: "Speak To — Brother Caddoc",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Brother Caddoc",
			targetRef: "entity:9",
			acceptsUtterance: true,
		};
		const view: PlayView = {
			...sampleView,
			actions: [...sampleView.actions, room1, room2, talkToCaddoc],
		};
		const targets = sayTargetsFromView(view, dialogueFromView(view));
		// h:talk (Speak To Aldwin) + h:talk-caddoc (Speak To Caddoc) + BOTH room
		// handles. Distinct handles must remain reachable even when their target
		// ref is the same (sk-jay0.1.8.59); only the exact same action id is
		// deduplicated when dialogue.sayAction is also in view.actions.
		expect(targets.map((target) => target.label)).toEqual([
			"Aldwin, keeper of the hearth-ledger",
			"The room",
			"The room (speak aloud)",
			"Brother Caddoc",
		]);
	});

	it("preserves separate same-entity handles and their exact dispatch ids", () => {
		const speakTo: PlayAction = {
			id: "h:speak-to-aldwin",
			label: "Speak To — Aldwin, keeper of the hearth-ledger",
			verb: "communicate",
			descriptor: "srd/speak-to",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: true,
		};
		const whisper: PlayAction = {
			...speakTo,
			id: "h:whisper-aldwin",
			label: "Whisper — Aldwin, keeper of the hearth-ledger",
			descriptor: "srd/whisper",
		};
		const view: PlayView = { ...sampleView, actions: [speakTo, whisper] };
		const targets = sayTargetsFromView(view, null);
		expect(targets.map((target) => target.label)).toEqual([
			"Aldwin, keeper of the hearth-ledger",
			"Aldwin, keeper of the hearth-ledger (whisper)",
		]);
		expect(targets.map((target) => target.action.id)).toEqual([
			"h:speak-to-aldwin",
			"h:whisper-aldwin",
		]);
	});

	it("leads the say targets with the open dialogue's own speaker", () => {
		const targets = sayTargetsFromView(talkView, dialogueFromView(talkView));
		expect(targets[0]?.label).toBe("Aldwin, keeper of the hearth-ledger");
	});

	it("frames the fight from the session roster", () => {
		const combat = combatFromView(fightView);
		expect(combat?.mode).toBe("your-turn");
		expect(combat?.enemy).toBe("Cellar Rat 1");
		expect(combat?.roster?.map((entry) => entry.name)).toEqual([
			"Renn the Roadwarden",
			"Cellar Rat 1",
		]);
		expect(combatFromView(sampleView)).toBeNull();
	});

	it("carries a roster member's co-located occupant conditions onto its tracker entry, dead pulled out into its own flag (S5, sk-jay0.1.8.41)", () => {
		const combat = combatFromView(fightWithConditionsView);
		const rennEntry = combat?.roster?.find((entry) => entry.name === "Renn the Roadwarden");
		const rat2Entry = combat?.roster?.find((entry) => entry.name === "Cellar Rat 2");
		// Renn has no matching occupant (self is excluded from `view.occupants`)
		// — neither field is invented for a roster member the scene never
		// discloses conditions for.
		expect(rennEntry?.dead).toBeUndefined();
		expect(rennEntry?.conditions).toBeUndefined();
		// Cellar Rat 2's occupant carries only `srd/condition/dead` — pulled
		// into `dead`, leaving no other condition token to draw.
		expect(rat2Entry?.dead).toBe(true);
		expect(rat2Entry?.conditions).toBeUndefined();
	});

	it("resolves a live roster member's other disclosed conditions to player-facing labels, dropping DM-internal ones", () => {
		const view: PlayView = {
			...fightWithConditionsView,
			occupants: fightWithConditionsView.occupants.map((occupant) =>
				occupant.id === "123"
					? {
							...occupant,
							conditions: [
								...occupant.conditions,
								"core/condition/controlled",
								// A DM workflow condition is bookkeeping too (sk-jay0.1.8.96).
								"dm/level-up/drafting",
							],
						}
					: occupant,
			),
		};
		const combat = combatFromView(view);
		const rat1Entry = combat?.roster?.find((entry) => entry.name === "Cellar Rat 1");
		expect(rat1Entry?.dead).toBeUndefined();
		expect(rat1Entry?.conditions).toEqual([{ id: "srd/condition/prone", label: "Prone" }]);
	});

	it("keeps a timed Sequential activity out of Fight and the tactical map", () => {
		const turnSession = operationsFromPayload({
			status: "session_detail",
			session: {
				session_id: "42",
				lifecycle: "active",
				turn_rule: "Sequential",
				timing: { basis: "world_ticks", duration_ticks: "8", estimated_remaining_ticks: "4" },
			},
		}).selected;
		const view = { ...fightView, session: { ...fightView.session, id: "42" }, turnSession };
		expect(combatFromView(view)).toBeNull();
		expect(mapFrameFromView(view, undefined).mode).toBe("peek");
	});

	it("does not call an unclassified Sequential activity a fight", () => {
		const turnSession = operationsFromPayload({
			status: "session_detail",
			session: {
				session_id: "42",
				lifecycle: "active",
				turn_rule: "Sequential",
			},
		}).selected;
		expect(
			combatFromView({
				...fightView,
				actions: [],
				session: { ...fightView.session, id: "42" },
				turnSession,
			}),
		).toBeNull();
	});

	it("does not call a social room a fight because melee is offered (sk-jay0.1.8.34.19)", () => {
		const view: PlayView = {
			...sampleView,
			actions: [...sampleView.actions, ...socialMeleeOffers()],
		};
		expect(combatFromView(view)).toBeNull();
		expect(dialogueFromView(view)).toBeNull();
		const { featured, rest } = partitionActions(view.actions);
		expect(featured.map((action) => [action.id, action.targetName])).toEqual([
			["h:talk", "Aldwin, keeper of the hearth-ledger"],
			["h:ask", "Aldwin, keeper of the hearth-ledger"],
			["h:look", ""],
		]);
		expect(rest.map((action) => action.id)).toEqual([
			"h:arcana",
			"h:melee-aldwin",
			"h:melee-caddoc",
			"h:melee-hearth",
		]);
	});

	it("keeps Talk open when a live dialogue also has sessionless attack offers", () => {
		const view: PlayView = {
			...talkView,
			actions: [...talkView.actions, ...socialMeleeOffers()],
		};
		expect(combatFromView(view)).toBeNull();
		expect(dialogueFromView(view)).not.toBeNull();
	});

	it("keeps sessionless combat-group offers reachable without opening a fight frame", () => {
		expect(combatFromView(brawlView)).toBeNull();
		const { featured, rest } = partitionActions(brawlView.actions);
		expect(featured).toEqual([]);
		expect(rest.map((action) => action.id)).toEqual([
			"h:melee",
			"h:dodge",
			"h:unarmed-strike",
			"h:longsword-strike",
		]);
	});

	it("features unarmed strike only in a live fight, not creation limbo (sk-jay0.1.8.11 item 5, sk-jay0.1.8.14 task e)", () => {
		const strike: PlayAction = {
			id: "h:unarmed-strike",
			label: "Unarmed strike: damage — Aldwin, keeper of the hearth-ledger",
			verb: "manipulate",
			descriptor: "srd/attack/unarmed",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
		};
		expect(isFeaturedAction(strike)).toBe(false);
		expect(isFeaturedAction(strike, false)).toBe(false);
		expect(isFeaturedAction(strike, true)).toBe(true);

		const limbo = partitionActions([...sampleView.actions, strike]);
		expect(limbo.featured.map((action) => action.id)).not.toContain("h:unarmed-strike");
		expect(limbo.rest.map((action) => action.id)).toContain("h:unarmed-strike");

		const fight = partitionActions([...sampleView.actions, strike], true);
		expect(fight.featured.map((action) => action.id)).toContain("h:unarmed-strike");
	});
});

// K2: labels are joined by structured source/action facts, never speech prose.
describe("structured answer presentation", () => {
	const prompt = {
		occurrenceId: "o1",
		promptDefId: "p1",
		contractVersion: 1,
		sourceRef: "entity:4",
		responseActionIds: ["dm/dialog/choice/1", "dm/dialog/choice/2"],
		openedAtTick: 10,
		consumed: false,
		presentation: {
			question: "Unparseable question",
			labels: { "dm/dialog/choice/1": "A: commas, numbers 99", "dm/dialog/choice/2": "Other" },
		},
	};
	// K2: structured metadata is the only answer-word source.
	it("reads dialogue words only from prompt metadata", () => {
		const view = {
			...sampleView,
			actions: [answer(1), answer(2)],
			manipulationContext: {
				status: "ready" as const,
				revision: 1,
				schemaVersion: 1,
				actions: [],
				targets: [],
				participants: [],
				prompts: [prompt],
			},
		};
		expect(dialogueFromView(view)?.dialog.choices.map((choice) => choice.text)).toEqual([
			"A: commas, numbers 99",
			"Other",
		]);
	});
	// K2: world-authored choice text survives into the renderer's body field.
	it("renders confirmed choice text without consulting a prompt", () => {
		const line: PlaySpeech = {
			id: "choice",
			tick: 11,
			speakerId: "7",
			speaker: "You",
			mine: true,
			text: "A: commas, numbers 99",
			choiceSlot: 1,
		};
		const entries = exploreStreamFromView({ ...sampleView, speech: [line] }, []);
		expect(entries.find((entry) => entry.id === "choice")?.body).toBe(line.text);
		const neutral = exploreStreamFromView({ ...sampleView, speech: [{ ...line, text: "" }] }, []);
		expect(neutral.find((entry) => entry.id === "choice")?.body).toBe("Answer 1");
		const thread = threadFromView({ ...sampleView, speech: [{ ...line, text: "" }] });
		expect(thread.lines.find((entry) => entry.id === "choice")?.text).toBe("Answer 1");
	});
});

describe("startsSpeechBurst: the shared burst rule (sk-jay0.1.8.63.1)", () => {
	// keep(K1): absent speaker identity cannot prove a continuation.
	it("keeps unknown speakers separate even when both identities are missing", () => {
		expect(
			startsSpeechBurst({ speakerId: null, mine: false }, { speakerId: null, mine: false }),
		).toBe(true);
	});

	it("starts a burst on the very first line", () => {
		expect(startsSpeechBurst(undefined, { speakerId: "4", mine: false })).toBe(true);
	});
	it("does not start a burst when the same speaker/mine identity continues", () => {
		expect(
			startsSpeechBurst({ speakerId: "4", mine: false }, { speakerId: "4", mine: false }),
		).toBe(false);
	});
	it("starts a burst on a different speaker id", () => {
		expect(
			startsSpeechBurst({ speakerId: "4", mine: false }, { speakerId: "9", mine: false }),
		).toBe(true);
	});
	it("starts a burst on a mine/not-mine hand-off, even with the same speakerId", () => {
		expect(startsSpeechBurst({ speakerId: "7", mine: false }, { speakerId: "7", mine: true })).toBe(
			true,
		);
	});
});

describe("threadFromView: the Talk scene as the place thread (sk-jay0.1.8.12)", () => {
	it("does not mix answer slots offered toward different speakers", () => {
		const first = answerAt(1, "First answer");
		const second = {
			...first,
			id: "h:second-speaker",
			targetRef: "entity:9",
			targetName: "Other speaker",
		};
		const view = { ...talkView, actions: [first, second] };
		const dialogue = dialogueFromView(view);
		expect(dialogue?.dialog.choices).toHaveLength(1);
		expect(dialogue?.choiceActions.get(1)?.id).toBe(first.id);
		expect(dialogue?.consumed.has(second.id)).toBe(false);
	});
	function answerAt(slot: number, label: string): PlayAction {
		return {
			id: `h:ans${slot}`,
			label: `${label} — Aldwin, keeper of the hearth-ledger`,
			verb: "communicate",
			descriptor: "dm/dialog/answer",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot,
		};
	}

	const burstView: PlayView = {
		...talkView,
		speech: [
			{
				id: "b1",
				tick: 30,
				speakerId: "4",
				speaker: "Aldwin, keeper of the hearth-ledger",
				text: "Welcome to the hearth-ledger, traveller.",
				mine: false,
			},
			{
				id: "b2",
				tick: 31,
				speakerId: "4",
				speaker: "Aldwin, keeper of the hearth-ledger",
				text: "You could also just adopt the recommended array for a fresh start.",
				mine: false,
			},
			{
				id: "b3",
				tick: 32,
				speakerId: "4",
				speaker: "Aldwin, keeper of the hearth-ledger",
				text: "Take your time; there is no wrong answer here.",
				mine: false,
			},
			{
				id: "b4",
				tick: 33,
				speakerId: "4",
				speaker: "Aldwin, keeper of the hearth-ledger",
				text: "So — which species calls to you?",
				mine: false,
			},
		],
		actions: [
			answerAt(1, "Human"),
			answerAt(2, "Elf"),
			{
				id: "h:adopt-array",
				label: "Adopt the recommended array — Aldwin, keeper of the hearth-ledger",
				verb: "communicate",
				descriptor: "srd/adopt-recommended-array",
				targetName: "Aldwin, keeper of the hearth-ledger",
				targetRef: "entity:4",
				acceptsUtterance: false,
			},
		],
	};

	it("groups a four-line burst under one speaker, in world order, with no line repeated", () => {
		const { lines } = threadFromView(burstView);
		expect(lines.map((line) => line.id)).toEqual(["b1", "b2", "b3", "b4"]);
		expect(lines.map((line) => line.startsBurst)).toEqual([true, false, false, false]);
		expect(new Set(lines.map((line) => line.id)).size).toBe(4);
	});

	it("attaches the numbered answers as chips under the LAST line (the one that actually asks)", () => {
		const { lines } = threadFromView(burstView);
		const last = lines.at(-1);
		expect(last?.chips.map((chip) => chip.label)).toEqual([
			"Human — Aldwin, keeper of the hearth-ledger",
			"Elf — Aldwin, keeper of the hearth-ledger",
		]);
		// No earlier line in the burst carries a numbered-answer chip — only
		// the array-adopt action chip (covered by the next test) may land on b2.
		expect(
			lines.slice(0, 3).every((line) => line.chips.every((chip) => chip.kind !== "choice")),
		).toBe(true);
	});

	it("attaches the array-adopt action as a chip under ITS OWN line, not the last one", () => {
		const { lines, claimedActionIds } = threadFromView(burstView);
		const arrayLine = lines.find((line) =>
			line.chips.some((chip) => chip.actionId === "h:adopt-array"),
		);
		expect(arrayLine?.id).toBe("b2");
		expect(claimedActionIds.has("h:adopt-array")).toBe(true);
		expect(claimedActionIds.has("h:ans1")).toBe(true);
	});

	it("a claimed action whose line scrolled out of the card window falls back into the caller's own remaining list, never becoming unreachable (verifier finding)", () => {
		const thread = threadFromView(burstView);
		// Card shows only the last two lines (b3, b4) — "Adopt the recommended
		// array" lives on b2, outside that window.
		const cardWindow = new Set(["b3", "b4"]);
		const windowed = claimedActionIdsForWindow(thread, cardWindow);
		expect(windowed.has("h:adopt-array")).toBe(false);
		// The numbered species answers stay excluded: their own line (b4) IS
		// in the window.
		expect(windowed.has("h:ans1")).toBe(true);
		// Stage (the full thread, nothing windowed) keeps every claim as
		// before — `null` is the "everything's on screen" case.
		expect(claimedActionIdsForWindow(thread, null)).toEqual(thread.claimedActionIds);
	});

	it("renders an own choice line as a marked choice, not spoken words, exactly once", () => {
		const view: PlayView = {
			...burstView,
			speech: [
				...burstView.speech,
				{
					id: "b5",
					tick: 34,
					speakerId: "7",
					speaker: "Renn",
					text: "5 Human",
					mine: true,
					choiceSlot: 5,
				},
			],
		};
		const { lines } = threadFromView(view);
		const mine = lines.at(-1);
		expect(mine?.mine).toBe(true);
		expect(mine?.isChoice).toBe(true);
		expect(mine?.text).toBe("5 Human");
		expect(lines.filter((line) => line.mine)).toHaveLength(1);
	});

	it("renders 'to <name>' only when the world reports an addressee", () => {
		const line: PlaySpeech = {
			id: "speech:2",
			tick: 41,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "Which class calls to you? 1 Fighter, 2 Wizard, 3 Rogue",
			mine: false,
		};
		const view: PlayView = {
			...talkView,
			speech: [{ ...line, addresseeName: "Renn the Roadwarden" }],
		};
		expect(threadFromView(view).lines[0]?.addresseeName).toBe("Renn the Roadwarden");
		expect(threadFromView({ ...talkView, speech: [line] }).lines[0]?.addresseeName).toBeNull();
	});
});

describe("groupActionsByTarget: the More actions disclosure by target", () => {
	const mk = (id: string, label: string, targetName: string, targetRef: string): PlayAction => ({
		id,
		label,
		verb: "manipulate",
		descriptor: "srd/x",
		targetName,
		targetRef,
		acceptsUtterance: false,
	});
	it("puts untargeted offers first under Here, then one group per target in world order", () => {
		const groups = groupActionsByTarget([
			mk("a1", "Melee attack — Cellar Rat 1", "Cellar Rat 1", "entity:21"),
			mk("r1", "Enter rage", "", ""),
			mk("a2", "Melee attack — Cellar Rat 2", "Cellar Rat 2", "entity:22"),
			mk("c1", "Check: Arcana — Cellar Rat 1", "Cellar Rat 1", "entity:21"),
		]);
		expect(groups.map((group) => [group.label, group.actions.map((action) => action.id)])).toEqual([
			["Here", ["r1"]],
			["Cellar Rat 1", ["a1", "c1"]],
			["Cellar Rat 2", ["a2"]],
		]);
	});
});

describe("dialogueFromView with two open prompts", () => {
	it("follows the speaker who asked most recently, not the first numbered action listed", () => {
		const view: PlayView = {
			...sampleView,
			speech: [
				{
					id: "s1",
					tick: 10,
					speakerId: "9",
					speaker: "Brother Caddoc",
					text: "Will you cleanse it? 1: Yes. 2: Another day.",
					mine: false,
				},
				{
					id: "s2",
					tick: 11,
					speakerId: "4",
					speaker: "Aldwin",
					text: "Clear the rats? 1: I'll clear it. 2: Not today.",
					mine: false,
				},
			],
			actions: [
				{
					id: "h:c1",
					label: "Answer 1 — Brother Caddoc",
					verb: "communicate",
					descriptor: "dm/dialog/choice/1",
					targetName: "Brother Caddoc",
					targetRef: "entity:9",
					acceptsUtterance: false,
					slot: 1,
				},
				{
					id: "h:c2",
					label: "Answer 2 — Brother Caddoc",
					verb: "communicate",
					descriptor: "dm/dialog/choice/2",
					targetName: "Brother Caddoc",
					targetRef: "entity:9",
					acceptsUtterance: false,
					slot: 2,
				},
				{
					id: "h:a1",
					label: "Answer 1 — Aldwin",
					verb: "communicate",
					descriptor: "dm/dialog/choice/1",
					targetName: "Aldwin",
					targetRef: "entity:4",
					acceptsUtterance: false,
					slot: 1,
				},
				{
					id: "h:a2",
					label: "Answer 2 — Aldwin",
					verb: "communicate",
					descriptor: "dm/dialog/choice/2",
					targetName: "Aldwin",
					targetRef: "entity:4",
					acceptsUtterance: false,
					slot: 2,
				},
			],
		};
		const dialogue = dialogueFromView(view);
		expect(dialogue?.speakerId).toBe("4");
		expect(dialogue?.dialog.speaker).toBe("Aldwin");
		expect(dialogue?.dialog.choices.map((choice) => choice.text)).toEqual([
			"Answer 1 — Aldwin",
			"Answer 2 — Aldwin",
		]);
		expect([...(dialogue?.choiceActions.values() ?? [])].map((action) => action.id)).toEqual([
			"h:a1",
			"h:a2",
		]);
	});
});

describe("talkDockFromView: the Talk dock's own three buckets (round 3, sk-jay0.1.8)", () => {
	function answerAt(slot: number, label: string): PlayAction {
		return {
			id: `h:ans${slot}`,
			label: `${label} — Aldwin, keeper of the hearth-ledger`,
			verb: "communicate",
			descriptor: "dm/dialog/answer",
			targetName: "Aldwin, keeper of the hearth-ledger",
			targetRef: "entity:4",
			acceptsUtterance: false,
			slot,
		};
	}

	const dockView: PlayView = {
		...talkView,
		speech: [
			{
				id: "d1",
				tick: 30,
				speakerId: "4",
				speaker: "Aldwin, keeper of the hearth-ledger",
				text: "Which class calls to you? 1 Human, 2 Elf",
				mine: false,
			},
		],
		actions: [
			answerAt(1, "Human"),
			answerAt(2, "Elf"),
			{
				id: "h:adopt-array",
				label: "Adopt the recommended array — Aldwin, keeper of the hearth-ledger",
				verb: "communicate",
				descriptor: "srd/adopt-recommended-array",
				targetName: "Aldwin, keeper of the hearth-ledger",
				targetRef: "entity:4",
				acceptsUtterance: false,
			},
			{
				id: "h:talk",
				label: "Speak To — Aldwin, keeper of the hearth-ledger",
				verb: "communicate",
				descriptor: "srd/speak-to",
				targetName: "Aldwin, keeper of the hearth-ledger",
				targetRef: "entity:4",
				acceptsUtterance: true,
			},
			{
				id: "h:look",
				label: "Look around",
				verb: "sensing",
				descriptor: "srd/look",
				targetName: "",
				targetRef: "world:1",
				acceptsUtterance: false,
			},
		],
	};

	it("puts the numbered answers first, labeled '<slot> <word>' from the same text threadFromView's chips use, in slot order", () => {
		const dock = talkDockFromView(dockView, dialogueFromView(dockView));
		expect(dock.answers.map((action) => action.label)).toEqual([
			"1 Human — Aldwin, keeper of the hearth-ledger",
			"2 Elf — Aldwin, keeper of the hearth-ledger",
		]);
		expect(dock.answers.map((action) => action.id)).toEqual(["h:ans1", "h:ans2"]);
	});

	it("puts a line-bound offer (confirm/discard/adopt targeted at the speaker) second, its own label unchanged", () => {
		const dock = talkDockFromView(dockView, dialogueFromView(dockView));
		expect(dock.offers.map((action) => action.id)).toEqual(["h:adopt-array"]);
		expect(dock.offers.map((action) => action.label)).toEqual(["Adopt the recommended array"]);
	});

	it("puts every general action — never the say action, an answer, or an offer — behind 'more'", () => {
		const dock = talkDockFromView(dockView, dialogueFromView(dockView));
		expect(dock.more.map((action) => action.id)).toEqual(["h:look"]);
	});

	it("never repeats one action id across the three buckets", () => {
		const dock = talkDockFromView(dockView, dialogueFromView(dockView));
		const allIds = [...dock.answers, ...dock.offers, ...dock.more].map((action) => action.id);
		expect(new Set(allIds).size).toBe(allIds.length);
		expect(allIds).not.toContain("h:talk");
	});

	it("returns empty answers and offers without an open dialogue", () => {
		const dock = talkDockFromView(dockView, null);
		expect(dock.answers).toEqual([]);
		expect(dock.offers).toEqual([]);
	});
});

describe("actStatusKindFromOutcome: mapping the trail's own already-recorded classification (round 3, sk-jay0.1.8)", () => {
	it("maps classifyActResult's closed vocabulary, and anything else, to the dock's own kinds", () => {
		expect(actStatusKindFromOutcome("quiet")).toBe("quiet");
		expect(actStatusKindFromOutcome("happened")).toBe("delta");
		expect(actStatusKindFromOutcome("rejected")).toBe("rejected");
		expect(actStatusKindFromOutcome("undescribable")).toBe("other");
		expect(actStatusKindFromOutcome(null)).toBe("other");
	});
});

describe("dockNoticeFrom: the one dock notice (connection and a slow world only)", () => {
	it("reconnecting wins over a slow pending act", () => {
		expect(dockNoticeFrom({ reconnecting: true, slowPending: true })).toEqual({
			text: "Reconnecting to the world…",
			tone: "info",
		});
	});

	it("a slow pending act shows while the world is still thinking", () => {
		expect(dockNoticeFrom({ reconnecting: false, slowPending: true })).toEqual({
			text: "The world is still thinking…",
			tone: "info",
		});
	});

	it("is null when nothing applies — a refusal is a stream line, never a notice", () => {
		expect(dockNoticeFrom({ reconnecting: false, slowPending: false })).toBeNull();
	});
});

describe("targetsFromView / verbsForTarget / combatHandles: target-first action selection (S3, sk-jay0.1.8.39)", () => {
	it("groups three rats and two attack verbs into three roster chips of one verb row each, instead of six flat buttons", () => {
		const groups = targetsFromView(threeRatsView);
		// Three rat chips, tracker order, plus the trailing untargeted chip.
		expect(groups.map((group) => group.targetRef)).toEqual([
			"entity:201",
			"entity:202",
			"entity:203",
			UNTARGETED_TARGET_REF,
		]);
		expect(groups.map((group) => group.label)).toEqual([
			"Cellar Rat 1",
			"Cellar Rat 2",
			"Cellar Rat 3",
			"No target",
		]);
		for (const group of groups.slice(0, 3)) {
			expect(group.actions.map((action) => action.id)).toHaveLength(2);
		}
		expect(verbsForTarget(threeRatsView, "entity:202").map((action) => action.id)).toEqual([
			"h:melee-202",
			"h:unarmed-202",
		]);
	});

	it("lands an untargeted action (Dodge) in the trailing untargeted group, never as a phantom target chip", () => {
		const groups = targetsFromView(threeRatsView);
		const untargeted = groups.find((group) => group.targetRef === UNTARGETED_TARGET_REF);
		expect(untargeted?.actions.map((action) => action.id)).toEqual(["h:dodge"]);
		// The hero's own roster entry ("entity:7") never gets a chip: nothing
		// targets it by name.
		expect(groups.some((group) => group.targetRef === "entity:7")).toBe(false);
	});

	it("groups a non-roster named target (sessionless brawl, socialMeleeOffers) after the roster, before untargeted", () => {
		const view: PlayView = {
			...fightView,
			actions: [...fightView.actions, socialMeleeOffers()[2] as PlayAction],
		};
		const groups = targetsFromView(view);
		expect(groups.map((group) => group.targetRef)).toEqual([
			"entity:123",
			"entity:31",
			UNTARGETED_TARGET_REF,
		]);
	});

	it("every non-free-text handle stays reachable: the union of targetsFromView's groups equals combatHandles", () => {
		for (const view of [fightView, threeRatsView]) {
			const groups = targetsFromView(view);
			const grouped = groups.flatMap((group) => group.actions.map((action) => action.id));
			expect(new Set(grouped)).toEqual(combatHandles(view));
			// Nothing offered by the fight is dropped, and nothing is doubled.
			expect(grouped.sort()).toEqual(view.actions.map((action) => action.id).sort());
		}
	});

	it("keeps actor-carried Speak Aloud in the one shared composer, not the combat verb row", () => {
		const speakAloud: PlayAction = {
			id: "h:speak-aloud",
			label: "Speak Aloud — Renn the Roadwarden",
			verb: "manipulate",
			descriptor: "srd/speak-aloud",
			targetName: "Renn the Roadwarden",
			targetRef: "entity:7",
			acceptsUtterance: true,
		};
		const view: PlayView = { ...fightView, actions: [...fightView.actions, speakAloud] };
		expect(combatHandles(view).has(speakAloud.id)).toBe(false);
		expect(targetsFromView(view).flatMap((group) => group.actions)).not.toContain(speakAloud);
		expect(sayTargetsFromView(view, null)).toEqual([
			expect.objectContaining({ action: speakAloud, label: "Renn the Roadwarden" }),
		]);
	});

	it("yields an empty result and an empty handle set outside a tactical session", () => {
		expect(targetsFromView(sampleView)).toEqual([]);
		expect(targetsFromView(brawlView)).toEqual([]);
		expect(combatHandles(brawlView)).toEqual(new Set());
		expect(verbsForTarget(brawlView, "entity:123")).toEqual([]);
	});
});

describe("verbName: the turn bar's verb button drops the already-selected target from its own label (S3, sk-jay0.1.8.39/40 apply-run correction)", () => {
	it("strips the world's own ' — <target>' suffix when the label ends with it", () => {
		const action: PlayAction = {
			id: "h:melee",
			label: "Melee Attack — Cellar Rat 1",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Cellar Rat 1",
			targetRef: "entity:123",
			acceptsUtterance: false,
		};
		expect(verbName(action)).toBe("Melee Attack");
	});

	it("returns the label unchanged when the display name already contains the target (actionLabel never appended a suffix there)", () => {
		const action: PlayAction = {
			id: "h:x",
			label: "Attack Cellar Rat 1",
			verb: "manipulate",
			descriptor: "srd/attack/melee",
			targetName: "Cellar Rat 1",
			targetRef: "entity:123",
			acceptsUtterance: false,
		};
		expect(verbName(action)).toBe("Attack Cellar Rat 1");
	});

	it("returns the label unchanged for an untargeted action (empty targetName)", () => {
		const action: PlayAction = {
			id: "h:dodge",
			label: "Dodge",
			verb: "manipulate",
			descriptor: "srd/action/dodge",
			targetName: "",
			targetRef: "entity:7",
			acceptsUtterance: false,
		};
		expect(verbName(action)).toBe("Dodge");
	});

	it("matches fightView's own two attack offers", () => {
		const melee = fightView.actions.find((action) => action.id === "h:melee");
		const unarmed = fightView.actions.find((action) => action.id === "h:unarmed-strike");
		expect(melee).toBeDefined();
		expect(unarmed).toBeDefined();
		expect(verbName(melee as PlayAction)).toBe("Melee Attack");
		expect(verbName(unarmed as PlayAction)).toBe("Unarmed strike: damage");
	});
});

describe("exploreStreamFromView: one chronology for Explore (Table design note)", () => {
	function activity(overrides: Partial<ExploreActivity> = {}): ExploreActivity {
		return {
			id: "local:0",
			placeId: sampleView.place?.id ?? null,
			action: "Look around",
			outcome: "You see nothing new.",
			tick: 10,
			...overrides,
		};
	}

	function speechLine(overrides: Partial<PlaySpeech> = {}): PlaySpeech {
		return {
			id: "speech:9",
			tick: 10,
			speakerId: "4",
			speaker: "Aldwin, keeper of the hearth-ledger",
			text: "Rats, by the sound of it.",
			mine: false,
			...overrides,
		};
	}

	it("orders entries by tick ascending, speech before activity on a tied tick", () => {
		const view: PlayView = { ...sampleView, speech: [speechLine({ tick: 5 })] };
		const result = exploreStreamFromView(view, [activity({ tick: 5 })]);
		expect(result.map((entry) => entry.kind)).toEqual(["speech", "activity"]);
		const later = exploreStreamFromView(view, [activity({ id: "local:1", tick: 1 })]);
		expect(later.map((entry) => entry.kind)).toEqual(["activity", "speech"]);
	});

	it("collapses a successful say to one structured outgoing message, dropping the world's own echo (dedupe rule 1)", () => {
		const view: PlayView = { ...sampleView, speech: [] };
		const result = exploreStreamFromView(view, [
			activity({
				action: "You said “hallo welt”",
				outcome: 'You say: "hallo welt"',
				words: "hallo welt",
				tick: 10,
			}),
		]);
		expect(result).toEqual([
			{
				id: "local:0",
				kind: "speech",
				chip: "speech",
				tick: 10,
				heading: "You",
				body: "hallo welt",
				mine: true,
				speaker: "You",
				speakerId: "7",
				addresseeName: null,
				isChoice: false,
				startsBurst: true,
			},
		]);
	});

	it("keeps a refused say's outcome beside its structured outgoing message", () => {
		const view: PlayView = { ...sampleView, speech: [] };
		const result = exploreStreamFromView(view, [
			activity({
				action: "You said “hallo welt”",
				outcome: "Nobody is close enough to hear you.",
				words: "hallo welt",
				tick: 10,
			}),
		]);
		expect(result[0]).toMatchObject({
			kind: "speech",
			body: "hallo welt",
			outcome: "Nobody is close enough to hear you.",
		});
	});

	it("drops the world's mine echo of the same words the local activity already carries (dedupe rule 2)", () => {
		const view: PlayView = {
			...sampleView,
			speech: [
				speechLine({
					id: "speech:1",
					tick: 11,
					speakerId: sampleView.hero.actorId,
					speaker: sampleView.hero.name,
					text: "hallo welt",
					mine: true,
				}),
			],
		};
		const result = exploreStreamFromView(view, [
			activity({
				action: "You said “hallo welt”",
				outcome: 'You say: "hallo welt"',
				words: "hallo welt",
				tick: 10,
			}),
		]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ kind: "speech", mine: true, body: "hallo welt" });
	});

	it("keeps the selected addressee on a local outgoing message until its world trace arrives", () => {
		const result = exploreStreamFromView({ ...sampleView, speech: [] }, [
			activity({
				action: "You said “appearance=dark”",
				outcome: 'You say: "appearance=dark"',
				words: "appearance=dark",
				addresseeName: "Aldwin, keeper of the hearth-ledger",
			}),
		]);
		expect(result[0]).toMatchObject({
			kind: "speech",
			heading: "You",
			body: "appearance=dark",
			addresseeName: "Aldwin, keeper of the hearth-ledger",
		});
	});

	describe("an attempt made from input fields (sk-jay0.1.8.96, sk-jay0.1.8.92)", () => {
		const jsonWords = '{"name":"Brannoch"}';
		const named = (overrides: Partial<ExploreActivity> = {}): ExploreActivity =>
			activity({
				action: "Name your character",
				outcome: `You say: "${jsonWords}"`,
				words: jsonWords,
				display: [{ label: "Name", value: "Brannoch" }],
				...overrides,
			});

		it("renders as an activity row with 'Label: value', never as a 'You' speech bubble with JSON", () => {
			const result = exploreStreamFromView({ ...sampleView, speech: [] }, [named()]);
			expect(result).toEqual([
				{
					id: "local:0",
					kind: "activity",
					chip: "things",
					tick: 10,
					heading: "Name your character",
					body: "Name: Brannoch",
				},
			]);
			expect(JSON.stringify(result)).not.toContain('{\\"');
		});

		it("keeps a refusal under the entered value, with its code for the hover", () => {
			const [entry] = exploreStreamFromView({ ...sampleView, speech: [] }, [
				named({
					outcome: "You cannot do that to yourself.",
					refusal: { code: "self_target_not_allowed" },
				}),
			]);
			expect(entry).toMatchObject({
				kind: "activity",
				heading: "Name your character",
				body: "Name: Brannoch\nYou cannot do that to yourself.",
				refusal: { code: "self_target_not_allowed" },
			});
			expect(entry?.mine).toBeUndefined();
		});

		it("drops the world's own echo of the JSON transport words (dedupe rule 2)", () => {
			const view: PlayView = {
				...sampleView,
				speech: [
					speechLine({
						id: "speech:1",
						tick: 11,
						speakerId: sampleView.hero.actorId,
						speaker: sampleView.hero.name,
						text: jsonWords,
						mine: true,
					}),
				],
			};
			const result = exploreStreamFromView(view, [named()]);
			expect(result.map((entry) => entry.kind)).toEqual(["activity"]);
			expect(result.some((entry) => (entry.body ?? "").includes("{"))).toBe(false);
		});

		it("joins several fields on one line and leaves out an empty one", () => {
			const [entry] = exploreStreamFromView({ ...sampleView, speech: [] }, [
				named({
					action: "Assign ability scores",
					words: '{"dex":"12","str":"15"}',
					outcome: 'You say: "{"dex":"12","str":"15"}"',
					display: [
						{ label: "Strength", value: "15" },
						{ label: "Dexterity", value: " 12 " },
						{ label: "Notes", value: "" },
					],
				}),
			]);
			expect(entry?.body).toBe("Strength: 15 · Dexterity: 12");
			expect(inputDisplayText([{ label: "", value: "Brannoch" }])).toBe("Brannoch");
		});

		it("falls back to the speech behaviour when the display carries no value at all", () => {
			const [entry] = exploreStreamFromView({ ...sampleView, speech: [] }, [
				named({ words: "hallo", outcome: 'You say: "hallo"', display: [] }),
			]);
			expect(entry).toMatchObject({ kind: "speech", body: "hallo", mine: true });
		});
	});

	it("keeps an explicit room route distinct from a missing addressee", () => {
		const result = exploreStreamFromView({ ...sampleView, speech: [] }, [
			activity({
				action: "You said “hey”",
				outcome: 'You say: "hey"',
				words: "hey",
				addressing: "room",
			}),
		]);
		expect(result[0]).toMatchObject({
			kind: "speech",
			body: "hey",
			addresseeName: null,
			addressing: "room",
		});
	});

	it("keeps a non-mine (NPC) speech line as its own speaker block", () => {
		const view: PlayView = { ...sampleView, speech: [speechLine({ tick: 12 })] };
		const result = exploreStreamFromView(view, []);
		expect(result).toEqual([
			{
				id: "speech:9",
				kind: "speech",
				chip: "speech",
				tick: 12,
				heading: "Aldwin, keeper of the hearth-ledger",
				body: "Rats, by the sound of it.",
				mine: false,
				speaker: "Aldwin, keeper of the hearth-ledger",
				speakerId: "4",
				addresseeName: null,
				isChoice: false,
				startsBurst: true,
			},
		]);
	});

	it("keeps a stray mine speech line with no matching local activity", () => {
		const view: PlayView = {
			...sampleView,
			speech: [
				speechLine({
					id: "speech:2",
					tick: 13,
					mine: true,
					speaker: sampleView.hero.name,
					text: "hello",
				}),
			],
		};
		const result = exploreStreamFromView(view, []);
		expect(result).toEqual([
			{
				id: "speech:2",
				kind: "speech",
				chip: "speech",
				tick: 13,
				heading: "You",
				body: "hello",
				mine: true,
				speaker: "You",
				speakerId: "4",
				addresseeName: null,
				isChoice: false,
				startsBurst: true,
			},
		]);
	});

	describe("the Thread-shaped speech fields and burst grouping (sk-jay0.1.8.63.1)", () => {
		it("groups a same-speaker run under one burst, same rule threadFromView uses", () => {
			const view: PlayView = {
				...sampleView,
				speech: [
					speechLine({ id: "speech:1", tick: 10, text: "First." }),
					speechLine({ id: "speech:2", tick: 11, text: "Second." }),
					speechLine({
						id: "speech:3",
						tick: 12,
						mine: true,
						speaker: sampleView.hero.name,
						text: "Reply.",
					}),
				],
			};
			const result = exploreStreamFromView(view, []);
			expect(result.map((entry) => entry.startsBurst)).toEqual([true, false, true]);
		});

		it("breaks a burst across an activity or a place divider between two same-speaker lines", () => {
			const view: PlayView = {
				...sampleView,
				speech: [
					speechLine({ id: "speech:1", tick: 10, text: "First." }),
					speechLine({ id: "speech:2", tick: 12, text: "Second." }),
				],
			};
			const result = exploreStreamFromView(view, [activity({ id: "local:0", tick: 11 })], {
				dividers: [{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 13 }],
			});
			// tick order: speech:1 (10), local:0 (11), speech:2 (12), place:0 (13).
			const speech = result.filter((entry) => entry.kind === "speech");
			expect(speech.map((entry) => entry.id)).toEqual(["speech:1", "speech:2"]);
			expect(speech.map((entry) => entry.startsBurst)).toEqual([true, true]);
		});

		it("carries addresseeName and isChoice through onto the entry", () => {
			const view: PlayView = {
				...sampleView,
				speech: [
					speechLine({ id: "speech:1", tick: 10, text: "General remark." }),
					{
						...speechLine({ id: "speech:2", tick: 11, text: "Direct remark." }),
						addresseeName: "Renn the Roadwarden",
					},
					speechLine({
						id: "speech:3",
						tick: 12,
						mine: true,
						speaker: sampleView.hero.name,
						text: "5 Fighter",
						choiceSlot: 5,
					}),
				],
			};
			const result = exploreStreamFromView(view, []);
			expect(result.find((entry) => entry.id === "speech:1")?.addresseeName).toBeNull();
			expect(result.find((entry) => entry.id === "speech:2")?.addresseeName).toBe(
				"Renn the Roadwarden",
			);
			expect(result.find((entry) => entry.id === "speech:3")?.isChoice).toBe(true);
		});
	});

	it("drops a departed speaker's lines heard before the player arrived; a present speaker keeps theirs", () => {
		const view: PlayView = {
			...sampleView,
			occupants: [],
			speech: [
				speechLine({ id: "speech:1", tick: 5, text: "Said in the loft." }),
				speechLine({ id: "speech:2", tick: 20, text: "Said on the stairs." }),
			],
		};
		expect(exploreStreamFromView(view, [], { sinceTick: 20 }).map((entry) => entry.id)).toEqual([
			"speech:2",
		]);
		// No arrival observed: presence decides, and nobody is here.
		expect(exploreStreamFromView(view, [], { sinceTick: null }).map((entry) => entry.id)).toEqual(
			[],
		);
		const withSpeaker: PlayView = { ...view, occupants: sampleView.occupants };
		expect(
			exploreStreamFromView(withSpeaker, [], { sinceTick: null }).map((entry) => entry.id),
		).toEqual(["speech:1", "speech:2"]);
	});

	it("after an arrival, a present speaker's backfilled earlier lines stay out of the journal", () => {
		// The session backfills a place's earlier speech from traces on arrival.
		// Those old-tick lines would sort retroactively under the previous place.
		const view: PlayView = {
			...sampleView,
			speech: [
				speechLine({ id: "speech:1", tick: 5, text: "Said here long ago." }),
				speechLine({ id: "speech:old-mine", tick: 6, mine: true, text: "My old answer." }),
				speechLine({ id: "speech:2", tick: 20, text: "Said as I walked in." }),
			],
		};
		expect(exploreStreamFromView(view, [], { sinceTick: 20 }).map((entry) => entry.id)).toEqual([
			"speech:2",
		]);
	});

	it("keeps activities from every place in one continuous journal — no place filter (sk-jay0.1.8.60)", () => {
		const view: PlayView = { ...sampleView, speech: [] };
		const result = exploreStreamFromView(view, [
			activity({ id: "local:here", placeId: sampleView.place?.id ?? null, tick: 1 }),
			activity({ id: "local:elsewhere", placeId: "inn/stairs", tick: 2 }),
		]);
		expect(result.map((entry) => entry.id)).toEqual(["local:here", "local:elsewhere"]);
	});

	it("keeps EXPLORE_ACTIVITY_LIMIT at 1000, and bounds activities/speech to the last that many", () => {
		expect(EXPLORE_ACTIVITY_LIMIT).toBe(1000);
		const many = Array.from({ length: EXPLORE_ACTIVITY_LIMIT + 5 }, (_, index) =>
			activity({ id: `local:${index}`, tick: index }),
		);
		const result = exploreStreamFromView({ ...sampleView, speech: [] }, many);
		expect(result).toHaveLength(EXPLORE_ACTIVITY_LIMIT);
		expect(result[0]?.id).toBe("local:5");
		expect(result.at(-1)?.id).toBe(`local:${EXPLORE_ACTIVITY_LIMIT + 4}`);
	});

	describe("place-arrival dividers (sk-jay0.1.8.60, one continuous journal)", () => {
		it("renders a divider with the place's own name as heading, and no body", () => {
			// sampleView offers Aldwin as addressable, so its sole (and therefore
			// newest) divider also carries the current `company` prose
			// (sk-jay0.1.8.63.5) — see the dedicated describe block below for the
			// "only the newest one" rule.
			const view: PlayView = { ...sampleView, speech: [] };
			const result = exploreStreamFromView(view, [], {
				dividers: [{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 3 }],
			});
			expect(result).toEqual([
				{
					id: "place:0",
					kind: "place",
					tick: 3,
					heading: "The Bar",
					body: null,
					company: "Aldwin, keeper of the hearth-ledger is nearby",
					companyParts: [
						{ kind: "name", occupantId: "4", text: "Aldwin, keeper of the hearth-ledger" },
						{ kind: "text", text: " is nearby" },
					],
				},
			]);
		});

		it("on a tied tick, orders a divider before speech before activity", () => {
			const view: PlayView = { ...sampleView, speech: [speechLine({ tick: 5 })] };
			const result = exploreStreamFromView(view, [activity({ tick: 5 })], {
				dividers: [{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 5 }],
			});
			expect(result.map((entry) => entry.kind)).toEqual(["place", "speech", "activity"]);
		});

		describe("local entries on one tick keep their recorded order (sk-jay0.1.8.96 s10)", () => {
			it("puts an attempt recorded before the arrival above that place's divider", () => {
				const result = exploreStreamFromView(
					{ ...sampleView, speech: [] },
					[activity({ id: "local:0", action: "Travel — The Bar", tick: 5, recordSeq: 1 })],
					{
						dividers: [
							{ id: "place:0", placeId: "inn/hall", placeName: "The Hall", tick: 5, recordSeq: 0 },
							{ id: "place:1", placeId: "inn/bar", placeName: "The Bar", tick: 5, recordSeq: 2 },
						],
					},
				);
				expect(result.map((entry) => entry.heading)).toEqual([
					"The Hall",
					"Travel — The Bar",
					"The Bar",
				]);
			});

			it("moves only the earlier attempt above the divider: world lines stay below the place they share a tick with", () => {
				const view: PlayView = {
					...sampleView,
					speech: [speechLine({ id: "speech:1", tick: 5 })],
				};
				const result = exploreStreamFromView(
					view,
					[activity({ id: "local:0", tick: 5, recordSeq: 0 })],
					{
						dividers: [
							{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 5, recordSeq: 1 },
						],
						events: [{ id: "event:1", tick: 5, kind: "xp_gained", summary: "You gain 10 XP." }],
					},
				);
				// Kind order is place, speech, event, activity. The attempt recorded
				// before the arrival goes directly above the divider. The greeting
				// and the event of that tick stay under "The Bar", in their order:
				// a line heard on arrival never reads above the place it was heard in.
				expect(result.map((entry) => entry.id)).toEqual([
					"local:0",
					"place:0",
					"speech:1",
					"chronicle:event:event:1",
				]);
			});

			it("keeps an own entry recorded after the arrival below the world lines of that tick", () => {
				const view: PlayView = {
					...sampleView,
					speech: [speechLine({ id: "speech:1", tick: 5 })],
				};
				const result = exploreStreamFromView(
					view,
					[
						activity({ id: "local:0", tick: 5, recordSeq: 0 }),
						activity({ id: "local:1", tick: 5, recordSeq: 2 }),
					],
					{
						dividers: [
							{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 5, recordSeq: 1 },
						],
					},
				);
				expect(result.map((entry) => entry.id)).toEqual([
					"local:0",
					"place:0",
					"speech:1",
					"local:1",
				]);
			});

			it("leaves a tick in kind order when nothing was recorded before its divider", () => {
				const view: PlayView = {
					...sampleView,
					speech: [speechLine({ id: "speech:1", tick: 5 })],
				};
				const result = exploreStreamFromView(
					view,
					[
						activity({ id: "local:0", tick: 5, recordSeq: 2 }),
						activity({ id: "local:1", tick: 5, recordSeq: 1 }),
					],
					{
						dividers: [
							{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 5, recordSeq: 0 },
						],
					},
				);
				expect(result.map((entry) => entry.id)).toEqual([
					"place:0",
					"speech:1",
					"local:0",
					"local:1",
				]);
			});

			it("leaves other ticks alone and keeps the kind order for entries without a record number", () => {
				const result = exploreStreamFromView(
					{ ...sampleView, speech: [] },
					[
						activity({ id: "local:0", tick: 4, recordSeq: 5 }),
						activity({ id: "local:1", tick: 6 }),
					],
					{
						dividers: [
							{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 5, recordSeq: 9 },
							{ id: "place:1", placeId: "inn/hall", placeName: "The Hall", tick: 6, recordSeq: 0 },
						],
					},
				);
				expect(result.map((entry) => entry.id)).toEqual([
					"local:0",
					"place:0",
					"place:1",
					"local:1",
				]);
			});
		});

		it("keeps up to EXPLORE_ACTIVITY_LIMIT dividers, oldest dropped first", () => {
			const dividers = Array.from({ length: EXPLORE_ACTIVITY_LIMIT + 2 }, (_, index) => ({
				id: `place:${index}`,
				placeId: `place-${index}`,
				placeName: `Place ${index}`,
				tick: index,
			}));
			const result = exploreStreamFromView({ ...sampleView, speech: [] }, [], { dividers });
			expect(result).toHaveLength(EXPLORE_ACTIVITY_LIMIT);
			expect(result[0]?.id).toBe("place:2");
		});

		describe("company attaches only to the newest place entry (sk-jay0.1.8.63.5, section headers)", () => {
			it("carries the current view's company on the last divider only, leaving an earlier arrival's divider unchanged", () => {
				const view: PlayView = { ...sampleView, speech: [] };
				const result = exploreStreamFromView(view, [], {
					dividers: [
						{ id: "place:0", placeId: "inn/common-room", placeName: "Common Room", tick: 1 },
						{ id: "place:1", placeId: "inn/bar", placeName: "The Bar", tick: 3 },
					],
				});
				expect(result.map((entry) => entry.company)).toEqual([
					undefined,
					"Aldwin, keeper of the hearth-ledger is nearby",
				]);
				expect(result.map((entry) => entry.companyParts)).toEqual([
					undefined,
					[
						{ kind: "name", occupantId: "4", text: "Aldwin, keeper of the hearth-ledger" },
						{ kind: "text", text: " is nearby" },
					],
				]);
			});

			it("omits company on the newest entry too when nobody is currently addressable", () => {
				const view: PlayView = {
					...sampleView,
					speech: [],
					actions: sampleView.actions.filter((action) => action.id !== "h:talk"),
				};
				const result = exploreStreamFromView(view, [], {
					dividers: [{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 3 }],
				});
				expect(result[0]?.company).toBeUndefined();
				expect(result[0]?.companyParts).toBeUndefined();
			});
		});
	});

	describe("speech retention (sk-jay0.1.8.60, 'speech never disappears')", () => {
		it("keeps an already-admitted speech line even once its speaker has left and the arrival window has moved past it", () => {
			const line = speechLine({ id: "speech:1", tick: 5, text: "Said in the loft." });
			const goneView: PlayView = { ...sampleView, occupants: [], speech: [line] };
			// Not yet admitted, speaker gone, heard before the later arrival: excluded.
			expect(
				exploreStreamFromView(goneView, [], { sinceTick: 20 }).map((entry) => entry.id),
			).toEqual([]);
			// Already admitted (e.g. by an earlier render): stays regardless.
			expect(
				exploreStreamFromView(goneView, [], {
					sinceTick: 20,
					admittedSpeechIds: new Set(["speech:1"]),
				}).map((entry) => entry.id),
			).toEqual(["speech:1"]);
		});

		it("an admitted id that names no current line in view.speech simply contributes nothing (the function never invents content)", () => {
			const view: PlayView = { ...sampleView, speech: [] };
			const result = exploreStreamFromView(view, [], {
				admittedSpeechIds: new Set(["speech:gone"]),
			});
			expect(result).toEqual([]);
		});
	});

	describe("alwaysAdmitIds: Talk's open prompt still shows even when it predates this arrival (sk-jay0.1.8.63.1 Part B)", () => {
		it("admits a departed speaker's line that the ordinary rule would otherwise exclude", () => {
			const line = speechLine({ id: "speech:1", tick: 5, text: "Which class calls to you?" });
			const goneView: PlayView = { ...sampleView, occupants: [], speech: [line] };
			expect(
				exploreStreamFromView(goneView, [], { sinceTick: 20 }).map((entry) => entry.id),
			).toEqual([]);
			expect(
				exploreStreamFromView(goneView, [], {
					sinceTick: 20,
					alwaysAdmitIds: new Set(["speech:1"]),
				}).map((entry) => entry.id),
			).toEqual(["speech:1"]);
		});

		it("sorts a line admitted ONLY through alwaysAdmitIds just after the newest place row, without altering its own tick", () => {
			const line = speechLine({ id: "speech:1", tick: 5, text: "Which class calls to you?" });
			const view: PlayView = {
				...sampleView,
				occupants: [],
				speech: [line],
			};
			const result = exploreStreamFromView(view, [], {
				sinceTick: 20,
				alwaysAdmitIds: new Set(["speech:1"]),
				dividers: [{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 20 }],
			});
			expect(result.map((entry) => entry.id)).toEqual(["place:0", "speech:1"]);
			// The entry's own `tick` is untouched — only where it SORTS moved.
			expect(result.find((entry) => entry.id === "speech:1")?.tick).toBe(5);
		});

		it("does not reorder a line that already passes the ordinary rule, even if it is also in alwaysAdmitIds", () => {
			const early = speechLine({ id: "speech:1", tick: 21, text: "Heard right after arrival." });
			const view: PlayView = { ...sampleView, speech: [early] };
			const result = exploreStreamFromView(view, [], {
				sinceTick: 20,
				alwaysAdmitIds: new Set(["speech:1"]),
				dividers: [{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 20 }],
			});
			// Ordinary admission already applies (tick 21 >= sinceTick 20): the
			// line keeps its own tick's natural sort position, not a clamp.
			expect(result.map((entry) => entry.id)).toEqual(["place:0", "speech:1"]);
		});

		it("an alwaysAdmitIds entry with no matching line in view.speech contributes nothing", () => {
			const view: PlayView = { ...sampleView, speech: [] };
			const result = exploreStreamFromView(view, [], { alwaysAdmitIds: new Set(["speech:gone"]) });
			expect(result).toEqual([]);
		});
	});

	describe("world events as journal lines (sk-jay0.1.8.63.2)", () => {
		function event(overrides: Partial<PlayChronicleEntry> = {}): PlayChronicleEntry {
			return {
				id: "event:0",
				tick: 10,
				kind: "self_hit",
				summary: "You take 3 srd/hp damage (bite).",
				...overrides,
			};
		}

		it("classifies each event kind through the SAME chip/important table the Chronicle reads (chronicleKindRule)", () => {
			const view: PlayView = { ...sampleView, speech: [] };
			const result = exploreStreamFromView(view, [], {
				events: [
					event({
						id: "event:1",
						tick: 10,
						kind: "session_lifecycle",
						summary: "A session opens (2 participants).",
					}),
					event({
						id: "event:2",
						tick: 11,
						kind: "dealt_hit",
						summary: "You hit Cellar Rat 1 for 5 damage.",
					}),
					event({
						id: "event:3",
						tick: 12,
						kind: "turn_transition",
						summary: "The turn passes from Renn to Cellar Rat 1.",
					}),
				],
			});
			expect(result).toEqual([
				{
					id: "chronicle:event:event:1",
					kind: "event",
					tick: 10,
					heading: "A session opens (2 participants).",
					body: null,
					chip: "comings",
					important: true,
				},
				{
					id: "chronicle:event:event:2",
					kind: "event",
					tick: 11,
					heading: "You hit Cellar Rat 1 for 5 damage.",
					body: null,
					chip: "fight",
					important: true,
				},
				{
					id: "chronicle:event:event:3",
					kind: "event",
					tick: 12,
					heading: "The turn passes from Renn to Cellar Rat 1.",
					body: null,
					chip: "fight",
					important: false,
				},
			]);
		});

		it("orders a divider, then speech, then an event, then an activity on the same tick", () => {
			const view: PlayView = {
				...sampleView,
				speech: [speechLine({ id: "speech:1", tick: 5 })],
			};
			const result = exploreStreamFromView(view, [activity({ id: "local:1", tick: 5 })], {
				dividers: [{ id: "place:0", placeId: "inn/bar", placeName: "The Bar", tick: 5 }],
				events: [event({ id: "event:1", tick: 5 })],
			});
			expect(result.map((entry) => entry.kind)).toEqual(["place", "speech", "event", "activity"]);
		});

		it("keeps two same-tick events in the order the caller's own accumulated array already holds them (stable sort, no invented tiebreak)", () => {
			const view: PlayView = { ...sampleView, speech: [] };
			const result = exploreStreamFromView(view, [], {
				events: [
					event({ id: "event:1", tick: 20, summary: "First." }),
					event({ id: "event:2", tick: 20, summary: "Second." }),
				],
			});
			expect(result.map((entry) => entry.heading)).toEqual(["First.", "Second."]);
		});

		it("never surfaces a DM-internal condition change, through the real event→PlayChronicleEntry pipeline", () => {
			const dmInternal: WorldEvent = {
				kind: "self_condition_changed",
				condition_id: "core/condition/controlled",
				applied: true,
				source_entity_id: null,
				observed_at_tick: 7,
			};
			const playerFacing: WorldEvent = {
				kind: "self_condition_changed",
				condition_id: "srd/condition/prone",
				applied: true,
				source_entity_id: null,
				observed_at_tick: 8,
			};
			// The same conversion `play-session.ts` runs on every drained event
			// before it ever reaches `view.events` — `playChronicleEntry` drops
			// a DM-internal condition change entirely (returns `null`), so
			// there is no `PlayChronicleEntry` for it to accumulate in the
			// first place, let alone one this function could surface.
			const entries = [dmInternal, playerFacing]
				.map((raw, index) => playChronicleEntry(raw, index))
				.filter((entry): entry is PlayChronicleEntry => entry !== null);
			const view: PlayView = { ...sampleView, speech: [] };
			const result = exploreStreamFromView(view, [], { events: entries });
			expect(result).toHaveLength(1);
			expect(result[0]?.heading).toBe("You are now affected by Prone.");
			expect(result.some((entry) => entry.heading.includes("core/condition/controlled"))).toBe(
				false,
			);
		});

		it("shows no template id and no actor id for events ingested while a session was open and rendered after it closed (sk-jay0.1.8.96)", () => {
			// The regression of sk-jay0.1.8.63.41: by render time the walk
			// session is closed, so `view.session.roster` is empty.
			const raw: WorldEvent[] = [
				{
					kind: "turn_transition",
					session_id: "9001",
					from_actor: null,
					to_actor: sampleView.hero.actorId,
					observed_at_tick: 5,
				},
				{
					kind: "self_resource_spent",
					resource_id: "srd/speed-walk",
					amount: 114,
					source: "srd/dm/set/srd.speed-walk/success",
					observed_at_tick: 5,
				},
				{
					kind: "self_hit",
					resource_id: "srd/hp",
					amount: 5,
					new_value: 0,
					attack_kind: "srd/attack/melee/success",
					attacker_id: "170",
					observed_at_tick: 6,
				},
				{
					kind: "self_condition_changed",
					condition_id: "dm/creation/pending/name",
					applied: false,
					source_entity_id: null,
					observed_at_tick: 6,
				},
				{
					kind: "turn_transition",
					session_id: "9001",
					from_actor: sampleView.hero.actorId,
					to_actor: "171",
					observed_at_tick: 6,
				},
			];
			const context = {
				selfIds: new Set([sampleView.hero.actorId]),
				names: new Map([["170", "Cellar Rat"]]),
			};
			const entries = raw
				.map((item, index) => playChronicleEntry(item, index, context))
				.filter((entry): entry is PlayChronicleEntry => entry !== null);
			const view: PlayView = {
				...sampleView,
				speech: [],
				session: { ...sampleView.session, inSession: false, roster: [] },
			};
			const headings = exploreStreamFromView(view, [], { events: entries }).map(
				(entry) => entry.heading,
			);
			expect(headings).toEqual([
				"The turn opens with you.",
				"You spend 114 Speed Walk.",
				"You take 5 damage from Cellar Rat — 0 HP left.",
				"The turn passes from you to someone.",
			]);
			for (const heading of headings) {
				expect(heading).not.toContain("srd/");
				expect(heading).not.toMatch(/\b(170|171|9001)\b/);
				expect(heading).not.toMatch(new RegExp(`\\b${sampleView.hero.actorId}\\b`));
			}
		});

		it("accumulation contract: an event no longer in view.events still renders as long as the caller's accumulated array still holds it", () => {
			// `exploreStreamFromView` never reads `view.events` directly — only
			// whatever the caller (`PlayTable.svelte`'s own accumulated ring)
			// passes as `options.events`. A view whose OWN `events` field has
			// moved on (the 40-entry ring evicted this one) still renders the
			// fact here, proving the function is decoupled from that ring.
			const view: PlayView = {
				...sampleView,
				speech: [],
				events: [event({ id: "event:new", tick: 99, summary: "Something else entirely." })],
			};
			const result = exploreStreamFromView(view, [], {
				events: [
					event({ id: "event:old", tick: 1, summary: "An old fact the ring has since dropped." }),
				],
			});
			expect(result.map((entry) => entry.heading)).toEqual([
				"An old fact the ring has since dropped.",
			]);
		});

		describe("dedupe rule 4: an own activity's outcome body defers to a matching dealt_hit/dealt_condition event", () => {
			it("drops the activity's body when a dealt_hit event on the same tick names the same target", () => {
				const view: PlayView = { ...sampleView, speech: [] };
				const result = exploreStreamFromView(
					view,
					[
						activity({
							action: "Melee Attack — Cellar Rat 1",
							outcome: "You hit Cellar Rat 1 for 5 damage.",
							tick: 60,
						}),
					],
					{
						events: [
							event({
								id: "event:1",
								tick: 60,
								kind: "dealt_hit",
								summary: "You hit Cellar Rat 1 for 5 damage.",
							}),
						],
					},
				);
				expect(result.find((entry) => entry.kind === "activity")).toMatchObject({
					heading: "Melee Attack — Cellar Rat 1",
					body: null,
				});
			});

			it("matches an ingested event on its structured target name", () => {
				const dealt = playChronicleEntry(
					{
						kind: "dealt_hit",
						target_name: "Cellar Rat 1",
						amount: 5,
						attacker_id: "7",
						observed_at_tick: 60,
					},
					0,
				);
				if (dealt === null) throw new Error("expected a chronicle entry");
				expect(dealt.fields?.targetName).toBe("Cellar Rat 1");
				const view: PlayView = { ...sampleView, speech: [] };
				const attack = (target: string) =>
					exploreStreamFromView(
						view,
						[
							activity({
								action: `Melee Attack — ${target}`,
								outcome: `You hit ${target} for 5 damage.`,
								tick: 60,
							}),
						],
						{ events: [dealt] },
					).find((entry) => entry.kind === "activity");
				expect(attack("Cellar Rat 1")?.body).toBeNull();
				expect(attack("Cellar Rat 2")?.body).toBe("You hit Cellar Rat 2 for 5 damage.");
			});

			it("drops the activity's body for a matching dealt_condition event too", () => {
				const view: PlayView = { ...sampleView, speech: [] };
				const result = exploreStreamFromView(
					view,
					[
						activity({
							action: "Cast Bless — Cellar Rat 1",
							outcome: "Cellar Rat 1 is now affected by Bless.",
							tick: 30,
						}),
					],
					{
						events: [
							event({
								id: "event:1",
								tick: 30,
								kind: "dealt_condition",
								summary: "Cellar Rat 1 is now affected by Bless.",
							}),
						],
					},
				);
				expect(result.find((entry) => entry.kind === "activity")?.body).toBeNull();
			});

			it("keeps the activity's body when the matching event is on a different tick", () => {
				const view: PlayView = { ...sampleView, speech: [] };
				const result = exploreStreamFromView(
					view,
					[
						activity({
							action: "Melee Attack — Cellar Rat 1",
							outcome: "You hit Cellar Rat 1 for 5 damage.",
							tick: 60,
						}),
					],
					{
						events: [
							event({
								id: "event:1",
								tick: 61,
								kind: "dealt_hit",
								summary: "You hit Cellar Rat 1 for 5 damage.",
							}),
						],
					},
				);
				expect(result.find((entry) => entry.kind === "activity")?.body).toBe(
					"You hit Cellar Rat 1 for 5 damage.",
				);
			});

			it("keeps the activity's body when the matching event names a different target", () => {
				const view: PlayView = { ...sampleView, speech: [] };
				const result = exploreStreamFromView(
					view,
					[
						activity({
							action: "Melee Attack — Cellar Rat 1",
							outcome: "You hit Cellar Rat 1 for 5 damage.",
							tick: 60,
						}),
					],
					{
						events: [
							event({
								id: "event:1",
								tick: 60,
								kind: "dealt_hit",
								summary: "You hit Cellar Rat 2 for 5 damage.",
							}),
						],
					},
				);
				expect(result.find((entry) => entry.kind === "activity")?.body).toBe(
					"You hit Cellar Rat 1 for 5 damage.",
				);
			});

			it("never drops a refusal's own body, even sharing a tick and target with a dealt_hit event", () => {
				const view: PlayView = { ...sampleView, speech: [] };
				const result = exploreStreamFromView(
					view,
					[
						activity({
							action: "Melee Attack — Cellar Rat 1",
							outcome: "Cellar Rat 1 is out of reach.",
							tick: 60,
							refusal: { code: "out_of_reach" },
						}),
					],
					{
						events: [
							event({
								id: "event:1",
								tick: 60,
								kind: "dealt_hit",
								summary: "You hit Cellar Rat 1 for 5 damage.",
							}),
						],
					},
				);
				expect(result.find((entry) => entry.kind === "activity")?.body).toBe(
					"Cellar Rat 1 is out of reach.",
				);
			});

			it("leaves an untargeted activity (no ' — <target>' suffix) untouched even with a same-tick dealt_hit event", () => {
				const view: PlayView = { ...sampleView, speech: [] };
				const result = exploreStreamFromView(
					view,
					[activity({ action: "Dodge", outcome: "You brace for the next blow.", tick: 60 })],
					{
						events: [
							event({
								id: "event:1",
								tick: 60,
								kind: "dealt_hit",
								summary: "You hit Cellar Rat 1 for 5 damage.",
							}),
						],
					},
				);
				expect(result.find((entry) => entry.kind === "activity")?.body).toBe(
					"You brace for the next blow.",
				);
			});
		});
	});
});

describe("companyPartsFromOccupants: the structured 'who's nearby' sentence (sk-jay0.1.8.63.7)", () => {
	function joined(parts: CompanyPart[] | null): string | null {
		return parts === null ? null : parts.map((part) => part.text).join("");
	}

	it("returns null for an empty list", () => {
		expect(companyPartsFromOccupants([])).toBeNull();
	});

	it("one occupant: a single name part plus ' is nearby'", () => {
		const parts = companyPartsFromOccupants([{ id: "4", name: "Aldwin" }]);
		expect(parts).toEqual([
			{ kind: "name", occupantId: "4", text: "Aldwin" },
			{ kind: "text", text: " is nearby" },
		]);
		expect(joined(parts)).toBe("Aldwin is nearby");
	});

	it("two occupants: both named, joined by 'and'", () => {
		const parts = companyPartsFromOccupants([
			{ id: "4", name: "Aldwin" },
			{ id: "9", name: "Mira" },
		]);
		expect(parts).toEqual([
			{ kind: "name", occupantId: "4", text: "Aldwin" },
			{ kind: "text", text: " and " },
			{ kind: "name", occupantId: "9", text: "Mira" },
			{ kind: "text", text: " are nearby" },
		]);
		expect(joined(parts)).toBe("Aldwin and Mira are nearby");
	});

	it("three or more: the first two named, the rest counted in the trailing text part", () => {
		const parts = companyPartsFromOccupants([
			{ id: "4", name: "Aldwin" },
			{ id: "9", name: "Mira" },
			{ id: "40", name: "Brother Caddoc" },
		]);
		expect(parts).toEqual([
			{ kind: "name", occupantId: "4", text: "Aldwin" },
			{ kind: "text", text: ", " },
			{ kind: "name", occupantId: "9", text: "Mira" },
			{ kind: "text", text: " and 1 more are nearby" },
		]);
		expect(joined(parts)).toBe("Aldwin, Mira and 1 more are nearby");
	});

	it("only the 'name' parts carry an occupantId; the connective text never does", () => {
		const parts = companyPartsFromOccupants([
			{ id: "4", name: "Aldwin" },
			{ id: "9", name: "Mira" },
		]);
		if (parts === null) throw new Error("named occupants produce company parts");
		expect(
			parts.filter((part) => part.kind === "name").every((part) => part.occupantId !== undefined),
		).toBe(true);
		expect(
			parts.filter((part) => part.kind === "text").every((part) => part.occupantId === undefined),
		).toBe(true);
	});
});

describe("exploreContextFromView: the stable place/company header (Table design note)", () => {
	it("omits the company side when nobody is currently addressable", () => {
		const view: PlayView = {
			...sampleView,
			actions: sampleView.actions.filter((action) => action.id !== "h:talk"),
		};
		expect(exploreContextFromView(view)).toEqual({
			placeName: "Common Room",
			company: null,
			companyParts: null,
		});
	});

	it("names the one addressable occupant", () => {
		expect(exploreContextFromView(sampleView)).toEqual({
			placeName: "Common Room",
			company: "Aldwin, keeper of the hearth-ledger is nearby",
			companyParts: [
				{ kind: "name", occupantId: "4", text: "Aldwin, keeper of the hearth-ledger" },
				{ kind: "text", text: " is nearby" },
			],
		});
	});

	it("joins two addressable occupants with 'and'", () => {
		const view: PlayView = {
			...talkGroupView,
			occupants: talkGroupView.occupants.filter((occupant) => occupant.id !== "40"),
			actions: talkGroupView.actions.filter((action) => action.id !== "h:talk-mira"),
		};
		expect(exploreContextFromView(view).company).toBe(
			"Aldwin, keeper of the hearth-ledger and Brother Caddoc are nearby",
		);
	});

	it("names the first two and counts the rest for three or more", () => {
		expect(exploreContextFromView(talkGroupView).company).toBe(
			"Aldwin, keeper of the hearth-ledger, Brother Caddoc and 1 more are nearby",
		);
	});

	it("excludes the player themself even if somehow offered as their own target", () => {
		const view: PlayView = {
			...sampleView,
			occupants: [
				...sampleView.occupants,
				{
					id: sampleView.hero.actorId,
					handle: "s:actor:7",
					rev: "a7",
					kind: "person",
					sceneKind: "actor",
					name: sampleView.hero.name,
					conditions: [],
					note: "Here with you",
				},
			],
			actions: [
				...sampleView.actions,
				{
					id: "h:talk-self",
					label: "Speak To — Renn the Roadwarden",
					verb: "communicate",
					descriptor: "srd/speak-to",
					targetName: sampleView.hero.name,
					targetRef: `entity:${sampleView.hero.actorId}`,
					acceptsUtterance: true,
				},
			],
		};
		expect(exploreContextFromView(view).company).toBe(
			"Aldwin, keeper of the hearth-ledger is nearby",
		);
	});
});

describe("xpProgressLabel: experience against the next SRD threshold", () => {
	it("shows the figure against the threshold of the next level", () => {
		expect(xpProgressLabel(25, 1)).toBe("25 / 300");
		expect(xpProgressLabel(950, 3)).toBe("950 / 2700");
	});
	it("shows the bare figure at level 20 or with an unknown level", () => {
		expect(xpProgressLabel(400000, 20)).toBe("400000");
		expect(xpProgressLabel(7, undefined)).toBe("7");
	});
});

describe("threadLineIdsForPlace: what this place's thread keeps", () => {
	const line = (id: string, tick: number, speakerId: string | null, mine = false): PlaySpeech => ({
		id,
		tick,
		speakerId,
		speaker: speakerId ?? "world",
		text: "…",
		mine,
	});
	it("keeps own lines, present speakers, and anything heard since arriving; drops a departed speaker's older lines", () => {
		const firstOccupant = sampleView.occupants[0];
		if (firstOccupant === undefined) throw new Error("sample view supplies an occupant");
		const view: PlayView = {
			...sampleView,
			occupants: [{ ...firstOccupant, id: "40", name: "Mira" }],
			speech: [
				line("old-aldwin", 10, "4"),
				line("old-mine", 11, "7", true),
				line("old-mira", 12, "40"),
				line("new-caddoc", 30, "9"),
				line("narration", 31, null),
			],
		};
		const kept = threadLineIdsForPlace(view, 20);
		expect([...kept]).toEqual(["old-mine", "old-mira", "new-caddoc", "narration"]);
	});
	it("keeps everything on a reload (no arrival observed), whoever is here", () => {
		const view: PlayView = {
			...sampleView,
			occupants: [],
			speech: [line("a", 1, "4"), line("b", 2, "9")],
		};
		expect([...threadLineIdsForPlace(view, null)]).toEqual(["a", "b"]);
	});
});

describe("splitDockAnswers: BG3-style answer buttons", () => {
	const answer = (id: string, number: number, text: string): DockAnswer => ({ id, number, text });

	it("shows every answer under the limit, unshortened", () => {
		const answers = [answer("a:1", 1, "Fighter"), answer("a:2", 2, "Rogue")];
		expect(splitDockAnswers(answers)).toEqual({ shown: answers, overflow: [] });
	});

	it("moves answers beyond the limit to overflow, full text intact", () => {
		const answers = [
			answer("a:1", 1, "One"),
			answer("a:2", 2, "Two"),
			answer("a:3", 3, "Three"),
			answer("a:4", 4, "Four"),
		];
		const { shown, overflow } = splitDockAnswers(answers, 3);
		expect(shown).toEqual(answers.slice(0, 3));
		expect(overflow).toEqual([answer("a:4", 4, "Four")]);
	});

	it("shortens a shown answer's text on a word boundary with a trailing ellipsis", () => {
		const long = answer("a:1", 1, "Adopt the recommended array of ability scores");
		const { shown } = splitDockAnswers([long], 3, 24);
		expect(shown[0]?.text).toBe("Adopt the recommended…");
		expect(shown[0]?.text.length).toBeLessThanOrEqual(24);
	});

	it("does not shorten overflow answers", () => {
		const long = answer("a:5", 5, "Discard the drafted character and start over");
		const { overflow } = splitDockAnswers([long], 0, 24);
		expect(overflow).toEqual([long]);
	});

	it("leaves an exactly-maxChars answer untouched", () => {
		const exact = answer("a:1", 1, "12345678901234567890");
		const { shown } = splitDockAnswers([exact], 3, exact.text.length);
		expect(shown[0]?.text).toBe(exact.text);
	});
});

describe("heroDownedFromView — the Table's downed scene fact (sk-jay0.1.8.101 s2)", () => {
	it("is true while the hero carries the world's Unconscious id", () => {
		expect(heroDownedFromView(downedHeroView)).toBe(true);
	});

	it("is false for a standing hero, and for implied rows alone or a label lookalike", () => {
		expect(heroDownedFromView(fightView)).toBe(false);
		const impliedOnly = {
			hero: {
				...downedHeroView.hero,
				conditions: ["srd/condition/incapacitated", "srd/condition/no-action"],
			},
		};
		expect(heroDownedFromView(impliedOnly)).toBe(false);
		// Matched by exact id, never by the trailing segment or the label.
		const lookalike = {
			hero: { ...downedHeroView.hero, conditions: ["other/bundle/unconscious"] },
		};
		expect(heroDownedFromView(lookalike)).toBe(false);
	});

	it("does not depend on hit points", () => {
		expect(heroDownedFromView({ hero: { ...downedHeroView.hero, hp: 3 } })).toBe(true);
	});
});
