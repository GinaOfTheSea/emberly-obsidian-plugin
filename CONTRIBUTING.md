# Contributing

Emberly Maps keeps mind maps and their notes in an Obsidian vault. Changes should
preserve those files and keep the map's appearance and interactions consistent.

For a bug report, include your Obsidian version, operating system, what you did,
and what happened. A small example vault or screenshot helps when it shows the
problem. Remove private notes and personal information before sharing it.

For code changes, use the Node version in `.nvmrc`, then run:

```sh
npm ci
npm run verify
```

Run `npm run test:browser` for renderer or panel changes, and check the affected
flow in a separate Obsidian test vault. Keep generated bundles, test vaults, and
private data out of commits. Describe the change and the checks you ran in the
pull request, including anything you could not test.

The [development notes](docs/development.md) cover setup and testing. The
[folder guide](docs/repository-structure.md) explains where code belongs.
Follow [Obsidian's plugin requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
where they fit the project. For larger changes, open an issue first to explain
the problem and proposed approach.

Contributions use the project's [AGPL-3.0-only license](LICENSE).
