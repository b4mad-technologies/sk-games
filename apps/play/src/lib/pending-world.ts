export const PENDING_WORLD_KEY = "spellkave.play.pending-world";

export function rememberWorld(storage: Storage, slug: string | null): void {
	if (slug === null || slug === "") return;
	storage.setItem(PENDING_WORLD_KEY, slug);
}

export function pendingWorld(storage: Storage): string | null {
	const slug = storage.getItem(PENDING_WORLD_KEY)?.trim() ?? "";
	return slug === "" ? null : slug;
}
