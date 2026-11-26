import type { WatchActor, WatchItem } from "@spellkave/sdk";
import type { DocsReferenceGroup, DocsRowEntryView } from "@spellkave/ui-widgets/catalogue";
import { describe, expect, it } from "vitest";
import { type DrawerFrame, type DrawerLinks, drawerRowView } from "./drawer-view";

const links: DrawerLinks = {
	person: (id) => `/w/kavemouth/person/${id}`,
	thing: (id) => `/w/kavemouth/thing/${id}`,
	place: (id) => `/w/kavemouth/place/${id}`,
};

const loft = "kavemouth/inn/loft";
const limbo = "kavemouth/creation_limbo/station";

const torvald: WatchActor = {
	art: null,
	entityId: "1",
	actorId: "1",
	name: "Torvald Ironmark",
	placeNodeId: loft,
	faction: "heroes",
	description: "A freshly created fighter.",
	conditions: [{ id: "srd/condition/prone", stack_count: 1 }],
	states: [
		{ state_id: "srd/hp", display_name: "srd/hp", value: "12" },
		{ state_id: "srd/str", display_name: "srd/str", value: "16" },
		{ state_id: "dm/creation/phase", display_name: "dm/creation/phase", value: "3" },
	],
};

const aldwin: WatchActor = {
	art: null,
	entityId: "4",
	actorId: "4",
	name: "Aldwin",
	placeNodeId: limbo,
	faction: null,
	description: null,
	conditions: [],
	states: [],
};

const mira: WatchActor = { ...aldwin, entityId: "2", name: "Mira", placeNodeId: loft };

const javelin = (entityId: string): WatchItem => ({
	art: null,
	entityId,
	name: "Javelin",
	placeNodeId: loft,
	holderEntityId: "1",
	holderName: "Torvald Ironmark",
	slotId: "",
	description: "A throwable spear.",
	states: [],
	tags: [],
});

const chainMail: WatchItem = {
	art: null,
	entityId: "156",
	name: "Chain Mail",
	placeNodeId: loft,
	holderEntityId: "1",
	holderName: "Torvald Ironmark",
	slotId: "srd/slot/chest",
	description: "Heavy interlocking rings.",
	states: [
		{ state_id: "srd/armor_ac_base", display_name: "srd/armor_ac_base", value: "16" },
		{ state_id: "srd/armor_str_required", display_name: "srd/armor_str_required", value: "13" },
		{
			state_id: "srd/armor_stealth_disadvantage",
			display_name: "srd/armor_stealth_disadvantage",
			value: "1",
		},
		{ state_id: "srd/weight_lb10", display_name: "srd/weight_lb10", value: "550" },
		{ state_id: "srd/cost_cp", display_name: "srd/cost_cp", value: "7500" },
	],
	tags: ["armor"],
};

const frame: DrawerFrame = {
	actors: [torvald, mira, aldwin],
	items: [javelin("159"), javelin("160"), chainMail],
	occupancy: [
		{ entityId: "1", placeNodeId: loft, name: "Torvald Ironmark" },
		{ entityId: "2", placeNodeId: loft, name: "Mira" },
		{ entityId: "4", placeNodeId: limbo, name: "Aldwin" },
	],
	drawableNodes: new Set([loft]),
};

function group(row: DocsRowEntryView, label: string): DocsReferenceGroup | undefined {
	return row.references?.find((candidate) => candidate.label === label);
}

describe("drawerRowView — person", () => {
	const row = drawerRowView({ kind: "person", actor: torvald }, frame, links);

	it("names the subject and falls back to the entity ref without a manifest ref", () => {
		expect(row.title).toBe("Torvald Ironmark");
		expect(row.kind_label).toBe("Person");
		expect(row.ref).toBe("entity:1");
		expect(row.description).toBe("A freshly created fighter.");
	});

	it("prefers the authored manifest ref when the caller knows it", () => {
		const authored = drawerRowView(
			{ kind: "person", actor: torvald, manifestRef: "kavemouth/npc/torvald" },
			frame,
			links,
		);
		expect(authored.ref).toBe("kavemouth/npc/torvald");
	});

	it("renders faction, conditions and readable states, and drops DM bookkeeping", () => {
		expect(row.fields.map((f) => f.label)).toEqual([
			"Faction",
			"Conditions",
			"Hit points",
			"Strength",
		]);
		expect(row.fields.find((f) => f.label === "Conditions")?.value).toBe("prone");
		expect(row.fields.find((f) => f.label === "Hit points")?.value).toBe("12");
	});

	it("drops quest, dialog and companion bookkeeping states (the DM seat carries dozens)", () => {
		const dm: WatchActor = {
			...aldwin,
			states: [
				{ state_id: "kavemouth/quest/Q4/rewarded", display_name: "", value: "0" },
				{ state_id: "kavemouth/quest/flag/q9_tomb_opened", display_name: "", value: "0" },
				{ state_id: "kavemouth/dialog/aldwin/cursor", display_name: "", value: "3" },
				{ state_id: "kavemouth/companion/rogue/agreement", display_name: "", value: "0" },
				{ state_id: "srd/hp", display_name: "srd/hp", value: "9" },
			],
		};
		const view = drawerRowView({ kind: "person", actor: dm }, frame, links);
		expect(view.fields.map((f) => f.label)).toEqual(["Hit points"]);
	});

	it("lists the carried kit as linked references with stacks collapsed", () => {
		const carrying = group(row, "Carrying");
		expect(carrying?.entries.map((entry) => entry.title)).toEqual(["Javelin ×2", "Chain Mail"]);
		expect(carrying?.entries[0]?.href).toBe("/w/kavemouth/thing/159");
		expect(carrying?.entries[1]?.summary).toBe("Equipped · chest");
	});

	it("links the place and lists who else is there", () => {
		expect(group(row, "Place")?.entries[0]).toEqual({
			ref: `place:${loft}`,
			title: "Inn · Loft",
			href: `/w/kavemouth/place/${loft}`,
			summary: undefined,
		});
		expect(group(row, "Also here")?.entries.map((entry) => entry.title)).toEqual(["Mira"]);
	});

	it("drops the place link and explains it when the node is off the map", () => {
		const row = drawerRowView({ kind: "person", actor: aldwin }, frame, links);
		const place = group(row, "Place")?.entries[0];
		expect(place?.href).toBeUndefined();
		expect(place?.summary).toContain("not drawn on this map");
		expect(group(row, "Carrying")).toBeUndefined();
		expect(group(row, "Also here")).toBeUndefined();
		expect(row.description).toBeUndefined();
	});
});

describe("drawerRowView — thing", () => {
	const row = drawerRowView({ kind: "thing", item: chainMail }, frame, links);

	it("names the subject and its slot", () => {
		expect(row.title).toBe("Chain Mail");
		expect(row.kind_label).toBe("Thing");
		expect(row.ref).toBe("entity:156");
		expect(row.fields[0]).toEqual({ label: "Equipped", value: "chest" });
	});

	it("renders the armor numbers with readable labels and documented units", () => {
		const byLabel = new Map(row.fields.map((f) => [f.label, f.value]));
		expect(byLabel.get("Armor class")).toBe("16");
		expect(byLabel.get("Strength required")).toBe("13");
		expect(byLabel.get("Stealth")).toBe("Disadvantage");
		expect(byLabel.get("Weight")).toBe("55 lb");
		expect(byLabel.get("Cost")).toBe("75 gp");
		expect(byLabel.get("Tags")).toBe("armor");
	});

	it("links the holder and the place", () => {
		expect(group(row, "Held by")?.entries[0]).toEqual({
			ref: "entity:1",
			title: "Torvald Ironmark",
			href: "/w/kavemouth/person/1",
		});
		expect(group(row, "Place")?.entries[0]?.href).toBe(`/w/kavemouth/place/${loft}`);
	});

	it("omits the holder group for a thing on the ground", () => {
		const loose = drawerRowView(
			{
				kind: "thing",
				item: { ...chainMail, holderEntityId: null, holderName: null, slotId: "" },
			},
			frame,
			links,
		);
		expect(group(loose, "Held by")).toBeUndefined();
		expect(loose.fields.some((f) => f.label === "Equipped")).toBe(false);
	});

	it("keeps two states that humanize alike as two visible rows", () => {
		const twin = drawerRowView(
			{
				kind: "thing",
				item: {
					...chainMail,
					tags: [],
					states: [
						{ state_id: "mod/a/charge", display_name: "mod/a/charge", value: "1" },
						{ state_id: "mod/b/charge", display_name: "mod/b/charge", value: "2" },
					],
				},
			},
			frame,
			links,
		);
		expect(twin.fields.map((f) => f.label)).toEqual(["Equipped", "Charge", "Charge (2)"]);
	});
});

describe("drawerRowView — place", () => {
	it("projects a drawable node with the people standing there", () => {
		const row = drawerRowView({ kind: "place", nodeId: loft }, frame, links);
		expect(row.title).toBe("Inn · Loft");
		expect(row.kind_label).toBe("Place");
		expect(row.ref).toBe(`place:${loft}`);
		expect(row.fields[0]).toEqual({ label: "Node", value: loft, code: true });
		expect(group(row, "Here")?.entries.map((entry) => entry.title)).toEqual([
			"Torvald Ironmark",
			"Mira",
		]);
	});

	it("states the off-map condition for an undrawn node", () => {
		const row = drawerRowView({ kind: "place", nodeId: limbo }, frame, links);
		expect(row.fields.find((f) => f.label === "On the map")?.value).toContain(
			"not drawn on this map",
		);
	});
});
