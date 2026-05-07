// Vitest setup file for global test configuration
import { vi } from 'vitest';

// Mock console methods to reduce noise in test output
// (can be overridden in individual tests if needed)
global.console = {
  ...console,
  info: vi.fn(),
  warn: vi.fn(),
  // Keep error and log for debugging
  error: console.error,
  log: console.log,
};
