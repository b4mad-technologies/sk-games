<script lang="ts">
	// Hero sheet, pack and spells. Hero and Pack are the shipped widgets; the
	// spell list is new.
	import { Hero, Pack, type PackItem, type SelfState } from "@spellkave/ui-widgets";
	import { art, backgrounds, cantrips, itemArt, levelOneSpells, species } from "../fixtures";
	import Gap from "../Gap.svelte";
	import { abilityRows, app, heroClass } from "../state.svelte";

	let selectedItem = $state<string | null>(null);

	const self = $derived<SelfState>({
		name: app.hero.name,
		species: species.find((entry) => entry.id === app.hero.speciesId)?.label,
		className: heroClass().label,
		background: backgrounds.find((entry) => entry.id === app.hero.backgroundId)?.label,
		level: 1,
		hp: app.hero.hp,
		ac: app.hero.ac,
		xp: app.hero.xp,
		proficiency: 2,
		abilities: abilityRows(),
		skills: app.hero.skills.map((skill) => ({ id: skill, label: skill })),
		conditions: [],
	});

	const items = $derived<PackItem[]>(
		app.hero.items.map((name, index) => ({
			id: `${index}:${name}`,
			name,
			detail: "",
			equipped: index === 0 ? "Main hand" : null,
		})),
	);

	const known = $derived([
		...cantrips.filter((spell) => app.hero.cantrips.includes(spell.id)).map((spell) => ({ ...spell, level: "Cantrip" })),
		...levelOneSpells.filter((spell) => app.hero.spells.includes(spell.id)).map((spell) => ({ ...spell, level: "Level 1" })),
	]);
</script>

<div class="sheet">
	<section>
		<Hero {self} density="stage" />
	</section>

	<section class="col">
		<Pack {items} selectedId={selectedItem} onSelect={(id) => (selectedItem = id)} detail={selectedItem ? { id: selectedItem, facts: [], verbs: [] } : null} density="stage">
			{#snippet artwork(id: string)}
				{@const src = itemArt(id.split(":")[1] ?? "")}
				{#if src}<img class="cm-pixel item-art" {src} alt="" />{/if}
			{/snippet}
		</Pack>
		<Gap title="No paper-doll: equipment slots are readable, but there is no slot layout widget." where="visible_entity_equipment_slot" />
	</section>

	<section class="col">
		<div class="cm-panel spells">
			<header>
				<span class="sk-title">Spells</span>
				<span class="slots" aria-label={`${2 - app.hero.slotsUsed} of 2 level 1 slots left`}>
					Level 1 slots
					{#each [0, 1] as slot (slot)}
						<span class="pip" class:spent={slot < app.hero.slotsUsed}></span>
					{/each}
				</span>
			</header>
			{#each known as spell (spell.id)}
				<div class="spell">
					<img class="cm-pixel" src={art("spell", spell.id)} alt="" />
					<div>
						<p class="sk-title">{spell.label} <small class="cm-muted">{spell.level}</small></p>
						<p class="blurb">{spell.blurb}</p>
					</div>
				</div>
			{:else}
				<p class="cm-muted">This hero knows no spells.</p>
			{/each}
		</div>
		<Gap title="No spell list or slot widget, and no dedicated spell read was found; slots may arrive as plain state rows (not verified)." where="packages/spellkave-sdk/src/core/readers/self.ts" />
		<Gap title="No maximum hit points: the world reports current HP only." where="packages/spellkave-ui-widgets/src/types.ts:95-109" />
	</section>
</div>

<style>
	.sheet {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		padding: 0.75rem;
		max-width: 90rem;
		margin: 0 auto;
		align-items: start;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.spells {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.spells header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.slots {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
	}
	.pip {
		width: 0.8rem;
		height: 0.8rem;
		border: 1px solid var(--primary);
		background: var(--primary);
		transform: rotate(45deg);
	}
	.pip.spent {
		background: transparent;
	}
	.spell {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}
	.spell img {
		width: 3rem;
		height: 3rem;
		flex: none;
	}
	.spell p {
		margin: 0;
	}
	.blurb {
		font-family: var(--font-body);
		font-size: 0.9rem;
	}
	.item-art {
		width: 6rem;
		height: 6rem;
	}
	@media (max-width: 60rem) {
		.sheet {
			grid-template-columns: 1fr;
		}
	}
</style>
