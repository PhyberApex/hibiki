# 0008. Windows builds are signed through SignPath Foundation; macOS signing is deferred

## Status

Accepted (decided by the maintainer on 2026-10-19 in #545)

## Context

Packaged builds are unsigned. macOS quarantines the app on first launch ("cannot be opened because the developer cannot be verified"), worked around with the `xattr -cr` note in the README Download section and on the docs site. Windows SmartScreen shows "Windows protected your PC" for the Squirrel `Setup.exe`. `forge.config.js` has no `osxSign`, `osxNotarize` or `windowsSign` configuration, and `.github/workflows/build.yml` (called by `release-please.yml` with `upload_release: true`) builds each platform on a GitHub-hosted runner and uploads `out/make/**` straight to the GitHub Release.

Hibiki is maintained by one person in Germany, MIT-licensed, public, and released through release-please tags. Whatever route is chosen must fit that.

### macOS options

The only route to a Gatekeeper-clean app is the **Apple Developer Program** (about $99/year, renewed yearly). It gives a Developer ID Application certificate. Forge's `packagerConfig.osxSign` (`@electron/osx-sign`, hardened runtime plus a new entitlements plist granting `com.apple.security.device.audio-input`; the usage descriptions already in `extendInfo` are Info.plist strings, not entitlements) signs the `.app`. `packagerConfig.osxNotarize` (`@electron/notarize`, App Store Connect API key or Apple ID with an app-specific password) notarizes it. CI would import the certificate into a temporary keychain on the `macos-latest` runner from a base64 `.p12` secret. The DMG maker then wraps an already signed and notarized app, and the DMG itself should be signed and stapled too. The ZIP maker needs nothing extra because it zips the app after the ticket has been stapled to it. A Homebrew cask, if one is ever published, could then drop any `xattr`/`quarantine` workaround.

### Windows options

- **Azure Artifact Signing (formerly Trusted Signing).** About $10/month, but individual identity validation is offered only to residents of the US and Canada, individual onboarding is reported paused, and since the March 2026 intermediate CA rotation users report SmartScreen warnings on every release. A German solo maintainer cannot get in.
- **EV certificate.** Several hundred EUR/year plus a hardware token. EV no longer grants instant SmartScreen reputation, so the price buys nothing Hibiki needs.
- **OV certificate.** Commercial OV certificates cost roughly 200–400 EUR/year and since 2023 must sit on a hardware token or cloud HSM.
- **SignPath Foundation.** Free code signing for OSS projects on SignPath.io with a SignPath Foundation certificate, driven from GitHub Actions. Acceptance is discretionary and cannot be appealed.
- **Certum Open Source Code Signing on SimplySign.** An OV-class certificate for open-source developers, about 49–89 EUR/year with at most 459 days validity, the key in Certum's cloud HSM. SimplySign needs its desktop client and an OTP per session, so it cannot sign unattended in CI.
- **Stay unsigned.**

No Windows route gives instant SmartScreen trust any more. Reputation builds up across downloads of files signed with the same identity, so a stable signing identity across releases is what clears the warning.

## Decision

### macOS: deferred

No Apple Developer Program for now. **Trigger to revisit:** the first Mac user who is not the maintainer asks for a signed build. Until then the `xattr -cr` note in the README and on the docs site (`docs/index.md`, `docs/compare.md`) stays as it is, and no follow-up issue is filed. When the trigger fires, the route is the one in "macOS options" above: `osxSign` + `osxNotarize` in `forge.config.js`, the certificate and notarization credentials as GitHub Actions secrets, and the README note replaced by a plain "the app is signed and notarized".

### Windows: Plan A SignPath Foundation, Plan B Certum Open Source Code Signing

Azure Artifact Signing, EV certificates and staying unsigned are ruled out for the reasons above.

**Plan A: SignPath Foundation.** Hibiki meets its terms: an OSI license for all components, public source, tagged releases, active maintenance, and builds on GitHub-hosted runners (`windows-latest` is already in the `build.yml` matrix). Bundled upstream binaries are allowed unsigned, which covers the prebuilt `@snazzah/davey` `.node` module (unpacked from asar by `forge.config.js`). It requires:

- A **"Code signing policy"** section on the project home page (README) and on the release page. It must carry the attribution "Free code signing provided by SignPath.io, certificate by SignPath Foundation" and name the team roles (Authors, Reviewers, Approvers) with their members.
- A **privacy statement** in the same place, naming what the app contacts: Discord (the bot connection the GM configures), the selected Vision Provider when Vision to Vibe is used (Anthropic, or the configured OpenAI-compatible Base URL), `raw.githubusercontent.com` for the Registry, pages the GM opens in the Browser tab, and the GitHub Releases check if #541 lands. This also answers #541's privacy question.
- **MFA** on GitHub for every team member, and **manual approval** of every signing request in the SignPath web UI.
- Product name and version metadata stay as they are. SignPath enforces them, so `forge.config.js` keeps `Hibiki`/`hibiki` and the version stays release-please's.
- **Two signing requests per release.** Squirrel's `Setup.exe` embeds the nupkg as a PE resource that SignPath cannot open and sign. So in `build.yml`'s Windows job:
  1. `electron-forge package`, upload the packaged directory with `actions/upload-artifact`, submit it with `signpath/github-action-submit-signing-request` (`github-artifact-id`, `wait-for-completion: true`, the wait timeout raised from the 10-minute default to a couple of hours so approval can happen from a phone), and download the signed `hibiki.exe` back over the packaged directory.
  2. `electron-forge make --skip-package` rebuilds the Squirrel installer and ZIP from the signed directory. Upload `Setup.exe`, submit the second signing request, and download the signed `Setup.exe` before the release upload step.

  The `SIGNPATH_API_TOKEN` lives in GitHub Actions secrets. The organization and project IDs and the signing policy slug are plain workflow values. The macOS and Linux matrix legs stay as they are.

**Plan B: Certum Open Source Code Signing.** Only taken if SignPath declines the application. Signing runs on the maintainer's workstation through Forge's `windowsSign` option (`@electron/windows-sign`, set in `packagerConfig` for `hibiki.exe` and in the Squirrel maker config so `Setup.exe` and Squirrel's `Update.exe` are signed too) with the SimplySign client logged in, not unattended in CI. The release flow gains a manual "download the Windows assets, sign, re-upload" step after `build-release`.

### Secrets

Signing credentials (the SignPath API token, or the Certum credentials, and later the Apple certificate and notarization key) live in GitHub Actions secrets. They are consumed only by the release build.

## Costs and yearly upkeep

| Route | Cost | Yearly upkeep |
|---|---|---|
| macOS, Apple Developer Program (deferred) | ~$99/year | Renew the membership; rotate the Developer ID certificate (5-year validity) and its Actions secret before expiry |
| Windows Plan A, SignPath Foundation | Free | Approve every signing request (two per release); keep MFA on for the team; keep the Code signing policy and privacy statement current (any new network contact is a policy change); SignPath may re-review the project |
| Windows Plan B, Certum Open Source | ~49–89 EUR/year | Renew within the 459-day validity, including re-verification as an open-source developer; sign every release by hand on the workstation |

## Follow-up work

Follow-up issues are filed only for Plan A, the route actually taken:

1. README (and release page) **Code signing policy** and **privacy statement** section, plus a Windows note that SmartScreen may still warn on early signed releases. It must exist before the SignPath application.
2. The **SignPath Foundation application** and the SignPath project setup: artifact configurations for the packaged directory and for `Setup.exe`, the signing policy with manual approval, and team MFA. This is maintainer-only work.
3. The **two-stage signing in `build.yml`**'s Windows job, as described above, once the SignPath project exists.

If SignPath declines, those issues are replaced by Plan B issues. macOS gets no issue until its trigger fires.

## Consequences

- Windows users still see SmartScreen for a while after the first signed release, until downloads under the one stable identity build reputation. The README should say so rather than promise a clean install.
- Every Windows release waits on a human approving two signing requests. A release built while nobody approves fails the Windows job once the wait timeout runs out, and the macOS and Linux assets are still uploaded (the matrix uses `fail-fast: false`).
- SignPath reserves the right to require that signed packages contain only signed binaries in the future. If that happens, the unsigned upstream `.node` and Electron/Squirrel binaries would need upstream-signed builds or would push Hibiki to Plan B.
- `hibiki.exe` is Electron's prebuilt binary with Hibiki's resources and metadata stamped in, and `Setup.exe` is Squirrel's stub around Hibiki's package. SignPath's rule that a team signs only artifacts built from its own source is applied by its reviewers to such Electron apps at their discretion. That is one more reason Plan B is kept ready.
- macOS keeps the quarantine workaround until the revisit trigger fires.

## Sources

- [SignPath Foundation terms](https://signpath.org/terms.html)
- [SignPath GitHub Actions integration](https://docs.signpath.io/trusted-build-systems/github)
- [Two-stage SignPath flow worked example (PuriPuly-heart #225)](https://github.com/kapitalismho/PuriPuly-heart/issues/225)
- [Azure Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Individual onboarding paused](https://learn.microsoft.com/en-nz/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident)
- [SmartScreen after the 2026 CA rotation](https://learn.microsoft.com/en-us/answers/questions/5954185/artifact-signing-users-see-smartscreen-on-each-rel)
- [EV certificates no longer grant instant reputation](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Forge Windows code signing](https://www.electronforge.io/guides/code-signing/code-signing-windows)
- [Certum Open Source Code Signing](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)
