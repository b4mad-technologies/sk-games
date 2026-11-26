import { flushSync, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { createFollowScroll, type FollowScrollController } from "./follow-scroll.svelte";

/** A bare scroll host, stubbed exactly the way `Thread.test.ts` stubs one:
 * jsdom lays out nothing, so `clientHeight`/`scrollHeight` are fixed
 * read-only properties and `scrollTop` is a plain writable number.
 */
function fakeHost(clientHeight = 100, scrollHeight = 600): HTMLDivElement {
	const el = document.createElement("div");
	Object.defineProperties(el, {
		clientHeight: { value: clientHeight, configurable: true },
		scrollHeight: { value: scrollHeight, configurable: true },
	});
	el.scrollTop = 0;
	document.body.append(el);
	return el;
}

/** Waits out `settle()`'s own tick plus two animation frames. The frames are
 * stubbed below to fire synchronously, so two microtask turns are enough for
 * the complete chain to resolve. */
async function flushSettle(): Promise<void> {
	await tick();
	await Promise.resolve();
	await Promise.resolve();
}

describe("createFollowScroll (sk-jay0.1.8.63.1: one scroll-follow behaviour for every stream tile)", () => {
	let rafSpy: MockInstance<(callback: FrameRequestCallback) => number>;
	let root: () => void;
	let controller: FollowScrollController;
	let host: HTMLDivElement;

	beforeEach(() => {
		rafSpy = vi
			.spyOn(globalThis, "requestAnimationFrame")
			.mockImplementation((cb: FrameRequestCallback) => {
				cb(0);
				return 0;
			});
	});

	afterEach(() => {
		rafSpy.mockRestore();
		root?.();
		host?.remove();
	});

	function mount(getHost: () => HTMLElement | null): void {
		root = $effect.root(() => {
			controller = createFollowScroll(getHost);
		});
		flushSync();
	}

	it("pinned: new content follows to the bottom synchronously", async () => {
		host = fakeHost();
		mount(() => host);
		expect(controller.pinned).toBe(true);

		controller.reveal(2);
		await flushSettle();

		expect(host.scrollTop).toBe(600);
		expect(rafSpy).toHaveBeenCalledTimes(2);
		expect(controller.pinned).toBe(true);
		expect(controller.unread).toBe(0);
	});

	it("does not leave a smooth scroll in flight between consecutive arrivals", () => {
		host = fakeHost();
		const scrollTo = vi.fn();
		host.scrollTo = scrollTo;
		mount(() => host);

		controller.jumpToLatest();
		expect(host.scrollTop).toBe(600);
		expect(scrollTo).not.toHaveBeenCalled();

		controller.reveal(1);
		expect(controller.unread).toBe(0);
	});

	it("not pinned: an arrival only grows unread, never moves the reader", async () => {
		host = fakeHost();
		mount(() => host);

		host.scrollTop = 100; // far from the 600-scrollHeight bottom
		host.dispatchEvent(new Event("scroll"));
		expect(controller.pinned).toBe(false);

		controller.reveal(3);
		await flushSettle();

		expect(host.scrollTop).toBe(100);
		expect(controller.unread).toBe(3);
		expect(controller.pinned).toBe(false);

		controller.reveal(1);
		await flushSettle();
		expect(controller.unread).toBe(4);
	});

	it("own-act reveal: a forced arrival always reaches the bottom, even while scrolled up", async () => {
		host = fakeHost();
		mount(() => host);

		host.scrollTop = 100;
		host.dispatchEvent(new Event("scroll"));
		expect(controller.pinned).toBe(false);

		controller.reveal(1, { forced: true });
		await flushSettle();

		expect(host.scrollTop).toBe(600);
		expect(controller.pinned).toBe(true);
		expect(controller.unread).toBe(0);
	});

	it("jumpToLatest: catches up immediately and clears unread (Thread's onUnreadChange contract)", () => {
		host = fakeHost();
		mount(() => host);

		host.scrollTop = 100;
		host.dispatchEvent(new Event("scroll"));
		controller.reveal(2);
		expect(controller.unread).toBe(2);

		controller.jumpToLatest();
		expect(host.scrollTop).toBe(600);
		expect(controller.pinned).toBe(true);
		expect(controller.unread).toBe(0);
	});

	it("does nothing when the scroll host is not yet resolved", async () => {
		mount(() => null);
		expect(() => controller.reveal(1)).not.toThrow();
		expect(() => controller.jumpToLatest()).not.toThrow();
		await flushSettle();
		expect(controller.pinned).toBe(true);
	});
});
