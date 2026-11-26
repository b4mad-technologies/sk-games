import { describe, expect, it } from "vitest";
import { type InfoCardReadCtx, parseInfoCardRef, resolveInfoCard } from "./info-cards";
import type { PlayAction, PlayOccupantDetail, PlayView } from "./play-view";

function view(overrides: Partial<PlayView> = {}): PlayView {
	return {
		hero: {
			actorId: "7",
			name: "Hero",
			vitals: [],
			quest: [],
			conditionDetails: [
				{
					id: "srd/condition/poisoned",
					label: "Poisoned",
					description: "Disadvantage on attacks and checks.",
					stackCount: 2,
					expiresAtTick: 40,
				},
			],
			abilities: [],
			skills: [],
			masteries: [],
			conditions: ["srd/condition/poisoned"],
			appearance: "",
			backstory: "",
			placeId: "inn/common_room",
		},
		place: {
			id: "inn/common_room",
			name: "Common Room",
			description: "A warm hearth room.",
			exits: [
				{
					handle: "s:exit:1",
					rev: "r1",
					label: "southeast",
					to: "inn/stairs",
					toName: "Stairs",
					gates: [],
				},
			],
		},
		occupants: [
			{
				id: "4",
				handle: "s:actor:4",
				rev: "a4",
				kind: "person",
				sceneKind: "actor",
				name: "Aldwin",
				conditions: [],
				note: "Here",
				defId: "srd/npc/aldwin",
			},
		],
		actions: [],
		actionCount: 0,
		manipulationContext: { status: "unavailable" },
		session: {
			inSession: false,
			myTurn: false,
			lifecycle: null,
			currentActor: null,
			currentActorName: null,
			roster: [],
		},
		reaction: null,
		pack: [],
		speech: [],
		events: [],
		mapSvg: null,
		...overrides,
	};
}

function actionsById(actions: PlayAction[]): ReadonlyMap<string, PlayAction> {
	return new Map(actions.map((action) => [action.id, action]));
}

function ctx(overrides: Partial<InfoCardReadCtx> = {}): InfoCardReadCtx {
	return {
		view: view(),
		actionsById: actionsById([]),
		readOccupant: () => Promise.reject(new Error("not stubbed")),
		readDefinition: () => Promise.resolve(null),
		...overrides,
	};
}

describe("parseInfoCardRef", () => {
	it("splits a known kind from its id", () => {
		expect(parseInfoCardRef("occupant:4")).toEqual({ kind: "occupant", id: "4" });
		expect(parseInfoCardRef("def:srd/creature/goblin-warrior")).toEqual({
			kind: "def",
			id: "srd/creature/goblin-warrior",
		});
		expect(parseInfoCardRef("hero:ability:srd/str")).toEqual({
			kind: "hero",
			id: "ability:srd/str",
		});
	});

	it("rejects an unknown kind, a missing id, or no separator", () => {
		expect(parseInfoCardRef("nonsense:4")).toBeNull();
		expect(parseInfoCardRef("occupant:")).toBeNull();
		expect(parseInfoCardRef("occupant")).toBeNull();
	});
});

describe("resolveInfoCard: hero:<section>:<id>", () => {
	it("turns full-sheet values and abilities into the standard presentation-only card", async () => {
		const sheet = view({
			hero: {
				...view().hero,
				vitals: [
					{ id: "srd/hp", label: "Hit points", value: "11", description: "Current health." },
				],
				abilities: [
					{
						id: "srd/str",
						label: "Strength",
						score: 14,
						modifier: 2,
						description: "Physical power.",
					},
				],
				skills: [{ id: "srd/athletics", label: "Athletics" }],
			},
		});
		expect(await resolveInfoCard("hero:vital:srd/hp", ctx({ view: sheet }))).toEqual({
			title: "Hit points",
			kind: "Character sheet",
			summary: "Current health.",
			facts: [{ label: "Value", value: "11" }],
		});
		expect(await resolveInfoCard("hero:ability:srd/str", ctx({ view: sheet }))).toEqual({
			title: "Strength",
			kind: "Character sheet",
			summary: "Physical power.",
			facts: [
				{ label: "Value", value: "14" },
				{ label: "Modifier", value: "+2" },
			],
		});
		expect(await resolveInfoCard("hero:skill:srd/athletics", ctx({ view: sheet }))).toEqual({
			title: "Athletics",
			kind: "Skill",
			summary: "No description available.",
		});
	});
});

describe("resolveInfoCard: occupant:<id>", () => {
	const detail: PlayOccupantDetail = {
		id: "4",
		handle: "s:actor:4",
		rev: "a4",
		entityId: "4",
		defId: "srd/npc/aldwin",
		description: "The hearth-keeper, watchful and dry-humoured.",
		facts: [{ id: "faction", label: "Faction", value: "The Ledger" }],
		verbs: [],
	};

	it("shows name, kind, description, facts, and a def: link to its own definition", async () => {
		const card = await resolveInfoCard(
			"occupant:4",
			ctx({ readOccupant: () => Promise.resolve(detail) }),
		);
		expect(card).toEqual({
			title: "Aldwin",
			kind: "Person",
			summary: "The hearth-keeper, watchful and dry-humoured.",
			facts: [{ label: "Faction", value: "The Ledger" }],
			body: [{ refId: "def:srd/npc/aldwin", text: "Full definition" }],
		});
	});

	it("is not-found when the occupant is no longer present", async () => {
		const card = await resolveInfoCard(
			"occupant:missing",
			ctx({ readOccupant: () => Promise.resolve(detail) }),
		);
		expect(card).toBeNull();
	});

	it("propagates a failed detail read as a rejection, never an empty success", async () => {
		await expect(
			resolveInfoCard(
				"occupant:4",
				ctx({ readOccupant: () => Promise.reject(new Error("read failed")) }),
			),
		).rejects.toThrow();
	});

	it("stays pending while the detail read is in flight (loading)", async () => {
		let settle: ((value: PlayOccupantDetail) => void) | undefined;
		const pending = new Promise<PlayOccupantDetail>((resolve) => {
			settle = resolve;
		});
		const result = resolveInfoCard("occupant:4", ctx({ readOccupant: () => pending }));
		let settled = false;
		void result.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		settle?.(detail);
		await result;
		expect(settled).toBe(true);
	});
});

describe("resolveInfoCard: def:<entityDefId>", () => {
	it("shows the adapter's title/description/footer link", async () => {
		const card = await resolveInfoCard(
			"def:srd/npc/aldwin",
			ctx({
				readDefinition: (id) =>
					Promise.resolve(
						id === "srd/npc/aldwin"
							? {
									title: "Aldwin",
									description: "A keeper.",
									href: "https://spellkave.com/docs/npc/aldwin",
								}
							: null,
					),
			}),
		);
		expect(card).toEqual({
			title: "Aldwin",
			summary: "A keeper.",
			footerHref: "https://spellkave.com/docs/npc/aldwin",
		});
	});

	it("is not-found when the adapter has nothing for this id", async () => {
		const card = await resolveInfoCard(
			"def:unknown",
			ctx({ readDefinition: () => Promise.resolve(null) }),
		);
		expect(card).toBeNull();
	});
});

describe("resolveInfoCard: condition:<id>", () => {
	it("shows the hero's own condition with its stack/expiry facts", async () => {
		const card = await resolveInfoCard("condition:srd/condition/poisoned", ctx());
		expect(card).toEqual({
			title: "Poisoned",
			kind: "Condition",
			summary: "Disadvantage on attacks and checks.",
			facts: [
				{ label: "Stacks", value: "2" },
				{ label: "Expires", value: "Tick 40" },
			],
		});
	});

	it("is not-found for anyone else's condition, or one no longer on the sheet", async () => {
		expect(await resolveInfoCard("condition:srd/condition/prone", ctx())).toBeNull();
	});
});

describe("resolveInfoCard: place:<id>", () => {
	it("shows the current place's name, description, and exits as facts", async () => {
		const card = await resolveInfoCard("place:inn/common_room", ctx());
		expect(card).toEqual({
			title: "Common Room",
			kind: "Place",
			summary: "A warm hearth room.",
			facts: [{ label: "southeast", value: "Stairs" }],
		});
	});

	it("is not-found for any place that is not the current one", async () => {
		expect(await resolveInfoCard("place:inn/stairs", ctx())).toBeNull();
	});
});

describe("resolveInfoCard: action:<id>", () => {
	const action: PlayAction = {
		id: "h:ask",
		label: "Ask Aldwin About Advancement",
		description: "Aldwin explains what a career in the Ledger requires.",
		verb: "communicate",
		descriptor: "dm/dialog/ask-advancement",
		targetName: "Aldwin",
		targetRef: "entity:4",
		acceptsUtterance: false,
	};

	it("shows the offered action's own description and its target as a fact", async () => {
		const card = await resolveInfoCard("action:h:ask", ctx({ actionsById: actionsById([action]) }));
		expect(card).toEqual({
			title: "Ask Aldwin About Advancement",
			kind: "Action",
			summary: "Aldwin explains what a career in the Ledger requires.",
			facts: [{ label: "Target", value: "Aldwin" }],
		});
	});

	it("is not-found for a handle the session does not currently know", async () => {
		expect(await resolveInfoCard("action:h:missing", ctx())).toBeNull();
	});
});

describe("resolveInfoCard: unrecognized ref", () => {
	it("is not-found rather than throwing", async () => {
		expect(await resolveInfoCard("nonsense:4", ctx())).toBeNull();
	});
});
