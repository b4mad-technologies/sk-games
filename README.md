# sk-games

Game clients for [Spellkave](https://spellkave.com), a persistent multiplayer
game world: `apps/play` (main client), `apps/classic` (point-and-click
client), `apps/chat` (chat player) and `apps/maps` (world map).

## Status

Early public cut. The apps use the Spellkave design system
(`@spellkave/ui`, `ui-widgets`, `authkit`, `map-canvas`, `run-events-view`)
from [sk-sites](https://github.com/b4mad-technologies/sk-sites). Those
packages are not on npm yet, so a fresh clone needs one extra step:

```bash
git clone https://github.com/b4mad-technologies/sk-sites ../sk-sites
scripts/pack-design-system ../sk-sites   # packs the design system into .tarballs/
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
```

Node and pnpm versions are pinned in `package.json`.

## Licence

Code: [PolyForm Shield 1.0.0](LICENSE). Art: see [ART.md](ART.md).
Third-party notices: [NOTICE](NOTICE). Origin of the files:
[PROVENANCE.md](PROVENANCE.md).
