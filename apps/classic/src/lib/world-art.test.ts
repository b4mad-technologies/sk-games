import { describe, expect, it, vi } from "vitest";
import { gatewayOrigin, worldArtStore } from "./world-art";

const art = (hash: string) => ({ path: `art/${hash}.webp`, hash });

describe("gatewayOrigin", () => {
	it("keeps the origin of a web address and nothing else", () => {
		expect(gatewayOrigin("http://127.0.0.1:29450/mcp")).toBe("http://127.0.0.1:29450");
		expect(gatewayOrigin(" https://mcp.example.test ")).toBe("https://mcp.example.test");
		expect(gatewayOrigin(undefined)).toBeNull();
		expect(gatewayOrigin("")).toBeNull();
		expect(gatewayOrigin("ftp://example.test")).toBeNull();
		expect(gatewayOrigin("not a url")).toBeNull();
	});
});

describe("worldArtStore", () => {
	it("asks for a picture once and hands out its URL", async () => {
		const fetchArt = vi.fn(async () => new Blob(["x"]));
		const store = worldArtStore(fetchArt, () => "blob:one", vi.fn());
		expect(await store.load(art("a"))).toBe("blob:one");
		expect(await store.load(art("a"))).toBe("blob:one");
		expect(fetchArt).toHaveBeenCalledTimes(1);
	});

	it("answers undefined for a picture the gateway does not give, and does not ask again", async () => {
		const fetchArt = vi.fn(async () => {
			throw new Error("world asset missing");
		});
		const store = worldArtStore(fetchArt, () => "blob:never", vi.fn());
		expect(await store.load(art("b"))).toBeUndefined();
		expect(await store.load(art("b"))).toBeUndefined();
		expect(fetchArt).toHaveBeenCalledTimes(1);
	});

	it("gives its URLs back on close and drops what arrives afterwards", async () => {
		let release: (blob: Blob) => void = () => {};
		const slow = new Promise<Blob>((resolve) => {
			release = resolve;
		});
		const revoke = vi.fn();
		let made = 0;
		const store = worldArtStore(
			async (reference) => (reference.hash === "slow" ? slow : new Blob(["x"])),
			() => `blob:${++made}`,
			revoke,
		);
		await store.load(art("fast"));
		const late = store.load(art("slow"));
		store.close();
		release(new Blob(["y"]));
		expect(await late).toBeUndefined();
		expect(revoke).toHaveBeenCalledWith("blob:1");
		expect(made).toBe(1);
	});
});
