/** Jest config: specs live next to the code in src/ (backend) and electron/ (main process). */
const path = require('path');

const packageRoot = __dirname;

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: packageRoot,
  roots: ['<rootDir>/src', '<rootDir>/electron'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'electron/**/*.js',
    // Electron wiring only: covered by the e2e suite, not loadable outside Electron.
    '!electron/main.js',
    '!electron/preload.js',
    '!**/*.spec.(t|j)s',
    '!**/__mocks__/**',
  ],
  coverageDirectory: path.join(packageRoot, 'coverage'),
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', path.join(packageRoot, 'node_modules')],
};
