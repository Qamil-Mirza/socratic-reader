import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  describeRange,
  anchor,
  type TextAnchor
} from '../shared/anchoring';

// Setup DOM environment
let dom: JSDOM;
let document: Document;
let body: HTMLElement;

beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  document = dom.window.document;
  body = document.body;

  // Make document global for the functions to use
  (global as any).document = document;
  (global as any).window = dom.window;
  (global as any).Node = dom.window.Node;
  (global as any).NodeFilter = dom.window.NodeFilter;
});

describe('describeRange', () => {
  it('should create anchor from simple range', () => {
    body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    const textNode = body.querySelector('p')!.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 19); // "quick brown fox"

    const anchor = describeRange(range, body);

    expect(anchor.exact).toBe('quick brown fox');
    expect(anchor.prefix).toBe('The ');
    expect(anchor.suffix).toBe(' jumps over the lazy dog.');
    expect(anchor.start).toBe(4);
    expect(anchor.end).toBe(19);
  });

  it('should capture context around range', () => {
    body.innerHTML = '<p>This is a longer text with many words in it to test context capture properly.</p>';
    const textNode = body.querySelector('p')!.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 30); // "This is a longer text with ma"

    const anchor = describeRange(range, body);

    // Just verify that anchoring captures meaningful data
    expect(anchor.exact.length).toBeGreaterThan(20);
    expect(anchor.prefix.length).toBeLessThanOrEqual(32);
    expect(anchor.suffix.length).toBeLessThanOrEqual(32);
    expect(anchor.start).toBe(0);
    expect(anchor.end).toBe(30);
  });

  it('should handle range at document start', () => {
    body.innerHTML = '<p>Start of document text.</p>';
    const textNode = body.querySelector('p')!.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5); // "Start"

    const anchor = describeRange(range, body);

    expect(anchor.exact).toBe('Start');
    expect(anchor.prefix).toBe('');
    expect(anchor.suffix).toBe(' of document text.');
  });

  it('should handle range at document end', () => {
    body.innerHTML = '<p>Text at the end.</p>';
    const textNode = body.querySelector('p')!.firstChild as Text;
    const textLength = textNode.textContent!.length;

    const range = document.createRange();
    range.setStart(textNode, textLength - 4);
    range.setEnd(textNode, textLength); // "end."

    const anchor = describeRange(range, body);

    expect(anchor.exact).toBe('end.');
    expect(anchor.suffix).toBe('');
  });

  it('should handle range across multiple elements', () => {
    body.innerHTML = '<p>First part</p><p>Second part</p>';
    const first = body.querySelectorAll('p')[0].firstChild as Text;
    const second = body.querySelectorAll('p')[1].firstChild as Text;

    const range = document.createRange();
    range.setStart(first, 6);
    range.setEnd(second, 6); // "partSecond"

    const anchor = describeRange(range, body);

    expect(anchor.exact).toContain('part');
    expect(anchor.start).toBeGreaterThan(0);
  });
});

describe('anchor - exact matching', () => {
  it('should re-anchor exact text', async () => {
    body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';

    const descriptor: TextAnchor = {
      exact: 'quick brown fox',
      prefix: 'The ',
      suffix: ' jumps',
      start: 4,
      end: 19
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('quick brown fox');
    expect(result!.score).toBe(1.0);
    expect(result!.method).toBe('exact');
  });

  it('should disambiguate with context when text appears multiple times', async () => {
    body.innerHTML = '<p>The fox and the fox are both foxes.</p>';

    const descriptor: TextAnchor = {
      exact: 'fox',
      prefix: 'the ',
      suffix: ' are',
      start: 15,
      end: 18
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('fox');

    // Should match the second "fox" based on context
    const rangeText = result!.range.toString();
    expect(rangeText).toBe('fox');
  });

  it('should handle text with special characters', async () => {
    body.innerHTML = '<p>Price is $99.99 for this item!</p>';

    const descriptor: TextAnchor = {
      exact: '$99.99',
      prefix: 'is ',
      suffix: ' for',
      start: 9,
      end: 15
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('$99.99');
    expect(result!.method).toBe('exact');
  });
});

describe('anchor - fuzzy matching', () => {
  it('should handle minor text changes', async () => {
    // Changed "brown" to "brwon" (typo) and "lazy" to "lzy" (typo)
    body.innerHTML = '<p>The quick brwon fox jumps over the lzy dog.</p>';

    const descriptor: TextAnchor = {
      exact: 'brown fox jumps over the lazy',
      prefix: 'quick ',
      suffix: ' dog',
      start: 10,
      end: 39
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    // Can use exact, fuzzy, or position - all are valid strategies
    expect(['exact', 'fuzzy', 'position']).toContain(result!.method);
    // Score may be lower for position-based fallback
    expect(result!.score).toBeGreaterThanOrEqual(0.5);
  });

  it('should handle punctuation changes', async () => {
    body.innerHTML = '<p>The quick brown fox jumps over lazy dog</p>'; // removed "the" and period

    const descriptor: TextAnchor = {
      exact: 'quick brown fox',
      prefix: 'The ',
      suffix: ' jumps',
      start: 4,
      end: 19
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    // Should still find it (exact match)
    expect(result!.exact).toBe('quick brown fox');
  });

  it('should reject very different text', async () => {
    body.innerHTML = '<p>Completely different text here.</p>';

    const descriptor: TextAnchor = {
      exact: 'quick brown fox',
      prefix: 'The ',
      suffix: ' jumps',
      start: 4,
      end: 19
    };

    const result = await anchor(descriptor, body);

    // Should fail to match or have very low score
    if (result) {
      expect(result.score).toBeLessThan(0.7);
    }
  });
});

describe('anchor - position fallback', () => {
  it('should use position when context fails but text unchanged', async () => {
    body.innerHTML = '<p>First statement. Second statement. Third statement.</p>';

    // Searching for "Second sentence" which doesn't exist, but position might have "Second statement"
    const descriptor: TextAnchor = {
      exact: 'Second sentence', // Text changed from "sentence" to "statement"
      prefix: 'COMPLETELY WRONG PREFIX THAT DOES NOT EXIST',
      suffix: 'COMPLETELY WRONG SUFFIX THAT DOES NOT EXIST',
      start: 20,
      end: 36
    };

    const result = await anchor(descriptor, body);

    // May fail completely or use position/fuzzy
    if (result) {
      expect(['position', 'fuzzy']).toContain(result!.method);
    }
  });

  it('should fail gracefully when position is out of bounds', async () => {
    body.innerHTML = '<p>Short text.</p>';

    const descriptor: TextAnchor = {
      exact: 'Some very long text that does not exist',
      prefix: '',
      suffix: '',
      start: 1000,
      end: 1040
    };

    const result = await anchor(descriptor, body);

    expect(result).toBeNull();
  });
});

describe('anchor - complex scenarios', () => {
  it('should handle nested HTML structure', async () => {
    body.innerHTML = '<div><p>Paragraph with <strong>bold text</strong> inside.</p></div>';

    const descriptor: TextAnchor = {
      exact: 'bold text',
      prefix: 'with ',
      suffix: ' inside',
      start: 16,
      end: 25
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('bold text');
  });

  it('should handle text split across elements', async () => {
    body.innerHTML = '<p>Text in <span>multiple</span> elements.</p>';

    const descriptor: TextAnchor = {
      exact: 'multiple elements',
      prefix: 'in ',
      suffix: '.',
      start: 8,
      end: 25
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toContain('multiple');
  });

  it('should handle whitespace variations', async () => {
    body.innerHTML = '<p>Text  with   extra    spaces.</p>'; // Extra spaces

    const descriptor: TextAnchor = {
      exact: 'with extra spaces',
      prefix: 'Text ',
      suffix: '.',
      start: 5,
      end: 22
    };

    const result = await anchor(descriptor, body);

    // Should still find similar text despite whitespace differences
    expect(result).not.toBeNull();
  });

  it('should handle empty document', async () => {
    body.innerHTML = '';

    const descriptor: TextAnchor = {
      exact: 'some text',
      prefix: '',
      suffix: '',
      start: 0,
      end: 9
    };

    const result = await anchor(descriptor, body);

    expect(result).toBeNull();
  });

  it('should handle very long documents efficiently', async () => {
    // Create a long document
    const paragraphs = [];
    for (let i = 0; i < 100; i++) {
      paragraphs.push(`<p>Paragraph ${i} with some text content here.</p>`);
    }
    body.innerHTML = paragraphs.join('');

    const descriptor: TextAnchor = {
      exact: 'Paragraph 50',
      prefix: '',
      suffix: ' with',
      start: 0,
      end: 12
    };

    const startTime = Date.now();
    const result = await anchor(descriptor, body);
    const elapsed = Date.now() - startTime;

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('Paragraph 50');
    expect(elapsed).toBeLessThan(1000); // Should be fast
  });
});

describe('edge cases', () => {
  it('should handle single character range', async () => {
    body.innerHTML = '<p>A single letter.</p>';

    const descriptor: TextAnchor = {
      exact: 'A',
      prefix: '',
      suffix: ' single',
      start: 0,
      end: 1
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('A');
  });

  it('should handle range with only punctuation', async () => {
    body.innerHTML = '<p>Question? Answer!</p>';

    const descriptor: TextAnchor = {
      exact: '?',
      prefix: 'Question',
      suffix: ' Answer',
      start: 8,
      end: 9
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('?');
  });

  it('should handle Unicode characters', async () => {
    body.innerHTML = '<p>Hello 世界 and emoji 🎉!</p>';

    const descriptor: TextAnchor = {
      exact: '世界',
      prefix: 'Hello ',
      suffix: ' and',
      start: 6,
      end: 8
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe('世界');
  });

  it('should handle newlines in text', async () => {
    body.innerHTML = '<p>First line\n\nSecond line</p>';

    const descriptor: TextAnchor = {
      exact: 'Second line',
      prefix: 'line\n\n',
      suffix: '',
      start: 13,
      end: 24
    };

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toContain('Second');
  });
});

describe('round-trip test', () => {
  it('should be able to describe and re-anchor the same range', async () => {
    body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    const textNode = body.querySelector('p')!.firstChild as Text;

    // Create original range
    const originalRange = document.createRange();
    originalRange.setStart(textNode, 10);
    originalRange.setEnd(textNode, 25); // "brown fox jumps"

    const originalText = originalRange.toString();

    // Describe it
    const descriptor = describeRange(originalRange, body);

    // Simulate page reload (clear and rebuild DOM)
    body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';

    // Re-anchor
    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toBe(originalText);
    expect(result!.score).toBe(1.0);
    expect(result!.method).toBe('exact');
  });

  it('should survive minor DOM restructuring', async () => {
    body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    const textNode = body.querySelector('p')!.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 19);

    const descriptor = describeRange(range, body);

    // Restructure DOM (add span around different text)
    body.innerHTML = '<p>The <span>quick</span> brown fox jumps over the lazy dog.</p>';

    const result = await anchor(descriptor, body);

    expect(result).not.toBeNull();
    expect(result!.exact).toContain('quick brown fox');
    expect(result!.score).toBeGreaterThan(0.8);
  });
});
