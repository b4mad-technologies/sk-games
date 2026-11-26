import { tick } from "svelte";

/** How close to the bottom still counts as "pinned" — Thread's original
 * threshold, now shared with the Explore stream (sk-jay0.1.8.63.1). */
const PIN_THRESHOLD_PX = 24;

export interface FollowScrollController {
	/** Reactive: true while the reader sits within `PIN_THRESHOLD_PX` of the
	 * bottom. New content follows automatically while this holds. */
	readonly pinned: boolean;
	/** Reactive: how many entries arrived while NOT pinned and have not been
	 * caught up to yet. Zero whenever `pinned` is true. */
	readonly unread: number;
	/**
	 * New content arrived: `addedCount` more entries than the caller's own
	 * last count (a caller tracks its own "did this grow" bookkeeping — an
	 * array length for Thread, a bounded window's newest id for the Explore
	 * stream — since the two callers detect growth differently; this
	 * controller only ever reacts to being told). Pinned (or `forced`, kept
	 * for the player's OWN new local activity, ids minted `local:`, which
	 * always reveals even unpinned) follows to the bottom; otherwise the
	 * arrival only grows `unread`.
	 */
	reveal(addedCount: number, options?: { forced?: boolean }): void;
	/** Scroll to the bottom right now (Thread's `onUnreadChange` jump
	 * callback and the Explore stream's catch-up pill both call this) and
	 * clear `unread`. Synchronous — never waits on layout. */
	jumpToLatest(): void;
	/** Land on the bottom once, ignoring pin state, after the current
	 * layout settles — the initial-mount landing both Thread and the
	 * Explore stream want regardless of scroll history. */
	settle(): void;
}

/**
 * One scroll-follow behaviour for every world-ordered stream tile
 * (sk-jay0.1.8.63.1): shared by `Thread.svelte`'s Talk transcript and
 * `PlayTable.svelte`'s Explore stream, which used to keep separate, slightly
 * different copies of the same "stick to the bottom unless the reader
 * scrolled up" rule (Thread jumped instantly; the Explore stream glided
 * short hops and could reveal the player's own act while scrolled up, but
 * never counted unread lines at all). This module owns none of the DOM
 * itself — `getScrollHost` is read lazily, from inside this module's own
 * `$effect`, so it can resolve however the caller's own `$state` element
 * does (Thread's `.tile-body`/`.play-thread__scroll`, PlayTable's
 * `.table-explore-stream`), including resolving to `null` before mount or
 * while a caller-specific condition (Thread: `density !== "stage"`) holds.
 */
export function createFollowScroll(
	getScrollHost: () => HTMLElement | null,
): FollowScrollController {
	let pinned = $state(true);
	let unread = $state(0);

	function jumpToLatest(): void {
		const el = getScrollHost();
		if (el === null) return;
		// This must be immediate. A smooth scroll is still in flight when an
		// NPC's next line arrives; its interim scroll event then makes the
		// controller think the reader deliberately left the bottom and produces
		// a misleading "new line" pill. Chat-style follow means every arrival
		// while pinned reaches the current tail synchronously. Deliberately
		// scrolling away still changes `pinned` through `onScroll` below.
		el.scrollTop = el.scrollHeight;
		pinned = true;
		unread = 0;
	}

	// The stage shell and ActivityFeed's deferred row paint settle across two
	// frames after Svelte's DOM tick. Landing on only the first frame can stop
	// just above a late-measured last row after reload, despite being pinned.
	// The second frame reaches the actual newest entry without overriding a
	// reader who later intentionally scrolls away.
	function settle(): void {
		void tick().then(() => requestAnimationFrame(() => requestAnimationFrame(jumpToLatest)));
	}

	function onScroll(): void {
		const el = getScrollHost();
		if (el === null) return;
		pinned = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
		if (pinned) unread = 0;
	}

	$effect(() => {
		const el = getScrollHost();
		if (el === null) return;
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	});

	function reveal(addedCount: number, options: { forced?: boolean } = {}): void {
		if (addedCount <= 0) return;
		if (options.forced || pinned) {
			settle();
		} else {
			unread += addedCount;
		}
	}

	return {
		get pinned() {
			return pinned;
		},
		get unread() {
			return unread;
		},
		reveal,
		jumpToLatest,
		settle,
	};
}
