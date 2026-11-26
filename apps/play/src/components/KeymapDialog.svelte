<script lang="ts">
	import { Button, Dialog } from "@spellkave/ui";
	import { onMount } from "svelte";
	import {
		DEFAULT_KEYMAP,
		type Keymap,
		keyLabelFor,
		loadKeymap,
		PLAY_COMMANDS,
		type PlayCommand,
		saveKeymap,
	} from "../lib/keymap";

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const COMMAND_LABELS: Record<PlayCommand, string> = {
		"select.next": "Select next",
		"select.prev": "Select previous",
		"select.clear": "Clear selection",
		"slot.1": "Action slot 1",
		"slot.2": "Action slot 2",
		"slot.3": "Action slot 3",
		"slot.4": "Action slot 4",
		"slot.5": "Action slot 5",
		"slot.6": "Action slot 6",
		"slot.7": "Action slot 7",
		"slot.8": "Action slot 8",
		"slot.9": "Action slot 9",
		"composer.focus": "Focus composer",
		"composer.next": "Next completion",
		"composer.prev": "Previous completion",
		"shell.next": "Next shell result",
		"shell.prev": "Previous shell result",
		"shell.accept": "Accept shell result",
		"shell.attempt": "Attempt shell draft",
		"turn.end": "End turn",
		"hint.accept": "Accept an offer",
		"hint.dismiss": "Dismiss an offer",
		"dock.toggle": "Toggle dock",
	};

	let editing = $state<Keymap>(DEFAULT_KEYMAP);
	let listening = $state<PlayCommand | null>(null);
	let message = $state<string | null>(null);

	function refresh(): void {
		editing = loadKeymap(typeof localStorage === "undefined" ? undefined : localStorage);
		listening = null;
		message = null;
	}

	$effect(() => {
		if (open) refresh();
	});

	function displayKey(key: string): string {
		if (key === " ") return "Space";
		if (key === "Escape") return "Esc";
		return key.length === 1 ? key.toUpperCase() : key;
	}

	function setBinding(command: PlayCommand, key: string): void {
		const conflict = PLAY_COMMANDS.find(
			(candidate) => candidate !== command && editing[candidate].includes(key),
		);
		if (key === "Tab") {
			message = "Tab is reserved for browser focus and cannot be bound.";
			return;
		}
		if (conflict !== undefined) {
			message = `${displayKey(key)} is already bound to ${COMMAND_LABELS[conflict]}. Unbind it first.`;
			return;
		}
		editing = { ...editing, [command]: [key] };
		saveKeymap(editing, typeof localStorage === "undefined" ? undefined : localStorage);
		message = `${COMMAND_LABELS[command]} is now ${displayKey(key)}.`;
		listening = null;
	}

	function clearBinding(command: PlayCommand): void {
		editing = { ...editing, [command]: [] };
		saveKeymap(editing, typeof localStorage === "undefined" ? undefined : localStorage);
		message = `${COMMAND_LABELS[command]} is unbound.`;
		listening = null;
	}

	function resetDefaults(): void {
		saveKeymap(DEFAULT_KEYMAP, typeof localStorage === "undefined" ? undefined : localStorage);
		refresh();
		message = "Default shortcuts restored.";
	}

	function captureKey(event: KeyboardEvent): void {
		if (!open || listening === null) return;
		if (event.key === "Tab") return;
		event.preventDefault();
		if (event.key === "Escape") {
			listening = null;
			message = null;
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) {
			message = "Use an unmodified key.";
			return;
		}
		setBinding(listening, event.key);
	}

	onMount(() => {
		window.addEventListener("keydown", captureKey);
		return () => window.removeEventListener("keydown", captureKey);
	});
</script>

<!-- The seat menu is this dialog's only entry point. A default Dialog trigger
     would otherwise render an orphaned "Open" button above the Play mosaic. -->
<Dialog bind:open triggerLabel={null} title="Keyboard shortcuts" description="Choose one key for each command. Changes apply immediately. Tab completes in the shell; Escape restores Tab focus navigation.">
	{#snippet content()}
		<div class="space-y-2" data-testid="keymap-editor">
			{#each PLAY_COMMANDS as command}
				<div class="flex items-center justify-between gap-3 border-b border-[color:var(--border)] py-2" data-command={command}>
					<span>{COMMAND_LABELS[command]}</span>
					<div class="flex items-center gap-2">
						<span class="min-w-12 text-center text-xs text-[color:var(--muted-foreground)]">
							{#if keyLabelFor(editing, command)}{displayKey(keyLabelFor(editing, command) ?? "")}{:else}Unbound{/if}
						</span>
						<Button type="button" variant="outline" size="sm" onclick={() => (listening = command)}>
							{listening === command ? "Press a key…" : "Change"}
						</Button>
						<Button type="button" variant="ghost" size="sm" onclick={() => clearBinding(command)}>Unbind</Button>
					</div>
				</div>
			{/each}
			{#if message}<p role="status" class="pt-2 text-sm text-[color:var(--muted-foreground)]">{message}</p>{/if}
			<Button type="button" variant="ghost" size="sm" onclick={resetDefaults}>Restore defaults</Button>
		</div>
	{/snippet}
</Dialog>
