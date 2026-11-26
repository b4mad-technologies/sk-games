# Source and dependency provenance

The initial source was copied with Git archive from Spellkave
`e9e078d5bb8290c2d985c42bfa0dc8164df5542a` (`origin/main`, 2026-11-26).
The copy forms a fresh history; the first commit holds the files unchanged.

## Paths taken

| Monorepo path | Here |
| --- | --- |
| `apps/play` | same, without `.impeccable/review` (2 UI screenshots) |
| `apps/classic` | same |
| `apps/chat` | same |
| `apps/maps` | same |
| `tsconfig.base.json`, `.node-version` | same |

`package.json`, `pnpm-workspace.yaml`, `.gitignore` and
`scripts/pack-design-system` are new and small. The Nx `project.json`
files and the authoring corpus preparation step in the app scripts were
removed. `apps/*/app.toml` (Cloudflare publication inventory) and
`wrangler.jsonc` stay as copied.

The removed Nx targets ran, per app: the skgate `ui-primitives` gate,
`typecheck`, `test` and `build`; play also ran `check:tile-clip`. Builds
need `VITE_SPELLKAVE_LOGIN_ORIGIN` (chat, maps, play) and take
`VITE_SPELLKAVE_GATEWAY_URL` and `VITE_SPELLKAVE_WORLD_URL`; see each
`app.toml` for the full list.

## Design system packages

`@spellkave/ui`, `ui-widgets`, `authkit`, `map-canvas` and
`run-events-view` live in sk-sites and are not on npm yet. Until they are,
`scripts/pack-design-system [path-to-sk-sites]` packs them with `pnpm pack`
from a temporary clone of sk-sites and unpacks each tarball into
`.tarballs/<pkg>/` (ignored); `pnpm-workspace.yaml` overrides map them
there. pnpm copies them into `node_modules`, so the apps see only the
packed files. Directories, not the `.tgz`, because `pnpm pack` output
differs between platforms and a locked checksum would not match. CI packs
the sk-sites commit `SK_SITES_REF` in `.github/workflows/ci.yml`. The apps
declare the packed version, `0.1.0`. After publishing, drop the overrides and the script.

What the npm boundary showed:

| Finding | Where | Effect here | Fix |
| --- | --- | --- | --- |
| `./vite` entries ship TypeScript | `@spellkave/ui/vite`, `@spellkave/authkit/vite` | Node will not strip types under `node_modules`, so every `vite.config.ts` fails to load | interim: `nodeOptions: --import=tsx` in `pnpm-workspace.yaml`; real fix: sk-sites ships these entries as JavaScript |
| Tailwind scans package source | `@source` in each app stylesheet | the monorepo path `../../../packages/...` silently drops classes (play: 43 utilities) | `@source` now reads `../node_modules/@spellkave/<pkg>/src`; works because the packages ship `src`. A package CSS entry that declares its own `@source` would remove the coupling |
| Tests read package `.svelte` files | play `Thread.test.ts` (`SpeechBubble.svelte`), play `App.smoke.test.ts` (`Place.svelte`), maps `App.smoke.test.ts` (`MapCanvas.svelte`) | not in the package `exports` | read through `node_modules` paths now; better: move these CSS-contract checks to sk-sites |
| Tile-clip selection names package files | `apps/play/scripts/tile-clip-selection.ts` | package files never change here, so it always runs every card | none needed |
| Packages are `private`, version `0.0.0` | all five | `pnpm pack` works; `npm publish` would refuse | sk-sites publish preparation (bead sk-jay0.7.405.41.5) |

Scripts run through pnpm (`pnpm run`, `pnpm exec`) get the tsx loader;
`npx vitest` does not.

## Published dependencies

| Package | Source |
| --- | --- |
| `@spellkave/agent-observability`, `sdk`, `session`, `tool-authoring`, `tool-contracts`, `tool-player`, `tool-runtime`, `world-map` | npm `0.1.2` |

## Needed from other repositories

- `apps/classic` bundles SRD sprites with `import.meta.glob` from
  `packages/spellkave-srd-cc/assets/srd-art` (sk-content). Here the glob
  finds nothing: the app builds without art and `srd-art.test.ts` fails
  (1 test).
- `apps/play/scripts/local-world-gateway.mjs` and
  `apps/maps/scripts/local-demo-gateway.mjs` (local development only)
  import `packages/spellkave-mcp/src/*` and
  `packages/spellkave-world-map/src/index.ts` by monorepo path and read
  `packages/spellkave-adventure-elven-mini/assets`. `@spellkave/mcp`
  (sk-sdk) is not on npm.
- `apps/play/scripts/no-scroll.sh` calls
  `.agents/skills/sk-playtest/scripts/browser-click.sh` and
  `provision-tile-browser.sh` calls `scripts/ci/runners/toolchain/browser-deps.sh`
  (monorepo only).
- About 20 Markdown links in app docs point at monorepo files (`ledger/`,
  `.agents/skills/`, `specifications/adr/`, `infra/cloudflare/`).
