const path = require('node:path')

module.exports = {
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

    // DMG maker - macOS disk images (standard UX) - Temporarily disabled due to native module build issues
    // {
    //   name: '@electron-forge/maker-dmg',
    //   config: {
    //     format: 'ULFO', // Compressed read-only
    //     name: 'Hibiki',
    //     icon: path.join(__dirname, 'frontend', 'public', 'logo.png')
    //   }
    // },

    // Squirrel maker - Windows installer (lightweight, auto-updates)
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'hibiki',
        authors: 'PhyberApex',
        description: 'Discord audio companion for D&D and TTRPG',
        // Note: setupIcon requires .ico file - can be added later if needed
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
