import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  offsetToRange,
  applyHighlight,
  clearHighlights,
  scrollToHighlight,
  buildNodeRanges,
} from '../content';
import type { TextChunk, NodeRange } from '../shared/types';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

/**
 * Simple text node collector for testing (without CSS visibility checks)
 */
function getTextNodesSimple(root: Element): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }
  
  return textNodes;
}

// Helper to create a text chunk from the current document
function createChunkFromBody(): TextChunk {
  const textNodes = getTextNodesSimple(document.body);
  const nodeRanges = buildNodeRanges(textNodes);
  const text = textNodes.map(n => n.textContent).join('');
  
  return {
    text,
    nodeRanges,
    globalOffset: 0,
  };
}

describe('DOM Highlighting', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('offsetToRange', () => {
    it('creates Range for valid offsets', () => {
      document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
      const chunk = createChunkFromBody();
      
      // Select "quick" (positions 4-9)
      const range = offsetToRange(chunk, 4, 9);
      
      expect(range).not.toBeNull();
      expect(range!.toString()).toBe('quick');
    });

    it('handles offsets at the start', () => {
      document.body.innerHTML = '<p>Hello world</p>';
      const chunk = createChunkFromBody();
      
      const range = offsetToRange(chunk, 0, 5);
      
      expect(range).not.toBeNull();
      expect(range!.toString()).toBe('Hello');
    });

    it('handles offsets at the end', () => {
      document.body.innerHTML = '<p>Hello world</p>';
      const chunk = createChunkFromBody();
      
      const range = offsetToRange(chunk, 6, 11);
      
      expect(range).not.toBeNull();
      expect(range!.toString()).toBe('world');
    });

    it('handles offsets spanning multiple text nodes', () => {
      document.body.innerHTML = '<p>Hello <em>beautiful</em> world</p>';
      const chunk = createChunkFromBody();
      
      // "Hello beautiful" spans two text nodes
      const range = offsetToRange(chunk, 0, 15);
      
      expect(range).not.toBeNull();
      expect(range!.toString()).toBe('Hello beautiful');
    });

    it('returns null for invalid start offset', () => {
      document.body.innerHTML = '<p>Short text</p>';
      const chunk = createChunkFromBody();
      
      const range = offsetToRange(chunk, -1, 5);
      
      expect(range).toBeNull();
    });

    it('returns null when start >= end', () => {
      document.body.innerHTML = '<p>Some text</p>';
      const chunk = createChunkFromBody();
      
      const range = offsetToRange(chunk, 5, 5);
      
      expect(range).toBeNull();
    });

    it('handles out-of-bounds end offset gracefully', () => {
      document.body.innerHTML = '<p>Short</p>';
      const chunk = createChunkFromBody();
      
      // End offset beyond text length - should still work
      const range = offsetToRange(chunk, 0, 100);
      
      // Should either be null or capture available text
      if (range !== null) {
        expect(range.toString().length).toBeGreaterThan(0);
      }
    });
  });

  describe('applyHighlight', () => {
    it('wraps text in highlight span', () => {
      document.body.innerHTML = '<p>This is important text to highlight.</p>';
      const textNode = document.querySelector('p')!.firstChild as Text;
      
      const range = document.createRange();
      range.setStart(textNode, 8);
      range.setEnd(textNode, 17); // "important"
      
      const highlight = applyHighlight(range, 'h-1');
      
      expect(highlight).not.toBeNull();
      expect(highlight!.textContent).toBe('important');
      expect(highlight!.classList.contains('socratic-highlight')).toBe(true);
      expect(highlight!.getAttribute('data-highlight-id')).toBe('h-1');
    });

    it('preserves surrounding text', () => {
      document.body.innerHTML = '<p>Before target after</p>';
      const textNode = document.querySelector('p')!.firstChild as Text;
      
      const range = document.createRange();
      range.setStart(textNode, 7);
      range.setEnd(textNode, 13); // "target"
      
      applyHighlight(range, 'h-1');
      
      expect(document.body.textContent).toBe('Before target after');
    });

    it('sets data-highlight-id attribute', () => {
      document.body.innerHTML = '<p>Test text</p>';
      const textNode = document.querySelector('p')!.firstChild as Text;
      
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 4);
      
      const highlight = applyHighlight(range, 'custom-id-123');
      
      expect(highlight!.getAttribute('data-highlight-id')).toBe('custom-id-123');
    });
  });

  describe('clearHighlights', () => {
    it('removes all highlight spans', () => {
      document.body.innerHTML = '<p>Before <span class="socratic-highlight">highlighted</span> after</p>';
      
      clearHighlights();
      
      expect(document.querySelector('.socratic-highlight')).toBeNull();
    });

    it('restores text content', () => {
      document.body.innerHTML = '<p>Before <span class="socratic-highlight">highlighted</span> after</p>';
      
      clearHighlights();
      
      expect(document.body.textContent).toBe('Before highlighted after');
    });

    it('handles multiple highlights', () => {
      document.body.innerHTML = `
        <p>
          <span class="socratic-highlight">First</span>
          and
          <span class="socratic-highlight">Second</span>
        </p>
      `;
      
      clearHighlights();
      
      expect(document.querySelectorAll('.socratic-highlight')).toHaveLength(0);
    });

    it('handles nested content in highlights', () => {
      document.body.innerHTML = '<p><span class="socratic-highlight"><strong>bold</strong> text</span></p>';
      
      clearHighlights();
      
      expect(document.querySelector('.socratic-highlight')).toBeNull();
      expect(document.querySelector('strong')).not.toBeNull();
    });
  });

  describe('scrollToHighlight', () => {
    it('adds active class to target highlight', () => {
      document.body.innerHTML = `
        <span class="socratic-highlight" data-highlight-id="h-1">First</span>
        <span class="socratic-highlight" data-highlight-id="h-2">Second</span>
      `;
      
      scrollToHighlight('h-2');
      
      const h1 = document.querySelector('[data-highlight-id="h-1"]');
      const h2 = document.querySelector('[data-highlight-id="h-2"]');
      
      expect(h1!.classList.contains('active')).toBe(false);
      expect(h2!.classList.contains('active')).toBe(true);
    });

    it('removes active class from other highlights', () => {
      document.body.innerHTML = `
        <span class="socratic-highlight active" data-highlight-id="h-1">First</span>
        <span class="socratic-highlight" data-highlight-id="h-2">Second</span>
      `;
      
      scrollToHighlight('h-2');
      
      const h1 = document.querySelector('[data-highlight-id="h-1"]');
      
      expect(h1!.classList.contains('active')).toBe(false);
    });

    it('handles non-existent highlight ID gracefully', () => {
      document.body.innerHTML = '<span class="socratic-highlight" data-highlight-id="h-1">Text</span>';
      
      // Should not throw
      expect(() => scrollToHighlight('non-existent')).not.toThrow();
    });
  });
});
