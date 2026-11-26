export interface ReferencePreview {
	title: string;
	description: string;
}

const cache = new Map<string, Promise<ReferencePreview | null>>();

/** Only the existing public catalogue artifacts; never fetch arbitrary link URLs. */
export function previewUrl(href: unknown, origin: string): string | null {
	if (
		typeof href !== "string" ||
		!href.startsWith("/compendium/docs/catalogue/") ||
		/[\\\s?#]/u.test(href)
	)
		return null;
	const url = new URL(href, origin);
	return url.origin === origin &&
		url.pathname.startsWith("/compendium/docs/catalogue/") &&
		url.pathname.endsWith(".json")
		? url.href
		: null;
}

export function loadReferencePreview(
	url: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ReferencePreview | null> {
	const existing = cache.get(url);
	if (existing) return existing;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(null);
		}, 2_000);
	});
	const request = Promise.resolve()
		.then(() =>
			fetchImpl(url, {
				credentials: "omit",
				referrerPolicy: "no-referrer",
				signal: controller.signal,
			}),
		)
		.then(async (response) => {
			if (!response.ok) return null;
			const value: unknown = await response.json();
			if (!value || typeof value !== "object") return null;
			const row = value as Record<string, unknown>;
			if (typeof row.display_name !== "string" || typeof row.description !== "string") return null;
			return { title: row.display_name, description: row.description };
		})
		.catch(() => null);
	const pending = Promise.race([request, deadline]).finally(() => clearTimeout(timer));
	cache.set(url, pending);
	return pending;
}

export function clearReferencePreviewCache(): void {
	cache.clear();
}
