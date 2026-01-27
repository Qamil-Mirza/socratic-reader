// LLM Provider types
export type Provider = 'openai' | 'gemini' | 'ollama';

// Configuration stored in chrome.storage.sync
export interface Config {
  provider: Provider;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

// Default configuration
export const DEFAULT_CONFIG: Config = {
  provider: 'openai',
};

// Default models per provider
export const DEFAULT_MODELS: Record<Provider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  ollama: 'llama3.2',
};

// Highlight returned by LLM
export interface Highlight {
  start: number;
  end: number;
  reason: string;
  question: string;
  explanation: string;
}

// Analysis result from LLM
export interface AnalysisResult {
  highlights: Highlight[];
}

// Saved note for a highlight
export interface SavedNote {
  highlightId: string;
  url: string;
  start: number;
  end: number;
  text: string; // Short snippet for reference (not full page text)
  note: string;
  createdAt: number;
}

// Node range for DOM offset mapping
export interface NodeRange {
  node: Text;
  start: number;
  end: number;
  globalOffset: number;
}

// Text chunk with DOM mapping info
export interface TextChunk {
  text: string;
  nodeRanges: NodeRange[];
  globalOffset: number;
}

// Processed highlight with DOM info and ID
export interface ProcessedHighlight extends Highlight {
  id: string;
  text: string;
  range: Range | null;
  chunkIndex: number;
}

// Messages between content script and background
export interface AnalyzeChunkMessage {
  action: 'ANALYZE_CHUNK';
  chunkText: string;
  chunkIndex: number;
  url: string;
}

export interface AnalyzeChunkResponse {
  highlights?: Highlight[];
  error?: string;
}

export interface ToggleOverlayMessage {
  action: 'TOGGLE_OVERLAY';
}

export interface TestConnectionMessage {
  action: 'TEST_CONNECTION';
  config: Config;
}

export interface TestConnectionResponse {
  success: boolean;
  error?: string;
}

export type Message = AnalyzeChunkMessage | ToggleOverlayMessage | TestConnectionMessage;

// Overlay states
export type OverlayState = 'IDLE' | 'EXTRACTING' | 'ANALYZING' | 'DISPLAYING' | 'ERROR';

// LLM request/response helpers
export interface LLMRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: unknown;
}

// Error types
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
