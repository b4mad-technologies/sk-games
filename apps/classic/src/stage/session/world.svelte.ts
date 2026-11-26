// The live world behind the port: a Play session, and the little the client
// remembers beside it.
//
// The world answers through `PlayView`; `stage-from-view.ts` turns each view
// into a `Stage`. This class keeps what no view carries: what a click came
// to, the world's sentence from a refusal (per thing and offer), the loaded
// pictures and the hints while something takes time. It decides nothing
// about whether an attempt will work. It sends the attempt and shows the
// answer.

import { type DialogueGuide, utteranceFromInputValues } from "@spellkave/sdk";
import type { OpenPlaySessionArgs, PlaySessionHandle } from "../../../../play/src/lib/play-session";
import type { PlayAction, PlayView } from "../../../../play/src/lib/play-view";
import { creationModel } from "../../creation/creation";
import { fightTokens, movementLeft, observedStepCost } from "../../lib/fight";
import { inFight } from "../../lib/menu";
import { grantedDefinition } from "../../lib/srd-art";
import { speechAction } from "../../lib/talk";
import { exitTo, routeTo } from "../../lib/travel";
import { heardMark, thinkingLine, WAITING_TIMEOUT_MS, type Waiting } from "../../lib/waiting";
import type { ArtReference } from "../../lib/world-art";
import type { Stage, World } from "../model";
import {
	type Atlas,
	atlasFromJson,
	atlasGraph,
	emptyAtlas,
	readPlate,
	sameAtlas,
	withPlace,
	withPlate,
} from "./atlas";
import { cellOf, gridWindow, stepToward } from "./fight-from-view";
import {
	attemptFor,
	emptyStage,
	type LiveResult,
	needsInput,
	stageFromView,
	wantedArt,
	worldLines,
} from "./stage-from-view";
import {
	answerFor,
	answerRefs,
	isSpokenRound,
	nameForm,
	numberForm,
	openGuide,
	TALK,
} from "./talk-from-view";

export type LiveConfig = { url: string; db: string; actorId: string; token: string; slug: string };

/** Everything the live world reaches outside itself, so a test can stand in. */
export type LiveDeps = {
	open(args: OpenPlaySessionArgs): Promise<PlaySessionHandle>;
	/**
	 * How the session's last attempt came out (`rejected`, `happened`, ...),
	 * read from the session's own trail. The handle returns only the sentence.
	 */
	lastOutcome(): string | null;
	/** An SRD sprite by definition id. */
	srdArt(definitionId: string): Promise<string | undefined>;
	/** The world's own picture by reference; null without a gateway. */
	worldArt: ((art: ArtReference) => Promise<string | undefined>) | null;
	/** What the public reference guide holds on a definition id: its page and
	 * its short text, as far as the guide lists them. */
	reference(definitionRef: string): Promise<{ href?: string; about?: string } | undefined>;
	/** Where the atlas is kept between two visits; null keeps it for the page. */
	storage:
		| (Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
				/** Every key kept, where the store can list them. */
				keys?(): string[];
		  })
		| null;
	/** Released with the session. */
	close?(): void;
};

/** A walk between two places took 20 to 30 s on a local world (2026-11-14). */
export const ARRIVE_TIMEOUT_MS = 90_000;
const RESULTS_KEPT = 30;
/** A line this many world ticks behind the newest one known is not news. */
const LATE_TICKS = 3;
/** The SRD's trace of an attack that missed. */
const ATTACK_MISS = "srd/attack-miss";
/** As long as the float animation of a mark runs (`st-float` in stage.css). */
const FLASH_MS = 1500;

type StageLine = Stage["lines"][number];
/** A line of the story as the browser keeps it between two visits. */
type PastLine = Pick<StageLine, "kind" | "text" | "who">;
const PAST_KEPT = 80;
const LINE_KINDS = new Set(["story", "speech", "mine", "result", "refusal", "roll"]);

function pastKey(line: PastLine): string {
	return [line.kind, line.who ?? "", line.text].join("\n");
}

/** A stored list of strings; anything else is an empty list. */
export function stringsFromJson(json: string | null | undefined): string[] {
	try {
		const stored: unknown = JSON.parse(json ?? "[]");
		return Array.isArray(stored) ? stored.filter((entry) => typeof entry === "string") : [];
	} catch {
		return [];
	}
}

/** Stored counts by id; anything else is empty. */
export function countsFromJson(json: string | null | undefined): Record<string, number> {
	try {
		const stored: unknown = JSON.parse(json ?? "{}");
		if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
		return Object.fromEntries(
			Object.entries(stored).filter(
				(entry): entry is [string, number] => typeof entry[1] === "number",
			),
		);
	} catch {
		return {};
	}
}

/** The move tool's word for a walk it stopped watching before the arrival. */
const UNWATCHED_WALK = /\bdid not reach\b.+\bwithin \d+ ?ms\b/;

/**
 * Answers of the world that say nothing about what was tried. Alone in the
 * story they cannot be read later ("That did not work." What did not?).
 */
const SAYS_NOTHING = new Set([
	"That cannot be done right now.",
	"That did not work.",
	"The outcome could not be confirmed.",
	"Nothing you notice changes.",
]);

/** The world's answer as the story tells it: a bare one names what was tried. */
export function answerText(sentence: string, message: string): string {
	// The world labels what the hero does to themselves "... — You (Ugra)".
	// What was tried on somebody reads "Melee Attack: Cellar Rat 1"; with the
	// answer after it, one colon is enough.
	const tried = sentence.replace(/ — You \([^)]*\)$/, "").replace(": ", ", ");
	return SAYS_NOTHING.has(message.trim()) && tried ? `${tried}: ${message.trim()}` : message;
}

/**
 * What the foot line says during a walk by the map. Over several places it
 * counts them and names the next one; the last leg reads like a single step.
 */
export function walkingText(goal: string, placesToGo: number, next: string): string {
	return placesToGo > 1
		? `On the way to ${goal}: ${placesToGo} places to go, now to ${next}…`
		: `On the way to ${goal}…`;
}

/** An answer the hero gave, and what was said to it. */
type Answered = { who: string; said: string; reply?: string };
const SAID_KEPT = 24;

/** The kept answers from their stored form; anything else is none. */
export function answeredFromJson(json: string | null | undefined): Answered[] {
	try {
		const stored: unknown = JSON.parse(json ?? "[]");
		if (!Array.isArray(stored)) return [];
		return stored.flatMap((entry): Answered[] => {
			if (typeof entry !== "object" || entry === null) return [];
			const { who, said, reply } = entry as Record<string, unknown>;
			if (typeof who !== "string" || typeof said !== "string") return [];
			return [{ who, said, ...(typeof reply === "string" ? { reply } : {}) }];
		});
	} catch {
		return [];
	}
}

/** Stored names by key; anything else is empty. */
export function namesFromJson(json: string | null | undefined): Record<string, string> {
	try {
		const stored: unknown = JSON.parse(json ?? "{}");
		if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
		return Object.fromEntries(
			Object.entries(stored).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

/** The kept story from its stored form; anything else is an empty story. */
export function pastFromJson(json: string | null | undefined): PastLine[] {
	try {
		const stored: unknown = JSON.parse(json ?? "[]");
		if (!Array.isArray(stored)) return [];
		return stored.flatMap((entry): PastLine[] => {
			if (typeof entry !== "object" || entry === null) return [];
			const { kind, text, who } = entry as Record<string, unknown>;
			if (typeof kind !== "string" || !LINE_KINDS.has(kind) || typeof text !== "string") return [];
			return [
				{ kind: kind as PastLine["kind"], text, ...(typeof who === "string" ? { who } : {}) },
			];
		});
	} catch {
		return [];
	}
}

/** FNV-1a of a text, as a short key part. Not a secret, and says nothing about one. */
function fingerprint(text: string): string {
	let value = 2166136261;
	for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
	return (value >>> 0).toString(36);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Has somebody replied since `before` (a `heardMark`)? Answering a question
 * closes it, which moves the mark by itself; a reply is a new line of
 * somebody else or a question that was not open before.
 */
export function replied(before: string, view: PlayView): boolean {
	const [lastBefore = "", askedBefore = ""] = before.split("|");
	const [lastNow = "", askedNow = ""] = heardMark(view).split("|");
	const known = new Set(askedBefore.split(","));
	return lastNow !== lastBefore || askedNow.split(",").some((id) => id !== "" && !known.has(id));
}

/** The creation outline a page kept, with the answer given since; empty for anything else. */
function guideFromJson(raw: string | null | undefined): {
	guide: DialogueGuide | undefined;
	answered: string | undefined;
} {
	const none = { guide: undefined, answered: undefined };
	if (!raw) return none;
	try {
		const kept = JSON.parse(raw) as { guide?: DialogueGuide; answered?: unknown };
		const outline = kept.guide?.outline;
		const sound =
			Array.isArray(outline) &&
			outline.every(
				(entry) =>
					typeof entry?.title === "string" &&
					typeof entry.state === "string" &&
					Array.isArray(entry.answers) &&
					entry.answers.every((answer) => typeof answer?.label === "string"),
			);
		if (!sound) return none;
		return {
			guide: kept.guide,
			answered: typeof kept.answered === "string" ? kept.answered : undefined,
		};
	} catch {
		return none;
	}
}

/** How long the creation talk may stand without a question before a held-back form shows. */
const QUIET_MS = 8_000;

export class LiveWorld implements World {
	#deps: LiveDeps;
	#handle: PlaySessionHandle | null = null;
	#closed = false;

	#view = $state.raw<PlayView | null>(null);
	#status = $state("Connecting…");
	#refusals = $state<Record<string, string>>({});
	#results = $state.raw<LiveResult[]>([]);
	#art = $state<Record<string, string>>({});
	/** An attempt is with the world: nothing else is sent meanwhile. */
	#acting = $state<string | null>(null);
	/** The hero set out and has not arrived: a hint, not a lock. */
	#walking = $state<{ from: string; text: string; legs?: number } | null>(null);
	#walkTimer: ReturnType<typeof setTimeout> | undefined;
	/** Who the hero is turned to. */
	#partner = $state<string | null>(null);
	/** The last guide a guided talk sent; kept while no question is open. */
	#guide = $state.raw<DialogueGuide | undefined>(undefined);
	/** The hero spoke or answered and nobody has replied: a hint, not a lock. */
	#waiting = $state<Waiting | null>(null);
	#waitTimer: ReturnType<typeof setTimeout> | undefined;
	#hrefs = $state<Record<string, string>>({});
	#abouts = $state<Record<string, string>>({});
	/** What the open creation step was answered with; gone with the next question. */
	#answeredStep = $state<string | undefined>(undefined);
	/** No creation question has been open for `QUIET_MS`. */
	#patient = $state(false);
	#quietTimer: ReturnType<typeof setTimeout> | undefined;
	/** A creation outline is kept in the browser and is to be dropped with the draft. */
	#hadGuide = true;
	#hpSeen = $state(0);
	/** What a step on the fight grid was last seen to cost. */
	#stepCost = $state<number | null>(null);
	/** A chain of steps runs; it can be stopped between two of them. */
	#stepping = $state(false);
	#stopAsked = false;
	#askedRefs = new Set<string>();
	/** Every place this hero has seen: what the plates drew and where the ways lead. */
	#atlas = $state.raw<Atlas>(emptyAtlas());
	#atlasKey: string;
	#hpKey: string;
	#storyKey: string;
	#picksKey: string;
	#guideKey: string;
	#leftKey: string;
	#kindsKey: string;
	#metKey: string;
	#groundKey: string;
	#saidKey: string;
	/** What the hero answered when asked, and what was said to it; oldest first. */
	#said = $state.raw<Answered[]>([]);
	/** An answer just given: the asker's next sentence is the reply to it. */
	#answered: { askerId: string; heard: number } | null = null;
	/** Everybody the hero has stood beside, by entity id: a far voice keeps its name. */
	#met = $state.raw<Record<string, string>>({});
	/** What a thing of the pack is, by name, as its detail once said. */
	#kinds = $state.raw<Record<string, string>>({});
	/** Definition ids the hero answered with in the creation talk. */
	#picks = $state.raw<string[]>([]);
	/** What a spend event last said is left, by resource id. */
	#left = $state.raw<Record<string, number>>({});
	/** The story as it stood when the app was last open, from the browser's store. */
	#past = $state.raw<PastLine[]>([]);
	/** What still ran in world time at the last view: its end is worth a word. */
	#ran: string | null = null;
	/** The place the hero last stood in outside a session grid. */
	#ground = $state.raw<{ name: string; description: string } | null>(null);
	#lastPlate: string | null = null;
	/** Resolves the wait for an arrival of a walk over several places. */
	#arrival: { placeId: string; done: (arrived: boolean) => void } | null = null;

	/** Marks floating up from a thing for a moment. */
	#flashes = $state.raw<Stage["flashes"]>([]);
	#eventsSeen = new Set<string>();
	#nextFlash = 1;

	#lineIds = new Map<string, number>();
	#nextLine = 1;
	#oldBelow = $state(1);
	/** Lines the world showed late: said long before the hero came (back) here. */
	#late = $state.raw<ReadonlySet<number>>(new Set());
	/** The newest world tick a story line carried so far. */
	#tickSeen = 0;
	#nextResult = 1;
	#askedArt = new Set<string>();

	constructor(config: LiveConfig, deps: LiveDeps) {
		this.#deps = deps;
		// A staged world has its own token: a wiped and re-staged world, whose
		// new hero carries the old id, does not inherit the old hero's places.
		const hero = `${config.slug}.${config.actorId}.${fingerprint(config.token)}`;
		this.#atlasKey = `classic.atlas.${hero}`;
		this.#hpKey = `classic.hp.${hero}`;
		this.#storyKey = `classic.story.${hero}`;
		this.#picksKey = `classic.picks.${hero}`;
		this.#guideKey = `classic.guide.${hero}`;
		this.#leftKey = `classic.left.${hero}`;
		this.#kindsKey = `classic.kinds.${hero}`;
		this.#metKey = `classic.met.${hero}`;
		this.#groundKey = `classic.ground.${hero}`;
		this.#saidKey = `classic.said.${hero}`;
		try {
			this.#picks = stringsFromJson(deps.storage?.getItem(this.#picksKey));
			// The DM sends its outline only with a question: a page opened
			// between two questions would show none.
			const talk = guideFromJson(deps.storage?.getItem(this.#guideKey));
			this.#guide = talk.guide;
			this.#answeredStep = talk.answered;
			this.#left = countsFromJson(deps.storage?.getItem(this.#leftKey));
			this.#kinds = namesFromJson(deps.storage?.getItem(this.#kindsKey));
			this.#met = namesFromJson(deps.storage?.getItem(this.#metKey));
			this.#said = answeredFromJson(deps.storage?.getItem(this.#saidKey));
			// Opened in the middle of a fight, the top line read "A fight": the
			// place it is in was known only to the page that walked there.
			const ground = namesFromJson(deps.storage?.getItem(this.#groundKey));
			if (ground.name) this.#ground = { name: ground.name, description: ground.description ?? "" };
			this.#past = pastFromJson(deps.storage?.getItem(this.#storyKey));
			this.#atlas = atlasFromJson(deps.storage?.getItem(this.#atlasKey));
			this.#hpSeen = Math.max(0, Number(deps.storage?.getItem(this.#hpKey)) || 0);
			// What an earlier staging kept under the same hero id is nobody's any more.
			const kept = /^classic\.(atlas|hp|story|picks|guide|left|kinds|met|ground|said)\./;
			const mine = `.${config.slug}.${config.actorId}.`;
			for (const key of deps.storage?.keys?.() ?? []) {
				const own = [
					this.#atlasKey,
					this.#hpKey,
					this.#storyKey,
					this.#picksKey,
					this.#guideKey,
					this.#leftKey,
					this.#kindsKey,
					this.#metKey,
					this.#groundKey,
					this.#saidKey,
				].includes(key);
				if (kept.test(key) && key.includes(mine) && !own) deps.storage?.removeItem(key);
			}
		} catch {
			// Storage is blocked; the memory lasts as long as the page.
		}
		deps
			.open({
				url: config.url,
				db: config.db,
				token: config.token,
				actorId: config.actorId,
				authorizedToolRoles: ["PLAYER"],
				// The area map is a way to travel here, so it shows every floor.
				mapSlice: "all_floors_offset",
				onView: (view) => this.#onView(view),
				onError: (error) => this.#onError(error),
			})
			.then(
				(handle) => {
					if (this.#closed) handle.disconnect();
					else this.#handle = handle;
				},
				(error: unknown) => {
					this.#status = `Could not open the world: ${messageOf(error)}`;
				},
			);
	}

	/** The view as the world last sent it; a DEV aid and a test seam. */
	get view(): PlayView | null {
		return this.#view;
	}

	close(): void {
		this.#closed = true;
		clearTimeout(this.#walkTimer);
		clearTimeout(this.#waitTimer);
		clearTimeout(this.#quietTimer);
		this.#handle?.disconnect();
		this.#deps.close?.();
	}

	#lineId = (key: string): number => {
		let id = this.#lineIds.get(key);
		if (id === undefined) {
			id = this.#nextLine++;
			this.#lineIds.set(key, id);
		}
		return id;
	};

	#onView(view: PlayView): void {
		if (this.#view === null) {
			// What was said before the app opened is the past: it is in the story,
			// but the scene does not play it again.
			for (const line of worldLines(view)) this.#lineId(line.key);
			this.#oldBelow = this.#nextLine;
		} else {
			// Coming back to a place brings back what was said there. A line
			// older than the story the app already knows is the past, too.
			const late = worldLines(view)
				.filter((line) => !this.#lineIds.has(line.key) && line.tick < this.#tickSeen - LATE_TICKS)
				.map((line) => this.#lineId(line.key));
			if (late.length > 0) this.#late = new Set([...this.#late, ...late]);
		}
		for (const line of worldLines(view)) this.#tickSeen = Math.max(this.#tickSeen, line.tick);
		if (this.#walking && view.place?.id !== this.#walking.from) this.#arrived();
		// A new place: say so, whatever the last word on the foot line was
		// ("You set off ...", or the arrival before this one).
		const was = this.#view?.place;
		const fought = this.#view ? gridWindow(this.#view) !== null : false;
		if (
			was &&
			view.place &&
			was.id !== view.place.id &&
			!fought &&
			!gridWindow(view) &&
			!view.hero.drafting &&
			!this.#view?.hero.drafting
		)
			this.#note(`You arrive: ${view.place.name}.`, false);
		if (this.#waiting && replied(this.#waiting.mark, view)) this.#heard();
		// Somebody who left the place cannot be talked to any more.
		if (this.#partner && !view.occupants.some((occupant) => occupant.id === this.#partner)) {
			this.#partner = null;
		}
		// A finished hero's creation outline is the past.
		this.#guide = view.hero.drafting ? (openGuide(view) ?? this.#guide) : undefined;
		if (!view.hero.drafting) {
			if (this.#hadGuide) this.#forget(this.#guideKey);
			this.#hadGuide = false;
		} else if (openGuide(view)) {
			this.#hadGuide = true;
			this.#keep(this.#guideKey, JSON.stringify({ guide: this.#guide }));
		}
		if (!view.hero.drafting || openGuide(view)) {
			// A new question: its outline says what was answered.
			this.#answeredStep = undefined;
			this.#patient = false;
			clearTimeout(this.#quietTimer);
			this.#quietTimer = undefined;
		} else if (this.#quietTimer === undefined && !this.#patient) {
			this.#quietTimer = setTimeout(() => {
				this.#quietTimer = undefined;
				if (!this.#closed) this.#patient = true;
			}, QUIET_MS);
		}
		// What the hero answers with in the creation talk is the one place the
		// stage learns which spells are theirs (sk-jay0.1.76.19.14).
		const picks = (this.#guide?.outline ?? []).flatMap((entry) =>
			entry.answers.flatMap((answer) => (answer.ref ? [answer.ref] : [])),
		);
		if (view.hero.drafting && this.#guide && picks.join("\n") !== this.#picks.join("\n")) {
			this.#picks = picks;
			this.#keep(this.#picksKey, JSON.stringify(picks));
		}
		const strangers = view.occupants.filter(
			(occupant) => occupant.name && this.#met[occupant.id] !== occupant.name,
		);
		if (strangers.length > 0 && !view.hero.drafting) {
			this.#met = {
				...this.#met,
				...Object.fromEntries(strangers.map((occupant) => [occupant.id, occupant.name])),
			};
			// Kept like the map: a reload does not make a friend a stranger.
			this.#keep(this.#metKey, JSON.stringify(this.#met));
		}
		// A thing that was looked at has said what it is; the list never does.
		const looked = view.itemDetail;
		const lookedName = looked && view.pack.find((item) => item.id === looked.id)?.name;
		if (looked?.definitionRef && lookedName && this.#kinds[lookedName] !== looked.definitionRef) {
			this.#kinds = { ...this.#kinds, [lookedName]: looked.definitionRef };
			this.#keep(this.#kindsKey, JSON.stringify(this.#kinds));
		}
		if ((view.hero.hp ?? 0) > this.#hpSeen && !view.hero.drafting) {
			this.#hpSeen = view.hero.hp ?? 0;
			// Kept with the atlas: after a reload a wounded hero is not "whole".
			try {
				this.#deps.storage?.setItem(this.#hpKey, String(this.#hpSeen));
			} catch {
				// Storage is blocked.
			}
		}
		// The world sends the hero's hit points as a number; the change is the
		// one harm the stage can show on a figure without reading sentences.
		const before = this.#view?.hero;
		if (before && before.actorId === view.hero.actorId && !view.hero.drafting) {
			const change = (view.hero.hp ?? 0) - (before.hp ?? 0);
			if (before.hp !== undefined && view.hero.hp !== undefined && change !== 0)
				this.#flashChange(view.hero.actorId, change);
		}
		this.#marks(view);
		this.#reply(view);
		this.#remember(view);
		if (this.#arrival && view.place?.id === this.#arrival.placeId) this.#arrival.done(true);
		const here = this.#view?.place?.id === view.place?.id;
		this.#view = view;
		// A rest or another long doing that ended where the hero stands ends
		// without a word from the world; a journey ends with the arrival.
		const running = this.#running()?.label ?? null;
		if (this.#ran && !running && here && !this.#walking && !this.#stepping && !view.hero.drafting) {
			this.#note(`${this.#ran}: done.`, false);
			// A rest gives back what was spent; the old counts are no longer true.
			if (Object.keys(this.#left).length > 0) {
				this.#left = {};
				this.#keep(this.#leftKey, "{}");
			}
		}
		this.#ran = running;
		this.#keepStory();
		this.#loadArt(view);
		for (const ref of answerRefs(view)) {
			if (this.#askedRefs.has(ref)) continue;
			this.#askedRefs.add(ref);
			void this.#deps.reference(ref).then((entry) => {
				if (!entry || this.#closed) return;
				if (entry.href) this.#hrefs[ref] = entry.href;
				if (entry.about) this.#abouts[ref] = entry.about;
			});
		}
	}

	#onError(error: Error): void {
		if (this.#view === null) this.#status = `Error: ${error.message}`;
		else this.#note(`The world could not be read: ${error.message}`, true);
	}

	#loadArt(view: PlayView): void {
		const wanted = wantedArt(view);
		const keep = (key: string, loading: Promise<string | undefined>) => {
			if (this.#askedArt.has(key)) return;
			this.#askedArt.add(key);
			void loading.then((url) => {
				if (url && !this.#closed) this.#art[key] = url;
			});
		};
		for (const id of wanted.srd) keep(id, this.#deps.srdArt(id));
		// What was answered in the creation talk: the outline shows its picture.
		for (const id of this.#picks.map(grantedDefinition)) keep(id, this.#deps.srdArt(id));
		for (const id of Object.values(this.#kinds)) keep(id, this.#deps.srdArt(id));
		const worldArt = this.#deps.worldArt;
		if (worldArt) for (const art of wanted.world) keep(art.hash, worldArt(art));
	}

	/** Keep what this view shows of the world: the place, its ways, the plate. */
	#remember(view: PlayView): void {
		const place = view.place;
		// In a fight the place is a grid cell and the plate is the grid.
		if (!place || gridWindow(view)) return;
		if (this.#ground?.name !== place.name) {
			this.#ground = { name: place.name, description: place.description ?? "" };
			if (!view.hero.drafting) this.#keep(this.#groundKey, JSON.stringify(this.#ground));
		}
		// A hero still being made has seen nothing: whatever is kept under
		// their id is another hero's.
		if (view.hero.drafting) {
			if (Object.keys(this.#atlas.places).length === 0) return;
			this.#atlas = emptyAtlas();
			this.#hpSeen = 0;
			this.#past = [];
			this.#left = {};
			this.#met = {};
			this.#said = [];
			this.#kinds = {};
			try {
				this.#deps.storage?.removeItem(this.#metKey);
				this.#deps.storage?.removeItem(this.#groundKey);
				this.#deps.storage?.removeItem(this.#saidKey);
				this.#deps.storage?.removeItem(this.#kindsKey);
				this.#deps.storage?.removeItem(this.#leftKey);
				this.#deps.storage?.removeItem(this.#storyKey);
				this.#deps.storage?.removeItem(this.#hpKey);
				this.#deps.storage?.removeItem(this.#atlasKey);
			} catch {
				// Storage is blocked.
			}
			return;
		}
		let atlas = withPlace(this.#atlas, place);
		if (view.mapSvg && view.mapSvg !== this.#lastPlate) {
			const plate = readPlate(view.mapSvg);
			// A plate that does not draw the hero's place is the one before; it
			// is read once the world has sent the new one.
			if (plate?.nodes.some((node) => node.id === place.id)) {
				this.#lastPlate = view.mapSvg;
				const frontier = new Set(place.exits.map((exit) => exit.toNodeId ?? ""));
				atlas = withPlate(atlas, plate, place.id, frontier);
			}
		}
		if (sameAtlas(atlas, this.#atlas)) return;
		this.#atlas = atlas;
		try {
			this.#deps.storage?.setItem(this.#atlasKey, JSON.stringify(atlas));
		} catch {
			// Storage is blocked.
		}
	}

	/**
	 * Marks for what the world reports as events with numbers or kinds: a
	 * blow that missed the hero, harm the hero dealt, experience won. The
	 * hero's own harm is read from their hit points instead.
	 */
	#marks(view: PlayView): void {
		const first = this.#view === null;
		for (const entry of view.events) {
			if (this.#eventsSeen.has(entry.id)) continue;
			this.#eventsSeen.add(entry.id);
			const amount = entry.fields?.amount;
			const spent = entry.fields?.resourceId;
			const now = entry.fields?.newValue;
			if (entry.kind === "self_resource_spent" && spent && typeof now === "number") {
				this.#left = { ...this.#left, [spent]: now };
				this.#keep(this.#leftKey, JSON.stringify(this.#left));
			}
			// What happened before the app opened floats nowhere.
			if (first) continue;
			if (entry.kind === "trace_addressed" && entry.traceKind === ATTACK_MISS)
				this.#flash(view.hero.actorId, "miss", "plain");
			else if (entry.kind === "xp_gained" && amount)
				this.#flash(view.hero.actorId, `+${amount} XP`, "good");
			else if (entry.kind === "dealt_hit" && amount) {
				// The world names whom the hero struck, not their id: the mark
				// goes to the one figure of that name, or nowhere.
				const named = [...view.occupants, ...fightTokens(view)].filter(
					(occupant) => occupant.name === entry.fields?.targetName,
				);
				const ids = new Set(named.map((occupant) => occupant.id));
				const [only] = ids;
				if (ids.size === 1 && only) this.#flash(only, `−${amount}`, "harm");
			}
		}
	}

	/** How many sentences of somebody the view carries. */
	#spokenBy(view: PlayView, speakerId: string): number {
		return view.speech.filter((row) => row.speakerId === speakerId).length;
	}

	/** The asker's first sentence after an answer is the reply to it. */
	#reply(view: PlayView): void {
		const open = this.#answered;
		const last = this.#said.at(-1);
		if (!open || !last || this.#spokenBy(view, open.askerId) <= open.heard) return;
		const reply = view.speech.findLast((row) => row.speakerId === open.askerId)?.text ?? "";
		this.#answered = null;
		if (reply.trim() === "") return;
		this.#said = [...this.#said.slice(0, -1), { ...last, reply }];
		this.#keep(this.#saidKey, JSON.stringify(this.#said));
	}

	#forget(key: string): void {
		try {
			this.#deps.storage?.removeItem(key);
		} catch {
			// Storage is blocked; there is nothing kept to drop.
		}
	}

	/** The answer the open creation step was given, kept with its outline. */
	#answer(label: string): void {
		this.#answeredStep = label;
		this.#keep(this.#guideKey, JSON.stringify({ guide: this.#guide, answered: label }));
	}

	#keep(key: string, value: string): void {
		try {
			this.#deps.storage?.setItem(key, value);
		} catch {
			// Storage is blocked; the memory lasts as long as the page.
		}
	}

	#flashChange(thingId: string, change: number): void {
		this.#flash(
			thingId,
			change > 0 ? `+${change}` : `${change}`.replace("-", "−"),
			change > 0 ? "good" : "harm",
		);
	}

	#flash(thingId: string, text: string, tone: Stage["flashes"][number]["tone"]): void {
		const id = this.#nextFlash++;
		const flash = { id, thingId, text, tone };
		this.#flashes = [...this.#flashes, flash];
		setTimeout(() => {
			this.#flashes = this.#flashes.filter((entry) => entry.id !== id);
		}, FLASH_MS);
	}

	#heard(): void {
		clearTimeout(this.#waitTimer);
		this.#waiting = null;
	}

	/** The hero said something to `who`; hint that they think until they reply. */
	#expect(who: string, before: string): void {
		const view = this.#view;
		this.#heard();
		if (!view || replied(before, view)) return;
		this.#waiting = { who, mark: before };
		this.#waitTimer = setTimeout(() => {
			this.#waiting = null;
			// The hint ends by itself; say so, or the silence looks like a fault.
			this.#note(who ? `${who} has not answered.` : "Nobody has answered.", false);
		}, WAITING_TIMEOUT_MS);
	}

	#arrived(): void {
		clearTimeout(this.#walkTimer);
		this.#walking = null;
	}

	/** The last world line on the stage: where a click's result belongs. */
	#here(): string | null {
		const view = this.#view;
		return view ? (worldLines(view).at(-1)?.key ?? null) : null;
	}

	#note(text: string, refused: boolean, after = this.#here(), thingId?: string): void {
		const result: LiveResult = {
			id: this.#nextResult++,
			after,
			text,
			refused,
			...(thingId ? { thingId } : {}),
		};
		this.#results = [...this.#results.slice(-RESULTS_KEPT), result];
		this.#keepStory();
	}

	/**
	 * Keep the story in the browser: the world replays what was said, but not
	 * what happened, so after a reload the story would start nearly empty.
	 */
	#keepStory(): void {
		const view = this.#view;
		if (!view || view.hero.drafting || !this.#deps.storage) return;
		const lines = [...this.#past, ...this.#fresh(this.#stage.lines)].slice(-PAST_KEPT);
		try {
			this.#deps.storage.setItem(this.#storyKey, JSON.stringify(lines));
		} catch {
			// Storage is blocked.
		}
	}

	/** The lines the kept story does not hold yet: the world replays old speech. */
	#fresh(lines: readonly StageLine[]): PastLine[] {
		const known = new Set(this.#past.map(pastKey));
		return lines
			.filter((line) => line.id > 0 && !(line.old && known.has(pastKey(line))))
			.map(({ kind, text, who }): PastLine => ({ kind, text, ...(who ? { who } : {}) }));
	}

	#mine(): number {
		return this.#view?.speech.filter((line) => line.mine).length ?? 0;
	}

	/**
	 * Something of the hero's that takes world time and still runs: a long
	 * rest, a journey. The world reports how far it is.
	 */
	#running(): { label: string; progress: number | null } | null {
		// The world lists what is ongoing; the detail of one of them (the one
		// the session last read) says how far it is.
		// A fight is ongoing too, but it is the hero's to play, turn by turn.
		if (!this.#view || inFight(this.#view.session)) return null;
		const operations = this.#view.operations;
		const ongoing = operations?.items[0];
		const detail = operations?.selected;
		if (ongoing) {
			const known = detail && detail.id === ongoing.id && !detail.terminal;
			return { label: ongoing.label, progress: known ? detail.progress : null };
		}
		return detail && !detail.terminal && detail.worldTimed
			? { label: detail.label, progress: detail.progress }
			: null;
	}

	#busy(): Stage["busy"] {
		if (this.#acting) return { text: this.#acting, stoppable: this.#stepping };
		const running = this.#running();
		const done = running?.progress != null ? ` ${Math.round(running.progress)}%` : "";
		if (this.#walking)
			return {
				text: `${this.#walking.text}${this.#walking.legs ? "" : done}`,
				stoppable: this.#stepping,
			};
		// Whatever else is sent meanwhile, the world refuses or lines up behind it.
		if (running) return { text: `${running.label}…${done}`, stoppable: false };
		const thinking = this.#view ? thinkingLine(this.#view, this.#waiting) : undefined;
		return thinking ? { text: `${thinking}…`, stoppable: false } : null;
	}

	#stage = $derived.by((): Stage => {
		const view = this.#view;
		if (!view) return emptyStage(this.#status);
		const stage = stageFromView(view, {
			refusals: this.#refusals,
			results: this.#results,
			art: (key) => this.#art[key],
			lineId: this.#lineId,
			busy: this.#busy(),
			partnerId: this.#partner,
			guide: this.#guide,
			waiting: this.#waiting !== null,
			href: (ref) => this.#hrefs[ref],
			about: (ref) => this.#abouts[ref],
			answered: this.#answeredStep,
			patient: this.#patient,
			stepCostMs: this.#stepCost,
			hpSeen: this.#hpSeen,
			picks: this.#picks,
			left: this.#left,
			kinds: this.#kinds,
			met: this.#met,
			said: this.#said,
			atlas: this.#atlas,
			ground: this.#ground,
			flashes: this.#flashes,
		});
		const oldBelow = this.#oldBelow;
		const lines = stage.lines.map((line) =>
			line.id < oldBelow || this.#late.has(line.id) ? { ...line, old: true } : line,
		);
		// The kept story comes first, in the order it was told; what the world
		// sends again of it (old speech) is not told twice.
		const kept = new Set(this.#past.map(pastKey));
		const past = this.#past.map(
			(line, index, all): StageLine => ({ ...line, id: index - all.length, old: true }),
		);
		return {
			...stage,
			lines: [...past, ...lines.filter((line) => !(line.old && kept.has(pastKey(line))))],
		};
	});

	get stage(): Stage {
		return this.#stage;
	}

	// --- The port -------------------------------------------------------------

	/**
	 * Send one attempt and show what came back. `key` is where a refusal is
	 * remembered; `expect` names who should answer, for the thinking hint;
	 * `quiet` keeps the story free of an answer that only says nothing changed.
	 * Returns how it went, or undefined when nothing was sent or the answer
	 * got lost.
	 */
	async #send(
		what: {
			sentence: string;
			thingId?: string;
			key?: string;
			expect?: string;
			quiet?: () => boolean;
			/** A walk: the tool may stop watching before the hero arrives. */
			moving?: boolean;
		},
		run: (handle: PlaySessionHandle) => Promise<string>,
	): Promise<{ refused: boolean } | undefined> {
		const view = this.#view;
		const handle = this.#handle;
		if (!view || !handle || this.#acting) return undefined;
		const at = this.#here();
		const spokenBefore = this.#mine();
		const mark = heardMark(view);
		this.#acting = `${what.sentence}…`;
		try {
			const message = await run(handle);
			// A walk the tool stopped watching is no refusal: the hero is on the
			// way, or there already (seen live: "actor '168' did not reach
			// '.../foyer' within 11800ms" a moment after the arrival).
			const unwatched = what.moving === true && UNWATCHED_WALK.test(message);
			const refused = this.#deps.lastOutcome() === "rejected" && !unwatched;
			if (what.key) {
				if (refused) this.#refusals[what.key] = message;
				else delete this.#refusals[what.key];
			}
			// A spoken answer comes back from the world as the hero's own line;
			// saying it a second time as a result would only be noise.
			if (!unwatched && (refused || (!what.quiet?.() && this.#mine() === spokenBefore))) {
				this.#note(
					answerText(what.sentence, message || "The world answered without words."),
					refused,
					at,
					what.thingId,
				);
			}
			if (!refused && what.expect !== undefined) this.#expect(what.expect, mark);
			return { refused };
		} catch (error) {
			// Nothing reached the world, or its answer got lost: say so, and do
			// not remember it as the world's "no".
			this.#note(`${what.sentence}: ${messageOf(error)}`, true, at, what.thingId);
			return undefined;
		} finally {
			this.#acting = null;
		}
	}

	async attempt(thingId: string, offerId: string): Promise<void> {
		const view = this.#view;
		if (!view || this.#acting) return;
		if (offerId === TALK) {
			this.talkTo(thingId);
			return;
		}
		const attempt = attemptFor(view, thingId, offerId);
		if (!attempt) {
			this.#note("The world no longer offers that here.", true, this.#here(), thingId);
			return;
		}
		if (attempt.kind === "act" && needsInput(attempt.action)) {
			this.#note(
				`${attempt.sentence}: this needs words, and only speech and a name are typed here.`,
				false,
				this.#here(),
				thingId,
			);
			return;
		}
		const from = view.place?.id ?? "";
		const fighting = inFight(view.session);
		const sent = await this.#send(
			{
				sentence: attempt.sentence,
				thingId,
				key: `${thingId}:${offerId}`,
				// Having arrived, the new place is the answer; its description is
				// on the top line already.
				quiet: () => attempt.kind === "move" && !fighting && this.#view?.place?.id !== from,
				moving: attempt.kind === "move",
			},
			(handle) =>
				attempt.kind === "move" ? handle.move(attempt.exit) : handle.act(attempt.action),
		);
		if (attempt.kind !== "move" || !sent || sent.refused || fighting) return;
		if (this.#view?.place?.id !== from) return;
		this.#walking = { from, text: `On the way to ${attempt.exit.toName}…` };
		clearTimeout(this.#walkTimer);
		const giveUp = () => {
			if (this.#walking?.from !== from) return;
			// A long way: the world still reports the journey as running.
			if (this.#running()) {
				this.#walkTimer = setTimeout(giveUp, ARRIVE_TIMEOUT_MS);
				return;
			}
			this.#walking = null;
			this.#note(`You are still here; the walk to ${attempt.exit.toName} did not end.`, true);
		};
		this.#walkTimer = setTimeout(giveUp, ARRIVE_TIMEOUT_MS);
	}

	async answer(roundId: string, answerId: string): Promise<void> {
		const view = this.#view;
		if (!view) return;
		const answer = answerFor(view, roundId, answerId);
		if (!answer) {
			this.#note("That question is no longer open.", true);
			return;
		}
		const action = answer.action;
		const thingId = answer.askerId ?? undefined;
		if (!action) {
			this.#note(
				`${answer.label}: the world names this answer but offers no way to give it.`,
				true,
				this.#here(),
				thingId,
			);
			return;
		}
		const spoken = isSpokenRound(roundId);
		const at = this.#here();
		const sent = await this.#send(
			{ sentence: answer.label, thingId, expect: answer.asker, quiet: () => spoken },
			(handle) => handle.act(action),
		);
		// The world echoes a numbered answer without its words; the story
		// keeps what the hero picked.
		if (spoken && sent && !sent.refused) this.#note(answer.label, false, at);
		if (sent && !sent.refused && view.hero.drafting) this.#answer(answer.label);
		// Nothing lists what the hero took on (sk-jay0.1.76.19.16). The stage
		// keeps its own notes of the talk: what was answered, and the reply.
		if (sent && !sent.refused && !view.hero.drafting && answer.askerId) {
			this.#said = [...this.#said, { who: answer.asker, said: answer.label }].slice(-SAID_KEPT);
			this.#keep(this.#saidKey, JSON.stringify(this.#said));
			// The reply may have arrived with the answer's own view already.
			this.#answered = { askerId: answer.askerId, heard: this.#spokenBy(view, answer.askerId) };
			if (this.#view) this.#reply(this.#view);
		}
	}

	async fill(numbers: Record<string, number>): Promise<void> {
		const view = this.#view;
		const form = view ? numberForm(view, openGuide(view) ?? this.#guide) : undefined;
		if (!view || !form) return;
		const values = Object.fromEntries(
			form.fields.map((field) => [field.name, String(numbers[field.name] ?? field.min ?? "")]),
		);
		const thingId = form.action.targetRef.replace(/^entity:/, "");
		const who = view.occupants.find((occupant) => occupant.id === thingId)?.name ?? "";
		const spoken = form.fields.map((field) => `${field.label} ${values[field.name]}`).join(", ");
		const sent = await this.#send(
			{ sentence: `${form.title}: ${spoken}`, thingId, expect: who },
			(handle) => handle.act(form.action, utteranceFromInputValues(form.fields, values), 0, values),
		);
		if (sent && !sent.refused) this.#answer(spoken);
	}

	async say(text: string): Promise<void> {
		const view = this.#view;
		const words = text.trim();
		if (!view || words === "") return;
		if (view.hero.drafting) {
			// The one thing typed during creation is what the DM's one-line form asks for.
			const form = nameForm(view);
			const field = form?.fields[0];
			if (!form || !field) return;
			const values = { [field.name]: words };
			const thingId = form.action.targetRef.replace(/^entity:/, "");
			const who = view.occupants.find((occupant) => occupant.id === thingId)?.name ?? "";
			await this.#send({ sentence: `${form.title}: ${words}`, thingId, expect: who }, (handle) =>
				handle.act(form.action, utteranceFromInputValues(form.fields, values), 0, values),
			);
			return;
		}
		const partnerId = this.#partner;
		const speech = speechAction(view, partnerId);
		if (!speech) {
			this.#note("The world offers no way to speak here.", true);
			return;
		}
		const who = view.occupants.find((occupant) => occupant.id === partnerId)?.name ?? "";
		await this.#send(
			{ sentence: who ? `Say to ${who}` : "Say", thingId: partnerId ?? undefined, expect: who },
			(handle) => handle.act(speech, words),
		);
	}

	async #creationCommand(pick: "back" | "forward" | "discard", sentence: string): Promise<void> {
		const view = this.#view;
		const action: PlayAction | undefined = view ? creationModel(view)[pick] : undefined;
		if (!action) return;
		const thingId = action.targetRef.replace(/^entity:/, "");
		const who = view?.occupants.find((occupant) => occupant.id === thingId)?.name ?? "";
		// The DM answers a step back or forward by asking again; the act's own
		// receipt says only that nothing visible changed.
		await this.#send({ sentence, thingId, expect: who, quiet: () => true }, (handle) =>
			handle.act(action),
		);
	}

	back(): Promise<void> {
		return this.#creationCommand("back", "Back to the question before");
	}

	forward(): Promise<void> {
		return this.#creationCommand("forward", "Leave it as it was answered");
	}

	restart(): Promise<void> {
		return this.#creationCommand("discard", "Start over with an empty draft");
	}

	talkTo(thingId: string | null): void {
		this.#partner = thingId;
	}

	/** Resolves true once the hero stands in that place; false after the wait. */
	#arrive(placeId: string): Promise<boolean> {
		if (this.#view?.place?.id === placeId) return Promise.resolve(true);
		return new Promise((resolve) => {
			const timer = setTimeout(() => done(false), ARRIVE_TIMEOUT_MS);
			const done = (arrived: boolean) => {
				clearTimeout(timer);
				this.#arrival = null;
				resolve(arrived);
			};
			this.#arrival = { placeId, done };
		});
	}

	/**
	 * Walk to a place on the map, one offered way after the other. The route
	 * is read again at every place, and the walk ends at the first way the
	 * world does not offer or refuses, or when the player stops it.
	 */
	async walkTo(placeId: string): Promise<void> {
		if (this.#acting || this.#stepping || !this.#view?.place) return;
		const goal = this.#atlas.places[placeId]?.name ?? placeId;
		this.#stepping = true;
		this.#stopAsked = false;
		try {
			for (let legs = 0; legs < 24; legs += 1) {
				const place = this.#view?.place;
				if (!place || place.id === placeId) break;
				if (this.#stopAsked) {
					this.#note(`You stop in ${place.name}, on the way to ${goal}.`, false);
					break;
				}
				const route = routeTo(atlasGraph(this.#atlas), place.id, placeId);
				const next = route[0];
				const exit = next === undefined ? undefined : exitTo(place, next);
				if (next === undefined) {
					// The atlas holds the place, but no chain of known ways to it.
					this.#note(`You know no way from ${place.name} to ${goal} yet.`, true);
					break;
				}
				if (!exit) {
					this.#note(`From ${place.name} the world offers no way on towards ${goal}.`, true);
					break;
				}
				const sent = await this.#send(
					{
						sentence: `Go ${exit.label} to ${exit.toName}`,
						thingId: `way:${exit.handle}`,
						key: `way:${exit.handle}:go`,
						quiet: () => this.#view?.place?.id === next,
						moving: true,
					},
					(handle) => handle.move(exit),
				);
				if (!sent || sent.refused) break;
				// The world's percent is of one leg; over several places it would
				// run to 100 and start again. There the legs are counted instead.
				this.#walking = {
					from: place.id,
					text: walkingText(goal, route.length, exit.toName),
					...(route.length > 1 ? { legs: route.length } : {}),
				};
				const arrived = await this.#arrive(next);
				this.#walking = null;
				if (!arrived) {
					this.#note(`You are still in ${place.name}; the walk to ${goal} ends here.`, true);
					break;
				}
			}
		} finally {
			this.#stepping = false;
			this.#walking = null;
		}
	}

	inspect(itemId: string | null): void {
		const item = this.#view?.pack.find((entry) => entry.id === itemId);
		void this.#handle
			?.selectItem(
				item ? { id: item.id, handle: item.handle, rev: item.rev, name: item.name } : null,
			)
			.catch(() => {
				// The detail read failed; the thing stays a name in the list.
			});
	}

	/**
	 * Walk toward a cell of the fight grid, one offered step after the other.
	 * The chain ends at the cell, at the first step the world refuses or does
	 * not offer, or when the player stops it.
	 */
	async step(col: number, row: number): Promise<void> {
		if (this.#acting || this.#stepping) return;
		this.#stepping = true;
		this.#stopAsked = false;
		try {
			for (let steps = 0; steps < 24 && !this.#stopAsked; steps += 1) {
				const view = this.#view;
				const here = cellOf(view?.place?.id);
				if (!view || !here || (here.col === col && here.row === row)) break;
				const exit = stepToward(view, { col, row });
				if (!exit) {
					this.#note("The world offers no step that way from here.", true);
					break;
				}
				const from = view.place?.id;
				const before = movementLeft(view);
				const sent = await this.#send(
					// Having stepped, the figure on its new cell is the answer.
					{ sentence: `Step ${exit.label}`, quiet: () => this.#view?.place?.id !== from },
					(handle) => handle.move(exit),
				);
				const now = this.#view;
				if (!sent || sent.refused || !now || now.place?.id === from) break;
				this.#stepCost = observedStepCost(before, movementLeft(now)) ?? this.#stepCost;
			}
		} finally {
			this.#stepping = false;
		}
	}

	async endTurn(): Promise<void> {
		// The session's own reply names the next fighter by id; the roster on
		// the top line says who acts, by name.
		await this.#send({ sentence: "End your turn", quiet: () => true }, (handle) =>
			handle.endTurn(),
		);
	}

	stop(): void {
		this.#stopAsked = true;
	}

	async react(take: boolean): Promise<void> {
		const open = this.#view?.reaction;
		if (!open) return;
		const name = this.#stage.reaction?.name ?? "a reaction";
		await this.#send({ sentence: take ? `React: ${name}` : `Let it pass: ${name}` }, (handle) =>
			handle.react(open.handle, open.rev, take ? "react" : "pass"),
		);
	}
}
