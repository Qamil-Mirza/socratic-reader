// Mock chrome.* APIs for testing
import { vi } from 'vitest';

// Storage mock
const mockStorageData: Record<string, unknown> = {};

const mockStorage = {
  sync: {
    get: vi.fn((keys: string | string[] | null) => {
      if (keys === null) {
        return Promise.resolve({ ...mockStorageData });
      }
      if (typeof keys === 'string') {
        return Promise.resolve({ [keys]: mockStorageData[keys] });
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        result[key] = mockStorageData[key];
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((data: Record<string, unknown>) => {
      Object.assign(mockStorageData, data);
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string | string[]) => {
      const keysArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keysArray) {
        delete mockStorageData[key];
      }
      return Promise.resolve();
    }),
    getBytesInUse: vi.fn(() => Promise.resolve(0)),
    QUOTA_BYTES: 102400,
  },
};

// Runtime mock
const mockRuntime = {
  sendMessage: vi.fn(),
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  openOptionsPage: vi.fn(),
  onInstalled: {
    addListener: vi.fn(),
  },
};

// Tabs mock
const mockTabs = {
  query: vi.fn(),
  sendMessage: vi.fn(),
};

// Commands mock
const mockCommands = {
  onCommand: {
    addListener: vi.fn(),
  },
};

// Scripting mock
const mockScripting = {
  executeScript: vi.fn(),
  insertCSS: vi.fn(),
};

// Assemble the chrome mock
const chromeMock = {
  storage: mockStorage,
  runtime: mockRuntime,
  tabs: mockTabs,
  commands: mockCommands,
  scripting: mockScripting,
};

// Set up global
(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

// Export for test access
export {
  mockStorageData,
  mockStorage,
  mockRuntime,
  mockTabs,
  mockCommands,
  mockScripting,
};

// Reset function for tests
export function resetChromeMocks(): void {
  // Clear storage data
  for (const key of Object.keys(mockStorageData)) {
    delete mockStorageData[key];
  }
  
  // Reset all mocks
  vi.clearAllMocks();
}
