<script lang="ts">
	import type { AuthSession } from "@spellkave/authkit";
	import { Button, Select } from "@spellkave/ui";
	import { untrack } from "svelte";

	function waitForMapsReady(timeoutMs = 20000): Promise<void> {
		const w = window as Window & { spellkaveMapsReady?: boolean };
		if (w.spellkaveMapsReady === true) return Promise.resolve();
		return new Promise((resolve) => {
			const finish = (): void => {
				window.removeEventListener("spellkave-maps-ready", finish);
				resolve();
			};
			window.addEventListener("spellkave-maps-ready", finish);
			setTimeout(finish, timeoutMs);
		});
	}

	import { formatPlayError, yieldToBrowser } from "../lib/play";
	import type { PublicWorld } from "../lib/public-site";
	import { projectPlayErrors, seatBoardView } from "../lib/seats";
	import { type MineWatchArgs, occupancyFromWatch } from "../lib/watch-view";
	import type { WorldHandle } from "../lib/world-client";

	let {
		worlds,
		playUrl,
		session,
		openWorld,
		selectedSlug = $bindable<string | null>(null),
		onMinePlace,
	}: {
		worlds: PublicWorld[];
		playUrl: string | null;
		session: AuthSession | null;
		openWorld?: (args: {
			url: string;
			db: string;
			token: string;
			onUpdate: () => void;
			onError?: (err: Error) => void;
		}) => Promise<WorldHandle>;
		selectedSlug?: string | null;
		onMinePlace?: (args: MineWatchArgs | null) => void;
	} = $props();

	let statusByWorld = $state<Map<string, string>>(new Map());
	let busy = $state(false);
	let connecting = $state(false);
	let handles = $state<Map<string, WorldHandle>>(new Map());

	const selected = $derived(
		worlds.find((world) => world.slug === selectedSlug) ?? worlds[0] ?? null,
	);
	const worldSelectItems = $derived(
		worlds.map((world) => ({ value: world.slug, label: world.name })),
	);
	let worldSelectValue = $state("");
	$effect(() => {
		const slug = selected?.slug ?? "";
		if (slug !== "") worldSelectValue = slug;
	});
	$effect(() => {
		const next = worldSelectValue;
		if (next === "" || next === selectedSlug) return;
		selectedSlug = next;
	});
	// Connect only the selected world — opening every catalog db failed closed
	// for logins that only hold one of them (sk-jay0.4.5).
	const playableKey = $derived(
		selected !== null && typeof selected.db === "string" && selected.db !== ""
			? `${selected.slug}\0${selected.db}`
			: "",
	);

	// Derived, not painted by an effect: an effect that wrote `seats` and read it
	// back re-ran until Svelte threw effect_update_depth_exceeded, and the aborted
	// flush left the whole map UI frozen (sk-jay0.4.1).
	const view = $derived(seatBoardView(worlds, handles, selected?.slug ?? null));
	const seats = $derived(view.seats);
	const heroes = $derived(view.heroes);
	const playErrors = $derived(projectPlayErrors(statusByWorld, selected?.slug ?? null));

	function setWorldStatus(slug: string, message: string | null): void {
		const next = new Map(statusByWorld);
		if (message === null || message === "") next.delete(slug);
		else next.set(slug, message);
		statusByWorld = next;
	}

	$effect(() => {
		if (selectedSlug === null && worlds[0]) selectedSlug = worlds[0].slug;
	});

	// Hand the map my seat's place. Only App state is written here, nothing this
	// effect reads, so it settles after one run per handle update.
	$effect(() => {
		const mine = view.mine;
		if (mine === null) {
			untrack(() => onMinePlace?.(null));
			return;
		}
		const handle = handles.get(mine.slug);
		const overlay = handle?.overlayAdmitted() ?? false;
		const frame = overlay ? (handle?.watch.frameAtCursor() ?? null) : null;
		const actors = frame?.actors ?? [];
		// A frame exists from the empty-snapshot bootstrap too — "populated"
		// must mean it actually carries actors, or the empty bootstrap frame
		// still wipes a pending deep-link selection (sk-jay0.4.4.1 retest).
		const framePopulated = actors.length > 0;
		const oldestTick = handle?.watch.oldestTick() ?? 0;
		const latestTick = handle?.watch.latestTick() ?? 0;
		const cursor = handle?.watch.cursor();
		const live = cursor?.kind !== "paused";
		const cursorTick = cursor?.kind === "paused" ? cursor.tick : latestTick;
		untrack(() =>
			onMinePlace?.({
				...mine,
				overlay,
				occupancy: overlay ? occupancyFromWatch(actors, mine.mineEntityIds) : [],
				actors,
				items: overlay ? (frame?.items ?? []) : [],
				events: overlay ? (frame?.events ?? []) : [],
				framePopulated,
				oldestTick,
				latestTick,
				cursorTick,
				live,
				pause: () => {
					handle?.watch.pause();
					handles = new Map(handles);
				},
				play: () => {
					handle?.watch.play();
					handles = new Map(handles);
				},
				scrub: (tick) => {
					handle?.watch.scrub(tick);
					handles = new Map(handles);
				},
			}),
		);
	});

	$effect(() => {
		const token = session?.access_token;
		const url = playUrl;
		const opener = openWorld;
		const key = playableKey;
		if (token === undefined || url === null || opener === undefined || key === "") {
			handles = new Map();
			connecting = false;
			return;
		}
		const catalog = key.split("\n").map((row) => {
			const [slug, db] = row.split("\0");
			return { slug: slug ?? "", db: db ?? "" };
		});
		let cancelled = false;
		const next = new Map<string, WorldHandle>();

		connecting = true;
		void (async () => {
			await waitForMapsReady();
			if (cancelled) return;
			await yieldToBrowser();
			if (cancelled) return;
			statusByWorld = new Map();
			for (const world of catalog) {
				if (cancelled || world.db === "") continue;
				try {
					const handle = await opener({
						url,
						db: world.db,
						token,
						onUpdate: () => {
							if (!cancelled) handles = new Map(next);
						},
						onError: (err) => {
							if (!cancelled) setWorldStatus(world.slug, formatPlayError(err));
						},
					});
					if (cancelled) {
						handle.disconnect();
						return;
					}
					next.set(world.slug, handle);
					handles = new Map(next);
				} catch (cause) {
					if (!cancelled) setWorldStatus(world.slug, formatPlayError(cause));
				}
			}
			if (!cancelled) connecting = false;
		})();

		return () => {
			cancelled = true;
			connecting = false;
			for (const handle of next.values()) handle.disconnect();
		};
	});

	async function claim(actorId: string): Promise<void> {
		const handle = selected === null ? undefined : handles.get(selected.slug);
		if (handle === undefined || selected === null) return;
		busy = true;
		setWorldStatus(selected.slug, null);
		try {
			await handle.claim(actorId);
			handles = new Map(handles);
		} catch (cause) {
			setWorldStatus(selected.slug, formatPlayError(cause));
		} finally {
			busy = false;
		}
	}

	async function releaseSeat(): Promise<void> {
		const handle = selected === null ? undefined : handles.get(selected.slug);
		if (handle === undefined || selected === null) return;
		busy = true;
		setWorldStatus(selected.slug, null);
		try {
			await handle.release();
			handles = new Map(handles);
		} catch (cause) {
			setWorldStatus(selected.slug, formatPlayError(cause));
		} finally {
			busy = false;
		}
	}
</script>

<section id="seats" class="flex min-w-0 flex-col gap-3" data-testid="seat-board">
	{#if worlds.length > 0}
		<div class="min-w-0" role="group" aria-label="Worlds" data-testid="world-picker">
			<Select
				items={worldSelectItems}
				bind:value={worldSelectValue}
				placeholder="World"
				name="world"
			/>
		</div>
	{/if}
	<div class="flex flex-col gap-1">
		<h2 class="text-sm font-semibold tracking-tight">My seat</h2>
		{#if playUrl === null}
			<p class="text-xs text-muted-foreground">
				Set <code class="font-mono">VITE_SPELLKAVE_PLAY_URL</code> to claim seats.
			</p>
		{:else if session === null}
			<p class="text-xs text-muted-foreground">Log in to list seats and claim a hero.</p>
		{/if}
		{#if connecting && seats.length === 0 && !playErrors.selected}
			<p class="text-xs text-muted-foreground" aria-busy="true" data-testid="seat-loading">
				Looking up your seat…
			</p>
		{/if}
		{#if playErrors.selected}
			<p class="text-xs text-destructive">{playErrors.selected}</p>
		{/if}
		{#if playErrors.othersCount > 0}
			<p class="text-xs text-muted-foreground" title={playErrors.othersTitle}>
				{playErrors.othersCount} {playErrors.othersCount === 1 ? "world" : "worlds"} unavailable
			</p>
		{/if}
	</div>

	{#if selected && playUrl !== null && session !== null && selected.db}
		<ul class="flex flex-col gap-1.5 text-xs" aria-label="Seats">
			{#each seats as seat (seat.actor_id)}
				<li
					class="flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius)] border border-border px-2 py-1.5"
				>
					<span>
						<strong>{seat.name}</strong>
						<span class="ml-1 opacity-70">
							{seat.mine ? "yours" : seat.claimed ? "taken" : "free"}
						</span>
					</span>
					{#if seat.mine}
						<Button
							size="xs"
							variant="outline"
							disabled={busy}
							onclick={() => void releaseSeat()}
						>
							Release
						</Button>
					{:else if seat.embodied && !seat.claimed}
						<Button size="xs" disabled={busy} onclick={() => void claim(seat.actor_id)}>
							Claim
						</Button>
					{:else if seat.claimed}
						<Button size="xs" variant="outline" disabled>Taken</Button>
					{:else}
						<Button size="xs" variant="outline" disabled>N/A</Button>
					{/if}
				</li>
			{/each}
			{#if seats.length === 0}
				<li class="text-muted-foreground">No seats visible yet.</li>
			{/if}
		</ul>
	{/if}

	{#if heroes.length > 0}
		<p class="text-[11px] text-muted-foreground">
			Claimed: {heroes.map((h) => `${h.name} (${h.worldName})`).join(", ")}
		</p>
	{/if}
</section>
