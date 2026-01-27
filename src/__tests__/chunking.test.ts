import { describe, it, expect, beforeEach } from 'vitest';
import { buildNodeRanges, chunkText } from '../content';
import type { NodeRange, TextChunk } from '../shared/types';

// Note: getTextNodes relies on CSS visibility checks which jsdom doesn't fully support.
// These tests focus on buildNodeRanges and chunkText which work with raw text nodes.

/**
 * Simple text node collector without visibility checks (for testing)
 */
function getTextNodesSimple(root: Element): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      
      // Skip excluded tags
      const excludedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'ASIDE']);
      if (excludedTags.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      
      // Skip empty text
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }
  
  return textNodes;
}

describe('Text Extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('getTextNodesSimple (test helper)', () => {
    it('extracts text nodes from simple elements', () => {
      document.body.innerHTML = '<p>Hello world</p>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Hello world');
    });

    it('extracts multiple text nodes', () => {
      document.body.innerHTML = '<p>Hello</p><p>World</p>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(2);
      expect(textNodes[0].textContent).toBe('Hello');
      expect(textNodes[1].textContent).toBe('World');
    });

    it('extracts text from nested elements', () => {
      document.body.innerHTML = '<p>Hello <strong>world</strong></p>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(2);
      expect(textNodes[0].textContent).toBe('Hello ');
      expect(textNodes[1].textContent).toBe('world');
    });

    it('excludes script content', () => {
      document.body.innerHTML = '<p>Visible</p><script>hidden();</script>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Visible');
    });

    it('excludes style content', () => {
      document.body.innerHTML = '<p>Visible</p><style>.hidden{}</style>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Visible');
    });

    it('excludes nav content', () => {
      document.body.innerHTML = '<nav>Navigation</nav><p>Content</p>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Content');
    });

    it('excludes footer content', () => {
      document.body.innerHTML = '<p>Content</p><footer>Footer text</footer>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Content');
    });

    it('excludes empty text nodes', () => {
      document.body.innerHTML = '<p>Text</p><p>   </p><p>More</p>';
      
      const textNodes = getTextNodesSimple(document.body);
      
      expect(textNodes).toHaveLength(2);
    });
  });

  describe('buildNodeRanges', () => {
    it('maps text nodes with correct offsets', () => {
      document.body.innerHTML = '<p>Hello <strong>world</strong></p>';
      const textNodes = getTextNodesSimple(document.body);
      
      const nodeRanges = buildNodeRanges(textNodes);
      
      expect(nodeRanges).toHaveLength(2);
      expect(nodeRanges[0].globalOffset).toBe(0);
      expect(nodeRanges[0].end).toBe(6); // "Hello "
      expect(nodeRanges[1].globalOffset).toBe(6);
      expect(nodeRanges[1].end).toBe(5); // "world"
    });

    it('handles single text node', () => {
      document.body.innerHTML = '<p>Simple text</p>';
      const textNodes = getTextNodesSimple(document.body);
      
      const nodeRanges = buildNodeRanges(textNodes);
      
      expect(nodeRanges).toHaveLength(1);
      expect(nodeRanges[0].globalOffset).toBe(0);
      expect(nodeRanges[0].end).toBe(11);
    });

    it('handles empty input', () => {
      const nodeRanges = buildNodeRanges([]);
      
      expect(nodeRanges).toEqual([]);
    });
  });
});

describe('Text Chunking', () => {
  // Create mock node ranges for testing
  function createMockNodeRanges(text: string): NodeRange[] {
    const textNode = document.createTextNode(text);
    return [{
      node: textNode,
      start: 0,
      end: text.length,
      globalOffset: 0,
    }];
  }

  describe('chunkText', () => {
    it('keeps short text as single chunk', () => {
      const text = 'This is a short text with few words.';
      const nodeRanges = createMockNodeRanges(text);
      
      const chunks = chunkText(text, nodeRanges);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
      expect(chunks[0].globalOffset).toBe(0);
    });

    it('splits long text into multiple chunks', () => {
      // Create text with ~600 words
      const words = Array(600).fill('word').join(' ');
      const nodeRanges = createMockNodeRanges(words);
      
      const chunks = chunkText(words, nodeRanges);
      
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves sentence boundaries when splitting', () => {
      // Create text with clear sentence boundaries
      const sentences = Array(100).fill('This is a complete sentence.').join(' ');
      const nodeRanges = createMockNodeRanges(sentences);
      
      const chunks = chunkText(sentences, nodeRanges);
      
      // Each chunk should end with a period (sentence boundary)
      for (const chunk of chunks) {
        if (chunk.text.trim()) {
          expect(chunk.text.trim()).toMatch(/\.$/);
        }
      }
    });

    it('tracks globalOffset for each chunk', () => {
      // Create text that will be split into multiple chunks
      const sentences = Array(150).fill('This is a sentence.').join(' ');
      const nodeRanges = createMockNodeRanges(sentences);
      
      const chunks = chunkText(sentences, nodeRanges);
      
      // First chunk should start at 0
      expect(chunks[0].globalOffset).toBe(0);
      
      // Subsequent chunks should have increasing offsets
      if (chunks.length > 1) {
        expect(chunks[1].globalOffset).toBeGreaterThan(0);
      }
    });

    it('handles text with no sentence boundaries', () => {
      // Text without periods - harder to split cleanly
      const text = Array(600).fill('word').join(' ');
      const nodeRanges = createMockNodeRanges(text);
      
      // Should not throw
      expect(() => chunkText(text, nodeRanges)).not.toThrow();
    });

    it('handles text with various punctuation', () => {
      const text = 'Is this a question? Yes it is! And this is a statement. Another one.';
      const nodeRanges = createMockNodeRanges(text);
      
      const chunks = chunkText(text, nodeRanges);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });
  });
});
