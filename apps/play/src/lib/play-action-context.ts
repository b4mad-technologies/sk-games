import type { PlayAction } from "./play-view";

export type ActionSurface = "table" | "pack" | "place" | "map";
export interface ActionContext {
	packIds: ReadonlySet<string>;
	occupantIds: ReadonlySet<string>;
}

/** Conversation and combat stay on Table from authored classification, never labels. */
export function isTableBoundOffer(action: Pick<PlayAction, "verb" | "group" | "groups">): boolean {
	return (
		action.verb === "communicate" ||
		action.group === "combat" ||
		Boolean(action.groups?.includes("combat"))
	);
}

/**
 * Things to try in a Place detail: every known verb for the entry. Its buttons
 * only insert into the composer, so conversation and combat verbs stay listed.
 * Numbered answers belong to the open prompt, not to the entry.
 */
export function isPlaceDetailVerb(action: Pick<PlayAction, "slot">): boolean {
	return action.slot === undefined;
}

/**
 * `"srd/check/acrobatics"` → `"srd/check"` — a descriptor's capability
 * family, its first two path segments. Same idiom as `play-table.ts`'s
 * `attackDescriptorFamily` (ADR-0045 siblings share a descriptor family
 * regardless of which target/label backs a given instance); the 24 generic
 * ability/skill checks (`packages/spellkave-srd-cc/src/chapters/
 * playing-the-game/generic-check-units.ts`, `fragments/generic.ts`'s
 * `spellkave_define_action_verb` calls with `id: "check/<slug>"`) all share
 * this ONE family regardless of skill.
 */
function descriptorFamily(descriptor: string): string {
	return descriptor.split("/").slice(0, 2).join("/");
}

const GENERIC_CHECK_DESCRIPTOR_FAMILY = "srd/check";

/**
 * A semantic class, never a label prefix (sk-jay0.1.8.63.9): a scene target
 * offering all 24 generic checks alongside a handful of meaningful verbs
 * (attack, speak, take…) buries the latter in a flat wall of buttons unless
 * a host collapses this class behind its own disclosure — see
 * `EntityDetailProps.isSecondaryVerb` (`@spellkave/ui-widgets`).
 */
export function isGenericCheckAction(action: Pick<PlayAction, "descriptor">): boolean {
	return descriptorFamily(action.descriptor) === GENERIC_CHECK_DESCRIPTOR_FAMILY;
}

/**
 * Targeted affordance_actions rows can omit the listing's combat group page.
 * Keep the catalog handle's authored group/groups when the targeted row has none.
 */
export function retainActionClassification(
	targeted: PlayAction,
	catalog: readonly PlayAction[],
): PlayAction {
	const known = catalog.find((action) => action.id === targeted.id);
	if (known === undefined) return targeted;
	return {
		...targeted,
		...(targeted.group ? {} : known.group ? { group: known.group } : {}),
		...(targeted.groups && targeted.groups.length > 0
			? {}
			: known.groups && known.groups.length > 0
				? { groups: known.groups }
				: {}),
	};
}

/** Play owns this mapping. Authored groups and typed refs remain client independent. */
export function actionSurface(action: PlayAction, context: ActionContext): ActionSurface {
	if (isTableBoundOffer(action)) return "table";
	const separator = action.targetRef.indexOf(":");
	const kind = separator < 0 ? action.targetRef : action.targetRef.slice(0, separator);
	const id = separator < 0 ? "" : action.targetRef.slice(separator + 1);
	if (kind === "item" || (kind === "entity" && context.packIds.has(id))) return "pack";
	if (kind === "place_node" || kind === "place_edge" || kind === "place_node_set") return "map";
	if (
		kind === "world" ||
		action.verb === "sensing" ||
		(kind === "entity" && context.occupantIds.has(id))
	)
		return "place";
	return "table";
}

/** Each handle has one primary home; all offers remain in the central fallback. */
export function contextualActions(actions: readonly PlayAction[], context: ActionContext) {
	const result: Record<ActionSurface | "all", PlayAction[]> = {
		table: [],
		pack: [],
		place: [],
		map: [],
		all: [],
	};
	const seen = new Set<string>();
	for (const action of actions) {
		if (seen.has(action.id)) continue;
		seen.add(action.id);
		result.all.push(action);
		result[actionSurface(action, context)].push(action);
	}
	return result;
}
