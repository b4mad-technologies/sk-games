<script lang="ts">
	import { Button, Progress } from "@spellkave/ui";
	import { catalogEntry } from "../lib/llm/catalog";
	import type { BrowserModelProvider } from "../lib/llm/provider";

	let {
		disabled = false,
		onReady,
	}: {
		disabled?: boolean;
		onReady: (provider: BrowserModelProvider) => void | Promise<void>;
	} = $props();

	const entry = catalogEntry();
	let loading = $state(false);
	let progress = $state(0);
	let progressText = $state("");
	let error = $state<string | null>(null);

	async function load(): Promise<void> {
		if (loading || disabled) return;
		loading = true;
		error = null;
		progress = 0;
		progressText = "Starting download…";
		const { createWebLlmProvider } = await import("../lib/llm/webllm");
		const provider = createWebLlmProvider(entry);
		try {
			await provider.load((report) => {
				progress = Math.round(report.progress * 100);
				progressText = report.text;
			});
			await onReady(provider);
		} catch (cause) {
			provider.dispose();
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex flex-col gap-3" data-testid="model-picker">
	<p class="text-sm text-foreground" data-testid="model-name">
		{entry.label}
		<span class="text-muted-foreground">({entry.sizeLabel})</span>
	</p>
	<Button variant="woven-primary" onclick={load} disabled={loading || disabled} data-testid="model-load">
		{loading ? "Loading…" : "Load model"}
	</Button>
	{#if loading || progressText}
		<Progress value={progress} max={100} label={progressText} />
	{/if}
	{#if error !== null}
		<p class="text-sm text-destructive" data-testid="model-error" role="alert">{error}</p>
	{/if}
</div>
