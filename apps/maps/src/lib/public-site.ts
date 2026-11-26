/**
 * Read-only client for the public spectator feed index (world picker).
 * Transcript helpers are omitted — maps only needs the catalog list + mcp URL.
 */

export function publicSiteBaseUrl(env: Record<string, string | undefined>): string {
	const configured = env.VITE_SPELLKAVE_PUBLIC_SITE_URL?.trim();
	const base = configured === undefined || configured === "" ? "/demo-data" : configured;
	return base.replace(/\/+$/, "");
}

export const PUBLIC_SITE_INDEX_VERSION = "spellkave-public-site/v1";

export interface PublicWorld {
	slug: string;
	name: string;
	adventure?: string;
	/** SpacetimeDB database name on the shared play host. Public catalog only. */
	db?: string;
	position: number;
}

export interface PublicSiteIndex {
	v: typeof PUBLIC_SITE_INDEX_VERSION;
	generated_at: string;
	sample?: boolean;
	mcp: {
		url: string;
		scope: string;
	};
	worlds: PublicWorld[];
}

export function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePublicSiteIndex(value: unknown): PublicSiteIndex {
	if (!isRecord(value) || value.v !== PUBLIC_SITE_INDEX_VERSION) {
		throw new Error(`unexpected public site index (want ${PUBLIC_SITE_INDEX_VERSION})`);
	}
	if (!isRecord(value.mcp) || typeof value.mcp.url !== "string") {
		throw new Error("public site index lacks mcp.url");
	}
	if (!Array.isArray(value.worlds)) throw new Error("public site index lacks worlds");
	const worlds: PublicWorld[] = value.worlds.map((row, index) => {
		if (!isRecord(row) || typeof row.slug !== "string") {
			throw new Error(`worlds[${index}] is malformed`);
		}
		const db = typeof row.db === "string" ? row.db.trim() : "";
		const adventure = typeof row.adventure === "string" ? row.adventure : "";
		return {
			slug: row.slug,
			name: typeof row.name === "string" ? row.name : row.slug,
			...(adventure !== "" ? { adventure } : {}),
			...(db !== "" ? { db } : {}),
			position: typeof row.position === "number" ? row.position : index + 1,
		};
	});
	return {
		v: PUBLIC_SITE_INDEX_VERSION,
		generated_at: typeof value.generated_at === "string" ? value.generated_at : "",
		...(value.sample === true ? { sample: true } : {}),
		mcp: {
			url: value.mcp.url,
			scope: String(value.mcp.scope ?? "openid profile email offline_access"),
		},
		worlds,
	};
}

export async function fetchPublicSiteIndex(
	base: string,
	fetchImpl: typeof fetch = fetch,
): Promise<PublicSiteIndex> {
	const response = await fetchImpl(joinUrl(base, "index.json"), { cache: "no-store" });
	if (!response.ok) throw new Error(`index.json: HTTP ${response.status}`);
	return parsePublicSiteIndex(await response.json());
}
