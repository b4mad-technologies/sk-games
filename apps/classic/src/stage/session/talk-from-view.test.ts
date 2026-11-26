import { describe, expect, it } from "vitest";
import type { PlayView } from "../../../../play/src/lib/play-view";
import room from "./fixtures/common-room.view.json";
import classQuestion from "./fixtures/creation-class.view.json";
import nameOpen from "./fixtures/creation-name.view.json";
import reopened from "./fixtures/creation-reopened.view.json";
import {
	answerFor,
	answerRefs,
	nameForm,
	numberForm,
	openGuide,
	questionsOf,
	roundFrom,
	type TalkMemory,
} from "./talk-from-view";

// Recorded from a local world on 2026-11-15 (`just play-host`, host with the
// guided-dialogue machine side). The creation views keep only the DM's
// actions; the talk mapping reads nothing else.
const inRoom = room as unknown as PlayView;
const atClass = classQuestion as unknown as PlayView;
const atReopened = reopened as unknown as PlayView;
const atName = nameOpen as unknown as PlayView;

function memory(overrides: Partial<TalkMemory> = {}): TalkMemory {
	return {
		partnerId: null,
		guide: undefined,
		waiting: false,
		art: () => undefined,
		href: () => undefined,
		about: () => undefined,
		...overrides,
	};
}

describe("a guided talk (hero creation)", () => {
	it("opens by itself with the DM's question, its answers and the outline", () => {
		const round = roundFrom(atClass, memory());
		expect(round).toMatchObject({
			speakerId: "6",
			question: "Which class?",
			freeSpeech: false,
			canBack: false,
			canForward: false,
		});
		expect(round?.answers.map((answer) => [answer.label, answer.ref])).toEqual([
			["Fighter", "srd/class/fighter"],
			["Rogue", "srd/class/rogue"],
			["Cleric", "srd/class/cleric"],
			["Wizard", "srd/class/wizard"],
		]);
		expect(round?.outline?.[0]).toEqual({ id: "0", label: "Class", current: true });
		expect(round?.outline?.map((step) => step.label)).toContain("Confirmation");
		expect(round?.input).toBeUndefined();
		expect(round?.picksLeft).toBeUndefined();
	});

	it("gives an answer its picture and reference page from the definition id", () => {
		expect(answerRefs(atClass)).toContain("srd/class/wizard");
		const round = roundFrom(
			atClass,
			memory({
				art: (key) => `sprite:${key}`,
				href: (ref) =>
					ref === "srd/class/fighter" ? "https://docs.example/docs/fighter" : undefined,
			}),
		);
		expect(round?.answers[0]).toMatchObject({
			art: { url: "sprite:srd/class/fighter", pixel: true },
			href: "https://docs.example/docs/fighter",
		});
		expect(round?.answers[1]?.href).toBeUndefined();
	});

	it("gives an outline step its first answer, how many more there are, and a picture", () => {
		const round = roundFrom(atReopened, memory({ art: (key) => `sprite:${key}` }));
		const step = round?.outline?.find((entry) => entry.label === "Class");
		expect(step).toMatchObject({ value: "Fighter", short: "Fighter" });
		expect(step?.more).toBeUndefined();
		expect(step?.art?.url).toMatch(/^sprite:srd\/class\//);
	});

	it("offers to start over once something was answered, and not before", () => {
		expect(roundFrom(atReopened, memory())?.canRestart).toBe(true);
		expect(roundFrom(atClass, memory())?.canRestart).toBe(false);
	});

	it("finds the number form of the open step by the step's title, and no other", () => {
		const step = (title: string) =>
			({ outline: [{ title, state: "open", answers: [] }] }) as unknown as Parameters<
				typeof numberForm
			>[1];
		const form = numberForm(atName, step("Ability scores"));
		expect(form?.fields.map((field) => field.name)).toEqual([
			"str",
			"dex",
			"con",
			"int",
			"wis",
			"cha",
		]);
		expect(numberForm(atName, step("Skill"))).toBeUndefined();
		expect(numberForm(atName, undefined)).toBeUndefined();
	});

	it("says what an answer is in the guide's words where the DM sends none", () => {
		const round = roundFrom(
			atClass,
			memory({
				about: (ref) => (ref === "srd/class/fighter" ? "Fighters meet danger head-on." : undefined),
			}),
		);
		expect(round?.answers[0]?.blurb).toBe("Fighters meet danger head-on.");
		expect(round?.answers[1]?.blurb).toBeUndefined();
	});

	it("shows the DM's draft as the outline and lets a reopened question step both ways", () => {
		const round = roundFrom(atReopened, memory());
		expect(
			round?.outline?.filter((step) => step.value).map((step) => [step.label, step.value]),
		).toEqual([
			["Class", "Fighter"],
			["Background", "Soldier"],
			["Species", "Dwarf"],
			["Skill", "Athletics, Perception"],
			["fighting style", "Defense"],
			["weapon mastery", "Greatsword, Battleaxe, Javelin"],
		]);
		expect(round?.outline?.filter((step) => step.current).map((step) => step.label)).toEqual([
			"fighting style",
		]);
		expect(round).toMatchObject({ canBack: true, canForward: true });
		expect(openGuide(atReopened)?.reopened).toBe(true);
	});

	it("binds every answer to the question's own occurrence", () => {
		const round = roundFrom(atClass, memory());
		const answer = answerFor(atClass, round?.id ?? "", round?.answers[0]?.id ?? "");
		expect(answer).toMatchObject({ label: "Fighter", askerId: "6" });
		expect(answer?.action?.targetRef).toBe("entity:6");
		expect(answer?.action?.semanticContext).toEqual({
			source_ref: "entity:6",
			occurrence_id: round?.id,
		});
		expect(answerFor(atClass, "gone", "dm/dialog/choice/1")).toBeUndefined();
	});

	it("asks for the name in words when no question is open", () => {
		expect(openGuide(atName)).toBeUndefined();
		expect(nameForm(atName)?.fields.map((field) => field.name)).toEqual(["name"]);
		const guide = openGuide(atReopened);
		// Nothing was asked for a good while: the field is not held back.
		const round = roundFrom(atName, memory({ guide, patient: true }));
		expect(round).toMatchObject({
			speakerId: "6",
			answers: [],
			input: { label: "Name", maxLength: 60 },
			canBack: false,
			canForward: false,
		});
		expect(round?.question).toBeUndefined();
		// Between two questions the last outline the DM sent stays up.
		expect(round?.outline?.[0]).toMatchObject({ label: "Class", value: "Fighter" });
	});

	it("holds the name field back until its own step is next, and moves the outline on", () => {
		const outline = (open: string) =>
			({
				outline: ["Class", "Ability scores", "Name", "Confirmation"].map((title) => ({
					title,
					state: title === open ? "open" : "pending",
					answers: [],
				})),
			}) as unknown as NonNullable<ReturnType<typeof openGuide>>;
		// Right after the class is answered the DM is about to ask the next question.
		const early = roundFrom(atName, memory({ guide: outline("Class"), answered: "Fighter" }));
		expect(early?.input).toBeUndefined();
		expect(early?.outline?.map((step) => [step.label, step.value, step.current])).toEqual([
			["Class", "Fighter", false],
			["Ability scores", undefined, true],
			["Name", undefined, false],
			["Confirmation", undefined, false],
		]);
		// After the step before the name is answered, the name is what is due.
		const due = roundFrom(
			atName,
			memory({ guide: outline("Ability scores"), answered: "Adopt the recommended array" }),
		);
		expect(due?.input).toMatchObject({ label: "Name" });
		expect(due?.outline?.find((step) => step.current)?.label).toBe("Name");
		// An outline without a step of the field's name holds nothing back.
		const bare = {
			outline: [{ title: "Class", state: "open", answers: [] }],
		} as unknown as NonNullable<ReturnType<typeof openGuide>>;
		expect(roundFrom(atName, memory({ guide: bare }))?.input).toMatchObject({ label: "Name" });
	});

	it("holds the name field back while the DM is still thinking", () => {
		const round = roundFrom(atName, memory({ waiting: true }));
		expect(round).not.toBeNull();
		expect(round?.input).toBeUndefined();
	});

	it("still shows the question when no guide was ever sent", () => {
		const prompts =
			atClass.manipulationContext.status === "ready"
				? (atClass.manipulationContext.prompts ?? [])
				: [];
		const bare: PlayView = {
			...atClass,
			manipulationContext: {
				...atClass.manipulationContext,
				prompts: prompts.map((prompt) => ({
					...prompt,
					presentation: prompt.presentation && { ...prompt.presentation, guide: undefined },
				})),
			} as PlayView["manipulationContext"],
		};
		const round = roundFrom(bare, memory());
		expect(round?.answers).toHaveLength(4);
		expect(round?.outline).toEqual([]);
	});
});

describe("a talk in the world", () => {
	it("is nothing until the hero turns to somebody", () => {
		expect(roundFrom(inRoom, memory())).toBeNull();
		expect(roundFrom(inRoom, memory({ partnerId: "nobody-here" }))).toBeNull();
	});

	it("shows the open question of whoever the hero turned to, with free speech beside it", () => {
		const round = roundFrom(inRoom, memory({ partnerId: "6" }));
		expect(round).toMatchObject({ speakerId: "6", freeSpeech: true });
		expect(round?.question).toContain("The cellar is overrun with rats");
		expect(round?.answers.map((answer) => answer.label)).toEqual([
			"The cellar is overrun — I'll clear it.",
			"Not today.",
		]);
		expect(round?.outline).toBeUndefined();
	});

	it("is free speech only with somebody who asks nothing", () => {
		const round = roundFrom(inRoom, memory({ partnerId: "12" }));
		expect(round).toMatchObject({
			id: "free:12",
			speakerName: "Brother Caddoc",
			answers: [],
			freeSpeech: true,
		});
		expect(round?.question).toBeUndefined();
	});
});

describe("a question asked in words only", () => {
	const context = inRoom.manipulationContext;
	if (context.status !== "ready") throw new Error("the recording has no context");
	const bare = { ...inRoom, manipulationContext: { ...context, prompts: [] } } as PlayView;
	const asked = inRoom.speech.at(-1);
	if (!asked) throw new Error("the recording has no speech");

	it("is a round with the named answers, bound to the speaker's numbered answer acts", () => {
		const round = roundFrom(bare, memory({ partnerId: "6" }));
		expect(round).toMatchObject({ id: `said:${asked.id}`, speakerId: "6", freeSpeech: true });
		expect(round?.question).toMatch(/keeps a room for you\.$/);
		expect(round?.answers.map((answer) => answer.label)).toEqual([
			"The cellar is overrun — I'll clear it.",
			"Not today.",
		]);
		const first = answerFor(bare, round?.id ?? "", round?.answers[0]?.id ?? "");
		expect(first?.action).toMatchObject({ slot: 1, targetRef: "entity:6" });
	});

	it("gives way to an open prompt of the same speaker", () => {
		expect(questionsOf(inRoom).map((question) => question.occurrenceId)).not.toContain(
			`said:${asked.id}`,
		);
		expect(questionsOf(inRoom)).toHaveLength(1);
	});

	it("is over once the hero has said something after it", () => {
		const answered = {
			...bare,
			speech: [...bare.speech, { ...asked, id: "speech:mine", mine: true, text: "" }],
		} as PlayView;
		expect(questionsOf(answered)).toEqual([]);
	});
});
