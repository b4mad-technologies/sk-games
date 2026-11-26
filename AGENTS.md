# Agent map

- [README.md](README.md): what is here and how to build and test.
- [PROVENANCE.md](PROVENANCE.md): what came from the Spellkave monorepo, the npm boundary findings, and what the apps still need from other repositories.
- [ART.md](ART.md) and [NOTICE](NOTICE): image licence and third-party material.
- `apps/play`, `apps/classic`, `apps/chat`, `apps/maps`: each has its own `CLAUDE.md` with app rules.
- [.github/workflows/ci.yml](.github/workflows/ci.yml): CI on pull requests and `main`.

Commands (Node and pnpm versions are pinned in `package.json`):

```bash
scripts/pack-design-system ../sk-sites   # design system, packed, into .tarballs/
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build                               # needs VITE_SPELLKAVE_LOGIN_ORIGIN
pnpm --filter @spellkave/<app> run test  # one app
```

Rules:

- The design system (`@spellkave/ui`, `ui-widgets`, `authkit`, `map-canvas`, `run-events-view`) comes from sk-sites. CI packs it from the commit pinned in `ci.yml` (`SK_SITES_REF`); bump that on purpose, and run `pnpm install` locally if the packages' dependencies change.
- Run scripts through pnpm (`pnpm run`, `pnpm exec`): it adds the tsx loader the design system's `./vite` entries need.
- Do not skip tests. The only skip is in `apps/classic/src/lib/srd-art.test.ts` (SRD sprites not bundled here yet).
- This repo is public: no internal host names, local paths, private links or tokens.
