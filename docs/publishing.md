# Publishing Emberly Maps

The release setup follows Obsidian's current [submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin),
[submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins),
and [developer policies](https://docs.obsidian.md/community-directory/developer-policies).

## Repository and release files

The repository is `GinaOfTheSea/emberly-obsidian-plugin`. Its current default branch
is `codex/integrated-native-map`. Git is already initialized; do not create another
repository inside the project. Keep the root manifest on the default branch up to
date because the Community directory reads that version.

The source and AGPL-3.0-only license are tracked. Bundled `main.js`, bundled
`styles.css`, local test vaults and `dist/` are generated/ignored. Build from the
lockfile with Node from `.nvmrc` and `npm ci`. `.npmrc` records the existing peer
dependency installation mode, so CI and Obsidian's build scanner use the same setup.
`private: true` prevents accidental npm publication; it does not control GitHub visibility.

The GitHub repository must be public before ordinary users can download releases.
Changing a private repository to public exposes its complete Git history, not just
the release files. Decide that visibility separately before the first public release.

## Prepare a version

For the initial version, keep `0.1.0`. For subsequent versions, run `npm version patch`
(or `minor`/`major`) from a clean, tested checkout. The version hook updates
`manifest.json` and `versions.json`; npm updates the package and lockfile and makes
the version commit/tag. Tags use `x.y.z` without `v`, matching Obsidian's requirement.
Do not reuse published tags or change historical minimum-version mappings.

Write `docs/releases/<version>.md` before tagging. If updating `minAppVersion`,
verify that app version in a real disposable vault; do not lower it speculatively.
The metadata check rejects mismatches among the manifest, package, lockfile,
compatibility map and release tag.

Run:

```sh
npm ci
npx playwright install chromium
# In PowerShell: $env:PLAYWRIGHT_CHANNEL = 'chromium'
# In bash: export PLAYWRIGHT_CHANNEL=chromium
npm run release:prepare
```

Chrome is the default for local browser checks; `PLAYWRIGHT_CHANNEL=chromium`
uses Playwright's installed Chromium. This produces `dist/<version>/` with the
three installable files, licenses and SHA-256 checksums. The plugin does not install
or update itself; these are development/release commands only.

## Create and publish the GitHub release

1. Complete [the native Obsidian checklist](./obsidian-smoke-checklist.md) and record
   the commit, app/installer versions, OS and results in the release notes.
2. Commit the release changes and push the default branch. Confirm CI passes.
3. For the initial version, create the tag with `git tag -a 0.1.0 -m "Release 0.1.0"`.
   For later versions, `npm version` already creates the tag. Push that exact tag,
   for example `git push origin 0.1.0`.
4. The release workflow reruns verification and browser checks and creates a
   **draft** containing `main.js`, `manifest.json` and `styles.css` as individual
   attachments. A ZIP alone is insufficient. License/checksum attachments are additional.
5. Review the draft and confirm public repository visibility before publishing.
   The workflow deliberately does not publish it automatically. An existing release
   causes creation to fail rather than silently replacing its files.

## Submit to the Community directory

Submission now uses the [Community directory](https://community.obsidian.md),
not the older community-plugins JSON pull-request process.

1. Sign in with the maintainer's Obsidian account and connect the GitHub account.
2. Add a plugin using `https://github.com/GinaOfTheSea/emberly-obsidian-plugin`.
3. Select the intended owner. Use **Free**: this plugin has no account/payment requirement.
4. Confirm ID `emberly-maps`, name `Emberly Maps`, author `Emberly AS`, description
   from the manifest and desktop-only compatibility. Check name/ID availability;
   listing acceptance has not been established by the local setup.
5. Review scanner results for manifest, release assets, source and build verification.
   Use **Review branch** for a preview and address findings before publishing the listing.

The initial directory submission is performed once. Later compatible updates use
new GitHub releases. No directory submission or public-release approval is implied
by a successful local build or draft creation.
