/**
 * The ONE resolver behind every `InfoLink` in Play's Table stream, dock, and
 * full character sheet
 * (bead sk-jay0.1.8.63.10). Cards show information only — never a verb; an
 * action always lives in the dock's hotbar, never here (axiom A1).
 *
 * A typed ref scheme, one small function per kind, all reading from data
 * Play already has (or, for `def:`, the isolated `reference-adapter.ts`
 * stand-in — see that module's own header). Kept free of Svelte: every read
 * that needs a live session (the occupant's on-demand detail, the website's
 * public vocabulary) is injected through `InfoCardReadCtx`, so this module
 * is testable with a fixture `PlayView` and stub reads, no component mount
 * required.
 */
import type { InfoCardData, InfoCardFact, InfoRichText } from "@spellkave/ui";
import type { PlayAction, PlayOccupant, PlayOccupantDetail, PlayView } from "./play-view";

/** What `def:<entityDefId>` resolves through today — the website's public
 * compendium vocabulary, until a world read exists for entity/definition
 * prose (sk-jay0.1.8.63.11 tracks moving this ref kind to one). */
export interface DefinitionCardSource {
	title: string;
	description?: string;
	href?: string;
}

export interface InfoCardReadCtx {
	view: PlayView;
	/** Every action this session currently knows about, by handle — the SAME
	 * map `PlayTable.svelte` already builds for its own `act()` dispatch
	 * (`view.actions` plus the selected item's/occupant's own on-demand
	 * verbs), so an `action:<id>` ref resolves an offer from wherever the
	 * table already knows it, never a second lookup. */
	actionsById: ReadonlyMap<string, PlayAction>;
	/**
	 * Triggers (or reuses) the existing on-demand `spellkave_scene_detail`
	 * read for this occupant and resolves with its answer once one is
	 * available — never a read this module invents itself. Rejects when
	 * that read came back failed: a failed read is never an empty success,
	 * so the card must show its own error state, not "not found".
	 */
	readOccupant: (id: string) => Promise<PlayOccupantDetail>;
	/** `def:` cards' one stand-in source — see `DefinitionCardSource`. `null`
	 * means the adapter genuinely has nothing for this id. */
	readDefinition: (entityDefId: string) => Promise<DefinitionCardSource | null>;
}

export type InfoCardRefKind = "occupant" | "def" | "condition" | "place" | "action" | "hero";

export interface InfoCardRef {
	kind: InfoCardRefKind;
	id: string;
}

const REF_KINDS: ReadonlySet<string> = new Set<InfoCardRefKind>([
	"occupant",
	"def",
	"condition",
	"place",
	"action",
	"hero",
]);

/** `occupant:4` → `{kind: "occupant", id: "4"}`. `null` for anything this
 * scheme does not recognize — the card renders its own not-found state. */
export function parseInfoCardRef(refId: string): InfoCardRef | null {
	const separator = refId.indexOf(":");
	if (separator < 0) return null;
	const kind = refId.slice(0, separator);
	const id = refId.slice(separator + 1);
	if (id === "" || !REF_KINDS.has(kind)) return null;
	return { kind: kind as InfoCardRefKind, id };
}

function occupantKindLabel(kind: PlayOccupant["kind"]): string {
	return kind === "thing" ? "Object" : kind === "creature" ? "Creature" : "Person";
}

async function occupantCard(id: string, ctx: InfoCardReadCtx): Promise<InfoCardData | null> {
	const occupant = ctx.view.occupants.find((entry) => entry.id === id);
	if (occupant === undefined) return null;
	const detail = await ctx.readOccupant(id);
	const facts: InfoCardFact[] = detail.facts.map((fact) => ({
		label: fact.label,
		value: fact.value,
	}));
	// Body carries ONLY the link to the occupant's own definition, when the
	// scene listing (or the targeted detail read) resolved one — the
	// description itself is the card's `summary`; `body` never repeats it.
	const defId = detail.defId ?? occupant.defId;
	const body: InfoRichText = defId ? [{ refId: `def:${defId}`, text: "Full definition" }] : [];
	return {
		title: occupant.name,
		kind: occupantKindLabel(occupant.kind),
		...(detail.description ? { summary: detail.description } : {}),
		...(facts.length > 0 ? { facts } : {}),
		...(body.length > 0 ? { body } : {}),
	};
}

async function definitionCard(id: string, ctx: InfoCardReadCtx): Promise<InfoCardData | null> {
	const source = await ctx.readDefinition(id);
	if (source === null) return null;
	return {
		title: source.title,
		...(source.description ? { summary: source.description } : {}),
		...(source.href ? { footerHref: source.href } : {}),
	};
}

function conditionCard(id: string, ctx: InfoCardReadCtx): InfoCardData | null {
	// Only the hero's OWN condition — a stray `condition:<id>` for anything
	// else (an NPC's, an authored id no longer on the sheet) renders as
	// not-found rather than guessing at another actor's condition.
	const condition = ctx.view.hero.conditionDetails?.find((entry) => entry.id === id);
	if (condition === undefined) return null;
	const facts: InfoCardFact[] = [];
	if (condition.stackCount !== undefined)
		facts.push({ label: "Stacks", value: String(condition.stackCount) });
	if (condition.expiresAtTick !== undefined) {
		facts.push({ label: "Expires", value: `Tick ${condition.expiresAtTick}` });
	}
	return {
		title: condition.label,
		kind: "Condition",
		...(condition.description ? { summary: condition.description } : {}),
		...(facts.length > 0 ? { facts } : {}),
	};
}

function placeCard(id: string, ctx: InfoCardReadCtx): InfoCardData | null {
	// Play has no arbitrary place lookup (only the current one) — a
	// `place:<id>` for anywhere else renders as not-found, never invented
	// from an exit's own display name alone.
	const place = ctx.view.place;
	if (place === null || place.id !== id) return null;
	return {
		title: place.name,
		kind: "Place",
		...(place.description ? { summary: place.description } : {}),
		...(place.exits.length > 0
			? { facts: place.exits.map((exit) => ({ label: exit.label || "Exit", value: exit.toName })) }
			: {}),
	};
}

function actionCard(id: string, ctx: InfoCardReadCtx): InfoCardData | null {
	const action = ctx.actionsById.get(id);
	if (action === undefined) return null;
	return {
		title: action.label,
		kind: "Action",
		...(action.description ? { summary: action.description } : {}),
		...(action.targetName ? { facts: [{ label: "Target", value: action.targetName }] } : {}),
	};
}

function heroDescription(
	description: string | undefined,
	state: "ready" | "failed" | undefined,
): string {
	if (state === "failed") return "Description could not be loaded.";
	return description?.trim() || "No description available.";
}

/** The full-sheet reader uses one `hero:<section>:<id>` namespace so its
 * links share Play's standard popover stack without teaching the generic
 * Hero widget about app reads or a second overlay primitive. */
function heroCard(id: string, ctx: InfoCardReadCtx): InfoCardData | null {
	const separator = id.indexOf(":");
	if (separator < 0) return null;
	const section = id.slice(0, separator);
	const fieldId = id.slice(separator + 1);
	const { hero } = ctx.view;
	if (section === "identity") {
		const index = Number(fieldId);
		if (!Number.isInteger(index) || index < 0) return null;
		const identity = [hero.species, hero.className, hero.background]
			.filter((label): label is string => !!label)
			.map((label) => ({
				label,
				description: hero.identityDetails?.find((facet) => facet.label === label)?.description,
			}));
		const facet =
			identity[index] ?? (identity.length === 0 ? hero.identityDetails?.[index] : undefined);
		return facet
			? {
					title: facet.label,
					kind: "Character sheet",
					summary: heroDescription(facet.description, hero.descriptionReads?.identity),
				}
			: null;
	}
	if (section === "vital") {
		const vital = hero.vitals.find((candidate) => candidate.id === fieldId);
		if (vital) {
			return {
				title: vital.label,
				kind: "Character sheet",
				summary: heroDescription(vital.description, hero.descriptionReads?.values),
				facts: [{ label: "Value", value: vital.value }],
			};
		}
		if (fieldId === "srd/xp" && hero.xp !== undefined)
			return {
				title: "Experience",
				kind: "Character sheet",
				facts: [{ label: "Value", value: String(hero.xp) }],
			};
		if (fieldId === "srd/proficiency_bonus" && hero.proficiency !== undefined)
			return {
				title: "Proficiency",
				kind: "Character sheet",
				summary: heroDescription(hero.proficiencyDescription, hero.descriptionReads?.values),
				facts: [{ label: "Value", value: String(hero.proficiency) }],
			};
		return null;
	}
	if (section === "ability") {
		const ability = hero.abilities.find((candidate) => candidate.id === fieldId);
		return ability
			? {
					title: ability.label,
					kind: "Character sheet",
					summary: heroDescription(ability.description, hero.descriptionReads?.values),
					facts: [
						{ label: "Value", value: String(ability.score) },
						{ label: "Modifier", value: `${ability.modifier >= 0 ? "+" : ""}${ability.modifier}` },
					],
				}
			: null;
	}
	if (section === "condition") {
		const condition = hero.conditionDetails?.find((candidate) => candidate.id === fieldId);
		return condition
			? {
					title: condition.label,
					kind: "Condition",
					summary: heroDescription(condition.description, hero.descriptionReads?.conditions),
					facts: [
						...(condition.stackCount === undefined
							? []
							: [{ label: "Stacks", value: String(condition.stackCount) }]),
						...(condition.expiresAtTick === undefined
							? []
							: [{ label: "Expires at world tick", value: String(condition.expiresAtTick) }]),
					],
				}
			: null;
	}
	if (section === "quest") {
		const quest = hero.quest?.find((candidate) => candidate.id === fieldId);
		return quest
			? {
					title: quest.label,
					kind: "Character sheet",
					summary: heroDescription(quest.description, hero.descriptionReads?.values),
					facts: [{ label: "Value", value: quest.value }],
				}
			: null;
	}
	if (section === "skill" || section === "mastery") {
		const capability = (section === "skill" ? hero.skills : hero.masteries).find(
			(candidate) => candidate.id === fieldId,
		);
		return capability
			? {
					title: capability.label,
					kind: section === "skill" ? "Skill" : "Mastery",
					summary: "No description available.",
				}
			: null;
	}
	return null;
}

/** The one `InfoCardResolve` every `InfoLink` in the Table stream and the
 * dock shares (via `InfoCardProvider`'s `resolve` prop) — dispatches on the
 * ref's own kind, never on which component rendered the link. */
export async function resolveInfoCard(
	refId: string,
	ctx: InfoCardReadCtx,
): Promise<InfoCardData | null> {
	const ref = parseInfoCardRef(refId);
	if (ref === null) return null;
	switch (ref.kind) {
		case "occupant":
			return occupantCard(ref.id, ctx);
		case "def":
			return definitionCard(ref.id, ctx);
		case "condition":
			return conditionCard(ref.id, ctx);
		case "place":
			return placeCard(ref.id, ctx);
		case "action":
			return actionCard(ref.id, ctx);
		case "hero":
			return heroCard(ref.id, ctx);
	}
}
