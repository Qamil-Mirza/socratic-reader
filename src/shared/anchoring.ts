/**
 * Robust text anchoring system for persistent highlights
 *
 * Inspired by Hypothes.is anchoring strategies:
 * 1. Text Position (fast, fragile)
 * 2. Text Quote (robust, slower)
 * 3. Range (precise with context)
 *
 * Uses Text Fragments API when available for browser-native anchoring.
 */

/**
 * Serializable anchor descriptor that can persist across page reloads
 */
export interface TextAnchor {
  // Text Quote selector (primary strategy)
  exact: string;           // The exact text being anchored
  prefix: string;          // Text before (for disambiguation)
  suffix: string;          // Text after (for disambiguation)

  // Text Position selector (fallback)
  start: number;           // Character offset from document start
  end: number;             // Character offset from document end

  // Additional hints for robustness
  hints?: {
    xpath?: string;        // XPath to containing element
    cssSelector?: string;  // CSS selector path
    textFragment?: string; // Text Fragment URL format
  };
}

/**
 * Result of anchoring operation
 */
export interface AnchorResult {
  range: Range;
  exact: string;
  score: number;           // Confidence score 0-1
  method: 'exact' | 'fuzzy' | 'position' | 'fragment';
}

// Configuration
const CONTEXT_LENGTH = 32;  // Characters of prefix/suffix to capture
const FUZZY_THRESHOLD = 0.8; // Minimum similarity for fuzzy match

/**
 * Creates a robust anchor descriptor from a DOM Range
 */
export function describeRange(range: Range, root: Node = document.body): TextAnchor {
  const exact = range.toString();
  const { prefix, suffix } = getContext(range, CONTEXT_LENGTH);
  const { start, end } = getTextPosition(range, root);

  return {
    exact,
    prefix,
    suffix,
    start,
    end,
    hints: {
      xpath: getXPath(range.commonAncestorContainer),
      cssSelector: getCssSelector(range.commonAncestorContainer),
      textFragment: createTextFragmentUrl(exact, prefix, suffix)
    }
  };
}

/**
 * Re-anchors a persisted descriptor to the current DOM
 * Returns the best matching Range
 */
export async function anchor(
  descriptor: TextAnchor,
  root: Node = document.body
): Promise<AnchorResult | null> {
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

  // Strategy 2: Try Text Fragments API (if available)
  if (descriptor.hints?.textFragment && 'fragmentDirective' in document) {
    const fragmentMatch = await findByTextFragment(descriptor.hints.textFragment, root);
    if (fragmentMatch) {
      return {
        range: fragmentMatch,
        exact: fragmentMatch.toString(),
        score: 0.95,
        method: 'fragment'
      };
    }
  }

  // Strategy 3: Try fuzzy quote match (handles minor text changes)
  const fuzzyMatch = findFuzzyQuote(descriptor, root);
  if (fuzzyMatch && fuzzyMatch.score >= FUZZY_THRESHOLD) {
    return fuzzyMatch;
  }

  // Strategy 4: Fall back to position-based (least reliable)
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
function getContext(range: Range, contextLength: number): { prefix: string; suffix: string } {
  const root = document.body;
  const textNodes = getTextNodesInRange(root);
  const text = textNodes.map(n => n.textContent).join('');

  const rangeStart = getTextOffset(range.startContainer, range.startOffset, root);
  const rangeEnd = getTextOffset(range.endContainer, range.endOffset, root);

  const prefix = text.slice(Math.max(0, rangeStart - contextLength), rangeStart);
  const suffix = text.slice(rangeEnd, rangeEnd + contextLength);

  return { prefix, suffix };
}

/**
 * Gets text position (character offset) of a range
 */
function getTextPosition(range: Range, root: Node): { start: number; end: number } {
  const start = getTextOffset(range.startContainer, range.startOffset, root);
  const end = getTextOffset(range.endContainer, range.endOffset, root);
  return { start, end };
}

/**
 * Calculates character offset from root to a position in a node
 */
function getTextOffset(node: Node, offset: number, root: Node): number {
  const textNodes = getTextNodesInRange(root);
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
  const textNodes = getTextNodesInRange(root);
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
  const textNodes = getTextNodesInRange(root);
  const fullText = textNodes.map(n => n.textContent).join('');

  // Search window: look for similar text in the general area
  const searchLength = exact.length;
  const searchWindowSize = searchLength + 50; // Allow some flex

  let bestMatch: { start: number; score: number; text: string } | null = null;

  // Slide window across text
  for (let i = 0; i < fullText.length - searchLength + 50; i++) {
    const candidate = fullText.slice(i, i + searchWindowSize);
    const score = similarity(exact, candidate.slice(0, searchLength));

    if (score > FUZZY_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
      // Check context for disambiguation
      const actualPrefix = fullText.slice(Math.max(0, i - CONTEXT_LENGTH), i);
      const actualSuffix = fullText.slice(i + searchLength, i + searchLength + CONTEXT_LENGTH);

      const contextScore = (
        similarity(prefix, actualPrefix) +
        similarity(suffix, actualSuffix)
      ) / 2;

      if (contextScore > 0.7) {
        bestMatch = { start: i, score, text: candidate.slice(0, searchLength) };
      }
    }
  }

  if (!bestMatch) return null;

  const range = createRangeFromOffset(
    bestMatch.start,
    bestMatch.start + searchLength,
    textNodes
  );

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
  const textNodes = getTextNodesInRange(root);
  const fullText = textNodes.map(n => n.textContent).join('');

  // Check if position is still valid
  if (descriptor.start >= fullText.length || descriptor.end > fullText.length) {
    return null;
  }

  return createRangeFromOffset(descriptor.start, descriptor.end, textNodes);
}

/**
 * Text Fragments API anchoring (browser-native)
 */
async function findByTextFragment(fragment: string, root: Node): Promise<Range | null> {
  // Text Fragments API is experimental and browser-specific
  // This is a simplified implementation
  // In production, you might use the browser's native implementation

  // Parse fragment: #:~:text=[prefix-,]textStart[,textEnd][,-suffix]
  const match = fragment.match(/:~:text=(?:([^-]*)-,)?([^,]+)(?:,([^,]+))?(?:,-(.+))?/);
  if (!match) return null;

  const [, prefix, textStart, textEnd, suffix] = match;

  // Create descriptor and use regular anchoring
  const descriptor: TextAnchor = {
    exact: textEnd ? `${textStart}${textEnd}` : textStart,
    prefix: prefix || '',
    suffix: suffix || '',
    start: 0,
    end: 0
  };

  return findQuote(descriptor, root);
}

/**
 * Creates a Text Fragment URL string
 * Format: :~:text=[prefix-,]textStart[,textEnd][,-suffix]
 */
function createTextFragmentUrl(exact: string, prefix: string, suffix: string): string {
  const encode = (s: string) => encodeURIComponent(s.trim());

  let fragment = ':~:text=';

  if (prefix) {
    fragment += `${encode(prefix)}-,`;
  }

  // For long text, use textStart,textEnd format
  if (exact.length > 80) {
    const start = exact.slice(0, 40);
    const end = exact.slice(-40);
    fragment += `${encode(start)},${encode(end)}`;
  } else {
    fragment += encode(exact);
  }

  if (suffix) {
    fragment += `,-${encode(suffix)}`;
  }

  return fragment;
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

    // Find start position
    if (!startNode && currentOffset + nodeLength > start) {
      startNode = node;
      startOffset = start - currentOffset;
    }

    // Find end position
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
    console.error('Failed to create range:', e);
    return null;
  }
}

/**
 * Gets all text nodes under a root, filtering out non-visible nodes
 */
function getTextNodesInRange(root: Node): Text[] {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip non-visible elements
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip empty text nodes
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
 * Uses Levenshtein distance normalized
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
          newValue = Math.min(
            Math.min(newValue, lastValue),
            costs[j]
          ) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s1.length] = lastValue;
  }

  return costs[s1.length];
}

/**
 * Generates XPath for a node (hint for re-anchoring)
 */
function getXPath(node: Node): string {
  const parts: string[] = [];
  let current: Node | null = node;

  while (current && current !== document.body) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      const tagName = element.tagName.toLowerCase();

      // Count preceding siblings with same tag
      let index = 1;
      let sibling = element.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === element.tagName) index++;
        sibling = sibling.previousElementSibling;
      }

      parts.unshift(`${tagName}[${index}]`);
    }
    current = current.parentNode;
  }

  return '//' + parts.join('/');
}

/**
 * Generates CSS selector path for a node
 */
function getCssSelector(node: Node): string {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    if (node.parentElement) {
      return getCssSelector(node.parentElement);
    }
    return '';
  }

  const element = node as Element;
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add ID if present
    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break;
    }

    // Add classes
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2);
      selector += classes.map(c => `.${c}`).join('');
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Utility: Serialize anchor to JSON-safe format
 */
export function serializeAnchor(anchor: TextAnchor): string {
  return JSON.stringify(anchor);
}

/**
 * Utility: Deserialize anchor from JSON
 */
export function deserializeAnchor(json: string): TextAnchor {
  return JSON.parse(json);
}
