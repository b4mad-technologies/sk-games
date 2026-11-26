// SRD art by definition id.
//
// The app is coupled to the SRD ruleset, so an `srd/<kind>/<slug>` definition
// id maps straight to a sprite in packages/spellkave-srd-cc/assets/srd-art.
// Anything else (adventure definitions, unknown kinds) has no SRD art; the
// caller falls back to a glyph or to the world's own art.
//
// Known debt: the sprites are bundled with the app. Once the app is served
// publicly they should come from the gateway like the world's own art.

const sprites = import.meta.glob<string>(
	"../../../../packages/spellkave-srd-cc/assets/srd-art/{character_portrait,creature,item,spell,feat,species,background,skill,divine_order}/*.webp",
	{
		query: "?url",
		import: "default",
	},
);

const DIRECTORY: Record<string, string> = {
	class: "character_portrait",
	creature: "creature",
	item: "item",
	// Weapons and armour are carried things; their sprites sit with the items
	// (`srd/weapon/greatsword`, `srd/armor/chain-mail`, seen live 2026-11-14).
	weapon: "item",
	armor: "item",
	spell: "spell",
	feat: "feat",
	// Families the art set is being given sprites for (sk-jay0.1.76.19.20):
	// until they land, these find nothing and the caller shows no picture.
	species: "species",
	background: "background",
	skill: "skill",
	"divine-order": "divine_order",
};

/**
 * The definition a class choice grants, read from the choice option's id:
 * `srd/advancement-choice-option/fighter/1/feat/archery` grants
 * `srd/feat/archery`. The DM names the option, not what it grants, as an
 * answer's reference; the sprite and the reference guide's page hang on the
 * granted definition. Stop-gap (sk-jay0.1.76.19.20): the host should send
 * the granted definition itself. Any other id comes back unchanged.
 */
const GRANTED_FAMILY: Record<string, string> = {
	feat: "feat",
	weapon: "weapon",
	"divine-order": "divine-order",
};

export function grantedDefinition(definitionRef: string): string {
	const match = /^srd\/advancement-choice-option\/[^/]+\/\d+\/([a-z-]+)\/([a-z0-9_-]+)$/.exec(
		definitionRef,
	);
	const family = match ? GRANTED_FAMILY[match[1] ?? ""] : undefined;
	return family && match ? `srd/${family}/${match[2]}` : definitionRef;
}

/** `srd/class/fighter` -> the glob key of its sprite, or null when the SRD set has none. */
export function srdArtKey(definitionRef: string | undefined): string | null {
	const match = /^srd\/([a-z_-]+)\/([a-z0-9_-]+)$/.exec(definitionRef ?? "");
	if (!match) return null;
	const directory = DIRECTORY[match[1] ?? ""];
	if (!directory) return null;
	const key = `../../../../packages/spellkave-srd-cc/assets/srd-art/${directory}/${(match[2] ?? "").replaceAll("_", "-")}.webp`;
	return key in sprites ? key : null;
}

const loaded = new Map<string, Promise<string>>();

/** The sprite URL for a definition id; resolves to undefined when there is none. */
export function srdArtUrl(definitionRef: string | undefined): Promise<string | undefined> {
	const key = srdArtKey(definitionRef);
	if (key === null) return Promise.resolve(undefined);
	let pending = loaded.get(key);
	if (!pending) {
		pending = (sprites[key] as () => Promise<string>)();
		loaded.set(key, pending);
	}
	return pending;
}
