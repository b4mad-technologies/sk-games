import { describe, expect, it } from "vitest";
import {
	findShellCandidates,
	freezeShellFinder,
	ghostShellCandidate,
	shellCompletionPrefixMatches,
} from "./shell-finder";

const candidates = [
	{
		id: "inspect",
		text: "/inspect",
		kind: "action" as const,
		canonical: "srd/inspect",
		label: "Inspect",
		source: "actions" as const,
	},
	{
		id: "chest",
		text: '@"Locked chest"',
		kind: "actor" as const,
		canonical: "entity:4",
		label: "Locked chest",
		source: "targets" as const,
	},
	{
		id: "old",
		text: "/old",
		kind: "action" as const,
		canonical: "history:old",
		label: "Old",
		source: "history" as const,
	},
];

describe("shell finder", () => {
	it("breaks equal-score ties in numeric id order", () => {
		const choice = (slot: string) => ({
			id: `action:dm/dialog/choice/${slot}`,
			text: "/choice",
			kind: "action" as const,
			canonical: `dm/dialog/choice/${slot}`,
			label: "Choice",
			source: "actions" as const,
		});
		const results = findShellCandidates(
			freezeShellFinder(1, [choice("10"), choice("2"), choice("1")]),
			"/choice",
		);
		expect(results.map((result) => result.candidate.canonical)).toEqual([
			"dm/dialog/choice/1",
			"dm/dialog/choice/2",
			"dm/dialog/choice/10",
		]);
	});

	it("freezes disclosed identities and leaves inert sources out", () => {
		const frozen = freezeShellFinder(7, candidates);
		const first = candidates[0];
		if (first === undefined) throw new Error("fixture needs an action");
		first.label = "mutated";
		expect(frozen.candidates.map((candidate) => candidate.canonical)).toEqual([
			"srd/inspect",
			"entity:4",
		]);
		expect(findShellCandidates(frozen, "inspect")[0]?.candidate.label).toBe("Inspect");
	});

	it("uses fzf ranking without eligibility inference and ghosts only strict literal prefixes", () => {
		const results = findShellCandidates(freezeShellFinder(7, candidates), "ins");
		expect(results[0]?.candidate.canonical).toBe("srd/inspect");
		expect(ghostShellCandidate("/ins", results)?.canonical).toBe("srd/inspect");
		expect(ghostShellCandidate("ins", results)).toBeUndefined();
	});

	it("uses cue rank only to break an equally relevant ordinary-action match", () => {
		const inspect = candidates[0];
		if (inspect === undefined) throw new Error("fixture needs inspect");
		const ranked = freezeShellFinder(7, [
			{ ...inspect, id: "ordinary-low", cueRank: 1 },
			{ ...inspect, id: "ordinary-high", cueRank: 9 },
			{
				...inspect,
				id: "prompt",
				source: "prompts" as const,
				semanticContext: { source_ref: "entity:4", occurrence_id: "o:1" },
			},
		]);
		expect(findShellCandidates(ranked, "inspect").map((result) => result.candidate.id)).toEqual([
			"prompt",
			"ordinary-high",
			"ordinary-low",
		]);
	});

	it("accepts a mention-shaped prefix while preserving the quoted reference token", () => {
		const chest = candidates[1];
		if (chest === undefined) throw new Error("fixture needs target");
		expect(shellCompletionPrefixMatches("@Loc", chest.text)).toBe(true);
		expect(
			ghostShellCandidate("@Loc", findShellCandidates(freezeShellFinder(7, candidates), "@Loc"))
				?.canonical,
		).toBe("entity:4");
		expect(shellCompletionPrefixMatches("Loc", chest.text)).toBe(false);
	});
});

// K2: ranking must happen before truncation, regardless of fzf score.
it("keeps a literal prefix ahead of fuzzy results even at limit one", () => {
	const base = candidates[0];
	if (base === undefined) throw new Error("fixture needs a candidate");
	const frozen = freezeShellFinder(1, [
		...Array.from({ length: 20 }, (_, i) => ({
			...base,
			id: `fuzzy-${i}`,
			text: "/something-in",
			label: "/in",
			canonical: "/in",
		})),
		{
			...base,
			id: "prefix",
			text: "/inspect",
			label: "A long visible action label",
			canonical: "a/long/id",
		},
	]);
	expect(findShellCandidates(frozen, "/in", 1)[0]?.candidate.id).toBe("prefix");
});
// K2: response array order is authored, not lexical action identity.
it("preserves prompt response order for an empty query", () => {
	const base = candidates[0];
	if (base === undefined) throw new Error("fixture needs a candidate");
	const frozen = freezeShellFinder(
		1,
		["z", "a", "m"].map((id) => ({ ...base, id, source: "prompts" as const })),
	);
	expect(findShellCandidates(frozen, "").map((row) => row.candidate.id)).toEqual(["z", "a", "m"]);
});

it("keeps a detail field of the chosen action and lists it first for an empty query", () => {
	const field = {
		id: "field:name",
		text: 'name:""',
		kind: "field" as const,
		canonical: "name",
		label: "Name",
		source: "fields" as const,
	};
	const frozen = freezeShellFinder(1, [field, ...candidates]);
	expect(frozen.candidates[0]).toEqual(field);
	expect(findShellCandidates(frozen, "")[0]?.candidate.id).toBe("field:name");
	// A typed start of the field leads through the literal-prefix tier.
	expect(findShellCandidates(frozen, "na")[0]?.candidate.id).toBe("field:name");
});

// Owner decision 2026-11-12 (sk-jay0.1.8.95): rows are ordered by where they
// come from. Nothing is hidden.
describe("source tier order", () => {
	const row = (
		id: string,
		source: "actions" | "targets" | "prompts" | "sensing" | "movement" | "turn" | "fields",
		text = `/${id}`,
	) => ({
		id,
		text,
		kind: "action" as const,
		canonical: id,
		label: id,
		source,
	});
	// Caller order and id order both put the ordinary actions first.
	const mixed = [
		row("action:a-truce", "actions", "/truce"),
		row("action:b-tomb", "actions", "/tomb"),
		row("sense:look", "sensing", "/look"),
		row("move:exit-1", "movement", "/go-stairs"),
		row("turn:end", "turn", "/end-turn"),
		row("target:1", "targets", '@"Aldwin"'),
		row("prompt:o1:z", "prompts", "/yes"),
		row("prompt:o1:a", "prompts", "/no"),
	];

	it("lists answers, what is here, ways out, then the rest for an empty query", () => {
		const ids = findShellCandidates(freezeShellFinder(1, mixed), "").map((r) => r.candidate.id);
		expect(ids).toEqual([
			"prompt:o1:z",
			"prompt:o1:a",
			"target:1",
			"move:exit-1",
			"action:a-truce",
			"action:b-tomb",
			"sense:look",
			"turn:end",
		]);
	});

	// Same text, so a query scores all rows the same: only the tier decides.
	const tied = [
		row("action:a", "actions", "/same"),
		row("target:1", "targets", "/same"),
		row("field:name", "fields", "/same"),
		row("prompt:o1:a", "prompts", "/same"),
	];

	it("lists a detail field of the form being filled in first for an empty query", () => {
		// Not one of the owner's tiers: form filling listed its fields first
		// before the tiers existed, and the next-detail ghost reads the first row.
		const ids = findShellCandidates(freezeShellFinder(1, tied), "").map((r) => r.candidate.id);
		expect(ids).toEqual(["field:name", "prompt:o1:a", "target:1", "action:a"]);
	});

	it("keeps a prompt answer ahead of an equally matching field for a typed query", () => {
		// Before the tiers a prompt answer beat every source on an equal score.
		// The first row is the ghost and Tab target, so that order stays.
		const ids = findShellCandidates(freezeShellFinder(1, tied), "/same").map((r) => r.candidate.id);
		expect(ids).toEqual(["prompt:o1:a", "field:name", "target:1", "action:a"]);
	});

	it("shows answers and ways out before ordinary actions for a bare slash", () => {
		const results = findShellCandidates(freezeShellFinder(1, mixed), "/");
		const ids = results.map((r) => r.candidate.id);
		// Every row with a slash is still listed.
		expect([...ids].sort()).toEqual(
			mixed
				.filter((candidate) => candidate.source !== "targets")
				.map((candidate) => candidate.id)
				.sort(),
		);
		expect(ids).toEqual([
			"prompt:o1:a",
			"prompt:o1:z",
			"move:exit-1",
			"action:a-truce",
			"action:b-tomb",
			"sense:look",
			"turn:end",
		]);
	});

	it("keeps a way-out row inside the limit when many actions match", () => {
		const many = [
			...Array.from({ length: 20 }, (_, i) => row(`action:quest-${i}`, "actions")),
			row("move:exit-1", "movement", "/go-stairs"),
		];
		const ids = findShellCandidates(freezeShellFinder(1, many), "/").map((r) => r.candidate.id);
		expect(ids).toHaveLength(12);
		expect(ids[0]).toBe("move:exit-1");
	});

	it("keeps a literal prefix ahead of a higher tier", () => {
		const ids = findShellCandidates(
			freezeShellFinder(1, [
				row("move:exit-1", "movement", "/go-tomb"),
				row("action:tomb", "actions", "/tomb"),
			]),
			"/to",
		).map((r) => r.candidate.id);
		expect(ids).toEqual(["action:tomb", "move:exit-1"]);
	});
});

describe("capped answer spellings stay findable (sk-jay0.1.8.94)", () => {
	const answer = (slot: number, label: string, searchText: string) => ({
		id: `prompt:talk-1:dm/dialog/choice/${slot}`,
		text: `/tell-him-about-the-${slot}`,
		searchText,
		kind: "action" as const,
		canonical: `dm/dialog/choice/${slot}`,
		label,
		source: "prompts" as const,
	});
	const snapshot = freezeShellFinder(1, [
		answer(1, "Tell him about the dragon in the north", "/tell-him-about-the-dragon-in-the-north"),
		answer(2, "Tell him about the dragon in the south", "/tell-him-about-the-dragon-in-the-south"),
	]);

	it("finds a capped answer by its full spelling, and tells two apart past the cut", () => {
		expect(
			findShellCandidates(snapshot, "/tell-him-about-the-dragon-in-the-north").map(
				(result) => result.candidate.canonical,
			),
		).toEqual(["dm/dialog/choice/1"]);
		expect(
			findShellCandidates(snapshot, "/tell-him-about-the-dragon-in-the-s")[0]?.candidate.canonical,
		).toBe("dm/dialog/choice/2");
	});

	it("never ghosts the hidden spelling: only the shown text completes", () => {
		const results = findShellCandidates(snapshot, "/tell-him-about-the-dragon");
		expect(results).toHaveLength(2);
		expect(ghostShellCandidate("/tell-him-about-the-dragon", results)).toBeUndefined();
	});
});
