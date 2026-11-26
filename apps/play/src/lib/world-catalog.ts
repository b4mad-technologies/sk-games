export interface CatalogWorld {
	slug: string;
	name: string;
	db?: string;
}

export function publicSiteBaseUrl(env: Record<string, string | undefined>): string {
	const raw = env.VITE_SPELLKAVE_PUBLIC_SITE_URL?.trim() ?? "";
	return (raw === "" ? "/demo-data" : raw).replace(/\/+$/, "");
}

export async function fetchWorldCatalog(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<CatalogWorld[]> {
	const response = await fetchImpl(`${baseUrl}/index.json`, { cache: "no-store" });
	if (!response.ok) throw new Error(`The world catalog is unavailable (HTTP ${response.status}).`);
	const value = (await response.json()) as { v?: unknown; worlds?: unknown };
	if (value.v !== "spellkave-public-site/v1" || !Array.isArray(value.worlds)) {
		throw new Error("The world catalog has an unexpected shape.");
	}
	return value.worlds.map((row, index) => {
		if (typeof row !== "object" || row === null || !("slug" in row)) {
			throw new Error(`World ${index + 1} is malformed.`);
		}
		const record = row as Record<string, unknown>;
		if (typeof record.slug !== "string" || record.slug === "") {
			throw new Error(`World ${index + 1} has no slug.`);
		}
		return {
			slug: record.slug,
			name: typeof record.name === "string" && record.name !== "" ? record.name : record.slug,
			...(typeof record.db === "string" && record.db !== "" ? { db: record.db } : {}),
		};
	});
}

export function worldFromSearch(search: string): string | null {
	const slug = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
		.get("world")
		?.trim();
	return slug === undefined || slug === "" ? null : slug;
}

/** `?actor=<id>`: the hero the link asks to play. A preference, never authority. */
export function actorFromSearch(search: string): string | null {
	const actor = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
		.get("actor")
		?.trim();
	return actor === undefined || actor === "" ? null : actor;
}
