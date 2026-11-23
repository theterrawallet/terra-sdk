# Contributing

Thank you for your interest in the Terra Wallet SDK.

## Who can contribute

This repository is maintained by the Terra Wallet team. During early access, **pull requests are accepted from
maintainers only**. Everyone is welcome to open an issue for a bug, a documentation problem or a feature request.
Security problems go through private reporting, never an issue: see [SECURITY.md](./SECURITY.md).

## How changes land

Every change, including a maintainer's, lands through a pull request:

1. Branch from `main`.
2. Make the change with tests. Every fix comes with a test that fails without it.
3. Run the checks below locally; CI runs the same ones.
4. Open the pull request. A code owner reviews it, CI must be green, then it is merged.

Nobody pushes to `main` directly, and nobody publishes from a personal machine.

## Checks

```bash
corepack enable                   # pnpm from package.json (packageManager)
pnpm install --frozen-lockfile    # Node.js 22 or newer
pnpm build
pnpm typecheck
pnpm test
pnpm size                         # @terrawallet/connect core: at most 15 KB gzipped
pnpm sbom && pnpm pack:check      # what npm would receive: dist only, no maps, no tests, no internal paths
```

## Rules

- **Dependencies:** exact versions only, and the lockfile is committed. A new runtime dependency needs a strong reason
  and a review of its full tree. Dependency install scripts never run: `strictDepBuilds` makes the install fail if a
  dependency adds one.
- **Browser code:** no `eval`, no `new Function`, no `innerHTML` or other HTML sinks, no remote code. Build DOM with
  `createElement` and `textContent`. Validate every attribute and URL; only `https:` and `terrawallet:` links.
- **Keys:** browser packages take publishable keys only. Never log keys, request bodies or webhook payloads.
- **Writing:** plain, short sentences. No em dashes. The company and product name is "Terra Wallet".
- **Versions:** all packages share one version. Maintainers bump it in every `package.json`, add a `CHANGELOG.md`
  entry, merge, then push a `vX.Y.Z` tag. The release workflow checks that the tag matches, and the owner approves
  the publish.

## License

By contributing you agree that your contribution is licensed under the [Apache License 2.0](./LICENSE).
