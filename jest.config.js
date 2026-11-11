/** Jest config: specs live next to the code in src/ (backend), electron/ (main process), forge/ (packaging) and registry/ (registry CI scripts). */
const path = require('path');

const packageRoot = __dirname;

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: packageRoot,
  roots: ['<rootDir>/src', '<rootDir>/electron', '<rootDir>/forge', '<rootDir>/registry'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'electron/**/*.js',
    'forge/**/*.js',
    // Electron wiring only: covered by the e2e suite, not loadable outside Electron.
    '!electron/main.js',
    '!**/*.spec.(t|j)s',
    '!**/__mocks__/**',
  ],
  coverageDirectory: path.join(packageRoot, 'coverage'),
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', path.join(packageRoot, 'node_modules')],
};
