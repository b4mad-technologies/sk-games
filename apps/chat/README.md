# `@spellkave/chat` — chat.spellkave.com

Svelte 5 + Vite SPA with WorkOS AuthKit login. Deployed as a Cloudflare Worker
that serves static assets only (no Account API proxy). Custom-domain binding is
Pulumi, not this package.

Shape:

1. Svelte SPA shell with a two-column layout (chat left, read-only tiles right).
2. `pi-agent-core` agent whose `streamFn` talks to WebLLM in a Web Worker.
3. MCP client against `https://mcp.spellkave.com/mcp` using the WorkOS token.
4. Read-only Ich / Ort / Beutel / Leute / Karte tiles from ui-widgets later.
5. No hosted LLM in the path; the model runs on the visitor's machine.

After login the SPA talks to the Spellkave player MCP (`Streamable HTTP`) with
the WorkOS access token (`Authorization: Bearer`). The token's RFC 8707
`resource` / `aud` is the same URL the MCP client uses (unless the client URL
is same-origin relative — see below).

## Env

See `.env.example`. WorkOS (`VITE_WORKOS_CLIENT_ID`, `VITE_WORKOS_ISSUER`) is
required. Optional `VITE_SPELLKAVE_MCP_URL` overrides the MCP endpoint
(default `https://mcp.spellkave.com/mcp`). When that value is an **absolute**
URL it is also the AuthKit token resource (`aud`). A **relative** URL such as
`/mcp` keeps `aud` at `VITE_SPELLKAVE_MCP_RESOURCE` or
`https://mcp.spellkave.com/mcp`.

Until the deployed gateway has `/mcp` CORS, a tailnet preview talks to a
**local** player-mcp through a same-origin Vite proxy. That gateway listens on
loopback (e.g. `http://127.0.0.1:8087`) but validates `Host` and JWT `aud`
against `https://mcp.spellkave.com/mcp`:

```bash
SPELLKAVE_MCP_DEV_PROXY_TARGET=http://127.0.0.1:8087 \
  SPELLKAVE_MCP_DEV_PROXY_HOST=mcp.spellkave.com \
  VITE_SPELLKAVE_MCP_URL=/mcp \
  pnpm --filter @spellkave/chat dev
```

The proxy keeps `Host: mcp.spellkave.com`, strips `Origin` (Origin-less is
allowed), and does not buffer so Streamable HTTP / SSE can stream. Leave the
AuthKit resource at the default `https://mcp.spellkave.com/mcp`. Do not set the
proxy in production Worker builds.

## Local player-mcp gateway

1. Serve the **page and the gateway over HTTPS**. An `https://` chat origin
   cannot call `http://localhost:8080/mcp` (mixed content). A loopback
   `http://127.0.0.1:5184` Vite page may call an `http://` gateway.
2. The gateway allowlist is **hostnames**, via
   `SPELLKAVE_MCP_ALLOWED_ORIGIN_HOSTNAMES`. `localhost` is always present;
   `chat.spellkave.com` is added on the deployment stack. Do not put
   `localhost:5173` in that env — colons are invalid. Vite in this package
   listens on **5184**.
3. Reconcile the deployed gateway after changing the deployed allowlist;
   env is not live until the stack is applied.

Planned remaining beads: live tool transcript (sk-jay0.1.2.5), read-only
tiles (sk-jay0.1.2.6).
