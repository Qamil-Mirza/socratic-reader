import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildOpenAIRequest,
  buildGeminiRequest,
  buildOllamaRequest,
  parseResponse,
} from '../shared/llm';
import type { Config } from '../shared/types';

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
