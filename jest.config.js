/** Jest config: rootDir is src. */
const path = require('path');

const packageRoot = __dirname;
const srcDir = path.join(packageRoot, 'src');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: srcDir,
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.(t|j)s',
    '!**/__mocks__/**',
  ],
  coverageDirectory: path.join(packageRoot, 'coverage'),
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', path.join(packageRoot, 'node_modules')],
};
