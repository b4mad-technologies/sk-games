<script lang="ts">
	import type { AgentMessage } from "@earendil-works/pi-agent-core";
	import { buildTranscript } from "../../lib/transcript";
	import AssistantTurn from "./AssistantTurn.svelte";
	import ToolCallRow from "./ToolCallRow.svelte";
	import UserTurn from "./UserTurn.svelte";

	let {
		messages,
		streaming = undefined,
	}: {
		messages: AgentMessage[];
		streaming?: AgentMessage;
	} = $props();

	const items = $derived(buildTranscript(messages, streaming));
	let scroller: HTMLElement | undefined = $state();
	let stickToBottom = $state(true);

	function onScroll(): void {
		const el = scroller;
		if (el === undefined) return;
		stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
	}

	$effect(() => {
		items;
		if (!stickToBottom) return;
		const el = scroller;
		if (el === undefined) return;
		el.scrollTop = el.scrollHeight;
	});
</script>

<ol
	bind:this={scroller}
	onscroll={onScroll}
	data-testid="chat-messages"
	class="flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto text-sm"
>
	{#if items.length === 0}
		<li class="text-muted-foreground">No messages yet.</li>
	{:else}
		{#each items as item (item.id)}
			{#if item.kind === "user"}
				<UserTurn text={item.text} />
			{:else if item.kind === "assistant"}
				<AssistantTurn
					text={item.text}
					streaming={item.streaming}
					aborted={item.aborted}
					error={item.error}
				/>
			{:else}
				<ToolCallRow
					toolName={item.toolName}
					args={item.args}
					resultText={item.resultText}
					isError={item.isError}
					pending={item.pending}
				/>
			{/if}
		{/each}
	{/if}
</ol>
