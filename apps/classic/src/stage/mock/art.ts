// SRD sprites for the mock, bundled by Vite. The live app gets the same
// pictures by definition id (`src/lib/srd-art.ts`) or from the world.

import type { Art } from "../model";

const files = import.meta.glob<string>(
	[
		"../../../../../packages/spellkave-srd-cc/assets/srd-art/character_portrait/*.webp",
		"../../../../../packages/spellkave-srd-cc/assets/srd-art/creature/{giant-rat,commoner,noble,priest-acolyte}.webp",
		"../../../../../packages/spellkave-srd-cc/assets/srd-art/item/{dagger,shortsword,longsword,shield,leather-armor,chain-mail,quarterstaff,shortbow,arrows-20,backpack,rope,torch,rations,thieves-tools,lantern-hooded,gold-piece,potion*-of-healing}.webp",
	],
	{ eager: true, query: "?url", import: "default" },
);

export type ArtKind = "character_portrait" | "creature" | "item";

export function sprite(kind: ArtKind, slug: string): Art | undefined {
	const hit = Object.entries(files).find(([path]) => path.endsWith(`/${kind}/${slug}.webp`));
	return hit ? { url: hit[1], pixel: true } : undefined;
}

const ITEM_SLUG: Record<string, string> = {
	"Chain Mail": "chain-mail",
	Longsword: "longsword",
	Shield: "shield",
	Backpack: "backpack",
	"Leather Armor": "leather-armor",
	Shortbow: "shortbow",
	"Arrows (20)": "arrows-20",
	Shortsword: "shortsword",
	Dagger: "dagger",
	"Thieves' Tools": "thieves-tools",
	Quarterstaff: "quarterstaff",
	Torch: "torch",
	Rations: "rations",
	Rope: "rope",
	"Hooded Lantern": "lantern-hooded",
	"Gold Pieces": "gold-piece",
};

export function itemSprite(name: string): Art | undefined {
	if (name === "Potion of Healing") {
		const hit = Object.entries(files).find(([path]) => path.includes("of-healing"));
		return hit ? { url: hit[1], pixel: true } : undefined;
	}
	const slug = ITEM_SLUG[name];
	return slug ? sprite("item", slug) : undefined;
}
