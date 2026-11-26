/** The Maps detail drawer's body, projected as a catalogue entry
 * (sk-jay0.4.4.7).
 *
 * WHY A PROJECTION AND NOT MARKUP: Maps is not a play table. It is a
 * reference over what is in the world right now, the same job the docs
 * site (design.spellkave.com/#/docs/entity) does over what is in the
 * adventure and the SRD. So the drawer renders through the SAME widgets
 * (`@spellkave/ui-widgets/catalogue`) over the SAME row shape
 * (`DocsRowEntryView`), and everything Maps-specific happens here, in one
 * pure function with no Svelte and no DOM.
 */
import type { WatchActor, WatchItem } from "@spellkave/sdk";
import type {
	DocsReferenceGroup,
	DocsRowEntryReference,
	DocsRowEntryView,
	DocsRowField,
} from "@spellkave/ui-widgets/catalogue";
import { stateFieldView } from "./state-labels";
import { carriedFromWatch, humanizePlaceNode, offMapNotice, slotLabel } from "./watch-view";

/** The drawer's subject. `manifestRef` is the authored
 * `visible_manifest_authored_entity` ref when the caller knows it; the watch frame
 * does NOT carry it today (`WatchActor`/`WatchItem` have no def id — see
 * the discovered bead in this change's notes), so it is optional and the
 * ref falls back to `entity:<id>`. */
export type DrawerSubject =
	| { kind: "person"; actor: WatchActor; manifestRef?: string }
	| { kind: "thing"; item: WatchItem; manifestRef?: string }
	| { kind: "place"; nodeId: string; description?: string | null; manifestRef?: string };

export interface DrawerOccupant {
	entityId: string;
	placeNodeId: string;
	name: string;
}

export interface DrawerFrame {
	actors: readonly WatchActor[];
	items: readonly WatchItem[];
	occupancy: readonly DrawerOccupant[];
	/** Node ids the map has coordinates for — drives the off-map notice. */
	drawableNodes: ReadonlySet<string>;
}

/** Locator builders. Maps hands in `buildMapsLocator`-backed hrefs so the
 * catalogue widgets stay ignorant of Maps' routing. */
export interface DrawerLinks {
	person: (entityId: string) => string;
	thing: (entityId: string) => string;
	place: (nodeId: string) => string;
}

/** State ids that are DM / adventure bookkeeping, not world facts a reader
 * wants: the DM seat's own `dm/` states, quest flags and reward ledgers
 * (`elven_mini/quest/Q4/rewarded`), dialog cursors and companion agreements.
 * Same families the rail card already hides (watch-view includeInspectState);
 * Aldwin alone carries 20+ quest rows that would bury his real facts. */
function isOperatorState(stateId: string): boolean {
	const id = stateId.toLowerCase();
	return (
		id.startsWith("dm/") ||
		id.includes("/quest/") ||
		id.includes("/dialog/") ||
		id.includes("/companion/")
	);
}

/** `FieldList` keys its rows by label, so a repeated label aborts the
 * render (`each_key_duplicate`). Two state ids can humanize to the same
 * words; the second one keeps its id so both rows stay visible. */
function withUniqueLabels(fields: DocsRowField[]): DocsRowField[] {
	const seen = new Set<string>();
	return fields.map((field) => {
		if (!seen.has(field.label)) {
			seen.add(field.label);
			return field;
		}
		let label = field.label;
		let n = 2;
		while (seen.has(label)) {
			label = `${field.label} (${n})`;
			n += 1;
		}
		seen.add(label);
		return { ...field, label };
	});
}

function stateFields(states: readonly { state_id: string; value: string }[]): DocsRowField[] {
	return states
		.filter((state) => !isOperatorState(state.state_id))
		.map((state) => {
			const view = stateFieldView(state.state_id, state.value);
			return { label: view.label, value: view.value, code: view.code };
		});
}

function conditionLabel(id: string): string {
	const leaf = id.split("/").pop() ?? id;
	return leaf.replaceAll("_", " ").replaceAll("-", " ");
}

function entityRef(entityId: string, manifestRef?: string): string {
	return manifestRef !== undefined && manifestRef !== "" ? manifestRef : `entity:${entityId}`;
}

/** The place group: one entry, linked only when the map can fly there.
 * Off-map nodes carry the notice as the entry's summary instead of a link. */
function placeGroup(
	nodeId: string,
	frame: DrawerFrame,
	links: DrawerLinks,
): DocsReferenceGroup | null {
	if (nodeId === "") return null;
	const notice = offMapNotice(nodeId, frame.drawableNodes);
	const entry: DocsRowEntryReference = {
		ref: `place:${nodeId}`,
		title: humanizePlaceNode(nodeId),
		href: notice === null ? links.place(nodeId) : undefined,
		summary: notice ?? undefined,
	};
	return { label: "Place", entries: [entry] };
}

function alsoHereGroup(
	actor: WatchActor,
	frame: DrawerFrame,
	links: DrawerLinks,
): DocsReferenceGroup | null {
	const entries = frame.occupancy
		.filter((row) => row.placeNodeId === actor.placeNodeId && row.entityId !== actor.entityId)
		.map((row) => ({
			ref: `entity:${row.entityId}`,
			title: row.name,
			href: links.person(row.entityId),
		}));
	return entries.length > 0 ? { label: "Also here", entries } : null;
}

function carryingGroup(
	actor: WatchActor,
	frame: DrawerFrame,
	links: DrawerLinks,
): DocsReferenceGroup | null {
	const rows = carriedFromWatch(frame.items, actor.entityId, links.thing);
	if (rows.length === 0) return null;
	return {
		label: "Carrying",
		entries: rows.map((row) => ({
			ref: `entity:${row.id}`,
			title: row.quantity > 1 ? `${row.name} ×${row.quantity}` : row.name,
			href: row.href,
			summary: row.equipped === null ? undefined : `Equipped · ${row.equipped}`,
		})),
	};
}

function personView(
	actor: WatchActor,
	manifestRef: string | undefined,
	frame: DrawerFrame,
	links: DrawerLinks,
): DocsRowEntryView {
	const fields: DocsRowField[] = [];
	if (actor.faction !== null && actor.faction !== "") {
		fields.push({ label: "Faction", value: actor.faction });
	}
	if (actor.conditions.length > 0) {
		fields.push({
			label: "Conditions",
			value: actor.conditions
				.map((condition) =>
					condition.stack_count > 1
						? `${conditionLabel(condition.id)} ×${condition.stack_count}`
						: conditionLabel(condition.id),
				)
				.join(", "),
		});
	}
	fields.push(...stateFields(actor.states));
	const references = [
		placeGroup(actor.placeNodeId, frame, links),
		carryingGroup(actor, frame, links),
		alsoHereGroup(actor, frame, links),
	].filter((group): group is DocsReferenceGroup => group !== null);
	return {
		ref: entityRef(actor.entityId, manifestRef),
		title: actor.name,
		kind_label: "Person",
		description: actor.description ?? undefined,
		fields: withUniqueLabels(fields),
		references,
	};
}

function thingView(
	item: WatchItem,
	manifestRef: string | undefined,
	frame: DrawerFrame,
	links: DrawerLinks,
): DocsRowEntryView {
	const fields: DocsRowField[] = [];
	if (item.slotId !== "") {
		fields.push({ label: "Equipped", value: slotLabel(item.slotId) });
	}
	fields.push(...stateFields(item.states));
	if (item.tags.length > 0) {
		fields.push({ label: "Tags", value: item.tags.join(", ") });
	}
	const references: DocsReferenceGroup[] = [];
	if (item.holderEntityId !== null) {
		references.push({
			label: "Held by",
			entries: [
				{
					ref: `entity:${item.holderEntityId}`,
					title: item.holderName ?? item.holderEntityId,
					href: links.person(item.holderEntityId),
				},
			],
		});
	}
	const place = placeGroup(item.placeNodeId, frame, links);
	if (place !== null) references.push(place);
	return {
		ref: entityRef(item.entityId, manifestRef),
		title: item.name,
		kind_label: "Thing",
		description: item.description ?? undefined,
		fields: withUniqueLabels(fields),
		references,
	};
}

function placeView(
	nodeId: string,
	description: string | null | undefined,
	manifestRef: string | undefined,
	frame: DrawerFrame,
	links: DrawerLinks,
): DocsRowEntryView {
	const notice = offMapNotice(nodeId, frame.drawableNodes);
	const fields: DocsRowField[] = [{ label: "Node", value: nodeId, code: true }];
	if (notice !== null) fields.push({ label: "On the map", value: notice });
	const here = frame.occupancy
		.filter((row) => row.placeNodeId === nodeId)
		.map((row) => ({
			ref: `entity:${row.entityId}`,
			title: row.name,
			href: links.person(row.entityId),
		}));
	const references: DocsReferenceGroup[] =
		here.length > 0 ? [{ label: "Here", entries: here }] : [];
	return {
		ref: manifestRef !== undefined && manifestRef !== "" ? manifestRef : `place:${nodeId}`,
		title: humanizePlaceNode(nodeId),
		kind_label: "Place",
		description: description ?? undefined,
		fields,
		references,
	};
}

/** Pure projection: a live subject + the current watch frame + Maps'
 * locator builders → the catalogue row the drawer body renders. */
export function drawerRowView(
	subject: DrawerSubject,
	frame: DrawerFrame,
	links: DrawerLinks,
): DocsRowEntryView {
	if (subject.kind === "person") {
		return personView(subject.actor, subject.manifestRef, frame, links);
	}
	if (subject.kind === "thing") {
		return thingView(subject.item, subject.manifestRef, frame, links);
	}
	return placeView(subject.nodeId, subject.description, subject.manifestRef, frame, links);
}
