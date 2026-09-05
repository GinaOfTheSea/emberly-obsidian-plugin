# Repository structure

Production source lives under `src/`. Tests, fixtures, development tooling and
release tooling are kept outside the plugin entry point and bundle.

```text
src/
  main.ts             Plugin entry point and command wiring
  app/                Plugin events and pane/reference coordination
  maps/               Map models, views, settings and file operations
  topics/             Topic hierarchy, ordering, appearance and note UI
  resources/          Resource ownership, creation, moves and note UI
  vault/              Obsidian file, metadata and graph integration
  shared/             Shared types and text validation
  ui/                 Shared dialogs and icons
  emberly-engine/     Original Pixi renderer and its Obsidian adapters
  assets/             Bundled fonts, images and icons
  styles/plugin.css   Source stylesheet
tests/
  maps/ topics/ resources/ vault/ engine/  Feature regression tests
  helpers/            Obsidian adapters and fixture utilities
  fixtures/           Sample vault files
  browser/            Browser harness and renderer regression checks
  tooling/            Development and release tooling tests
scripts/
  build/              Browser harness bundling
  dev/                Test-vault creation and scoped cleanup/install tools
  release/            Versioning, metadata validation and release packaging
config/               Vitest and legacy JavaScript lint configuration
docs/                 Vault contract, smoke checklist and publishing guide
.github/workflows/    CI and draft release automation
dist/                 Generated release packages (ignored by Git)
.testvaults/          Local test vaults and backups (ignored by Git)
```

The [Seagulls test map](../tests/fixtures/seagulls/README.md) is the example shown
in the README. Fresh test-vault setup includes it alongside the resource fixtures.

Run all documented commands from the repository root. `npm run verify` runs
lint, unit tests, metadata validation, type checking and the production build.
`npm run test:browser` runs the text and window renderer regressions.
`npm run release:prepare` runs both and packages the release under `dist/`.

## Root files

Obsidian requires `README.md`, `LICENSE` and `manifest.json` at the repository
root for [Community directory submission](https://docs.obsidian.md/plugins/releasing/submit-plugin).
`versions.json` also stays there for plugin compatibility metadata.
Package manifests, the main ESLint/TypeScript/build configuration and Git/Node
settings remain at the root for standard tool discovery. Third-party notices
remain alongside the license and are included in release packages.

The build emits `main.js` and `styles.css` at the root, as in the Obsidian sample
plugin. These generated files are ignored by Git. Releases attach `main.js`,
`manifest.json` and `styles.css` individually; a source folder or ZIP does not
replace those assets. See [publishing](./publishing.md).

Obsidian's [review scanner](https://docs.obsidian.md/community-directory/faq)
recognizes supporting folders such as `tests`, `scripts` and `docs`. The feature
folders inside `src` are this project's organization choice, not a prescribed
Obsidian architecture. New code should go in its owning feature folder, with
corresponding tests. Keep the renderer's internal structure stable and its
Obsidian integration in the existing adapters.
