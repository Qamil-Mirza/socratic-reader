import {
  Config,
  Provider,
  AnalysisResult,
  Highlight,
  LLMRequest,
  LLMError,
  ConfigError,
  DEFAULT_MODELS,
  ChatMessage,
  ChatResult,
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

// System prompt for multi-turn Socratic chat (exported for use in content script)
export const SOCRATIC_CHAT_SYSTEM_PROMPT = `You are a Socratic tutor guiding a student through a single claim they have highlighted while reading.

Rules:
- Conduct elenchus: expose hidden assumptions, contradictions, and gaps by questioning — never lecture.
- Ask exactly ONE question per turn. Never provide answers or explanations unprompted.
- Ground every question in what the student has actually said or in the highlighted text.
- Do NOT repeat a question that has already been asked.

Response format — return ONLY valid JSON, no surrounding text:
{ "response": "<your single Socratic question or a brief acknowledgement followed by one question>", "aporiaScore": <number 0.0–1.0> }

Aporia score guide (how close the student is to genuine aporia — the productive state of intellectual disorientation):
  0.0–0.2  Surface engagement. Student has not yet examined the claim.
  0.2–0.4  Position forming. Student is articulating a stance but has not been challenged.
  0.4–0.6  Intellectual tension. Student is encountering a difficulty or contradiction.
  0.6–0.8  Contradiction acknowledged. Student recognises a conflict in their thinking.
  0.8–0.95 Near-aporia. Student is struggling productively and approaching genuine uncertainty.
  1.0      TRUE APORIA ONLY. Reserve this score exclusively for when the student explicitly states what they do not know and why. Do not assign 1.0 prematurely.

IMPORTANT: The score must never decrease between turns. If the previous score was X, the new score must be >= X.`;

// Prompt for single-turn question generation from user-selected text
function buildQuestionGenerationPrompt(selectedText: string): string {
  return `A student has highlighted the following passage while reading:

"${selectedText}"

Generate a single Socratic question that will help them think critically about this claim. Also provide a one-sentence explanation of why this question is worth asking.

Return ONLY valid JSON:
{ "question": "<the Socratic question>", "explanation": "<one sentence on why this question matters>" }`;
}

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
 * Extract the text content string from a provider's raw HTTP response.
 * Handles Ollama's two shapes: { response } (generate) and { message: { content } } (chat).
 */
export function extractContent(provider: Provider, response: unknown): string {
  if (provider === 'openai') {
    const r = response as { choices?: Array<{ message?: { content?: string } }> };
    return r.choices?.[0]?.message?.content ?? '';
  } else if (provider === 'gemini') {
    const r = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return r.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } else if (provider === 'ollama') {
    // /api/chat returns { message: { content } }; /api/generate returns { response }
    const r = response as { response?: string; message?: { content?: string } };
    return r.message?.content ?? r.response ?? '';
  }
  throw new LLMError(`Unknown provider: ${provider}`);
}

/**
 * Parse response from any provider into AnalysisResult
 */
export function parseResponse(provider: Provider, response: unknown): AnalysisResult {
  let content: string;
  try {
    content = extractContent(provider, response);
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

// =============================================================================
// Question Generation (single-turn, Feature 2)
// =============================================================================

export function buildOpenAIGenerateQuestionsRequest(selectedText: string, config: Config): LLMRequest {
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
        { role: 'user', content: buildQuestionGenerationPrompt(selectedText) },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    },
  };
}

export function buildGeminiGenerateQuestionsRequest(selectedText: string, config: Config): LLMRequest {
  const baseURL = config.baseURL || PROVIDER_BASE_URLS.gemini;
  const model = config.model || DEFAULT_MODELS.gemini;
  return {
    url: `${baseURL}/models/${model}:generateContent?key=${config.apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      contents: [{ parts: [{ text: buildQuestionGenerationPrompt(selectedText) }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    },
  };
}

export function buildOllamaGenerateQuestionsRequest(selectedText: string, config: Config): LLMRequest {
  let baseURL = config.baseURL || PROVIDER_BASE_URLS.ollama;
  baseURL = baseURL.replace(/\/+$/, '');
  const model = config.model || DEFAULT_MODELS.ollama;
  return {
    url: `${baseURL}/api/generate`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      model,
      prompt: buildQuestionGenerationPrompt(selectedText),
      stream: false,
      format: 'json',
    },
  };
}

export function parseQuestionResponse(provider: Provider, response: unknown): { question: string; explanation: string } {
  const content = extractContent(provider, response);
  if (!content) throw new LLMError('Empty response from LLM');

  const jsonStr = extractJSON(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new LLMError(`Invalid JSON in question response: ${jsonStr.slice(0, 100)}...`);
  }

  const obj = parsed as Record<string, unknown>;
  return {
    question: String(obj.question || ''),
    explanation: String(obj.explanation || ''),
  };
}

export async function generateQuestion(selectedText: string, config: Config): Promise<{ question: string; explanation: string }> {
  if (config.provider !== 'ollama' && !config.apiKey) {
    throw new ConfigError(`API key required for ${config.provider}`);
  }

  let request: LLMRequest;
  switch (config.provider) {
    case 'openai':   request = buildOpenAIGenerateQuestionsRequest(selectedText, config); break;
    case 'gemini':   request = buildGeminiGenerateQuestionsRequest(selectedText, config); break;
    case 'ollama':   request = buildOllamaGenerateQuestionsRequest(selectedText, config); break;
    default:         throw new ConfigError(`Unknown provider: ${config.provider}`);
  }

  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    throw new LLMError(`API error (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }

  const data = await response.json();
  return parseQuestionResponse(config.provider, data);
}

// =============================================================================
// Socratic Chat (multi-turn, Feature 3)
// =============================================================================

export function buildOpenAIChatRequest(history: ChatMessage[], config: Config): LLMRequest {
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
      messages: history,
      temperature: 0.5,
      response_format: { type: 'json_object' },
    },
  };
}

export function buildGeminiChatRequest(history: ChatMessage[], config: Config): LLMRequest {
  const baseURL = config.baseURL || PROVIDER_BASE_URLS.gemini;
  const model = config.model || DEFAULT_MODELS.gemini;

  // Gemini has no 'system' role in contents; prepend system prompt text to first user turn
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  let systemText = '';
  for (const msg of history) {
    if (msg.role === 'system') {
      systemText = msg.content;
      continue;
    }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (contents.length === 0 && role === 'user' && systemText) {
      contents.push({ role, parts: [{ text: systemText + '\n\n' + msg.content }] });
      systemText = '';
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  return {
    url: `${baseURL}/models/${model}:generateContent?key=${config.apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      contents,
      generationConfig: { temperature: 0.5, responseMimeType: 'application/json' },
    },
  };
}

export function buildOllamaChatRequest(history: ChatMessage[], config: Config): LLMRequest {
  let baseURL = config.baseURL || PROVIDER_BASE_URLS.ollama;
  baseURL = baseURL.replace(/\/+$/, '');
  const model = config.model || DEFAULT_MODELS.ollama;
  return {
    url: `${baseURL}/api/chat`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      model,
      messages: history,
      stream: false,
      format: 'json',
    },
  };
}

export function parseChatResponse(provider: Provider, response: unknown): ChatResult {
  const content = extractContent(provider, response);
  if (!content) throw new LLMError('Empty response from LLM');

  const jsonStr = extractJSON(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new LLMError(`Invalid JSON in chat response: ${jsonStr.slice(0, 100)}...`);
  }

  const obj = parsed as Record<string, unknown>;
  const rawScore = typeof obj.aporiaScore === 'number' ? obj.aporiaScore : 0;
  return {
    response: String(obj.response || ''),
    aporiaScore: Math.max(0, Math.min(1, rawScore)), // clamp to [0, 1]
  };
}

export async function callSocraticChat(history: ChatMessage[], _userMessage: string, config: Config): Promise<ChatResult> {
  if (config.provider !== 'ollama' && !config.apiKey) {
    throw new ConfigError(`API key required for ${config.provider}`);
  }

  let request: LLMRequest;
  switch (config.provider) {
    case 'openai':   request = buildOpenAIChatRequest(history, config); break;
    case 'gemini':   request = buildGeminiChatRequest(history, config); break;
    case 'ollama':   request = buildOllamaChatRequest(history, config); break;
    default:         throw new ConfigError(`Unknown provider: ${config.provider}`);
  }

  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    throw new LLMError(`API error (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }

  const data = await response.json();
  return parseChatResponse(config.provider, data);
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
