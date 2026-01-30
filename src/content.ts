// Types inlined to avoid imports (required for programmatic injection)
import { createSemanticChunks, type SemanticChunk } from './shared/semantic-chunking';

interface NodeRange {
  node: Text;
  start: number;
  end: number;
  globalOffset: number;
}

interface TextChunk {
  text: string;
  nodeRanges: NodeRange[];
  globalOffset: number;
  salience?: number; // Argument richness score (0-1)
  salienceFactors?: {
    argumentKeywords: number;
    questions: number;
    transitions: number;
    complexity: number;
  };
}

interface Highlight {
  start: number;
  end: number;
  reason: string;
  question: string;
  explanation: string;
}

interface ProcessedHighlight extends Highlight {
  id: string;
  text: string;
  range: Range | null;
  chunkIndex: number;
  anchor?: TextAnchor; // Robust anchor for re-mapping after reload
}

interface SavedNote {
  highlightId: string;
  url: string;
  start: number;
  end: number;
  text: string;
  note: string;
  createdAt: number;
  anchor?: TextAnchor; // Robust anchor for re-mapping after reload
}

interface AnalyzeChunkResponse {
  highlights?: Highlight[];
  error?: string;
}

// Robust text anchoring for persistent highlights
interface TextAnchor {
  exact: string;           // The exact text being anchored
  prefix: string;          // Text before (for disambiguation)
  suffix: string;          // Text after (for disambiguation)
  start: number;           // Character offset from document start (fallback)
  end: number;             // Character offset from document end (fallback)
}

interface AnchorResult {
  range: Range;
  exact: string;
  score: number;           // Confidence score 0-1
  method: 'exact' | 'fuzzy' | 'position';
}

type OverlayState = 'IDLE' | 'EXTRACTING' | 'ANALYZING' | 'DISPLAYING' | 'ERROR';

// Storage operations via message passing to background script
async function getNotes(url: string): Promise<SavedNote[]> {
  return chrome.runtime.sendMessage({ action: 'GET_NOTES', url });
}

async function saveNote(note: SavedNote): Promise<void> {
  return chrome.runtime.sendMessage({ action: 'SAVE_NOTE', note });
}

async function deleteNote(url: string, highlightId: string): Promise<void> {
  return chrome.runtime.sendMessage({ action: 'DELETE_NOTE', url, highlightId });
}

// Cache operations via message passing
interface CacheResponse {
  highlights: Highlight[] | null;
  contentHash: string;
}

async function getCachedAnalysis(url: string, contentText: string): Promise<CacheResponse> {
  return chrome.runtime.sendMessage({ action: 'GET_CACHED_ANALYSIS', url, contentText });
}

async function setCachedAnalysis(url: string, highlights: Highlight[], contentHash: string): Promise<void> {
  return chrome.runtime.sendMessage({ action: 'SET_CACHED_ANALYSIS', url, highlights, contentHash });
}

async function clearCachedAnalysis(url: string): Promise<void> {
  return chrome.runtime.sendMessage({ action: 'CLEAR_CACHED_ANALYSIS', url });
}

// =============================================================================
// Constants
// =============================================================================

const CHUNK_WORD_LIMIT = 500;
const OVERLAY_ID = 'socratic-reader-overlay';
const HIGHLIGHT_CLASS = 'socratic-highlight';
const HIGHLIGHT_ACTIVE_CLASS = 'active';

// Elements to exclude from text extraction
const EXCLUDED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'CANVAS',
  'NAV',
  'FOOTER',
  'ASIDE',
  'HEADER',
]);

// =============================================================================
// State
// =============================================================================

let overlayState: OverlayState = 'IDLE';
let currentHighlights: ProcessedHighlight[] = [];
let currentHighlightIndex = 0;
let overlayElement: HTMLElement | null = null;
let lastContentHash: string = '';
let isFromCache: boolean = false;

// Overlay UI state
type DockPosition = 'right' | 'left' | 'float';
let overlayDockPosition: DockPosition = 'right';
let overlayMinimized: boolean = false;
let tooltipElement: HTMLElement | null = null;

// Drag state
let isDragging: boolean = false;
let dragStartX: number = 0;
let dragStartY: number = 0;
let overlayStartX: number = 0;
let overlayStartY: number = 0;
let floatingPosition: { x: number; y: number } | null = null;

// Snap detection threshold (pixels from edge)
const SNAP_THRESHOLD = 100;

// Snap zone indicators
let snapZoneLeft: HTMLElement | null = null;
let snapZoneRight: HTMLElement | null = null;

// =============================================================================
// Robust Text Anchoring
// =============================================================================

const CONTEXT_LENGTH = 32;  // Characters of prefix/suffix to capture
const FUZZY_THRESHOLD = 0.8; // Minimum similarity for fuzzy match

/**
 * Creates a robust anchor descriptor from a DOM Range
 */
function describeRange(range: Range, root: Node = document.body): TextAnchor {
  const exact = range.toString();
  const { prefix, suffix } = getContext(range, CONTEXT_LENGTH, root);
  const { start, end } = getTextPosition(range, root);

  return {
    exact,
    prefix,
    suffix,
    start,
    end
  };
}

/**
 * Re-anchors a persisted descriptor to the current DOM
 */
async function anchorToRange(descriptor: TextAnchor, root: Node = document.body): Promise<AnchorResult | null> {
  // Strategy 1: Try exact quote match with context
  const exactMatch = findQuote(descriptor, root);
  if (exactMatch) {
    return {
      range: exactMatch,
      exact: descriptor.exact,
      score: 1.0,
      method: 'exact'
    };
  }

  // Strategy 2: Try fuzzy quote match (handles minor text changes)
  const fuzzyMatch = findFuzzyQuote(descriptor, root);
  if (fuzzyMatch && fuzzyMatch.score >= FUZZY_THRESHOLD) {
    return fuzzyMatch;
  }

  // Strategy 3: Fall back to position-based (least reliable)
  const positionMatch = findByPosition(descriptor, root);
  if (positionMatch) {
    return {
      range: positionMatch,
      exact: positionMatch.toString(),
      score: 0.5,
      method: 'position'
    };
  }

  return null;
}

/**
 * Gets surrounding context for quote-based anchoring
 */
function getContext(range: Range, contextLength: number, root: Node): { prefix: string; suffix: string } {
  const textNodes = getTextNodesForAnchoring(root);
  const text = textNodes.map(n => n.textContent).join('');

  const rangeStart = getTextOffsetForNode(range.startContainer, range.startOffset, textNodes);
  const rangeEnd = getTextOffsetForNode(range.endContainer, range.endOffset, textNodes);

  const prefix = text.slice(Math.max(0, rangeStart - contextLength), rangeStart);
  const suffix = text.slice(rangeEnd, rangeEnd + contextLength);

  return { prefix, suffix };
}

/**
 * Gets text position (character offset) of a range
 */
function getTextPosition(range: Range, root: Node): { start: number; end: number } {
  const textNodes = getTextNodesForAnchoring(root);
  const start = getTextOffsetForNode(range.startContainer, range.startOffset, textNodes);
  const end = getTextOffsetForNode(range.endContainer, range.endOffset, textNodes);
  return { start, end };
}

/**
 * Calculates character offset from root to a position in a node
 */
function getTextOffsetForNode(node: Node, offset: number, textNodes: Text[]): number {
  let currentOffset = 0;

  for (const textNode of textNodes) {
    if (textNode === node) {
      return currentOffset + offset;
    }
    currentOffset += (textNode.textContent || '').length;
  }

  return currentOffset;
}

/**
 * Finds exact quote match using prefix/suffix for disambiguation
 */
function findQuote(descriptor: TextAnchor, root: Node): Range | null {
  const { exact, prefix, suffix } = descriptor;
  const textNodes = getTextNodesForAnchoring(root);
  const fullText = textNodes.map(n => n.textContent).join('');

  // Find all occurrences of exact text
  const occurrences: number[] = [];
  let index = fullText.indexOf(exact);
  while (index !== -1) {
    occurrences.push(index);
    index = fullText.indexOf(exact, index + 1);
  }

  if (occurrences.length === 0) return null;

  // If only one match, return it
  if (occurrences.length === 1) {
    return createRangeFromOffset(occurrences[0], occurrences[0] + exact.length, textNodes);
  }

  // Use context to disambiguate
  for (const start of occurrences) {
    const actualPrefix = fullText.slice(Math.max(0, start - CONTEXT_LENGTH), start);
    const actualSuffix = fullText.slice(start + exact.length, start + exact.length + CONTEXT_LENGTH);

    if (actualPrefix.endsWith(prefix) && actualSuffix.startsWith(suffix)) {
      return createRangeFromOffset(start, start + exact.length, textNodes);
    }
  }

  // If no context match, return first occurrence as fallback
  return createRangeFromOffset(occurrences[0], occurrences[0] + exact.length, textNodes);
}

/**
 * Fuzzy quote matching using Levenshtein distance for robustness
 */
function findFuzzyQuote(descriptor: TextAnchor, root: Node): AnchorResult | null {
  const { exact, prefix, suffix } = descriptor;
  const textNodes = getTextNodesForAnchoring(root);
  const fullText = textNodes.map(n => n.textContent).join('');

  const searchLength = exact.length;
  let bestMatch: { start: number; score: number; text: string } | null = null;

  // Slide window across text
  for (let i = 0; i < fullText.length - searchLength + 50; i++) {
    const candidate = fullText.slice(i, Math.min(i + searchLength + 50, fullText.length));
    const score = similarity(exact, candidate.slice(0, searchLength));

    if (score > FUZZY_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
      const actualPrefix = fullText.slice(Math.max(0, i - CONTEXT_LENGTH), i);
      const actualSuffix = fullText.slice(i + searchLength, i + searchLength + CONTEXT_LENGTH);

      const contextScore = (similarity(prefix, actualPrefix) + similarity(suffix, actualSuffix)) / 2;

      if (contextScore > 0.7) {
        bestMatch = { start: i, score, text: candidate.slice(0, searchLength) };
      }
    }
  }

  if (!bestMatch) return null;

  const range = createRangeFromOffset(bestMatch.start, bestMatch.start + searchLength, textNodes);
  if (!range) return null;

  return {
    range,
    exact: bestMatch.text,
    score: bestMatch.score,
    method: 'fuzzy'
  };
}

/**
 * Position-based anchoring (least reliable, but fast)
 */
function findByPosition(descriptor: TextAnchor, root: Node): Range | null {
  const textNodes = getTextNodesForAnchoring(root);
  const fullText = textNodes.map(n => n.textContent).join('');

  if (descriptor.start >= fullText.length || descriptor.end > fullText.length) {
    return null;
  }

  return createRangeFromOffset(descriptor.start, descriptor.end, textNodes);
}

/**
 * Creates a DOM Range from character offsets
 */
function createRangeFromOffset(start: number, end: number, textNodes: Text[]): Range | null {
  let currentOffset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of textNodes) {
    const nodeLength = (node.textContent || '').length;

    if (!startNode && currentOffset + nodeLength > start) {
      startNode = node;
      startOffset = start - currentOffset;
    }

    if (!endNode && currentOffset + nodeLength >= end) {
      endNode = node;
      endOffset = end - currentOffset;
      break;
    }

    currentOffset += nodeLength;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  try {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch (e) {
    console.error('[Socratic Reader] Failed to create range:', e);
    return null;
  }
}

/**
 * Gets all text nodes under a root (for anchoring)
 */
function getTextNodesForAnchoring(root: Node): Text[] {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        if (!node.textContent?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }

  return nodes;
}

/**
 * Calculates similarity between two strings (0-1)
 */
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const distance = levenshtein(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Levenshtein distance implementation
 */
function levenshtein(s1: string, s2: string): number {
  const costs: number[] = [];

  for (let i = 0; i <= s2.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s1.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(j - 1) !== s2.charAt(i - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s1.length] = lastValue;
  }

  return costs[s1.length];
}

// =============================================================================
// Text Extraction
// =============================================================================

/**
 * Check if element is visible in viewport
 */
function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  
  // Check if too small (likely hidden or decorative)
  if (rect.width < 10 || rect.height < 10) {
    return false;
  }
  
  // Check if font is too small
  const fontSize = parseFloat(style.fontSize);
  if (fontSize < 8) {
    return false;
  }
  
  return true;
}

/**
 * Check if element is in viewport
 */
function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

/**
 * Get text nodes from an element, excluding unwanted elements
 */
export function getTextNodes(root: Element): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      
      // Skip excluded tags
      if (EXCLUDED_TAGS.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      
      // Skip empty text
      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      
      // Skip invisible elements
      if (!isElementVisible(parent)) {
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

/**
 * Build node ranges with global offsets
 */
export function buildNodeRanges(textNodes: Text[]): NodeRange[] {
  const ranges: NodeRange[] = [];
  let globalOffset = 0;

  for (const node of textNodes) {
    const text = node.textContent ?? '';
    ranges.push({
      node,
      start: 0,
      end: text.length,
      globalOffset,
    });
    globalOffset += text.length;
  }

  return ranges;
}

/**
 * Get selected text with node ranges
 */
function getSelectionText(): { text: string; nodeRanges: NodeRange[] } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  
  if (!text || text.length < 50) {
    return null; // Too short to analyze
  }

  // Get text nodes within selection
  const container = range.commonAncestorContainer;
  const root = container.nodeType === Node.TEXT_NODE 
    ? container.parentElement! 
    : container as Element;
  
  const allTextNodes = getTextNodes(root);
  const selectedNodes: Text[] = [];
  
  for (const node of allTextNodes) {
    if (selection.containsNode(node, true)) {
      selectedNodes.push(node);
    }
  }

  if (selectedNodes.length === 0) {
    return null;
  }

  const nodeRanges = buildNodeRanges(selectedNodes);
  const combinedText = selectedNodes.map(n => n.textContent).join('');
  
  return { text: combinedText, nodeRanges };
}

/**
 * Get visible viewport text with node ranges
 */
function getViewportText(): { text: string; nodeRanges: NodeRange[] } | null {
  // Find main content area
  const article = document.querySelector('article, main, [role="main"], .content, #content');
  const root = article || document.body;
  
  const allTextNodes = getTextNodes(root);
  const visibleNodes: Text[] = [];
  
  for (const node of allTextNodes) {
    const parent = node.parentElement;
    if (parent && isInViewport(parent)) {
      visibleNodes.push(node);
    }
  }

  if (visibleNodes.length === 0) {
    return null;
  }

  const nodeRanges = buildNodeRanges(visibleNodes);
  const text = visibleNodes.map(n => n.textContent).join('');
  
  return { text, nodeRanges };
}

/**
 * Extract text with priority: selection > viewport
 */
function extractText(): { text: string; nodeRanges: NodeRange[] } | null {
  // Try selection first
  const selection = getSelectionText();
  if (selection && selection.text.length >= 50) {
    return selection;
  }

  // Fall back to viewport
  return getViewportText();
}

// =============================================================================
// Text Chunking
// =============================================================================

/**
 * Chunk text into semantic segments respecting sentence and paragraph boundaries
 * Uses intelligent chunking that never cuts mid-sentence or mid-idea
 */
export function chunkText(text: string, nodeRanges: NodeRange[]): TextChunk[] {
  const words = text.split(/\s+/);

  // Handle short text that doesn't need chunking
  if (words.length <= CHUNK_WORD_LIMIT) {
    // Verify text matches nodeRanges
    const nodeText = nodeRanges.map(nr => nr.node.textContent?.slice(nr.start, nr.end) ?? '').join('');
    if (nodeText !== text) {
      console.warn('[Socratic Reader] Text mismatch in single chunk. Expected length:', text.length, 'Got:', nodeText.length);
    }

    // Calculate salience even for single chunk
    const semanticChunks = createSemanticChunks(text, CHUNK_WORD_LIMIT, 100, 1000);
    const salience = semanticChunks[0]?.salience ?? 0;
    const salienceFactors = semanticChunks[0]?.salienceFactors;

    return [{
      text,
      nodeRanges,
      globalOffset: 0,
      salience,
      salienceFactors
    }];
  }

  // Use semantic chunking to get intelligent boundaries
  const semanticChunks = createSemanticChunks(
    text,
    CHUNK_WORD_LIMIT,  // target: 500 words
    200,               // min: 200 words
    800                // max: 800 words
  );

  // Map semantic chunks to TextChunks with DOM node ranges
  const chunks: TextChunk[] = [];

  for (const semanticChunk of semanticChunks) {
    const chunkStart = semanticChunk.start;
    const chunkEnd = semanticChunk.end;
    const chunkText = semanticChunk.text;

    // Get the node ranges for this chunk
    const chunkRanges = getNodeRangesForOffset(nodeRanges, chunkStart, chunkEnd);

    // Verify this chunk's text matches its nodeRanges
    const nodeText = chunkRanges.map(nr => nr.node.textContent?.slice(nr.start, nr.end) ?? '').join('');
    if (nodeText !== chunkText) {
      console.warn('[Socratic Reader] Text mismatch in semantic chunk. Expected:', chunkText.length, 'chars, got:', nodeText.length);
    }

    chunks.push({
      text: chunkText,
      nodeRanges: chunkRanges,
      globalOffset: chunkStart,
      salience: semanticChunk.salience,
      salienceFactors: semanticChunk.salienceFactors
    });
  }

  // Log salience info for debugging
  if (chunks.length > 0) {
    const avgSalience = chunks.reduce((sum, c) => sum + (c.salience ?? 0), 0) / chunks.length;
    const maxSalience = Math.max(...chunks.map(c => c.salience ?? 0));
    console.log(`[Socratic Reader] Created ${chunks.length} semantic chunks (avg salience: ${avgSalience.toFixed(2)}, max: ${maxSalience.toFixed(2)})`);
  }

  return chunks;
}

/**
 * Get node ranges that overlap with given offset range
 */
function getNodeRangesForOffset(
  nodeRanges: NodeRange[],
  startOffset: number,
  endOffset: number
): NodeRange[] {
  const result: NodeRange[] = [];

  for (const range of nodeRanges) {
    const nodeTextLength = range.node.textContent?.length ?? 0;

    // Calculate where this range ends in the combined text
    const rangeContribution = range.end - range.start;
    const rangeStart = range.globalOffset;
    const rangeEnd = range.globalOffset + rangeContribution;

    // Check if this range overlaps with our target range
    if (rangeEnd > startOffset && rangeStart < endOffset) {
      // Calculate how far into this range's contribution we need to start/end
      const offsetIntoRangeStart = Math.max(0, startOffset - rangeStart);
      const offsetIntoRangeEnd = Math.min(rangeContribution, endOffset - rangeStart);

      // Map to actual DOM node offsets (add to range.start since range.start might be non-zero)
      const newStart = range.start + offsetIntoRangeStart;
      const newEnd = range.start + offsetIntoRangeEnd;

      // Validate that offsets are within the node's actual text length
      if (newStart > nodeTextLength || newEnd > nodeTextLength) {
        console.error('[Socratic Reader] Invalid node range detected:', {
          nodeText: range.node.textContent?.slice(0, 50) + '...',
          nodeLength: nodeTextLength,
          originalRange: { start: range.start, end: range.end, globalOffset: range.globalOffset },
          calculatedRange: { newStart, newEnd },
          offsetIntoRange: { start: offsetIntoRangeStart, end: offsetIntoRangeEnd },
          chunkRange: { startOffset, endOffset },
          rangeContribution,
          rangeStart,
          rangeEnd,
        });

        // This indicates a bug - range.start/end are supposed to be valid node offsets
        // Skip this range entirely rather than clamping, as clamping produces wrong text
        console.warn('[Socratic Reader] Skipping invalid range - this is a bug in getNodeRangesForOffset');
        continue;
      }

      // Calculate new globalOffset relative to the chunk's start
      const newGlobalOffset = Math.max(0, rangeStart - startOffset);

      result.push({
        ...range,
        start: newStart,
        end: newEnd,
        globalOffset: newGlobalOffset,
      });
    }
  }

  return result;
}

// =============================================================================
// DOM Highlighting
// =============================================================================

/**
 * Convert character offset to DOM Range
 */
export function offsetToRange(chunk: TextChunk, start: number, end: number): Range | null {
  if (start < 0 || end <= start || chunk.nodeRanges.length === 0) {
    return null;
  }

  // Verify that nodes still have the expected content
  // If DOM has changed since extraction, our offsets are invalid
  const currentText = chunk.nodeRanges
    .map(nr => nr.node.textContent?.slice(nr.start, nr.end) ?? '')
    .join('');

  if (currentText !== chunk.text) {
    console.warn('[Socratic Reader] DOM has changed since extraction. Expected text length:', chunk.text.length, 'Current:', currentText.length);
    console.warn('[Socratic Reader] Highlight offsets are invalid, skipping this highlight');
    return null;
  }

  // Calculate total text length from nodeRanges
  const totalLength = chunk.nodeRanges.reduce((sum, nr) => sum + (nr.end - nr.start), 0);

  // Validate offsets against actual content length
  if (start >= totalLength) {
    console.warn('[Socratic Reader] Start offset', start, 'beyond content length', totalLength);
    return null;
  }

  // Cap end at content length if LLM returned offset beyond the text
  const cappedEnd = Math.min(end, totalLength);

  const range = document.createRange();
  let foundStart = false;
  let foundEnd = false;
  let currentOffset = 0;

  for (const nodeRange of chunk.nodeRanges) {
    // Check if the node still exists and has content
    const actualNodeLength = nodeRange.node.textContent?.length ?? 0;

    // Skip empty nodes - they may have been emptied after text extraction
    if (actualNodeLength === 0) {
      console.warn('[Socratic Reader] Skipping empty node in offsetToRange');
      continue;
    }

    // Validate nodeRange offsets against actual node content
    if (nodeRange.start >= actualNodeLength || nodeRange.end > actualNodeLength) {
      console.error('[Socratic Reader] NodeRange offsets exceed actual node length:', {
        nodeText: nodeRange.node.textContent?.slice(0, 50),
        actualLength: actualNodeLength,
        rangeStart: nodeRange.start,
        rangeEnd: nodeRange.end,
      });
      // Skip this invalid node range
      continue;
    }

    // Calculate the actual contribution of this node to the chunk
    const nodeContribution = nodeRange.end - nodeRange.start;
    const nodeStart = currentOffset;
    const nodeEnd = currentOffset + nodeContribution;

    // Find start position
    if (!foundStart && start >= nodeStart && start < nodeEnd) {
      // Map from chunk offset to node offset
      const offsetIntoNodeContribution = start - nodeStart;
      const actualNodeOffset = nodeRange.start + offsetIntoNodeContribution;

      // Re-check node length immediately before using it (race condition protection)
      const nodeLength = nodeRange.node.textContent?.length ?? 0;

      if (nodeLength === 0) {
        console.warn('[Socratic Reader] Node became empty before setStart');
        return null;
      }

      // Final validation before setting range
      if (actualNodeOffset > nodeLength) {
        console.error('[Socratic Reader] Calculated start offset exceeds node length:', {
          actualNodeOffset,
          nodeLength,
          nodeText: nodeRange.node.textContent?.slice(0, 50),
        });
        return null;
      }

      try {
        range.setStart(nodeRange.node, actualNodeOffset);
        foundStart = true;
      } catch (e) {
        console.error('[Socratic Reader] setStart failed despite validation:', {
          error: e,
          actualNodeOffset,
          nodeLength,
          nodeText: nodeRange.node.textContent,
        });
        return null;
      }
    }

    // Find end position
    if (foundStart && !foundEnd && cappedEnd > nodeStart && cappedEnd <= nodeEnd) {
      // Map from chunk offset to node offset
      const offsetIntoNodeContribution = cappedEnd - nodeStart;
      const actualNodeOffset = nodeRange.start + offsetIntoNodeContribution;

      // Re-check node length immediately before using it (race condition protection)
      const nodeLength = nodeRange.node.textContent?.length ?? 0;

      if (nodeLength === 0) {
        console.warn('[Socratic Reader] Node became empty before setEnd');
        return null;
      }

      // Final validation before setting range
      if (actualNodeOffset > nodeLength) {
        console.error('[Socratic Reader] Calculated end offset exceeds node length:', {
          actualNodeOffset,
          nodeLength,
          nodeText: nodeRange.node.textContent?.slice(0, 50),
        });
        return null;
      }

      try {
        range.setEnd(nodeRange.node, actualNodeOffset);
        foundEnd = true;
        break;
      } catch (e) {
        console.error('[Socratic Reader] setEnd failed despite validation:', {
          error: e,
          actualNodeOffset,
          nodeLength,
          nodeText: nodeRange.node.textContent,
        });
        return null;
      }
    }

    currentOffset = nodeEnd;
  }

  // Handle case where end is past the last node (but we still found start)
  if (foundStart && !foundEnd) {
    const lastRange = chunk.nodeRanges[chunk.nodeRanges.length - 1];
    const nodeLength = lastRange.node.textContent?.length ?? 0;

    if (nodeLength === 0) {
      console.warn('[Socratic Reader] Last node is empty, cannot set end');
      return null;
    }

    if (lastRange.end > nodeLength) {
      console.error('[Socratic Reader] Last node range end exceeds actual length:', {
        rangeEnd: lastRange.end,
        nodeLength,
      });
      return null;
    }

    try {
      range.setEnd(lastRange.node, lastRange.end);
      foundEnd = true;
    } catch (e) {
      console.error('[Socratic Reader] Failed to set range end at last node:', e);
      return null;
    }
  }

  if (!foundStart || !foundEnd) {
    console.warn('[Socratic Reader] Could not find', !foundStart ? 'start' : 'end', 'position for offset', start, '-', end, 'in chunk with length', totalLength);
    return null;
  }

  return range;
}

/**
 * Apply highlight to a DOM range
 */
export function applyHighlight(range: Range, highlightId: string): HTMLElement | null {
  try {
    const span = document.createElement('span');
    span.className = HIGHLIGHT_CLASS;
    span.setAttribute('data-highlight-id', highlightId);
    
    // Use surroundContents for simple ranges, extractContents for complex ones
    try {
      range.surroundContents(span);
    } catch {
      // Range spans multiple elements - use alternative approach
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
    }
    
    return span;
  } catch (e) {
    console.warn('[Socratic Reader] Could not apply highlight:', e);
    return null;
  }
}

/**
 * Clear all highlights from the page
 */
export function clearHighlights(): void {
  const highlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  highlights.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      parent.normalize(); // Merge adjacent text nodes
    }
  });
}

/**
 * Scroll to and activate a highlight
 */
export function scrollToHighlight(highlightId: string): void {
  // Remove active class from all highlights
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}.${HIGHLIGHT_ACTIVE_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_ACTIVE_CLASS);
  });

  // Find and activate target highlight
  const target = document.querySelector(`[data-highlight-id="${highlightId}"]`);
  if (target) {
    target.classList.add(HIGHLIGHT_ACTIVE_CLASS);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// =============================================================================
// Overlay UI
// =============================================================================

/**
 * Create the overlay element
 */
function createOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <header class="sr-header">
      <h2 class="sr-title">Socratic Reader</h2>
      <div class="sr-header-actions">
        <button class="sr-dock-btn" aria-label="Change dock position" title="Dock: Right">⇄</button>
        <button class="sr-minimize-btn" aria-label="Minimize" title="Minimize (keep open)">−</button>
        <button class="sr-reanalyze-btn" aria-label="Re-analyze" title="Re-analyze page">↻</button>
        <button class="sr-close-btn" aria-label="Close">&times;</button>
      </div>
    </header>
    <div class="sr-cache-notice" hidden>
      <span>Showing cached results</span>
    </div>
    <div class="sr-progress" hidden>
      <div class="sr-progress-text">Analyzing...</div>
      <div class="sr-progress-bar"><div class="sr-progress-fill"></div></div>
    </div>
    <div class="sr-error" hidden></div>
    <div class="sr-empty" hidden>
      <p>No highlights found.</p>
      <p>Try selecting a different passage or scrolling to more content.</p>
    </div>
    <div class="sr-highlights-list"></div>
    <nav class="sr-highlight-nav" hidden>
      <button class="sr-nav-btn sr-prev" aria-label="Previous highlight">&larr; Prev</button>
      <span class="sr-counter">0/0</span>
      <button class="sr-nav-btn sr-next" aria-label="Next highlight">Next &rarr;</button>
    </nav>
    <div class="sr-keyboard-hint">
      <kbd>Ctrl+Shift+S</kbd> to toggle | Click ⇄ to change dock | Drag header to move (float mode)
    </div>
  `;

  // Event listeners
  overlay.querySelector('.sr-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideOverlay();
  });
  overlay.querySelector('.sr-minimize-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMinimize();
  });
  overlay.querySelector('.sr-dock-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleDockPosition();
  });
  overlay.querySelector('.sr-reanalyze-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleReanalyze();
  });
  overlay.querySelector('.sr-prev')?.addEventListener('click', () => navigateHighlight(-1));
  overlay.querySelector('.sr-next')?.addEventListener('click', () => navigateHighlight(1));

  // Drag functionality on header
  const header = overlay.querySelector('.sr-header');
  if (header) {
    header.addEventListener('mousedown', (e) => handleDragStart(e as MouseEvent));
    // Make header look draggable when in float mode
    header.setAttribute('data-draggable', 'true');
  }

  return overlay;
}

/**
 * Handle re-analyze button click
 */
async function handleReanalyze(): Promise<void> {
  // Clear cache for this URL
  await clearCachedAnalysis(window.location.href);
  // Re-run analysis
  startAnalysis(true);
}

/**
 * Show the overlay
 */
function showOverlay(): void {
  if (!overlayElement) {
    overlayElement = createOverlay();
    document.body.appendChild(overlayElement);
    restoreDockPosition();
  }
  overlayElement.classList.add('visible');
}

/**
 * Hide the overlay
 */
function hideOverlay(): void {
  if (overlayElement) {
    overlayElement.classList.remove('visible');
  }
  clearHighlights();
  currentHighlights = [];
  currentHighlightIndex = 0;
  overlayState = 'IDLE';
}

/**
 * Toggle overlay visibility
 */
function toggleOverlay(): void {
  if (overlayElement?.classList.contains('visible')) {
    hideOverlay();
  } else {
    showOverlay();
    startAnalysis();
  }
}

/**
 * Toggle minimize state
 */
function toggleMinimize(): void {
  if (!overlayElement) return;

  overlayMinimized = !overlayMinimized;
  overlayElement.classList.toggle('minimized', overlayMinimized);

  const minimizeBtn = overlayElement.querySelector('.sr-minimize-btn') as HTMLButtonElement | null;
  if (minimizeBtn) {
    // Arrow points in the direction the overlay will expand
    const expandIcon = overlayDockPosition === 'left' ? '▶' : '◀';
    minimizeBtn.textContent = overlayMinimized ? expandIcon : '−';
    minimizeBtn.setAttribute('aria-label', overlayMinimized ? 'Expand overlay' : 'Minimize overlay');
    minimizeBtn.title = overlayMinimized ? 'Expand overlay' : 'Minimize (keep open)';
  }

  // Save minimize state
  try {
    localStorage.setItem('socratic-reader-minimized', String(overlayMinimized));
  } catch (e) {
    // Ignore localStorage errors
  }
}

/**
 * Cycle through dock positions: right → left → float → right
 */
function cycleDockPosition(): void {
  if (!overlayElement) return;

  // Remove current dock class and styles
  overlayElement.classList.remove('dock-right', 'dock-left', 'dock-float');
  overlayElement.style.left = '';
  overlayElement.style.top = '';
  overlayElement.style.right = '';
  overlayElement.style.transform = '';

  // Cycle to next position
  if (overlayDockPosition === 'right') {
    overlayDockPosition = 'left';
  } else if (overlayDockPosition === 'left') {
    overlayDockPosition = 'float';
  } else {
    overlayDockPosition = 'right';
  }

  // Apply new dock class
  if (overlayDockPosition !== 'right') {
    overlayElement.classList.add(`dock-${overlayDockPosition}`);
  }

  // For floating mode, apply saved position or center it
  if (overlayDockPosition === 'float') {
    if (floatingPosition) {
      applyFloatingPosition();
    } else {
      // Center on first use - wait for next frame to get correct dimensions
      requestAnimationFrame(() => {
        if (!overlayElement) return;
        const rect = overlayElement.getBoundingClientRect();
        floatingPosition = {
          x: (window.innerWidth - rect.width) / 2,
          y: Math.max(20, (window.innerHeight - rect.height) / 2)
        };
        applyFloatingPosition();
        saveFloatingPosition();
      });
    }
  }

  // Update button tooltip
  const dockBtn = overlayElement.querySelector('.sr-dock-btn') as HTMLButtonElement | null;
  if (dockBtn) {
    const positions = { right: 'Right', left: 'Left', float: 'Floating (drag to move)' };
    dockBtn.title = `Dock: ${positions[overlayDockPosition]}`;
  }

  // Update minimize button icon if currently minimized
  if (overlayMinimized) {
    const minimizeBtn = overlayElement.querySelector('.sr-minimize-btn') as HTMLButtonElement | null;
    if (minimizeBtn) {
      const expandIcon = overlayDockPosition === 'left' ? '▶' : '◀';
      minimizeBtn.textContent = expandIcon;
    }
  }

  // Save preference
  try {
    localStorage.setItem('socratic-reader-dock', overlayDockPosition);
  } catch (e) {
    // Ignore localStorage errors
  }
}

/**
 * Restore saved dock position and minimize state
 */
function restoreDockPosition(): void {
  try {
    // Restore dock position
    const saved = localStorage.getItem('socratic-reader-dock') as DockPosition | null;
    if (saved && ['right', 'left', 'float'].includes(saved)) {
      overlayDockPosition = saved;
      if (overlayElement && saved !== 'right') {
        overlayElement.classList.add(`dock-${saved}`);
      }
    }

    // Restore floating position
    if (overlayDockPosition === 'float') {
      const savedPos = localStorage.getItem('socratic-reader-float-position');
      if (savedPos) {
        try {
          floatingPosition = JSON.parse(savedPos);
          applyFloatingPosition();
        } catch (e) {
          // Invalid JSON, ignore
        }
      }
    }

    // Restore minimize state
    const minimized = localStorage.getItem('socratic-reader-minimized');
    if (minimized === 'true') {
      overlayMinimized = true;
      overlayElement?.classList.add('minimized');
      const minimizeBtn = overlayElement?.querySelector('.sr-minimize-btn') as HTMLButtonElement | null;
      if (minimizeBtn) {
        const expandIcon = overlayDockPosition === 'left' ? '▶' : '◀';
        minimizeBtn.textContent = expandIcon;
        minimizeBtn.title = 'Expand overlay';
        minimizeBtn.setAttribute('aria-label', 'Expand overlay');
      }
    }
  } catch (e) {
    // Ignore localStorage errors
  }
}

/**
 * Handle drag start
 */
function handleDragStart(e: MouseEvent): void {
  const target = e.target as HTMLElement;

  // Don't drag if clicking on buttons or interactive elements
  if (target.tagName === 'BUTTON' || target.closest('button')) {
    return;
  }

  // Only allow dragging in float mode
  if (overlayDockPosition !== 'float') {
    return;
  }

  // Don't drag if clicking on input/textarea
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  if (overlayElement) {
    const rect = overlayElement.getBoundingClientRect();
    overlayStartX = rect.left;
    overlayStartY = rect.top;
    overlayElement.style.cursor = 'grabbing';
  }

  // Add global listeners
  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);

  e.preventDefault();
}

/**
 * Handle drag move
 */
function handleDragMove(e: MouseEvent): void {
  if (!isDragging || !overlayElement) return;

  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;

  const newX = overlayStartX + deltaX;
  const newY = overlayStartY + deltaY;

  // Apply position
  overlayElement.style.left = `${newX}px`;
  overlayElement.style.top = `${newY}px`;
  overlayElement.style.right = 'auto';
  overlayElement.style.transform = 'none';

  // Show snap zones when near edges
  const rect = overlayElement.getBoundingClientRect();
  const windowWidth = window.innerWidth;

  if (rect.left < SNAP_THRESHOLD) {
    showSnapZone('left');
  } else if (windowWidth - rect.right < SNAP_THRESHOLD) {
    showSnapZone('right');
  } else {
    hideSnapZones();
  }

  e.preventDefault();
}

/**
 * Handle drag end
 */
function handleDragEnd(e: MouseEvent): void {
  if (!isDragging || !overlayElement) return;

  isDragging = false;
  overlayElement.style.cursor = '';

  // Remove global listeners
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);

  // Hide snap zones
  hideSnapZones();

  // Check for snap to edges
  const rect = overlayElement.getBoundingClientRect();
  const windowWidth = window.innerWidth;

  // Snap to left edge
  if (rect.left < SNAP_THRESHOLD) {
    overlayDockPosition = 'left';
    switchToDock('left');
    return;
  }

  // Snap to right edge
  if (windowWidth - rect.right < SNAP_THRESHOLD) {
    overlayDockPosition = 'right';
    switchToDock('right');
    return;
  }

  // Save floating position
  floatingPosition = { x: rect.left, y: rect.top };
  saveFloatingPosition();
}

/**
 * Create snap zone indicators
 */
function createSnapZones(): void {
  if (snapZoneLeft && snapZoneRight) return;

  snapZoneLeft = document.createElement('div');
  snapZoneLeft.className = 'socratic-snap-zone left';
  document.body.appendChild(snapZoneLeft);

  snapZoneRight = document.createElement('div');
  snapZoneRight.className = 'socratic-snap-zone right';
  document.body.appendChild(snapZoneRight);
}

/**
 * Show snap zone
 */
function showSnapZone(side: 'left' | 'right'): void {
  createSnapZones();

  if (side === 'left') {
    snapZoneLeft?.classList.add('visible');
    snapZoneRight?.classList.remove('visible');
  } else {
    snapZoneRight?.classList.add('visible');
    snapZoneLeft?.classList.remove('visible');
  }
}

/**
 * Hide snap zones
 */
function hideSnapZones(): void {
  snapZoneLeft?.classList.remove('visible');
  snapZoneRight?.classList.remove('visible');
}

/**
 * Switch to docked mode
 */
function switchToDock(position: 'left' | 'right'): void {
  if (!overlayElement) return;

  // Remove float mode
  overlayElement.classList.remove('dock-float');
  overlayElement.style.left = '';
  overlayElement.style.top = '';
  overlayElement.style.right = '';
  overlayElement.style.transform = '';

  // Apply dock
  if (position === 'left') {
    overlayElement.classList.add('dock-left');
    overlayElement.classList.remove('dock-right');
  } else {
    overlayElement.classList.remove('dock-left');
    overlayElement.classList.remove('dock-right');
  }

  overlayDockPosition = position;

  // Update dock button
  const dockBtn = overlayElement.querySelector('.sr-dock-btn') as HTMLButtonElement | null;
  if (dockBtn) {
    const positions = { right: 'Right', left: 'Left', float: 'Floating' };
    dockBtn.title = `Dock: ${positions[overlayDockPosition]}`;
  }

  // Save preference
  try {
    localStorage.setItem('socratic-reader-dock', overlayDockPosition);
  } catch (e) {
    // Ignore
  }
}

/**
 * Apply floating position
 */
function applyFloatingPosition(): void {
  if (!overlayElement || !floatingPosition) return;

  // Use requestAnimationFrame to ensure styles are applied after class changes
  requestAnimationFrame(() => {
    if (!overlayElement || !floatingPosition) return;
    overlayElement.style.left = `${floatingPosition.x}px`;
    overlayElement.style.top = `${floatingPosition.y}px`;
    overlayElement.style.right = 'auto';
    overlayElement.style.transform = 'none';
  });
}

/**
 * Save floating position
 */
function saveFloatingPosition(): void {
  if (!floatingPosition) return;

  try {
    localStorage.setItem('socratic-reader-float-position', JSON.stringify(floatingPosition));
  } catch (e) {
    // Ignore
  }
}

/**
 * Update overlay state display
 */
function updateOverlayState(): void {
  if (!overlayElement) return;
  
  const progress = overlayElement.querySelector('.sr-progress') as HTMLElement;
  const error = overlayElement.querySelector('.sr-error') as HTMLElement;
  const empty = overlayElement.querySelector('.sr-empty') as HTMLElement;
  const list = overlayElement.querySelector('.sr-highlights-list') as HTMLElement;
  const nav = overlayElement.querySelector('.sr-highlight-nav') as HTMLElement;
  const cacheNotice = overlayElement.querySelector('.sr-cache-notice') as HTMLElement;
  
  // Hide all sections first
  progress.hidden = true;
  error.hidden = true;
  empty.hidden = true;
  list.innerHTML = '';
  nav.hidden = true;
  cacheNotice.hidden = true;
  
  switch (overlayState) {
    case 'EXTRACTING':
    case 'ANALYZING':
      progress.hidden = false;
      break;
    case 'ERROR':
      error.hidden = false;
      break;
    case 'DISPLAYING':
      if (currentHighlights.length === 0) {
        empty.hidden = false;
      } else {
        if (isFromCache) {
          cacheNotice.hidden = false;
        }
        renderHighlightsList();
        nav.hidden = false;
        updateNavCounter();
      }
      break;
  }
}

/**
 * Update progress display
 */
function updateProgress(current: number, total: number, text?: string): void {
  if (!overlayElement) return;
  
  const progressText = overlayElement.querySelector('.sr-progress-text');
  const progressFill = overlayElement.querySelector('.sr-progress-fill') as HTMLElement;
  
  if (progressText) {
    progressText.textContent = text ?? `Analyzing chunk ${current}/${total}...`;
  }
  if (progressFill) {
    progressFill.style.width = `${(current / total) * 100}%`;
  }
}

/**
 * Show error message
 */
function showError(message: string): void {
  overlayState = 'ERROR';
  if (overlayElement) {
    const error = overlayElement.querySelector('.sr-error');
    if (error) {
      error.textContent = message;
    }
  }
  updateOverlayState();
}

/**
 * Render the highlights list
 */
async function renderHighlightsList(): Promise<void> {
  if (!overlayElement) return;
  
  const list = overlayElement.querySelector('.sr-highlights-list');
  if (!list) return;
  
  // Load saved notes for this URL
  const savedNotes = await getNotes(window.location.href);
  const notesMap = new Map(savedNotes.map(n => [n.highlightId, n]));
  
  list.innerHTML = currentHighlights.map((h, i) => {
    const savedNote = notesMap.get(h.id);
    const isActive = i === currentHighlightIndex;
    
    return `
      <div class="sr-highlight-item ${isActive ? 'active' : ''}" data-index="${i}" data-id="${h.id}">
        <div class="sr-highlight-header" role="button" tabindex="0">
          <span class="sr-highlight-number">${i + 1}</span>
          <p class="sr-claim">"${escapeHtml(h.text.slice(0, 100))}${h.text.length > 100 ? '...' : ''}"</p>
        </div>
        <div class="sr-highlight-content">
          <div class="sr-reason">
            <strong>Why it matters:</strong> ${escapeHtml(h.reason)}
          </div>
          <div class="sr-question">
            <strong>Question:</strong> ${escapeHtml(h.question)}
          </div>
          <div class="sr-explanation">
            ${escapeHtml(h.explanation)}
          </div>
          <div class="sr-notes">
            <textarea 
              class="sr-note-input" 
              placeholder="Your notes..."
              data-id="${h.id}"
            >${savedNote?.note ?? ''}</textarea>
            <div class="sr-note-actions">
              <button class="sr-save-note" data-id="${h.id}">Save Note</button>
              ${savedNote ? `<button class="sr-delete-note" data-id="${h.id}">Delete</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  list.querySelectorAll('.sr-highlight-header').forEach((header) => {
    header.addEventListener('click', (e) => {
      const item = (e.currentTarget as HTMLElement).closest('.sr-highlight-item');

      // Normal click: toggle collapse
      item?.classList.toggle('collapsed');

      // Prevent default to avoid text selection
      e.preventDefault();
    });
  });

  // Click on highlight number to select/scroll to highlight
  list.querySelectorAll('.sr-highlight-number').forEach((num) => {
    num.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger header collapse
      const item = (e.currentTarget as HTMLElement).closest('.sr-highlight-item');
      const index = parseInt(item?.getAttribute('data-index') ?? '0', 10);
      selectHighlight(index);
    });
  });
  
  list.querySelectorAll('.sr-save-note').forEach((btn) => {
    btn.addEventListener('click', handleSaveNote);
  });
  
  list.querySelectorAll('.sr-delete-note').forEach((btn) => {
    btn.addEventListener('click', handleDeleteNote);
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Select a highlight by index
 */
function selectHighlight(index: number): void {
  if (index < 0 || index >= currentHighlights.length) return;
  
  currentHighlightIndex = index;
  const highlight = currentHighlights[index];
  
  // Update UI
  if (overlayElement) {
    overlayElement.querySelectorAll('.sr-highlight-item').forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });
  }
  
  // Scroll to highlight in page
  scrollToHighlight(highlight.id);
  updateNavCounter();
}

/**
 * Navigate to prev/next highlight
 */
function navigateHighlight(direction: number): void {
  let newIndex = currentHighlightIndex + direction;
  
  // Wrap around
  if (newIndex < 0) newIndex = currentHighlights.length - 1;
  if (newIndex >= currentHighlights.length) newIndex = 0;
  
  selectHighlight(newIndex);
}

/**
 * Update navigation counter
 */
function updateNavCounter(): void {
  if (!overlayElement) return;
  
  const counter = overlayElement.querySelector('.sr-counter');
  if (counter) {
    counter.textContent = `${currentHighlightIndex + 1}/${currentHighlights.length}`;
  }
}

/**
 * Handle save note button click
 */
async function handleSaveNote(e: Event): Promise<void> {
  const btn = e.currentTarget as HTMLElement;
  const highlightId = btn.getAttribute('data-id');
  if (!highlightId) return;
  
  const highlight = currentHighlights.find(h => h.id === highlightId);
  if (!highlight) return;
  
  const textarea = overlayElement?.querySelector(
    `.sr-note-input[data-id="${highlightId}"]`
  ) as HTMLTextAreaElement;
  const noteText = textarea?.value?.trim() ?? '';
  
  if (!noteText) return;
  
  const note: SavedNote = {
    highlightId,
    url: window.location.href,
    start: highlight.start,
    end: highlight.end,
    text: highlight.text.slice(0, 100), // Short snippet only
    note: noteText,
    createdAt: Date.now(),
    anchor: highlight.anchor, // Include robust anchor for re-mapping
  };

  await saveNote(note);
  
  // Update button state
  btn.textContent = 'Saved!';
  setTimeout(() => {
    btn.textContent = 'Save Note';
  }, 1500);
  
  // Re-render to show delete button
  renderHighlightsList();
}

/**
 * Handle delete note button click
 */
async function handleDeleteNote(e: Event): Promise<void> {
  const btn = e.currentTarget as HTMLElement;
  const highlightId = btn.getAttribute('data-id');
  if (!highlightId) return;
  
  await deleteNote(window.location.href, highlightId);
  
  // Re-render
  renderHighlightsList();
}

// =============================================================================
// Analysis Flow
// =============================================================================

/**
 * Apply cached highlights to the page
 */
function applyCachedHighlights(
  cachedHighlights: Highlight[],
  chunks: TextChunk[]
): void {
  let highlightCounter = 0;

  // Process all highlights first (in original reading order)
  const processed: ProcessedHighlight[] = [];

  // Cached highlights have global offsets, need to map to chunks
  for (const h of cachedHighlights) {
    // Find which chunk this highlight belongs to
    let chunkIndex = 0;
    let localStart = h.start;
    let localEnd = h.end;

    for (let i = 0; i < chunks.length; i++) {
      const chunkEnd = chunks[i].globalOffset + chunks[i].text.length;
      if (h.start >= chunks[i].globalOffset && h.start < chunkEnd) {
        chunkIndex = i;
        localStart = h.start - chunks[i].globalOffset;
        localEnd = h.end - chunks[i].globalOffset;
        break;
      }
    }

    const id = `h-${highlightCounter++}`;
    const chunk = chunks[chunkIndex];
    const text = chunk.text.slice(localStart, localEnd);
    const range = offsetToRange(chunk, localStart, localEnd);

    // Create robust anchor for persistent re-mapping
    const anchor = range ? describeRange(range, document.body) : undefined;

    const processedHighlight: ProcessedHighlight = {
      ...h,
      start: localStart,
      end: localEnd,
      id,
      text,
      range,
      chunkIndex,
      anchor,
    };

    processed.push(processedHighlight);
  }

  // Apply to DOM in REVERSE order (end to start) to prevent invalidation
  // When we wrap text in spans, it modifies the DOM. Applying from end to start
  // ensures earlier highlights don't invalidate later ones.
  const reversedForDOM = [...processed].reverse();
  for (const ph of reversedForDOM) {
    if (ph.range) {
      applyHighlight(ph.range, ph.id);
    }
  }

  // Add to currentHighlights in original reading order for sidebar display
  currentHighlights.push(...processed);
}

/**
 * Start the analysis process
 */
async function startAnalysis(forceRefresh: boolean = false): Promise<void> {
  // Clear previous state
  clearHighlights();
  currentHighlights = [];
  currentHighlightIndex = 0;
  isFromCache = false;
  
  // Extract text
  overlayState = 'EXTRACTING';
  updateOverlayState();
  updateProgress(0, 1, 'Extracting text...');
  
  const extracted = extractText();
  if (!extracted) {
    showError('No text found. Please select text or scroll to content.');
    return;
  }
  
  // Chunk text
  const chunks = chunkText(extracted.text, extracted.nodeRanges);
  
  // Check cache (unless forcing refresh)
  if (!forceRefresh) {
    try {
      const cacheResult = await getCachedAnalysis(window.location.href, extracted.text);
      if (cacheResult.highlights && cacheResult.highlights.length > 0) {
        console.log('[Socratic Reader] Using cached analysis');
        lastContentHash = cacheResult.contentHash;
        isFromCache = true;
        
        // Apply cached highlights
        applyCachedHighlights(cacheResult.highlights, chunks);

        // Display results
        overlayState = 'DISPLAYING';
        updateOverlayState();

        if (currentHighlights.length > 0) {
          selectHighlight(0);
        }

        // Setup hover tooltips
        setupHighlightHoverListeners();
        return;
      }
    } catch (e) {
      console.warn('[Socratic Reader] Cache check failed:', e);
    }
  }

  // Analyze chunks
  overlayState = 'ANALYZING';
  updateOverlayState();

  // Optional: Prioritize chunks by salience (analyze argument-rich chunks first)
  // Uncomment to enable salience-based prioritization:
  // const priorityOrder = chunks
  //   .map((chunk, index) => ({ index, salience: chunk.salience ?? 0 }))
  //   .sort((a, b) => b.salience - a.salience)
  //   .map(item => item.index);

  // For now, analyze in document order
  const priorityOrder = chunks.map((_, index) => index);

  let highlightCounter = 0;
  const allHighlightsForCache: Highlight[] = [];

  for (let orderIdx = 0; orderIdx < priorityOrder.length; orderIdx++) {
    const i = priorityOrder[orderIdx];
    updateProgress(orderIdx + 1, chunks.length);
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'ANALYZE_CHUNK',
        chunkText: chunks[i].text,
        chunkIndex: i,
        url: window.location.href,
      }) as AnalyzeChunkResponse;

      // Check for null/undefined response (background script crash/timeout)
      if (!response) {
        console.error(`[Socratic Reader] Chunk ${i}: No response from background script`);
        if (i === 0 && chunks.length === 1) {
          showError('Analysis failed: No response from background script. Try reloading the extension.');
          return;
        }
        continue;
      }

      if (response.error) {
        console.warn(`[Socratic Reader] Chunk ${i} error:`, response.error);

        // Show error for first chunk, continue for others
        if (i === 0 && chunks.length === 1) {
          showError(response.error);
          return;
        }
        continue;
      }
      
      if (response.highlights) {
        // Process all highlights first (in original order for display)
        const processedForChunk: ProcessedHighlight[] = [];

        for (const h of response.highlights) {
          const id = `h-${highlightCounter++}`;
          const text = chunks[i].text.slice(h.start, h.end);
          const range = offsetToRange(chunks[i], h.start, h.end);

          // Create robust anchor for persistent re-mapping
          const anchor = range ? describeRange(range, document.body) : undefined;

          const processedHighlight: ProcessedHighlight = {
            ...h,
            id,
            text,
            range,
            chunkIndex: i,
            anchor,
          };

          processedForChunk.push(processedHighlight);

          // Store with global offset for cache
          allHighlightsForCache.push({
            ...h,
            start: h.start + chunks[i].globalOffset,
            end: h.end + chunks[i].globalOffset,
          });
        }

        // Apply to DOM in REVERSE order (end to start)
        // This prevents earlier highlights from invalidating later ones when we modify the DOM
        const reversedForDOM = [...processedForChunk].reverse();
        for (const ph of reversedForDOM) {
          if (ph.range) {
            applyHighlight(ph.range, ph.id);
          }
        }

        // Add to currentHighlights in original reading order
        currentHighlights.push(...processedForChunk);
      }
    } catch (e) {
      // Check if it's a message channel error
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[Socratic Reader] Chunk ${i} error:`, errorMsg, e);

      // Check for Chrome runtime error
      if (chrome.runtime.lastError) {
        console.error(`[Socratic Reader] Chrome runtime error:`, chrome.runtime.lastError);
      }

      if (i === 0 && chunks.length === 1) {
        if (errorMsg.includes('message channel')) {
          showError('Analysis timed out. The text might be too complex or the API might be slow. Try selecting a smaller portion of text.');
        } else {
          showError(errorMsg);
        }
        return;
      }
    }
  }
  
  // Save to cache
  if (allHighlightsForCache.length > 0) {
    try {
      const cacheResult = await getCachedAnalysis(window.location.href, extracted.text);
      lastContentHash = cacheResult.contentHash;
      await setCachedAnalysis(window.location.href, allHighlightsForCache, lastContentHash);
      console.log('[Socratic Reader] Saved analysis to cache');
    } catch (e) {
      console.warn('[Socratic Reader] Failed to save cache:', e);
    }
  }
  
  // Display results
  overlayState = 'DISPLAYING';
  updateOverlayState();

  // Select first highlight
  if (currentHighlights.length > 0) {
    selectHighlight(0);
  }

  // Setup hover tooltips
  setupHighlightHoverListeners();
  
  // Check if any highlights failed to apply
  const failedHighlights = currentHighlights.filter(h => !h.range);
  if (failedHighlights.length > 0 && failedHighlights.length === currentHighlights.length) {
    // All highlights failed - show warning
    if (overlayElement) {
      const list = overlayElement.querySelector('.sr-highlights-list');
      if (list) {
        const warning = document.createElement('div');
        warning.className = 'sr-warning';
        warning.textContent = 'Could not highlight on this page. Results shown in sidebar only.';
        list.insertBefore(warning, list.firstChild);
      }
    }
  }
}

// =============================================================================
// Message Handling
// =============================================================================

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'TOGGLE_OVERLAY') {
    toggleOverlay();
  }
});

// =============================================================================
// Highlight Restoration
// =============================================================================

/**
 * Restore saved highlights on page load using robust anchoring
 */
async function restoreHighlights(): Promise<void> {
  try {
    const pageUrl = window.location.href;
    const savedNotes = await getNotes(pageUrl);

    if (savedNotes.length === 0) {
      console.log('[Socratic Reader] No saved highlights to restore');
      return;
    }

    console.log(`[Socratic Reader] Restoring ${savedNotes.length} saved highlights...`);

    let successCount = 0;
    const restored: ProcessedHighlight[] = [];

    for (const note of savedNotes) {
      if (!note.anchor) {
        console.warn(`[Socratic Reader] No anchor for highlight ${note.highlightId}, skipping`);
        continue;
      }

      // Re-anchor using robust anchoring
      const result = await anchorToRange(note.anchor, document.body);

      if (result && result.score >= 0.7) {
        // Apply highlight to DOM
        applyHighlight(result.range, note.highlightId);

        // Create ProcessedHighlight for reference
        const processedHighlight: ProcessedHighlight = {
          start: note.start,
          end: note.end,
          reason: '', // Not needed for restored highlights
          question: '', // Not needed for restored highlights
          explanation: note.note,
          id: note.highlightId,
          text: note.text,
          range: result.range,
          chunkIndex: 0, // Not relevant for restored highlights
          anchor: note.anchor,
        };

        restored.push(processedHighlight);
        successCount++;

        const scorePercent = Math.round(result.score * 100);
        console.log(
          `[Socratic Reader] ✓ Re-anchored ${note.highlightId} using ${result.method} (${scorePercent}% confidence)`
        );
      } else {
        console.warn(
          `[Socratic Reader] ✗ Failed to re-anchor ${note.highlightId} (score: ${result?.score ?? 0})`
        );
      }
    }

    if (successCount > 0) {
      console.log(`[Socratic Reader] Successfully restored ${successCount}/${savedNotes.length} highlights`);

      // Store restored highlights for reference (they won't appear in the analysis overlay)
      // but they'll be visible on the page
    }
  } catch (error) {
    console.error('[Socratic Reader] Error restoring highlights:', error);
  }
}

// =============================================================================
// Keyboard Shortcuts & Hover Tooltips
// =============================================================================

/**
 * Handle keyboard shortcuts
 */
function handleKeyboardShortcut(e: KeyboardEvent): void {
  // Ctrl+Shift+S (or Cmd+Shift+S on Mac) to toggle overlay
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    toggleOverlay();
  }

  // Escape to close overlay
  if (e.key === 'Escape' && overlayElement?.classList.contains('visible')) {
    e.preventDefault();
    hideOverlay();
  }
}

/**
 * Create and show hover tooltip
 */
function showHighlightTooltip(highlight: HTMLElement, text: string): void {
  // Remove existing tooltip
  if (tooltipElement) {
    document.body.removeChild(tooltipElement);
  }

  // Create tooltip
  tooltipElement = document.createElement('div');
  tooltipElement.className = 'socratic-highlight-tooltip';
  tooltipElement.textContent = text;
  document.body.appendChild(tooltipElement);

  // Position tooltip
  const rect = highlight.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();

  let top = rect.top - tooltipRect.height - 10;
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

  // Keep tooltip in viewport
  if (top < 10) {
    top = rect.bottom + 10;
  }
  if (left < 10) {
    left = 10;
  }
  if (left + tooltipRect.width > window.innerWidth - 10) {
    left = window.innerWidth - tooltipRect.width - 10;
  }

  tooltipElement.style.top = `${top + window.scrollY}px`;
  tooltipElement.style.left = `${left + window.scrollX}px`;

  // Fade in
  requestAnimationFrame(() => {
    tooltipElement?.classList.add('visible');
  });
}

/**
 * Hide hover tooltip
 */
function hideHighlightTooltip(): void {
  if (tooltipElement) {
    tooltipElement.classList.remove('visible');
    setTimeout(() => {
      if (tooltipElement && document.body.contains(tooltipElement)) {
        document.body.removeChild(tooltipElement);
      }
      tooltipElement = null;
    }, 200);
  }
}

/**
 * Setup highlight hover listeners
 */
function setupHighlightHoverListeners(): void {
  // Add hover listeners to all highlighted elements
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((highlight) => {
    const el = highlight as HTMLElement;
    let hoverTimeout: number;

    el.addEventListener('mouseenter', () => {
      hoverTimeout = window.setTimeout(() => {
        const highlightId = el.dataset.highlightId;
        const highlightData = currentHighlights.find(h => h.id === highlightId);
        if (highlightData) {
          const preview = `${highlightData.question}\n\n${highlightData.explanation.slice(0, 150)}...`;
          showHighlightTooltip(el, preview);
        }
      }, 500); // Show after 500ms hover
    });

    el.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
      hideHighlightTooltip();
    });
  });
}

// =============================================================================
// Initialization
// =============================================================================

console.log('[Socratic Reader] Content script loaded');

// Add keyboard shortcut listener
document.addEventListener('keydown', handleKeyboardShortcut);

// Restore saved highlights when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    restoreHighlights();
  });
} else {
  // DOM already loaded
  restoreHighlights();
}
