<script lang="ts">
	// Hero creation as a step-by-step wizard over the DM's dialogue.
	//
	// Each open prompt is one step: the question on top, the answers as cards.
	// Authored input forms (name, ability scores, appearance, backstory) sit
	// beside the steps, because the DM takes them at any time. See `creation.ts`
	// for what is read from the world and what is not.
	import { Button, Dialog, Input, Textarea } from "@spellkave/ui";
	import type { PlayAction, PlayView } from "../../../play/src/lib/play-view";
	import ReferenceHelp from "../lib/ReferenceHelp.svelte";
	import SrdArt from "../lib/SrdArt.svelte";
	import { type CreationChoice, type CreationForm, creationModel, type JournalEntry, journalAfterAnswer, journalIsStale, loadBack, loadJournal, saveBack, saveJournal } from "./creation";

	let {
		view,
		busy,
		onAnswer,
		onSubmit,
	}: {
		view: PlayView;
		busy: boolean;
		/** Send a bound answer or an input-less command. Rejects when it could not be sent. */
		onAnswer: (action: PlayAction) => Promise<string>;
		/** Send a filled form. */
		onSubmit: (action: PlayAction, values: Record<string, string | number>) => Promise<string>;
	} = $props();

	const model = $derived(creationModel(view));
	const step = $derived(model.steps[0]);
	// The kind segment of the answers' definition ids (`srd/class/...` -> "class")
	// picks the card layout. It is structured data, never the question's wording.
	const kind = $derived(/^srd\/([a-z_]+)\//.exec(step?.choices.find((choice) => choice.definitionRef)?.definitionRef ?? "")?.[1] ?? "plain");
	// Display trim only: the DM repeats the numbered options inside the question.
	const title = $derived(step ? (step.question.includes("?") ? `${step.question.slice(0, step.question.indexOf("?") + 1)}` : step.question) : "");
	const aside = $derived(/\(([^()]*)\)\s*$/.exec(step?.question ?? "")?.[1] ?? "");
	const dmLines = $derived(view.speech.filter((line) => !line.mine).slice(-3));

	// What the player answered so far. The world does not disclose the draft
	// while it is being made, so this list is the wizard's own memory. It is
	// kept in the tab's session storage and survives a reload (`creation.ts`).
	const storage = () => {
		try {
			return window.sessionStorage;
		} catch {
			return undefined;
		}
	};
	// svelte-ignore state_referenced_locally
	const heroId = view.hero.actorId;
	let journal = $state<JournalEntry[]>(loadJournal(storage(), heroId));
	$effect(() => saveJournal(storage(), heroId, $state.snapshot(journal)));
	// How many questions back the player looks. The keeper holds the real
	// count and stops at the first question; this one only labels the step
	// and decides where the next answer lands in the list.
	let back = $state(loadBack(storage(), heroId));
	$effect(() => saveBack(storage(), heroId, back));
	// A wiped world starts its hero under the same id; its list is not ours.
	$effect(() => {
		if (step && journalIsStale(journal, step.occurrenceId)) {
			journal = [];
			back = 0;
		}
	});
	let values = $state<Record<string, Record<string, string | number>>>({});
	// Only a failure to send is shown here. What the keeper answers arrives as
	// his own line; the session's stock reply ("Nothing you notice changes.")
	// says nothing in a wizard.
	let problem = $state("");
	let openForm = $state<string | null>(null);
	// After an answer the keeper needs a moment before the next question
	// opens. Until it does (or a few seconds pass) the wizard says so instead
	// of flashing the "no question" state.
	let awaiting = $state(false);
	let awaitTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (step) {
			awaiting = false;
			clearTimeout(awaitTimer);
		}
	});
	// svelte-ignore state_referenced_locally
	let nextId = journal.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1;

	async function attempt(run: () => Promise<string>): Promise<boolean> {
		problem = "";
		try {
			await run();
			return true;
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
			return false;
		}
	}

	async function answer(choice: CreationChoice) {
		if (!choice.action || busy) return;
		const stepTitle = title;
		const occurrence = step?.occurrenceId;
		if (await attempt(() => onAnswer(choice.action as PlayAction))) {
			journal = journalAfterAnswer(journal, { id: nextId++, step: stepTitle, answer: choice.label, definitionRef: choice.definitionRef, occurrence }, back > 0);
			back = 0;
			awaiting = true;
			clearTimeout(awaitTimer);
			awaitTimer = setTimeout(() => (awaiting = false), 8000);
		}
	}

	async function submit(form: CreationForm) {
		if (busy) return;
		const filled: Record<string, string | number> = {};
		for (const field of form.fields) {
			const value = values[form.action.id]?.[field.name];
			if (value === undefined || value === "") continue;
			filled[field.name] = field.control === "number" ? Number(value) : value;
		}
		if (await attempt(() => onSubmit(form.action, filled))) openForm = null;
	}

	// A command acts on the whole draft, so the wizard asks once before it
	// sends one, in its own dialog.
	let asked = $state<PlayAction | null>(null);
	let asking = $state(false);
	$effect(() => {
		if (!asking) asked = null;
	});

	function command(action: PlayAction) {
		if (busy) return;
		asked = action;
		asking = true;
	}

	async function carryOut() {
		const action = asked;
		asking = false;
		if (!action || busy) return;
		if (await attempt(() => onAnswer(action))) {
			journal = [];
			back = 0;
		}
	}

	async function walk(action: PlayAction | undefined, by: 1 | -1) {
		if (!action || busy) return;
		if (await attempt(() => onAnswer(action))) back = Math.max(0, back + by);
	}

	// Every offered form gets its own value bag before it is rendered.
	$effect(() => {
		for (const form of model.forms) {
			if (!(form.action.id in values)) values[form.action.id] = {};
		}
	});

	const portrait = $derived(journal.find((entry) => entry.definitionRef?.startsWith("srd/class/"))?.definitionRef);
</script>

<Dialog bind:open={asking} title={`${asked?.name ?? asked?.label ?? ""}?`} description={asked?.description} triggerLabel={null} closeLabel="No, keep it">
	<Button onclick={carryOut}>Yes, do it</Button>
</Dialog>

<div class="wizard">
	<nav class="done cm-panel" aria-label="Answers so far">
		<p class="sk-label cm-muted">So far</p>
		{#each journal as entry, index (entry.id)}
			<div class="entry">
				<span class="sk-num">{index + 1}</span>
				<span class="what">{entry.answer}<small>{entry.step}</small></span>
			</div>
		{:else}
			<p class="cm-muted small">Your answers will line up here.</p>
		{/each}
		{#each model.commands as action (action.id)}
			<Button variant="outline" size="sm" disabled={busy} onclick={() => command(action)}>{action.name ?? action.label}</Button>
		{/each}
	</nav>

	<section class="stage">
		{#if step}
			<header>
				<p class="sk-label cm-muted">{back > 0 ? "An earlier question · your answer stands until you pick another" : `Step ${journal.length + 1}`}{aside ? ` · ${aside}` : ""}</p>
				<h1 class="sk-display">{title}</h1>
			</header>
			{#if model.back || model.forward}
				<div class="walk">
					<Button variant="outline" disabled={busy || !model.back || journal.length === 0} title={model.back?.name} onclick={() => walk(model.back, 1)}>← Back</Button>
					<Button variant="outline" disabled={busy || !model.forward || back === 0} title={model.forward?.name} onclick={() => walk(model.forward, -1)}>Forward →</Button>
				</div>
			{/if}
			<div class="grid {kind}">
				{#each step.choices as choice (choice.actionId)}
					<div class="cell">
						<button type="button" class="cm-pick card" disabled={busy || !choice.action} onclick={() => answer(choice)}>
							<SrdArt definitionRef={choice.definitionRef} />
							<span class="sk-title">{choice.label}</span>
						</button>
						<span class="help"><ReferenceHelp definitionRef={choice.definitionRef} label={choice.label} /></span>
					</div>
				{/each}
			</div>
		{:else if awaiting}
			<header>
				<p class="sk-label cm-muted">One moment</p>
				<h1 class="sk-display">The keeper writes it down…</h1>
			</header>
		{:else}
			<header>
				<p class="sk-label cm-muted">No question is open</p>
				<h1 class="sk-display">Tell the keeper more about your hero</h1>
			</header>
			<p class="cm-muted">Fill in what is still missing on the right. The next question appears here.</p>
		{/if}

		{#if problem}<p class="reply" role="alert">{problem}</p>{/if}

		<div class="hood cm-panel">
			<p class="sk-label cm-muted">The keeper says</p>
			{#each dmLines as line (line.id)}
				<p><strong>{line.speaker}:</strong> {line.text}</p>
			{:else}
				<p class="cm-muted">Nothing yet.</p>
			{/each}
		</div>
	</section>

	<aside class="side">
		<div class="cm-panel hero">
			<SrdArt definitionRef={portrait} class="portrait">
				{#snippet fallback()}<div class="portrait empty" aria-hidden="true">?</div>{/snippet}
			</SrdArt>
			<p class="sk-title">{view.hero.name}</p>
		</div>
		{#each model.forms as form (form.action.id)}
			{@const filled = values[form.action.id]}
			<form
				class="cm-panel form"
				onsubmit={(event) => {
					event.preventDefault();
					void submit(form);
				}}
			>
				<button type="button" class="form-head" aria-expanded={openForm === form.action.id} onclick={() => (openForm = openForm === form.action.id ? null : form.action.id)}>
					<span class="sk-title">{form.title}</span>
					<span aria-hidden="true">{openForm === form.action.id ? "−" : "+"}</span>
				</button>
				{#if openForm === form.action.id && filled}
					<div class="fields" class:numbers={form.fields.every((field) => field.control === "number")}>
						{#each form.fields as field (field.name)}
							<label>
								<span class="sk-label">{field.label}</span>
								{#if field.control === "textarea"}
									<Textarea bind:value={filled[field.name] as string} placeholder={field.placeholder} maxlength={field.maxLength} rows={4} />
								{:else if field.control === "number"}
									<Input type="number" bind:value={filled[field.name]} min={field.min} max={field.max} />
								{:else}
									<Input bind:value={filled[field.name] as string} placeholder={field.placeholder} maxlength={field.maxLength} />
								{/if}
							</label>
						{/each}
					</div>
					<Button type="submit" disabled={busy}>{form.action.input?.submitLabel ?? "Send"}</Button>
				{/if}
			</form>
		{/each}
	</aside>
</div>

<style>
	.wizard {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr) 18rem;
		gap: 1rem;
		padding: 1rem;
		max-width: 96rem;
		margin: 0 auto;
		align-items: start;
	}
	.done {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.6rem;
	}
	.entry {
		display: grid;
		grid-template-columns: 1.5rem 1fr;
		gap: 0.4rem;
	}
	.what {
		display: flex;
		flex-direction: column;
	}
	small,
	.small {
		font-size: 0.72rem;
		color: var(--muted-foreground);
	}
	.stage {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		min-width: 0;
	}
	h1 {
		font-size: 1.8rem;
		margin: 0.1rem 0 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.75rem;
	}
	.grid.spell,
	.grid.skill,
	.grid.plain {
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		min-height: 2.75rem;
	}
	.walk {
		display: flex;
		gap: 0.5rem;
	}
	/* The help mark is a sibling of the card, never inside it: a click on it
	 * must not answer the question. */
	.cell {
		position: relative;
		display: grid;
	}
	.help {
		position: absolute;
		top: 0;
		right: 0;
	}
	/* A 44 px target around a smaller drawn disc. */
	.help :global(.cm-help) {
		display: inline-grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		background: radial-gradient(circle, var(--background) 0 0.72rem, var(--border) 0.72rem 0.8rem, transparent 0.8rem);
		color: var(--foreground);
		font-weight: 700;
		line-height: 1;
		text-decoration: none;
		cursor: help;
	}
	.card:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.grid.spell .card,
	.grid.skill .card,
	.grid.plain .card {
		flex-direction: row;
		align-items: center;
	}
	.card :global(img) {
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		background: var(--muted);
		border-radius: var(--radius-sm);
	}
	.grid.spell .card :global(img) {
		width: 2.75rem;
		flex: none;
	}
	.reply {
		margin: 0;
		border-left: 2px solid var(--primary);
		padding-left: 0.6rem;
		color: var(--muted-foreground);
	}
	.hood {
		padding: 0.6rem 0.75rem;
		font-family: var(--font-body);
		font-size: 0.92rem;
	}
	.hood p {
		margin: 0 0 0.3rem;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.hero {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.hero :global(.portrait) {
		width: 100%;
		aspect-ratio: 1;
		object-fit: contain;
		background: var(--muted);
		border-radius: var(--radius-sm);
	}
	.hero :global(.portrait.empty) {
		display: grid;
		place-items: center;
		font-size: 3rem;
		color: var(--muted-foreground);
	}
	.hero p {
		margin: 0;
	}
	.form {
		padding: 0.4rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.form-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 2.75rem;
		cursor: pointer;
		text-align: left;
	}
	.fields {
		display: grid;
		gap: 0.5rem;
	}
	.fields.numbers {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	@media (max-width: 64rem) {
		.wizard {
			grid-template-columns: 1fr;
		}
	}
</style>
