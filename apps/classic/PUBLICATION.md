# Classic publication preparation

Classic is planned at `classic.play.spellkave.com` for `sk-w8zx.145`.
This change creates no live hostname, WorkOS registration or publication.
`app-publish.yml` and `skop app publish/check` refuse the planned manifest.
`classicEnabled` defaults to false; enabling it while the manifest is planned
also refuses. The dormant custom-domain resource is protected when admitted.

The source reference reviewed on 2026-11-16 is draft PR #4926,
`origin/feat/classic-fresh` at `76ce691642c71eef34fb71ee2a1b0418929eecca`.
That package defines `typecheck`, `test`, and `build` scripts, not an Nx `ci-app`
target. Its gateway input is `VITE_SPELLKAVE_GATEWAY_URL`. The preparation uses
those names and an asset-only Wrangler configuration with public preview URLs
disabled; it does not import or claim to qualify the unmerged application.

That source builds index, demo and stage pages. In production its
`virtual:classic-dev-local` profile is null and its local RUM/run-events
configuration is disabled. It does not establish the hosted sign-in, callback,
seat/world session and browser RUM contract described by the planned manifest.
The callback and needs in app.toml are the intended admission target, not a
statement that this source already implements them. Cross-app imports from Play
remain source-lane work (`sk-jay0.1.76.7`); hosted Classic work remains
`sk-jay0.1.76.12.1` (auth/bootstrap), `sk-jay0.1.76.12.3` (admission)
and `sk-w8zx.145`.

Before activation, the source owner must land a reviewed app, qualify the three
build scripts and shared-route inputs, implement the hosted auth/session flow,
and verify every declared browser dependency. Reconcile the intended needs,
CSP image/connect/font sources, logout path and RUM version with the implemented
client. A signed-out HTML smoke alone cannot prove a playable hosted client.

The operator and owner then review one concrete activation diff: change status
to active, regenerate the shared inputs and asset CSP, inspect the new API/MCP,
R2, RUM edge/backend and WorkOS entries, and rerun the app and infrastructure
gates. Resolve the staging SPA Connect export gap recorded in the manifest
contract before claiming staging equality. Do not delete legacy exceptions as
part of admission (`sk-jay0.5.26`).

Publishing a new Worker precedes its custom-domain binding. The operator must
plan the bootstrap explicitly: the common workflow's public smoke cannot pass
until the hostname exists. A failed first smoke does not mean the Worker was
not published; inspect its exact run and receipt before any retry. With an
owner go, the operator applies the protected `spellkave-classic` domain using
`classicEnabled=true`, admits the reviewed WorkOS values and applies the origin
changes. This preparation does not authorize any of those actions or an app
pilot. Run `skop app check classic --sha <40hex>` and a real browser auth/world
session after admission before accepting it.

No persistent world data, seats or platform release changes are needed by this
preparation. Reverting it before activation has no hosted effect. After activation,
code rollback uses a compatible previous source and its receipt; removing the
protected hostname, reverting origin admission or editing WorkOS requires an
explicit operator/owner decision. Turning the flag off alone must not silently
delete a protected live hostname.
