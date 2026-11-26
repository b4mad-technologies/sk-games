<script lang="ts">
	// A sheet that opens over the scene and closes with Escape or a click beside it.
	// ci-allow(ui-primitives): classic stage owner exception sk-jay0.1.76.19, see apps/classic/DESIGN.md
	import { Dialog } from "bits-ui";
	import type { Snippet } from "svelte";

	type Props = {
		open: boolean;
		title: string;
		/** A sheet that wants the room: the map. */
		wide?: boolean;
		onclose: () => void;
		children: Snippet;
	};
	let { open, title, wide = false, onclose, children }: Props = $props();
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && onclose()}>
	<Dialog.Portal>
		<Dialog.Overlay class="st-veil" />
		<Dialog.Content class="st-panel st-float" data-wide={wide ? "" : undefined} aria-describedby={undefined}>
			<header>
				<Dialog.Title level={2}>{title}</Dialog.Title>
				<Dialog.Close class="st-btn">Close</Dialog.Close>
			</header>
			<div class="st-panel-body">
				{@render children()}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
