// A fight, as the world view sees it.
//
// While a fight runs on a session grid, the scene lists no occupants: the
// world names the fighters only in the turn roster, and discloses them as
// targets. This module turns those two facts into tokens the player can
// click, so a foe gets the same click menu as anyone else.
//
// When the map plate carries the session grid, the fight is played on it
// (`gridTokens`, `cellClick`): a click on a neighbour cell steps, a click on
// a fighter opens its menu. Without a grid on the plate the fighters stand on
// the stage at invented spots and the neighbour cells are "Step" labels.
// The world refuses a step onto an occupied cell.

import {
	actionsForDisclosedEntity,
	type PlayAction,
	type PlayExit,
	type PlayOccupant,
	type PlayView,
} from "../../../play/src/lib/play-view";
import { inFight } from "./menu";

/** One token on the grid, in the shape the BattleMap widget draws. */
export type GridToken = {
	nodeId: string;
	actorId: string;
	name: string;
	isMe?: boolean;
	tone?: "ally" | "foe" | "neutral";
	image?: string;
};

/** A token that came from the turn roster, not from the scene. */
export type FightToken = PlayOccupant & { fromRoster: true };

const CREATURE_DEFINITION = /^srd\/creature\/[^/]+$/;

/**
 * The other fighters as tokens. Someone the scene already lists is left to
 * the scene. The definition id (for the SRD art) is the creature niche the
 * world discloses on the target.
 */
export function fightTokens(view: PlayView): FightToken[] {
	if (!inFight(view.session)) return [];
	const listed = new Set(view.occupants.map((occupant) => occupant.id));
	const targets =
		view.manipulationContext.status === "ready" ? view.manipulationContext.targets : [];
	return view.session.roster
		.filter((entry) => !entry.isMe && !listed.has(entry.actorId))
		.map((entry) => {
			const niches =
				targets.find((target) => target.targetRef === `entity:${entry.actorId}`)?.nicheIds ?? [];
			const defId = niches.find((niche) => CREATURE_DEFINITION.test(niche));
			return {
				fromRoster: true as const,
				id: entry.actorId,
				handle: "",
				rev: "",
				kind: "creature" as const,
				sceneKind: "actor",
				name: entry.name,
				conditions: [],
				note: entry.isCurrent ? "In the fight. Acting now." : "In the fight.",
				...(defId ? { defId } : {}),
			};
		});
}

/**
 * Everything the client can pair with one fighter. The scene's own detail
 * read needs a scene handle, which a roster token does not have; the
 * disclosed facts are joined directly instead.
 */
export function actionsOnFighter(view: PlayView, id: string): PlayAction[] {
	const joined = actionsForDisclosedEntity(view.manipulationContext, id);
	const seen = new Set(joined.map((action) => action.id));
	return [
		...joined,
		...view.actions.filter((action) => action.targetRef === `entity:${id}` && !seen.has(action.id)),
	];
}

/** One part of the turn's budget, as a word the player can read. */
export type BudgetChip = {
	id: string;
	label: string;
	state: "ready" | "partly" | "spent";
	left: string;
};

// The ruleset's own channels; the kernel's generic ones repeat two of them.
const SRD_CHANNEL = /^srd\/economy_channel\//;

const MOVEMENT_CHANNEL = "srd/economy_channel/movement";

/** How much movement the world says is left this turn; null when it does not say. */
export function movementLeft(view: PlayView): number | null {
	if (!view.economyBudget || view.economyBudget.unavailable) return null;
	return (
		view.economyBudget.channels.find((channel) => channel.channelId === MOVEMENT_CHANNEL)
			?.remainingMs ?? null
	);
}

/**
 * What one step cost, measured: the movement left before a step that
 * arrived, minus the movement left after it. Null when the numbers do not
 * show a cost (no number, or nothing was spent).
 */
export function observedStepCost(beforeMs: number | null, afterMs: number | null): number | null {
	if (beforeMs === null || afterMs === null) return null;
	const cost = beforeMs - afterMs;
	return cost > 0 ? cost : null;
}

/**
 * What the hero still has this turn: action, bonus action, movement,
 * reaction. Only what the world reports. The world gives movement as a
 * share, not as steps; with `stepCostMs` (what the last step here was seen
 * to cost, `observedStepCost`) the movement chip counts whole steps of that
 * cost instead. Other ground may cost more; the world answers each step.
 */
export function turnBudget(view: PlayView, stepCostMs?: number | null): BudgetChip[] {
	if (!inFight(view.session) || !view.economyBudget || view.economyBudget.unavailable) return [];
	return view.economyBudget.channels.flatMap((channel) => {
		// A channel without disclosed numbers is not shown as ready or spent.
		const { poolMs, remainingMs } = channel;
		if (
			!SRD_CHANNEL.test(channel.channelId) ||
			poolMs === null ||
			remainingMs === null ||
			poolMs <= 0
		)
			return [];
		const share = Math.max(0, Math.min(1, remainingMs / poolMs));
		if (channel.channelId === MOVEMENT_CHANNEL && stepCostMs) {
			const steps = Math.floor(Math.max(0, remainingMs) / stepCostMs);
			const chip: BudgetChip = {
				id: channel.channelId,
				label: channel.label,
				state: steps === 0 ? "spent" : share >= 1 ? "ready" : "partly",
				left: steps === 1 ? "1 step left" : `${steps} steps left`,
			};
			return [chip];
		}
		const state = share >= 1 ? "ready" : share <= 0 ? "spent" : "partly";
		const chip: BudgetChip = {
			id: channel.channelId,
			label: channel.label,
			state,
			left: state === "partly" ? `${Math.round(share * 100)}% left` : state,
		};
		return [chip];
	});
}

/**
 * The fighters on their cells, as the map tool placed them. `images` maps a
 * fighter's id to a picture the app resolved; the others keep their initials.
 * Everyone but the hero is drawn in the foe tone: the world names the
 * fighters of a session, not their sides.
 */
export function gridTokens(
	view: PlayView,
	images: Readonly<Record<string, string>> = {},
): GridToken[] {
	return (view.sessionTokens ?? []).map((token) => ({
		nodeId: token.nodeId,
		actorId: token.actorId,
		name: token.name,
		...(token.isMe ? { isMe: true } : { tone: "foe" as const }),
		...(images[token.actorId] ? { image: images[token.actorId] } : {}),
	}));
}

/** What a click on one grid cell means. */
export type CellClick =
	| { kind: "fighter"; fighter: FightToken }
	| { kind: "step"; exit: PlayExit }
	| { kind: "nothing" };

/**
 * A cell with another fighter on it opens that fighter's menu; a free cell a
 * way out leads to is a step; anything else (the hero's own cell, a cell out
 * of reach) is nothing. With several fighters on one cell the first one the
 * turn roster lists is picked.
 */
export function cellClick(view: PlayView, nodeId: string): CellClick {
	const here = (view.sessionTokens ?? []).filter((token) => token.nodeId === nodeId && !token.isMe);
	if (here.length > 0) {
		const ids = new Set(here.map((token) => token.actorId));
		const fighter = fightTokens(view).find((token) => ids.has(token.id));
		return fighter ? { kind: "fighter", fighter } : { kind: "nothing" };
	}
	const exit = view.place?.exits.find((candidate) => candidate.toNodeId === nodeId);
	return exit ? { kind: "step", exit } : { kind: "nothing" };
}
