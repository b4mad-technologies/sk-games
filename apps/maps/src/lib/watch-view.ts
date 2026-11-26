import type { OccupancyPlace } from "@spellkave/map-canvas";
import type { WatchActor, WatchEvent, WatchItem } from "@spellkave/sdk";
import type { Occupant } from "@spellkave/ui-widgets";

export type MineWatchArgs = {
	slug: string;
	places: import("@spellkave/map-canvas").ActorPlace[];
	mineEntityIds: string[];
	overlay: boolean;
	occupancy: OccupancyPlace[];
	actors: WatchActor[];
	items?: WatchItem[];
	events: WatchEvent[];
	/** True once the watch frame has actually carried actors. The first
	 * emission AND the empty-snapshot bootstrap both arrive with actors === []
	 * (top-up rows not landed yet) — neither may wipe a pending selection. */
	framePopulated: boolean;
	oldestTick: number;
	latestTick: number;
	cursorTick: number;
	live: boolean;
	pause: () => void;
	play: () => void;
	scrub: (tick: number) => void;
};

/** Ground items only. Carried attacks/gear stay on the person, not as extra pins. */
export function thingsFromWatch(items: readonly WatchItem[] = []): OccupancyPlace[] {
	return items
		.filter((item) => item.placeNodeId !== "" && item.holderEntityId === null)
		.map((item) => ({
			entityId: item.entityId,
			placeNodeId: item.placeNodeId,
			name: item.name,
		}));
}

/** "core/main_hand" / "srd/slot/main-hand" → "main hand" (leaf-humanized).
 * The readable equipment-slot label lives in a table the watch buffer does
 * not subscribe; the slot id's leaf is the pragmatic label (sk-jay0.4.4.3). */
export function slotLabel(slotId: string): string {
	const leaf = slotId.split("/").pop() ?? slotId;
	return leaf.replaceAll("_", " ").replaceAll("-", " ");
}

export type CarriedItemRow = {
	id: string;
	name: string;
	quantity: number;
	equipped: string | null;
	href: string;
};

/** The inspect panel's CARRYING list: this holder's items, same-name stacks
 * collapsed to one row (quantity = count, id = the stack's lowest entityId
 * so the link stays stable), equipped filled from the containment slot. */
export function carriedFromWatch(
	items: readonly WatchItem[],
	holderEntityId: string,
	buildHref: (entityId: string) => string,
): CarriedItemRow[] {
	const stacks = new Map<string, { ids: string[]; slotId: string }>();
	for (const item of items) {
		if (item.holderEntityId !== holderEntityId) continue;
		const stack = stacks.get(item.name) ?? { ids: [], slotId: "" };
		stack.ids.push(item.entityId);
		if (stack.slotId === "" && item.slotId !== "") stack.slotId = item.slotId;
		stacks.set(item.name, stack);
	}
	const byEntityId = (a: string, b: string): number => {
		const na = Number(a);
		const nb = Number(b);
		if (Number.isSafeInteger(na) && Number.isSafeInteger(nb)) return na - nb;
		return a.localeCompare(b);
	};
	const out: CarriedItemRow[] = [];
	for (const [name, stack] of stacks) {
		const id = stack.ids.slice().sort(byEntityId)[0] ?? "";
		out.push({
			id,
			name,
			quantity: stack.ids.length,
			equipped: stack.slotId === "" ? null : slotLabel(stack.slotId),
			href: buildHref(id),
		});
	}
	return out;
}

/** Keep a boot/deep-link selection pending until a watch frame that
 * actually carries actors can vouch for or reject it. Three inputs map to
 * "pending, do not touch": `actors === null` (the seat-less/null emission
 * SeatBoard fires before any world state), an unpopulated frame, and an
 * empty actors list (pre-top-up or the empty-snapshot bootstrap) — none of
 * them can confirm or deny the id, and clearing on any of them wiped
 * /person/<id> deep links before the real frame landed (sk-jay0.4.4.1). */
export function retainSelection(
	current: string | null,
	actors: readonly { entityId: string }[] | null,
	framePopulated: boolean,
): string | null {
	if (current === null) return null;
	if (actors === null || !framePopulated || actors.length === 0) return current;
	return actors.some((actor) => actor.entityId === current) ? current : null;
}

export function occupancyFromWatch(
	actors: readonly WatchActor[],
	mineEntityIds: Iterable<string>,
): OccupancyPlace[] {
	const mine = new Set([...mineEntityIds].map(String));
	return actors.map((actor) => ({
		entityId: actor.entityId,
		placeNodeId: actor.placeNodeId,
		name: actor.name,
		mine: mine.has(actor.entityId),
	}));
}

export function occupantsFromWatch(actors: readonly WatchActor[]): Occupant[] {
	return actors.map((actor) => ({
		id: actor.entityId,
		name: actor.name,
		kind: "person" as const,
		note: actor.placeNodeId,
		sceneKind: "actor",
		conditions: actor.conditions.map((c) => c.id),
	}));
}

/** `elven_mini/inn/common_room` → `Inn · Common room`. */
export function humanizePlaceNode(nodeId: string): string {
	const parts = nodeId.split("/").filter((part) => part !== "");
	if (parts.length === 0) return nodeId;
	const rest = parts.length > 1 ? parts.slice(1) : parts;
	return rest
		.map((part) => part.replaceAll("_", " "))
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" · ");
}

/** Notice for an actor standing where the map has no coordinates: the node
 * lives in a place graph the map deliberately does not draw (e.g. a creation
 * limbo), so there is no marker and no place to fly to. Null when the node
 * is drawable (or unknown — empty node id), meaning "no notice needed". */
export function offMapNotice(placeNodeId: string, drawable: ReadonlySet<string>): string | null {
	if (placeNodeId === "" || drawable.has(placeNodeId)) return null;
	return `Off the map — ${humanizePlaceNode(placeNodeId)} is not drawn on this map.`;
}

function conditionLabel(id: string): string {
	const leaf = id.split("/").pop() ?? id;
	return leaf.replaceAll("_", " ");
}

function includeInspectState(stateId: string): boolean {
	const id = stateId.toLowerCase();
	if (/\/hp$|\/ac$|hit.?point|armor.?class/.test(id)) return false;
	if (
		id.includes("quest") ||
		id.includes("dm/") ||
		id.includes("dialog") ||
		id.includes("companion")
	) {
		return false;
	}
	return !id.includes("/");
}

function stateLabel(stateId: string, displayName: string): string {
	if (/\/hp$/.test(stateId)) return "HP";
	if (/\/ac$/.test(stateId)) return "AC";
	if (displayName.includes("/")) return conditionLabel(displayName);
	return displayName;
}

/** The rail Inspect card's fact list. Was the play widget's
 * `EntityDetailBody`; Maps owns the shape now that no play widget renders
 * in this app (sk-jay0.4.4.7). */
export interface ActorFactsView {
	id: string;
	facts: { id: string; label: string; value: string }[];
}

export function entityDetailFromWatch(actor: WatchActor | undefined): ActorFactsView | null {
	if (actor === undefined) return null;
	const facts: ActorFactsView["facts"] = [
		{ id: "place", label: "Place", value: humanizePlaceNode(actor.placeNodeId) },
	];
	if (actor.faction !== null) {
		facts.push({ id: "faction", label: "Faction", value: actor.faction });
	}
	for (const condition of actor.conditions) {
		facts.push({
			id: `condition:${condition.id}`,
			label: "Condition",
			value:
				condition.stack_count > 1
					? `${conditionLabel(condition.id)} ×${condition.stack_count}`
					: conditionLabel(condition.id),
		});
	}
	for (const state of actor.states) {
		if (!includeInspectState(state.state_id)) continue;
		facts.push({
			id: state.state_id,
			label: stateLabel(state.state_id, state.display_name),
			value: state.value,
		});
	}
	return { id: actor.entityId, facts };
}
