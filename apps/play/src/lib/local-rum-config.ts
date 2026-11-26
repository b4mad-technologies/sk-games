export interface LocalRumConfig {
	applicationId: string;
	clientToken: string;
	version: string;
	environment: string;
	worldSlug: string;
}

/** Explicit operator opt-in, and only when a staged dev profile was resolved. */
export function readLocalRumConfig(
	env: Record<string, string | undefined>,
	mode: string,
	staged: boolean,
): LocalRumConfig | null {
	if (mode === "production" || mode === "test" || !staged || env.SPELLKAVE_RUM_DIAGNOSTIC !== "1")
		return null;
	const applicationId = env.VITE_SPELLKAVE_RUM_APPLICATION_ID?.trim() ?? "";
	const clientToken = env.VITE_SPELLKAVE_RUM_CLIENT_TOKEN?.trim() ?? "";
	const version = env.VITE_SPELLKAVE_RUM_VERSION?.trim() ?? "";
	const environment =
		env.OTEL_RESOURCE_ATTRIBUTES?.split(",")
			.find((v) => v.startsWith("deployment.environment="))
			?.split("=")[1] ?? "";
	const worldSlug = env.SPELLKAVE_WORLD_SLUG ?? "";
	if (
		!applicationId ||
		!clientToken ||
		!version ||
		!/^local-[a-z0-9-]+$/.test(environment) ||
		!/^[a-z][a-z0-9-]{0,63}$/.test(worldSlug)
	)
		return null;
	return { applicationId, clientToken, version, environment, worldSlug };
}

/**
 * Where the dev server relays diagnostic RUM. Operator-set, https only, and
 * never part of the browser config. Unset or malformed switches the relay off.
 */
export function readLocalRumUpstream(env: Record<string, string | undefined>): string | null {
	const upstream = env.SPELLKAVE_RUM_DIAGNOSTIC_UPSTREAM?.trim() ?? "";
	return /^https:\/\/[^\s?#]+$/.test(upstream) ? upstream : null;
}
