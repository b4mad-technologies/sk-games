import { describe, expect, it } from "vitest";
import { srdArtKey } from "./srd-art";

describe("srdArtKey", () => {
	// Skipped: the SRD sprites live in sk-content and are not bundled here yet (bead sk-jay0.7.405.41.7).
	it.skip("finds the sprite of a carried thing, whatever kind of thing the ruleset calls it", () => {
		expect(srdArtKey("srd/item/backpack")).toMatch(/srd-art\/item\/backpack\.webp$/);
		expect(srdArtKey("srd/weapon/greatsword")).toMatch(/srd-art\/item\/greatsword\.webp$/);
		expect(srdArtKey("srd/armor/chain-mail")).toMatch(/srd-art\/item\/chain-mail\.webp$/);
	});

	it("has nothing for a definition outside the SRD set or without a sprite", () => {
		expect(srdArtKey("kavemouth/item/ledger")).toBeNull();
		expect(srdArtKey("srd/weapon/no-such-blade")).toBeNull();
		expect(srdArtKey(undefined)).toBeNull();
	});
});

describe("grantedDefinition", () => {
	it("reads what a class choice grants from the option's id, and leaves other ids alone", async () => {
		const { grantedDefinition } = await import("./srd-art");
		expect(grantedDefinition("srd/advancement-choice-option/fighter/1/feat/archery")).toBe(
			"srd/feat/archery",
		);
		expect(grantedDefinition("srd/advancement-choice-option/fighter/1/weapon/greataxe")).toBe(
			"srd/weapon/greataxe",
		);
		expect(grantedDefinition("srd/advancement-choice-option/cleric/1/divine-order/protector")).toBe(
			"srd/divine-order/protector",
		);
		// An expertise option grants no definition the guide lists.
		const expertise = "srd/advancement-choice-option/rogue/1/expertise-option/stealth";
		expect(grantedDefinition(expertise)).toBe(expertise);
		expect(grantedDefinition("srd/class/fighter")).toBe("srd/class/fighter");
	});
});

describe("srdArtKey for a family whose sprites are still to come", () => {
	it("reads a family with a hyphen and finds nothing while no sprite exists", async () => {
		const { srdArtKey } = await import("./srd-art");
		// The folder is `divine_order`; the lookup must not throw on the hyphen.
		expect(srdArtKey("srd/divine-order/no-such-order")).toBeNull();
		expect(srdArtKey("srd/species/no-such-species")).toBeNull();
	});
});
