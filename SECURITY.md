# Security policy

Please report security issues privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a public issue for a security problem.

Official packages are published only from this repository's release workflow (npm trusted publishing, approval required). A Terra package published any other way is not ours.

## What to include

- The package and version (for example `@terrawallet/pay-js@0.1.0`), or the commit.
- What an attacker can do, and the steps or a proof of concept to reproduce it.
- Whether you believe it is being exploited.

We acknowledge reports within 3 working days and keep you updated until a fix ships. Please give us a reasonable
time to release a fix before you publish anything. We credit reporters who want to be credited.

## Supported versions

During early access only the latest published version receives fixes. Upgrade to the latest release first.

## In scope

The packages in this repository (`@terrawallet/connect`, `react`, `elements`, `pay-js`, `server`), their CDN builds,
and this repository's workflows. Issues in the Terra API, the hosted checkout (pay.terrawallet.us), the dashboard or
the Terra Wallet apps can be reported through the same channel; we route them.

## Verify what you install

- npm: every release carries a provenance attestation linking it to a commit and run of this repository's
  `release.yml`. Run `npm audit signatures` in your project.
- CDN: pin the exact version in the URL and use the `integrity` (sha384) and `crossorigin="anonymous"` attributes
  from the package's `dist/cdn/manifest.json`.
- Every package ships a CycloneDX SBOM at `dist/sbom.cdx.json` (and `dist/cdn/sbom.cdx.json` for the CDN bundles).
