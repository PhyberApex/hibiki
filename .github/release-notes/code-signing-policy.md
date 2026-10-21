## Code signing policy

Hibiki's builds are currently **unsigned** on every platform. An application to the SignPath Foundation free code signing program was declined on 2026-10-21 because the project does not yet have enough public visibility (stars, forks, contributors, independent coverage). The maintainer will reapply once it does. Until then, this section documents how releases are produced so that a future signing identity can be trusted.

**Team roles.** Hibiki has one maintainer, [@PhyberApex](https://github.com/PhyberApex), who holds every role today:

- **Authors (committers):** [@PhyberApex](https://github.com/PhyberApex). Pull requests from other contributors, including AI-agent-authored ones, are merged only by the maintainer.
- **Reviewers:** [@PhyberApex](https://github.com/PhyberApex) reviews every pull request before it is merged.
- **Approvers:** [@PhyberApex](https://github.com/PhyberApex) approves every signing request.

**Policy.**

- Release binaries are built on GitHub Actions from the tagged release commit, never on a workstation.
- Once signing is in place, every signing request is approved manually by an approver.
- Every team member has multi-factor authentication turned on for GitHub.
- Only Hibiki's own binaries will be signed. Bundled upstream open-source binaries, such as the prebuilt `@snazzah/davey` native module, ship unsigned as their upstream projects publish them.
- What the app contacts over the network is listed in the README's [Privacy](https://github.com/PhyberApex/hibiki#privacy) section.

> **Windows note:** Windows SmartScreen shows "Windows protected your PC" for the unsigned installer. Click **More info**, then **Run anyway**. Once releases are signed, the warning still takes several releases to fade, because SmartScreen trusts a signature only after enough downloads under the same certificate have built up reputation.
