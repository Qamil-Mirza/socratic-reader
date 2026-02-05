import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildOpenAIRequest,
  buildGeminiRequest,
  buildOllamaRequest,
  parseResponse,
  extractContent,
  buildOpenAIGenerateQuestionsRequest,
  buildGeminiGenerateQuestionsRequest,
  buildOllamaGenerateQuestionsRequest,
  parseQuestionResponse,
  buildOpenAIChatRequest,
  buildGeminiChatRequest,
  buildOllamaChatRequest,
  parseChatResponse,
  SOCRATIC_CHAT_SYSTEM_PROMPT,
} from '../shared/llm';
import type { Config, ChatMessage } from '../shared/types';

describe('LLM Provider Request Builders', () => {
  describe('buildOpenAIRequest', () => {
    it('includes system and user messages with correct format', () => {
      const config: Config = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' };
      const request = buildOpenAIRequest('Sample text', config);
      
      const body = request.body as { messages: Array<{ role: string; content: string }> };
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toContain('Sample text');
    });

    it('uses provided model', () => {
      const config: Config = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' };
      const request = buildOpenAIRequest('text', config);
      
      const body = request.body as { model: string };
      expect(body.model).toBe('gpt-4');
    });

    it('uses default model when not specified', () => {
      const config: Config = { provider: 'openai', apiKey: 'sk-test' };
      const request = buildOpenAIRequest('text', config);
      
      const body = request.body as { model: string };
      expect(body.model).toBe('gpt-4o-mini');
    });

    it('includes Authorization header with Bearer token', () => {
      const config: Config = { provider: 'openai', apiKey: 'sk-test-key' };
      const request = buildOpenAIRequest('text', config);
      
      expect(request.headers['Authorization']).toBe('Bearer sk-test-key');
    });

    it('uses default base URL', () => {
      const config: Config = { provider: 'openai', apiKey: 'sk-test' };
      const request = buildOpenAIRequest('text', config);
      
      expect(request.url).toContain('api.openai.com');
    });

    it('respects custom base URL', () => {
      const config: Config = { provider: 'openai', apiKey: 'sk-test', baseURL: 'https://custom.api.com' };
      const request = buildOpenAIRequest('text', config);
      
      expect(request.url).toContain('custom.api.com');
    });
  });

  describe('buildGeminiRequest', () => {
    it('uses API key as query parameter', () => {
      const config: Config = { provider: 'gemini', apiKey: 'gem-key' };
      const request = buildGeminiRequest('text', config);
      
      expect(request.url).toContain('key=gem-key');
    });

    it('formats content in Gemini structure', () => {
      const config: Config = { provider: 'gemini', apiKey: 'gem-key' };
      const request = buildGeminiRequest('text', config);
      
      const body = request.body as { contents: Array<{ parts: Array<{ text: string }> }> };
      expect(body.contents).toBeDefined();
      expect(body.contents[0].parts).toBeDefined();
      expect(body.contents[0].parts[0].text).toContain('text');
    });

    it('uses default model when not specified', () => {
      const config: Config = { provider: 'gemini', apiKey: 'gem-key' };
      const request = buildGeminiRequest('text', config);
      
      expect(request.url).toContain('gemini-1.5-flash');
    });

    it('uses provided model', () => {
      const config: Config = { provider: 'gemini', apiKey: 'gem-key', model: 'gemini-pro' };
      const request = buildGeminiRequest('text', config);
      
      expect(request.url).toContain('gemini-pro');
    });
  });

  describe('buildOllamaRequest', () => {
    it('uses localhost endpoint by default', () => {
      const config: Config = { provider: 'ollama' };
      const request = buildOllamaRequest('text', config);
      
      expect(request.url).toContain('localhost:11434');
    });

    it('respects baseURL override', () => {
      const config: Config = { provider: 'ollama', baseURL: 'http://192.168.1.100:11434' };
      const request = buildOllamaRequest('text', config);
      
      expect(request.url).toContain('192.168.1.100');
    });

    it('uses default model', () => {
      const config: Config = { provider: 'ollama' };
      const request = buildOllamaRequest('text', config);
      
      const body = request.body as { model: string };
      expect(body.model).toBe('llama3.2');
    });

    it('sets stream to false', () => {
      const config: Config = { provider: 'ollama' };
      const request = buildOllamaRequest('text', config);
      
      const body = request.body as { stream: boolean };
      expect(body.stream).toBe(false);
    });
  });
});

describe('parseResponse', () => {
  describe('OpenAI responses', () => {
    it('extracts highlights from OpenAI response', () => {
      const response = {
        choices: [{
          message: {
            content: JSON.stringify({
              highlights: [{
                start: 0,
                end: 10,
                reason: 'test reason',
                question: 'Test question?',
                explanation: 'Test explanation',
              }],
            }),
          },
        }],
      };
      
      const result = parseResponse('openai', response);
      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].start).toBe(0);
      expect(result.highlights[0].end).toBe(10);
      expect(result.highlights[0].reason).toBe('test reason');
    });

    it('handles JSON wrapped in markdown code blocks', () => {
      const response = {
        choices: [{
          message: {
            content: '```json\n{"highlights":[]}\n```',
          },
        }],
      };
      
      const result = parseResponse('openai', response);
      expect(result.highlights).toEqual([]);
    });

    it('handles multiple highlights', () => {
      const response = {
        choices: [{
          message: {
            content: JSON.stringify({
              highlights: [
                { start: 0, end: 10, reason: 'a', question: 'b', explanation: 'c' },
                { start: 20, end: 30, reason: 'd', question: 'e', explanation: 'f' },
              ],
            }),
          },
        }],
      };
      
      const result = parseResponse('openai', response);
      expect(result.highlights).toHaveLength(2);
    });
  });

  describe('Gemini responses', () => {
    it('extracts highlights from Gemini response', () => {
      const response = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                highlights: [{
                  start: 5,
                  end: 15,
                  reason: 'gemini reason',
                  question: 'Gemini question?',
                  explanation: 'Gemini explanation',
                }],
              }),
            }],
          },
        }],
      };
      
      const result = parseResponse('gemini', response);
      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].start).toBe(5);
    });
  });

  describe('Ollama responses', () => {
    it('extracts highlights from Ollama response', () => {
      const response = {
        response: JSON.stringify({
          highlights: [{
            start: 10,
            end: 20,
            reason: 'ollama reason',
            question: 'Ollama question?',
            explanation: 'Ollama explanation',
          }],
        }),
      };
      
      const result = parseResponse('ollama', response);
      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].start).toBe(10);
    });
  });

  describe('error handling', () => {
    it('throws on invalid JSON', () => {
      const response = {
        choices: [{ message: { content: 'not valid json' } }],
      };
      
      expect(() => parseResponse('openai', response)).toThrow();
    });

    it('throws on empty content', () => {
      const response = {
        choices: [{ message: { content: '' } }],
      };
      
      expect(() => parseResponse('openai', response)).toThrow(/Empty response/);
    });

    it('throws on missing highlights array', () => {
      const response = {
        choices: [{ message: { content: '{"other": "data"}' } }],
      };
      
      expect(() => parseResponse('openai', response)).toThrow(/missing highlights/);
    });

    it('throws when start >= end', () => {
      const response = {
        choices: [{
          message: {
            content: JSON.stringify({
              highlights: [{ start: 10, end: 5, reason: '', question: '', explanation: '' }],
            }),
          },
        }],
      };
      
      expect(() => parseResponse('openai', response)).toThrow(/invalid offset/i);
    });

    it('throws on negative start offset', () => {
      const response = {
        choices: [{
          message: {
            content: JSON.stringify({
              highlights: [{ start: -1, end: 5, reason: '', question: '', explanation: '' }],
            }),
          },
        }],
      };

      expect(() => parseResponse('openai', response)).toThrow(/negative/i);
    });
  });
});

// =============================================================================
// extractContent
// =============================================================================

describe('extractContent', () => {
  it('extracts content from OpenAI response', () => {
    const response = { choices: [{ message: { content: 'hello' } }] };
    expect(extractContent('openai', response)).toBe('hello');
  });

  it('extracts content from Gemini response', () => {
    const response = { candidates: [{ content: { parts: [{ text: 'gemini text' }] } }] };
    expect(extractContent('gemini', response)).toBe('gemini text');
  });

  it('extracts content from Ollama /api/generate response shape', () => {
    const response = { response: 'generate text' };
    expect(extractContent('ollama', response)).toBe('generate text');
  });

  it('extracts content from Ollama /api/chat response shape', () => {
    const response = { message: { content: 'chat text' } };
    expect(extractContent('ollama', response)).toBe('chat text');
  });

  it('Ollama chat shape takes priority over generate shape when both present', () => {
    const response = { message: { content: 'from chat' }, response: 'from generate' };
    expect(extractContent('ollama', response)).toBe('from chat');
  });

  it('returns empty string for missing content fields', () => {
    expect(extractContent('openai', {})).toBe('');
    expect(extractContent('gemini', {})).toBe('');
    expect(extractContent('ollama', {})).toBe('');
  });

  it('throws on unknown provider', () => {
    expect(() => extractContent('unknown' as any, {})).toThrow(/Unknown provider/);
  });
});

// =============================================================================
// Question Generation builders + parser
// =============================================================================

describe('buildOpenAIGenerateQuestionsRequest', () => {
  it('targets /chat/completions', () => {
    const config: Config = { provider: 'openai', apiKey: 'sk-test' };
    const req = buildOpenAIGenerateQuestionsRequest('some text', config);
    expect(req.url).toContain('/chat/completions');
  });

  it('includes the selected text in the user message', () => {
    const config: Config = { provider: 'openai', apiKey: 'sk-test' };
    const req = buildOpenAIGenerateQuestionsRequest('my passage', config);
    const body = req.body as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toContain('my passage');
  });

  it('requests JSON response format', () => {
    const config: Config = { provider: 'openai', apiKey: 'sk-test' };
    const req = buildOpenAIGenerateQuestionsRequest('text', config);
    const body = req.body as { response_format: { type: string } };
    expect(body.response_format.type).toBe('json_object');
  });
});

describe('buildGeminiGenerateQuestionsRequest', () => {
  it('targets generateContent endpoint', () => {
    const config: Config = { provider: 'gemini', apiKey: 'gem-key' };
    const req = buildGeminiGenerateQuestionsRequest('text', config);
    expect(req.url).toContain(':generateContent');
  });

  it('includes selected text in parts', () => {
    const config: Config = { provider: 'gemini', apiKey: 'gem-key' };
    const req = buildGeminiGenerateQuestionsRequest('highlight passage', config);
    const body = req.body as { contents: Array<{ parts: Array<{ text: string }> }> };
    expect(body.contents[0].parts[0].text).toContain('highlight passage');
  });
});

describe('buildOllamaGenerateQuestionsRequest', () => {
  it('uses /api/generate (single-turn)', () => {
    const config: Config = { provider: 'ollama' };
    const req = buildOllamaGenerateQuestionsRequest('text', config);
    expect(req.url).toContain('/api/generate');
    expect(req.url).not.toContain('/api/chat');
  });

  it('includes selected text in prompt', () => {
    const config: Config = { provider: 'ollama' };
    const req = buildOllamaGenerateQuestionsRequest('my selected text', config);
    const body = req.body as { prompt: string };
    expect(body.prompt).toContain('my selected text');
  });
});

describe('parseQuestionResponse', () => {
  it('extracts question and explanation from OpenAI response', () => {
    const response = {
      choices: [{ message: { content: JSON.stringify({ question: 'Why?', explanation: 'Because.' }) } }],
    };
    const result = parseQuestionResponse('openai', response);
    expect(result.question).toBe('Why?');
    expect(result.explanation).toBe('Because.');
  });

  it('extracts from Ollama response', () => {
    const response = {
      response: JSON.stringify({ question: 'How?', explanation: 'Reason.' }),
    };
    const result = parseQuestionResponse('ollama', response);
    expect(result.question).toBe('How?');
    expect(result.explanation).toBe('Reason.');
  });

  it('returns empty strings for missing fields', () => {
    const response = {
      choices: [{ message: { content: '{}' } }],
    };
    const result = parseQuestionResponse('openai', response);
    expect(result.question).toBe('');
    expect(result.explanation).toBe('');
  });

  it('throws on empty response', () => {
    const response = { choices: [{ message: { content: '' } }] };
    expect(() => parseQuestionResponse('openai', response)).toThrow(/Empty response/);
  });

  it('throws on invalid JSON', () => {
    const response = { choices: [{ message: { content: 'not json at all' } }] };
    expect(() => parseQuestionResponse('openai', response)).toThrow(/Invalid JSON/);
  });
});

// =============================================================================
// Chat builders + parser
// =============================================================================

describe('buildOpenAIChatRequest', () => {
  const history: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' },
  ];

  it('targets /chat/completions', () => {
    const config: Config = { provider: 'openai', apiKey: 'sk-x' };
    const req = buildOpenAIChatRequest(history, config);
    expect(req.url).toContain('/chat/completions');
  });

  it('passes full history as messages', () => {
    const config: Config = { provider: 'openai', apiKey: 'sk-x' };
    const req = buildOpenAIChatRequest(history, config);
    const body = req.body as { messages: ChatMessage[] };
    expect(body.messages).toEqual(history);
  });

  it('requests JSON response format', () => {
    const config: Config = { provider: 'openai', apiKey: 'sk-x' };
    const req = buildOpenAIChatRequest(history, config);
    const body = req.body as { response_format: { type: string } };
    expect(body.response_format.type).toBe('json_object');
  });
});

describe('buildGeminiChatRequest', () => {
  it('maps assistant role to model', () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello back' },
      { role: 'user', content: 'next' },
    ];
    const config: Config = { provider: 'gemini', apiKey: 'gem-k' };
    const req = buildGeminiChatRequest(history, config);
    const body = req.body as { contents: Array<{ role: string; parts: Array<{ text: string }> }> };

    // system is stripped; first user gets system prepended; assistant → model
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toContain('sys prompt');
    expect(body.contents[0].parts[0].text).toContain('hi');
    expect(body.contents[1].role).toBe('model');
    expect(body.contents[1].parts[0].text).toBe('hello back');
    expect(body.contents[2].role).toBe('user');
  });

  it('targets generateContent endpoint', () => {
    const config: Config = { provider: 'gemini', apiKey: 'gem-k' };
    const req = buildGeminiChatRequest([{ role: 'user', content: 'x' }], config);
    expect(req.url).toContain(':generateContent');
  });
});

describe('buildOllamaChatRequest', () => {
  it('uses /api/chat (multi-turn)', () => {
    const config: Config = { provider: 'ollama' };
    const history: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    const req = buildOllamaChatRequest(history, config);
    expect(req.url).toContain('/api/chat');
  });

  it('passes messages array directly', () => {
    const config: Config = { provider: 'ollama' };
    const history: ChatMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ];
    const req = buildOllamaChatRequest(history, config);
    const body = req.body as { messages: ChatMessage[] };
    expect(body.messages).toEqual(history);
  });

  it('sets stream to false', () => {
    const config: Config = { provider: 'ollama' };
    const req = buildOllamaChatRequest([{ role: 'user', content: 'x' }], config);
    const body = req.body as { stream: boolean };
    expect(body.stream).toBe(false);
  });

  it('strips trailing slash from baseURL', () => {
    const config: Config = { provider: 'ollama', baseURL: 'http://localhost:11434/' };
    const req = buildOllamaChatRequest([{ role: 'user', content: 'x' }], config);
    expect(req.url).toBe('http://localhost:11434/api/chat');
  });
});

describe('parseChatResponse', () => {
  it('extracts response and aporiaScore from OpenAI response', () => {
    const response = {
      choices: [{ message: { content: JSON.stringify({ response: 'Why do you think that?', aporiaScore: 0.4 }) } }],
    };
    const result = parseChatResponse('openai', response);
    expect(result.response).toBe('Why do you think that?');
    expect(result.aporiaScore).toBe(0.4);
  });

  it('extracts from Ollama /api/chat shape', () => {
    const response = {
      message: { content: JSON.stringify({ response: 'Think harder.', aporiaScore: 0.7 }) },
    };
    const result = parseChatResponse('ollama', response);
    expect(result.response).toBe('Think harder.');
    expect(result.aporiaScore).toBe(0.7);
  });

  it('clamps aporiaScore above 1 to 1', () => {
    const response = {
      choices: [{ message: { content: JSON.stringify({ response: 'x', aporiaScore: 1.5 }) } }],
    };
    const result = parseChatResponse('openai', response);
    expect(result.aporiaScore).toBe(1);
  });

  it('clamps aporiaScore below 0 to 0', () => {
    const response = {
      choices: [{ message: { content: JSON.stringify({ response: 'x', aporiaScore: -0.3 }) } }],
    };
    const result = parseChatResponse('openai', response);
    expect(result.aporiaScore).toBe(0);
  });

  it('defaults aporiaScore to 0 when missing', () => {
    const response = {
      choices: [{ message: { content: JSON.stringify({ response: 'no score' }) } }],
    };
    const result = parseChatResponse('openai', response);
    expect(result.aporiaScore).toBe(0);
  });

  it('throws on empty response', () => {
    const response = { choices: [{ message: { content: '' } }] };
    expect(() => parseChatResponse('openai', response)).toThrow(/Empty response/);
  });

  it('throws on invalid JSON', () => {
    const response = { choices: [{ message: { content: 'garbage' } }] };
    expect(() => parseChatResponse('openai', response)).toThrow(/Invalid JSON/);
  });
});

describe('SOCRATIC_CHAT_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof SOCRATIC_CHAT_SYSTEM_PROMPT).toBe('string');
    expect(SOCRATIC_CHAT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it('instructs the model to ask exactly one question per turn', () => {
    expect(SOCRATIC_CHAT_SYSTEM_PROMPT).toMatch(/one question/i);
  });

  it('instructs the model to return JSON with response and aporiaScore', () => {
    expect(SOCRATIC_CHAT_SYSTEM_PROMPT).toContain('aporiaScore');
    expect(SOCRATIC_CHAT_SYSTEM_PROMPT).toContain('"response"');
  });

  it('contains the aporia score guide with 1.0 reserved for true aporia', () => {
    expect(SOCRATIC_CHAT_SYSTEM_PROMPT).toMatch(/1\.0/);
    expect(SOCRATIC_CHAT_SYSTEM_PROMPT).toMatch(/TRUE APORIA/);
  });
});
