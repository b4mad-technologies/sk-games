<script lang="ts">
	// thinkingContentBlocks() in lib/transcript.ts is the ThinkingContent extension point.
	// This WebLLM provider never emits thinking_* / ThinkingContent, so nothing is rendered here.
	let {
		text,
		streaming = false,
		aborted = false,
		error = null,
	}: {
		text: string;
		streaming?: boolean;
		aborted?: boolean;
		error?: string | null;
	} = $props();

	const testId = $derived(streaming ? "chat-streaming" : "chat-assistant");
</script>

<li data-testid={testId} class="text-foreground">
	Assistant: {text}
	{#if aborted}
		<span data-testid="chat-aborted" class="ml-2 text-xs uppercase tracking-wide text-muted-foreground"
			>aborted</span
		>
	{/if}
	{#if error !== null}
		<p data-testid="chat-error" class="mt-1 text-sm text-destructive" role="alert">{error}</p>
	{/if}
</li>
