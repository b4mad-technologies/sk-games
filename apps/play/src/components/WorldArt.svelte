<script lang="ts">
	// WorldArtwork is a default Svelte component export; a named import breaks Vite HMR.
	import WorldArtwork, { type WorldArtworkState } from "@spellkave/map-canvas/world-artwork";
	import type { EntityArt } from "@spellkave/sdk/readers";
	import { playObservation } from "../lib/play-observation";

	let { art, gatewayOrigin, slug, token, label, compact = false, surface, ordinal = 0 }: {
		art?: EntityArt; gatewayOrigin: string | null; slug: string; token: string; label: string; compact?: boolean;
		surface?: "table" | "pack" | "place"; ordinal?: number;
	} = $props();
	let lastReport = "";
	function report(state: WorldArtworkState): void {
		if (!surface) return;
		const key = `${surface}:${ordinal}:${state}`;
		if (key === lastReport) return;
		lastReport = key;
		playObservation.record({ phase: "presentation", interaction: 0, art_surface: surface, art_slot: ordinal, art_state: state });
	}
</script>

<WorldArtwork {art} gatewayOrigin={gatewayOrigin ?? ""} {slug} {token} {label} {compact} onStateChange={report} />
