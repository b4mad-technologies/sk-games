import type { AuthSession } from "@spellkave/authkit";
import type { AccountGetResponse } from "./account-api";
import type { PlayPresentation } from "./play-recording";
import type { OpenPlaySessionArgs, PlaySessionHandle } from "./play-session";

/** Explicit dependency injection for a separate, credential-free entry point.
 * The live entry never supplies this. No URL parameter enables it. */
export interface PlaySandbox {
	session: AuthSession;
	account: AccountGetResponse;
	world: { slug: string; name: string; db: string };
	/** Optional, local-only presentation state for an imported recording. */
	presentation?: PlayPresentation;
	openWorld(args: OpenPlaySessionArgs): Promise<PlaySessionHandle>;
}
