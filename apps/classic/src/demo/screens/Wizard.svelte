<script lang="ts">
	// Character creation as a classic step-by-step wizard.
	//
	// Under the hood every step is one question from the DM NPC and one answer
	// from the player (crates/spellkave-npc-host/src/dm/engine/creation_dialog.rs,
	// `Step`). The wizard is a different view on that conversation; the strip at
	// the bottom shows the conversation it stands for.
	import { Button, Input } from "@spellkave/ui";
	import {
		ABILITIES,
		art,
		backgrounds,
		cantrips,
		classes,
		itemArt,
		levelOneSpells,
		type Option,
		recommendedScores,
		species,
	} from "../fixtures";
	import Gap from "../Gap.svelte";
	import { app, modifier, say, signed } from "../state.svelte";

	type StepId = "class" | "background" | "species" | "skills" | "spells" | "kit" | "abilities" | "name" | "confirm";

	const draft = $state({
		classId: "",
		backgroundId: "",
		speciesId: "",
		skills: [] as string[],
		cantrips: [] as string[],
		spells: [] as string[],
		kitId: "",
		scores: [] as number[],
		scoresChosen: false,
		name: "",
	});
	let current = $state<StepId>("class");
	let swapFrom = $state<number | null>(null);

	const chosenClass = $derived(classes.find((entry) => entry.id === draft.classId));
	const steps = $derived.by(() => {
		const list: { id: StepId; label: string; question: string }[] = [
			{ id: "class", label: "Class", question: "Which class calls to you?" },
			{ id: "background", label: "Background", question: "Where do you come from?" },
			{ id: "species", label: "Species", question: "Who are your people?" },
			{ id: "skills", label: "Skills", question: `Pick ${chosenClass?.skillCount ?? 2} skills you trained.` },
		];
		if (chosenClass?.caster) {
			list.push({ id: "spells", label: "Spells", question: "Which spells did you learn first?" });
		}
		list.push(
			{ id: "kit", label: "Equipment", question: "Which kit do you carry?" },
			{ id: "abilities", label: "Abilities", question: "How are your abilities spread?" },
			{ id: "name", label: "Name", question: "What do they call you?" },
			{ id: "confirm", label: "Confirm", question: "Is this the hero you want to be?" },
		);
		return list;
	});

	const CANTRIP_COUNT = 2;
	const SPELL_COUNT = 2;

	function label(options: Option[], id: string): string {
		return options.find((option) => option.id === id)?.label ?? "";
	}

	function answerOf(step: StepId): string {
		switch (step) {
			case "class":
				return label(classes, draft.classId);
			case "background":
				return label(backgrounds, draft.backgroundId);
			case "species":
				return label(species, draft.speciesId);
			case "skills":
				return draft.skills.length === (chosenClass?.skillCount ?? 2) ? draft.skills.join(", ") : "";
			case "spells":
				return draft.cantrips.length === CANTRIP_COUNT && draft.spells.length === SPELL_COUNT
					? [...draft.cantrips.map((id) => label(cantrips, id)), ...draft.spells.map((id) => label(levelOneSpells, id))].join(", ")
					: "";
			case "kit":
				return chosenClass?.kits.find((kit) => kit.id === draft.kitId)?.label ?? "";
			case "abilities":
				return draft.scoresChosen ? draft.scores.join(" ") : "";
			case "name":
				return draft.name.trim();
			case "confirm":
				return "";
		}
	}

	const currentIndex = $derived(steps.findIndex((step) => step.id === current));
	const currentStep = $derived(steps[currentIndex]!);
	const canContinue = $derived(current === "confirm" || answerOf(current) !== "");
	// The first step without an answer; later steps stay locked.
	const frontier = $derived.by(() => {
		const index = steps.findIndex((step) => step.id !== "confirm" && answerOf(step.id) === "");
		return index === -1 ? steps.length - 1 : index;
	});

	function pickClass(id: string) {
		if (draft.classId !== id) {
			draft.skills = [];
			draft.cantrips = [];
			draft.spells = [];
			draft.kitId = "";
			draft.scores = recommendedScores(id);
			draft.scoresChosen = false;
		}
		draft.classId = id;
	}

	function toggle(list: string[], id: string, max: number): string[] {
		if (list.includes(id)) return list.filter((entry) => entry !== id);
		if (list.length >= max) return list;
		return [...list, id];
	}

	function swap(index: number) {
		if (swapFrom === null) {
			swapFrom = index;
			return;
		}
		const next = [...draft.scores];
		[next[swapFrom], next[index]] = [next[index]!, next[swapFrom]!];
		draft.scores = next;
		draft.scoresChosen = true;
		swapFrom = null;
	}

	function next() {
		const following = steps[currentIndex + 1];
		if (following) current = following.id;
	}

	function back() {
		const previous = steps[currentIndex - 1];
		if (previous) current = previous.id;
	}

	function confirm() {
		const kit = chosenClass?.kits.find((entry) => entry.id === draft.kitId);
		const con = modifier(draft.scores[2] ?? 10);
		const dex = modifier(draft.scores[1] ?? 10);
		const hitDie = Number(chosenClass?.facts?.[0]?.replace(/\D/g, "") ?? 8);
		const items = kit?.items ?? [];
		const ac = items.includes("Chain Mail") ? 16 : items.includes("Leather Armor") ? 11 + dex : 10 + dex;
		Object.assign(app.hero, {
			created: true,
			name: draft.name.trim(),
			classId: draft.classId,
			backgroundId: draft.backgroundId,
			speciesId: draft.speciesId,
			skills: draft.skills,
			cantrips: draft.cantrips,
			spells: draft.spells,
			kitId: draft.kitId,
			items,
			scores: draft.scores,
			hp: hitDie + con,
			hpMax: hitDie + con,
			ac: items.includes("Shield") ? ac + 2 : ac,
			xp: 0,
			slotsUsed: 0,
		});
		say("story", `${app.hero.name} steps into the common room.`);
		app.screen = "world";
	}

	// The conversation this wizard stands for, derived from the answers so far.
	const transcript = $derived.by(() => {
		const lines: { who: "DM" | "You"; text: string; wire?: string }[] = [];
		for (const [index, step] of steps.entries()) {
			if (index > frontier) break;
			lines.push({ who: "DM", text: step.question });
			const answer = answerOf(step.id);
			if (answer === "") break;
			const wire =
				step.id === "name" || step.id === "abilities" ? "communicate · utterance (free text)" : "communicate · dm/dialog/choice/N";
			lines.push({ who: "You", text: answer, wire });
		}
		return lines;
	});
</script>

<div class="wizard">
	<nav class="steps cm-panel" aria-label="Creation steps">
		{#each steps as step, index (step.id)}
			<button
				type="button"
				aria-current={step.id === current ? "step" : undefined}
				disabled={index > frontier}
				onclick={() => (current = step.id)}
			>
				<span class="sk-num">{index + 1}</span>
				<span class="name">{step.label}</span>
				<small>{answerOf(step.id)}</small>
			</button>
		{/each}
		<Gap title="Going back to an earlier step: not verified that the DM draft accepts a changed answer." where="creation_dialog.rs Draft" />
	</nav>

	<section class="stage">
		<header>
			<p class="sk-label cm-muted">Step {currentIndex + 1} of {steps.length}</p>
			<h1 class="sk-display">{currentStep.question}</h1>
		</header>

		{#if current === "class"}
			<div class="grid">
				{#each classes as option (option.id)}
					<button type="button" class="cm-pick card" aria-pressed={draft.classId === option.id} onclick={() => pickClass(option.id)}>
						<img class="cm-pixel" src={art("character_portrait", option.id)} alt="" />
						<span class="sk-title">{option.label}</span>
						<span class="blurb">{option.blurb}</span>
						<small class="cm-muted">{option.facts?.join(" · ")}</small>
					</button>
				{/each}
			</div>
			<Gap
				title="Cards need a creation catalog (blurb, facts, art per option). Today the client gets labels and response refs per prompt only."
				where="visible_manipulation_prompt · crates/spellkave-validate/src/dm_duties.rs:779"
			/>
		{:else if current === "background" || current === "species"}
			{@const options = current === "background" ? backgrounds : species}
			{@const key = current === "background" ? "backgroundId" : "speciesId"}
			<div class="grid">
				{#each options as option (option.id)}
					<button type="button" class="cm-pick card plain" aria-pressed={draft[key] === option.id} onclick={() => (draft[key] = option.id)}>
						<span class="sk-title">{option.label}</span>
						<span class="blurb">{option.blurb}</span>
						<small class="cm-muted">{option.facts?.join(" · ")}</small>
					</button>
				{/each}
			</div>
			<Gap title="No species or background art in the SRD art set yet (12 class portraits only)." where="packages/spellkave-srd-cc/assets/srd-art/character_portrait" />
		{:else if current === "skills"}
			<p class="cm-muted">{draft.skills.length} of {chosenClass?.skillCount} chosen</p>
			<div class="chips">
				{#each chosenClass?.skills ?? [] as skill (skill)}
					<button
						type="button"
						class="cm-pick chip"
						aria-pressed={draft.skills.includes(skill)}
						onclick={() => (draft.skills = toggle(draft.skills, skill, chosenClass?.skillCount ?? 2))}
					>
						{skill}
					</button>
				{/each}
			</div>
			<Gap title="Multi-pick in one step: the DM asks one skill per turn and reports `remaining`. The wizard would send the picks one after another." where="creation_dialog.rs Offer.remaining" />
		{:else if current === "spells"}
			<p class="cm-muted">Cantrips: {draft.cantrips.length} of {CANTRIP_COUNT}</p>
			<div class="grid small">
				{#each cantrips as option (option.id)}
					<button
						type="button"
						class="cm-pick card row"
						aria-pressed={draft.cantrips.includes(option.id)}
						onclick={() => (draft.cantrips = toggle(draft.cantrips, option.id, CANTRIP_COUNT))}
					>
						<img class="cm-pixel" src={art("spell", option.id)} alt="" />
						<span><span class="sk-title">{option.label}</span><br /><span class="blurb">{option.blurb}</span></span>
					</button>
				{/each}
			</div>
			<p class="cm-muted">Level 1 spells: {draft.spells.length} of {SPELL_COUNT}</p>
			<div class="grid small">
				{#each levelOneSpells as option (option.id)}
					<button
						type="button"
						class="cm-pick card row"
						aria-pressed={draft.spells.includes(option.id)}
						onclick={() => (draft.spells = toggle(draft.spells, option.id, SPELL_COUNT))}
					>
						<img class="cm-pixel" src={art("spell", option.id)} alt="" />
						<span><span class="sk-title">{option.label}</span><br /><span class="blurb">{option.blurb}</span></span>
					</button>
				{/each}
			</div>
		{:else if current === "kit"}
			<div class="grid two">
				{#each chosenClass?.kits ?? [] as kit (kit.id)}
					<button type="button" class="cm-pick card plain" aria-pressed={draft.kitId === kit.id} onclick={() => (draft.kitId = kit.id)}>
						<span class="sk-title">{kit.label}</span>
						<span class="items">
							{#each kit.items as item, index (index)}
								<span class="item">
									{#if itemArt(item)}<img class="cm-pixel" src={itemArt(item)} alt="" />{/if}
									{item}
								</span>
							{/each}
						</span>
					</button>
				{/each}
			</div>
		{:else if current === "abilities"}
			<p class="cm-muted">
				Recommended for a {chosenClass?.label}. Click two scores to swap them.
			</p>
			<div class="abilities">
				{#each ABILITIES as ability, index (ability.id)}
					<button type="button" class="cm-pick score" aria-pressed={swapFrom === index} onclick={() => swap(index)}>
						<span class="sk-label">{ability.short}</span>
						<span class="sk-num big">{draft.scores[index]}</span>
						<small class="cm-muted">{signed(modifier(draft.scores[index] ?? 10))}</small>
					</button>
				{/each}
			</div>
			<Button variant="outline" onclick={() => (draft.scoresChosen = true)}>Keep this spread</Button>
			<Gap title="Scores go to the DM as one spoken string of digits; the wizard would compose it." where="creation_dialog.rs:598-703 recognize()" />
		{:else if current === "name"}
			<div class="name-field">
				<Input bind:value={draft.name} placeholder="Your hero's name" maxlength={40} />
			</div>
			<p class="cm-muted">The one place you type. Everything else is a click.</p>
		{:else}
			<dl class="summary">
				{#each steps.slice(0, -1) as step (step.id)}
					<dt class="sk-label">{step.label}</dt>
					<dd>{answerOf(step.id)}</dd>
				{/each}
			</dl>
		{/if}

		<footer>
			<Button variant="outline" disabled={currentIndex === 0} onclick={back}>← Back</Button>
			{#if current === "confirm"}
				<Button onclick={confirm}>Begin the adventure</Button>
			{:else}
				<Button disabled={!canContinue} onclick={next}>Next →</Button>
			{/if}
		</footer>
	</section>

	<aside class="so-far cm-panel">
		<p class="sk-label cm-muted">Your hero so far</p>
		{#if draft.classId}
			<img class="cm-pixel portrait" src={art("character_portrait", draft.classId)} alt="" />
		{:else}
			<div class="portrait empty">?</div>
		{/if}
		<p class="sk-title">{draft.name.trim() || "Unnamed"}</p>
		<p class="cm-muted">
			{[label(species, draft.speciesId), label(classes, draft.classId), label(backgrounds, draft.backgroundId)].filter(Boolean).join(" · ") ||
				"Nothing chosen yet"}
		</p>
		{#if draft.scores.length}
			<div class="mini-scores">
				{#each ABILITIES as ability, index (ability.id)}
					<span><small class="cm-muted">{ability.short}</small> {draft.scores[index]}</span>
				{/each}
			</div>
		{/if}
	</aside>

	<details class="hood cm-panel" open={app.showGaps}>
		<summary class="sk-label">Under the hood: the conversation with the DM</summary>
		<div class="lines">
			{#each transcript as line, index (index)}
				<p>
					<strong>{line.who}:</strong>
					{line.text}
					{#if line.wire}<code>{line.wire}</code>{/if}
				</p>
			{/each}
		</div>
	</details>
</div>

<style>
	.wizard {
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr) 15rem;
		grid-template-rows: 1fr auto;
		gap: 1rem;
		padding: 1rem;
		min-height: 100%;
		max-width: 90rem;
		margin: 0 auto;
	}
	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.5rem;
		align-self: start;
	}
	.steps button {
		display: grid;
		grid-template-columns: 1.5rem 1fr;
		gap: 0 0.5rem;
		text-align: left;
		padding: 0.45rem 0.5rem;
		min-height: 2.75rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.steps button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.steps button[aria-current="step"] {
		background: var(--accent);
		color: var(--accent-foreground);
	}
	.steps small {
		grid-column: 2;
		color: var(--muted-foreground);
		font-size: 0.72rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.stage {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		min-width: 0;
	}
	.stage h1 {
		font-size: 1.8rem;
		margin: 0.1rem 0 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
		gap: 0.75rem;
	}
	.grid.small {
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
	}
	.grid.two {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.75rem;
	}
	.card.row {
		flex-direction: row;
		align-items: center;
		gap: 0.75rem;
	}
	.card img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		background: var(--muted);
		border-radius: var(--radius-sm);
	}
	.card.row img {
		width: 3rem;
		flex: none;
	}
	.blurb {
		font-family: var(--font-body);
		font-size: 0.9rem;
		line-height: 1.35;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.chip {
		min-height: 2.75rem;
		padding: 0 1rem;
	}
	.items {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.item img {
		width: 2rem;
		flex: none;
	}
	.abilities {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.5rem;
		max-width: 36rem;
	}
	.score {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.6rem 0.25rem;
	}
	.big {
		font-size: 1.6rem;
	}
	.name-field {
		max-width: 24rem;
	}
	.summary {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 0.4rem 1rem;
		max-width: 40rem;
	}
	.summary dd {
		margin: 0;
	}
	footer {
		display: flex;
		justify-content: space-between;
		margin-top: auto;
		padding-top: 0.5rem;
	}
	.so-far {
		padding: 0.75rem;
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.portrait {
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		background: var(--muted);
		border-radius: var(--radius-sm);
	}
	.portrait.empty {
		display: grid;
		place-items: center;
		font-size: 3rem;
		color: var(--muted-foreground);
	}
	.mini-scores {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.hood {
		grid-column: 1 / -1;
		padding: 0.5rem 0.75rem;
	}
	.hood summary {
		cursor: pointer;
	}
	.lines {
		max-height: 8rem;
		overflow-y: auto;
		margin-top: 0.4rem;
		font-size: 0.85rem;
	}
	.lines p {
		margin: 0 0 0.2rem;
	}
	.lines code {
		font-size: 0.7rem;
		color: var(--muted-foreground);
		margin-left: 0.5rem;
	}
	@media (max-width: 60rem) {
		.wizard {
			grid-template-columns: 1fr;
		}
		.so-far {
			display: none;
		}
		.abilities {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
