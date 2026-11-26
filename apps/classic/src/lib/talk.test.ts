import { describe, expect, it } from "vitest";
import type { PlayAction, PlayOccupant, PlayView } from "../../../play/src/lib/play-view";
import {
	canAddress,
	openQuestions,
	speechAction,
	spokenLines,
	talkPartners,
	withoutFreeSpeech,
} from "./talk";

// Shapes copied from a live local world (2026-11-14): the hero is entity 168,
// Aldwin is entity 6 and the hearth is entity 142.
function action(actionId: string, targetRef: string, extra: Partial<PlayAction> = {}): PlayAction {
	return {
		id: `factored:${actionId}:${targetRef}`,
		actionId,
		descriptor: actionId,
		label: `${actionId} — ${targetRef}`,
		name: actionId,
		verb: "manipulate",
		targetName: targetRef,
		targetRef,
		acceptsUtterance: false,
		...extra,
	};
}

const say = (actionId: string, targetRef: string, extra: Partial<PlayAction> = {}) =>
	action(actionId, targetRef, { verb: "communicate", ...extra });

const occupants = [
	{ id: "6", name: "Aldwin", kind: "person" },
	{ id: "137", name: "Cellar Rat", kind: "creature" },
	{ id: "142", name: "Hearth", kind: "thing" },
] as PlayOccupant[];

function view(overrides: Partial<PlayView> = {}): PlayView {
	return {
		hero: { actorId: "168", name: "Borin" },
		occupants,
		speech: [],
		actions: [
			say("srd/speak-aloud", "entity:6"),
			say("srd/speak-to-room", "entity:6"),
			say("srd/speak-to", "entity:6"),
			say("srd/speak-aloud", "entity:142"),
			say("srd/speak-aloud", "entity:168"),
			say("srd/speak-to-room", "place_node:inn/common_room"),
			say("dm/ask-about-advancement", "entity:6"),
			say("dm/dialog/choice/1", "entity:6", { slot: 1 }),
			say("dm/dialog/choice/1", "entity:142", { slot: 1 }),
			say("dm/dialog/choice/2", "entity:6", { slot: 2 }),
			action("srd/pickup", "entity:142"),
		],
		manipulationContext: {
			status: "ready",
			schemaVersion: 1,
			revision: 1,
			// `srd/speak-to-room` asks for someone who can be spoken with;
			// `srd/speak-aloud` admits any target.
			actions: [
				{
					actionId: "srd/speak-to-room",
					nicheRequirements: [
						{
							niche_id: "srd/niche/communicable",
							requires_spatial_attachment: false,
							admits_targets_without_membership: false,
						},
					],
				},
				{
					actionId: "srd/speak-aloud",
					nicheRequirements: [
						{
							niche_id: "capability:srd/action/communicate/speak",
							requires_spatial_attachment: false,
							admits_targets_without_membership: true,
						},
					],
				},
			],
			targets: [
				{ targetRef: "entity:6", nicheIds: ["srd/niche/communicable"] },
				{ targetRef: "entity:142", nicheIds: ["core/grounded"] },
				{ targetRef: "entity:168", nicheIds: ["srd/niche/communicable"] },
				{ targetRef: "place_node:inn/common_room", nicheIds: [] },
			],
			participants: [],
			prompts: [
				{
					occurrenceId: "9",
					promptDefId: "dm/prompt/advancement",
					contractVersion: 1,
					sourceRef: "entity:6",
					responseActionIds: ["dm/dialog/choice/1", "dm/dialog/choice/2", "dm/dialog/choice/3"],
					openedAtTick: 40,
					consumed: false,
					presentation: {
						question: "Train now?",
						labels: { "dm/dialog/choice/1": "Yes", "dm/dialog/choice/2": "Not yet" },
					},
				},
				{
					occurrenceId: "8",
					promptDefId: "dm/prompt/old",
					contractVersion: 1,
					sourceRef: "entity:6",
					responseActionIds: ["dm/dialog/choice/1"],
					openedAtTick: 30,
					consumed: true,
				},
			],
		},
		...overrides,
	} as unknown as PlayView;
}

describe("openQuestions", () => {
	it("shows an open prompt as one question from whoever asked", () => {
		const [question, ...rest] = openQuestions(view());
		expect(rest).toEqual([]);
		expect(question).toMatchObject({ occurrenceId: "9", asker: "Aldwin", question: "Train now?" });
		expect(question?.answers.map((answer) => answer.label)).toEqual([
			"Yes",
			"Not yet",
			"dm/dialog/choice/3",
		]);
	});

	it("binds each answer to the asker and to this occurrence", () => {
		const yes = openQuestions(view())[0]?.answers[0]?.action;
		expect(yes?.targetRef).toBe("entity:6");
		expect(yes?.semanticContext).toEqual({ source_ref: "entity:6", occurrence_id: "9" });
	});

	it("leaves an answer without a matching action unclickable", () => {
		expect(openQuestions(view())[0]?.answers[2]?.action).toBeUndefined();
	});

	it("offers no answer slot when nobody asks", () => {
		const quiet = view();
		(quiet.manipulationContext as { prompts: unknown[] }).prompts = [];
		expect(openQuestions(quiet)).toEqual([]);
		expect(openQuestions(view({ manipulationContext: { status: "unavailable" } }))).toEqual([]);
	});
});

describe("talkPartners", () => {
	it("lists persons and creatures, not things", () => {
		expect(talkPartners(occupants).map((partner) => partner.name)).toEqual([
			"Aldwin",
			"Cellar Rat",
		]);
	});
});

describe("speechAction", () => {
	it("speaks to one partner with the direct speech act", () => {
		expect(speechAction(view(), "6")?.id).toBe("factored:srd/speak-to:entity:6");
	});

	it("has no direct words for a target the world pairs no direct speech with", () => {
		expect(speechAction(view(), "142")).toBeUndefined();
		expect(canAddress(view(), "142")).toBe(false);
		expect(canAddress(view(), "6")).toBe(true);
	});

	it("speaks to the room through someone who can be spoken with", () => {
		// The place does not stand in the niche this speech act asks for.
		expect(speechAction(view(), null)?.id).toBe("factored:srd/speak-to-room:entity:6");
	});

	it("speaks aloud through the place when nobody here can be spoken with", () => {
		const actions = [
			say("srd/speak-to-room", "entity:142"),
			say("srd/speak-to-room", "place_node:inn/common_room"),
			say("srd/speak-aloud", "entity:142"),
			say("srd/speak-aloud", "place_node:inn/common_room"),
		];
		expect(speechAction(view({ actions }), null)?.id).toBe(
			"factored:srd/speak-aloud:place_node:inn/common_room",
		);
	});

	it("never aims the hero's words at the hero", () => {
		const actions = [say("srd/speak-to-room", "entity:168"), say("srd/speak-aloud", "entity:168")];
		expect(speechAction(view({ actions }), null)).toBeUndefined();
	});

	it("has nothing to offer when the world discloses no speech", () => {
		expect(speechAction(view({ actions: [] }), null)).toBeUndefined();
	});
});

describe("withoutFreeSpeech", () => {
	it("drops free speech and keeps fixed lines, answers and other actions", () => {
		const kept = withoutFreeSpeech(view().actions).map((entry) => entry.actionId);
		expect(kept).not.toContain("srd/speak-to");
		expect(kept).not.toContain("srd/speak-aloud");
		expect(kept).toContain("dm/ask-about-advancement");
		expect(kept).toContain("dm/dialog/choice/1");
		expect(kept).toContain("srd/pickup");
	});
});

describe("spokenLines", () => {
	const line = (
		id: string,
		tick: number,
		speakerId: string,
		speaker: string,
		text: string,
		extra = {},
	) => ({
		id: `speech:${id}`,
		tick,
		speakerId,
		speaker,
		text,
		mine: speakerId === "168",
		...extra,
	});

	it("keeps regular lines as they are, with the addressee", () => {
		const speech = [
			line("2", 12, "168", "Borin", "Good evening.", { addressee: 6, addresseeName: "Aldwin" }),
			line("1", 10, "6", "Aldwin", "Welcome."),
		];
		expect(spokenLines(view({ speech } as Partial<PlayView>))).toEqual([
			{ key: "speech:1", tick: 10, who: "Aldwin", text: "Welcome.", mine: false },
			{ key: "speech:2", tick: 12, who: "Borin to Aldwin", text: "Good evening.", mine: true },
		]);
	});

	it("names a far speaker the world sends as a bare id", () => {
		// Live row speech:105: the keeper calls from the inn, the hero is at the gate.
		const speech = [line("105", 575, "77", "77", "You have earned a level; come to me.")];
		const far = view({ speech } as Partial<PlayView>);
		expect(spokenLines(far)[0]?.who).toBe("Someone");
		expect(spokenLines(far, { "77": "The Keeper" })[0]?.who).toBe("The Keeper");
	});

	it("folds the extra row of speaking aloud into the regular one", () => {
		// Live rows speech:58 and speech:59.
		const speech = [
			line("58", 381, "entity:168", "entity:168", "Testing.", { mine: false, addressee: 6 }),
			line("59", 381, "168", "Borin", "Testing."),
		];
		expect(spokenLines(view({ speech } as Partial<PlayView>)).map((row) => row.key)).toEqual([
			"speech:59",
		]);
	});

	it("shows words to the room once, as the hero's own", () => {
		// Live rows speech:61 to speech:63: one per listener, no regular row.
		const extra = { mine: false, addressee: 12, addresseeName: "Brother Caddoc" };
		const speech = [
			line("61", 389, "entity:6", "Someone", "Is anyone hungry?", extra),
			line("62", 389, "entity:12", "Someone", "Is anyone hungry?", extra),
			line("63", 389, "entity:168", "Someone", "Is anyone hungry?", extra),
		];
		expect(spokenLines(view({ speech } as Partial<PlayView>))).toEqual([
			{ key: "speech:63", tick: 389, who: "Borin", text: "Is anyone hungry?", mine: true },
		]);
	});

	it("keeps two people who say the same words at the same time", () => {
		const speech = [line("1", 5, "6", "Aldwin", "Aye."), line("2", 5, "12", "Caddoc", "Aye.")];
		expect(spokenLines(view({ speech } as Partial<PlayView>))).toHaveLength(2);
	});
});
