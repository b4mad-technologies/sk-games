import type { PlayObservation } from "./play-observation";

export type FieldSurface = NonNullable<PlayObservation["surface"]>;
const slots: Record<FieldSurface, string> = {
	hero_vitals: "play-vital-value",
	hero_quest: "play-quest-value",
	hero_conditions: "play-condition-value",
	item_detail: "play-item-value",
};

/** Disclosure availability only: no geometry, wording, or user-reading claim. */
function disclosed(node: Element, root: Element): boolean {
	if (node.hasAttribute("data-field-description") || node.hasAttribute("data-field-metadata")) {
		return (
			node.getAttribute("data-field-disclosed") === "true" ||
			node.querySelector('[aria-expanded="true"]') !== null ||
			node.parentElement?.querySelector('[aria-expanded="true"]') !== null
		);
	}
	for (
		let parent = node.parentElement;
		parent && root.contains(parent);
		parent = parent.parentElement
	) {
		if (
			parent.matches("details:not([open])") &&
			!parent.querySelector(":scope > summary")?.contains(node)
		)
			return false;
	}
	return true;
}

export function fieldObservation(
	root: Element,
	surface: FieldSurface,
	supplied: number | undefined,
	state: NonNullable<PlayObservation["detail_state"]>,
): PlayObservation {
	const fields =
		state === "closed"
			? []
			: Array.from(
					root.querySelectorAll(
						`[data-slot="${slots[surface]}"], [data-field-description="${slots[surface]}"], [data-field-metadata="${slots[surface]}"]`,
					),
				);
	return {
		phase: "presentation",
		interaction: 0,
		surface,
		detail_state:
			state === "ready"
				? supplied === undefined
					? "unknown"
					: supplied === 0
						? "empty"
						: "ready"
				: state,
		...(supplied === undefined ? {} : { supplied_fields: supplied }),
		represented_fields: fields.length,
		disclosed_fields: fields.filter((node) => disclosed(node, root)).length,
	};
}

/** Availability is the supplied palette, not a promise that every option is
 * mounted: filters, selected speaker and compact layouts can narrow it. */
export function descriptionObservation(
	root: Element,
	scope: NonNullable<PlayObservation["description_scope"]>,
	available: number | undefined,
	state: NonNullable<PlayObservation["detail_state"]>,
): PlayObservation {
	const nodes = Array.from(root.querySelectorAll('[data-slot="play-action-description"]'));
	return {
		phase: "presentation",
		interaction: 0,
		description_scope: scope,
		detail_state: state,
		...(available === undefined ? {} : { available_descriptions: available }),
		mounted_descriptions: nodes.length,
		reachable_descriptions: nodes.filter((node) => {
			const summary = node.closest("details")?.querySelector(":scope > summary");
			return summary !== null && summary !== undefined && disclosed(summary, root);
		}).length,
		expanded_descriptions: nodes.filter((node) => disclosed(node, root)).length,
	};
}
