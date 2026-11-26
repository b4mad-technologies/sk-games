// The stage model: everything the shell draws, and the one port it acts through.
//
// The shell (`App.svelte` and the components beside it) reads a `Stage` and
// calls a `World`. It knows neither the PLAYER tools nor `PlayView`. Two
// things can stand behind the port: the fixture world of the mock
// (`mock/world.svelte.ts`) and, later, an adapter over the Play session that
// builds a `Stage` from a `PlayView` with the kept logic modules
// (`src/lib/menu.ts`, `talk.ts`, `fight.ts`, `travel.ts`, `story.ts`).
//
// Vocabulary, after Gibson (ADR-0021): a `Thing` is anything the hero can
// perceive on the stage; an `Offer` is something a thing affords. An offer is
// never a promise: the world may refuse it, and the refusal is its answer.

/** A picture. `pixel` art is scaled without smoothing. */
export type Art = { url: string; pixel: boolean };

export type Offer = {
	id: string;
	/** Short label for the tag on the thing: "Open". */
	label: string;
	/** The whole sentence for the sentence line: "Open the chest". */
	sentence: string;
	/** Lead offers hang on the thing at once; the rest fold behind "more". */
	lead: boolean;
	/** The fold a folded offer belongs to ("Checks"); none stands alone. */
	group?: string;
	/** The world's own sentence from the last refusal of this offer here. */
	refused?: string;
	/** What the action is, in the world's own words; shown while it is pointed at. */
	about?: string;
};

export type ThingKind = "self" | "person" | "creature" | "thing" | "way";

export type Thing = {
	id: string;
	kind: ThingKind;
	name: string;
	note?: string;
	art?: Art;
	/** Feet position on the stage, in stage units (480 x 270). */
	x: number;
	y: number;
	/** Condition labels the world lists for it ("dead", "prone"). */
	conditions: string[];
	offers: Offer[];
	/** Somebody asked the hero a question and waits for the answer. */
	asks?: boolean;
	/**
	 * The offer that takes the question up. A click on somebody who asks goes
	 * there at once; their other offers hang on them once the talk is open.
	 */
	answerWith?: string;
	/** Down but not dead (the hero at 0 hit points): it lies, and can still be clicked. */
	down?: boolean;
	/**
	 * In a fight, the turn order passes this one over: dead, or out of it some
	 * other way. The world does not say which; it can still be clicked.
	 */
	out?: boolean;
	/** The fold a click opens at once (the hero's own actions, down or in a fight). */
	opens?: string;
	/** A way out: where it leads, and what stands on it. */
	way?: { direction: string; toName: string; gate?: string };
	/** Hit points, where the world discloses them (the hero's own). */
	hp?: { now: number; max: number };
};

/** A form of whole numbers, each within its bounds, set by clicks. */
export type NumberForm = {
	title: string;
	submit: string;
	/** `value`: what the hero has now, where the world says and it fits. */
	fields: { name: string; label: string; min: number; max: number; value?: number }[];
};

/** One answer the speaker named for the open question. */
export type Answer = {
	id: string;
	label: string;
	blurb?: string;
	art?: Art;
	facts?: string[];
	/** Definition id for the reference guide ("srd/class/fighter"). */
	ref?: string;
	/** The public reference page of that definition, when one is known. */
	href?: string;
};

/** One entry of a guided talk's outline: a step and what was answered. */
export type OutlineStep = {
	id: string;
	label: string;
	/** Everything answered at this step, in full. */
	value?: string;
	/** The first answer alone, for a line with little room. */
	short?: string;
	/** How many more answers the step holds beyond the first. */
	more?: number;
	/** The picture of the first answer that has one. */
	art?: Art;
	current: boolean;
};

/**
 * One round of a talk: who asks, what, and which answers they named.
 * A talk without a question is free speech only (`question` unset).
 * `outline`, `picksLeft`, `canBack` and `canForward` are the machine side of a
 * guided talk (bead sk-jay0.1.76.13.7); a plain question has none of them.
 */
export type Round = {
	id: string;
	speakerId: string;
	speakerName: string;
	question?: string;
	answers: Answer[];
	/** The speaker asks for words, not a pick (the hero's name). */
	input?: { label: string; placeholder: string; maxLength: number };
	/** Numbers the speaker also takes instead of a named answer (ability scores). */
	numbers?: NumberForm;
	/** The speaker also listens to free speech. */
	freeSpeech: boolean;
	picksLeft?: number;
	outline?: OutlineStep[];
	canBack?: boolean;
	canForward?: boolean;
	/** A guided talk that can be emptied and begun again. */
	canRestart?: boolean;
};

export type LineKind = "story" | "speech" | "mine" | "result" | "refusal" | "roll";

/** One line of the story, in world order. */
export type Line = {
	id: number;
	kind: LineKind;
	text: string;
	who?: string;
	/** The thing that spoke or was acted on, for a bubble on the stage. */
	thingId?: string;
	/** Already in the story when the app opened; the scene does not replay it. */
	old?: boolean;
};

export type Fighter = {
	id: string;
	name: string;
	art?: Art;
	mine: boolean;
	active: boolean;
	down: boolean;
};

export type BudgetChip = { id: string; label: string; left: number; of: number };

export type Cell = { col: number; row: number; x: number; y: number };

export type Fight = {
	/** The round of the fight, when the world counts one. */
	round?: number;
	roster: Fighter[];
	myTurn: boolean;
	budget: BudgetChip[];
	/**
	 * What the others did since the hero's turn ended, in the world's own
	 * sentences; set only while nothing has happened since the turn came back.
	 */
	recap?: string[];
	/** Free cells of the session grid; a click on one asks the world for a step. */
	cells: Cell[];
	cellSize: { w: number; h: number };
};

export type PackItem = {
	id: string;
	name: string;
	quantity: number;
	worn?: string;
	/** How deep inside another thing it lies (a ration in a backpack: 1). */
	depth?: number;
	art?: Art;
	description?: string;
	offers: Offer[];
};

export type Hero = {
	name: string;
	/** "Dwarf Fighter, Soldier": whatever identity the world has so far. */
	calling: string;
	art?: Art;
	hp: number;
	hpMax: number;
	ac: number;
	xp: number;
	/** The experience the next level asks for, where the ruleset names it. */
	xpNext?: number;
	level: number;
	abilities: { id: string; label: string; score: number; modifier: number; about?: string }[];
	skills: string[];
	/**
	 * What the hero was last seen to have left of something that is spent (a
	 * spell slot, a use of a feature). Known only from the spending itself.
	 */
	left?: { label: string; left: number }[];
	/** The proficiency bonus, where the world discloses it. */
	proficiency?: number;
	/**
	 * What the world lists as the hero's quests: a name, how far it stands and
	 * what it is. Empty where the adventure marks no state as a quest.
	 */
	quests?: { label: string; value: string; about?: string }[];
	/**
	 * What the hero answered when somebody asked, and what was said to that:
	 * the client's own notes of the talk, newest first. No quest state.
	 */
	said?: { who: string; said: string; reply?: string }[];
	/** What the hero is (class, species, background), each in the world's words. */
	identity?: { label: string; about: string }[];
	conditions: string[];
	/** Still being made: the sheet and the pack are not there yet. */
	drafting: boolean;
};

export type MapPlace = {
	id: string;
	name: string;
	x: number;
	y: number;
	/** The hero has stood here; otherwise the place is known by name only. */
	known: boolean;
	/**
	 * No way the hero knows leads there from where they stand (a place seen
	 * through a door that has since closed, or from another area).
	 */
	cut?: boolean;
	/** Other sheets a way from here leads to. */
	doors?: { sheet: string; title: string }[];
};

/** One area of the map: its places where the world's plate puts them. */
export type MapSheet = {
	id: string;
	title: string;
	places: MapPlace[];
	routes: { from: string; to: string }[];
};

/** Everything the hero has seen, one sheet per area; the hero's own first. */
export type AreaMap = {
	here: string;
	sheets: MapSheet[];
};

/** A floating mark on a thing: damage, a miss, a find. */
export type Flash = { id: number; thingId: string; text: string; tone: "harm" | "good" | "plain" };

/** Something the mock shows that the world does not send today. */
export type Gap = { id: string; where: string; text: string; bead?: string };

export type Stage = {
	place: { id: string; name: string; description: string; art?: Art };
	things: Thing[];
	hero: Hero;
	talk: Round | null;
	lines: Line[];
	flashes: Flash[];
	fight: Fight | null;
	/** A long action is running; `stoppable` chains can be stopped between steps. */
	busy: { text: string; stoppable: boolean } | null;
	pack: PackItem[];
	map: AreaMap;
	gaps: Gap[];
	/**
	 * The world waits for the hero's reaction (an opportunity attack as a foe
	 * moves away): take it or let it pass. A fight does not go on before.
	 */
	reaction?: { name: string; about?: string };
};

/** The one port the shell acts through. Every call is an attempt. */
export interface World {
	readonly stage: Stage;
	/** The fixture world of the mock; a live world leaves it unset. */
	readonly mock?: boolean;
	/** Try an offer of a thing on the stage or of an item in the pack. */
	attempt(thingId: string, offerId: string): Promise<void>;
	/** Give one of the named answers to the open round. */
	answer(roundId: string, answerId: string): Promise<void>;
	/** Give words: an asked-for text, or free speech to the talk partner. */
	say(text: string): Promise<void>;
	/** Give the numbers the open round also takes, by field name. */
	fill(values: Record<string, number>): Promise<void>;
	/** Step back or forward in a guided talk. */
	back(): Promise<void>;
	forward(): Promise<void>;
	/** Empty a guided talk's answers and begin it again. */
	restart(): Promise<void>;
	/** Turn to somebody, or away (null). */
	talkTo(thingId: string | null): void;
	/** Walk to a place on the area map, one offered way after the other. */
	walkTo(placeId: string): Promise<void>;
	/**
	 * Look at one thing in the pack (null: at none). The pack list carries
	 * names only; what a thing is and affords arrives when it is looked at.
	 */
	inspect?(itemId: string | null): void;
	/** Ask for a step onto a cell of the fight grid. */
	step(col: number, row: number): Promise<void>;
	endTurn(): Promise<void>;
	/** Answer the open reaction window: take the reaction, or let it pass. */
	react?(take: boolean): Promise<void>;
	/** Stop a running chain between two steps. */
	stop(): void;
}
