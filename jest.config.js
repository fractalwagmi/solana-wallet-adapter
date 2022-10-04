/** @type {import('ts-jest').JestConfigWithTsJest} */

const customJestConfig = {
  // // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  // if using TypeScript with a baseUrl set to the root directory then you need the below for alias' to work
  moduleDirectories: ['node_modules', '<rootDir>/'],
  moduleNameMapper: { '^uuid$': 'uuid' },
  preset: 'ts-jest',
  rootDir: 'src',
  testEnvironment: 'jsdom',
};

export default customJestConfig;
