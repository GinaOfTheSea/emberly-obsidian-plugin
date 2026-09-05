# Static uniform upload comparison

Tested 2026-09-05 on Windows with headless Chrome 152.0.7977.76, at 1000 × 700.
These measurements cover the uniform-upload candidate before the two toolbar
button removals. The maintainer subsequently tested the candidate in the Resource
Ownership v2 vault on Windows and reported that it looked good on 2026-09-06.
Exact app/installer versions and individual native checklist outcomes were not
recorded. The change is included in release 0.1.2.

## Change and baseline

The baseline is Pixi 6.5.1's original capability probe and two uniform upload
generators, as used by Emberly Maps 0.1.1 (`2254a4e`). The candidate replaces them
at build time with reusable static upload plans. It preserves WebGL and removes
all three `new Function` call sites from the production bundle.

The comparison harness builds both variants from the same engine source and
dependencies. Only the static-uniform adaptation is toggled; local image loading
and all other build inputs match. This isolates the uniform change rather than
comparing different versions of the app.

Production `main.js` at the time of this run:

| | Published 0.1.1 | Candidate |
| --- | --- | --- |
| Bytes | 695,693 | 691,916 |
| `new Function` sites | 3 | 0 |
| Direct `eval` calls | 0 | 0 |
| SHA-256 | `56f4c0f7474c8c7c60ccea0fd6996a3456c0a847fd62626847469eb09d1c94d6` | `7f17d3e66e8d9420464f195038c58583ee82d8722cc4feabf653701cd7457f2b` |

## Rendering and behavior

- Baseline and candidate screenshots were byte-identical in light and dark themes.
- Every paired 30-, 300- and 1,000-node benchmark screenshot was byte-identical.
- The candidate rendered using WebGL with `unsafe-eval` excluded from its content
  security policy. A normal page script confirmed that compilation was blocked;
  the test also checked the renderer type to rule out Canvas fallback.
- A real WebGL2 shader produced identical pixels when updating an automatic
  uniform buffer containing a color and matrix. Nested sampler groups kept
  distinct texture units. No GL errors were reported.
- Differential unit tests compared ordinary scalar, vector, matrix, sampler and
  array uploads, cached updates, Pixi object values, nested groups, and uniform
  buffer layouts with the installed Pixi generators.
- The existing browser regressions passed: images, repeated text rebuilds,
  selection, collapse, zoom, pan, drag, double-click, window migration, graphics
  context restoration, disposal, pane layout, inline rename and rating preview.

`npm run verify` passed: lint, 353 tests in 33 files, type checking and the
production build. `npm run test:browser` passed, including the new comparison.

## Performance

Four alternating paired trials per map size, each in a fresh page. The synthetic
maps use a balanced tree with labels, emoji and varied ratings. After loading and
settling, each trial renders 30 warmup frames and 120 timed frames with a small
pan offset. Table entries are medians across the four trials.

These timings measure CPU render submission, not displayed FPS or total GPU
latency. Startup includes creating the engine and waiting for its loaded flag;
it excludes vault file I/O. The benchmark ran on its own after the other suites.

| Nodes | Loaded, baseline → candidate | Median render, baseline → candidate | p95 render, baseline → candidate |
| --- | --- | --- | --- |
| 30 | 47.90 → 46.70 ms | 0.10 → 0.10 ms | 0.20 → 0.20 ms |
| 300 | 72.55 → 73.85 ms | 0.70 → 0.70 ms | 1.15 → 1.25 ms |
| 1,000 | 131.25 → 136.40 ms | 2.35 → 2.55 ms | 2.95 → 3.20 ms |

At 1,000 nodes the candidate added 0.20 ms (about 8.5%) to median submission time
and 5.15 ms (about 3.9%) to startup. That is acceptable for this candidate on the
tested machine, with native app checks still required before release.

The automated thresholds allow median render growth of the greater of 0.5 ms or
10%, p95 growth of 1 ms or 15%, and startup growth of 25 ms or 20%. All passed.
Those tolerances account for short-duration timing noise; they are not universal
performance targets.

Heap measurements after explicit garbage collection were similar:

| Nodes | Active heap, baseline → candidate | After disposal, baseline → candidate |
| --- | --- | --- |
| 30 | 4.77 → 4.76 MB | 3.42 → 3.42 MB |
| 300 | 14.01 → 14.01 MB | 3.54 → 3.53 MB |
| 1,000 | 38.29 → 38.26 MB | 3.56 → 3.55 MB |

These are decimal MB of JavaScript heap, not total process or GPU memory, and do
not establish that every repeated-use scenario is leak-free.

## Reproduce

From the repository root, after installing dependencies:

```sh
npm run verify
npm run test:browser
```

Run the optional measurements separately in PowerShell:

```powershell
$env:UNIFORM_BENCHMARK = '1'
node tests/browser/run-static-uniforms.mjs
Remove-Item Env:UNIFORM_BENCHMARK
```

Set `QA_OUTPUT` to an existing directory to save the theme screenshots and
`uniform-benchmark.json`, which includes individual trials and the summary. Set
`PLAYWRIGHT_CHANNEL=chromium` to use Playwright's installed Chromium instead of
Chrome. Different browser versions, drivers and hardware can change measurements.

## Native Obsidian coverage

The harness supplies adapters for Obsidian APIs. It does not run inside Obsidian.
The maintainer's test-vault feedback is recorded above; the full checklist below
has not been independently recorded as complete.
In the test vault, check the seagull map and a larger map in both themes; text and
emoji; image nodes; zoom, pan, drag and collapse; multiple open maps; repeated
closing and reopening; and moving a map into a pop-out and back. Watch for console
errors, rendering differences or a noticeable change in responsiveness. Complete
the affected [Obsidian checks](../obsidian-smoke-checklist.md) before release.
