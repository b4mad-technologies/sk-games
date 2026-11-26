<script lang="ts">
	import type { DockBarEntry, DockBarSection } from "@spellkave/ui";
	import { Dialog, DockBarMenu } from "@spellkave/ui";
	import { onMount } from "svelte";
	import App from "../App.svelte";
	import { parsePlayRecording } from "../lib/play-recording";
	import { createRecordingScenario, type RecordingScenarioController, type RecordingScenarioSnapshot } from "./recording-scenario";
	import { type CreationStep, createPlayground, creationStep, creationSteps, readonlyRecordings, type SceneId, sceneId, scenes } from "./scenes";

	const params = new URLSearchParams(window.location.search);
	let selected = $state<SceneId>(sceneId(params.get("scene")));
	let checkpoint = $state<CreationStep>(creationStep(params.get("step")));
	let snapshot = $state.raw<RecordingScenarioSnapshot>();
	let generation = $state(0);
	let controller = $state.raw<RecordingScenarioController>(createPlayground(sceneId(params.get("scene")), receiveSnapshot, creationStep(params.get("step"))));
	let importError = $state<string | null>(null);
	let importedName = $state<string | null>(null);
	let importGeneration = 0;
	let fileInput = $state<HTMLInputElement | null>(null);
	let detailsOpen = $state(false);
	const frames = $derived(controller.recording.frames);
	const frameIndex = $derived(Math.max(0, frames.findIndex((frame) => frame.id === (snapshot?.frameId ?? controller.snapshot().frameId))));
	const frameCount = $derived(frames.length);
	const sceneItems = [...scenes, ...readonlyRecordings].map((scene) => ({ value: scene.id, label: scene.label }));
	const checkpointItems = creationSteps.map((step) => ({ value: step, label: step.charAt(0).toUpperCase() + step.slice(1) }));

	function receiveSnapshot(next: RecordingScenarioSnapshot) {
		if (snapshot && snapshot.frameId !== next.frameId && JSON.stringify(snapshot.presentation) !== JSON.stringify(next.presentation)) generation += 1;
		snapshot = next;
	}

	function restart() {
		importGeneration += 1;
		importedName = null;
		importError = null;
		controller = createPlayground(selected, receiveSnapshot, checkpoint);
		snapshot = controller.snapshot();
		generation += 1;
		const url = new URL(window.location.href);
		url.searchParams.set("scene", selected);
		if (selected === "creation") url.searchParams.set("step", checkpoint);
		else url.searchParams.delete("step");
		window.history.replaceState(null, "", url);
	}
	async function importRecording(file: File | null): Promise<void> {
		if (file === null) return;
		const request = ++importGeneration;
		try {
			if (file.size > 10 * 1024 * 1024) throw new Error("Recording exceeds the 10 MiB import limit.");
			const recording = parsePlayRecording(JSON.parse(await file.text()));
			if (request !== importGeneration) return;
			const frame = recording?.frames.at(-1);
			if (frame === undefined) throw new Error("No Play frames found.");
			controller = createRecordingScenario({ recording, onChange: receiveSnapshot });
			importedName = file.name;
			snapshot = controller.snapshot();
			generation += 1;
			importError = null;
		} catch (cause) {
			if (request !== importGeneration) return;
			importError = cause instanceof Error ? cause.message : "Could not read this recording.";
		}
	}
	function selectFrame(id: string) {
		if (!controller.selectFrame(id)) return;
		snapshot = controller.snapshot();
		// App reads the sandbox's initial presentation at mount. Remount when
		// explicitly scrubbing to restore that frame's layout/breakpoint too.
		generation += 1;
	}
	function seek(index: number) {
		const frame = frames[index];
		if (frame && index !== frameIndex) selectFrame(frame.id);
	}
	function chooseScene(value: string) {
		const capture = readonlyRecordings.find((item) => item.id === value);
		if (capture) {
			importGeneration += 1;
			controller = createRecordingScenario({ recording: capture.recording, onChange: receiveSnapshot });
			importedName = capture.label;
			importError = null;
			snapshot = controller.snapshot();
			generation += 1;
			return;
		}
		selected = sceneId(value);
		restart();
	}
	function isCurrentSceneValue(value: string): boolean {
		if (importedName === null) return value === selected;
		return readonlyRecordings.some((recording) => recording.id === value && recording.label === importedName);
	}
	function selectMockEntry(id: string): void {
		if (id.startsWith("scene:")) {
			chooseScene(id.slice("scene:".length));
			return;
		}
		if (id.startsWith("step:")) {
			checkpoint = creationStep(id.slice("step:".length));
			restart();
			return;
		}
		switch (id) {
			case "reset":
				restart();
				break;
			case "prev":
				seek(frameIndex - 1);
				break;
			case "next":
				seek(frameIndex + 1);
				break;
			case "import":
				fileInput?.click();
				break;
			case "details":
				detailsOpen = true;
				break;
		}
	}
	onMount(() => {
		const restore = () => {
			const next = new URLSearchParams(window.location.search);
			selected = sceneId(next.get("scene"));
			checkpoint = creationStep(next.get("step"));
			restart();
		};
		window.addEventListener("popstate", restore);
		return () => window.removeEventListener("popstate", restore);
	});

	const sceneSubmenu = $derived.by((): DockBarEntry[] =>
		sceneItems.map((item) => ({
			id: `scene:${item.value}`,
			label: item.label,
			hint: isCurrentSceneValue(item.value) ? "✓" : undefined,
		})),
	);
	const checkpointSubmenu = $derived.by((): DockBarEntry[] =>
		checkpointItems.map((item) => ({
			id: `step:${item.value}`,
			label: item.label,
			hint: item.value === checkpoint ? "✓" : undefined,
		})),
	);
	const sceneSectionEntries = $derived.by((): DockBarEntry[] => {
		const entries: DockBarEntry[] = [{ id: "scene", label: "Scene", submenu: sceneSubmenu }];
		if (selected === "creation" && importedName === null) {
			entries.push({ id: "step", label: "Start at", submenu: checkpointSubmenu });
		}
		entries.push({ id: "reset", label: importedName === null ? "Reset scene" : "Return to scenario" });
		return entries;
	});
	const importHint = $derived(
		importError === null ? undefined : importError.length > 40 ? `${importError.slice(0, 40)}…` : importError,
	);
	const mockSections = $derived.by((): DockBarSection[] =>
		[
			{ entries: sceneSectionEntries },
			{
				entries: [
					{ id: "prev", label: "Previous frame", disabled: frameIndex === 0 },
					{
						id: "next",
						label: "Next frame",
						disabled: frameIndex === frameCount - 1,
						hint: `${frameIndex + 1} / ${frameCount}`,
					},
				],
			},
			{ entries: [{ id: "import", label: "Import Play recording…", hint: importHint }] },
			{ entries: [{ id: "details", label: "Recording details…" }] },
		].filter((section) => section.entries.length > 0),
	);
</script>

{#snippet mockMenuHeader()}
	<div class="seat-menu__who">
		<p class="seat-menu__name sk-display">{importedName ?? scenes.find((scene) => scene.id === selected)?.label}</p>
		<p class="seat-menu__world">No live world · {importedName === null ? "Scenario" : "Read-only"}</p>
	</div>
{/snippet}

{#snippet detailsContent()}
	<details>
		<summary>Recording details</summary>
		<p class="note">Source: {controller.recording.provenance?.source ?? "unspecified"}. {controller.recording.provenance?.title ?? ""}</p>
		<p class="note">Scenarios only switch to recorded frames; unsupported inputs leave the view unchanged.</p>
	</details>
	<details>
		<summary>Action log ({snapshot?.log.length ?? 0})</summary>
		{#if snapshot?.log.length}
			<ol>{#each snapshot.log as entry, index (`${index}:${entry}`)}<li>{entry}</li>{/each}</ol>
		{:else}
			<p>No actions yet. Try the game behind this panel.</p>
		{/if}
	</details>
	<details>
		<summary>View data</summary>
		<pre>{JSON.stringify(snapshot?.view ?? controller.snapshot().view, null, 2)}</pre>
	</details>
{/snippet}

{#snippet mockMenu()}
	<DockBarMenu
		label={importedName === null ? "Mock" : "Recording"}
		accessibleLabel="Mock scene menu"
		header={mockMenuHeader}
		sections={mockSections}
		onSelect={selectMockEntry}
	/>
{/snippet}

{#key generation}
	<App sandbox={controller.sandbox} dockExtras={mockMenu} />
{/key}

{#if importError}
	<p role="alert" class="mock-menu__error">{importError}</p>
{/if}

<input
	bind:this={fileInput}
	aria-label="Import Play recording"
	id="playground-recording"
	type="file"
	accept="application/json,.json"
	hidden
	onchange={(event) => void importRecording(event.currentTarget.files?.[0] ?? null)}
/>

<Dialog bind:open={detailsOpen} title="Recording details" class="mock-menu__dialog-trigger" content={detailsContent} />

<style>
	.mock-menu__error {
		position: fixed;
		top: calc(0.5rem + env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		max-width: min(28rem, calc(100vw - 1.5rem));
		margin: 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--destructive);
		font-size: 0.8rem;
		line-height: 1.5;
	}
	:global(.mock-menu__dialog-trigger) {
		display: none;
	}
	.note {
		color: var(--muted-foreground);
	}
	p {
		margin: 0;
		line-height: 1.5;
	}
	summary {
		cursor: pointer;
		padding-block: 0.5rem;
	}
	ol {
		padding-left: 1.25rem;
	}
	pre {
		max-height: 16rem;
		overflow: auto;
		font-size: 0.75rem;
	}
</style>
