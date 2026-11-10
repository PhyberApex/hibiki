// Electron Fuses flipped into the packaged binary (#770). Fuses are baked into the
// executable at package time, so they only bind packaged builds: `pnpm dev`, the
// unit tests and the e2e suite run the stock `electron` binary and are unaffected.
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

const fusesConfig = {
  version: FuseVersion.V1,
  // Every fuse on the wire must be set here, so an Electron major that adds a fuse
  // fails packaging until someone decides its value.
  strictlyRequireAllFuses: true,

  // ELECTRON_RUN_AS_NODE=1 would turn hibiki into a general-purpose Node interpreter.
  [FuseV1Options.RunAsNode]: false,
  // NODE_OPTIONS="--require evil.js" would inject code into the main process.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // --inspect / --inspect-brk would open a debugger with full main-process control.
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // Browser tab cookies share session.defaultSession; keep them encrypted on disk.
  // Chromium still reads cookies an earlier unencrypted build wrote.
  [FuseV1Options.EnableCookieEncryption]: true,
  // Refuse an app/ directory swapped in beside or instead of app.asar.
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // Check app.asar against the hash packager records. Only tamper-proof once the
  // build is signed (ADR-0008), since the hash lives in the unsigned binary/Info.plist.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,

  // Electron's defaults, set explicitly because strictlyRequireAllFuses needs them.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  [FuseV1Options.WasmTrapHandlers]: true,
}

module.exports = { fusesConfig }
