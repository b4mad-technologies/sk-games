<script lang="ts">
	// One round of a talk, on the lower part of the stage: who asks, what, and
	// the answers they named. Hero creation is the same panel: a guided talk
	// with whoever keeps the threshold. Free speech is typed on the foot line.
	import type { Answer, Round } from "./model";
	import { answeredSoFar, pointsSpent, saidBefore, withoutPickCount } from "./words";

	type Props = {
		round: Round;
		/** What the speaker said since the hero last spoke, in order. */
		said?: string[];
		busy: boolean;
		onanswer: (roundId: string, answerId: string) => void;
		onsay: (text: string) => void;
		onfill?: (values: Record<string, number>) => void;
		onback: () => void;
		onforward: () => void;
		onrestart?: () => void;
		onleave: () => void;
	};
	let { round, said = [], busy, onanswer, onsay, onfill, onback, onforward, onrestart, onleave }: Props = $props();

	// Starting over throws every answer away: the second click does it.
	let sure = $state(false);
	function restart(): void {
		if (!sure) {
			sure = true;
			return;
		}
		sure = false;
		onrestart?.();
	}

	// Numbers the speaker also takes: set by clicks, from each field's least.
	let numbers = $state<Record<string, number>>({});
	const scoreOf = (field: { name: string; min: number; value?: number }) =>
		numbers[field.name] ?? field.value ?? field.min;
	const spent = $derived(
		round.numbers ? pointsSpent(round.numbers.fields.map((field) => scoreOf(field))) : undefined,
	);
	function turn(field: { name: string; min: number; max: number }, by: number): void {
		numbers[field.name] = Math.min(field.max, Math.max(field.min, scoreOf(field) + by));
	}
	function fill(): void {
		if (!round.numbers) return;
		onfill?.(Object.fromEntries(round.numbers.fields.map((field) => [field.name, scoreOf(field)])));
	}

	// The answer pointed at, by id: the round is read anew with every view,
	// and its text from the reference guide can arrive after the pointer did.
	let aboutId = $state<string | null>(null);
	const about = $derived<Answer | null>(round.answers.find((answer) => answer.id === aboutId) ?? null);
	let words = $state("");
	const TALL_AT_MOST = 5;
	// The SRD's point budget for ability scores. The DM's own budget decides;
	// this is the number the rules name, shown so the count means something.
	const POINT_BUDGET = 27;

	const guided = $derived(Boolean(round.outline));
	// The panel says how many picks are left; the question need not count too.
	const several = $derived((round.picksLeft ?? 0) > 1);
	const rich = $derived(round.answers.some((answer) => answer.art || answer.blurb || answer.facts || answer.href));
	// A handful of answers that say what they are: each card carries its own
	// text, and nothing has to be pointed at. A crowd stays small cards.
	const tall = $derived(
		round.answers.length <= TALL_AT_MOST && round.answers.some((answer) => answer.blurb || answer.facts),
	);

	// What the speaker said right before asking: the answer to the hero's
	// last words is often followed at once by the next question, and would
	// otherwise be seen only in the story ("End Sister Maelis." before "Raid
	// smoke on the road ...").
	const before = $derived(guided ? [] : saidBefore(said, round.question));

	// At the last step of a guided talk the whole is read once more, uncut.
	const soFar = $derived(answeredSoFar(round.outline));

	let shownRound = "";
	$effect(() => {
		if (round.id === shownRound) return;
		shownRound = round.id;
		sure = false;
		numbers = {};
		aboutId = null;
		words = "";
	});

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (words.trim()) onsay(words);
	}
</script>

<div class="st-talk" role="group" aria-label="Talk with {round.speakerName}">
	{#each before as sentence (sentence)}<p class="st-talk-before">“{sentence}”</p>{/each}
	<header>
		<h2>
			<small>{round.speakerName}</small>
			{#if round.question}“{several ? withoutPickCount(round.question) : round.question}”{:else if round.input}asks: {round.input.label}{:else if said.length > 0}“{said.join(" ")}”{:else}listens.{/if}
			{#if several}<small>({round.picksLeft} to pick)</small>{/if}
		</h2>
		{#if guided}
			{#if round.canRestart}
				<button
					type="button"
					class="st-btn st-restart"
					data-sure={sure ? "" : undefined}
					disabled={busy}
					title="Throw away every answer and begin again"
					onclick={restart}
					onblur={() => (sure = false)}>{sure ? "Really start over?" : "Start over"}</button
				>
			{/if}
			<button type="button" class="st-btn" disabled={!round.canBack || busy} onclick={onback}>← Back</button>
			<button type="button" class="st-btn" disabled={!round.canForward || busy} onclick={onforward}>Forward →</button>
		{:else}
			<button type="button" class="st-btn" onclick={onleave}>Leave</button>
		{/if}
	</header>

	{#if round.input}
		<form class="st-say" onsubmit={submit}>
			<label for="st-asked">{round.input.label}</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="st-asked"
				class="st-input"
				bind:value={words}
				placeholder={round.input.placeholder}
				maxlength={round.input.maxLength}
				autocomplete="off"
				autofocus
			/>
			<button type="submit" class="st-btn st-btn--solid" disabled={!words.trim() || busy}>Say it</button>
		</form>
	{:else}
		<ul class="st-answers" data-shape={tall ? "tall" : rich || guided ? "cards" : "lines"}>
			{#each round.answers as answer (answer.id)}
				<li>
					<button
						type="button"
						class="st-answer"
						disabled={busy}
						onclick={() => onanswer(round.id, answer.id)}
						onpointerenter={() => (aboutId = answer.id)}
						onfocus={() => (aboutId = answer.id)}
					>
						{#if answer.art}<img src={answer.art.url} alt="" />{/if}
						<span>
							{answer.label}
							{#if tall}
								{#if answer.blurb}<small>{answer.blurb}</small>{/if}
								{#if answer.facts}<small>{answer.facts.join(" · ")}</small>{/if}
							{:else if answer.blurb && !answer.art && round.answers.length <= 4}<small>{answer.blurb}</small>{/if}
						</span>
					</button>
					{#if tall && answer.href}
						<a href={answer.href} target="_blank" rel="noreferrer" title="Reference guide: {answer.ref}">Read more</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if round.numbers && !round.input}
		<fieldset class="st-numbers" disabled={busy}>
			<legend>Or {round.numbers.title.toLowerCase()} yourself</legend>
			<ul>
				{#each round.numbers.fields as field (field.name)}
					<li>
						<span>{field.label}</span>
						<button
							type="button"
							class="st-btn"
							aria-label="{field.label} down"
							disabled={scoreOf(field) <= field.min}
							onclick={() => turn(field, -1)}>−</button
						>
						<output aria-label={field.label}>{scoreOf(field)}</output>
						<button
							type="button"
							class="st-btn"
							aria-label="{field.label} up"
							disabled={scoreOf(field) >= field.max}
							onclick={() => turn(field, 1)}>+</button
						>
					</li>
				{/each}
			</ul>
			<p>
				{#if spent !== undefined}
					<span data-over={spent > POINT_BUDGET ? "" : undefined}
						>{spent} of {POINT_BUDGET} points spent</span
					>
				{/if}
				<button type="button" class="st-btn st-btn--solid" onclick={fill}>{round.numbers.submit}</button>
			</p>
		</fieldset>
	{/if}

	{#if soFar.length > 0}
		<dl class="st-identity st-sofar" aria-label="What you answered">
			{#each soFar as entry (entry.label)}
				<dt>{entry.label}</dt>
				<dd>{entry.value}</dd>
			{/each}
		</dl>
	{/if}

	{#if rich && !tall}
		<p class="st-about st-about--help" aria-live="polite">
			{#if about}
				<b>{about.label}.</b>
				{about.blurb ?? ""}
				{about.facts?.join(" · ") ?? ""}
				{#if about.href}
					<a href={about.href} target="_blank" rel="noreferrer" title="Reference guide: {about.ref}">Read more</a>
				{:else if about.ref}
					<a href="#{about.ref}" title="Reference guide: {about.ref}">Read more</a>
				{/if}
			{:else}
				Point at an answer to learn more. A click answers.
			{/if}
		</p>
	{/if}
</div>
