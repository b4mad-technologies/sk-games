/** Readable labels and units for the object-state ids the watch frame
 * carries (sk-jay0.4.4.7).
 *
 * WHY THIS LIVES HERE: `WatchActorState.display_name` is NOT a readable
 * name. The watch buffer fills it with the state id itself
 * (`watch-buffer.ts`, `display_name: s.stateId`) because the readable
 * `resource_definition.display_name` lives in a table the buffer does not
 * subscribe. Rendering it raw is what produced "ARMOR STEALTH DISADVANTAGE
 * 1" and "WEIGHT LB10 550" in the drawer.
 *
 * UNITS ARE QUOTED, NEVER GUESSED. Every conversion below cites the
 * srd-cc source that defines it:
 *   - `srd/cost_cp` is copper pieces, 1 GP = 100 CP
 *   - `srd/weight_lb10` is tenths of a pound
 *     (both: packages/spellkave-srd-cc/src/chapters/equipment/item-measures.ts
 *      and docs/equipment-reference-profiles.md § Surface boundary)
 *   - `srd/armor_stealth_disadvantage` is 1 when the armor grants
 *     Disadvantage on Stealth, else 0 (item-measures.ts)
 *   - `srd/reach_mm` is millimetres (fixtures resource description:
 *     "measured in millimetres. The standard reach is 5 feet (1524 mm)")
 *   - `srd/speed-*` is a CELL COUNT, not feet (fixtures resource
 *     description: "authored as a CELL COUNT")
 * A state id whose unit is not documented gets NO conversion: its raw
 * value renders in `<code>` next to its id, so the reader can see exactly
 * what the world holds and that we did not interpret it.
 */

export interface StateFieldView {
	label: string;
	value: string;
	/** True when the value should render in `<code>` — the raw, un-interpreted form. */
	code: boolean;
}

/** "srd/fighter/second-wind-uses" → "Second wind uses". */
export function humanizeStateLeaf(stateId: string): string {
	const leaf = stateId.split("/").pop() ?? stateId;
	const words = leaf.replaceAll("_", " ").replaceAll("-", " ").trim();
	if (words === "") return stateId;
	return words.charAt(0).toUpperCase() + words.slice(1);
}

type Formatter = (value: number) => string;

interface KnownState {
	label: string;
	/** Omitted = the integer renders as-is. */
	format?: Formatter;
}

/** Copper pieces → the SRD's own gp/sp/cp split (1 gp = 100 cp, 1 sp = 10 cp). */
function copperPieces(cp: number): string {
	if (cp === 0) return "0 cp";
	const gp = Math.trunc(cp / 100);
	const sp = Math.trunc((cp % 100) / 10);
	const rest = cp % 10;
	const parts: string[] = [];
	if (gp > 0) parts.push(`${gp} gp`);
	if (sp > 0) parts.push(`${sp} sp`);
	if (rest > 0) parts.push(`${rest} cp`);
	return parts.join(" ");
}

/** Tenths of a pound → pounds, trailing ".0" dropped. */
function poundsFromTenths(tenths: number): string {
	const lb = tenths / 10;
	return `${Number.isInteger(lb) ? lb : lb.toFixed(1)} lb`;
}

const KNOWN: Record<string, KnownState> = {
	"srd/ac": { label: "Armor class" },
	"srd/armor_ac_base": { label: "Armor class" },
	"srd/armor_dex_cap": { label: "Dexterity cap" },
	"srd/armor_str_required": { label: "Strength required" },
	"srd/armor_stealth_disadvantage": {
		label: "Stealth",
		format: (value) => (value === 0 ? "No penalty" : "Disadvantage"),
	},
	"srd/asi_points": { label: "Ability score improvement points" },
	"srd/cha": { label: "Charisma" },
	"srd/con": { label: "Constitution" },
	"srd/cost_cp": { label: "Cost", format: copperPieces },
	"srd/death_save_failures": { label: "Death save failures" },
	"srd/death_save_last_roll": { label: "Death save last roll" },
	"srd/death_save_successes": { label: "Death save successes" },
	"srd/dex": { label: "Dexterity" },
	"srd/heroic_inspiration": { label: "Heroic inspiration" },
	"srd/hit-die": { label: "Hit die" },
	"srd/hp": { label: "Hit points" },
	"srd/hp_per_level": { label: "Hit points per level" },
	"srd/int": { label: "Intelligence" },
	"srd/level": { label: "Character level" },
	"srd/proficiency_bonus": { label: "Proficiency bonus" },
	"srd/reach_mm": { label: "Reach", format: (value) => `${value} mm` },
	"srd/size": { label: "Size" },
	"srd/speed-climb": { label: "Climbing speed", format: cells },
	"srd/speed-fly": { label: "Flying speed", format: cells },
	"srd/speed-swim": { label: "Swimming speed", format: cells },
	"srd/speed-walk": { label: "Walking speed", format: cells },
	"srd/spell_slot_1": { label: "Level 1 spell slots" },
	"srd/spell_slot_2": { label: "Level 2 spell slots" },
	"srd/spellcasting_mod": { label: "Spellcasting modifier" },
	"srd/str": { label: "Strength" },
	"srd/temp_hp": { label: "Temporary hit points" },
	"srd/weight_lb10": { label: "Weight", format: poundsFromTenths },
	"srd/wis": { label: "Wisdom" },
	"srd/xp": { label: "Experience points" },
	"srd/xp_value": { label: "Experience point value" },
};

function cells(value: number): string {
	return `${value} ${value === 1 ? "cell" : "cells"}`;
}

/** The raw, honest rendering: value and the id that produced it. */
function rawField(stateId: string, value: string): StateFieldView {
	return { label: humanizeStateLeaf(stateId), value: `${value} (${stateId})`, code: true };
}

/**
 * One state id + its raw frame value as a readable label/value pair.
 * Unknown ids, and known ids whose value is not the integer the unit
 * assumes, degrade to the raw `<code>` form rather than to a guess.
 */
export function stateFieldView(stateId: string, value: string): StateFieldView {
	const known = KNOWN[stateId];
	if (known === undefined) {
		if (stateId.startsWith("srd/dc/")) {
			return { label: `${humanizeStateLeaf(stateId)} DC`, value, code: false };
		}
		return rawField(stateId, value);
	}
	if (known.format === undefined) return { label: known.label, value, code: false };
	const parsed = Number(value.trim());
	if (!Number.isFinite(parsed))
		return { label: known.label, value: `${value} (${stateId})`, code: true };
	return { label: known.label, value: known.format(parsed), code: false };
}

/** True when this id is documented here — callers can order known fields first. */
export function isKnownStateId(stateId: string): boolean {
	return KNOWN[stateId] !== undefined;
}
