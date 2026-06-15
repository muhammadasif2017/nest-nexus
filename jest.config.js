/** @type {import('jest').Config} */
module.exports = {
  moduleNameMapper: {
    '^mongodb$': '<rootDir>/../node_modules/mongoose/node_modules/mongodb',
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.spec.json', diagnostics: false }],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
