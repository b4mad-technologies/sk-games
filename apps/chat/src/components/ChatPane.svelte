<script lang="ts">
	import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
	import { Button } from "@spellkave/ui";
	import { onDestroy } from "svelte";
	import { hasWebGpu } from "../lib/has-webgpu";
	import { catalogEntry } from "../lib/llm/catalog";
	import type { BrowserModelProvider } from "../lib/llm/provider";
	import { readMcpUrl } from "../lib/mcp/url";
	import {
		bindWorldToAgent,
		formatWorldStatus,
		type WorldClient,
		type WorldStatus,
	} from "../lib/mcp/world";
	import {
		defaultTranscriptStorage,
		type TranscriptStorage,
		transcriptKey,
	} from "../lib/transcript-idb";
	import ModelPicker from "./ModelPicker.svelte";
	import Transcript from "./transcript/Transcript.svelte";

	let {
		accessToken = null,
		userSub = "",
		transcriptStorage = undefined,
	}: {
		accessToken?: string | null;
		userSub?: string;
		transcriptStorage?: TranscriptStorage;
	} = $props();
	const fallbackStore = defaultTranscriptStorage();
	function activeStore(): TranscriptStorage {
		return transcriptStorage ?? fallbackStore;
	}

	let gpuOk = $state(hasWebGpu());
	let provider = $state<BrowserModelProvider | null>(null);
	let agent = $state<Agent | null>(null);
	let unsubscribe = $state<(() => void) | null>(null);
	let worldClient = $state<WorldClient | null>(null);
	let worldStatus = $state<WorldStatus>({ kind: "disconnected", reason: "model not loaded" });
	let draft = $state("");
	let messages = $state<AgentMessage[]>([]);
	let streaming = $state<AgentMessage | undefined>(undefined);
	let busy = $state(false);
	let sendError = $state<string | null>(null);
	let persistKey = $state("");

	const loaded = $derived(agent !== null);
	const worldLine = $derived(formatWorldStatus(worldStatus));
	const hint = $derived(
		!gpuOk
			? "WebGPU is required"
			: loaded
				? "Message the in-browser model"
				: "model not loaded yet",
	);

	function syncTranscript(next: Agent): void {
		messages = next.state.messages;
		streaming = next.state.streamingMessage;
	}

	async function persist(next: Agent): Promise<void> {
		const key = persistKey;
		if (key === "") return;
		await activeStore().save(key, next.state.messages);
	}

	function onAgentEvent(event: AgentEvent, next: Agent): void | Promise<void> {
		if (event.type === "agent_start") busy = true;
		if (event.type === "agent_end") busy = false;
		syncTranscript(next);
		if (event.type === "agent_end") return persist(next);
	}

	async function disconnectWorld(): Promise<void> {
		const current = worldClient;
		worldClient = null;
		if (current !== null) await current.disconnect().catch(() => undefined);
	}

	async function connectWorld(created: Agent): Promise<void> {
		await disconnectWorld();
		if (accessToken === null || accessToken === "") {
			worldStatus = { kind: "disconnected", reason: "no session" };
			return;
		}
		const bound = await bindWorldToAgent({
			agent: created,
			accessToken,
			url: readMcpUrl(import.meta.env as Record<string, string | undefined>),
			connect: async (opts) => {
				const { connectSpellkaveMcp } = await import("../lib/mcp/client");
				return connectSpellkaveMcp({ ...opts, getAccessToken: () => accessToken });
			},
		});
		worldClient = bound.client;
		worldStatus = bound.status;
	}

	async function onReady(next: BrowserModelProvider): Promise<void> {
		unsubscribe?.();
		await disconnectWorld();
		provider?.dispose();
		const entry = catalogEntry(next.id);
		const key = userSub !== "" ? transcriptKey(userSub, next.id) : "";
		persistKey = key;
		const stored = key === "" ? null : await activeStore().load(key);
		const { catalogToModel, createChatAgent } = await import("../lib/agent");
		const created = createChatAgent(
			next.createStreamFn(),
			catalogToModel(entry),
			stored ?? undefined,
		);
		provider = next;
		agent = created;
		unsubscribe = created.subscribe((event) => {
			onAgentEvent(event, created);
		});
		syncTranscript(created);
		busy = false;
		sendError = null;
		await connectWorld(created);
	}

	async function send(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const current = agent;
		const text = draft.trim();
		if (current === null || text.length === 0 || busy) return;
		draft = "";
		sendError = null;
		busy = true;
		try {
			await current.prompt(text);
		} catch (cause) {
			sendError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			syncTranscript(current);
			busy = false;
			await persist(current);
		}
	}

	function stop(): void {
		agent?.abort();
	}

	async function newChat(): Promise<void> {
		const current = agent;
		if (current === null) return;
		current.abort();
		current.reset();
		if (persistKey !== "") await activeStore().clear(persistKey);
		syncTranscript(current);
		busy = false;
		sendError = null;
	}

	onDestroy(() => {
		unsubscribe?.();
		void disconnectWorld();
		provider?.dispose();
	});
</script>

<section
	data-testid="chat-pane"
	class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-4"
	aria-label="Chat"
>
	<h2
		class="[font-family:var(--font-display)] text-lg font-medium tracking-[-0.025em] text-foreground"
	>
		Chat
	</h2>
	<p class="text-xs text-muted-foreground" data-testid="world-status">{worldLine}</p>

	{#if !gpuOk}
		<p class="text-sm text-foreground" data-testid="webgpu-missing" role="alert">
			This browser has no WebGPU. The in-browser model cannot run here — there is no hosted fallback.
		</p>
	{:else}
		<ModelPicker {onReady} />
	{/if}

	<Transcript {messages} {streaming} />
	<form class="flex flex-col gap-2" onsubmit={send}>
		<label class="text-xs text-muted-foreground" for="chat-input">Message</label>
		<textarea
			id="chat-input"
			data-testid="chat-input"
			class="min-h-20 resize-none rounded-[var(--radius)] border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
			disabled={!loaded || busy}
			placeholder={hint}
			bind:value={draft}
		></textarea>
		<p class="text-xs text-muted-foreground" data-testid="chat-hint">{hint}</p>
		<div class="flex flex-wrap gap-2">
			<Button
				type="submit"
				variant="woven-secondary"
				disabled={!loaded || busy || draft.trim().length === 0}
				data-testid="chat-send"
			>
				Send
			</Button>
			{#if busy}
				<Button type="button" variant="woven-secondary" onclick={stop} data-testid="chat-stop">
					Stop
				</Button>
			{/if}
			{#if loaded}
				<Button
					type="button"
					variant="woven-secondary"
					onclick={newChat}
					disabled={busy}
					data-testid="chat-new"
				>
					New chat
				</Button>
			{/if}
		</div>
		{#if sendError !== null}
			<p class="text-sm text-destructive" role="alert">{sendError}</p>
		{/if}
	</form>
</section>
