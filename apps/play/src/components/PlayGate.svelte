<script lang="ts">
	import { Button, Dialog, WovenIcon } from "@spellkave/ui";
	import type { AccountWorldSummary } from "../lib/account-api";
	import { type PlaySeat, seatIsClaimable } from "../lib/seats";

	export type PlayPhase =
		| "auth"
		| "loading"
		| "choose-hero"
		| "empty"
		| "error"
		| "ready"
		| "world-starting";

	let {
		phase,
		status,
		showSignIn,
		reachable,
		requestedSlug,
		claimingActor,
		releasing,
		heldHero,
		confirmRelease = $bindable(false),
		releaseError,
		heroes,
		claimStatus,
		worldName,
		signedIn,
		onSignIn,
		onChooseWorld,
		onRelease,
		onClaim,
		onRetry,
	}: {
		phase: PlayPhase;
		status: string;
		showSignIn: boolean;
		reachable: AccountWorldSummary[];
		requestedSlug: string | null;
		claimingActor: string | null;
		releasing: boolean;
		heldHero: PlaySeat | null;
		confirmRelease?: boolean;
		releaseError: string | null;
		heroes: PlaySeat[];
		claimStatus: string | null;
		worldName: string;
		signedIn: boolean;
		onSignIn: () => void;
		onChooseWorld: (slug: string) => void;
		onRelease: () => void;
		onClaim: (actorId: string) => void;
		onRetry: () => void;
	} = $props();
</script>

<section
	class="threshold"
	aria-live="polite"
	aria-busy={phase === "loading" || phase === "auth" || phase === "world-starting"}
>
	<WovenIcon name={phase === "empty" || phase === "choose-hero" ? "hero" : "enter"} size="xl" />
	<h1>
		{phase === "choose-hero"
			? "Who will you be?"
			: phase === "empty"
				? "No world is open to you yet"
				: phase === "error"
					? "The way into this world is closed"
					: phase === "world-starting"
						? "Your world is waking up…"
						: "Entering the living world…"}
	</h1>
	<p>{status}</p>

	{#if phase === "choose-hero"}
		{#if reachable.length > 1}
			<nav class="world-switch" aria-label="Worlds open to you">
				{#each reachable as candidate (candidate.slug)}
					<button
						type="button"
						class="world-chip"
						aria-current={candidate.slug === requestedSlug ? "true" : undefined}
						disabled={claimingActor !== null || releasing}
						onclick={() => onChooseWorld(candidate.slug)}
					>
						{candidate.display_name}
					</button>
				{/each}
			</nav>
		{/if}

		{#if heldHero !== null}
			<div aria-busy={releasing}>
				<Dialog
					bind:open={confirmRelease}
					title="Release {heldHero.name}?"
					description="You give up this hero in {worldName}. Anyone may claim it next; you can claim a free hero again from Play."
					triggerLabel="Release hero"
					closeLabel="Keep playing"
					disabled={releasing}
				>
					<Button
						variant="woven-secondary"
						disabled={releasing}
						aria-busy={releasing}
						data-testid="release-hero-submit"
						onclick={() => onRelease()}
					>
						Release hero
					</Button>
					{#if releaseError !== null}
						<p class="claim-status" role="alert">{releaseError}</p>
					{/if}
				</Dialog>
			</div>
		{/if}

		<ul class="hero-choices" data-testid="hero-choices">
			{#each heroes as hero (hero.actor_id)}
				<li>
					{#if seatIsClaimable(hero)}
						<Button
							variant="woven-primary"
							disabled={claimingActor !== null || releasing}
							onclick={() => onClaim(hero.actor_id)}
						>
							{claimingActor === hero.actor_id ? `Claiming ${hero.name}…` : `Play as ${hero.name}`}
						</Button>
					{:else}
						<p class="hero-taken">
							{hero.name}
							<span>{hero.mine ? "already yours" : "taken"}</span>
						</p>
					{/if}
				</li>
			{:else}
				<li><p class="quiet">This world has no heroes to offer yet.</p></li>
			{/each}
		</ul>

		{#if claimStatus}
			<p class="claim-status" role="status">{claimStatus}</p>
		{/if}
	{:else if phase === "empty"}
		<Button href="https://spellkave.com/#worlds">See the worlds</Button>
	{:else if phase === "auth" && showSignIn}
		<Button variant="woven-primary" onclick={onSignIn}>Sign in</Button>
	{:else if phase === "error" && signedIn}
		<Button onclick={onRetry}>Try again</Button>
	{/if}
</section>
