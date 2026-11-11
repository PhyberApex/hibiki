const path = require('node:path')
const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { assertNoStrayAppFiles, ignoreAppFile } = require('./forge/app-files')
const { fusesConfig } = require('./forge/fuses')

module.exports = {
  packagerConfig: {
    name: 'Hibiki',
    executableName: 'hibiki',
    appBundleId: 'com.phyberapex.hibiki',
    icon: path.join(__dirname, 'frontend', 'public', 'logo'),
    out: path.join(__dirname, 'out'),

    // Critical: Unpack native modules (e.g. @snazzah/davey, Discord's DAVE
    // E2EE voice encryption) so they load from disk instead of inside asar.
    asar: {
      unpack: '**/*.node',
    },

    // Use prebuilt binaries (don't rebuild from source)
    prune: true,

    // macOS: required for audio capture (Routed Tabs)
    extendInfo: {
      NSMicrophoneUsageDescription: 'Hibiki needs microphone access to capture audio for Discord streaming.',
      NSAudioCaptureUsageDescription: 'Hibiki needs audio capture access to stream audio to Discord voice channels.',
    },

    // Allowlist of what ships in app.asar (#764): a local .env must never be packaged.
    ignore: ignoreAppFile,
    afterCopy: [assertNoStrayAppFiles],
  },

  makers: [
    // ZIP maker - portable archives for all platforms (user preference)
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },

    // DMG maker - macOS disk images (standard UX)
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO', // Compressed read-only
        name: 'Hibiki',
        icon: path.join(__dirname, 'frontend', 'public', 'logo.icns'),
      },
    },

    // Squirrel maker - Windows installer (lightweight, auto-updates)
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'hibiki',
        authors: 'PhyberApex',
        description: 'Discord audio companion for D&D and TTRPG',
        setupIcon: path.join(__dirname, 'frontend', 'public', 'logo.ico'),
      },
    },

    // DEB maker - Debian/Ubuntu packages
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'hibiki',
          productName: 'Hibiki',
          genericName: 'Discord Audio Bot',
          description: 'Play music, ambience, and sound effects in Discord voice channels',
          categories: ['Audio', 'Music'],
          icon: path.join(__dirname, 'frontend', 'public', 'logo.png'),
          homepage: 'https://github.com/phyberapex/hibiki',
          maintainer: 'PhyberApex',
        },
      },
    },
  ],

  // Electron Fuses (#770), reasons in forge/fuses.js.
  plugins: [
    new FusesPlugin(fusesConfig),
  ],
}
