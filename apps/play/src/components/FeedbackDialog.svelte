<script lang="ts">
	/**
	 * The dialog the seat menu's "Send feedback" item opens (sk-jay0.1.14).
	 * `App.svelte` owns the seat menu (the dock's seat menu) and this
	 * component's `open` state, and mounts THIS component outside the menu
	 * so closing the menu on select does not tear the dialog down before it
	 * opens.
	 */
	import { Button, RadioGroup, Textarea } from "@spellkave/ui";
	import {
		FEEDBACK_CATEGORIES,
		FEEDBACK_MESSAGE_MAX_BYTES,
		type FeedbackCategory,
		feedbackMessageByteLength,
		isHttpUrl,
		loadFeedbackSdk,
		submitFeedback,
	} from "../lib/feedback";
	import { playObservation } from "../lib/play-observation";

	let {
		open = $bindable(false),
		gatewayOrigin,
		accessToken,
		submit = submitFeedback,
	}: {
		open?: boolean;
		gatewayOrigin: string | null;
		accessToken: string;
		/** Test seam; defaults to the real MCP transport in `lib/feedback.ts`. */
		submit?: typeof submitFeedback;
	} = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let previousOpen = false;
	let category = $state<FeedbackCategory | "">("");
	let message = $state("");
	let status = $state<"idle" | "sending" | "sent" | "rate_limited" | "failed">("idle");
	let resultMessage = $state<string | null>(null);
	let issueUrl = $state<string | null>(null);

	const messageBytes = $derived(feedbackMessageByteLength(message));
	const overCap = $derived(messageBytes > FEEDBACK_MESSAGE_MAX_BYTES);
	const canSend = $derived(
		gatewayOrigin !== null &&
			message.trim() !== "" &&
			category !== "" &&
			!overCap &&
			status !== "sending",
	);
	function resetForm(): void {
		category = "";
		message = "";
		status = "idle";
		resultMessage = null;
		issueUrl = null;
	}

	function closeDialog(): void {
		if (open) playObservation.record({ phase: "feedback", interaction: 0, feedback_state: "closed" });
		open = false;
	}

	$effect(() => {
		if (dialogEl === null) return;
		// First open, not mount: `@modelcontextprotocol/sdk` (sk-jay0.1.15) is
		// only fetched once a seat actually opens this dialog, the same trigger
		// `MapTile.svelte` uses for `@spellkave/map-canvas` — `submitFeedback`
		// awaits the same memoised promise on Send, so a seat that clicks
		// straight through has it either already resolved or well in flight.
		if (open && !previousOpen) {
			resetForm();
			playObservation.record({ phase: "feedback", interaction: 0,
				feedback_state: gatewayOrigin === null ? "unavailable" : "opened" });
			// Preload only — a failure here is silent; `submitFeedback` retries
			// the same import on Send and surfaces any real failure through its
			// own `status`/`resultMessage`, the text-backed error path below.
			if (gatewayOrigin !== null) loadFeedbackSdk().catch(() => {});
		}
		previousOpen = open;
		// `showModal`/`close` are unimplemented in jsdom (verified against the
		// pinned jsdom 26.1.0 this app tests with) — component tests still need
		// the dialog's content in the DOM, so fall back to the plain `open`
		// IDL/attribute reflection, which jsdom does support. Real browsers
		// always take the `showModal`/`close` branch (native focus trap, top
		// layer, Escape-to-close).
		if (open && !dialogEl.open) {
			if (typeof dialogEl.showModal === "function") dialogEl.showModal();
			else dialogEl.open = true;
		}
		if (!open && dialogEl.open) {
			if (typeof dialogEl.close === "function") dialogEl.close();
			else dialogEl.open = false;
		}
	});

	async function send(): Promise<void> {
		if (gatewayOrigin === null || category === "" || status === "sending") return;
		status = "sending";
		playObservation.record({ phase: "feedback", interaction: 0, feedback_state: "sending" });
		resultMessage = null;
		// The transport gathers diagnostics and requests the report on every submission.
		const result = await submit(
			{ message: message.trim(), category },
			{ gatewayOrigin, accessToken },
		);
		if (result.ok) {
			status = "sent";
			issueUrl = result.issueUrl;
		} else {
			status = result.reason;
			resultMessage = result.message;
		}
		playObservation.record({ phase: "feedback", interaction: 0, feedback_state: status });
	}
</script>

<dialog
	bind:this={dialogEl}
	class="m-auto w-[min(26rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--card)] p-0 text-[color:var(--card-foreground)] shadow-2xl backdrop:bg-[color:color-mix(in_srgb,var(--background)_78%,transparent)]"
	aria-labelledby="feedback-dialog-title"
	onclose={closeDialog}
	onclick={(event) => {
		if (event.target === dialogEl) closeDialog();
	}}
>
	<div class="flex flex-col gap-4 p-6">
		<h2 id="feedback-dialog-title" class="sk-display m-0 text-xl tracking-[-0.03em]">
			Send feedback
		</h2>

		{#if gatewayOrigin === null}
			<p role="status" class="text-sm leading-6">Feedback is unavailable in this local play session. Nothing has been sent. Share the problem with the person running this session.</p>
			<div class="flex justify-end">
				<Button type="button" variant="woven-secondary" onclick={closeDialog}>Close</Button>
			</div>
		{:else if status === "sent" && issueUrl !== null}
			<p role="status" class="text-sm leading-6">
				Feedback sent.
				{#if isHttpUrl(issueUrl)}
					<a
						href={issueUrl}
						target="_blank"
						rel="noreferrer"
						class="font-medium text-[color:var(--primary)] underline underline-offset-4"
					>
						View the issue
					</a>
				{:else}
					Reference: <span class="font-mono text-xs">{issueUrl}</span>
				{/if}
			</p>
			<div class="flex justify-end">
				<Button type="button" variant="woven-secondary" onclick={closeDialog}>Close</Button>
			</div>
		{:else}
			<fieldset class="m-0 flex flex-col gap-1 border-0 p-0">
				<legend class="text-xs font-semibold tracking-[0.08em] text-[color:var(--muted-foreground)]">
					What's this about?
				</legend>
				<RadioGroup
					items={FEEDBACK_CATEGORIES.map((entry) => ({ value: entry.value, label: entry.label }))}
					bind:value={category}
					orientation="horizontal"
					disabled={status === "sending"}
				/>
			</fieldset>

			<div class="flex flex-col gap-1">
				<label
					for="feedback-message"
					class="text-xs font-semibold tracking-[0.08em] text-[color:var(--muted-foreground)]"
				>
					What happened?
				</label>
				<Textarea
					id="feedback-message"
					bind:value={message}
					disabled={status === "sending"}
					rows={4}
					placeholder="Tell us what you saw, what you expected, or what you'd like."
					aria-describedby="feedback-message-count"
				/>
				<p
					id="feedback-message-count"
					class={`text-right text-xs ${overCap ? "text-[color:var(--destructive)]" : "text-[color:var(--muted-foreground)]"}`}
				>
					{messageBytes} / {FEEDBACK_MESSAGE_MAX_BYTES} bytes
				</p>
			</div>

			<div class="flex flex-col gap-2">
				<p
					class="max-w-[42ch] text-sm leading-6 text-[color:var(--muted-foreground)]"
				>
					A diagnostic report is attached automatically: world and seat info,
					your session status, your last actions and any tool errors, and
					the last actions and layout changes recorded by the app.
				</p>
				<details class="text-xs text-[color:var(--muted-foreground)]">
					<summary class="cursor-pointer select-none">What's in the report</summary>
					<ul class="mt-1 list-disc pl-5">
						<li>World and your seat (a hashed id, not your account)</li>
						<li>Gateway, module and protocol versions</li>
						<li>Your session's status right now</li>
						<li>Your last actions and any tool errors, redacted of tokens</li>
						<li>The app's own record of your last actions and layout changes, and your screen size, redacted of tokens</li>
						<li>Timestamps for all of the above</li>
					</ul>
				</details>
			</div>

			{#if status === "rate_limited" || status === "failed"}
				<p role="alert" class="text-sm leading-6 text-[color:var(--destructive)]">
					{resultMessage}
				</p>
			{/if}

			<div class="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="woven-secondary" onclick={closeDialog}>Cancel</Button>
				<Button
					type="button"
					variant="woven-primary"
					disabled={!canSend}
					aria-busy={status === "sending"}
					onclick={() => void send()}
				>
					{status === "sending" ? "Sending…" : "Send"}
				</Button>
			</div>
		{/if}
	</div>
</dialog>
