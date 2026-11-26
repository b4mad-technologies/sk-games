import { describe, expect, it } from "vitest";
import type { HotbarGroup } from "./dock-hotbar";
import {
	assignSlotKeys,
	composerSlot,
	type HotbarInput,
	type HotbarMemory,
	hotbarFromView,
	hotbarRows,
	rememberHotbar,
} from "./dock-hotbar";
import type { PlayAction } from "./play-view";
import type { SelectionRow } from "./selection";

function action(
	partial: Partial<PlayAction> & Pick<PlayAction, "id" | "label" | "descriptor">,
): PlayAction {
	return { verb: "manipulate", targetName: "", targetRef: "", acceptsUtterance: false, ...partial };
}

const dodge = action({
	id: "h:dodge",
	label: "Dodge",
	descriptor: "srd/action/dodge",
	targetRef: "entity:1",
	targetName: "You",
	provider: "actor",
});
const aloud = action({
	id: "h:aloud",
	label: "Speak Aloud",
	descriptor: "srd/speak-aloud",
	verb: "communicate",
	targetRef: "entity:1",
	targetName: "You",
	provider: "actor",
	acceptsUtterance: true,
});
const look = action({
	id: "h:look",
	label: "Look Around",
	descriptor: "srd/look",
	targetRef: "world",
	provider: "place",
});
const attack = action({
	id: "h:attack-7",
	label: "Melee Attack — Goblin",
	descriptor: "srd/attack/melee",
	targetRef: "entity:7",
	targetName: "Goblin",
	provider: "entity",
});
const speakTo = action({
	id: "h:speak-7",
	label: "Speak To — Goblin",
	descriptor: "srd/speak-to",
	verb: "communicate",
	targetRef: "entity:7",
	targetName: "Goblin",
	provider: "entity",
	acceptsUtterance: true,
});
const whisper = action({
	id: "h:whisper-7",
	label: "Whisper — Goblin",
	descriptor: "srd/whisper",
	verb: "communicate",
	targetRef: "entity:7",
	targetName: "Goblin",
	provider: "entity",
	acceptsUtterance: true,
});
const athletics = action({
	id: "h:ath-7",
	label: "Check: Athletics — Goblin",
	descriptor: "srd/check/athletics",
	targetRef: "entity:7",
	targetName: "Goblin",
	provider: "entity",
});
const answer = action({
	id: "h:answer-1",
	label: "Answer 1",
	descriptor: "srd/answer",
	targetRef: "entity:4",
	targetName: "Aldwin",
	slot: 1,
});

const goblinRow: SelectionRow = {
	title: "Selected",
	subjects: [{ id: "7", name: "Goblin", infoRef: "occupant:7", primary: [], more: [] }],
};

it("puts an inventory item's exact Item and Entity offers in its own digit group", () => {
	const verbs = [
		action({ id: "h:item", descriptor: "equip", label: "Equip", targetRef: "item:42" }),
		action({ id: "h:entity", descriptor: "polish", label: "Polish", targetRef: "entity:42" }),
	];
	const hotbar = hotbarFromView(
		input({
			selectionRow: {
				title: "Selected",
				subjects: [
					{ id: "item:inventory-handle", name: "Blade", primary: [], more: [], itemActions: verbs },
				],
			},
		}),
	);
	expect(hotbar.chip?.name).toBe("Blade");
	expect(hotbar.selection[0]?.key).toBe("item:inventory-handle");
	expect(assignSlotKeys(hotbarRows(hotbar, false), ["1", "2"]).ids).toEqual(["h:item", "h:entity"]);
});

function input(overrides: Partial<HotbarInput> = {}): HotbarInput {
	return {
		actions: [dodge, aloud, look, attack, speakTo, whisper, athletics, answer],
		heroActorId: "1",
		placeId: "den",
		selectionRow: null,
		answers: [],
		answersLabel: null,
		memory: new Map(),
		...overrides,
	};
}

describe("hotbarFromView", () => {
	it("groups by niche provider: ME is the actor's own, HERE the place's; another entity's acts wait for a selection", () => {
		const hotbar = hotbarFromView(input());
		expect(hotbar.chip).toBeNull();
		expect(hotbar.me.slots.map((slot) => slot.id)).toEqual(["h:dodge", "h:aloud"]);
		expect(hotbar.here.slots.map((slot) => slot.id)).toEqual(["h:look"]);
		expect(hotbar.selection).toEqual([]);
	});

	it("folds a line-bound offer targeted at the open dialogue's speaker into HERE, unselected", () => {
		const adopt = action({
			id: "h:adopt",
			label: "Adopt the recommended array",
			descriptor: "npc/adopt-array",
			targetRef: "entity:4",
			targetName: "Aldwin",
			provider: "entity",
		});
		const hotbar = hotbarFromView(
			input({ actions: [...input().actions, adopt], talkSpeakerId: "4" }),
		);
		expect(hotbar.here.slots.map((slot) => slot.id)).toContain("h:adopt");
		expect(hotbar.selection).toEqual([]);
	});

	it("keeps a newly offered prefilled dialogue menu ahead of remembered stale choices", () => {
		const classes = ["Barbarian", "Bard", "Cleric", "Druid"].map((label) =>
			action({
				id: `h:class:${label}`,
				label,
				descriptor: `dm/creation/class/${label.toLowerCase()}`,
				targetRef: "entity:4",
				provider: "entity",
				acceptsUtterance: true,
				input: { fields: [] },
			}),
		);
		const memory = rememberHotbar(
			new Map(),
			hotbarFromView(input({ actions: [look, ...classes], talkSpeakerId: "4" })),
		);
		const backgrounds = ["Acolyte", "Criminal", "Sage", "Soldier"].map((label) =>
			action({
				id: `h:background:${label}`,
				label,
				descriptor: `dm/creation/background/${label.toLowerCase()}`,
				targetRef: "entity:4",
				provider: "entity",
				acceptsUtterance: true,
				input: { fields: [] },
			}),
		);
		const next = hotbarFromView(
			input({ actions: [look, ...backgrounds], talkSpeakerId: "4", memory }),
		);

		expect(next.here.slots.slice(0, 4).map((slot) => slot.label)).toEqual([
			"Acolyte",
			"Criminal",
			"Sage",
			"Soldier",
		]);
	});

	it("keeps world-authored structured forms ahead of remembered stale actions", () => {
		const forms = ["appearance", "backstory", "name"].map((field) =>
			action({
				id: `h:${field}`,
				label: `Propose ${field}`,
				descriptor: `dm/creation/input/${field}`,
				targetRef: "entity:4",
				provider: "entity",
				acceptsUtterance: true,
				input: { fields: [{ name: field, label: field, control: "text" }] },
			}),
		);
		const memory = rememberHotbar(
			new Map(),
			hotbarFromView(
				input({ actions: [look, action({ id: "h:old", label: "Old", descriptor: "old" })] }),
			),
		);
		const adopt = action({
			id: "h:adopt",
			label: "Adopt the recommended array",
			descriptor: "dm/creation/adopt/recommended",
			targetRef: "entity:4",
			provider: "entity",
			acceptsUtterance: true,
			input: { fields: [] },
		});
		const next = hotbarFromView(
			input({ actions: [look, adopt, ...forms], memory, talkSpeakerId: "4" }),
		);
		expect(next.here.slots.slice(0, 4).map((slot) => slot.id)).toEqual([
			"h:appearance",
			"h:backstory",
			"h:name",
			"h:adopt",
		]);
	});

	it("keeps an actor-carried attack on someone else out of ME: it belongs to that target's selection", () => {
		const strike = action({
			id: "h:strike-7",
			label: "Unarmed Strike — Goblin",
			descriptor: "srd/attack/unarmed-strike/damage",
			targetRef: "entity:7",
			targetName: "Goblin",
			provider: "actor",
		});
		// The same act, offered once more as its bare reach: no one to hit, no slot.
		const reach = action({
			id: "h:strike-reach",
			label: "Unarmed Strike",
			descriptor: "srd/attack/unarmed-strike/damage",
			targetRef: "place_node_set:den/station:9144:srd/attack/unarmed-strike/damage/affordance",
			provider: "actor",
		});
		const bare = hotbarFromView(input({ actions: [dodge, reach] }));
		expect([...bare.me.slots, ...bare.here.slots].map((slot) => slot.id)).toEqual(["h:dodge"]);
		const unselected = hotbarFromView(input({ actions: [dodge, strike] }));
		expect(unselected.me.slots.map((slot) => slot.id)).toEqual(["h:dodge"]);
		expect(unselected.here.slots).toEqual([]);
		const selected = hotbarFromView(input({ actions: [dodge, strike], selectionRow: goblinRow }));
		expect(selected.selection[0]?.slots.map((slot) => slot.id)).toEqual(["h:strike-7"]);
		expect(selected.me.slots.map((slot) => slot.id)).toEqual(["h:dodge"]);
	});

	it("falls back to the target ref for a payload without provider", () => {
		const bare = [dodge, look, attack].map(({ provider: _provider, ...rest }) => rest);
		const hotbar = hotbarFromView(input({ actions: bare }));
		expect(hotbar.me.slots.map((slot) => slot.id)).toEqual(["h:dodge"]);
		expect(hotbar.here.slots.map((slot) => slot.id)).toEqual(["h:look"]);
	});

	it("a selected actor shows every act on it, speech included, in stable descriptor order; checks fold into one menu", () => {
		const hotbar = hotbarFromView(input({ selectionRow: goblinRow }));
		expect(hotbar.chip).toEqual({ name: "Goblin", infoRef: "occupant:7" });
		const [group] = hotbar.selection;
		expect(group?.label).toBe("Goblin");
		expect(group?.slots.map((slot) => [slot.label, slot.acceptsUtterance])).toEqual([
			["Melee Attack", false],
			["Speak To", true],
			["Whisper", true],
		]);
		expect(group?.slots[0]?.accessibleLabel).toBe("Melee Attack — Goblin");
		expect(group?.more).toEqual([
			{
				id: "checks",
				label: "Checks",
				submenu: [
					{
						id: "h:ath-7",
						label: "Check: Athletics",
						accessibleLabel: "Check: Athletics — Goblin",
					},
				],
			},
		]);
	});

	it("never lists a numbered dialogue answer as a slot of a group; answers are their own leading group", () => {
		const hotbar = hotbarFromView(
			input({
				answers: [{ id: "h:answer-1", number: 1, text: "Yes." }],
				answersLabel: "1 answer · Aldwin",
			}),
		);
		expect(hotbar.answers?.slots.map((slot) => slot.label)).toEqual(["Yes."]);
		expect(
			[...hotbar.here.slots, ...hotbar.me.slots].some((slot) => slot.id === "h:answer-1"),
		).toBe(false);
	});

	it("folds overflow answers into the answers group's own menu, never a slot", () => {
		const hotbar = hotbarFromView(
			input({
				answers: [{ id: "h:answer-1", number: 1, text: "Yes." }],
				answersLabel: "2 answers · Aldwin",
				answersOverflow: [{ id: "h:answer-2", number: 2, text: "No, and here is a long reason." }],
			}),
		);
		expect(hotbar.answers?.slots.map((slot) => slot.id)).toEqual(["h:answer-1"]);
		expect(hotbar.answers?.more).toEqual([
			{ id: "h:answer-2", label: "No, and here is a long reason." },
		]);
	});

	it("selecting yourself folds mine, this cell's own untargeted verbs, and the world-scoped group into the SELECTION group, not only isMine", () => {
		const searchCellar = action({
			id: "h:search",
			label: "Search the cellar",
			descriptor: "srd/generic",
			targetName: "Cell 1,0",
			targetRef: "place_node:den",
			provider: "place",
		});
		const worldCheck = action({
			id: "h:listen",
			label: "Check: Perception",
			descriptor: "srd/check/perception",
			targetName: "world",
			targetRef: "world",
			provider: "place",
		});
		const selfRow: SelectionRow = {
			title: "Selected",
			subjects: [{ id: "self", name: "You", primary: [], more: [] }],
		};
		const hotbar = hotbarFromView(
			input({ actions: [dodge, searchCellar, worldCheck], selectionRow: selfRow }),
		);
		expect(hotbar.selection[0]?.label).toBe("You");
		expect(hotbar.selection[0]?.slots.map((slot) => slot.id)).toEqual(["h:dodge", "h:search"]);
		expect(hotbar.selection[0]?.more).toEqual([
			{ id: "checks", label: "Checks", submenu: [{ id: "h:listen", label: "Check: Perception" }] },
		]);
	});

	it("keeps a travel or step selection as its one move slot", () => {
		const hotbar = hotbarFromView(
			input({
				selectionRow: {
					title: "Selected",
					subjects: [
						{
							id: "place:road",
							name: "North Road",
							primary: [{ id: "move:s:exit:2", label: "Travel to North Road" }],
							more: [],
						},
					],
				},
			}),
		);
		expect(hotbar.selection[0]?.slots).toEqual([
			{
				id: "move:s:exit:2",
				label: "Travel to North Road",
				descriptor: "move:s:exit:2",
				acceptsUtterance: false,
				dimmed: false,
			},
		]);
	});

	it("says so when the selected thing offers nothing", () => {
		const hotbar = hotbarFromView(input({ actions: [dodge], selectionRow: goblinRow }));
		expect(hotbar.selection[0]?.note).toBe("Nothing is offered from here.");
	});
});

describe("stable slots: a known act that is not offered right now is dimmed, in place", () => {
	it("remembers live slots and dims them when the world stops offering them", () => {
		let memory: HotbarMemory = new Map();
		const before = hotbarFromView(input({ selectionRow: goblinRow, memory }));
		memory = rememberHotbar(memory, before);
		const after = hotbarFromView(
			input({ actions: [dodge, speakTo], selectionRow: goblinRow, memory }),
		);
		expect(after.selection[0]?.slots.map((slot) => [slot.label, slot.dimmed])).toEqual([
			["Melee Attack", true],
			["Speak To", false],
			["Whisper", true],
		]);
		expect(after.me.slots.map((slot) => [slot.label, slot.dimmed])).toEqual([
			["Dodge", false],
			["Speak Aloud", true],
		]);
	});

	it("a newly offered act takes the next free place; it never shifts the digits of slots already shown", () => {
		const rest = action({
			id: "h:rest",
			label: "Long Rest",
			descriptor: "srd/rest/long",
			targetRef: "entity:1",
			targetName: "You",
			provider: "actor",
		});
		const standUp = action({
			id: "h:stand",
			label: "Stand Up",
			descriptor: "srd/movement/stand-up",
			targetRef: "entity:1",
			targetName: "You",
			provider: "actor",
		});
		const first = hotbarFromView(input({ actions: [dodge, rest] }));
		expect(first.me.slots.map((slot) => slot.label)).toEqual(["Dodge", "Long Rest"]);
		const memory = rememberHotbar(new Map(), first);
		// "srd/movement/stand-up" sorts BEFORE "srd/rest/long"; it must still land after it.
		const prone = hotbarFromView(input({ actions: [dodge, rest, standUp], memory }));
		expect(prone.me.slots.map((slot) => slot.label)).toEqual(["Dodge", "Long Rest", "Stand Up"]);
		const after = hotbarFromView(
			input({ actions: [dodge, rest], memory: rememberHotbar(memory, prone) }),
		);
		expect(after.me.slots.map((slot) => [slot.label, slot.dimmed])).toEqual([
			["Dodge", false],
			["Long Rest", false],
			["Stand Up", true],
		]);
	});

	it("returns the same memory when nothing is new", () => {
		const hotbar = hotbarFromView(input());
		const memory = rememberHotbar(new Map(), hotbar);
		expect(rememberHotbar(memory, hotbarFromView(input({ memory })))).toBe(memory);
	});
});

describe("hotbarRows / assignSlotKeys", () => {
	it("compact: HERE and ME with nothing selected; the selection alone when there is one", () => {
		expect(
			hotbarRows(hotbarFromView(input()), false).map((row) => row.map((group) => group.id)),
		).toEqual([["here", "me"]]);
		expect(
			hotbarRows(hotbarFromView(input({ selectionRow: goblinRow })), false).map((row) =>
				row.map((group) => group.id),
			),
		).toEqual([["subject:7"]]);
	});

	it("compact folds a crowded group past its first four slots into its own menu; expanded shows them all (sk-jay0.1.8.63.45)", () => {
		const body = ["a", "b", "c", "d", "e", "f"].map((letter) =>
			action({
				id: `h:${letter}`,
				label: `Act ${letter.toUpperCase()}`,
				descriptor: `srd/act/${letter}`,
				targetRef: "entity:1",
				targetName: "You",
				provider: "actor",
			}),
		);
		const hotbar = hotbarFromView(input({ actions: [look, ...body] }));
		const me = (rows: HotbarGroup[][]) => rows[0]?.find((group) => group.id === "me");

		const compact = me(hotbarRows(hotbar, false));
		expect(compact?.slots.map((slot) => slot.id)).toEqual(["h:a", "h:b", "h:c", "h:d"]);
		expect(compact?.more.map((entry) => entry.id)).toEqual(["h:e", "h:f"]);

		const expanded = me(hotbarRows(hotbar, true));
		expect(expanded?.slots.map((slot) => slot.id)).toEqual([
			"h:a",
			"h:b",
			"h:c",
			"h:d",
			"h:e",
			"h:f",
		]);
		expect(expanded?.more).toEqual([]);

		// The slots that stay keep the digit they have when expanded.
		const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
		const compactKeys = assignSlotKeys(hotbarRows(hotbar, false), keys).keyBySlotId;
		const expandedKeys = assignSlotKeys(hotbarRows(hotbar, true), keys).keyBySlotId;
		for (const id of ["h:look", "h:a", "h:b", "h:c", "h:d"])
			expect(compactKeys.get(id)).toBe(expandedKeys.get(id));
	});

	it("compact never folds an open prompt's answers, and drops a folded slot that is only dimmed", () => {
		const answers = [1, 2, 3, 4, 5, 6].map((number) => ({
			id: `h:answer-${number}`,
			number,
			text: `Answer ${number}`,
		}));
		const withAnswers = hotbarFromView(input({ answers, answersLabel: "Aldwin" }));
		expect(hotbarRows(withAnswers, false)[0]?.[0]?.slots).toHaveLength(6);

		const five = ["a", "b", "c", "d", "e"].map((letter) =>
			action({
				id: `h:${letter}`,
				label: `Act ${letter}`,
				descriptor: `srd/act/${letter}`,
				targetRef: "entity:1",
				provider: "actor",
			}),
		);
		const memory = rememberHotbar(new Map(), hotbarFromView(input({ actions: five })));
		const later = hotbarFromView(input({ actions: five.slice(0, 4), memory }));
		const me = hotbarRows(later, false)[0]?.find((group) => group.id === "me");
		expect(me?.slots).toHaveLength(4);
		expect(me?.more).toEqual([]);
	});

	it("expanded: the selection on top, HERE and ME below", () => {
		expect(
			hotbarRows(hotbarFromView(input({ selectionRow: goblinRow })), true).map((row) =>
				row.map((group) => group.id),
			),
		).toEqual([["subject:7"], ["here"], ["me"]]);
	});

	it("puts digits on the first row only, and a dimmed slot keeps its digit but does nothing", () => {
		const memory = rememberHotbar(new Map(), hotbarFromView(input({ selectionRow: goblinRow })));
		const hotbar = hotbarFromView(
			input({ actions: [dodge, look, speakTo], selectionRow: goblinRow, memory }),
		);
		const { keyBySlotId, ids } = assignSlotKeys(hotbarRows(hotbar, true), ["1", "2", "3", "4"]);
		expect(ids).toEqual([null, "h:speak-7", null]);
		expect(keyBySlotId.get("h:speak-7")).toBe("2");
		expect(keyBySlotId.has("h:dodge")).toBe(false);
	});

	it("stops at the number of slot keys", () => {
		const { ids } = assignSlotKeys(hotbarRows(hotbarFromView(input()), false), ["1", "2"]);
		expect(ids).toEqual(["h:look", "h:dodge"]);
	});
});

describe("composerSlot", () => {
	it("speaks to the room with nothing selected, to the selection when it takes words", () => {
		expect(composerSlot(hotbarFromView(input()), null)?.id).toBe("h:aloud");
		expect(composerSlot(hotbarFromView(input({ selectionRow: goblinRow })), null)?.id).toBe(
			"h:speak-7",
		);
	});

	it("keeps the player's own mode while that slot is offered, and falls back when it is gone", () => {
		expect(
			composerSlot(hotbarFromView(input({ selectionRow: goblinRow })), "h:whisper-7")?.id,
		).toBe("h:whisper-7");
		expect(composerSlot(hotbarFromView(input()), "h:whisper-7")?.id).toBe("h:aloud");
	});

	it("requires an explicit click for a structured form, then falls back to ordinary speech", () => {
		const scores = action({
			id: "h:scores",
			label: "Set ability scores",
			descriptor: "dm/creation/input/ability-scores",
			verb: "communicate",
			targetRef: "world",
			provider: "place",
			acceptsUtterance: true,
			input: { fields: [{ name: "str", label: "Strength", control: "number" }] },
		});
		const hotbar = hotbarFromView(input({ actions: [aloud, scores] }));
		expect(composerSlot(hotbar, null)?.id).toBe("h:aloud");
		expect(composerSlot(hotbar, "h:scores")?.id).toBe("h:scores");
	});

	it("never treats an answer-handle duplicate as a composer target", () => {
		const duplicate = { ...answer, slot: undefined, acceptsUtterance: true };
		const hotbar = hotbarFromView(
			input({
				actions: [...input().actions, duplicate],
				answers: [{ id: answer.id, number: 1, text: "Barbarian" }],
				answersLabel: "1 answer · Aldwin",
				talkSpeakerId: "4",
			}),
		);
		expect(composerSlot(hotbar, null)?.id).toBe("h:aloud");
	});

	it("is null when nothing takes words", () => {
		expect(composerSlot(hotbarFromView(input({ actions: [dodge, look] })), null)).toBeNull();
	});
});
