# Development notes

This guide covers local setup, the parts of the code that work together, and the
checks needed when changing them. The [README](../README.md) explains the project;
the [folder guide](./repository-structure.md) lists the repository structure.

## Build and install

Use the Node version in `.nvmrc`. Run commands from the repository root:

```sh
npm ci
npm run verify
```

`npm ci` installs the dependencies recorded in the lockfile. `npm run verify`
runs lint, unit tests, release metadata checks, TypeScript checks, and the
production build. It does not run the browser tests.

The installable files are `main.js`, `manifest.json`, and `styles.css`. Copy all
three into `<vault>/.obsidian/plugins/emberly-maps/`, reload Obsidian, and enable
Emberly Maps under Community plugins. The manifest specifies the supported
Obsidian version and desktop-only availability.

For ongoing work, run `npm run dev`. It rebuilds when source files change and
includes an inline JavaScript source map for debugging. After rebuilding, copy
the generated files to the test vault and reload the plugin. The watcher does
not install the build or reload Obsidian for you.

## Test vault and fixtures

After building, this command creates a local test vault:

```sh
node scripts/dev/create-resource-test-vault.mjs
```

The destination is `.testvaults/Resource Ownership v2`. The script copies the
fixtures, installs the current build, and enables automatic internal-link updates
in that new vault. It refuses to overwrite an existing vault.

The fixtures serve different purposes:

- [Seagulls](../tests/fixtures/seagulls/README.md) provides a complete map with
  notes and reference links for checking layout, navigation, and the inspector.
- [Resource ownership](../tests/fixtures/resource-v2/) contains Sailing and
  Workshop, with duplicate filenames, shared attachments, and resources that can
  be moved between maps.

Keep the committed fixtures separate from local test results. `.testvaults/` is
ignored by Git. To try Seagulls in another vault, follow its copy instructions;
copy it once, then use the plugin's Duplicate action if you need another copy
with new IDs.

## How the plugin fits together

`src/main.ts` registers commands and connects the services. `src/app/` handles
plugin events, pane associations, and reference refreshes. Map views and
operations live in `src/maps/`; topic and resource behavior live in their own
folders. `src/vault/` handles files, metadata, and Obsidian Graph integration.

The map is rendered by Pixi 6 in `src/emberly-engine/`. `engine-host.ts` provides
the interface used by the plugin, and `adapter/markdown-collection.ts` translates
Markdown-backed topics into renderer entities. Keep Obsidian-specific integration
in these boundaries where possible.

The notes panel uses Obsidian's Markdown editor. The plugin adds map navigation,
headers, and resource controls around it. Changes must preserve native editing,
undo, links, selection, and file history.

## Data and file operations

Maps, topics, and resources are Markdown files using `emberly-format: 2`.
The [format reference](./resource-export-v2.md) defines the fields and validation
rules. These are the main relationships:

- The `Map name.emberly.md` file is both the map document and its root note.
- Each topic stores its map ID, parent ID, and a fractional string ordering key.
  Use the ordering helpers in `src/topics/topic-hierarchy.ts`; do not turn those
  keys into numbers or sort them using locale rules.
- Each resource belongs to one non-root topic. Resource order is a non-negative
  integer, with higher values displayed first.
- Filenames determine display titles. IDs determine identity and relationships,
  so renaming a file must not change its ID.
- Parent and owner wikilinks are derived from those relationships. They make the
  hierarchy visible to Obsidian's links and Graph; they do not determine ownership.

Use the existing file-operation services and Obsidian's public APIs. Property
edits go through `FileManager.processFrontMatter`; operations that must compare
and update both body text and properties use `Vault.process`. Renames and trash
operations go through FileManager so Obsidian can apply its link and trash settings.

Metadata events can arrive during a write. The frontmatter editor and local-write
guard track the intended property changes. A recent local write is not enough
reason to ignore an external edit. Preserve unrelated body text and custom
properties, and recheck identity and ownership before applying a move.

Moving a resource between maps can involve copying attachments, rewriting links,
and moving its note. This is not an atomic transaction. Preserve the verified-copy
and recovery steps, report partial failures, and retain shared or uncertain source
attachments. Do not overwrite an occupied destination or guess ambiguous ownership.
Map duplication and trash operations need the same care with shared files.

## Rendering and interaction

The map's curves, typography, spacing, selection, zoom, collapse, and drag behavior
are part of the interface. Refactors should preserve them. If a change intentionally
alters an interaction or appearance, describe that change explicitly.

Ordinary note typing should not rebuild the map or reset its viewport. Appearance
and filename changes can be reconciled in place. Hierarchy changes need a fresh
structural comparison; use the existing change detection and operation queue.

The selected note's incoming and outgoing body links are projected onto topics in
that map. A linked resource is represented by its owning topic. Refreshing these
connections should not move the viewport or recreate the canvas.

A renderer can move into an Obsidian pop-out window. Fonts, input listeners,
visibility, animation, and resize handling must follow the canvas's owning
document and window. Dispose those resources when the view closes. Text-atlas
packing must not mutate shared glyph measurements or another map's frames.

The combined map-and-notes layout is not restored after restarting Obsidian.
Users currently reopen it with Open map. Panel sizing is also session-local.

## Automated checks

The build applies `scripts/build/pixi-local-images.mjs` to Pixi 6.5.1. Its unused
network adapter rejects requests, and optional image-bitmap conversion uses the
image already loaded in memory instead of fetching its URL again. Built-in images
are bundled; custom map images are resolved from vault attachments. The build
stops if the patched source or Pixi version changes, so dependency upgrades need
an explicit review of these two adaptations. Browser tests use the same build
plugin and check image pixels with network access blocked.

Use the commands that cover the code you changed:

| Command | Checks |
| --- | --- |
| `npm run lint` | Obsidian/TypeScript rules and JavaScript correctness |
| `npm run typecheck` | TypeScript without generating files |
| `npm test` | Unit, DOM-adapter, and filesystem fixture tests |
| `npm run build` | Metadata, types, and production bundles |
| `npm run verify` | Lint, unit tests, and production build |
| `npm run test:browser` | Renderer images, text, windows, and pane layout regressions (after building) |

For a focused test run:

```sh
npm test -- tests/resources/resource-export.test.ts
```

Browser tests use Playwright with an installed Chrome by default. To use
Playwright's Chromium, install it once with `npx playwright install chromium`,
then select it in your shell before running the tests:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chromium'
npm run test:browser
```

In a POSIX shell, use `PLAYWRIGHT_CHANNEL=chromium npm run test:browser`.

The browser suite checks local image pixels without network requests, tag wrapping
and panel visibility, labels across rebuilds, selection, collapse, wheel zoom,
panning, dragging, double-clicking, window migration, WebGL restoration, and
cleanup. It supplies an adapter for Obsidian's window-migration callback; it does
not run inside Obsidian. Unit and DOM tests likewise use adapters for the app.

## Check in Obsidian

Run `npm run verify` before submitting a code change, and the browser suite when
changing the renderer or its integration. Also exercise the affected behavior in
a test vault with the built plugin installed.

For renderer and pane changes, try multiple open maps, repeated opening and
closing, light and dark themes, and moving a tab into a pop-out and back. Check
that labels, zoom, selection, and note editing still work. Watch the developer
console for errors.

For data changes, inspect the resulting Markdown and attachments as well as the
UI. Test rename collisions, shared files, concurrent edits, and interrupted
operations where relevant. A passing visual check does not establish that files
were preserved correctly.

Describe the problem, the resulting behavior, and what you tested when submitting
a change. State any checks you could not perform. Before a release, complete the
[Obsidian checklist](./obsidian-smoke-checklist.md) and follow the
[publishing guide](./publishing.md).
