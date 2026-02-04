import {
  Config,
  Provider,
  AnalysisResult,
  Highlight,
  LLMRequest,
  LLMError,
  ConfigError,
  DEFAULT_MODELS,
} from './types';

// Provider base URLs
const PROVIDER_BASE_URLS: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434',
};

// System prompt for Socratic analysis
const SYSTEM_PROMPT = `You are a Socratic philosophy tutor assisting with reading comprehension. Your task is to help students identify key claims and interrogate them critically.

Follow these rules:
- Use ONLY the provided chunk. NEVER reference or invent text outside it.
- Identify clear statements that express reasoning, claims, or assertions worth examining.
- Your offsets just need to point somewhere inside the target claim — the system will automatically expand the highlight to the full sentence.
- Return only structured JSON as instructed. Do not include any natural language outside the JSON.

Be precise, analytical, and strict.`;

// User prompt template
function buildUserPrompt(chunkText: string): string {
  return `Analyze the following text (about ~500 words). Identify 1-3 key claims/arguments worth interrogating.
Return STRICT JSON with schema:
{ "highlights": [{"start":..., "end":..., "reason":"...", "question":"...", "explanation":"..."}] }
Rules:
- start and end are character offsets (0-indexed) within the provided text. They MUST point to a verbatim substring.
- The system will automatically expand the highlighted span to the full containing sentence, so your offsets just need to land inside the key claim — no need to manually find sentence boundaries.
- Identify 1-3 distinct claims or arguments; do not pick multiple offsets inside the same sentence.
- Keep reason/explanation concise.
- Ensure start < end.

Text:
"""
${chunkText}
"""`;
}

/**
 * Build request for OpenAI API
 */
export function buildOpenAIRequest(text: string, config: Config): LLMRequest {
  const baseURL = config.baseURL || PROVIDER_BASE_URLS.openai;
  const model = config.model || DEFAULT_MODELS.openai;

  return {
    url: `${baseURL}/chat/completions`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(text) },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    },
  };
}

/**
 * Build request for Gemini API
 */
export function buildGeminiRequest(text: string, config: Config): LLMRequest {
  const baseURL = config.baseURL || PROVIDER_BASE_URLS.gemini;
  const model = config.model || DEFAULT_MODELS.gemini;

  return {
    url: `${baseURL}/models/${model}:generateContent?key=${config.apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      contents: [
        {
          parts: [
            {
              text: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(text)}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    },
  };
}

/**
 * Build request for Ollama API
 */
export function buildOllamaRequest(text: string, config: Config): LLMRequest {
  let baseURL = config.baseURL || PROVIDER_BASE_URLS.ollama;
  // Remove trailing slash to avoid double slashes
  baseURL = baseURL.replace(/\/+$/, '');
  const model = config.model || DEFAULT_MODELS.ollama;

  return {
    url: `${baseURL}/api/generate`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      model,
      prompt: `${SYSTEM_PROMPT}\n\n${buildUserPrompt(text)}`,
      stream: false,
      format: 'json',
    },
  };
}

/**
 * Extract JSON content from response, handling markdown code blocks
 */
function extractJSON(content: string): string {
  // Remove markdown code blocks if present
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return content.trim();
}

/**
 * Validate highlight schema
 */
function validateHighlight(h: unknown, index: number): Highlight {
  if (typeof h !== 'object' || h === null) {
    throw new LLMError(`Highlight ${index} is not an object`);
  }

  const obj = h as Record<string, unknown>;

  if (typeof obj.start !== 'number' || typeof obj.end !== 'number') {
    throw new LLMError(`Highlight ${index} has invalid offset types`);
  }

  if (obj.start >= obj.end) {
    throw new LLMError(`Highlight ${index} has invalid offset range: start (${obj.start}) >= end (${obj.end})`);
  }

  if (obj.start < 0) {
    throw new LLMError(`Highlight ${index} has negative start offset`);
  }

  return {
    start: obj.start,
    end: obj.end,
    reason: String(obj.reason || ''),
    question: String(obj.question || ''),
    explanation: String(obj.explanation || ''),
  };
}

/**
 * Parse response from any provider into AnalysisResult
 */
export function parseResponse(provider: Provider, response: unknown): AnalysisResult {
  let content: string;

  try {
    if (provider === 'openai') {
      const r = response as { choices?: Array<{ message?: { content?: string } }> };
      content = r.choices?.[0]?.message?.content ?? '';
    } else if (provider === 'gemini') {
      const r = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      content = r.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else if (provider === 'ollama') {
      const r = response as { response?: string };
      content = r.response ?? '';
    } else {
      throw new LLMError(`Unknown provider: ${provider}`);
    }
  } catch (e) {
    throw new LLMError(`Failed to extract content from ${provider} response: ${e}`);
  }

  if (!content) {
    throw new LLMError('Empty response from LLM');
  }

  // Parse JSON
  const jsonStr = extractJSON(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new LLMError(`Invalid JSON in response: ${jsonStr.slice(0, 100)}...`);
  }

  // Validate structure
  if (typeof parsed !== 'object' || parsed === null) {
    throw new LLMError('Response is not an object');
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.highlights)) {
    throw new LLMError('Response missing highlights array');
  }

  // Validate and map highlights
  const highlights = obj.highlights.map((h, i) => validateHighlight(h, i));

  return { highlights };
}

/**
 * Call LLM with retry logic
 */
export async function callLLM(text: string, config: Config): Promise<AnalysisResult> {
  // Validate config
  if (config.provider !== 'ollama' && !config.apiKey) {
    throw new ConfigError(`API key required for ${config.provider}`);
  }

  // Build request
  let request: LLMRequest;
  switch (config.provider) {
    case 'openai':
      request = buildOpenAIRequest(text, config);
      break;
    case 'gemini':
      request = buildGeminiRequest(text, config);
      break;
    case 'ollama':
      request = buildOllamaRequest(text, config);
      break;
    default:
      throw new ConfigError(`Unknown provider: ${config.provider}`);
  }

  // Make request with retry
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        // Check for rate limiting
        if (response.status === 429) {
          throw new LLMError('Rate limited. Please wait and try again.', true);
        }

        // Check for auth errors
        if (response.status === 401 || response.status === 403) {
          if (config.provider === 'ollama') {
            // 403 from Ollama usually means CORS is blocking the request
            // Chrome extensions need OLLAMA_ORIGINS="*" or OLLAMA_ORIGINS="chrome-extension://*"
            throw new LLMError(
              `Ollama error (${response.status}): CORS blocked. ` +
              `Run Ollama with: OLLAMA_ORIGINS="*" ollama serve`
            );
          }
          throw new LLMError('Authentication failed. Check your API key in options.');
        }

        // Model not found (common Ollama error)
        if (response.status === 404) {
          if (config.provider === 'ollama') {
            throw new LLMError(`Model not found. Run: ollama pull ${config.model || 'llama3.2'}`);
          }
          throw new LLMError(`API error (404): Endpoint or model not found`);
        }

        throw new LLMError(`API error (${response.status}): ${errorText.slice(0, 200)}`, response.status >= 500);
      }

      const data = await response.json();
      return parseResponse(config.provider, data);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // Don't retry non-retryable errors
      if (e instanceof LLMError && !e.retryable) {
        throw e;
      }
      if (e instanceof ConfigError) {
        throw e;
      }

      // Check for network errors (Ollama not running)
      if (e instanceof TypeError && e.message.includes('fetch')) {
        if (config.provider === 'ollama') {
          throw new LLMError(
            'Cannot connect to Ollama. Make sure Ollama is running: ollama serve'
          );
        }
        throw new LLMError(`Network error: ${e.message}`);
      }

      // Retry on other errors
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }
  }

  throw lastError ?? new LLMError('Unknown error calling LLM');
}

/**
 * Test connection to LLM provider
 */
export async function testConnection(config: Config): Promise<{ success: boolean; error?: string }> {
  try {
    // Use a minimal test prompt
    const testText = 'The unexamined life is not worth living.';
    await callLLM(testText, config);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
