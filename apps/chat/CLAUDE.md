# `apps/chat/` — agent context

Signed-in chat player for `chat.spellkave.com`. AuthKit login, a two-column
shell, an in-browser WebLLM model behind `pi-agent-core`, and an MCP client
under `src/lib/mcp/`.

## Binding invariants

- **Login comes from `@spellkave/authkit`.** Do not add a local `authkit.ts`.
  App-owned route constants live in `src/lib/auth-routes.ts`.
- **The Worker serves static assets only.** No Account API proxy, no `/app`
  prefix, no `routes` in `wrangler.jsonc`. The `chat.spellkave.com` binding is
  Pulumi (`infra/cloudflare`), not this package.
- **Env is WorkOS, the login site, plus optional MCP URL:** `VITE_WORKOS_CLIENT_ID`,
  `VITE_WORKOS_ISSUER` and `VITE_SPELLKAVE_LOGIN_ORIGIN` (the login site sign-out
  posts to; no default, required for every non-dev build) via `readAuthConfig`. Optional
  `VITE_SPELLKAVE_MCP_URL` is the MCP endpoint **and** (when absolute) the
  AuthKit resource (`aud`). Relative `/mcp` plus `SPELLKAVE_MCP_DEV_PROXY_TARGET`
  is the tailnet-preview path; `VITE_SPELLKAVE_MCP_RESOURCE` overrides `aud`.
  Do not add `VITE_SPELLKAVE_API_URL` or `VITE_SPELLKAVE_PUBLIC_SITE_URL` here.
- Tokens stay in `sessionStorage`. Never print a token or bearer value.
- **The model is `@mlc-ai/web-llm` in a Web Worker.** The Agent talks to it
  through `BrowserModelProvider.createStreamFn()`. Do not add a hosted LLM.
  No WebGPU → show the missing message; there is no fallback.
- **MCP wiring is `attachMcpTools()` in `src/lib/mcp/`.** Call it from the
  chat pane after the model is loaded. Failure to connect must not break
  chatting.

## Verification

```bash
pnpm --filter @spellkave/chat run typecheck
pnpm --filter @spellkave/chat run test
pnpm --filter @spellkave/chat run build
```
