<script lang="ts" module>
	export type TalkLine = { key: string; who: string; text: string; mine?: boolean; result?: boolean };
</script>

<script lang="ts">
	// The talk panel: what was said, the questions that are open, and one field
	// for the hero's own words. Answers are buttons; typing is for speech only.
	import { Button, Input } from "@spellkave/ui";
	import type { TalkAnswer, TalkPartner, TalkQuestion } from "./talk";

	let {
		lines,
		questions,
		partners,
		partnerId = $bindable(null),
		canSpeak,
		busy = false,
		thinking,
		onAnswer,
		onSay,
	}: {
		lines: TalkLine[];
		questions: TalkQuestion[];
		partners: TalkPartner[];
		/** Who the words go to; null means everyone here. */
		partnerId?: string | null;
		/** False when the world offers no way to speak to the chosen partner. */
		canSpeak: boolean;
		busy?: boolean;
		/** Whom the player waits for ("Aldwin is thinking"), when anybody. */
		thinking?: string;
		onAnswer: (answer: TalkAnswer, question: TalkQuestion) => void;
		onSay: (words: string) => void;
	} = $props();

	let draft = $state("");
	let log = $state<HTMLDivElement>();
	let field = $state<HTMLDivElement>();

	const partner = $derived(partners.find((entry) => entry.id === partnerId) ?? null);

	// Someone who left cannot stay the partner.
	$effect(() => {
		if (partnerId !== null && partner === null) partnerId = null;
	});

	// Keep the newest line in view.
	$effect(() => {
		void lines.length;
		void questions.length;
		void thinking;
		log?.scrollTo({ top: log.scrollHeight });
	});

	/** Put the cursor in the speech field (the click menu's "Talk" does this). */
	export function focus(): void {
		field?.querySelector("input")?.focus();
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const words = draft.trim();
		if (words === "" || busy || !canSpeak) return;
		onSay(words);
		draft = "";
	}
</script>

<div class="talk">
	<div class="log" bind:this={log} aria-live="polite">
		{#each lines as line (line.key)}
			<p class:mine={line.mine} class:result={line.result}>
				{#if line.who}<strong>{line.who}:</strong>{/if}
				{line.text}
			</p>
		{:else}
			<p class="cm-muted">The world has said nothing yet.</p>
		{/each}
		{#each questions as question (question.occurrenceId)}
			<div class="question">
				<p>
					{#if question.asker}<strong>{question.asker} asks:</strong>{/if}
					{question.question || "A question is open."}
				</p>
				<div class="buttons">
					{#each question.answers as answer (answer.actionId)}
						<Button variant="outline" disabled={busy || !answer.action} onclick={() => onAnswer(answer, question)}>{answer.label}</Button>
					{/each}
				</div>
			</div>
		{/each}
		{#if thinking}
			<p class="thinking cm-muted" role="status">{thinking}<span class="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>
		{/if}
	</div>
	<form class="say" onsubmit={submit}>
		<div class="buttons" role="group" aria-label="Speak to">
			<Button type="button" size="sm" variant={partnerId === null ? "default" : "outline"} aria-pressed={partnerId === null} onclick={() => (partnerId = null)}>Everyone here</Button>
			{#each partners as entry (entry.id)}
				<Button type="button" size="sm" variant={partnerId === entry.id ? "default" : "outline"} aria-pressed={partnerId === entry.id} onclick={() => (partnerId = entry.id)}>{entry.name}</Button>
			{/each}
		</div>
		<div class="row" bind:this={field}>
			<Input
				bind:value={draft}
				aria-label={partner ? `Say to ${partner.name}` : "Say to everyone here"}
				placeholder={canSpeak ? (partner ? `Say to ${partner.name}…` : "Say to everyone here…") : "You cannot speak here."}
				disabled={!canSpeak}
				maxlength={500}
			/>
			<Button type="submit" disabled={busy || !canSpeak || draft.trim() === ""}>Say</Button>
		</div>
	</form>
</div>

<style>
	.talk {
		display: grid;
		grid-template-rows: minmax(0, 1fr) auto;
		min-height: 0;
		height: 100%;
	}
	.log {
		overflow-y: auto;
		padding: 0.5rem 0.75rem;
		font-family: var(--font-body);
		font-size: 0.9rem;
	}
	.log p {
		margin: 0 0 0.3rem;
	}
	.mine {
		color: var(--muted-foreground);
	}
	.result {
		border-left: 2px solid var(--primary);
		padding-left: 0.5rem;
		color: var(--muted-foreground);
	}
	.thinking {
		font-style: italic;
	}
	.dots i {
		animation: blink 1.2s infinite both;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes blink {
		0%,
		80%,
		100% {
			opacity: 0.2;
		}
		40% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dots i {
			animation: none;
		}
	}
	.question {
		margin-top: 0.4rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--primary);
		border-radius: var(--radius-sm);
		background: var(--card);
	}
	.question p {
		font-size: 1rem;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.say {
		display: grid;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--border);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.4rem;
	}
</style>
