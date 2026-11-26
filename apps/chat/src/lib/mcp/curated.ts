/** Default PLAYER tools the in-browser agent may call. Configurable, not hard-wired. */
export const DEFAULT_CURATED_MCP_TOOLS = [
	"spellkave_orient",
	"spellkave_scene",
	"spellkave_manipulation_context",
	"spellkave_manipulate",
	"spellkave_communicate",
	"spellkave_sense_context",
	"spellkave_sense",
	"spellkave_move",
	"spellkave_end_turn",
	"spellkave_self_summary",
	"spellkave_inventory",
	"spellkave_map",
	"spellkave_session_status",
] as const;

export type CuratedMcpToolName = (typeof DEFAULT_CURATED_MCP_TOOLS)[number];

export function curatedToolSet(
	names: readonly string[] = DEFAULT_CURATED_MCP_TOOLS,
): ReadonlySet<string> {
	return new Set(names);
}
