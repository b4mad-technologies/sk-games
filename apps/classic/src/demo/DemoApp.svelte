<script lang="ts">
	import { Switch } from "@spellkave/ui";
	import { initTheme, ThemeSwitcher } from "@spellkave/ui/theme";
	import Fight from "./screens/Fight.svelte";
	import Sheet from "./screens/Sheet.svelte";
	import Wizard from "./screens/Wizard.svelte";
	import World from "./screens/World.svelte";
	import { app, type Screen } from "./state.svelte";

	initTheme();

	const tabs: { id: Screen; label: string }[] = [
		{ id: "create", label: "1 · Create hero" },
		{ id: "world", label: "2 · World" },
		{ id: "fight", label: "3 · Fight" },
		{ id: "sheet", label: "4 · Hero sheet" },
	];
</script>

<div class="shell">
	<header class="bar">
		<span class="sk-title brand">Spellkave Classic <small>mock-up · fixture data</small></span>
		<nav aria-label="Mock-up screens">
			{#each tabs as tab (tab.id)}
				<button type="button" aria-current={app.screen === tab.id ? "page" : undefined} onclick={() => (app.screen = tab.id)}>
					{tab.label}
				</button>
			{/each}
			<a class="live" href="/">5 · Live world ↗</a>
		</nav>
		<Switch bind:checked={app.showGaps} label="Show gaps" />
		<ThemeSwitcher compact />
	</header>

	<main>
		{#if app.screen === "create"}
			<Wizard />
		{:else if app.screen === "world"}
			<World />
		{:else if app.screen === "fight"}
			{#key app.fightKey}<Fight />{/key}
		{:else}
			<Sheet />
		{/if}
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100%;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--card);
	}
	.brand small {
		font-size: 0.7rem;
		color: var(--muted-foreground);
		margin-left: 0.5rem;
		text-transform: none;
		letter-spacing: 0;
	}
	nav {
		display: flex;
		gap: 0.25rem;
		flex: 1;
		flex-wrap: wrap;
	}
	nav button {
		min-height: 2.75rem;
		padding: 0 0.9rem;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
	}
	.live {
		display: grid;
		place-items: center;
		min-height: 2.75rem;
		padding: 0 0.9rem;
	}
	nav button:hover {
		border-color: var(--border);
	}
	nav button[aria-current="page"] {
		border-color: var(--primary);
		color: var(--primary);
	}
	main {
		min-height: 0;
		overflow: auto;
	}
</style>
