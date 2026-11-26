/**
 * The one live selection row (bead sk-jay0.1.8.63.13): "the map is always
 * only selecting, actions always only on the Table" (user ruling
 * 2026-09-19). A `Selection` names WHAT was picked — a battle-grid cell, a
 * neighbouring place on the explore card map, or a turn-order actor; never a
 * verb. `selectionRowFromView` is the pure translation from that pick plus
 * the current `PlayView` into one row's worth of subjects and actions, the
 * same shape the shared stream already renders things in. Nothing here
 * dispatches a world action — the caller (`PlayTable.svelte`) still owns
 * `act`/`move`, exactly as every other Table surface does.
 *
 * Action ids: a plain id is a `PlayAction.id` the caller passes straight to
 * `act()`; an id of the form `move:<handle>` is not an affordance handle —
 * the caller must route it to `move(handle, …)` instead. This mirrors how
 * `PlaceMap`/`BattleMap` already separate "step" from "act": the row only
 * ever offers one or the other for a given subject.
 */
import { isGenericCheckAction } from "./play-action-context";
import { verbName } from "./play-table";
import type { PlayAction, PlaySessionToken, PlayView } from "./play-view";

export type Selection =
	| { kind: "cell"; nodeId: string }
	| { kind: "place"; nodeId: string; exitHandle?: string }
	| { kind: "actor"; actorId: string }
	| { kind: "item"; itemId: string }
	| { kind: "exit"; handle: string }
	| null;

export interface SelectionActionEntry {
	id: string;
	/** The pill's own visible text — the bare verb, since the subject it
	 * belongs to already names the target. */
	label: string;
	/**
	 * The world's own, full target-qualified label (e.g. "Melee Attack —
	 * Cellar Rat 1"), for the caller's `aria-label`/`title` — two different
	 * subjects can offer a pill with the identical visible `label` ("Melee
	 * Attack"), so the accessible name must stay the unambiguous one, exactly
	 * the pattern the fight's own turn bar already used
	 * (`play-table.ts`'s `combatTargets`). Absent only for a synthetic
	 * move/travel entry whose `label` is already unambiguous.
	 */
	accessibleLabel?: string;
}

export interface SelectionMenuEntry extends SelectionActionEntry {
	submenu?: SelectionActionEntry[];
}

export interface SelectionSubject {
	/** Exact offers read for a selected inventory item; never reconstruct handles. */
	itemActions?: readonly PlayAction[];
	/** Stable identity for `{#each}` — an actor id, or a synthetic key for a
	 * free cell/place ("exit:<handle>", "self", the raw node id). */
	id: string;
	name: string;
	/** An `InfoLink` ref (`occupant:<id>`, `place:<id>`) — only when the
	 * info-card resolver can actually answer it; otherwise the name renders
	 * as plain text, never a dead link. */
	infoRef?: string;
	primary: SelectionActionEntry[];
	more: SelectionMenuEntry[];
}

export interface SelectionRow {
	title: string;
	subtitle?: string;
	subjects: SelectionSubject[];
	/** A short honest sentence when nothing usable came of the selection
	 * ("Nothing is offered from here.", "You are here.", "No direct move to
	 * this place is currently offered."). */
	note?: string;
}

export interface SelectionExit {
	handle: string;
	label: string;
	name: string;
}

/**
 * Everything `selectionRowFromView` needs beyond the raw `PlayView` —
 * supplied by `PlayTable.svelte` from state it already derives (`dockMore`,
 * `tokensByNode`, `battleMapExits`/`placeMapExits`, `nodeOfActor`). Kept as
 * one small interface so this module stays framework-free and testable with
 * a fixture view and stub functions, no component mount required.
 */
export interface SelectionContext {
	/** Node ids a selection may legitimately name right now — the battle
	 * grid's own cells during a fight, or the current place plus its
	 * neighbours while exploring. Anything else means the selection is
	 * stale (the fight ended, the place changed) and the row disappears. */
	knownNodeIds: ReadonlySet<string>;
	/** The player's own current cell/place id, or `null` before any view has
	 * loaded. */
	ownNodeId: string | null;
	/** Session tokens (sk-jay0.4.2) grouped by cell — `tokensByNode(view)`.
	 * Empty outside a tactical session. */
	tokensByNode: ReadonlyMap<string, readonly PlaySessionToken[]>;
	/** The offered step/travel landing on this node, if any. */
	exitTo: (nodeId: string) => SelectionExit | null;
	/** Every currently-offered action targeting this actor (`dockMore`
	 * filtered by `entity:<id>`), never a re-derivation. */
	actionsForActor: (actorId: string) => readonly PlayAction[];
	/** Self-targeted/untargeted offers for the player's own cell — folding
	 * together whatever target group represents "here" and "world" today. */
	selfActions: () => readonly PlayAction[];
	/** Whether an actor id is a current scene occupant the info-card
	 * resolver can read (`occupant:<id>` gating). */
	isReadableOccupant: (actorId: string) => boolean;
	/** Whether a node id is the info-card resolver's one readable place
	 * (`place:<id>` only ever resolves the CURRENT place, `info-cards.ts`). */
	isReadablePlace: (nodeId: string) => boolean;
	/** Whether an actor id still exists (roster or scene) — an `actor`
	 * selection for someone who left goes stale. */
	actorExists: (actorId: string) => boolean;
	/** A display name for an actor with no session token (a non-grid fight,
	 * or an occupant selected some other way). `null` when unknown. */
	nameForActor: (actorId: string) => string | null;
	/** The cell a roster actor's token sits on, or `null` (no token this
	 * map). Mirrors `play-table.ts`'s `nodeOfActor`. */
	nodeOfActor: (actorId: string) => string | null;
}

/**
 * The keyboard's walk through what the player perceives (axiom A8,
 * `ledger/designs/play-interaction-axioms.md`): present actors in the
 * world's own order (turn order in a fight), then the ways out clockwise
 * from north. The order is STABLE — it never depends on what is selected,
 * only on the view — so `select.next` from the same place always lands on
 * the same thing. Battle-grid cells are not in the ring; arrow keys move
 * the cell selection while the map has focus.
 */
const CLOCKWISE = [
	"north",
	"northeast",
	"east",
	"southeast",
	"south",
	"southwest",
	"west",
	"northwest",
	"up",
	"down",
];

export interface SelectionRingExit {
	handle: string;
	toNodeId: string;
	/** Compass direction or edge label as the world reports it. */
	direction: string;
}

export function selectionRing(input: {
	actorIds: readonly string[];
	exits: readonly SelectionRingExit[];
}): NonNullable<Selection>[] {
	const rank = (exit: SelectionRingExit): number => {
		const index = CLOCKWISE.indexOf(exit.direction.trim().toLowerCase());
		return index === -1 ? CLOCKWISE.length : index;
	};
	const exits = input.exits
		.map((exit, order) => ({ exit, order }))
		.sort(
			(a, b) =>
				rank(a.exit) - rank(b.exit) ||
				a.exit.direction.localeCompare(b.exit.direction) ||
				a.order - b.order,
		);
	return [
		...input.actorIds.map((actorId) => ({ kind: "actor" as const, actorId })),
		...exits.map(({ exit }) => ({
			kind: "place" as const,
			nodeId: exit.toNodeId,
			exitHandle: exit.handle,
		})),
	];
}

function sameSelection(a: NonNullable<Selection>, b: NonNullable<Selection>): boolean {
	if (a.kind === "item" && b.kind === "item") return a.itemId === b.itemId;
	if (a.kind === "exit" && b.kind === "exit") return a.handle === b.handle;
	if (a.kind === "actor" && b.kind === "actor") return a.actorId === b.actorId;
	if (a.kind === "place" && b.kind === "place") {
		return a.nodeId === b.nodeId && (a.exitHandle ?? null) === (b.exitHandle ?? null);
	}
	if (a.kind === "cell" && b.kind === "cell") return a.nodeId === b.nodeId;
	return false;
}

/**
 * One step along the ring. From nothing (or from a selection the ring does
 * not hold, such as a grid cell) `+1` takes the first entry and `-1` the
 * last; the ring wraps. An empty ring leaves the selection as it is.
 */
export function stepSelection(
	ring: readonly NonNullable<Selection>[],
	current: Selection,
	delta: 1 | -1,
): Selection {
	if (ring.length === 0) return current;
	const at = current === null ? -1 : ring.findIndex((entry) => sameSelection(entry, current));
	if (at === -1) return ring[delta === 1 ? 0 : ring.length - 1] ?? current;
	return ring[(at + delta + ring.length) % ring.length] ?? current;
}

function toEntry(action: PlayAction): SelectionActionEntry {
	const label = verbName(action);
	// Only carried when it actually differs from the visible label — an
	// untargeted action's own `label` (e.g. "Dodge") already IS unambiguous.
	return label === action.label
		? { id: action.id, label }
		: { id: action.id, label, accessibleLabel: action.label };
}

/** Generic checks always fold into one "Checks" submenu, regardless of how
 * many other actions are offered; of what remains, the first three lead. */
function classify(actions: readonly PlayAction[]): {
	primary: SelectionActionEntry[];
	more: SelectionMenuEntry[];
} {
	const checks: PlayAction[] = [];
	const rest: PlayAction[] = [];
	for (const action of actions) {
		(isGenericCheckAction(action) ? checks : rest).push(action);
	}
	const primary = rest.slice(0, 3).map(toEntry);
	const more: SelectionMenuEntry[] = rest.slice(3).map(toEntry);
	if (checks.length > 0) more.push({ id: "checks", label: "Checks", submenu: checks.map(toEntry) });
	return { primary, more };
}

function moveEntry(exit: SelectionExit, label: string): SelectionActionEntry {
	return { id: `move:${exit.handle}`, label };
}

function subjectForToken(token: PlaySessionToken, ctx: SelectionContext): SelectionSubject {
	if (token.isMe) {
		const { primary, more } = classify(ctx.selfActions());
		return { id: token.actorId, name: "You", primary, more };
	}
	const { primary, more } = classify(ctx.actionsForActor(token.actorId));
	const infoRef = ctx.isReadableOccupant(token.actorId) ? `occupant:${token.actorId}` : undefined;
	return { id: token.actorId, name: token.name, ...(infoRef ? { infoRef } : {}), primary, more };
}

function rowIsEmpty(subjects: readonly SelectionSubject[]): boolean {
	return subjects.every((subject) => subject.primary.length === 0 && subject.more.length === 0);
}

/** A battle-grid cell or the current place's own cell — occupants first
 * (one subject per token, several on one cell never collapsed into a
 * guess), else the offered step landing there, else the player's own cell
 * folded into "You", else an honest "nothing offered". */
function cellRow(nodeId: string, ctx: SelectionContext): SelectionRow | null {
	if (!ctx.knownNodeIds.has(nodeId)) return null;
	const tokens = ctx.tokensByNode.get(nodeId) ?? [];
	const exit = ctx.exitTo(nodeId);
	if (tokens.length > 0) {
		const subjects = tokens.map((token) => subjectForToken(token, ctx));
		return {
			title: "Selected",
			...(exit ? { subtitle: exit.label } : {}),
			subjects,
			...(rowIsEmpty(subjects) ? { note: "Nothing is offered from here." } : {}),
		};
	}
	if (nodeId === ctx.ownNodeId) {
		const { primary, more } = classify(ctx.selfActions());
		const subjects: SelectionSubject[] = [{ id: "self", name: "You", primary, more }];
		return {
			title: "Selected",
			subjects,
			...(rowIsEmpty(subjects) ? { note: "Nothing is offered from here." } : {}),
		};
	}
	if (exit !== null) {
		const subjects: SelectionSubject[] = [
			{
				id: `exit:${exit.handle}`,
				name: "Free cell",
				primary: [moveEntry(exit, "Move here")],
				more: [],
			},
		];
		return { title: "Selected", subtitle: exit.label, subjects };
	}
	return {
		title: "Selected",
		subjects: [{ id: nodeId, name: "Free cell", primary: [], more: [] }],
		note: "Nothing is offered from here.",
	};
}

/** A neighbouring place on the explore card map — "Travel to <place>" when
 * the world offers a step there, else an honest refusal note; the player's
 * own place says so instead of offering to travel to itself. The row is
 * rendered only for legacy recordings: in a live session a way-out click
 * writes the go sentence into the composer (`PlayTable.svelte`'s `fillGo`). */
function placeRow(nodeId: string, ctx: SelectionContext): SelectionRow | null {
	if (!ctx.knownNodeIds.has(nodeId)) return null;
	if (nodeId === ctx.ownNodeId) {
		return {
			title: "Selected",
			subjects: [{ id: "self", name: "Here", primary: [], more: [] }],
			note: "You are here.",
		};
	}
	const exit = ctx.exitTo(nodeId);
	if (exit === null) {
		return {
			title: "Selected",
			subjects: [{ id: nodeId, name: "Elsewhere", primary: [], more: [] }],
			note: "No direct move to this place is currently offered.",
		};
	}
	const infoRef = ctx.isReadablePlace(nodeId) ? `place:${nodeId}` : undefined;
	return {
		title: "Selected",
		subjects: [
			{
				id: `place:${nodeId}`,
				name: exit.name,
				...(infoRef ? { infoRef } : {}),
				primary: [moveEntry(exit, `Travel to ${exit.name}`)],
				more: [],
			},
		],
	};
}

/** A turn-order pick: resolve the actor's own cell (`nodeOfActor`) and
 * delegate to `cellRow`, so selecting a combatant and clicking their cell
 * produce the identical row (design doc's "two-way" sync) — a fight without
 * a battle grid (no token this map) falls back to one direct subject. */
function actorRow(actorId: string, view: PlayView, ctx: SelectionContext): SelectionRow | null {
	if (!ctx.actorExists(actorId)) return null;
	const nodeId = ctx.nodeOfActor(actorId);
	if (nodeId !== null) return cellRow(nodeId, ctx);
	const isMe = actorId === view.hero.actorId;
	const name = isMe ? "You" : (ctx.nameForActor(actorId) ?? "Selected");
	const { primary, more } = isMe
		? classify(ctx.selfActions())
		: classify(ctx.actionsForActor(actorId));
	const infoRef = !isMe && ctx.isReadableOccupant(actorId) ? `occupant:${actorId}` : undefined;
	const subjects: SelectionSubject[] = [
		{ id: actorId, name, ...(infoRef ? { infoRef } : {}), primary, more },
	];
	return {
		title: "Selected",
		subjects,
		...(rowIsEmpty(subjects) ? { note: "Nothing is offered from here." } : {}),
	};
}

/**
 * The one live selection row, or `null` when nothing is selected or the
 * selection has gone stale (the fight ended, the place changed, the actor
 * left) — the caller clears its own `selection` state when this returns
 * `null` for a non-null selection, so a later click on the same id is never
 * silently suppressed.
 */
export function selectionRowFromView(
	view: PlayView,
	selection: Selection,
	ctx: SelectionContext,
): SelectionRow | null {
	if (selection === null) return null;
	if (selection.kind === "exit") {
		const exit = view.place?.exits.find((entry) => entry.handle === selection.handle);
		if (!exit) return null;
		const name = exit.toName || exit.label;
		return {
			title: "Selected",
			subjects: [
				{
					id: `exit:${exit.handle}`,
					name,
					primary: [{ id: `move:${exit.handle}`, label: `Travel to ${name}` }],
					more: [],
				},
			],
		};
	}
	if (selection.kind === "item") {
		const item = view.pack.find((entry) => entry.id === selection.itemId);
		if (!item) return null;
		const detail = view.itemDetail?.id === item.id ? view.itemDetail : null;
		const entityId = detail?.entityId ?? detail?.id;
		const contextual =
			entityId === undefined
				? []
				: view.actions.filter(
						(action) =>
							action.targetRef === `item:${entityId}` || action.targetRef === `entity:${entityId}`,
					);
		const actions =
			!detail || detail.failed
				? []
				: [
						...new Map(
							[...contextual, ...detail.verbs].map((action) => [action.id, action]),
						).values(),
					];
		return {
			title: "Selected",
			subjects: [
				{ id: `item:${item.id}`, name: item.name, itemActions: actions, ...classify(actions) },
			],
			...(actions.length === 0
				? {
						note: !detail
							? "Loading actions on this item…"
							: detail.failed
								? "Could not load actions on this item."
								: "No actions on this item are offered here.",
					}
				: {}),
		};
	}
	if (selection.kind === "actor") return actorRow(selection.actorId, view, ctx);
	if (selection.kind === "place") return placeRow(selection.nodeId, ctx);
	return cellRow(selection.nodeId, ctx);
}

/**
 * The selection to keep once the hero's place has changed (sk-jay0.1.8.99):
 * a `{kind: "place"}` selection whose node became the place just reached is
 * dropped — it named a destination, and the trip is over. Without this the
 * selection outlived the walk (`placeRow` answers "You are here." for the own
 * place, so the row never went stale) and on arrival prefilled the composer
 * with the place the hero already stands in.
 *
 * Call it only on a place CHANGE, with the new place's id. It is not a
 * staleness rule of `selectionRowFromView`: a deliberate click on the
 * current place stays a valid selection, and so does its prefill. Every
 * other selection is returned unchanged (the same object).
 */
export function selectionAfterArrival(
	selection: Selection,
	arrivedPlaceId: string | null,
): Selection {
	if (selection === null || arrivedPlaceId === null) return selection;
	return selection.kind === "place" && selection.nodeId === arrivedPlaceId ? null : selection;
}
