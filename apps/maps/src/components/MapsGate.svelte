<script lang="ts" module>
	export type MapsPhase = "auth" | "loading" | "empty" | "error" | "ready";
</script>

<script lang="ts">
	import { Button, WovenIcon } from "@spellkave/ui";
	import { isDevAuthEnabled, readDevTokenHint } from "../lib/dev-auth";

	let {
		phase,
		status,
		showSignIn,
		signedIn,
		devAuth = false,
		devTokenHint = "",
		showDevPaste = false,
		devTokenDraft = $bindable(""),
		onSignIn,
		onRetry,
		onToggleDevPaste,
		onApplyDevToken,
	}: {
		phase: MapsPhase;
		status: string;
		showSignIn: boolean;
		signedIn: boolean;
		devAuth?: boolean;
		devTokenHint?: string;
		showDevPaste?: boolean;
		devTokenDraft?: string;
		onSignIn: () => void;
		onRetry: () => void;
		onToggleDevPaste?: () => void;
		onApplyDevToken?: () => void;
	} = $props();

	const localDev = $derived(devAuth && isDevAuthEnabled());
</script>

<section class="threshold" aria-live="polite" aria-busy={phase === "loading" || phase === "auth"}>
	<WovenIcon name={phase === "empty" ? "hero" : "enter"} size="xl" />
	<h1>
		{phase === "empty"
			? "No world is open to you yet"
			: phase === "error"
				? "The map could not be opened"
				: "Opening the world map…"}
	</h1>
	<p>{status}</p>
	{#if phase === "loading" || (phase === "auth" && !showSignIn)}
		<div class="maps-boot maps-boot--gate" role="status">
			<div class="maps-boot__track" aria-hidden="true"><div class="maps-boot__bar"></div></div>
		</div>
	{/if}

	{#if phase === "empty"}
		<Button href="https://spellkave.com/#worlds">See the worlds</Button>
	{:else if phase === "auth" && showSignIn}
		<Button variant="woven-primary" onclick={onSignIn}>Sign in</Button>
	{:else if phase === "error" && signedIn}
		<Button onclick={onRetry}>Try again</Button>
	{/if}

	{#if localDev && !signedIn}
		<div class="mt-6 flex flex-col items-center gap-2">
			<Button variant="outline" data-testid="dev-token-toggle" onclick={() => onToggleDevPaste?.()}>
				Dev token
			</Button>
			{#if showDevPaste}
				<div
					class="flex w-full max-w-md flex-col gap-2 rounded-[var(--radius)] border border-dashed border-border bg-card/80 p-3 text-left text-xs text-foreground"
					data-testid="dev-token-panel"
				>
					<p>
						Local only. Paste a staged hero token
						{#if (devTokenHint || readDevTokenHint({})) !== ""}
							or set <code class="font-mono">VITE_SPELLKAVE_DEV_TOKEN_FILE</code>.
						{/if}
					</p>
					<textarea
						class="min-h-16 w-full rounded-[var(--radius)] border border-input bg-background p-2 font-mono text-xs"
						data-testid="dev-token-input"
						placeholder="paste token"
						bind:value={devTokenDraft}
					></textarea>
					<Button size="sm" data-testid="dev-token-apply" onclick={() => onApplyDevToken?.()}>
						Use token
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</section>
