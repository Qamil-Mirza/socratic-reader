// Types inlined to avoid imports (required for programmatic injection)
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
}

interface SavedNote {
  highlightId: string;
  url: string;
  start: number;
  end: number;
  text: string;
  note: string;
  createdAt: number;
}

interface AnalyzeChunkResponse {
  highlights?: Highlight[];
  error?: string;
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
 * Chunk text into ~500 word segments while preserving sentence boundaries
 */
export function chunkText(text: string, nodeRanges: NodeRange[]): TextChunk[] {
  const words = text.split(/\s+/);
  
  if (words.length <= CHUNK_WORD_LIMIT) {
    return [{ text, nodeRanges, globalOffset: 0 }];
  }

  const chunks: TextChunk[] = [];
  let currentChunkStart = 0;
  let wordCount = 0;
  let lastSentenceEnd = 0;

  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      wordCount++;
    }
    
    // Track sentence boundaries
    if (/[.!?]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      lastSentenceEnd = i + 1;
    }

    // Time to split
    if (wordCount >= CHUNK_WORD_LIMIT && lastSentenceEnd > currentChunkStart) {
      const chunkText = text.slice(currentChunkStart, lastSentenceEnd).trim();
      const chunkRanges = getNodeRangesForOffset(nodeRanges, currentChunkStart, lastSentenceEnd);
      
      chunks.push({
        text: chunkText,
        nodeRanges: chunkRanges,
        globalOffset: currentChunkStart,
      });
      
      currentChunkStart = lastSentenceEnd;
      wordCount = 0;
    }
  }

  // Add remaining text
  if (currentChunkStart < text.length) {
    const chunkText = text.slice(currentChunkStart).trim();
    if (chunkText) {
      const chunkRanges = getNodeRangesForOffset(nodeRanges, currentChunkStart, text.length);
      chunks.push({
        text: chunkText,
        nodeRanges: chunkRanges,
        globalOffset: currentChunkStart,
      });
    }
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
    const rangeEnd = range.globalOffset + range.end;
    
    // Check if this range overlaps with our target range
    if (rangeEnd > startOffset && range.globalOffset < endOffset) {
      // Adjust offsets relative to chunk
      const newStart = Math.max(0, startOffset - range.globalOffset);
      const newEnd = Math.min(range.end, endOffset - range.globalOffset);
      
      result.push({
        ...range,
        start: newStart,
        end: newEnd,
        globalOffset: range.globalOffset - startOffset + newStart,
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

  const range = document.createRange();
  let foundStart = false;
  let foundEnd = false;
  let currentOffset = 0;

  for (const nodeRange of chunk.nodeRanges) {
    const nodeText = nodeRange.node.textContent ?? '';
    const nodeStart = currentOffset;
    const nodeEnd = currentOffset + nodeText.length;

    // Find start position
    if (!foundStart && start >= nodeStart && start < nodeEnd) {
      const localOffset = start - nodeStart;
      try {
        range.setStart(nodeRange.node, localOffset);
        foundStart = true;
      } catch {
        return null;
      }
    }

    // Find end position
    if (foundStart && !foundEnd && end > nodeStart && end <= nodeEnd) {
      const localOffset = end - nodeStart;
      try {
        range.setEnd(nodeRange.node, localOffset);
        foundEnd = true;
        break;
      } catch {
        return null;
      }
    }

    currentOffset = nodeEnd;
  }

  // Handle case where end is past the last node
  if (foundStart && !foundEnd) {
    const lastRange = chunk.nodeRanges[chunk.nodeRanges.length - 1];
    try {
      range.setEnd(lastRange.node, lastRange.node.textContent?.length ?? 0);
      foundEnd = true;
    } catch {
      return null;
    }
  }

  if (!foundStart || !foundEnd) {
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
  `;
  
  // Event listeners
  overlay.querySelector('.sr-close-btn')?.addEventListener('click', hideOverlay);
  overlay.querySelector('.sr-reanalyze-btn')?.addEventListener('click', handleReanalyze);
  overlay.querySelector('.sr-prev')?.addEventListener('click', () => navigateHighlight(-1));
  overlay.querySelector('.sr-next')?.addEventListener('click', () => navigateHighlight(1));
  
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
    
    const processedHighlight: ProcessedHighlight = {
      ...h,
      start: localStart,
      end: localEnd,
      id,
      text,
      range,
      chunkIndex,
    };
    
    if (range) {
      applyHighlight(range, id);
    }
    
    currentHighlights.push(processedHighlight);
  }
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
        return;
      }
    } catch (e) {
      console.warn('[Socratic Reader] Cache check failed:', e);
    }
  }
  
  // Analyze chunks
  overlayState = 'ANALYZING';
  updateOverlayState();
  
  let highlightCounter = 0;
  const allHighlightsForCache: Highlight[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    updateProgress(i + 1, chunks.length);
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'ANALYZE_CHUNK',
        chunkText: chunks[i].text,
        chunkIndex: i,
        url: window.location.href,
      }) as AnalyzeChunkResponse;
      
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
        // Process and apply highlights
        for (const h of response.highlights) {
          const id = `h-${highlightCounter++}`;
          const text = chunks[i].text.slice(h.start, h.end);
          const range = offsetToRange(chunks[i], h.start, h.end);
          
          const processedHighlight: ProcessedHighlight = {
            ...h,
            id,
            text,
            range,
            chunkIndex: i,
          };
          
          // Apply DOM highlight
          if (range) {
            applyHighlight(range, id);
          }
          
          currentHighlights.push(processedHighlight);
          
          // Store with global offset for cache
          allHighlightsForCache.push({
            ...h,
            start: h.start + chunks[i].globalOffset,
            end: h.end + chunks[i].globalOffset,
          });
        }
      }
    } catch (e) {
      console.error(`[Socratic Reader] Chunk ${i} error:`, e);
      
      if (i === 0 && chunks.length === 1) {
        showError(e instanceof Error ? e.message : 'Analysis failed');
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
// Initialization
// =============================================================================

console.log('[Socratic Reader] Content script loaded');
