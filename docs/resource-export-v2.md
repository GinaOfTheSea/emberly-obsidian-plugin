# Emberly Markdown export contract — format 2

Maps, topics and resource notes now use `emberly-format: 2`.
Topics own their parent IDs and fractional ordering keys, matching legacy Emberly.
Map outlines are no longer emitted or read as hierarchy. Resource ownership and
resource ordering are unchanged. The legacy exporter emits this contract.

Existing format-1 outline maps require explicit validated conversion or a new export.
Do not reinterpret format-1 resource recovery fields as authoritative ownership.

## Layout

```text
Sailing/
  Sailing.emberly.md
  Topics/
    Weather.md
  Resources/
    Forecast.md
    Manual.md
  Assets/
    Manual.pdf
    Diagram.png
```

Each map has a separate folder, not the vault root. The map Markdown file is also
the root note; do not export a separate `Topics/root.md`. Folders organize files but
do not determine ownership. Each topic stores its parent ID; folder nesting is not hierarchy.
Topic bodies contain user notes: **do not emit managed `emberly-resources` lists**.
Ordinary links to resources are allowed, but do not assign or move them.
After import, users may move the complete map folder anywhere in their vault. Map
discovery and hierarchy remain metadata-backed; the folder name and map/root note
name stay unchanged during a move.

## Filename titles and lean topic properties

The final Markdown filename determines every map, topic and resource title.
Map roots use `Map name.emberly.md`; strip `.emberly.md` for their displayed map
title. For topics and resources strip only `.md`, so `Manual.pdf.md` displays as
`Manual.pdf`. Sanitize names for Obsidian/filesystem compatibility and apply
collision suffixes before writing notes. Do not emit a `title` property; old
overrides are ignored.
Headings and body text are user content, not synchronized titles.

A minimal topic (`Topics/Weather.md`) is:

```yaml
emberly: topic
emberly-format: 2
emberly-id: 8hw6r4y0v9x3p2mk
emberly-map: n7z2a4c6q8w0e3rt
emberly-parent: root-stable-id
emberly-parent-link: "[[Maps/Weather/Weather]]"
emberly-order: "a0"
```

The map note keeps `emberly: map`, `emberly-format: 2`, `emberly-id`,
`emberly-root-id` and `emberly-layout` (`center` or `branch`). `emberly-root-id`
is the stable topic ID of this map-backed root; it is distinct from the map ID.
The map body is ordinary root-note content; **do not emit an emberly-outline
section or a separate root topic note**.

Export `emberly-layout: branch` only when exactly one topic has the root as its
direct parent. Count collapsed categories too; descendant count is irrelevant.
Otherwise export `center`. Branch mode keeps the legacy hidden avatar root and
category styling. The plugin saves Center if a valid Branch map later has zero
or multiple categories, but never automatically changes Center to Branch.

### Center appearance (optional map properties)

- Omit `emberly-center` for the default avatar, or use `text` / `image`.
- For text, `emberly-center-text` is optional custom center text (up to 500
  characters). Omit it to follow the map filename. It is presentation only:
  do not rename the map/root note or put `TXT://` in its name.
- For an image, copy it to the map's Assets folder and set a **quoted wikilink**,
  e.g. `emberly-center-image: "[[Sailing/Assets/Center.jpg]]"`, alongside
  `emberly-center: image`. Do not emit remote URLs, data URLs or `IMG://` names.
  Use PNG/JPEG/GIF/WebP/AVIF up to 20 MiB; uploads also validate browser decoding,
  max 8192 pixels on either side and 32 megapixels. Rendering uses a circular
  center crop without changing the original bytes.
- Export only the properties for the chosen appearance. Branch layout retains
  these settings but hides the center. Changing layout does not erase them.
- This asset is map appearance, not a resource note and not root ownership.
  Native attachment renames follow Obsidian's internal-link update preference.
  Missing/unsupported images show a settings warning and default avatar. Resetting
  or replacing the center never deletes attachments. Format remains 2.

### Topic hierarchy

Map icon visibility is optional: `emberly-show-notes: false` and
`emberly-show-resources: false` hide the corresponding glyphs. Omit each property
for the default (shown). These are display preferences, not root ownership or
changes to topic/resource metadata; they apply to both Center and Branch layouts.

- Each non-root topic's `emberly-parent` names an existing topic ID in the same map,
  including `emberly-root-id` for direct children. The map-backed root has no
  topic frontmatter and no `emberly-parent` or `emberly-order`.
- `emberly-parent-link` is a quoted Obsidian wikilink to that parent note. It is
  derived from `emberly-parent`, provides the native Graph/backlink edge, and is
  repaired after hierarchy changes or renames. Importers may omit it; never use
  it to infer or override ownership, ordering, or hierarchy.
- Every non-root topic needs a string `emberly-order`. Use the legacy Emberly
  fractional-indexing algorithm (`src/topics/fractions.js`, CC0), or preserve valid legacy
  `index` strings. Examples: `"Zz" < "a0" < "a0V" < "a1"`.
  When exporting a known sibling sequence without keys, repeatedly call
  `generateKeyBetween(previousKey, null)` starting with null.
- Compare keys using case-sensitive character-code ordering, never localeCompare,
  numeric coercion or decimal midpoint arithmetic. Stable topic IDs break ties.
  Keys may grow when repeatedly inserting into the same gap; do not truncate them.
- Missing/foreign parents, cycles, duplicate IDs and invalid keys are reported.
  Do not infer parentage from paths, titles, links or an old outline.
- A branch move updates its top topic's parent/order, not its descendants. If it
  makes Branch layout ineligible, the map note's layout changes to Center too.
  Any separate appearance/collapse change keeps its usual topic property.

Settings on topics are sparse:

- Omit `emberly-side: right`; retain explicit left placement. Root side always
  derives from map layout, so the map-backed root has no side property.
- Omit `emberly-color: -1`, `emberly-collapsed: false`, `emberly-rating: 0` and
  `emberly-state: 0`. Retain explicit colors (including black/0), collapsed branches,
  nonzero ratings and meaningful plan/notes state bits.
- Resetting a default deletes the property, rather than storing null/undefined.
- Do not generate new `created` or `modified` timestamps. Historical dates may be
  exported if desired; the plugin preserves them and never updates them.

Preserve existing IDs verbatim, including UUIDs and legacy IDs. Newly allocated
plugin IDs use 16 uniformly random characters from `0123456789abcdefghjkmnpqrstvwxyz`,
with `crypto.getRandomValues`, vault collision checks and concurrent reservations.
Do not shorten old IDs, derive identity from filenames, or change IDs during format conversion.
Renames keep IDs/ownership. Obsidian handles ordinary link updates according to
its preference; the map hierarchy doesn't depend on those links being rewritten.
The map folder name must equal the display name of its `Map name.emberly.md` root.
Renaming a map renames both together. Topics, resources and attached binaries move
with the folder but retain their own filenames.

## Resource note example

For `Resources/Boat manual.md`:

```markdown
---
emberly: resource
emberly-format: 2
emberly-id: resource-stable-id
emberly-map: map-stable-id
emberly-topic: topic-stable-id
emberly-topic-link: "[[../Topics/Weather]]"
emberly-order: 30
emberly-kind: file
emberly-asset: Assets/Manual.pdf
source: Manufacturer
description: Reference handbook
emberly-rating: 4
tags:
  - reference
  - sailing/equipment
---
```

- IDs use lowercase ASCII letters, digits and hyphens. Resource IDs are globally
  unique within the vault. Preserve IDs on moves and renames.
- `emberly-map` and `emberly-topic` are authoritative. Each resource has exactly
  one owning non-root topic, which must belong to that map's valid parent hierarchy.
  Never set `emberly-topic` to the map's `emberly-root-id`. This applies to every
  resource kind, including note-only resources. The root supports settings/notes,
  not resources; the visible category in Branch layout is a normal resource owner.
  Root ownership is invalid, with no compatibility or automatic reassignment.
  Invalid files are reported and preserved, not migrated or deleted.
- `emberly-topic-link` is a quoted, derived Obsidian wikilink to the owner note.
  It supplies the native Graph/backlink edge and is repaired after resource moves,
  topic renames and map-folder moves. Importers may omit it; never infer ownership
  from it or let it override `emberly-topic`.
- **Resource** `emberly-order` remains a non-negative safe integer (unlike topic keys). Higher values display first;
  ties use resource ID ascending. Export original visible ordering with the first
  item assigned the largest value. New/moved resources get `max + 1`.
- `emberly-kind`: `link`, `file`, `image` or `note`. Online resources have an HTTP(S)
  `url`. Offline files can have any extension, no extension or zero bytes.
  A note-only resource has no asset.
- `emberly-asset` is an optional map-relative primary attachment under `Assets/`.
  It is rendered by the Emberly resource header, so do not duplicate the filename,
  URL or primary attachment in the body. Encode special characters in Markdown
  URLs, not in this property.
- Resource notes, descriptions, tags, ratings and custom properties must survive
  export. Do not omit ratings. Standard Obsidian `tags` store tags; rating is 0–5.
  There is no archive feature: omit `emberly-archived`. Existing `archived` and
  `emberly-archived` properties are ignored, not rewritten. Filename and heading
  do not define identity.
- Additional attachments use native inline Markdown links or wikilinks. Prefer
  these over HTML media, CSS URLs and reference-style links for cross-map moves.
- Leave the body empty unless the resource has genuine user-authored notes. The
  native editor is notes space, not a generated duplicate of the resource header.
- Missing owners, duplicate IDs, invalid orders and unsupported versions produce
  visible issues; they are never reassigned to a guessed topic.

## Derived indicators and native notes

Resource counts and map icons come from all valid owned resource notes. Omit
the old `emberly-state` resource bit (4); it is no longer authoritative. Other
plan/notes bits keep their meanings. Old archive flags do not hide resources.
Tag suggestions use resource metadata in the same map, with no separate
historical tag database.

Native-editor attachments follow the user's Obsidian preferences. Resources
uploads use map-level Assets. Local PNG/JPEG/GIF/WebP/AVIF previews work up to
20 MiB without extra generated files or remote fetches. Uploaded Markdown in
Assets is opaque attachment data, never indexed as Emberly notes.

## Move behavior and durability

Within a map, only the resource note's owner and order change; dates are preserved.
Topic and map documents are not written. Across maps, attachments are
copied to collision-safe names and SHA-256 verified before ownership commits.
The same resource note is then relocated with Obsidian FileManager. Its ID,
settings, custom properties and user notes survive. Local links in that note
become explicit vault-path wikilinks, unambiguous before and after relocation.
Ordinary links to other notes are retained, not recursively copied.

Unresolved links, stale cache positions, unsupported media/link syntax, and
special link characters in filenames cause a safe stop. Transfers are limited
to 100 MiB. Enable Obsidian's **Automatically update internal links** to update
incoming links when a resource note moves; the plugin does not change that setting.

One pending-operation record in plugin data supports **Recover pending resource
move** after interruption. Recovery rechecks actual content and hashes. Before
ownership commits, **Cancel uncommitted resource move (keep copied files)** can
release the record without deleting files. Newer edits are never replaced by a
recovery snapshot; conflicting edits require inspection.

Only verified unused originals within the source map's Assets go to Obsidian's
configured trash. Shared, changed, outside-map and uncertain originals remain.
Markdown, Canvas and Bases references are scanned conservatively. This is not a
multi-file or multi-device atomic transaction: keep backups and avoid concurrent
cross-device edits during a transfer.

## Initial interaction scope

Resource menu → Move… → search in a map or click an open map topic → save.
Cancel/Escape leaves selection. Topic dragging is disabled during selection.
Success returns to the source topic's Resources tab. The original Pixi engine,
single-click Notes behavior and native Markdown editor stay in place.

Bulk operations, resource drag/reorder and move Undo are deferred. There is no
React/Redux app port, editor replacement, global history stack or sync layer.
The legacy exporter emits this contract.
