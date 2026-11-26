<script lang="ts">
	import type { SeatBoardSeat } from "@spellkave/ui";
	import { Dialog, SeatBoard } from "@spellkave/ui";

	let {
		open = $bindable(false),
		seats,
		activeKey,
		onSelect,
		freeSeats = [],
		worldName = "this world",
		claiming = false,
		error = null,
		onClaim = () => {},
	}: {
		open?: boolean;
		seats: SeatBoardSeat[];
		activeKey: string | null;
		onSelect: (key: string) => void;
		/** Claimable heroes of the current world; the board is hidden when empty. */
		freeSeats?: SeatBoardSeat[];
		worldName?: string;
		claiming?: boolean;
		/** Claim failure, shown inside the dialog. */
		error?: string | null;
		onClaim?: (key: string) => void;
	} = $props();
</script>

<!-- The seat menu's "Switch hero" is this dialog's only entry point: an
     explicit user action (axiom A2), never an automatic layout change. The
     choice is a preference; the module checks the binding on every call. -->
<Dialog
	bind:open
	triggerLabel={null}
	title="Switch hero"
	description="Choose which of your heroes to play, or claim another. You stay signed in."
>
	{#snippet content()}
		<div class="flex flex-col gap-4">
			<SeatBoard {seats} {activeKey} {onSelect} title="Your heroes" busy={claiming} />
			{#if freeSeats.length > 0}
				<SeatBoard
					seats={freeSeats}
					activeKey={null}
					onSelect={onClaim}
					title={`Free heroes in ${worldName}`}
					selectLabel="Claim"
					busy={claiming}
				/>
			{/if}
			{#if error !== null}
				<p class="text-sm text-destructive" role="alert">{error}</p>
			{/if}
		</div>
	{/snippet}
</Dialog>
