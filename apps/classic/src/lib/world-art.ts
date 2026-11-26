// The world's own pictures (ADR-0073), loaded through the gateway.
//
// An occupant or a place may carry an authored picture: a path, a content
// hash and a license. The bytes come from the world's gateway with the
// player's token and are checked against the hash (`loadWorldImage`). The
// app needs a gateway origin for that (`VITE_SPELLKAVE_GATEWAY_URL`); without
// one, and for every picture that fails, the caller falls back to SRD art or
// a glyph.

import { loadWorldImage } from "@spellkave/map-canvas/world-assets";

export type ArtReference = { path: string; hash: string };

/** A fetch of one picture's verified bytes; rejects when it cannot be had. */
export type ArtFetch = (art: ArtReference, signal: AbortSignal) => Promise<Blob>;

/** `VITE_SPELLKAVE_GATEWAY_URL` as an origin, or null when unset or not a web address. */
export function gatewayOrigin(raw: string | undefined): string | null {
	const text = raw?.trim() ?? "";
	if (text === "") return null;
	try {
		const url = new URL(text);
		return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
	} catch {
		return null;
	}
}

/** The gateway fetch for one world and player. */
export function gatewayFetch(origin: string, slug: string, token: string): ArtFetch {
	return (art, signal) => loadWorldImage(art, origin, slug, token, signal);
}

/**
 * Pictures by content hash. Each picture is asked for once; a failure is
 * remembered as "none" so a refresh does not ask again. `close` gives the
 * object URLs back and stops what is still loading.
 */
export function worldArtStore(
	fetchArt: ArtFetch,
	toUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
	revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
) {
	const abort = new AbortController();
	const pending = new Map<string, Promise<string | undefined>>();
	const urls: string[] = [];
	return {
		/** The picture's URL, or undefined when the world's gateway does not give it. */
		load(art: ArtReference): Promise<string | undefined> {
			let known = pending.get(art.hash);
			if (!known) {
				known = fetchArt(art, abort.signal).then(
					(blob) => {
						if (abort.signal.aborted) return undefined;
						const url = toUrl(blob);
						urls.push(url);
						return url;
					},
					() => undefined,
				);
				pending.set(art.hash, known);
			}
			return known;
		},
		close() {
			abort.abort();
			for (const url of urls.splice(0)) revoke(url);
		},
	};
}
