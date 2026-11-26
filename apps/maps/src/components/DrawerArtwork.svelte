<script lang="ts">
	import WorldArtwork from "@spellkave/map-canvas/world-artwork";
	import type { EntityArt } from "@spellkave/sdk";

	let {
		art,
		gatewayOrigin,
		slug,
		token,
		label,
	}: {
		art: EntityArt | null;
		gatewayOrigin: string;
		slug: string;
		token: string;
		label: string;
	} = $props();
</script>

<WorldArtwork {art} {gatewayOrigin} {slug} {token} {label} />
