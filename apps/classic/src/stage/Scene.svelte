<script lang="ts">
	// The scene: the picture, the things on it, and what the world just said.
	import { untrack } from "svelte";
	import GapMark from "./GapMark.svelte";
	import { wayArrow, waySide } from "./layout";
	import type { Line, Stage } from "./model";
	import TalkPanel from "./TalkPanel.svelte";
	import ThingFigure from "./ThingFigure.svelte";
	import { saidSince, withoutAnswerList } from "./words";

	type Props = {
		stage: Stage;
		perceive: boolean;
		/** Show the mock's gap marks in place. */
		marks: boolean;
		onattempt: (thingId: string, offerId: string) => void;
		onself: (what: "hero" | "pack") => void;
		onhint: (sentence: string | null) => void;
		onstep: (col: number, row: number) => void;
		onanswer: (roundId: string, answerId: string) => void;
		onsay: (text: string) => void;
		onfill: (values: Record<string, number>) => void;
		onrestart: () => void;
		onback: () => void;
		onforward: () => void;
		onleave: () => void;
	};
	let { stage, perceive, marks, onattempt, onself, onhint, onstep, onanswer, onsay, onfill, onback, onforward, onrestart, onleave }: Props =
		$props();

	// The shell's own two offers on the hero; every other one is the world's.
	const HERO = "stage:hero";
	const PACK = "stage:pack";

	const ways = $derived(stage.things.filter((thing) => thing.kind === "way"));
	// The hero is a thing too. What it affords is the app's own: the sheet and the pack.
	const figures = $derived(
		stage.things
			.filter((thing) => thing.kind !== "way")
			.map((thing) =>
				thing.kind === "self" && !stage.hero.drafting
					? {
							...thing,
							offers: [
								{ id: HERO, label: "Hero", sentence: "Look at yourself", lead: true },
								{ id: PACK, label: "Pack", sentence: "Open your pack", lead: true },
								// What the hero can do anywhere, as the world lists it.
								...thing.offers,
							],
						}
					: thing,
			),
	);
	const guided = $derived(Boolean(stage.talk?.outline));
	const gap = (id: string) => (marks ? stage.gaps.find((entry) => entry.id === id) : undefined);

	// New lines show for a while: speech and refusals as a bubble on their
	// thing, everything else as a caption over the scene.
	let bubbles = $state<Record<string, Line>>({});
	let caption = $state<Line | null>(null);
	let seen = 0;

	function showFor(line: Line): number {
		return Math.max(3200, Math.min(line.text.length, 240) * 75);
	}

	// Turning to somebody opens their question in the talk panel; the bubble
	// that carried it has done its work.
	$effect(() => {
		const speaker = stage.talk?.question ? stage.talk.speakerId : undefined;
		if (speaker) untrack(() => delete bubbles[speaker]);
	});

	$effect(() => {
		// The story stands in world order, so a new line can sit above an older one.
		const fresh = stage.lines.filter((line) => line.id > seen).sort((a, b) => a.id - b.id);
		if (fresh.length === 0) return;
		seen = fresh[fresh.length - 1]?.id ?? seen;
		untrack(() => {
			for (const line of fresh) {
				if (line.old) continue;
				const spoken = line.kind === "speech" || line.kind === "mine" || line.kind === "refusal";
				// The talk panel already shows what its speaker asks; a bubble with
				// the same question over it would only say it twice.
				const talk = stage.talk;
				if (line.kind === "speech" && talk?.question && talk.speakerId === line.thingId) continue;
				// A way out has no figure to hang a bubble on; its answer is a caption.
				if (spoken && line.thingId && figures.some((thing) => thing.id === line.thingId)) {
					const id = line.thingId;
					// The answers to pick from are in the talk panel, not in the bubble.
					bubbles[id] = line.kind === "speech" ? { ...line, text: withoutAnswerList(line.text) } : line;
					setTimeout(() => {
						if (bubbles[id]?.id === line.id) delete bubbles[id];
					}, showFor(line));
				} else {
					caption = line;
					setTimeout(() => {
						if (caption?.id === line.id) caption = null;
					}, showFor(line));
				}
			}
		});
	});
</script>

<section
	class="st-scene"
	aria-label={stage.place.name}
	data-talk={stage.talk ? (guided ? "guided" : "free") : undefined}
	data-perceive={perceive ? "" : undefined}
	data-fight={stage.fight ? "" : undefined}
>
	<div class="st-pan">
		<div class="st-stage">
			<div class="st-camera">
			{#if stage.place.art}
				<img class="st-backdrop" src={stage.place.art.url} alt="" draggable="false" />
			{:else}
				<div class="st-plain"></div>
			{/if}
			<div class="st-light"></div>

			{#if stage.fight}
				{#each stage.fight.cells as cell (`${cell.col}:${cell.row}`)}
					<button
						type="button"
						class="st-cell"
						style="left: calc({cell.x} * var(--u)); top: calc({cell.y} * var(--u)); width: calc({stage.fight.cellSize
							.w} * var(--u)); height: calc({stage.fight.cellSize.h} * var(--u));"
						aria-label="Step to column {cell.col + 1}, row {cell.row + 1}"
						disabled={!stage.fight.myTurn}
						onclick={() => onstep(cell.col, cell.row)}
						onpointerenter={() => onhint("Step here")}
						onpointerleave={() => onhint(null)}
					></button>
				{/each}
			{/if}

			{#each ways as way (way.id)}
				{@const go = way.offers[0]}
				<button
					type="button"
					class="st-way"
					style="left: calc({way.x} * var(--u)); top: calc({way.y} * var(--u));"
					data-side={waySide(way)}
					data-refused={go?.refused ? "" : undefined}
					title={go?.refused ? `Last time: ${go.refused}` : undefined}
					onclick={() => go && onattempt(way.id, go.id)}
					onpointerenter={() => onhint(go?.sentence ?? way.name)}
					onpointerleave={() => onhint(null)}
					onfocus={() => onhint(go?.sentence ?? way.name)}
					onblur={() => onhint(null)}
				>
					<b aria-hidden="true">{wayArrow(way.way?.direction ?? "")}</b>
					{way.name}
					{#if way.way?.gate}<small>{way.way.gate}</small>{/if}
				</button>
			{/each}

			{#each figures as thing (thing.id)}
				<ThingFigure
					{thing}
					talking={stage.talk?.speakerId === thing.id}
					bubble={bubbles[thing.id]}
					flashes={stage.flashes.filter((flash) => flash.thingId === thing.id)}
					onattempt={(thingId, offerId) =>
						offerId === HERO || offerId === PACK ? onself(offerId === PACK ? "pack" : "hero") : onattempt(thingId, offerId)}
					{onhint}
				/>
			{/each}
			</div>
		</div>
	</div>

	{#if marks}
		<div class="st-gaprow">
			<GapMark gap={gap("picture")} />
			<GapMark gap={gap("position")} />
			{#if stage.fight}<GapMark gap={gap("reach")} />{/if}
			{#if stage.talk?.outline}<GapMark gap={gap("outline")} />{/if}
			{#if stage.talk?.freeSpeech}<GapMark gap={gap("replies")} />{/if}
		</div>
	{/if}

	{#if caption}
		{#key caption.id}<p class="st-caption" data-kind={caption.kind} aria-live="polite">{caption.text}</p>{/key}
	{/if}

	{#if stage.talk}
		<TalkPanel round={stage.talk} said={saidSince(stage.lines, stage.talk.speakerId)} busy={stage.busy !== null} {onanswer} {onsay} {onfill} {onback} {onforward} {onrestart} {onleave} />
	{/if}
</section>
