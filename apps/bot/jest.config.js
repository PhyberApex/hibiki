/** Jest config: rootDir is src; mock @nestjs/config so tests run under pnpm. */
const path = require('path');

const packageRoot = __dirname;
const srcDir = path.join(packageRoot, 'src');
const mockNestConfig = path.join(srcDir, '__mocks__', 'nestjs-config.js');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: srcDir,
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: path.join(packageRoot, 'coverage'),
  testEnvironment: 'node',
  moduleDirectories: ['node_modules', path.join(packageRoot, 'node_modules')],
  moduleNameMapper: {
    '^@nestjs/config$': mockNestConfig,
  },
};
