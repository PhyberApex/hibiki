## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Windows builds are being moved to signing through SignPath Foundation. Until the first signed release ships, the Windows builds on this page are unsigned. macOS builds are not signed (see the [macOS note](https://github.com/PhyberApex/hibiki#download)).

**Team roles.** Hibiki has one maintainer, [@PhyberApex](https://github.com/PhyberApex), who holds every role today:

- **Authors (committers):** [@PhyberApex](https://github.com/PhyberApex). Pull requests from other contributors, including AI-agent-authored ones, are merged only by the maintainer.
- **Reviewers:** [@PhyberApex](https://github.com/PhyberApex) reviews every pull request before it is merged.
- **Approvers:** [@PhyberApex](https://github.com/PhyberApex) approves every signing request.

**Policy.**

- Release binaries are built on GitHub Actions from the tagged release commit, never on a workstation.
- Every signing request is approved manually in SignPath by an approver.
- Only Hibiki's own binaries are signed. Bundled upstream open-source binaries, such as the prebuilt `@snazzah/davey` native module, ship unsigned as their upstream projects publish them, as SignPath's terms allow.
- What the app contacts over the network is listed in the README's [Privacy](https://github.com/PhyberApex/hibiki#privacy) section.

> **Windows note:** Windows SmartScreen may still show "Windows protected your PC" for the first signed releases. SmartScreen trusts a signature only once enough downloads under the same certificate have built up reputation, so the warning fades over several releases rather than disappearing with the first one.
