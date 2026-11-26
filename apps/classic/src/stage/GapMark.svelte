<script lang="ts">
	// A small mark where the app shows something the world does not send.
	// ci-allow(ui-primitives): classic stage owner exception sk-jay0.1.76.19, see apps/classic/DESIGN.md
	import { Popover } from "bits-ui";
	import type { Gap } from "./model";

	type Props = { gap: Gap | undefined };
	let { gap }: Props = $props();
</script>

{#if gap}
	<Popover.Root>
		<Popover.Trigger class="st-gap" aria-label="Gap: {gap.where}" title={gap.text}>≈</Popover.Trigger>
		<Popover.Portal>
			<Popover.Content class="st-gapnote st-float" sideOffset={6} collisionPadding={8}>
				<small>Not from the world · {gap.where}</small>
				<div>{gap.text}</div>
				{#if gap.bead}<code>{gap.bead}</code>{/if}
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
{/if}
