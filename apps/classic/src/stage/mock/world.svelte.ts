// The fixture world of the mock: a tiny scripted inn that answers like a
// world would. Nothing here talks to a server. The places and people are
// invented stand-ins for "whatever the world discloses"; only SRD names and
// SRD art are real.

import {
	ABILITIES,
	backgrounds,
	type ClassOption,
	classes,
	recommendedScores,
	species,
} from "../../demo/fixtures";
import { floorSpots, HERO_SPOT, waySpot } from "../layout";
import type {
	Answer,
	Art,
	Cell,
	Fight,
	Flash,
	Gap,
	Hero,
	Line,
	LineKind,
	MapPlace,
	Offer,
	OutlineStep,
	PackItem,
	Round,
	Stage,
	Thing,
	World,
} from "../model";
import { itemSprite, sprite } from "./art";
import { backdrops } from "./backdrops";

// --- Fixtures ---------------------------------------------------------------

type PlaceId = "threshold" | "attic" | "taproom" | "cellar" | "yard";

type WayFixture = { to: PlaceId | "road"; direction: string; toName: string; gate?: string };

const PLACES: Record<
	PlaceId,
	{ name: string; description: string; ways: WayFixture[]; map?: { x: number; y: number } }
> = {
	threshold: {
		name: "The Threshold",
		description: "A disc of pale stone under a sky without a ground. A lit arch waits.",
		ways: [],
	},
	attic: {
		name: "Attic Room",
		description: "A narrow room under the roof. Moonlight falls through a small window.",
		ways: [{ to: "taproom", direction: "down", toName: "Taproom" }],
		map: { x: 100, y: 22 },
	},
	taproom: {
		name: "Taproom",
		description: "A low room, warm from the hearth. It smells of stew and wet wool.",
		ways: [
			{ to: "attic", direction: "up", toName: "Attic Room" },
			{ to: "cellar", direction: "down", toName: "Cellar", gate: "hatch" },
			{ to: "yard", direction: "south", toName: "Yard" },
		],
		map: { x: 100, y: 60 },
	},
	cellar: {
		name: "Cellar",
		description: "Cold stone and old barrels. Something scratches in the dark.",
		ways: [{ to: "taproom", direction: "up", toName: "Taproom" }],
		map: { x: 100, y: 98 },
	},
	yard: {
		name: "Yard",
		description: "Packed earth between the inn and its wall. The night is clear.",
		ways: [
			{ to: "taproom", direction: "north", toName: "Taproom" },
			{ to: "road", direction: "east", toName: "Road", gate: "gate" },
		],
		map: { x: 164, y: 60 },
	},
};

const ROAD = { id: "road", name: "Road", x: 196, y: 60 };

const SCORE_SPREADS = [
	{ id: "recommended", label: "The spread your calling favours", scores: null as number[] | null },
	{ id: "sturdy", label: "Sturdy", scores: [14, 13, 15, 8, 12, 10] },
	{ id: "nimble", label: "Nimble", scores: [10, 15, 14, 8, 13, 12] },
	{ id: "bright", label: "Bright", scores: [8, 13, 12, 15, 14, 10] },
];

const WEAPONS: Record<string, { die: number; label: string }> = {
	Longsword: { die: 8, label: "Longsword" },
	Shortsword: { die: 6, label: "Shortsword" },
	Quarterstaff: { die: 6, label: "Quarterstaff" },
	Dagger: { die: 4, label: "Dagger" },
};

const TAM_SAYS = [
	"They say the road east is barred since the last moon.",
	"Marta waters the ale. Do not tell her I said so.",
	"I heard scratching under the floor all night.",
];

const GAPS: Gap[] = [
	{
		id: "picture",
		where: "Scene",
		text: "The scene pictures are stand-ins drawn for this mock. The channel exists (place.art), but no adventure sends a picture of a place yet. Switch them off to see the plain stage the app draws by itself.",
		bead: "sk-jay0.1.76.14.8",
	},
	{
		id: "position",
		where: "Scene",
		text: "The world sends no position inside a place and no hotspot on a picture. The app puts ways out where their direction says and spreads everything else over the floor.",
	},
	{
		id: "outline",
		where: "Hero creation",
		text: "The steps on the top line, the picks left and back/forward are the machine side of a guided talk. The world does not send them yet.",
		bead: "sk-jay0.1.76.13.7",
	},
	{
		id: "reach",
		where: "Fight",
		text: "The world sends no reachable cells and no weapon reach. The app shades nothing; a click asks, the world answers.",
		bead: "sk-jay0.1.76.15.3",
	},
	{
		id: "journey",
		where: "Walking",
		text: "A walk to a neighbour place is instant here. Live it opens a journey of several ticks.",
		bead: "sk-jay0.1.76.14.9",
	},
	{
		id: "pack-art",
		where: "Pack",
		text: "The pack list carries names only. A picture and the offers arrive with the item detail, one item at a time.",
	},
	{
		id: "use",
		where: "Pack",
		text: '"Drink" on the potion is invented. No adventure has an equip or use action that fits an item yet.',
		bead: "sk-jay0.1.76.16.1",
	},
	{
		id: "replies",
		where: "Talk",
		text: "Free speech gets a canned line here. Live the person's own mind answers, after a moment.",
	},
];

// --- Small helpers ----------------------------------------------------------

function mod(score: number): number {
	return Math.floor((score - 10) / 2);
}

function d(sides: number): number {
	return 1 + Math.floor(Math.random() * sides);
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function offer(id: string, label: string, sentence: string, lead = true): Offer {
	return { id, label, sentence, lead };
}

type JournalEntry = { step: string; answerId: string; label: string };

type Rat = { id: string; name: string; col: number; row: number; hp: number };

const GRID = { cols: 9, rows: 4, x: 24, y: 158, w: 48, h: 27 };

function cellSpot(col: number, row: number): { x: number; y: number } {
	return { x: GRID.x + col * GRID.w + GRID.w / 2, y: GRID.y + row * GRID.h + GRID.h - 5 };
}

// --- The world --------------------------------------------------------------

export class MockWorld implements World {
	readonly mock = true;
	/** Mock switch: draw the stand-in pictures, or the plain stage of today. */
	pictures = $state(true);

	#phase = $state<"creation" | "world">("creation");
	#journal = $state<JournalEntry[]>([]);
	#redo = $state<JournalEntry[]>([]);
	#placeId = $state<PlaceId>("threshold");
	#lines = $state<Line[]>([]);
	#flashes = $state<Flash[]>([]);
	#busy = $state<{ text: string; stoppable: boolean } | null>(null);
	#partner = $state<string | null>(null);
	#refusals = $state<Record<string, string>>({});
	#visited = $state<PlaceId[]>([]);
	#flags = $state({
		chestOpen: false,
		quest: "unasked" as "unasked" | "asked" | "taken" | "declined" | "paid",
		ratsDead: false,
		barrelSearched: false,
		tam: 0,
	});
	#hp = $state(10);
	#xp = $state(0);
	#items = $state<{ name: string; quantity: number; worn?: string }[]>([]);
	#fight = $state<{
		round: number;
		myTurn: boolean;
		hero: { col: number; row: number };
		rats: Rat[];
		steps: number;
		action: number;
	} | null>(null);

	#nextId = 1;
	#stopAsked = false;

	constructor() {
		this.#tell("story", PLACES.threshold.description);
		this.#tell("speech", "So. Another one comes to the arch.", "The Keeper", "keeper");
	}

	/** Mock shortcut: skip hero creation with a ready-made hero. */
	skipCreation(): void {
		const pick = (step: string, answerId: string, label: string) =>
			this.#journal.push({ step, answerId, label });
		pick("class", "fighter", "Fighter");
		pick("species", "dwarf", "Dwarf");
		pick("background", "soldier", "Soldier");
		pick("scores", "recommended", "The spread your calling favours");
		pick("skills", "Athletics", "Athletics");
		pick("skills", "Perception", "Perception");
		pick("kit", "a", "Chain Mail");
		pick("name", "Borin", "Borin");
		this.#enterWorld();
	}

	// --- Draft and hero -------------------------------------------------------

	#picked(step: string): JournalEntry[] {
		return this.#journal.filter((entry) => entry.step === step);
	}

	get #class(): ClassOption | undefined {
		const id = this.#picked("class")[0]?.answerId;
		return classes.find((entry) => entry.id === id);
	}

	get #scores(): number[] {
		const id = this.#picked("scores")[0]?.answerId;
		const spread = SCORE_SPREADS.find((entry) => entry.id === id);
		return spread?.scores ?? recommendedScores(this.#class?.id ?? "fighter");
	}

	get #name(): string {
		return this.#picked("name")[0]?.label ?? "";
	}

	get #hpMax(): number {
		const die = Number(this.#class?.facts?.[0]?.replace(/\D/g, "") ?? 8);
		return Math.max(1, die + mod(this.#scores[2] ?? 10));
	}

	get #ac(): number {
		const dex = mod(this.#scores[1] ?? 10);
		const has = (name: string) => this.#items.some((item) => item.name === name);
		const body = has("Chain Mail") ? 16 : has("Leather Armor") ? 11 + dex : 10 + dex;
		return body + (has("Shield") ? 2 : 0);
	}

	get #weapon(): { die: number; label: string } {
		for (const item of this.#items) {
			const weapon = WEAPONS[item.name];
			if (weapon) return weapon;
		}
		return { die: 4, label: "Fist" };
	}

	get #heroArt(): Art | undefined {
		return this.#class ? sprite("character_portrait", this.#class.id) : undefined;
	}

	get #hero(): Hero {
		const scores = this.#scores;
		const calling = [
			this.#picked("species")[0]?.label,
			this.#class?.label,
			this.#picked("background")[0] ? `(${this.#picked("background")[0]?.label})` : undefined,
		]
			.filter(Boolean)
			.join(" ");
		return {
			name: this.#name || "A shape without a name",
			calling,
			art: this.#heroArt,
			hp: this.#phase === "world" ? this.#hp : this.#hpMax,
			hpMax: this.#hpMax,
			ac: this.#ac,
			xp: this.#xp,
			level: 1,
			abilities: ABILITIES.map((ability, index) => ({
				id: ability.id,
				label: ability.label,
				score: scores[index] ?? 10,
				modifier: mod(scores[index] ?? 10),
			})),
			skills: this.#picked("skills").map((entry) => entry.label),
			conditions: [],
			drafting: this.#phase === "creation",
		};
	}

	// --- Hero creation: a guided talk with the Keeper -------------------------

	#creationStep(): string {
		const cls = this.#class;
		if (!cls) return "class";
		if (!this.#picked("species").length) return "species";
		if (!this.#picked("background").length) return "background";
		if (!this.#picked("scores").length) return "scores";
		if (this.#picked("skills").length < cls.skillCount) return "skills";
		if (!this.#picked("kit").length) return "kit";
		if (!this.#picked("name").length) return "name";
		return "confirm";
	}

	#outline(current: string): OutlineStep[] {
		const steps: [string, string][] = [
			["class", "Calling"],
			["species", "Kin"],
			["background", "Past"],
			["scores", "Strengths"],
			["skills", "Skills"],
			["kit", "Kit"],
			["name", "Name"],
		];
		return steps.map(([id, label]) => ({
			id,
			label,
			value:
				this.#picked(id)
					.map((entry) => entry.label)
					.join(", ") || undefined,
			current: id === current,
		}));
	}

	#creationRound(): Round {
		const step = this.#creationStep();
		const cls = this.#class;
		const base = {
			id: `creation/${step}/${this.#journal.length}`,
			speakerId: "keeper",
			speakerName: "The Keeper",
			freeSpeech: false,
			outline: this.#outline(step),
			canBack: this.#journal.length > 0,
			canForward: this.#redo.length > 0,
		};
		const plain = (
			entries: { id: string; label: string; blurb: string; facts?: string[] }[],
			ref: string,
		): Answer[] =>
			entries.map((entry) => ({
				id: entry.id,
				label: entry.label,
				blurb: entry.blurb,
				facts: entry.facts,
				ref: `srd/${ref}/${entry.id}`,
			}));
		switch (step) {
			case "class":
				return {
					...base,
					question: "Before you pass: what is your calling?",
					answers: classes.map((entry) => ({
						id: entry.id,
						label: entry.label,
						blurb: entry.blurb,
						facts: entry.facts,
						art: sprite("character_portrait", entry.id),
						ref: `srd/class/${entry.id}`,
					})),
				};
			case "species":
				return {
					...base,
					question: "And your kin? Who are your people?",
					answers: plain(species, "species"),
				};
			case "background":
				return {
					...base,
					question: "What were you, before the road?",
					answers: plain(backgrounds, "background"),
				};
			case "scores":
				return {
					...base,
					question: "Where does your strength lie?",
					answers: SCORE_SPREADS.map((spread) => {
						const scores = spread.scores ?? recommendedScores(cls?.id ?? "fighter");
						return {
							id: spread.id,
							label: spread.label,
							facts: ABILITIES.map((ability, index) => `${ability.short} ${scores[index]}`),
						};
					}),
				};
			case "skills": {
				const taken = this.#picked("skills").map((entry) => entry.answerId);
				return {
					...base,
					question: "What have you learned to do well?",
					picksLeft: (cls?.skillCount ?? 0) - taken.length,
					answers: (cls?.skills ?? [])
						.filter((skill) => !taken.includes(skill))
						.map((skill) => ({ id: skill, label: skill })),
				};
			}
			case "kit":
				return {
					...base,
					question: "You may carry one bundle through the arch. Which?",
					answers: (cls?.kits ?? []).map((kit) => ({
						id: kit.id,
						label: kit.items[0] ?? kit.label,
						blurb: kit.items.join(", "),
						art: itemSprite(kit.items[0] ?? ""),
					})),
				};
			case "name":
				return {
					...base,
					question: "Last: by what name shall the world know you?",
					answers: [],
					input: { label: "Your name", placeholder: "Speak your name", maxLength: 40 },
				};
			default:
				return {
					...base,
					question: `Then go, ${this.#name}. The world is on the other side.`,
					answers: [{ id: "enter", label: "Step through the arch" }],
				};
		}
	}

	#enterWorld(): void {
		const kit = this.#class?.kits.find((entry) => entry.id === this.#picked("kit")[0]?.answerId);
		this.#items = (kit?.items ?? []).map((name) => ({ name, quantity: 1 }));
		this.#hp = this.#hpMax;
		this.#phase = "world";
		this.#partner = null;
		this.#arrive("attic");
		this.#tell("story", "The light takes you. You wake under a roof, on a bed that is not yours.");
	}

	// --- Places ---------------------------------------------------------------

	#arrive(place: PlaceId): void {
		this.#placeId = place;
		this.#partner = null;
		if (!this.#visited.includes(place)) this.#visited.push(place);
		this.#tell("story", `${PLACES[place].name}. ${PLACES[place].description}`);
		if (place === "taproom" && this.#flags.quest === "unasked") {
			this.#flags.quest = "asked";
			this.#tell(
				"speech",
				"You there, upstairs guest. A word, if you have one to spare.",
				"Marta",
				"marta",
			);
		}
		if (place === "cellar" && !this.#flags.ratsDead) this.#startFight();
	}

	#withRefusals(thingId: string, offers: Offer[]): Offer[] {
		return offers.map((entry) => {
			const refused = this.#refusals[`${thingId}:${entry.id}`];
			return refused ? { ...entry, refused } : entry;
		});
	}

	#things(): Thing[] {
		const place = this.#placeId;
		const things: Thing[] = [];
		const add = (thing: Omit<Thing, "x" | "y" | "conditions"> & { conditions?: string[] }) =>
			things.push({
				x: 0,
				y: 0,
				conditions: [],
				...thing,
				offers: this.#withRefusals(thing.id, thing.offers),
			});

		if (place === "threshold") {
			add({
				id: "keeper",
				kind: "person",
				name: "The Keeper",
				note: "Robed, patient, older than the stone.",
				art: sprite("creature", "priest-acolyte"),
				offers: [],
				asks: true,
			});
		}
		if (place === "attic") {
			add({
				id: "chest",
				kind: "thing",
				name: this.#flags.chestOpen ? "Open chest" : "Chest",
				note: "Iron-bound, at the foot of the bed.",
				offers: [
					offer("open", "Open", "Open the chest"),
					offer("look", "Look", "Look at the chest"),
					offer("push", "Push", "Push the chest", false),
					offer("attack", "Attack", "Attack the chest", false),
				],
			});
		}
		if (place === "taproom") {
			add({
				id: "marta",
				kind: "person",
				name: "Marta",
				note: "The innkeeper. Flour on her sleeves.",
				art: sprite("creature", "commoner"),
				asks:
					this.#flags.quest === "asked" || (this.#flags.quest === "taken" && this.#flags.ratsDead),
				answerWith: "talk",
				offers: [
					offer("talk", "Talk", "Talk to Marta"),
					offer("look", "Look", "Look at Marta"),
					offer("attack", "Attack", "Attack Marta", false),
				],
			});
			add({
				id: "tam",
				kind: "person",
				name: "Old Tam",
				note: "A guest who has been here longer than the benches.",
				art: sprite("creature", "noble"),
				offers: [
					offer("talk", "Talk", "Talk to Old Tam"),
					offer("look", "Look", "Look at Old Tam"),
					offer("attack", "Attack", "Attack Old Tam", false),
				],
			});
			add({
				id: "hearth",
				kind: "thing",
				name: "Hearth",
				offers: [
					offer("look", "Look", "Look into the hearth"),
					offer("warm", "Warm up", "Warm yourself at the hearth"),
				],
			});
		}
		if (place === "cellar" && !this.#fight) {
			add({
				id: "barrel",
				kind: "thing",
				name: "Barrel",
				note: "One of many. This one stands apart.",
				offers: [
					offer("search", "Search", "Search the barrel"),
					offer("look", "Look", "Look at the barrel"),
				],
			});
		}
		if (place === "yard") {
			add({
				id: "well",
				kind: "thing",
				name: "Well",
				offers: [
					offer("look", "Look", "Look into the well"),
					offer("draw", "Draw water", "Draw water from the well"),
				],
			});
		}

		const spots = floorSpots(things.map((thing) => thing.id));
		for (const thing of things) Object.assign(thing, spots.get(thing.id));

		// The hero is a thing too: the one the player perceives the world from.
		const hero = this.#hero;
		const fight = this.#fight;
		const heroSpot = fight ? cellSpot(fight.hero.col, fight.hero.row) : HERO_SPOT;
		things.push({
			id: "self",
			kind: "self",
			name: hero.name,
			art: hero.art,
			...heroSpot,
			conditions: [],
			offers: [],
			hp: hero.drafting ? undefined : { now: hero.hp, max: hero.hpMax },
		});

		if (fight) {
			for (const rat of fight.rats) {
				things.push({
					id: rat.id,
					kind: "creature",
					name: rat.name,
					art: sprite("creature", "giant-rat"),
					...cellSpot(rat.col, rat.row),
					conditions: rat.hp <= 0 ? ["dead"] : [],
					offers:
						rat.hp <= 0
							? []
							: this.#withRefusals(rat.id, [
									offer(
										"attack",
										`Attack (${this.#weapon.label})`,
										`Attack ${rat.name} with the ${this.#weapon.label}`,
									),
									offer("look", "Look", `Look at ${rat.name}`),
									offer("shove", "Shove", `Shove ${rat.name}`, false),
									offer("talk", "Talk", `Talk to ${rat.name}`, false),
								]),
				});
			}
		}

		const seen = new Map<string, number>();
		let loose = 0;
		for (const way of PLACES[place].ways) {
			const count = seen.get(way.direction) ?? 0;
			seen.set(way.direction, count + 1);
			const id = `way:${way.to}`;
			things.push({
				id,
				kind: "way",
				name: way.toName,
				...waySpot(way.direction, count, loose),
				conditions: [],
				offers: this.#withRefusals(id, [
					offer("go", "Go", `Go ${way.direction} to the ${way.toName}`),
				]),
				way: { direction: way.direction, toName: way.toName, gate: way.gate },
			});
			if (!["north", "south", "east", "west", "up", "down"].includes(way.direction)) loose += 1;
		}
		return things;
	}

	// --- Talk -----------------------------------------------------------------

	#talk(): Round | null {
		if (this.#phase === "creation") return this.#creationRound();
		const partner = this.#partner;
		if (partner === "marta") {
			const base = { speakerId: "marta", speakerName: "Marta", freeSpeech: true };
			if (this.#flags.quest === "asked")
				return {
					...base,
					id: "marta/rats",
					question: "Rats in my cellar, big as cats. Will you see to them?",
					answers: [
						{ id: "yes", label: "I will see to them." },
						{ id: "pay", label: "What does it pay?" },
						{ id: "no", label: "Not my trouble." },
					],
				};
			if (this.#flags.quest === "taken" && this.#flags.ratsDead)
				return {
					...base,
					id: "marta/done",
					question: "You are back. And? Is it quiet down there?",
					answers: [{ id: "done", label: "The rats are dead." }],
				};
			return { ...base, id: "marta/free", answers: [] };
		}
		if (partner === "tam")
			return {
				id: "tam/free",
				speakerId: "tam",
				speakerName: "Old Tam",
				freeSpeech: true,
				answers: [],
			};
		return null;
	}

	// --- Fight ----------------------------------------------------------------

	#startFight(): void {
		this.#fight = {
			round: 1,
			myTurn: true,
			hero: { col: 1, row: 2 },
			rats: [
				{ id: "rat-1", name: "Giant Rat", col: 6, row: 1, hp: 7 },
				{ id: "rat-2", name: "Second Giant Rat", col: 7, row: 3, hp: 7 },
			],
			steps: 6,
			action: 1,
		};
		this.#tell("story", "Two giant rats turn from a split sack. They do not run.");
		this.#tell("result", "A fight begins. It is your turn.");
	}

	#fightView(): Fight | null {
		const fight = this.#fight;
		if (!fight) return null;
		const taken = new Set([
			`${fight.hero.col}:${fight.hero.row}`,
			...fight.rats.filter((rat) => rat.hp > 0).map((rat) => `${rat.col}:${rat.row}`),
		]);
		const cells: Cell[] = [];
		for (let row = 0; row < GRID.rows; row += 1)
			for (let col = 0; col < GRID.cols; col += 1)
				if (!taken.has(`${col}:${row}`))
					cells.push({ col, row, x: GRID.x + col * GRID.w, y: GRID.y + row * GRID.h });
		const hero = this.#hero;
		return {
			round: fight.round,
			myTurn: fight.myTurn,
			roster: [
				{
					id: "self",
					name: hero.name,
					art: hero.art,
					mine: true,
					active: fight.myTurn,
					down: false,
				},
				...fight.rats.map((rat, index) => ({
					id: rat.id,
					name: rat.name,
					art: sprite("creature", "giant-rat"),
					mine: false,
					active: !fight.myTurn && index === 0,
					down: rat.hp <= 0,
				})),
			],
			budget: [
				{ id: "action", label: "Action", left: fight.action, of: 1 },
				{ id: "move", label: "Steps", left: fight.steps, of: 6 },
			],
			cells,
			cellSize: { w: GRID.w, h: GRID.h },
		};
	}

	#flash(thingId: string, text: string, tone: Flash["tone"]): void {
		const id = this.#nextId++;
		this.#flashes.push({ id, thingId, text, tone });
		setTimeout(() => {
			this.#flashes = this.#flashes.filter((flash) => flash.id !== id);
		}, 1400);
	}

	async #attack(ratId: string): Promise<void> {
		const fight = this.#fight;
		const rat = fight?.rats.find((entry) => entry.id === ratId);
		if (!fight || !rat) return;
		if (!fight.myTurn) return this.#refuse(ratId, "attack", "It is not your turn.");
		if (fight.action < 1)
			return this.#refuse(ratId, "attack", "You have no action left this turn.");
		const far =
			Math.max(Math.abs(rat.col - fight.hero.col), Math.abs(rat.row - fight.hero.row)) > 1;
		if (far) return this.#refuse(ratId, "attack", `${rat.name} is out of your reach.`);
		fight.action -= 1;
		const scores = this.#scores;
		const bonus = 2 + Math.max(mod(scores[0] ?? 10), mod(scores[1] ?? 10));
		const roll = d(20);
		const weapon = this.#weapon;
		if (roll + bonus >= 12) {
			const harm = Math.max(1, d(weapon.die) + bonus - 2);
			rat.hp -= harm;
			this.#flash(ratId, `-${harm}`, "harm");
			this.#tell(
				"roll",
				`${weapon.label}: ${roll} + ${bonus} = ${roll + bonus}, a hit for ${harm}.`,
				undefined,
				ratId,
			);
			if (rat.hp <= 0) this.#tell("story", `${rat.name} falls and lies still.`);
		} else {
			this.#flash(ratId, "miss", "plain");
			this.#tell(
				"roll",
				`${weapon.label}: ${roll} + ${bonus} = ${roll + bonus}, a miss.`,
				undefined,
				ratId,
			);
		}
		if (fight.rats.every((entry) => entry.hp <= 0)) {
			await pause(900);
			this.#fight = null;
			this.#flags.ratsDead = true;
			this.#xp += 50;
			this.#tell("story", "The cellar is quiet.");
			this.#tell("result", "The fight is over. You gain 50 XP.");
		}
	}

	async #ratsTurn(): Promise<void> {
		const fight = this.#fight;
		if (!fight) return;
		fight.myTurn = false;
		for (const rat of fight.rats) {
			if (rat.hp <= 0 || !this.#fight) continue;
			await pause(650);
			for (let step = 0; step < 6; step += 1) {
				const dc = fight.hero.col - rat.col;
				const dr = fight.hero.row - rat.row;
				if (Math.max(Math.abs(dc), Math.abs(dr)) <= 1) break;
				const col = rat.col + Math.sign(dc);
				const row = rat.row + Math.sign(dr);
				const blocked = fight.rats.some(
					(other) => other !== rat && other.hp > 0 && other.col === col && other.row === row,
				);
				if (blocked) break;
				rat.col = col;
				rat.row = row;
				await pause(110);
			}
			if (Math.max(Math.abs(fight.hero.col - rat.col), Math.abs(fight.hero.row - rat.row)) > 1) {
				this.#tell("story", `${rat.name} scurries closer.`);
				continue;
			}
			const roll = d(20);
			if (roll + 4 >= this.#ac) {
				const harm = d(4) + 1;
				this.#hp = Math.max(0, this.#hp - harm);
				this.#flash("self", `-${harm}`, "harm");
				this.#tell(
					"roll",
					`${rat.name} bites: ${roll} + 4 = ${roll + 4}, a hit for ${harm}.`,
					undefined,
					"self",
				);
			} else {
				this.#flash("self", "miss", "plain");
				this.#tell(
					"roll",
					`${rat.name} bites: ${roll} + 4 = ${roll + 4}, a miss.`,
					undefined,
					"self",
				);
			}
			if (this.#hp <= 0) {
				await pause(900);
				this.#fight = null;
				this.#hp = Math.ceil(this.#hpMax / 2);
				this.#tell("story", "The dark closes over you.");
				this.#arrive("attic");
				this.#tell("story", "You wake in the attic bed. Somebody has bound your wounds.");
				return;
			}
		}
		await pause(400);
		fight.round += 1;
		fight.myTurn = true;
		fight.steps = 6;
		fight.action = 1;
		this.#tell("result", `Round ${fight.round}. It is your turn.`);
	}

	// --- Story ----------------------------------------------------------------

	#tell(kind: LineKind, text: string, who?: string, thingId?: string): void {
		this.#lines.push({ id: this.#nextId++, kind, text, who, thingId });
		if (this.#lines.length > 200) this.#lines.splice(0, this.#lines.length - 200);
	}

	#refuse(thingId: string, offerId: string, sentence: string): void {
		this.#refusals[`${thingId}:${offerId}`] = sentence;
		this.#tell("refusal", sentence, undefined, thingId);
	}

	#forget(thingId: string): void {
		for (const key of Object.keys(this.#refusals))
			if (key.startsWith(`${thingId}:`)) delete this.#refusals[key];
	}

	#give(name: string, quantity = 1): void {
		const have = this.#items.find((item) => item.name === name);
		if (have) have.quantity += quantity;
		else this.#items.push({ name, quantity });
	}

	#pack(): PackItem[] {
		return this.#items.map((item) => {
			const id = `item:${item.name}`;
			const offers = [offer("look", "Look", `Look at the ${item.name}`)];
			if (item.name === "Potion of Healing")
				offers.unshift(offer("drink", "Drink", "Drink the Potion of Healing"));
			return {
				id,
				name: item.name,
				quantity: item.quantity,
				worn: item.worn,
				art: itemSprite(item.name),
				offers: this.#withRefusals(id, offers),
			};
		});
	}

	// --- The stage ------------------------------------------------------------

	#stage = $derived.by((): Stage => {
		const place = PLACES[this.#placeId];
		const known = new Set<string>(this.#visited);
		for (const id of this.#visited) for (const way of PLACES[id].ways) known.add(way.to);
		const mapPlaces: MapPlace[] = (Object.keys(PLACES) as PlaceId[])
			.filter((id) => PLACES[id].map && known.has(id))
			.map((id) => ({
				id,
				name: PLACES[id].name,
				...(PLACES[id].map ?? { x: 0, y: 0 }),
				known: this.#visited.includes(id),
			}));
		if (known.has("road")) mapPlaces.push({ ...ROAD, known: false });
		const routes: { from: string; to: string }[] = [];
		for (const id of this.#visited)
			for (const way of PLACES[id].ways)
				if (!routes.some((route) => route.from === way.to && route.to === id))
					routes.push({ from: id, to: way.to });
		return {
			place: {
				id: this.#placeId,
				name: place.name,
				description: place.description,
				art: this.pictures ? { url: backdrops[this.#placeId] ?? "", pixel: true } : undefined,
			},
			things: this.#things(),
			hero: this.#hero,
			talk: this.#talk(),
			lines: this.#lines,
			flashes: this.#flashes,
			fight: this.#fightView(),
			busy: this.#busy,
			pack: this.#phase === "world" ? this.#pack() : [],
			map: {
				here: this.#placeId,
				sheets: [{ id: "inn", title: "The inn", places: mapPlaces, routes }],
			},
			gaps: GAPS,
		};
	});

	get stage(): Stage {
		return this.#stage;
	}

	// --- The port -------------------------------------------------------------

	async #run<T>(text: string, work: () => Promise<T> | T, wait = 320): Promise<T | undefined> {
		if (this.#busy) return undefined;
		this.#busy = { text, stoppable: false };
		try {
			await pause(wait);
			return await work();
		} finally {
			this.#busy = null;
		}
	}

	async attempt(thingId: string, offerId: string): Promise<void> {
		const sentence =
			[...this.stage.things, ...this.stage.pack]
				.find((thing) => thing.id === thingId)
				?.offers.find((entry) => entry.id === offerId)?.sentence ?? "You try";
		await this.#run(`${sentence}…`, () => this.#answerAttempt(thingId, offerId));
	}

	async #answerAttempt(thingId: string, offerId: string): Promise<void> {
		const key = `${thingId}:${offerId}`;
		const flags = this.#flags;
		if (thingId.startsWith("way:")) {
			this.#go(thingId.slice(4) as PlaceId | "road");
			return;
		}
		if (thingId.startsWith("rat-")) {
			if (offerId === "attack") return this.#attack(thingId);
			if (offerId === "look")
				return this.#tell("result", "A rat the size of a dog. Yellow teeth, a torn ear.");
			if (offerId === "talk")
				return this.#refuse(thingId, offerId, "The rat has nothing to say to you.");
			return this.#refuse(thingId, offerId, "You find no hold on the rat.");
		}
		if (thingId.startsWith("item:")) {
			const name = thingId.slice(5);
			if (offerId === "drink") {
				const heal = d(4) + d(4) + 2;
				this.#hp = Math.min(this.#hpMax, this.#hp + heal);
				this.#items = this.#items.filter((item) => item.name !== name);
				this.#flash("self", `+${heal}`, "good");
				return this.#tell(
					"result",
					`You drink the potion. It tastes of iron and mint. You regain ${heal} hit points.`,
				);
			}
			return this.#tell("result", `${name}. Yours, and in good order.`);
		}
		switch (key) {
			case "chest:open":
				if (flags.chestOpen)
					return this.#refuse(thingId, offerId, "The chest stands open already.");
				flags.chestOpen = true;
				this.#forget("chest");
				this.#give("Potion of Healing");
				this.#give("Hooded Lantern");
				this.#flash("chest", "+2", "good");
				return this.#tell(
					"result",
					"The lid creaks up. Inside: a hooded lantern and a small red flask. You take both.",
				);
			case "chest:look":
				return this.#tell(
					"result",
					flags.chestOpen
						? "An empty chest. It smells of camphor."
						: "An iron-bound chest. The lock hangs open.",
				);
			case "chest:push":
				return this.#refuse(thingId, offerId, "The chest is nailed to the floor.");
			case "chest:attack":
				return this.#refuse(thingId, offerId, "You think better of it. It is somebody's chest.");
			case "marta:talk":
			case "tam:talk":
				this.#partner = thingId;
				return;
			case "marta:look":
				return this.#tell("result", "Marta. Broad hands, quick eyes, flour to the elbows.");
			case "tam:look":
				return this.#tell("result", "Old Tam. A good coat gone thin, a mug that is never empty.");
			case "marta:attack":
			case "tam:attack":
				return this.#refuse(thingId, offerId, "Not under this roof. Your hand will not do it.");
			case "hearth:look":
				return this.#tell("result", "Oak logs, burning low. A pot hangs over them.");
			case "hearth:warm":
				return this.#tell(
					"result",
					"The warmth goes into your bones. For a moment the road feels far away.",
				);
			case "barrel:look":
				return this.#tell("result", "A barrel with a loose lid.");
			case "barrel:search":
				if (flags.barrelSearched)
					return this.#refuse(thingId, offerId, "There is nothing more in the barrel.");
				flags.barrelSearched = true;
				this.#give("Gold Pieces", 4);
				this.#flash("barrel", "+4", "good");
				return this.#tell(
					"result",
					"Under the lid, in the sawdust: four gold pieces. Somebody's secret.",
				);
			case "well:look":
				return this.#tell("result", "Black water, far down. A star swims in it.");
			case "well:draw":
				return this.#refuse(thingId, offerId, "The rope has no bucket.");
			default:
				return this.#refuse(thingId, offerId, "Nothing happens.");
		}
	}

	#go(to: PlaceId | "road"): boolean {
		const id = `way:${to}`;
		if (this.#fight) {
			this.#refuse(id, "go", "You cannot leave while the rats are on you.");
			return false;
		}
		if (to === "road") {
			this.#refuse(id, "go", "The gate is barred from the other side.");
			return false;
		}
		if (to === "cellar" && this.#flags.quest !== "taken" && this.#flags.quest !== "paid") {
			this.#tell("speech", "Not without my leave. That hatch stays shut.", "Marta", "marta");
			this.#refuse(id, "go", "Marta steps in your way.");
			return false;
		}
		this.#forget(id);
		this.#arrive(to);
		return true;
	}

	async answer(roundId: string, answerId: string): Promise<void> {
		const round = this.stage.talk;
		if (!round || round.id !== roundId) return;
		const picked = round.answers.find((entry) => entry.id === answerId);
		if (!picked) return;
		await this.#run(
			"…",
			async () => {
				if (this.#phase === "creation") {
					const step = this.#creationStep();
					if (step === "confirm") return this.#enterWorld();
					this.#journal.push({ step, answerId, label: picked.label });
					this.#redo = [];
					return;
				}
				this.#tell("mine", picked.label, this.#hero.name, "self");
				await pause(500);
				if (roundId === "marta/rats") {
					if (answerId === "pay") {
						this.#tell(
							"speech",
							"Ten gold when it is quiet down there. Not a copper before.",
							"Marta",
							"marta",
						);
					} else if (answerId === "yes") {
						this.#flags.quest = "taken";
						this.#forget("way:cellar");
						this.#tell(
							"speech",
							"Good. The hatch is by the bar. Mind your ankles.",
							"Marta",
							"marta",
						);
					} else {
						this.#flags.quest = "declined";
						this.#tell("speech", "Then eat your stew and stay out of my cellar.", "Marta", "marta");
					}
				} else if (roundId === "marta/done") {
					this.#flags.quest = "paid";
					this.#give("Gold Pieces", 10);
					this.#xp += 25;
					this.#flash("self", "+10 gp", "good");
					this.#tell(
						"speech",
						"Bless you. Here, as promised. And the stew is on the house.",
						"Marta",
						"marta",
					);
					this.#tell("result", "You receive 10 gold pieces and 25 XP.");
				}
			},
			150,
		);
	}

	/** The fixture world asks for no numbers. */
	async fill(): Promise<void> {}

	async say(text: string): Promise<void> {
		const words = text.trim();
		const round = this.stage.talk;
		if (!words || !round) return;
		await this.#run(
			"…",
			async () => {
				if (this.#phase === "creation") {
					if (!round.input) return;
					this.#journal.push({ step: "name", answerId: words, label: words });
					this.#redo = [];
					return;
				}
				this.#tell("mine", words, this.#hero.name, "self");
				await pause(900);
				if (round.speakerId === "marta") {
					if (this.#flags.quest === "declined") {
						this.#flags.quest = "asked";
						this.#tell("speech", "Changed your mind? The rats have not.", "Marta", "marta");
					} else
						this.#tell(
							"speech",
							"Hm. Talk is cheap and I have bread in the oven.",
							"Marta",
							"marta",
						);
				} else {
					this.#tell("speech", TAM_SAYS[this.#flags.tam % TAM_SAYS.length] ?? "", "Old Tam", "tam");
					this.#flags.tam += 1;
				}
			},
			150,
		);
	}

	async back(): Promise<void> {
		const last = this.#journal.pop();
		if (last) this.#redo.push(last);
	}

	async forward(): Promise<void> {
		const next = this.#redo.pop();
		if (next) this.#journal.push(next);
	}

	async restart(): Promise<void> {
		this.#journal.length = 0;
		this.#redo.length = 0;
	}

	talkTo(thingId: string | null): void {
		if (this.#phase === "world") this.#partner = thingId;
	}

	async walkTo(placeId: string): Promise<void> {
		if (this.#busy || placeId === this.#placeId) return;
		// Breadth-first over the ways the hero has seen.
		const from = this.#placeId;
		const previous = new Map<string, string>([[from, from]]);
		const queue: string[] = [from];
		while (queue.length) {
			const at = queue.shift() as string;
			if (at === placeId) break;
			if (!(at in PLACES) || !this.#visited.includes(at as PlaceId)) continue;
			for (const way of PLACES[at as PlaceId].ways)
				if (!previous.has(way.to)) {
					previous.set(way.to, at);
					queue.push(way.to);
				}
		}
		if (!previous.has(placeId)) return;
		const route: string[] = [];
		for (let at = placeId; at !== from; at = previous.get(at) as string) route.unshift(at);
		const goal = placeId === "road" ? ROAD.name : PLACES[placeId as PlaceId].name;
		this.#stopAsked = false;
		this.#busy = { text: `Walking to the ${goal}…`, stoppable: route.length > 1 };
		try {
			for (const hop of route) {
				await pause(550);
				if (this.#stopAsked) {
					this.#tell("result", "You stop on the way.");
					break;
				}
				if (!this.#go(hop as PlaceId | "road")) break;
			}
		} finally {
			this.#busy = null;
		}
	}

	async step(col: number, row: number): Promise<void> {
		const fight = this.#fight;
		if (!fight || this.#busy) return;
		if (!fight.myTurn) return this.#tell("refusal", "It is not your turn.");
		this.#busy = { text: "You move…", stoppable: false };
		try {
			// One offered step after the other; the first refusal ends the walk.
			while (fight.hero.col !== col || fight.hero.row !== row) {
				if (fight.steps < 1) {
					this.#tell("refusal", "You have no steps left this turn.");
					break;
				}
				const next = {
					col: fight.hero.col + Math.sign(col - fight.hero.col),
					row: fight.hero.row + Math.sign(row - fight.hero.row),
				};
				if (fight.rats.some((rat) => rat.hp > 0 && rat.col === next.col && rat.row === next.row)) {
					this.#tell("refusal", "Something stands in your way.");
					break;
				}
				fight.hero = next;
				fight.steps -= 1;
				await pause(120);
			}
		} finally {
			this.#busy = null;
		}
	}

	async endTurn(): Promise<void> {
		if (!this.#fight?.myTurn || this.#busy) return;
		this.#busy = { text: "The rats move…", stoppable: false };
		try {
			this.#tell("result", "You end your turn.");
			await this.#ratsTurn();
		} finally {
			this.#busy = null;
		}
	}

	stop(): void {
		this.#stopAsked = true;
	}
}
