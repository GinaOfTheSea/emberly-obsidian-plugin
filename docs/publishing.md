# Publishing Emberly Maps

The release setup follows Obsidian's current [submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin),
[submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins),
and [developer policies](https://docs.obsidian.md/community-directory/developer-policies).

## Repository and release files

The repository is `GinaOfTheSea/emberly-obsidian-plugin`. Its current default branch
is `main`. Git is already initialized; do not create another
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
4. The release workflow reruns verification and browser checks, generates and verifies
   artifact attestations for all six release files, and creates a
   **draft** containing `main.js`, `manifest.json` and `styles.css` as individual
   attachments. A ZIP alone is insufficient. License/checksum attachments are additional.
5. Review the draft and confirm public repository visibility before publishing.
   The workflow deliberately does not publish it automatically. An existing release
   causes creation to fail rather than silently replacing its files.

## Release artifact attestations

The tag-triggered release workflow signs the exact files from its successful CI
build after checking their SHA-256 checksums: `main.js`, `manifest.json`,
`styles.css`, `LICENSE`, `THIRD_PARTY_NOTICES.md` and `SHA256SUMS.txt`.
GitHub records their digests together with the source commit, tag and workflow
identity as [build provenance attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).
The workflow verifies every file against the generated attestation before creating
the draft; signing or verification failure prevents draft creation.

Signing uses GitHub's short-lived workflow identity, so no manually managed signing
key or additional repository secret is needed. Only the release draft job receives
`id-token: write` and `attestations: write`; ordinary branch and pull-request CI
keeps its read-only permissions. The attestation action is pinned to a release
commit. GitHub stores the attestations and links them in the workflow run summary.

For a release produced with this workflow, download its assets and verify each
installable file with the [GitHub CLI](https://cli.github.com/manual/gh_attestation_verify):

```sh
gh attestation verify main.js --repo GinaOfTheSea/emberly-obsidian-plugin --signer-workflow GinaOfTheSea/emberly-obsidian-plugin/.github/workflows/release.yml
gh attestation verify manifest.json --repo GinaOfTheSea/emberly-obsidian-plugin --signer-workflow GinaOfTheSea/emberly-obsidian-plugin/.github/workflows/release.yml
gh attestation verify styles.css --repo GinaOfTheSea/emberly-obsidian-plugin --signer-workflow GinaOfTheSea/emberly-obsidian-plugin/.github/workflows/release.yml
```

To require a particular release, also pass `--source-ref refs/tags/<version>`;
`--source-digest <commit-sha>` can additionally require its exact source commit.
The same commands work for the license and checksum attachments.

Attestations establish the files' origin and integrity, not that the plugin is free
of vulnerabilities. Existing releases, including the original `0.1.0`, do not gain
attestations by changing this workflow. Ship the change in a new version through
the normal release process; do not move a published tag or replace its assets.
The Community directory controls when its Scorecard reflects a new release.

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
