import { describe, expect, it } from "vitest";
import {
	answeredSoFar,
	answerList,
	saidBefore,
	saidSince,
	withoutAnswerList,
	withoutPickCount,
} from "./words";

describe("withoutAnswerList", () => {
	it("cuts the numbered answers a guided question carries", () => {
		expect(withoutAnswerList("Which class? 1 Fighter, 2 Rogue, 3 Cleric, 4 Wizard.")).toBe(
			"Which class?",
		);
		expect(
			withoutAnswerList(
				"Which skill (2 more)? 1 History, 2 Insight, 3 Medicine. (2 picks remaining.)",
			),
		).toBe("Which skill (2 more)?");
	});

	it("cuts the answers after a spoken offer", () => {
		expect(
			withoutAnswerList(
				"Clear them and the inn keeps a room for you. 1: The cellar is overrun — I'll clear it. 2: Not today.",
			),
		).toBe("Clear them and the inn keeps a room for you.");
	});

	it("cuts a single answer of a guided question", () => {
		expect(withoutAnswerList('Which name? 1 Adopt the name "Maren".')).toBe("Which name?");
		expect(withoutAnswerList("Which ability scores? 1 Adopt the recommended array.")).toBe(
			"Which ability scores?",
		);
	});

	it("leaves a sentence with numbers in it alone", () => {
		for (const text of [
			"I counted 1 rat and 2 swarms.",
			"The barrels can wait a day — not two.",
			"Adopted: STR 14, DEX 8, CON 13.",
			"Room 1 is taken. Take room 3.",
		])
			expect(withoutAnswerList(text)).toBe(text);
	});
});

describe("withoutPickCount", () => {
	it("takes the count out of a question that asks for several picks", () => {
		expect(withoutPickCount("Which skill (2 more)?")).toBe("Which skill?");
		expect(withoutPickCount("Which weapon mastery (3 more)?")).toBe("Which weapon mastery?");
	});

	it("leaves every other bracket alone", () => {
		for (const text of ["Which skill?", "The rats (2 more) wait.", "Why (no coin)?"])
			expect(withoutPickCount(text)).toBe(text);
	});
});

describe("answerList", () => {
	it("reads the numbered answers somebody names after what they say", () => {
		expect(
			answerList(
				"A rogue of my trust, trained as you are. 1: Take the companion. 2: Walk alone a while longer.",
			),
		).toEqual({
			question: "A rogue of my trust, trained as you are.",
			answers: ["Take the companion.", "Walk alone a while longer."],
		});
		expect(answerList("Which class? 1 Fighter, 2 Rogue, 3 Wizard.")?.answers).toEqual([
			"Fighter",
			"Rogue",
			"Wizard.",
		]);
	});

	it("is nothing for a sentence that names no answers", () => {
		expect(answerList("I counted 1 rat and 2 swarms.")).toBeNull();
		expect(answerList("Good. The hatch is off the stairs.")).toBeNull();
	});
});

describe("answeredSoFar", () => {
	const outline = [
		{ label: "Class", value: "Fighter", current: false },
		{ label: "Equipment", current: false },
		{ label: "Name", value: "Pip", current: false },
		{ label: "Confirmation", current: true },
	];

	it("lists every answer at the last step of a guided talk", () => {
		expect(answeredSoFar(outline)).toEqual([
			{ label: "Class", value: "Fighter" },
			{ label: "Name", value: "Pip" },
		]);
	});

	it("is empty before the last step and without an outline", () => {
		expect(
			answeredSoFar(outline.map((step, index) => ({ ...step, current: index === 2 }))),
		).toEqual([]);
		expect(answeredSoFar(undefined)).toEqual([]);
	});
});

describe("saidSince", () => {
	const keeper = { kind: "speech", thingId: "keeper" };

	it("keeps every reply since the hero last spoke", () => {
		const lines = [
			{ ...keeper, text: "Clear the cellar. 1: I will. 2: Not today." },
			{ kind: "mine", text: "I will." },
			{ ...keeper, text: "Nothing to record yet, friend." },
			{ kind: "speech", thingId: "monk", text: "Peace." },
			{ kind: "story", text: "A door bangs." },
			{ ...keeper, text: "Good. The hatch is off the stairs." },
		];
		expect(saidSince(lines, "keeper")).toEqual([
			"Nothing to record yet, friend.",
			"Good. The hatch is off the stairs.",
		]);
	});

	it("starts anew at an answer given by a click, which the story tells as a result", () => {
		const lines = [
			{ kind: "mine", text: "Good morning." },
			{ ...keeper, text: "What can I get you? 1: A drink. 2: Nothing." },
			{ kind: "result", text: "A drink." },
			{ ...keeper, text: "Drink's on the board." },
		];
		expect(saidSince(lines, "keeper")).toEqual(["Drink's on the board."]);
	});

	it("is the question before the hero has answered, and never the past", () => {
		const lines = [
			{ kind: "result", text: "You arrive: Common Room." },
			{ ...keeper, text: "Clear the cellar. 1: I will. 2: Not today." },
		];
		expect(saidSince(lines, "keeper")).toEqual(["Clear the cellar."]);
		expect(
			saidSince(
				lines.map((line) => ({ ...line, old: true })),
				"keeper",
			),
		).toEqual([]);
		expect(saidSince([...lines, { kind: "mine", text: "I will." }], "keeper")).toEqual([]);
	});
});

describe("saidBefore", () => {
	it("is the reply that the next question would hide", () => {
		const said = ["End Sister Maelis.", "Raid smoke on the road."];
		expect(saidBefore(said, "Raid smoke on the road.")).toEqual(["End Sister Maelis."]);
	});

	it("is nothing when only the question was said, or none is open", () => {
		expect(saidBefore(["Raid smoke on the road."], "Raid smoke on the road.")).toEqual([]);
		expect(saidBefore(["Good."], undefined)).toEqual([]);
	});
});

describe("pointsSpent", () => {
	it("adds up the SRD's point costs and counts nothing for a score off the table", async () => {
		const { pointsSpent } = await import("./words");
		expect(pointsSpent([15, 15, 15, 8, 8, 8])).toBe(27);
		expect(pointsSpent([8, 8, 8, 8, 8, 8])).toBe(0);
		expect(pointsSpent([16, 8])).toBeUndefined();
	});
});
