const fs = require('node:fs')
const path = require('node:path')

module.exports = {
  hooks: {
    // @discordjs/opus uses @discordjs/node-pre-gyp which resolves to
    // "electron-v{version}-napi-v3-{platform}-{arch}" in Electron runtime,
    // but only "node-v{abi}-napi-v3-{platform}-{arch}" prebuilds ship.
    // Since opus.node is an N-API module (ABI-stable), the node prebuild works
    // fine in Electron. We copy it under the electron name so it's found at runtime.
    packageAfterPrune: async (_config, buildPath) => {
      const prebuildDir = path.join(buildPath, 'node_modules', '@discordjs', 'opus', 'prebuild')
      if (!fs.existsSync(prebuildDir))
        return
      const dirs = fs.readdirSync(prebuildDir)
      const nodeDir = dirs.find(d => d.startsWith('node-'))
      if (!nodeDir)
        return
      // Already has an electron prebuild — nothing to do
      if (dirs.some(d => d.startsWith('electron-')))
        return
      // Derive electron dir name: replace "node-v{abi}" with "electron-v{major.minor}"
      const electronVersion = require('electron/package.json').version
      const electronMinor = electronVersion.split('.').slice(0, 2).join('.')
      const suffix = nodeDir.replace(/^node-v\d+/, '')
      const electronDirName = `electron-v${electronMinor}${suffix}`
      const src = path.join(prebuildDir, nodeDir)
      const dst = path.join(prebuildDir, electronDirName)
      fs.cpSync(src, dst, { recursive: true })
      console.log(`[forge hook] Copied opus prebuild: ${nodeDir} -> ${electronDirName}`)
    },
  },
  packagerConfig: {
    name: 'Hibiki',
    executableName: 'hibiki',
    appBundleId: 'com.phyberapex.hibiki',
    icon: path.join(__dirname, 'frontend', 'public', 'logo'),
    out: path.join(__dirname, 'out'),

    // Critical: Unpack native modules for Discord audio codec
    asar: {
      unpack: '**/*.node',
    },

    // Use prebuilt binaries (don't rebuild from source)
    prune: true,

    // Include all necessary files
    ignore: [
      /^\/src/, // Source TypeScript (compiled to dist/)
      /^\/frontend\/src/, // Frontend source (built to web-dist/)
      /^\/e2e/, // E2E tests
      /^\/docs/, // Documentation
      /^\/release/, // Old electron-builder output
      /^\/out/, // Forge output (don't recurse)
      /^\/\.git/, // Git directory
      /^\/\.pnpm-store/, // pnpm content-addressable store
      /\.map$/, // Source maps (production)
      /tsconfig/, // TS configs
      /vite\.config/, // Vite config
      /jest\.config/, // Jest config
      /\.spec\./, // Test files
      /\.test\./, // Test files
    ],
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
}
