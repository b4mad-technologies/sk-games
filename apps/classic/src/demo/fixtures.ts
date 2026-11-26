// Fixture data for the mock-up. Nothing here talks to a world.
//
// The app may couple to the SRD ruleset (class, species and background names,
// `srd/*` ids, SRD art) but not to an adventure. The place and the people below
// are invented stand-ins for "whatever the world discloses".

const SRD_ART = "../../../../packages/spellkave-srd-cc/assets/srd-art";

const artFiles = import.meta.glob<string>(
	[
		"../../../../packages/spellkave-srd-cc/assets/srd-art/character_portrait/*.webp",
		"../../../../packages/spellkave-srd-cc/assets/srd-art/creature/{giant-rat,goblin-warrior,commoner,noble,priest-acolyte}.webp",
		"../../../../packages/spellkave-srd-cc/assets/srd-art/item/{dagger,shortsword,longsword,shield,leather-armor,chain-mail,quarterstaff,shortbow,arrows-20,backpack,rope,torch,rations,thieves-tools}.webp",
		"../../../../packages/spellkave-srd-cc/assets/srd-art/spell/{fire-bolt,light,mage-hand,ray-of-frost,magic-missile,shield,sleep,mage-armor,burning-hands,sacred-flame,guidance,cure-wounds}.webp",
	],
	{ eager: true, query: "?url", import: "default" },
);

export type ArtKind = "character_portrait" | "creature" | "item" | "spell";

export function art(kind: ArtKind, slug: string): string | undefined {
	return artFiles[`${SRD_ART}/${kind}/${slug}.webp`];
}

export type Option = {
	id: string;
	label: string;
	blurb: string;
	artKind?: ArtKind;
	artSlug?: string;
	facts?: string[];
};

export type ClassOption = Option & {
	skillCount: number;
	skills: string[];
	caster: boolean;
	kits: { id: string; label: string; items: string[] }[];
};

const martialKit = [
	{ id: "a", label: "Kit A", items: ["Chain Mail", "Longsword", "Shield", "Backpack"] },
	{ id: "b", label: "Kit B", items: ["Leather Armor", "Shortbow", "Arrows (20)", "Shortsword"] },
];
const lightKit = [
	{ id: "a", label: "Kit A", items: ["Leather Armor", "Shortsword", "Dagger", "Thieves' Tools"] },
	{ id: "b", label: "Kit B", items: ["Leather Armor", "Shortbow", "Arrows (20)", "Dagger"] },
];
const casterKit = [
	{ id: "a", label: "Kit A", items: ["Quarterstaff", "Dagger", "Backpack", "Torch"] },
	{ id: "b", label: "Kit B", items: ["Dagger", "Dagger", "Backpack", "Rations"] },
];

function cls(
	id: string,
	label: string,
	blurb: string,
	hitDie: string,
	primary: string,
	skillCount: number,
	skills: string[],
	caster: boolean,
	kits: ClassOption["kits"],
): ClassOption {
	return {
		id,
		label,
		blurb,
		artKind: "character_portrait",
		artSlug: id,
		facts: [`Hit die ${hitDie}`, `Primary ${primary}`],
		skillCount,
		skills,
		caster,
		kits,
	};
}

export const classes: ClassOption[] = [
	cls(
		"barbarian",
		"Barbarian",
		"A fierce warrior of primal rage.",
		"d12",
		"Strength",
		2,
		["Animal Handling", "Athletics", "Intimidation", "Nature", "Perception", "Survival"],
		false,
		martialKit,
	),
	cls(
		"bard",
		"Bard",
		"An inspiring performer whose music is magic.",
		"d8",
		"Charisma",
		3,
		["Acrobatics", "Deception", "Insight", "Performance", "Persuasion", "Stealth"],
		true,
		lightKit,
	),
	cls(
		"cleric",
		"Cleric",
		"A priestly champion who wields divine magic.",
		"d8",
		"Wisdom",
		2,
		["History", "Insight", "Medicine", "Persuasion", "Religion"],
		true,
		martialKit,
	),
	cls(
		"druid",
		"Druid",
		"A priest of nature who commands the elements.",
		"d8",
		"Wisdom",
		2,
		["Animal Handling", "Insight", "Medicine", "Nature", "Perception", "Survival"],
		true,
		casterKit,
	),
	cls(
		"fighter",
		"Fighter",
		"A master of weapons and armor.",
		"d10",
		"Strength or Dexterity",
		2,
		["Acrobatics", "Athletics", "History", "Insight", "Intimidation", "Perception", "Survival"],
		false,
		martialKit,
	),
	cls(
		"monk",
		"Monk",
		"A martial artist who channels inner power.",
		"d8",
		"Dexterity and Wisdom",
		2,
		["Acrobatics", "Athletics", "History", "Insight", "Religion", "Stealth"],
		false,
		lightKit,
	),
	cls(
		"paladin",
		"Paladin",
		"A holy warrior bound to a sacred oath.",
		"d10",
		"Strength and Charisma",
		2,
		["Athletics", "Insight", "Intimidation", "Medicine", "Persuasion", "Religion"],
		true,
		martialKit,
	),
	cls(
		"ranger",
		"Ranger",
		"A hunter who walks the wild edges.",
		"d10",
		"Dexterity and Wisdom",
		3,
		[
			"Animal Handling",
			"Athletics",
			"Insight",
			"Investigation",
			"Nature",
			"Perception",
			"Stealth",
			"Survival",
		],
		true,
		lightKit,
	),
	cls(
		"rogue",
		"Rogue",
		"A scoundrel who wins by stealth and trickery.",
		"d8",
		"Dexterity",
		4,
		[
			"Acrobatics",
			"Athletics",
			"Deception",
			"Insight",
			"Investigation",
			"Perception",
			"Sleight of Hand",
			"Stealth",
		],
		false,
		lightKit,
	),
	cls(
		"sorcerer",
		"Sorcerer",
		"A spellcaster whose magic is inborn.",
		"d6",
		"Charisma",
		2,
		["Arcana", "Deception", "Insight", "Intimidation", "Persuasion", "Religion"],
		true,
		casterKit,
	),
	cls(
		"warlock",
		"Warlock",
		"A wielder of magic granted by a pact.",
		"d8",
		"Charisma",
		2,
		["Arcana", "Deception", "History", "Intimidation", "Investigation", "Nature", "Religion"],
		true,
		casterKit,
	),
	cls(
		"wizard",
		"Wizard",
		"A scholar who bends reality with study.",
		"d6",
		"Intelligence",
		2,
		["Arcana", "History", "Insight", "Investigation", "Medicine", "Religion"],
		true,
		casterKit,
	),
];

export const backgrounds: Option[] = [
	{
		id: "acolyte",
		label: "Acolyte",
		blurb: "You served in a temple and know its rites.",
		facts: ["Insight", "Religion", "Feat: Magic Initiate"],
	},
	{
		id: "criminal",
		label: "Criminal",
		blurb: "You lived by your wits on the wrong side of the law.",
		facts: ["Sleight of Hand", "Stealth", "Feat: Alert"],
	},
	{
		id: "sage",
		label: "Sage",
		blurb: "You spent your years among books and scrolls.",
		facts: ["Arcana", "History", "Feat: Magic Initiate"],
	},
	{
		id: "soldier",
		label: "Soldier",
		blurb: "You trained for war and marched in the ranks.",
		facts: ["Athletics", "Intimidation", "Feat: Savage Attacker"],
	},
];

export const species: Option[] = [
	{
		id: "dragonborn",
		label: "Dragonborn",
		blurb: "Proud kin of dragons with a breath weapon.",
		facts: ["Speed 30 ft", "Breath Weapon"],
	},
	{
		id: "dwarf",
		label: "Dwarf",
		blurb: "Stout and hardy folk of stone and forge.",
		facts: ["Speed 30 ft", "Darkvision 120 ft"],
	},
	{
		id: "elf",
		label: "Elf",
		blurb: "Graceful, long-lived people touched by magic.",
		facts: ["Speed 30 ft", "Darkvision 60 ft"],
	},
	{
		id: "gnome",
		label: "Gnome",
		blurb: "Small, clever and endlessly curious.",
		facts: ["Speed 30 ft", "Gnomish Cunning"],
	},
	{
		id: "goliath",
		label: "Goliath",
		blurb: "Towering descendants of giants.",
		facts: ["Speed 35 ft", "Powerful Build"],
	},
	{
		id: "halfling",
		label: "Halfling",
		blurb: "Small, brave and remarkably lucky.",
		facts: ["Speed 30 ft", "Luck"],
	},
	{
		id: "human",
		label: "Human",
		blurb: "Adaptable and ambitious, found everywhere.",
		facts: ["Speed 30 ft", "Extra skill and feat"],
	},
	{
		id: "orc",
		label: "Orc",
		blurb: "Tireless and strong, driven to endure.",
		facts: ["Speed 30 ft", "Relentless Endurance"],
	},
	{
		id: "tiefling",
		label: "Tiefling",
		blurb: "Marked by a fiendish legacy.",
		facts: ["Speed 30 ft", "Darkvision 60 ft"],
	},
];

export const cantrips: Option[] = [
	{
		id: "fire-bolt",
		label: "Fire Bolt",
		blurb: "Hurl a mote of fire. 1d10 fire, 120 ft.",
		artKind: "spell",
		artSlug: "fire-bolt",
	},
	{
		id: "ray-of-frost",
		label: "Ray of Frost",
		blurb: "A frigid beam. 1d8 cold and slows.",
		artKind: "spell",
		artSlug: "ray-of-frost",
	},
	{
		id: "light",
		label: "Light",
		blurb: "An object sheds bright light for an hour.",
		artKind: "spell",
		artSlug: "light",
	},
	{
		id: "mage-hand",
		label: "Mage Hand",
		blurb: "A spectral hand moves small things.",
		artKind: "spell",
		artSlug: "mage-hand",
	},
	{
		id: "sacred-flame",
		label: "Sacred Flame",
		blurb: "Radiance descends. 1d8 radiant.",
		artKind: "spell",
		artSlug: "sacred-flame",
	},
	{
		id: "guidance",
		label: "Guidance",
		blurb: "Add 1d4 to one ability check.",
		artKind: "spell",
		artSlug: "guidance",
	},
];

export const levelOneSpells: Option[] = [
	{
		id: "magic-missile",
		label: "Magic Missile",
		blurb: "Three darts that never miss.",
		artKind: "spell",
		artSlug: "magic-missile",
	},
	{
		id: "shield",
		label: "Shield",
		blurb: "Reaction: +5 AC until your next turn.",
		artKind: "spell",
		artSlug: "shield",
	},
	{
		id: "sleep",
		label: "Sleep",
		blurb: "Creatures in a burst drift off.",
		artKind: "spell",
		artSlug: "sleep",
	},
	{
		id: "mage-armor",
		label: "Mage Armor",
		blurb: "AC becomes 13 + Dexterity.",
		artKind: "spell",
		artSlug: "mage-armor",
	},
	{
		id: "burning-hands",
		label: "Burning Hands",
		blurb: "A 15 ft cone of flame. 3d6 fire.",
		artKind: "spell",
		artSlug: "burning-hands",
	},
	{
		id: "cure-wounds",
		label: "Cure Wounds",
		blurb: "Touch: restore 2d8 + modifier.",
		artKind: "spell",
		artSlug: "cure-wounds",
	},
];

export const ABILITIES = [
	{ id: "srd/str", label: "Strength", short: "STR" },
	{ id: "srd/dex", label: "Dexterity", short: "DEX" },
	{ id: "srd/con", label: "Constitution", short: "CON" },
	{ id: "srd/int", label: "Intelligence", short: "INT" },
	{ id: "srd/wis", label: "Wisdom", short: "WIS" },
	{ id: "srd/cha", label: "Charisma", short: "CHA" },
] as const;

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

/** A plausible spread per class: highest score on the primary ability. */
export function recommendedScores(classId: string): number[] {
	const order: Record<string, number[]> = {
		barbarian: [15, 13, 14, 8, 12, 10],
		bard: [8, 14, 13, 10, 12, 15],
		cleric: [14, 8, 13, 10, 15, 12],
		druid: [8, 12, 14, 13, 15, 10],
		fighter: [15, 14, 13, 8, 12, 10],
		monk: [10, 15, 13, 8, 14, 12],
		paladin: [15, 10, 13, 8, 12, 14],
		ranger: [12, 15, 13, 8, 14, 10],
		rogue: [8, 15, 13, 14, 12, 10],
		sorcerer: [8, 13, 14, 10, 12, 15],
		warlock: [8, 13, 14, 12, 10, 15],
		wizard: [8, 13, 14, 15, 12, 10],
	};
	return order[classId] ?? STANDARD_ARRAY;
}

const ITEM_ART: Record<string, string> = {
	"Chain Mail": "chain-mail",
	Longsword: "longsword",
	Shield: "shield",
	Backpack: "backpack",
	"Leather Armor": "leather-armor",
	Shortbow: "shortbow",
	"Arrows (20)": "arrows-20",
	Shortsword: "shortsword",
	Dagger: "dagger",
	"Thieves' Tools": "thieves-tools",
	Quarterstaff: "quarterstaff",
	Torch: "torch",
	Rations: "rations",
	Rope: "rope",
};

export function itemArt(name: string): string | undefined {
	const slug = ITEM_ART[name];
	return slug ? art("item", slug) : undefined;
}

// --- The invented place ---------------------------------------------------

export type SceneThing = {
	id: string;
	name: string;
	kind: "person" | "thing" | "exit";
	note: string;
	/** Position on the scene stage, in percent. */
	x: number;
	y: number;
	art?: string;
	/** Niche ids the world reports on this target; the client pairs actions by them. */
	niches: string[];
};

export const sceneThings: SceneThing[] = [
	{
		id: "warden",
		name: "Warden Hale",
		kind: "person",
		note: "Keeps the ledger by the fire",
		x: 30,
		y: 42,
		art: art("creature", "noble"),
		niches: ["speakable", "creature"],
	},
	{
		id: "acolyte",
		name: "Sister Brenna",
		kind: "person",
		note: "Tends a bandaged arm",
		x: 62,
		y: 34,
		art: art("creature", "priest-acolyte"),
		niches: ["speakable", "creature"],
	},
	{
		id: "porter",
		name: "A tired porter",
		kind: "person",
		note: "Half asleep over a mug",
		x: 74,
		y: 66,
		art: art("creature", "commoner"),
		niches: ["speakable", "creature"],
	},
	{
		id: "chest",
		name: "Iron-bound chest",
		kind: "thing",
		note: "Against the north wall",
		x: 46,
		y: 20,
		art: art("item", "backpack"),
		niches: ["container", "object"],
	},
	{
		id: "cellar",
		name: "Cellar door",
		kind: "exit",
		note: "Scratching sounds below",
		x: 14,
		y: 76,
		niches: ["exit"],
	},
	{
		id: "road",
		name: "Road outside",
		kind: "exit",
		note: "The way back to the road",
		x: 90,
		y: 20,
		niches: ["exit"],
	},
];

/**
 * "My actions", as the world lists them: no target attached (ADR-0141 D-1).
 * `niche` is what the client pairs against a target's niches. Pairing is a
 * ranking, not an eligibility claim: the world answers the attempt.
 */
export type MockAction = {
	id: string;
	label: string;
	niche: string;
	/** Economy channel this spends in a fight, when known. */
	channel?: "action" | "bonus";
	/** Range in cells; 1 = adjacent. */
	range?: number;
	artKind?: ArtKind;
	artSlug?: string;
};

export const exploreActions: MockAction[] = [
	{ id: "talk", label: "Talk", niche: "speakable" },
	{ id: "look", label: "Look closer", niche: "object" },
	{ id: "look-creature", label: "Look closer", niche: "creature" },
	{ id: "open", label: "Open", niche: "container" },
	{ id: "attack", label: "Attack", niche: "creature" },
	{ id: "go", label: "Go there", niche: "exit" },
];
