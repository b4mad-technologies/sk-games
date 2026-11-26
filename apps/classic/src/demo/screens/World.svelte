<script lang="ts">
	// Exploration: click a person, a thing or a way out, pick from a menu.
	//
	// The menu is paired on the client from two separate lists the world
	// gives ("my actions", "targets I see"), as apps/play/src/lib/
	// play-action-context.ts does today. The world answers the attempt, so an
	// offered action can be refused. A refusal is shown, remembered for this
	// state of the scene, and the entry is struck through.
	import { Button, Input } from "@spellkave/ui";
	import { Hero, type SelfState } from "@spellkave/ui-widgets";
	import ClickMenu, { type MenuEntry } from "../../lib/ClickMenu.svelte";
	import EventLog from "../EventLog.svelte";
	import { backgrounds, exploreActions, type SceneThing, sceneThings, species } from "../fixtures";
	import Gap from "../Gap.svelte";
	import { abilityRows, app, heroClass, say } from "../state.svelte";

	let menu = $state<{ thing: SceneThing; x: number; y: number } | null>(null);
	let refusals = $state<Record<string, string>>({});
	let chestOpened = $state(false);
	let words = $state("");
	let dialog = $state<{ speaker: string; prompt: string; choices: { id: string; text: string }[] } | null>(null);

	const self = $derived<SelfState>({
		name: app.hero.name,
		subtitle: [
			species.find((entry) => entry.id === app.hero.speciesId)?.label,
			heroClass().label,
			backgrounds.find((entry) => entry.id === app.hero.backgroundId)?.label,
		]
			.filter(Boolean)
			.join(" · "),
		level: 1,
		hp: app.hero.hp,
		ac: app.hero.ac,
		xp: app.hero.xp,
		abilities: abilityRows(),
		conditions: app.hero.hp <= app.hero.hpMax / 2 ? ["Bloodied"] : [],
	});

	function entriesFor(thing: SceneThing): MenuEntry[] {
		return exploreActions
			.filter((action) => thing.niches.includes(action.niche))
			.map((action) => {
				const refusal = refusals[`${action.id}:${thing.id}`];
				return { id: action.id, label: action.label, refused: refusal !== undefined, hint: refusal ? "refused" : undefined };
			});
	}

	function refuse(actionId: string, thing: SceneThing, reason: string) {
		refusals[`${actionId}:${thing.id}`] = reason;
		say("refusal", `The world refuses: ${reason}`);
	}

	function attempt(actionId: string) {
		const thing = menu?.thing;
		menu = null;
		if (!thing) return;
		switch (actionId) {
			case "talk":
				if (thing.id === "warden") {
					dialog = {
						speaker: thing.name,
						prompt: "He looks up from the ledger. \"New face. What do you need?\"",
						choices: [
							{ id: "cellar", text: "What is that noise in the cellar?" },
							{ id: "work", text: "Is there work for a newcomer?" },
							{ id: "bye", text: "Nothing. Farewell." },
						],
					};
					say("speech", "\"New face. What do you need?\"", thing.name);
				} else if (thing.id === "acolyte") {
					say("speech", "\"Mind the cellar. Something down there bit me.\"", thing.name);
				} else {
					say("speech", "\"Mmh. Later.\"", thing.name);
				}
				break;
			case "look":
			case "look-creature":
				say("story", `${thing.name}: ${thing.note}.`);
				break;
			case "open":
				if (chestOpened) {
					refuse(actionId, thing, "the chest is already empty.");
				} else {
					chestOpened = true;
					app.hero.items = [...app.hero.items, "Rope"];
					say("story", "The lid creaks. Inside lies a coil of rope. You take it.");
				}
				break;
			case "attack":
				refuse(actionId, thing, `${thing.name} is not hostile.`);
				break;
			case "go":
				if (thing.id === "cellar") {
					say("story", "You go down the cellar steps. Something moves between the barrels.");
					app.fightKey += 1;
					app.screen = "fight";
				} else {
					refuse(actionId, thing, "the road is not part of this mock-up.");
				}
				break;
		}
	}

	function choose(id: string) {
		const speaker = dialog?.speaker ?? "";
		const picked = dialog?.choices.find((choice) => choice.id === id);
		if (picked) say("speech", `"${picked.text}"`, app.hero.name);
		if (id === "cellar") {
			say("speech", "\"Rats, big ones. Clear them out and the ledger owes you ten silver.\"", speaker);
		} else if (id === "work") {
			say("speech", "\"The cellar. Start there.\"", speaker);
		}
		dialog = null;
	}

	function speak() {
		const text = words.trim();
		if (!text) return;
		say("speech", `"${text}"`, app.hero.name);
		say("speech", "\"Hm. I will think on that.\"", dialog?.speaker ?? "Warden Hale");
		words = "";
	}
</script>

<div class="world">
	<section class="stage cm-panel" aria-label="Common room">
		<header>
			<span class="sk-title">The Common Room</span>
			<span class="cm-muted">A low fire, long tables, the smell of woodsmoke.</span>
		</header>
		<div class="room">
			{#each sceneThings as thing (thing.id)}
				<button
					type="button"
					class="token {thing.kind}"
					style:left={`${thing.x}%`}
					style:top={`${thing.y}%`}
					aria-label={`${thing.name}. ${thing.note}`}
					onclick={(event) => (menu = { thing, x: event.clientX, y: event.clientY })}
				>
					{#if thing.art}
						<img class="cm-pixel" src={thing.art} alt="" />
					{:else}
						<span class="glyph" aria-hidden="true">{thing.kind === "exit" ? "⇲" : "◆"}</span>
					{/if}
					<span class="name">{thing.name}</span>
				</button>
			{/each}
		</div>
		<Gap
			title="Where things stand inside a room is not disclosed outside a fight (only room-to-room places exist). Token positions here are invented; a real view needs either authored spots or a plain list."
			where="ADR-0052 tactical grid is fight-only"
		/>
		<Gap
			title="No 'this action works on this target' read, by decision. The menu pairs actions and targets on the client and learns from refusals."
			where="ADR-0141 D-1 · apps/play/src/lib/play-action-context.ts:76-100"
		/>
	</section>

	<aside class="side">
		<Hero {self} density="card" />
		<Button variant="outline" onclick={() => (app.screen = "sheet")}>Open hero sheet</Button>
	</aside>

	<section class="bottom cm-panel">
		<div class="log"><EventLog /></div>
		<div class="talk">
			{#if dialog}
				<p class="sk-label">{dialog.speaker}</p>
				<p class="prompt">{dialog.prompt}</p>
				<div class="choices">
					{#each dialog.choices as choice (choice.id)}
						<Button variant="outline" onclick={() => choose(choice.id)}>{choice.text}</Button>
					{/each}
				</div>
			{:else}
				<p class="cm-muted">Click someone to talk. Answers show up here as buttons.</p>
			{/if}
			<form
				class="say"
				onsubmit={(event) => {
					event.preventDefault();
					speak();
				}}
			>
				<Input bind:value={words} placeholder="Say something in your own words…" />
				<Button type="submit" variant="outline">Say</Button>
			</form>
			<Gap title="Free speech stays typed: NPCs answer words, and some actions take their input from what is said." where="packages/spellkave-sdk/src/core/readers/affordance_input.ts:30-35" />
		</div>
	</section>
</div>

{#if menu}
	<ClickMenu
		title={menu.thing.name}
		subtitle={menu.thing.note}
		entries={entriesFor(menu.thing)}
		x={menu.x}
		y={menu.y}
		onPick={attempt}
		onClose={() => (menu = null)}
	/>
{/if}

<style>
	.world {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 19rem;
		grid-template-rows: minmax(22rem, 1fr) 15rem;
		gap: 0.75rem;
		padding: 0.75rem;
		height: 100%;
		min-height: 40rem;
	}
	.stage {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		min-height: 0;
	}
	.stage header {
		display: flex;
		gap: 1rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.room {
		position: relative;
		flex: 1;
		min-height: 14rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background-color: var(--muted);
		background-image: var(--ground-image, none);
		background-size: var(--ground-size, auto);
		overflow: hidden;
	}
	.token {
		position: absolute;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.25rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
	}
	.token:hover,
	.token:focus-visible {
		border-color: var(--ring);
		background: var(--card);
		outline: none;
	}
	.token img {
		width: 4.5rem;
		height: 4.5rem;
	}
	.token .glyph {
		display: grid;
		place-items: center;
		width: 3.25rem;
		height: 3.25rem;
		font-size: 1.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--card);
	}
	.token .name {
		font-size: 0.78rem;
		background: var(--card);
		color: var(--card-foreground);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0 0.4rem;
		white-space: nowrap;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
		overflow-y: auto;
	}
	.bottom {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		min-height: 0;
	}
	.log {
		min-height: 0;
		border-right: 1px solid var(--border);
	}
	.talk {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		overflow-y: auto;
	}
	.talk p {
		margin: 0;
	}
	.prompt {
		font-family: var(--font-body);
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.say {
		display: flex;
		gap: 0.4rem;
		margin-top: auto;
	}
	@media (max-width: 60rem) {
		.world {
			grid-template-columns: 1fr;
			grid-template-rows: auto;
			height: auto;
		}
		.bottom {
			grid-template-columns: 1fr;
		}
		.log {
			height: 12rem;
			border-right: 0;
			border-bottom: 1px solid var(--border);
		}
	}
</style>
