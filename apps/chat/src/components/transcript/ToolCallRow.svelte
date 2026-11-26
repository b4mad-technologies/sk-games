<script lang="ts">
	import { Accordion } from "@spellkave/ui/accordion";

	let {
		toolName,
		args,
		resultText = null,
		isError = false,
		pending = false,
	}: {
		toolName: string;
		args: unknown;
		resultText?: string | null;
		isError?: boolean;
		pending?: boolean;
	} = $props();

	const argLine = $derived(JSON.stringify(args) ?? "{}");
	const resultTitle = $derived(isError ? "← error" : "← ok");
	const accordionItems = $derived([
		{
			value: "result",
			title: resultTitle,
			content: resultText === null || resultText === "" ? "(empty)" : resultText,
		},
	]);
</script>

<li
	data-testid="chat-tool-call"
	class="flex flex-col gap-1 font-mono text-xs text-muted-foreground"
>
	<p>→ {toolName} {argLine}</p>
	{#if pending}
		<p data-testid="chat-tool-pending">…</p>
	{:else}
		<Accordion items={accordionItems} value="__collapsed__" />
	{/if}
</li>
