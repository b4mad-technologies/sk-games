/**
 * Pure resource-strip helpers — no tool wiring, no Svelte. Turns
 * `PlayEconomyBudget` (`play-view.ts`'s `economyBudgetFromPayload`) into the
 * ordered pips the dock renders above its action row (plan row W6,
 * `ledger/designs/play-interaction-axioms.md` "Decided details" 5). The dock
 * component itself is a different lane; this file only supplies the display
 * model it will read.
 */
import type {
	EconomyBudgetChannelStatus,
	PlayEconomyBudget,
	PlayEconomyBudgetChannel,
} from "./play-view";

export type ResourcePipState = "available" | "partial" | "spent" | "pending" | "unknown";

/** One dock pip: a labelled slot for one action-economy channel. `fraction`
 * is the disclosed remaining share (`1` = full, `0` = empty); `null` when
 * the world has not disclosed a number for this channel yet (`pending` or
 * `unknown`). */
export interface ResourcePip {
	id: string;
	label: string;
	state: ResourcePipState;
	fraction: number | null;
}

/** Stable dock order (axioms doc, "Decided details" 4 applies the same
 * "world order first, then a fixed fallback" idea to traversal): the three
 * SRD channels every actor has appear first in this fixed order, then
 * `object_interaction`, then any other channel — e.g. a future
 * `srd/economy_channel/movement` (sk-0m4.123) — sorted by its full id. */
const CHANNEL_ORDER = ["primary", "bonus", "reaction", "object_interaction"];

/** Short labels for the channel ids the world authors today, keyed by the
 * id's last segment (`srd/economy_channel/primary` → `primary`). A segment
 * not listed here falls back to a title-cased rendering of itself
 * (`channelLabel` below) rather than the raw id. */
const SEGMENT_LABELS: Record<string, string> = {
	primary: "Action",
	bonus: "Bonus",
	reaction: "Reaction",
	object_interaction: "Object",
	movement: "Move",
};

function lastSegment(channelId: string): string {
	const parts = channelId.split("/");
	return parts.length > 0 ? (parts[parts.length - 1] ?? channelId) : channelId;
}

function titleCase(segment: string): string {
	return segment
		.split(/[_-]+/)
		.filter((word) => word !== "")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** A short human label for a channel id, derived from its last segment.
 * `play-view.ts`'s `economyBudgetFromPayload` calls this too, so the mapper
 * and the dock pips never disagree on wording. */
export function channelLabel(channelId: string): string {
	const segment = lastSegment(channelId);
	const known = SEGMENT_LABELS[segment];
	return known ?? titleCase(segment);
}

function orderKey(channelId: string): readonly [number, string] {
	const index = CHANNEL_ORDER.indexOf(lastSegment(channelId));
	return index === -1 ? [CHANNEL_ORDER.length, channelId] : [index, channelId];
}

/** A channel whose world-reported status leaves no disclosed number
 * (`pending_boundary`) or none at all (`unknown_channel`) renders as its own
 * pip state — never a guessed fraction. */
const STATE_FOR_UNDISCLOSED: Record<Exclude<EconomyBudgetChannelStatus, "ok">, ResourcePipState> = {
	pending_boundary: "pending",
	unknown_channel: "unknown",
};

function pipForChannel(channel: PlayEconomyBudgetChannel): ResourcePip {
	const { channelId, label } = channel;
	if (channel.status !== "ok") {
		return { id: channelId, label, state: STATE_FOR_UNDISCLOSED[channel.status], fraction: null };
	}
	if (channel.poolMs === null || channel.remainingMs === null || channel.poolMs <= 0) {
		// `status: "ok"` promises a disclosed row; a pool of 0 or a missing
		// number here is a shape the world has not sent yet, not "spent" —
		// stay honest rather than render a fraction we do not have.
		return { id: channelId, label, state: "unknown", fraction: null };
	}
	const fraction = Math.min(1, Math.max(0, channel.remainingMs / channel.poolMs));
	const state: ResourcePipState = fraction <= 0 ? "spent" : fraction >= 1 ? "available" : "partial";
	return { id: channelId, label, state, fraction };
}

/**
 * `PlayEconomyBudget` → ordered dock pips. `null`/`undefined` (read failed
 * or has not run) and `unavailable` (no world tick observed yet) both render
 * as no pips — the dock falls back to no resource strip rather than
 * inventing zeroed channels the world has not reported.
 */
export function resourcePipsFromBudget(
	budget: PlayEconomyBudget | null | undefined,
): ResourcePip[] {
	if (budget === null || budget === undefined || budget.unavailable) return [];
	return [...budget.channels]
		.sort((a, b) => {
			const [aIndex, aId] = orderKey(a.channelId);
			const [bIndex, bId] = orderKey(b.channelId);
			return aIndex !== bIndex ? aIndex - bIndex : aId.localeCompare(bId);
		})
		.map(pipForChannel);
}
