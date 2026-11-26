<script lang="ts">
	import type { Snippet } from "svelte";
	import MosaicGlyph from "./MosaicGlyph.svelte";

	export interface ThreadParticipant {
		id: string;
		name: string;
		kind: "person" | "creature" | "thing";
	}

	/**
	 * The Talk scene's participant head (sk-jay0.1.8.12 task 5, extracted from
	 * `Thread.svelte` at sk-jay0.1.8.63.1 Part B once Talk's stage transcript
	 * moved to the shared Table stream): tap sets the composer's target; a
	 * second tap on the ALREADY-targeted participant toggles a client-side
	 * view filter — never a private channel, everyone at the place still hears
	 * everything; the filter only narrows what the stream below renders. Sits
	 * ABOVE the stream at stage, a Talk-only header rather than part of the
	 * shared list. Markup/classes carried over unchanged from `Thread.svelte`.
	 */
	let {
		participants = [],
		portrait,
		targetName = null,
		onSetTarget,
		filterId = null,
		onToggleFilter,
	}: {
		/** Everyone present, for the participant head. */
		participants?: ThreadParticipant[];
		portrait?: Snippet<[ThreadParticipant]>;
		/** The composer's current target name, for the head's highlight. */
		targetName?: string | null;
		onSetTarget?: (participant: ThreadParticipant) => void;
		/** The occupant id the view is currently filtered to, if any (second
		 * tap on the head — a client-side view filter, never a private
		 * channel: everyone at the node still hears everything). */
		filterId?: string | null;
		onToggleFilter?: (id: string | null) => void;
	} = $props();
</script>

{#if participants.length > 0}
	<div class="flex flex-col gap-2" data-slot="talk-participants">
		<ul class="flex flex-wrap gap-1.5" aria-label="Who is here">
			{#each participants as participant (participant.id)}
				{@const isTarget = participant.name === targetName}
				{@const isFiltered = filterId === participant.id}
				<li>
					<button
						type="button"
						class="sk-play-row inline-flex items-center gap-1.5 px-2 py-1 text-xs"
						aria-pressed={isTarget || isFiltered}
						aria-label={participant.name}
						title={isFiltered ? `Showing only ${participant.name}` : `Speak to ${participant.name}`}
						onclick={() => {
							if (isTarget) {
								onToggleFilter?.(isFiltered ? null : participant.id);
							} else {
								onSetTarget?.(participant);
								onToggleFilter?.(null);
							}
						}}
					>
						<span class="play-thread__participant-avatar" aria-hidden="true">
							<MosaicGlyph
								name={participant.kind === "person" ? "person" : "thing"}
								class="play-thread__participant-glyph size-3.5"
							/>
							{@render portrait?.(participant)}
						</span>
						{participant.name}
					</button>
				</li>
			{/each}
		</ul>
		{#if filterId !== null}
			<p class="sk-play-muted m-0 text-xs">
				Showing only this person's lines — everyone here still hears everything.
			</p>
		{/if}
	</div>
{/if}

<style>
	.play-thread__participant-avatar {
		display: grid;
		inline-size: 1.125rem;
		block-size: 1.125rem;
		flex: 0 0 auto;
		place-items: center;
		overflow: hidden;
		border-radius: var(--radius);
	}

	.play-thread__participant-avatar :global([data-slot="play-artwork"]) {
		inline-size: 100%;
		block-size: 100%;
	}

	:global(.play-thread__participant-avatar:has([data-slot="play-artwork"][data-state="ready"]) .play-thread__participant-glyph) {
		display: none;
	}
</style>
