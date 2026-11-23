# Owner setup on npmjs.com (one time)

Do this once for each of the five packages before pushing the first `v*` tag. It lets this repository's
`release.yml` publish through npm trusted publishing (OIDC), with no npm token anywhere.

Packages (all owned by the npm user `terrawallet`, reserved at 0.0.0):

- `@terrawallet/connect`
- `@terrawallet/server`
- `@terrawallet/pay-js`
- `@terrawallet/elements`
- `@terrawallet/react`

## For each package

1. Sign in to https://www.npmjs.com as `terrawallet` (with 2FA) and open
   `https://www.npmjs.com/package/@terrawallet/<name>/access` (the package's **Settings** tab).
2. **Trusted Publisher**: choose **GitHub Actions** and enter exactly:
   - Organization or user: `theterrawallet`
   - Repository: `terra-sdk`
   - Workflow filename: `release.yml`
   - Environment name: `npm-release`

   Save.
3. **Publishing access**: select **Require two-factor authentication and disallow tokens**. Save. Trusted
   publishing keeps working; tokens (classic or granular) can no longer publish.

## Account checks

- The `terrawallet` npm account has 2FA enabled (security key or authenticator app).
- No automation or publish tokens exist for the account (Access Tokens page): delete any that do.

## GitHub checks (already in place, confirm)

- Environment `npm-release`: required reviewer `theterrawallet`, deployment limited to tags matching `v*`.
- Private vulnerability reporting is on.
- Recommended: protect `main` (require a pull request, a code owner review and the CI checks) and add a tag ruleset
  so only maintainers can create `v*` tags.

## Releasing

1. Merge the version bump (every `packages/*/package.json` and `CHANGELOG.md`) into `main`.
2. Push the tag, for example `git tag v0.1.0 && git push origin v0.1.0`.
3. Approve the `npm-release` deployment in the Actions run. The workflow checks the tag against every package
   version, builds, tests, packs, and publishes connect, server, pay-js, elements, react in that order with
   provenance.
4. Check each package page on npmjs.com shows the provenance badge, and run `npm audit signatures` in a project that
   installs them.
