<script lang="ts">
	// The shell: one line on top, the scene, one narrow line at the foot.
	// It reads a `Stage` and acts through a `World`; it knows nothing else.
	import GapMark from "./GapMark.svelte";
	import type { PackItem, World } from "./model";
	import Panel from "./Panel.svelte";
	import Scene from "./Scene.svelte";
	import { CANVAS } from "./session/map-from-view";
	import { withoutAnswerList } from "./words";

	type Props = { world: World & { pictures?: boolean } };
	let { world }: Props = $props();

	const stage = $derived(world.stage);
	const talk = $derived(stage.talk);
	const fight = $derived(stage.fight);
	const lastLine = $derived(stage.lines[stage.lines.length - 1]);
	// The world's answer comes before a hint the pointer left behind: a new
	// line takes the sentence line, the next move of the pointer hints again.
	$effect(() => {
		lastLine?.id;
		hint = null;
	});

	// The sentence line at rest: the last thing that happened. A question the
	// talk panel shows right above is not said a second time.
	const idle = $derived.by(() => {
		// Down, the one thing to know is that there is a way on.
		const self = stage.things.find((thing) => thing.kind === "self");
		// The world's answer to a click (a death saving throw) still comes first.
		const answered = lastLine && !lastLine.old && (lastLine.kind === "result" || lastLine.kind === "refusal");
		if (self?.down && !answered)
			return `${self.name} is down. A click on ${self.name} shows what can still be done.`;
		// What was said before the app opened is in the story, not news.
		// Opened in the middle of a fight, the one thing to know is whose turn it is.
		if (!lastLine || lastLine.old) return fight?.myTurn ? "Your turn." : "";
		// The turn came back: what the others did meanwhile, then whose turn it is.
		if (fight?.recap && lastLine.kind === "story") return [...fight.recap, "Your turn."].join(" ");
		if (talk?.question && lastLine.kind === "speech" && lastLine.thingId === talk.speakerId) return "";
		return `${lastLine.who ? `${lastLine.who}: ` : ""}${withoutAnswerList(lastLine.text)}`;
	});

	type PanelId = "story" | "pack" | "hero" | "map" | "gaps";
	let panel = $state<PanelId | null>(null);
	let hint = $state<string | null>(null);
	let perceive = $state(false);
	// The place's description, whole, under the top line.
	let wholePlace = $state(false);
	$effect(() => {
		stage.place.id;
		wholePlace = false;
	});
	let words = $state("");
	let pickedItem = $state<string | null>(null);
	// The "≈" marks in place are a builder's view: on for the mock, which is
	// there to show what it fakes, and off on a live world until asked for.
	// svelte-ignore state_referenced_locally
	let marks = $state(world.mock === true);
	// The map opens on the sheet the hero stands on; a tab or a door turns the page.
	let sheetId = $state<string | null>(null);
	const sheet = $derived(stage.map.sheets.find((entry) => entry.id === sheetId) ?? stage.map.sheets[0]);
	const seenOnly = $derived(stage.map.sheets.some((entry) => entry.places.some((place) => !place.known)));
	// What stands behind the gaps button: a mock fakes, a live world leaves out.
	const gapsTitle = $derived(world.mock ? "What this mock fakes" : "What the world does not send yet");
	const gap = (id: string) => (marks ? stage.gaps.find((entry) => entry.id === id) : undefined);

	const item = $derived<PackItem | undefined>(stage.pack.find((entry) => entry.id === pickedItem));
	const freeSpeech = $derived(Boolean(talk?.freeSpeech));

	// The outline of a guided talk can be longer than the top line.
	let outline = $state<HTMLElement>();
	$effect(() => {
		talk?.outline;
		outline?.querySelector('[aria-current="step"]')?.scrollIntoView({ inline: "center", block: "nearest" });
	});

	function attempt(thingId: string, offerId: string): void {
		void world.attempt(thingId, offerId);
	}

	function say(event: SubmitEvent): void {
		event.preventDefault();
		if (!words.trim()) return;
		void world.say(words);
		words = "";
	}

	function pick(itemId: string): void {
		pickedItem = itemId;
		world.inspect?.(itemId);
	}

	function useItem(offerId: string): void {
		if (!item) return;
		panel = null;
		void world.attempt(item.id, offerId);
	}

	function walk(placeId: string): void {
		panel = null;
		void world.walkTo(placeId);
	}

	function onkeydown(event: KeyboardEvent): void {
		const typing = event.target instanceof HTMLInputElement;
		if (event.key === "Escape" && talk && !talk.outline && !panel) world.talkTo(null);
		if (event.key === "Tab" || typing) return;
		if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
			event.preventDefault();
			perceive = !perceive;
		}
		// A desktop has a keyboard: one letter opens a sheet, the same closes it.
		// A held key repeats; one press is one turn of the sheet.
		if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
		const sheet = SHEET_KEYS[event.key.toLowerCase()];
		if (!sheet || (stage.hero.drafting && sheet !== "story")) return;
		if (sheet === "map" && stage.map.sheets.length === 0) return;
		if (sheet === "map") sheetId = null;
		panel = panel === sheet ? null : sheet;
	}

	// From here on the sentence line no longer fits one line beside a fight's chips.
	const LONG_SENTENCE = 70;
	const SHEET_KEYS: Record<string, PanelId> = { s: "story", m: "map", p: "pack", h: "hero" };

	// The story is read from its end: open it there.
	let storyEnd = $state<HTMLElement>();
	$effect(() => {
		if (panel === "story") storyEnd?.scrollIntoView({ block: "end" });
	});
</script>

<svelte:window {onkeydown} />

<div class="st-app">
	<header class="st-top">
		<div class="st-place">
			<strong>{stage.place.name}</strong>
			{#if !talk?.outline && !fight && stage.place.description}
				<!-- The top line cuts a long description; pointing at it or a click shows it whole. -->
				<button
					type="button"
					class="st-placeabout"
					aria-expanded={wholePlace}
					onclick={() => (wholePlace = !wholePlace)}
					onpointerenter={() => (wholePlace = true)}
					onpointerleave={() => (wholePlace = false)}
					onblur={() => (wholePlace = false)}
				>
					{stage.place.description}
				</button>
				{#if wholePlace}<p class="st-placecard st-float">{stage.place.description}</p>{/if}
			{/if}
		</div>

		{#if talk?.outline}
			<ol class="st-outline" aria-label="Steps" bind:this={outline}>
				{#each talk.outline as step (step.id)}
					<li
						aria-current={step.current ? "step" : undefined}
						data-done={step.value ? "" : undefined}
						title={step.value ? `${step.label}: ${step.value}` : step.label}
					>
						<small>{step.label}</small>{#if step.art}<img src={step.art.url} alt="" />{/if}<span>{step.short ?? step.value ?? ""}</span
						>{#if step.more}<span class="st-count">+{step.more}</span>{/if}
					</li>
				{/each}
			</ol>
			<div class="st-spacer"></div>
		{:else if fight}
			<ol class="st-roster" aria-label={fight.round ? `Turn order, round ${fight.round}` : "Turn order"}>
				{#each fight.roster as fighter (fighter.id)}
					<li aria-current={fighter.active ? "true" : undefined} data-down={fighter.down ? "" : undefined}>
						{#if fighter.art}<img src={fighter.art.url} alt="" />{/if}
						<span>{fighter.name}</span>
					</li>
				{/each}
			</ol>
			<div class="st-spacer"></div>
		{/if}

		{#if !stage.hero.drafting}
			<button
				type="button"
				class="st-btn"
				disabled={stage.map.sheets.length === 0}
				title={stage.map.sheets.length === 0 ? "No map while the fight lasts" : "Everything you have seen (M)"}
				onclick={() => {
					sheetId = null;
					panel = "map";
				}}
			>
				Map
			</button>
		{/if}
		<button type="button" class="st-btn" onclick={() => (panel = "gaps")} title={gapsTitle}>
			{world.mock ? "Mock" : "Gaps"} <span class="st-count">{stage.gaps.length}</span>
		</button>
	</header>

	<Scene
		{stage}
		{perceive}
		{marks}
		onattempt={attempt}
		onself={(what) => (panel = what)}
		onhint={(sentence) => (hint = sentence)}
		onstep={(col, row) => void world.step(col, row)}
		onanswer={(roundId, answerId) => void world.answer(roundId, answerId)}
		onsay={(text) => void world.say(text)}
		onfill={(values) => void world.fill(values)}
		onback={() => void world.back()}
		onforward={() => void world.forward()}
		onrestart={() => void world.restart()}
		onleave={() => world.talkTo(null)}
	/>

	<footer class="st-foot">
		<button type="button" class="st-btn" title="Everything that happened (S)" onclick={() => (panel = "story")}>Story</button>

		{#if freeSpeech && !stage.busy}
			<form class="st-say" onsubmit={say}>
				<label for="st-words">Say to {talk?.speakerName}:</label>
				<input id="st-words" class="st-input" bind:value={words} autocomplete="off" maxlength="200" />
				<button type="submit" class="st-btn st-btn--solid" disabled={!words.trim()}>Say</button>
			</form>
		{:else}
			<div class="st-sentence" aria-live="polite">
				{#if stage.reaction && world.react}
					<!-- The world waits for this answer; the fight does not go on before. -->
					<p data-tone="intent" title={stage.reaction.about}>You can react now: {stage.reaction.name}.</p>
					<button type="button" class="st-btn st-btn--solid" onclick={() => void world.react?.(true)}>React</button>
					<button type="button" class="st-btn" onclick={() => void world.react?.(false)}>Let it pass</button>
				{:else if stage.busy}
					<p data-tone="busy">{stage.busy.text}</p>
					{#if stage.busy.stoppable}
						<button type="button" class="st-btn" onclick={() => world.stop()}>Stop</button>
					{/if}
				{:else if hint}
					<p data-tone="intent">{hint}</p>
				{:else}
					<!-- A long sentence (what the others did in a fight) takes two lines. -->
					<p data-tone="idle" data-long={idle.length > LONG_SENTENCE ? "" : undefined} title={idle}>{idle}</p>
				{/if}
			</div>
		{/if}

		{#if fight}
			<!-- While the world waits for a reaction, the question has the line. -->
			{#each stage.reaction ? [] : fight.budget as chip (chip.id)}
				<span class="st-chip">
					{chip.label}
					<span class="st-pips" aria-hidden="true">
						{#each { length: chip.of } as _, index (index)}<i data-left={index < chip.left ? "" : undefined}></i>{/each}
					</span>
					<b>{chip.left}</b>
				</span>
			{/each}
			<button type="button" class="st-btn st-btn--solid" disabled={!fight.myTurn || stage.busy !== null} onclick={() => void world.endTurn()}>
				End turn
			</button>
		{/if}

		{#if !stage.hero.drafting}
			<button
				type="button"
				class="st-btn"
				aria-pressed={perceive}
				title="Show everything you can act on (Space)"
				onclick={() => (perceive = !perceive)}
			>
				Look around
			</button>
			<button type="button" class="st-btn" title="What you carry (P)" onclick={() => (panel = "pack")}>
				Pack <span class="st-count">{stage.pack.length}</span>
			</button>
			<button
				type="button"
				class="st-herochip"
				title="Your hero (H)"
				onclick={() => (panel = "hero")}
				aria-label="Hero: {stage.hero.name}"
			>
				{#if stage.hero.art}<img src={stage.hero.art.url} alt="" />{:else}<span class="st-noface"></span>{/if}
				<span>
					{stage.hero.name} · {stage.hero.hp}/{stage.hero.hpMax}
					<span class="st-hpbar">
						<i
							style="width: {(100 * stage.hero.hp) / stage.hero.hpMax}%"
							data-low={stage.hero.hp * 3 <= stage.hero.hpMax ? "" : undefined}
						></i>
					</span>
				</span>
			</button>
		{/if}
	</footer>
</div>

<Panel open={panel === "story"} title="The story so far" onclose={() => (panel = null)}>
	<ol class="st-story">
		{#each stage.lines as line (line.id)}
			<li data-kind={line.kind}>
				{#if line.who}<b>{line.who}:</b>{/if}
				{line.text}
			</li>
		{/each}
	</ol>
	<span bind:this={storyEnd}></span>
</Panel>

<Panel open={panel === "pack"} title="Pack" wide onclose={() => (panel = null)}>
	<GapMark gap={gap("pack-art")} />
	{#if stage.pack.length === 0}
		<p>Your pack is empty.</p>
	{:else}
		<!-- The list and the picked thing side by side: a long pack does not push the detail out of sight. -->
		<div class="st-pack">
		<ul class="st-slots">
			{#each stage.pack as entry (entry.id)}
				<li>
					<button
						type="button"
						class="st-slot"
						data-inside={entry.depth ? "" : undefined}
						aria-pressed={entry.id === pickedItem}
						onclick={() => pick(entry.id)}
					>
						{#if entry.art}<img src={entry.art.url} alt="" />{:else}<span class="st-noart">{entry.name.slice(0, 1)}</span>{/if}
						<span>
							{entry.name}{entry.quantity > 1 ? ` ×${entry.quantity}` : ""}
							{#if entry.worn}<small>worn: {entry.worn}</small>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
		{#if item}
			<div class="st-detail">
				<strong>{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}</strong>
				{#if item.worn}<p class="st-worn">Worn: {item.worn}.</p>{/if}
				{#if item.description}<p class="st-about st-about--whole">{item.description}</p>{/if}
				{#if item.offers.some((offer) => offer.id === "drink")}<GapMark gap={gap("use")} />{/if}
				{#each item.offers.filter((offer) => offer.lead) as offer (offer.id)}
					<button type="button" class="st-btn st-btn--solid" onclick={() => useItem(offer.id)}>{offer.label}</button>
				{/each}
				{#if item.offers.some((offer) => !offer.lead)}
					{@const rest = item.offers.filter((offer) => !offer.lead)}
					<details class="st-more">
						<summary>
							{item.offers.some((offer) => offer.lead) ? "more…" : "The world names nothing made for this thing. Try anyway…"}
							({rest.length})
						</summary>
						{#each rest as offer (offer.id)}
							<button type="button" class="st-btn" title={offer.group} onclick={() => useItem(offer.id)}>{offer.label}</button>
						{/each}
					</details>
				{/if}
			</div>
		{:else}
			<p class="st-about st-detail">Pick a thing to see what it is and what you can do with it.</p>
		{/if}
		</div>
	{/if}
</Panel>

<Panel open={panel === "hero"} title="Hero" onclose={() => (panel = null)}>
	<div class="st-sheet">
		{#if stage.hero.art}<img src={stage.hero.art.url} alt="" />{:else}<span class="st-glyph st-glyph--body"></span>{/if}
		<div>
			<h3>{stage.hero.name}</h3>
			<p>{stage.hero.calling} · level {stage.hero.level}</p>
			{#if stage.hero.conditions.length > 0}<p>Now: {stage.hero.conditions.join(", ")}.</p>{/if}
			<ul class="st-stats">
				<li><small>Hit points</small><b>{stage.hero.hp}/{stage.hero.hpMax}</b></li>
				<li><small>Armor</small><b>{stage.hero.ac}</b></li>
				<li>
					<small>XP</small><b>{stage.hero.xp}</b>
					{#if stage.hero.xpNext}<small>of {stage.hero.xpNext} for level {stage.hero.level + 1}</small>{/if}
				</li>
				{#if stage.hero.proficiency !== undefined}
					<li title="Added to what the hero is proficient in">
						<small>Proficiency</small><b>+{stage.hero.proficiency}</b>
					</li>
				{/if}
			</ul>
			<ul class="st-stats">
				{#each stage.hero.abilities as ability (ability.id)}
					<li title={ability.about}>
						<small>{ability.label.slice(0, 3)}</small>
						<b>{ability.score}</b>
						<small>{ability.modifier >= 0 ? "+" : ""}{ability.modifier}</small>
					</li>
				{/each}
			</ul>
			<p>Skilled in {stage.hero.skills.join(", ") || "nothing yet"}.</p>
			{#if stage.hero.left?.length}
				<p title="Read from the last time it was spent; forgotten after a rest.">
					Left when last spent: {stage.hero.left.map((entry) => `${entry.label} ${entry.left}`).join(" · ")}.
				</p>
			{/if}
			{#if stage.hero.quests?.length}
				<dl class="st-identity" aria-label="Quests">
					{#each stage.hero.quests as quest (quest.label)}
						<dt title={quest.about}>{quest.label}</dt>
						<dd>{quest.value}{quest.about ? ` · ${quest.about}` : ""}</dd>
					{/each}
				</dl>
			{:else if !world.mock}
				<p class="st-about">No quests listed. <GapMark gap={gap("quests")} /></p>
			{/if}
			{#if stage.hero.said?.length}
				<!-- The stage's own notes of the talk: nothing lists what the hero took on. -->
				<h4 class="st-saidhead" title="Kept by this browser from the talk. The world lists no quests.">
					What you answered
				</h4>
				<dl class="st-identity st-said">
					{#each stage.hero.said as entry, index (index)}
						<dt>{entry.who}</dt>
						<dd>
							You: “{entry.said}”
							{#if entry.reply}<span>“{withoutAnswerList(entry.reply)}”</span>{/if}
						</dd>
					{/each}
				</dl>
			{/if}
			{#if stage.hero.identity?.length}
				<dl class="st-identity">
					{#each stage.hero.identity as entry (entry.label)}
						<dt>{entry.label}</dt>
						<dd>{entry.about}</dd>
					{/each}
				</dl>
			{/if}
		</div>
	</div>
</Panel>

<Panel open={panel === "map"} title="Everything you have seen" wide onclose={() => (panel = null)}>
	{#if sheet}
		{#if stage.map.sheets.length > 1}
			<div class="st-sheets" role="tablist" aria-label="Areas">
				{#each stage.map.sheets as entry (entry.id)}
					<button
						type="button"
						role="tab"
						class="st-btn"
						aria-selected={entry.id === sheet.id}
						onclick={() => (sheetId = entry.id)}
					>
						{entry.title}
						{#if entry.places.some((place) => place.id === stage.map.here)}<span class="st-youarehere" title="You are here"></span>{/if}
					</button>
				{/each}
			</div>
		{/if}
		<div class="st-map" role="group" aria-label={sheet.title}>
			<svg viewBox="0 0 {CANVAS.width} {CANVAS.height}" aria-hidden="true">
				{#each sheet.routes as route (`${route.from}-${route.to}`)}
					{@const from = sheet.places.find((place) => place.id === route.from)}
					{@const to = sheet.places.find((place) => place.id === route.to)}
					{#if from && to}
						<line x1={from.x} y1={from.y} x2={to.x} y2={to.y} data-unknown={from.known && to.known ? undefined : ""} />
					{/if}
				{/each}
			</svg>
			{#each sheet.places as place (place.id)}
				<div class="st-mapspot" style="left: {(100 * place.x) / CANVAS.width}%; top: {(100 * place.y) / CANVAS.height}%;">
					<button
						type="button"
						class="st-mapnode"
						aria-current={place.id === stage.map.here ? "location" : undefined}
						data-unknown={place.known ? undefined : ""}
						data-cut={place.cut ? "" : undefined}
						title={place.id === stage.map.here
							? "You are here"
							: place.cut
								? `You know no way to ${place.name} from here yet.`
								: place.known
								? `Walk to ${place.name}`
								: `Walk to ${place.name}. You have seen it, not entered it.`}
						disabled={place.id === stage.map.here || place.cut || stage.busy !== null}
						onclick={() => walk(place.id)}
					>
						{place.name}
					</button>
					{#each place.doors ?? [] as door (door.sheet)}
						<button type="button" class="st-mapdoor" title="A way leads to {door.title}: turn to that sheet" onclick={() => (sheetId = door.sheet)}>
							⇄ {door.title}
						</button>
					{/each}
				</div>
			{/each}
		</div>
		<p class="st-about st-maplegend">
			<span><i class="st-mapkey" data-key="here"></i>you are here</span>
			<span><i class="st-mapkey"></i>been there</span>
			{#if seenOnly}<span><i class="st-mapkey" data-key="seen"></i>seen, not entered</span>{/if}
			<span>A click walks there, one way after the other; the world can stop you at each.</span>
			<GapMark gap={gap("map")} />
			<GapMark gap={gap("journey")} />
		</p>
	{:else}
		<p class="st-about">You have seen no place yet.</p>
	{/if}
</Panel>

<Panel open={panel === "gaps"} title={gapsTitle} onclose={() => (panel = null)}>
	<p>
		<button type="button" class="st-btn st-btn--solid" aria-pressed={marks} onclick={() => (marks = !marks)}>
			{marks ? "Hide the ≈ marks" : "Show the ≈ marks in place"}
		</button>
	</p>
	{#if world.pictures !== undefined}
		<p>
			<button type="button" class="st-btn st-btn--solid" onclick={() => (world.pictures = !world.pictures)}>
				{world.pictures ? "Hide the stand-in pictures" : "Show the stand-in pictures"}
			</button>
		</p>
	{/if}
	<ul class="st-gaps">
		{#each stage.gaps as gap (gap.id)}
			<li>
				<small>{gap.where}</small>
				<div>{gap.text}</div>
				{#if gap.bead}<code>{gap.bead}</code>{/if}
			</li>
		{/each}
	</ul>
</Panel>
