import {
	createWorldEventFanout,
	type WorldEvent,
	type WorldEventBuilder,
} from "@spellkave/tool-runtime";
import { describe, expect, it } from "vitest";
import { downedHeroView } from "../playground/fixtures";
import {
	appendPlayChronicle,
	chronicleCardFacts,
	chronicleFactsFromEvents,
	chronicleFactsFromView,
	chronicleStageFacts,
	foldSpeechBursts,
	ingestFanoutForChronicle,
	type PlayChronicleEntry,
	playChronicleEntry,
	unfoldSpeechLines,
} from "./play-chronicle";
import { isDmInternalCondition, type PlaySpeech, type PlayView } from "./play-view";

/** `playChronicleEntry` is `null` only for a dropped DM-internal condition
 * line (sk-jay0.1.7 item 4); every other fixture below always renders. */
function entryFor(event: WorldEvent, seq: number): PlayChronicleEntry {
	const entry = playChronicleEntry(event, seq);
	if (entry === null) throw new Error("expected a chronicle entry");
	return entry;
}

const speech: WorldEvent = {
	kind: "speech_heard",
	inscribed_at: 12,
	trace_id: "trace-1",
	trace_kind: "utterance",
	text: "What is your name, traveller?",
	inscribed_by: "9",
	inscribed_by_name: "Aldwin",
	location_kind: "place_node",
	location_ref: "common-room",
	observed_at_tick: 12,
};

const hit: WorldEvent = {
	kind: "self_hit",
	resource_id: "srd/hp",
	amount: 4,
	new_value: 7,
	attack_kind: "scimitar",
	attacker_id: "11",
	observed_at_tick: 13,
};

describe("playChronicleEntry", () => {
	it("renders heard speech as Aldwin's line, not a world tick", () => {
		expect(playChronicleEntry(speech, 0)).toEqual({
			id: "speech_heard:12:0",
			tick: 12,
			kind: "speech_heard",
			summary: 'Aldwin says: "What is your name, traveller?"',
		});
	});

	it("renders a hit taken as damage, not a scheduled tick", () => {
		// The attacker's id is known, its name is not: "something", never "11".
		expect(entryFor(hit, 1).summary).toBe("You take 4 damage from something — 7 HP left.");
	});

	it("names the attacker from the event's own attacker_name when no read discloses one", () => {
		const named: WorldEvent = { ...hit, attacker_name: "Cellar Rat" };
		const entry = entryFor(named, 1);
		expect(entry.summary).toBe("You take 4 damage from Cellar Rat — 7 HP left.");
		expect(entry.fields?.attacker).toEqual({ id: "11", name: "Cellar Rat" });
		// A name the refresh's own reads disclose wins over the event's.
		expect(
			playChronicleEntry(named, 1, {
				selfIds: new Set(["7"]),
				names: new Map([["11", "Cellar Rat 2"]]),
			})?.summary,
		).toBe("You take 4 damage from Cellar Rat 2 — 7 HP left.");
		// Never for the hero's own hit, and an id passed as a name is no name.
		expect(
			playChronicleEntry(named, 1, { selfIds: new Set(["11"]), names: new Map() })?.summary,
		).toBe("You take 4 damage — 7 HP left.");
		expect(entryFor({ ...hit, attacker_name: "11" }, 1).summary).toBe(
			"You take 4 damage from something — 7 HP left.",
		);
	});

	it("carries the event's structured fields, with the attacker resolved at ingest", () => {
		const entry = playChronicleEntry(hit, 1, {
			selfIds: new Set(["7"]),
			names: new Map([["11", "Cellar Rat"]]),
		});
		expect(entry).toEqual({
			id: "self_hit:13:1",
			tick: 13,
			kind: "self_hit",
			summary: "You take 4 damage from Cellar Rat — 7 HP left.",
			fields: {
				resourceId: "srd/hp",
				amount: 4,
				newValue: 7,
				attackKind: "scimitar",
				attacker: { id: "11", name: "Cellar Rat" },
			},
		});
	});

	it("omits the attacker clause when the world named no source", () => {
		expect(entryFor({ ...hit, attacker_id: null }, 1).summary).toBe(
			"You take 4 damage — 7 HP left.",
		);
	});

	it("maps a condition id to its player-facing label (sk-jay0.1.7 item 4)", () => {
		const dealt: WorldEvent = {
			kind: "dealt_condition",
			target_name: "Cellar Rat 1",
			condition_id: "srd/condition/dead",
			applied: true,
			source_entity_id: "7",
			observed_at_tick: 61,
		};
		expect(entryFor(dealt, 0).summary).toBe("Cellar Rat 1 is now affected by Dead.");
	});

	it("carries the authored trace_kind onto the entry for a trace_addressed event (sk-jay0.1.8.63.40)", () => {
		const missTrace: WorldEvent = {
			kind: "trace_addressed",
			trace_id: "50",
			trace_kind: "srd/attack-miss",
			payload: { label: "Ranged Attack misses", addressee: 5 },
			inscribed_by: "9",
			inscribed_by_name: "Crypt Warden",
			inscribed_at: 70,
			addressee: 5,
			addressee_name: null,
			addressed_at_self: true,
			label: "Ranged Attack misses",
			location_kind: "place_node",
			location_ref: "crypt",
			observed_at_tick: 70,
		};
		expect(entryFor(missTrace, 0)).toEqual({
			id: "trace_addressed:70:0",
			tick: 70,
			kind: "trace_addressed",
			summary: "Crypt Warden's Ranged Attack misses you.",
			traceKind: "srd/attack-miss",
		});
	});

	it("drops the DM-internal controlled condition from the player chronicle", () => {
		const controlled: WorldEvent = {
			kind: "dealt_condition",
			target_name: "Cellar Rat 1",
			condition_id: "core/condition/controlled",
			applied: true,
			source_entity_id: null,
			observed_at_tick: 62,
		};
		expect(playChronicleEntry(controlled, 0)).toBeNull();
	});

	it("drops the DM's creation and level-up workflow conditions (sk-jay0.1.8.96)", () => {
		for (const condition_id of [
			"dm/creation/pending/name",
			"dm/creation/drafting",
			"dm/level-up/drafting",
		]) {
			for (const applied of [true, false]) {
				const event: WorldEvent = {
					kind: "self_condition_changed",
					condition_id,
					applied,
					source_entity_id: "4",
					observed_at_tick: 3,
				};
				expect(playChronicleEntry(event, 0)).toBeNull();
			}
		}
	});

	it("still narrates a rules condition on the hero, by its label", () => {
		const prone: WorldEvent = {
			kind: "self_condition_changed",
			condition_id: "srd/condition/prone",
			applied: true,
			source_entity_id: null,
			observed_at_tick: 3,
		};
		expect(entryFor(prone, 0).summary).toBe("You are now affected by Prone.");
		expect(entryFor({ ...prone, applied: false }, 0).summary).toBe(
			"You are no longer affected by Prone.",
		);
	});

	it("tells going down as one plain sentence, and waking up by the label (sk-jay0.1.8.102)", () => {
		const unconscious: WorldEvent = {
			kind: "self_condition_changed",
			condition_id: "srd/condition/unconscious",
			applied: true,
			source_entity_id: null,
			observed_at_tick: 3,
		};
		expect(entryFor(unconscious, 0).summary).toBe("You fall unconscious.");
		expect(entryFor({ ...unconscious, applied: false }, 0).summary).toBe(
			"You are no longer affected by Unconscious.",
		);
	});
});

/**
 * sk-jay0.1.8.96, the regression of sk-jay0.1.8.63.41. The 2026-09-19 fix
 * rewrote the finished prose at render time and did nothing at all when the
 * session roster was empty — which it is during creation and after a
 * one-participant walk session has closed. Its test only ever passed a
 * non-empty roster. The sentence is now built from the event's structured
 * fields, so nothing here depends on a roster being present.
 */
describe("event sentences never show an entity id or a template id", () => {
	const HERO = "168";
	const context = { selfIds: new Set([HERO]), names: new Map<string, string>() };
	const noRoster = new Map<string, string>();
	const sentence = (event: WorldEvent, names: ReadonlyMap<string, string> = noRoster): string => {
		const entry = playChronicleEntry(event, 0, context);
		if (entry === null) throw new Error("expected a chronicle entry");
		// What the stream shows, and what a prose-only consumer reads.
		const [fact] = chronicleFactsFromEvents([entry], names);
		expect(fact?.summary).toBeDefined();
		if (names.size === 0) expect(entry.summary).toBe(fact?.summary);
		return fact?.summary ?? "";
	};

	it("reads the hero's own id as 'you' with an empty roster", () => {
		expect(
			sentence({
				kind: "turn_transition",
				session_id: "42",
				from_actor: null,
				to_actor: HERO,
				observed_at_tick: 8,
			}),
		).toBe("The turn opens with you.");
	});

	it("reads an unknown actor as 'someone' with an empty roster", () => {
		expect(
			sentence({
				kind: "turn_transition",
				session_id: "42",
				from_actor: HERO,
				to_actor: "21",
				observed_at_tick: 8,
			}),
		).toBe("The turn passes from you to someone.");
	});

	it("uses the current roster only for an actor that had no name at ingest", () => {
		const transition: WorldEvent = {
			kind: "turn_transition",
			session_id: "42",
			from_actor: "7",
			to_actor: "21",
			observed_at_tick: 8,
		};
		expect(
			sentence(
				transition,
				new Map([
					["7", "Renn"],
					["21", "Crypt Warden"],
				]),
			),
		).toBe("The turn passes from Renn to Crypt Warden.");
		// A name known when the event happened stays, whatever the roster says
		// later — and an empty roster later does not take it away.
		const named = playChronicleEntry(transition, 0, {
			selfIds: new Set(),
			names: new Map([
				["7", "Renn"],
				["21", "Crypt Warden"],
			]),
		});
		if (named === null) throw new Error("expected a chronicle entry");
		expect(chronicleFactsFromEvents([named], noRoster)[0]?.summary).toBe(
			"The turn passes from Renn to Crypt Warden.",
		);
		expect(chronicleFactsFromEvents([named], new Map([["21", "Stranger"]]))[0]?.summary).toBe(
			"The turn passes from Renn to Crypt Warden.",
		);
	});

	it("does not take a caller's id fallback for a name", () => {
		const entry = playChronicleEntry(
			{
				kind: "turn_transition",
				session_id: "42",
				from_actor: null,
				to_actor: "21",
				observed_at_tick: 8,
			},
			0,
			{ selfIds: new Set(), names: new Map([["21", "21"]]) },
		);
		expect(entry?.summary).toBe("The turn opens with someone.");
		expect(
			entry === null ? "" : chronicleFactsFromEvents([entry], new Map([["21", "21"]]))[0]?.summary,
		).toBe("The turn opens with someone.");
	});

	it("leaves the attack template id out of a damage line", () => {
		expect(
			sentence({
				kind: "self_hit",
				resource_id: "srd/hp",
				amount: 5,
				new_value: 0,
				attack_kind: "srd/attack/melee/success",
				attacker_id: "170",
				observed_at_tick: 9,
			}),
		).toBe("You take 5 damage from something — 0 HP left.");
	});

	it("humanises a spent resource and leaves a dotted DM template id out", () => {
		expect(
			sentence({
				kind: "self_resource_spent",
				resource_id: "srd/speed-walk",
				amount: 114,
				new_value: 0,
				source: "srd/dm/set/srd.speed-walk/success",
				observed_at_tick: 9,
			}),
		).toBe("You spend 114 Speed Walk — 0 left.");
	});

	it("humanises a reaction window's action and names its actor, or says 'someone'", () => {
		const window: WorldEvent = {
			kind: "reaction_window",
			window_kind: "reaction",
			phase: "opened",
			pending_id: "p1",
			originating_action_id: "srd/attack/opportunity-attack",
			originating_actor: "21",
			observed_at_tick: 9,
		};
		expect(sentence(window)).toBe("A reaction window opens — someone's Opportunity Attack.");
		expect(sentence({ ...window, originating_actor: HERO })).toBe(
			"A reaction window opens — your Opportunity Attack.",
		);
		expect(sentence({ ...window, phase: "closed" })).toBe("The reaction window closes.");
	});

	it("humanises an unlabelled trace's authored kind", () => {
		expect(
			sentence({
				kind: "trace_addressed",
				trace_id: "50",
				trace_kind: "kavemouth/adventure/trace/companion_command",
				payload: { addressee: 5 },
				inscribed_by: "9",
				inscribed_by_name: "Aldwin",
				inscribed_at: 70,
				addressee: 5,
				addressee_name: "Hesper",
				addressed_at_self: false,
				location_kind: "place_node",
				location_ref: "crypt",
				observed_at_tick: 70,
			}),
		).toBe("Aldwin signals Hesper (Companion Command).");
	});

	it("holds for every non-speech event kind, with an empty roster and unknown actors", () => {
		const events: WorldEvent[] = [
			{
				kind: "session_lifecycle",
				session_id: "9001",
				phase: "opened",
				// Two participants: a hero-only session is dropped whole
				// (sk-jay0.1.8.96 s4, covered below), and this test needs every
				// kind rendered.
				participants: [HERO, "170"],
				opened_by: HERO,
				observed_at_tick: 1,
			},
			{
				kind: "session_lifecycle",
				session_id: "9001",
				phase: "closed",
				participants: [],
				opened_by: HERO,
				observed_at_tick: 1,
			},
			{
				kind: "turn_transition",
				session_id: "9001",
				from_actor: null,
				to_actor: HERO,
				observed_at_tick: 1,
			},
			{
				kind: "turn_transition",
				session_id: "9001",
				from_actor: "170",
				to_actor: "171",
				observed_at_tick: 1,
			},
			{
				kind: "self_hit",
				resource_id: "srd/hp",
				amount: 5,
				new_value: 0,
				attack_kind: "srd/attack/melee/success",
				attacker_id: "170",
				observed_at_tick: 1,
			},
			{
				kind: "self_hit",
				resource_id: "srd/temp-hp",
				amount: 2,
				attack_kind: "srd/attack/ranged/success",
				attacker_id: null,
				observed_at_tick: 1,
			},
			{
				kind: "dealt_hit",
				target_name: "Cellar Rat 1",
				amount: 4,
				attacker_id: HERO,
				observed_at_tick: 1,
			},
			{
				kind: "self_condition_changed",
				condition_id: "srd/condition/unconscious",
				applied: true,
				source_entity_id: "170",
				observed_at_tick: 1,
			},
			{
				kind: "self_condition_changed",
				condition_id: "other/bundle/no-action",
				applied: false,
				source_entity_id: null,
				observed_at_tick: 1,
			},
			{
				kind: "dealt_condition",
				target_name: "Cellar Rat 1",
				condition_id: "srd/condition/dead",
				applied: true,
				source_entity_id: HERO,
				observed_at_tick: 1,
			},
			{ kind: "xp_gained", amount: 25, new_value: 25, observed_at_tick: 1 },
			{
				kind: "self_resource_spent",
				resource_id: "srd/speed-walk",
				amount: 114,
				new_value: 0,
				source: "srd/dm/set/srd.speed-walk/success",
				observed_at_tick: 1,
			},
			{
				kind: "reaction_window",
				window_kind: "intervention",
				phase: "opened",
				pending_id: "9002",
				originating_action_id: "srd/attack/melee",
				originating_actor: "170",
				observed_at_tick: 1,
			},
			{
				kind: "advancement_available",
				action_id: "srd/level-up",
				display_name: "Level Up",
				observed_at_tick: 1,
			},
			{
				kind: "trace_addressed",
				trace_id: "9003",
				trace_kind: "srd/attack-miss",
				payload: { addressee: 168 },
				inscribed_by: "170",
				inscribed_by_name: null,
				inscribed_at: 1,
				addressee: 168,
				addressee_name: null,
				addressed_at_self: true,
				location_kind: "place_node",
				location_ref: "inn/cellar",
				observed_at_tick: 1,
			},
		];
		// The ids this batch could leak: actors, the session, pending windows,
		// traces. Amounts (5, 2, 4, 25, 114, 0) and the tick are not ids.
		const ids = [HERO, "170", "171", "9001", "9002", "9003"];
		const ring = appendPlayChronicle([], events, 0, 40, context);
		expect(ring.entries).toHaveLength(events.length);
		const shown = [
			...ring.entries.map((entry) => entry.summary),
			...chronicleFactsFromEvents(ring.entries, noRoster).map((fact) => fact.summary),
		];
		for (const line of shown) {
			expect(line).not.toContain("srd/");
			expect(line).not.toMatch(/[a-z0-9_.-]+\/[a-z0-9_.-]+/i);
			for (const id of ids) expect(line).not.toMatch(new RegExp(`\\b${id}\\b`));
		}
	});
});

describe("the downed-hero fixture (sk-jay0.1.8.101)", () => {
	it("lists Unconscious on the hero and no DM workflow condition", () => {
		expect(downedHeroView.hero.conditions).toContain("srd/condition/unconscious");
		expect(downedHeroView.hero.conditions.some((id) => isDmInternalCondition(id))).toBe(false);
		expect(downedHeroView.hero.hp).toBe(0);
	});

	it("carries events in the ingested shape: the stored summary is the sentence its fields render", () => {
		const facts = chronicleFactsFromEvents(downedHeroView.events);
		expect(facts.map((fact) => fact.summary)).toEqual(
			downedHeroView.events.map((event) => event.summary),
		);
		expect(facts.map((fact) => fact.summary)).toContain(
			"You take 11 damage from Cellar Rat 1 — 0 HP left.",
		);
		for (const fact of facts) expect(fact.summary).not.toContain("srd/");
	});
});

describe("a hand-built entry without structured fields (fixture, older recording)", () => {
	const legacy = (kind: string, summary: string): PlayChronicleEntry => ({
		id: `legacy:${kind}`,
		tick: 1,
		kind,
		summary,
	});
	const shown = (entry: PlayChronicleEntry, names = new Map<string, string>()): string =>
		chronicleFactsFromEvents([entry], names)[0]?.summary ?? "";

	it("humanises template ids without a roster, a dotted DM template id included", () => {
		expect(
			shown(legacy("self_hit", "You take 5 srd/hp damage (srd/attack/melee/success) — now at 0.")),
		).toBe("You take 5 HP damage (Success) — now at 0.");
		expect(
			shown(
				legacy(
					"self_resource_spent",
					"You spend 114 srd/speed-walk (srd/dm/set/srd.speed-walk/success).",
				),
			),
		).toBe("You spend 114 Speed Walk (Success).");
	});

	it("never shows a bare actor id, and leaves prose that already names someone alone", () => {
		expect(shown(legacy("turn_transition", "The turn opens with 168."))).toBe(
			"The turn opens with someone.",
		);
		expect(
			shown(legacy("turn_transition", "The turn passes from 7 to 21."), new Map([["7", "Renn"]])),
		).toBe("The turn passes from Renn to someone.");
		expect(
			shown(
				legacy("turn_transition", "The turn passes from Renn to Cellar Rat 1."),
				new Map([["21", "Crypt Warden"]]),
			),
		).toBe("The turn passes from Renn to Cellar Rat 1.");
	});
});

describe("appendPlayChronicle", () => {
	it("keeps the previous ring when the drain is empty (priming / quiet tick)", () => {
		const existing = [entryFor(speech, 0)];
		expect(appendPlayChronicle(existing, [], 1)).toEqual({
			entries: existing,
			seq: 1,
			heroOnlySessions: new Set(),
		});
	});

	it("appends in occurrence order and drops the oldest past the rail limit", () => {
		const firstSix: WorldEvent[] = Array.from({ length: 6 }, (_, index) => ({
			kind: "xp_gained",
			amount: index + 1,
			observed_at_tick: index,
		}));
		const started = appendPlayChronicle([], firstSix, 0);
		expect(started.entries).toHaveLength(6);
		expect(started.entries[0]?.summary).toBe("You gain 1 experience.");

		const overflow = appendPlayChronicle(started.entries, [hit], started.seq, 6);
		expect(overflow.entries).toHaveLength(6);
		expect(overflow.entries[0]?.summary).toBe("You gain 2 experience.");
		expect(overflow.entries.at(-1)).toEqual(entryFor(hit, 6));
		expect(overflow.seq).toBe(7);
	});
});

describe("appendPlayChronicle — a hero-only session is not narrated (sk-jay0.1.8.96 s4)", () => {
	const HERO = "168";
	const context = { selfIds: new Set([HERO]), names: new Map([["170", "Cellar Rat"]]) };
	const lifecycle = (
		sessionId: string,
		phase: "opened" | "closed",
		participants: string[],
		tick: number,
	): WorldEvent => ({
		kind: "session_lifecycle",
		session_id: sessionId,
		phase,
		participants,
		opened_by: HERO,
		observed_at_tick: tick,
	});
	const turn = (sessionId: string, tick: number): WorldEvent => ({
		kind: "turn_transition",
		session_id: sessionId,
		from_actor: null,
		to_actor: HERO,
		observed_at_tick: tick,
	});

	it("drops open, turn and close of a walk across drains, remembering the id from 'opened'", () => {
		const opened = appendPlayChronicle(
			[],
			[lifecycle("77", "opened", [HERO], 10), turn("77", 10)],
			0,
			40,
			context,
		);
		expect(opened.entries).toEqual([]);
		expect(opened.heroOnlySessions).toEqual(new Set(["77"]));
		// 'closed' carries no participants: only the remembered id recognises it.
		const closed = appendPlayChronicle(
			opened.entries,
			[turn("77", 11), lifecycle("77", "closed", [], 12), hit],
			opened.seq,
			40,
			context,
			opened.heroOnlySessions,
		);
		expect(closed.entries.map((entry) => entry.kind)).toEqual(["self_hit"]);
		expect(closed.heroOnlySessions).toEqual(new Set());
		expect(closed.seq).toBe(5);
	});

	it("keeps every line of a session with another participant", () => {
		const ring = appendPlayChronicle(
			[],
			[
				lifecycle("78", "opened", [HERO, "170"], 10),
				turn("78", 10),
				lifecycle("78", "closed", [], 12),
			],
			0,
			40,
			context,
		);
		expect(ring.entries.map((entry) => entry.kind)).toEqual([
			"session_lifecycle",
			"turn_transition",
			"session_lifecycle",
		]);
		expect(ring.heroOnlySessions).toEqual(new Set());
	});

	it("shows a remembered session again from the first turn that names someone else", () => {
		const opened = appendPlayChronicle(
			[],
			[lifecycle("80", "opened", [HERO], 10), turn("80", 10)],
			0,
			40,
			context,
		);
		expect(opened.entries).toEqual([]);
		const pass = (from: string, to: string, tick: number): WorldEvent => ({
			kind: "turn_transition",
			session_id: "80",
			from_actor: from,
			to_actor: to,
			observed_at_tick: tick,
		});
		// A creature joined the running session: no second 'opened' row exists.
		const joined = appendPlayChronicle(
			opened.entries,
			[
				pass(HERO, "170", 11),
				pass("170", HERO, 12),
				turn("80", 13),
				lifecycle("80", "closed", [], 14),
			],
			opened.seq,
			40,
			context,
			opened.heroOnlySessions,
		);
		expect(joined.entries.map((entry) => entry.kind)).toEqual([
			"turn_transition",
			"turn_transition",
			"turn_transition",
			"session_lifecycle",
		]);
		expect(joined.heroOnlySessions).toEqual(new Set());
	});

	it("keeps a one-participant session whose participant is someone else", () => {
		const ring = appendPlayChronicle([], [lifecycle("79", "opened", ["170"], 10)], 0, 40, context);
		expect(ring.entries).toHaveLength(1);
	});
});

describe("appendPlayChronicle — going down folds into one line (sk-jay0.1.8.96 s7)", () => {
	const condition = (id: string, applied: boolean, tick = 59): WorldEvent => ({
		kind: "self_condition_changed",
		condition_id: id,
		applied,
		source_entity_id: "170",
		observed_at_tick: tick,
	});

	it("folds same-drain, same-tick applied rows; the first row in drain order leads", () => {
		const ring = appendPlayChronicle(
			[],
			[
				condition("srd/condition/unconscious", true),
				condition("srd/condition/incapacitated", true),
				condition("srd/condition/no-action", true),
				condition("srd/condition/no-reaction", true),
			],
			0,
		);
		expect(ring.entries).toHaveLength(1);
		expect(ring.entries[0]?.id).toBe("self_condition_changed:59:0");
		expect(ring.entries[0]?.fields?.conditionId).toBe("srd/condition/unconscious");
		expect(ring.entries[0]?.fields?.conditionIds).toEqual([
			"srd/condition/unconscious",
			"srd/condition/incapacitated",
			"srd/condition/no-action",
			"srd/condition/no-reaction",
		]);
		// The group holds the world's unconscious condition id: one plain
		// sentence, not the list of its implied rows (sk-jay0.1.8.102).
		expect(ring.entries[0]?.summary).toBe("You fall unconscious.");
		expect(chronicleFactsFromEvents(ring.entries)[0]?.summary).toBe(ring.entries[0]?.summary);
		expect(ring.seq).toBe(4);
	});

	it("reads 'You fall unconscious.' wherever the unconscious id sits in the folded group", () => {
		const ring = appendPlayChronicle(
			[],
			[
				condition("srd/condition/incapacitated", true),
				condition("srd/condition/no-action", true),
				condition("srd/condition/unconscious", true),
			],
			0,
		);
		expect(ring.entries).toHaveLength(1);
		expect(ring.entries[0]?.fields?.conditionId).toBe("srd/condition/incapacitated");
		expect(ring.entries[0]?.summary).toBe("You fall unconscious.");
	});

	it("keeps the list sentence for a folded group without the unconscious id, and for a removed group with it", () => {
		const applied = appendPlayChronicle(
			[],
			[
				condition("srd/condition/prone", true),
				condition("srd/condition/restrained", true),
				// A label that merely reads like it is not the id.
				condition("other/condition/unconscious", true),
			],
			0,
		);
		expect(applied.entries.map((entry) => entry.summary)).toEqual([
			"You are now affected by Prone, Restrained and Unconscious.",
		]);
		const removed = appendPlayChronicle(
			[],
			[
				condition("srd/condition/unconscious", false),
				condition("srd/condition/incapacitated", false),
			],
			0,
		);
		expect(removed.entries.map((entry) => entry.summary)).toEqual([
			"You are no longer affected by Unconscious and Incapacitated.",
		]);
	});

	it("folds only a run: a condition after a later hit of the same tick stays after that hit", () => {
		const hit = (amount: number, newValue: number): WorldEvent => ({
			kind: "self_hit",
			resource_id: "srd/hp",
			amount,
			new_value: newValue,
			attack_kind: "srd/attack/melee/success",
			attacker_id: null,
			observed_at_tick: 59,
		});
		// One tick, oldest first as the drain delivers it: a blow knocks the
		// hero prone, the next blow downs them.
		const ring = appendPlayChronicle(
			[],
			[
				hit(3, 5),
				condition("srd/condition/prone", true),
				hit(5, 0),
				condition("srd/condition/unconscious", true),
				condition("srd/condition/incapacitated", true),
				condition("srd/condition/no-action", true),
			],
			0,
		);
		expect(ring.entries.map((entry) => entry.kind)).toEqual([
			"self_hit",
			"self_condition_changed",
			"self_hit",
			"self_condition_changed",
		]);
		expect(ring.entries[1]?.summary).toBe("You are now affected by Prone.");
		expect(ring.entries[1]?.fields?.conditionIds).toBeUndefined();
		expect(ring.entries[3]?.summary).toBe("You fall unconscious.");
		expect(ring.entries[3]?.fields?.conditionIds).toEqual([
			"srd/condition/unconscious",
			"srd/condition/incapacitated",
			"srd/condition/no-action",
		]);
	});

	it("keeps removals, other ticks, other drains and dealt conditions apart", () => {
		const first = appendPlayChronicle(
			[],
			[
				condition("srd/condition/unconscious", true),
				condition("srd/condition/prone", false),
				condition("srd/condition/incapacitated", true, 60),
				{
					kind: "dealt_condition",
					target_name: "Cellar Rat 1",
					condition_id: "srd/condition/prone",
					applied: true,
					source_entity_id: "168",
					observed_at_tick: 59,
				},
			],
			0,
		);
		expect(first.entries.map((entry) => entry.summary)).toEqual([
			"You fall unconscious.",
			"You are no longer affected by Prone.",
			"You are now affected by Incapacitated.",
			"Cellar Rat 1 is now affected by Prone.",
		]);
		expect(first.entries[0]?.fields?.conditionIds).toBeUndefined();
		// A later drain on the same tick is its own line.
		const second = appendPlayChronicle(
			first.entries,
			[condition("srd/condition/no-action", true)],
			first.seq,
		);
		expect(second.entries.at(-1)?.summary).toBe("You are now affected by No Action.");
	});
});

describe("ingestFanoutForChronicle (live Ask Aldwin case)", () => {
	function scriptedBuilder(batches: WorldEvent[][]): WorldEventBuilder {
		const remaining = [...batches];
		return {
			diffAndAdvance: () => remaining.shift() ?? [],
			takeWhere: () => {
				throw new Error("fan-out must not call inner takeWhere");
			},
		};
	}

	it("speech_heard claimed by the reply window during a tool call still reaches the chronicle", () => {
		const fanout = createWorldEventFanout(scriptedBuilder([[speech]]));
		const replies = fanout.takeWhere((event) => event.kind === "speech_heard");
		expect(replies).toEqual([speech]);

		const observed = ingestFanoutForChronicle(fanout, true);
		const ring = appendPlayChronicle([], observed, 0);
		expect(ring.entries.map((entry) => entry.summary)).toEqual([
			'Aldwin says: "What is your name, traveller?"',
		]);
	});
});

describe("foldSpeechBursts (sk-jay0.1.8.13 task 1/2)", () => {
	function speechLine(
		id: string,
		tick: number,
		text: string,
		overrides: Partial<PlaySpeech> = {},
	): PlaySpeech {
		return {
			id,
			tick,
			speakerId: "4",
			speaker: "Aldwin",
			text,
			mine: false,
			...overrides,
		};
	}

	it("folds a single line to a quote, always important, chip speech", () => {
		const facts = foldSpeechBursts([speechLine("speech:1", 12, "Welcome, traveller.")]);
		expect(facts).toEqual([
			{
				id: "chronicle:burst:speech:1",
				tick: 12,
				kind: "speech",
				summary: 'Aldwin said: "Welcome, traveller."',
				important: true,
				chip: "speech",
				scrollToSpeechId: "speech:1",
			},
		]);
	});

	it("folds a multi-line burst from the SAME speaker to one fact — the shape brief's own 'said N things' wording", () => {
		const facts = foldSpeechBursts([
			speechLine("speech:20", 50, "Welcome back to the hearth-ledger, traveller."),
			speechLine("speech:21", 51, "You could also just adopt the recommended array."),
			speechLine("speech:22", 52, "Take your time; there is no wrong answer here."),
			speechLine("speech:23", 53, "So — which species calls to you?"),
		]);
		expect(facts).toHaveLength(1);
		expect(facts[0]).toMatchObject({
			id: "chronicle:burst:speech:20",
			tick: 53,
			summary: "Aldwin said 4 things · So — which species calls to you?",
			important: true,
			chip: "speech",
			scrollToSpeechId: "speech:20",
		});
	});

	it("starts a new burst on a speaker change", () => {
		const facts = foldSpeechBursts([
			speechLine("speech:30", 60, "The cellar has been loud since before dawn."),
			speechLine("speech:31", 61, "Rats, if I had to wager.", {
				speakerId: "9",
				speaker: "Brother Caddoc",
			}),
		]);
		expect(facts.map((fact) => fact.summary)).toEqual([
			'Aldwin said: "The cellar has been loud since before dawn."',
			'Brother Caddoc said: "Rats, if I had to wager."',
		]);
	});

	it("starts a new burst on a mine/not-mine hand-off even when the raw speakerId is unchanged", () => {
		// A contrived pair (never occurs live — `mine` is always derived from
		// `speakerId === selfActorId`) that exercises the SAME grouping rule
		// `threadFromView`'s own `startsBurst` uses (play-table.ts): both
		// `speakerId` AND `mine` must match to stay in one burst.
		const facts = foldSpeechBursts([
			speechLine("speech:40", 10, "First.", { speakerId: "7", mine: false }),
			speechLine("speech:41", 11, "Second.", { speakerId: "7", mine: true }),
		]);
		expect(facts).toHaveLength(2);
	});

	it("labels the player's own lines 'You', matching the thread's own convention", () => {
		const facts = foldSpeechBursts([
			speechLine("speech:50", 20, "1 Fighter", { speakerId: "7", speaker: "Renn", mine: true }),
		]);
		expect(facts[0]?.summary).toBe('You said: "1 Fighter"');
	});

	it("returns nothing for an empty stream", () => {
		expect(foldSpeechBursts([])).toEqual([]);
	});
});

describe("chronicleFactsFromEvents (sk-jay0.1.8.13 task 2)", () => {
	it("classifies each event through the per-kind importance/chip table", () => {
		const events: PlayChronicleEntry[] = [
			{ id: "event-1", tick: 58, kind: "session_lifecycle", summary: "A session opens." },
			{ id: "event-2", tick: 59, kind: "self_hit", summary: "You take 3 damage." },
			{ id: "event-3", tick: 60, kind: "xp_gained", summary: "You gain 1 experience." },
		];
		expect(chronicleFactsFromEvents(events)).toEqual([
			{
				id: "chronicle:event:event-1",
				tick: 58,
				kind: "session_lifecycle",
				summary: "A session opens.",
				important: true,
				chip: "comings",
			},
			{
				id: "chronicle:event:event-2",
				tick: 59,
				kind: "self_hit",
				summary: "You take 3 damage.",
				important: true,
				chip: "fight",
			},
			{
				id: "chronicle:event:event-3",
				tick: 60,
				kind: "xp_gained",
				summary: "You gain 1 experience.",
				important: false,
				chip: "things",
			},
		]);
	});

	it("falls back to Things/not-important for a kind outside the closed WorldEvent union", () => {
		const [fact] = chronicleFactsFromEvents([
			{ id: "event-9", tick: 1, kind: "passage_opened", summary: "The eastern road opened." },
		]);
		expect(fact).toMatchObject({ important: false, chip: "things" });
	});

	it("puts an attack-miss trace under Fight/important, overriding the generic trace_addressed row (sk-jay0.1.8.63.40)", () => {
		const [fact] = chronicleFactsFromEvents([
			{
				id: "event-10",
				tick: 70,
				kind: "trace_addressed",
				summary: "Crypt Warden's Ranged Attack misses you.",
				traceKind: "srd/attack-miss",
			},
		]);
		expect(fact).toMatchObject({ important: true, chip: "fight" });
	});

	it("leaves a non-attack-miss trace_addressed row (e.g. a companion command) at Speech/not-important", () => {
		const [fact] = chronicleFactsFromEvents([
			{
				id: "event-11",
				tick: 71,
				kind: "trace_addressed",
				summary: "Aldwin signals Hesper (kavemouth/adventure/trace/companion_command).",
				traceKind: "kavemouth/adventure/trace/companion_command",
			},
		]);
		expect(fact).toMatchObject({ important: false, chip: "speech" });
	});
});

describe("unfoldSpeechLines (sk-jay0.1.8.13 task 3, the ledger's 'stage ... speech unfolded')", () => {
	it("keeps one fact per RAW line — no folding, unlike foldSpeechBursts", () => {
		const lines: PlaySpeech[] = [
			{ id: "speech:1", tick: 50, speakerId: "4", speaker: "Aldwin", text: "First.", mine: false },
			{ id: "speech:2", tick: 51, speakerId: "4", speaker: "Aldwin", text: "Second.", mine: false },
		];
		const facts = unfoldSpeechLines(lines);
		expect(facts).toHaveLength(2);
		expect(facts.map((fact) => fact.summary)).toEqual([
			'Aldwin said: "First."',
			'Aldwin said: "Second."',
		]);
		expect(facts.map((fact) => fact.scrollToSpeechId)).toEqual(["speech:1", "speech:2"]);
	});

	it("reads the SAME 'said:' voice a single-line fold uses, for a lone line", () => {
		const [fact] = unfoldSpeechLines([
			{ id: "speech:1", tick: 1, speakerId: "7", speaker: "Renn", text: "Hello.", mine: true },
		]);
		expect(fact?.summary).toBe('You said: "Hello."');
	});
});

describe("chronicleFactsFromView / chronicleCardFacts / chronicleStageFacts (sk-jay0.1.8.13 tasks 1 and 3)", () => {
	function speechLine(id: string, tick: number, text: string): PlaySpeech {
		return { id, tick, speakerId: "4", speaker: "Aldwin", text, mine: false };
	}

	const view = {
		speech: [
			speechLine("speech:1", 53, "So — which species calls to you?"),
			speechLine("speech:2", 54, "Take your time."),
		],
		events: [
			{ id: "event-1", tick: 49, kind: "session_lifecycle", summary: "A session opens." },
			{ id: "event-2", tick: 50, kind: "xp_gained", summary: "You gain 1 experience." },
		],
	} as unknown as PlayView;

	it("reads the SAME view.speech the thread reads, merged with view.events, in world order", () => {
		// One burst (both lines share the same speaker) plus the two events.
		expect(chronicleFactsFromView(view).map((fact) => fact.tick)).toEqual([49, 50, 54]);
	});

	it("card: important facts only, newest first, capped, speech FOLDED to one burst", () => {
		const card = chronicleCardFacts(view, 1);
		// The session opening (important) and Aldwin's burst (always
		// important) both qualify; capped to 1 keeps only the newest.
		expect(card).toHaveLength(1);
		expect(card[0]?.kind).toBe("speech");
	});

	it("card without a cap keeps every important fact, xp_gained excluded, speech still one folded burst", () => {
		const card = chronicleCardFacts(view);
		expect(card.map((fact) => fact.kind)).toEqual(["speech", "session_lifecycle"]);
	});

	it("stage: everything, newest first, unfiltered, speech UNFOLDED to two lines", () => {
		const stage = chronicleStageFacts(view);
		expect(stage.map((fact) => fact.tick)).toEqual([54, 53, 50, 49]);
		expect(stage.filter((fact) => fact.kind === "speech")).toHaveLength(2);
	});

	it("stage: narrowed to one filter chip, still everything of that kind, still newest first", () => {
		const stage = chronicleStageFacts(view, "things");
		expect(stage.map((fact) => fact.kind)).toEqual(["xp_gained"]);
	});

	it("stage: an empty place log stays empty at every filter", () => {
		const empty = { speech: [], events: [] } as unknown as PlayView;
		expect(chronicleStageFacts(empty, "fight")).toEqual([]);
	});

	it("cross-type same-tick tie: a speech fact sorts before a non-speech event fact on the SAME tick, by concatenation convention (verifier addendum on sk-jay0.1.8.13)", () => {
		const tiedView = {
			speech: [speechLine("speech:70", 30, "Steady now.")],
			events: [{ id: "event-70", tick: 30, kind: "self_hit", summary: "You take 2 damage." }],
		} as unknown as PlayView;
		// Oldest → newest (chronicleFactsFromView): both facts share tick 30,
		// so the speech fact — concatenated first in `mergeChronicleFacts` —
		// leads, not the event.
		expect(chronicleFactsFromView(tiedView).map((fact) => fact.kind)).toEqual([
			"speech",
			"self_hit",
		]);
		// Newest-first stage reading reverses the WHOLE list, so the tie
		// flips too: the event now leads, the speech fact trails — a reader
		// of `chronicleStageFacts` alone must not assume speech always comes
		// first, only that the underlying world order (oldest → newest) does.
		expect(chronicleStageFacts(tiedView).map((fact) => fact.kind)).toEqual(["self_hit", "speech"]);
	});

	it("never reintroduces mergeSpeech's own fixed bug (sk-jay0.1.8.12 follow-up): a same-tick burst of six-plus lines stays in ARRIVAL order, not lexicographic id order", () => {
		// `mergeSpeech` (play-view.ts) already sorts these with a NUMERIC
		// trace-id tie-break, so `speech:10` legitimately sits AFTER
		// `speech:6`..`speech:9` here despite "1" < "6" lexically —
		// `mergeChronicleFacts`'s own merge must not re-sort by id and
		// silently undo that fix one layer up.
		const sameTickView = {
			speech: [
				{ id: "speech:6", tick: 20, speakerId: "4", speaker: "Aldwin", text: "6", mine: false },
				{ id: "speech:7", tick: 20, speakerId: "4", speaker: "Aldwin", text: "7", mine: false },
				{ id: "speech:8", tick: 20, speakerId: "4", speaker: "Aldwin", text: "8", mine: false },
				{ id: "speech:9", tick: 20, speakerId: "4", speaker: "Aldwin", text: "9", mine: false },
				{ id: "speech:10", tick: 20, speakerId: "4", speaker: "Aldwin", text: "10", mine: false },
			],
			events: [],
		} as unknown as PlayView;
		const stage = chronicleStageFacts(sameTickView);
		// Newest-first (reversed): the numerically-last line (speech:10)
		// leads, not speech:9 (its lexicographically-last neighbour).
		expect(stage.map((fact) => fact.scrollToSpeechId)).toEqual([
			"speech:10",
			"speech:9",
			"speech:8",
			"speech:7",
			"speech:6",
		]);
	});
});
