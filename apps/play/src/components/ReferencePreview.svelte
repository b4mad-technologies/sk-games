<script lang="ts">
	import { ReferenceCard } from "@spellkave/ui";
	import { Popover } from "@spellkave/ui/popover";
	import { loadReferencePreview, previewUrl, type ReferencePreview } from "../lib/reference-preview";
	import type { PlayReferenceTarget } from "../lib/reference-vocabulary";

	let {
		text,
		target,
		href,
		triggerAriaLabel,
		triggerClass,
	}: {
		text: string;
		target: PlayReferenceTarget;
		href: string;
		triggerAriaLabel?: string;
		triggerClass?: string;
	} = $props();
	let preview = $state<ReferencePreview | null>(null);
	let status = $state<"idle" | "loading" | "ready" | "unavailable">("idle");
	let open = $state(false);
	async function onOpenChange(next: boolean): Promise<void> {
		if (!next || status !== "idle") return;
		const url = previewUrl(target.previewHref, new URL(href).origin);
		if (!url) {
			status = "unavailable";
			return;
		}
		status = "loading";
		preview = await loadReferencePreview(url);
		status = preview ? "ready" : "unavailable";
	}
</script>

<Popover
	bind:open
	triggerLabel={text}
	inline
	openOnHover
	{onOpenChange}
	{triggerAriaLabel}
	{triggerClass}
	accessibleLabel={`${target.label} reference`}
	class="play-reference-preview"
>
	<ReferenceCard label="Reference" title={preview?.title ?? target.label}>
		{#if status === "loading"}
			<p role="status">Loading reference…</p>
		{:else if preview?.description}
			<p class="reference-excerpt">{preview.description}</p>
		{:else}
			<p>Read the full entry in the reference guide.</p>
		{/if}
	</ReferenceCard>
	<div class="reference-footer">
		<a {href} target="spellkave-reference">Full reference ↗<span class="sr-only"> (opens or reuses the reference tab)</span></a>
		<button type="button" onclick={() => { open = false; }}>Close</button>
	</div>
</Popover>

<style>
	.reference-excerpt {
		display: -webkit-box;
		line-clamp: 6;
		-webkit-line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: normal;
	}
	.reference-footer {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1rem;
	}
	.reference-footer a {
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	.reference-footer button { cursor: pointer; }
	:global(.play-reference-preview) {
		width: min(22rem, calc(100vw - 2rem));
		max-width: calc(100vw - 2rem);
		max-height: var(--bits-popover-content-available-height);
		overflow-y: auto;
		white-space: normal;
	}
</style>
