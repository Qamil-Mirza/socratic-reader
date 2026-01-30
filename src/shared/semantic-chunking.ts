/**
 * Semantic text chunking that respects sentence and paragraph boundaries
 *
 * This module provides intelligent text chunking that:
 * 1. Detects sentence boundaries (handling abbreviations, ellipses, etc.)
 * 2. Respects paragraph boundaries (newlines, semantic breaks)
 * 3. Scores chunks by salience/argument richness
 * 4. Never cuts mid-sentence or mid-idea
 */

// Common abbreviations that end with periods but don't end sentences
const ABBREVIATIONS = new Set([
  'Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr',
  'vs', 'etc', 'e.g', 'i.e', 'Ph.D', 'M.D', 'B.A', 'M.A',
  'U.S', 'U.K', 'U.N', 'E.U', 'Inc', 'Ltd', 'Co', 'Corp',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'No', 'vol', 'pp', 'Fig', 'St', 'Ave', 'Blvd'
]);

// Keywords indicating argumentative content
const ARGUMENT_INDICATORS = {
  // Causal reasoning
  causal: ['because', 'therefore', 'thus', 'hence', 'consequently', 'as a result', 'leads to', 'causes', 'due to'],

  // Contrast/comparison
  contrast: ['however', 'but', 'yet', 'although', 'despite', 'nevertheless', 'on the other hand', 'whereas', 'while', 'conversely'],

  // Evidence/support
  evidence: ['for example', 'for instance', 'specifically', 'in particular', 'such as', 'evidence', 'data shows', 'research indicates'],

  // Logical structure
  logical: ['if', 'then', 'implies', 'suggests', 'indicates', 'demonstrates', 'proves', 'shows that', 'follows that'],

  // Claims/assertions
  claims: ['argue', 'claim', 'assert', 'maintain', 'contend', 'propose', 'posit', 'believe', 'holds that'],

  // Questions (Socratic method)
  questions: ['why', 'how', 'what if', 'whether', 'does this mean', 'could it be']
};

// Transition words that indicate paragraph boundaries
const PARAGRAPH_TRANSITIONS = new Set([
  'furthermore', 'moreover', 'additionally', 'in addition',
  'first', 'second', 'third', 'finally', 'lastly',
  'in conclusion', 'to summarize', 'in summary',
  'meanwhile', 'subsequently', 'previously',
  'another', 'next', 'then'
]);

export interface SentenceBoundary {
  start: number;  // Character offset where sentence starts
  end: number;    // Character offset where sentence ends (inclusive)
  text: string;   // The sentence text
}

export interface Paragraph {
  start: number;
  end: number;
  sentences: SentenceBoundary[];
}

export interface SemanticChunk {
  text: string;
  start: number;
  end: number;
  wordCount: number;
  sentences: SentenceBoundary[];
  salience: number;  // 0-1 score indicating argument richness
  salienceFactors?: {
    argumentKeywords: number;
    questions: number;
    transitions: number;
    complexity: number;
  };
}

/**
 * Detects sentence boundaries in text with robust handling of edge cases
 */
export function detectSentences(text: string): SentenceBoundary[] {
  const sentences: SentenceBoundary[] = [];
  let currentStart = 0;

  // Skip leading whitespace
  while (currentStart < text.length && /\s/.test(text[currentStart])) {
    currentStart++;
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    const prevChar = text[i - 1];

    // Check for sentence-ending punctuation
    if (/[.!?]/.test(char)) {
      // Handle ellipsis (...)
      if (char === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
        i += 2; // Skip the ellipsis
        continue;
      }

      // Handle abbreviations
      if (char === '.') {
        // Check for multi-part abbreviations like "U.S." or "Ph.D."
        // Pattern: single capital followed by period, with another period before it
        if (/^[A-Z]$/.test(prevChar)) {
          const charBeforePrev = text[i - 2];
          // If previous char is capital and char before that is period or space, skip
          if (charBeforePrev === '.' || charBeforePrev === ' ' || i === 1) {
            continue;
          }
        }

        // Check full word abbreviations
        const wordBefore = text.slice(Math.max(0, i - 10), i).match(/(\w+)$/);
        if (wordBefore && ABBREVIATIONS.has(wordBefore[1])) {
          continue; // Not a sentence boundary
        }

        // Check for decimal numbers
        if (/\d/.test(prevChar) && /\d/.test(nextChar)) {
          continue;
        }
      }

      // Check if followed by whitespace or end of text (true sentence ending)
      if (i + 1 >= text.length || /\s/.test(nextChar)) {
        // Extract sentence text
        let sentenceEnd = i + 1;

        // Only include trailing spaces/tabs, NOT newlines (preserve paragraph structure)
        while (sentenceEnd < text.length && /[ \t]/.test(text[sentenceEnd])) {
          sentenceEnd++;
        }

        const sentenceText = text.slice(currentStart, sentenceEnd).trim();

        if (sentenceText.length > 0) {
          sentences.push({
            start: currentStart,
            end: sentenceEnd,
            text: sentenceText
          });
        }

        currentStart = sentenceEnd;

        // Skip any newlines for the start of next sentence
        while (currentStart < text.length && /[\n\r]/.test(text[currentStart])) {
          currentStart++;
        }
      }
    }
  }

  // Add remaining text as final sentence if non-empty
  if (currentStart < text.length) {
    const remaining = text.slice(currentStart).trim();
    if (remaining.length > 0) {
      sentences.push({
        start: currentStart,
        end: text.length,
        text: remaining
      });
    }
  }

  return sentences;
}

/**
 * Detects paragraph boundaries based on multiple newlines and semantic cues
 */
export function detectParagraphs(text: string): Paragraph[] {
  const sentences = detectSentences(text);
  if (sentences.length === 0) return [];

  const paragraphs: Paragraph[] = [];
  let currentParagraph: SentenceBoundary[] = [];
  let paragraphStart = sentences[0].start;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    currentParagraph.push(sentence);

    // Check if next sentence starts a new paragraph
    const nextSentence = sentences[i + 1];
    const shouldBreak = !nextSentence || isParagraphBoundary(text, sentence.end, nextSentence.start);

    if (shouldBreak) {
      const paragraphEnd = sentence.end;
      paragraphs.push({
        start: paragraphStart,
        end: paragraphEnd,
        sentences: currentParagraph
      });

      currentParagraph = [];
      if (nextSentence) {
        paragraphStart = nextSentence.start;
      }
    }
  }

  return paragraphs;
}

/**
 * Checks if there's a paragraph boundary between two positions
 */
function isParagraphBoundary(text: string, end1: number, start2: number): boolean {
  const between = text.slice(end1, start2);

  // Multiple newlines indicate paragraph break (strongest signal)
  if (/\n\s*\n/.test(between)) {
    return true;
  }

  // Only use transition words as paragraph breaks if there's at least one newline
  if (/\n/.test(between)) {
    const nextSentenceStart = text.slice(start2, start2 + 50).toLowerCase().trim();
    for (const transition of PARAGRAPH_TRANSITIONS) {
      // Must be at word boundary
      if (nextSentenceStart.startsWith(transition + ' ') || nextSentenceStart === transition) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculates salience score for a chunk based on argument indicators
 */
export function calculateSalience(text: string): {
  score: number;
  factors: {
    argumentKeywords: number;
    questions: number;
    transitions: number;
    complexity: number;
  };
} {
  const lowerText = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Count argument indicators
  let keywordScore = 0;
  const categoryCounts: Record<string, number> = {};

  for (const [category, keywords] of Object.entries(ARGUMENT_INDICATORS)) {
    let count = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = lowerText.match(regex);
      count += matches ? matches.length : 0;
    }
    categoryCounts[category] = count;
    keywordScore += count;
  }

  // Normalize by word count (keywords per 100 words)
  // Adjusted to be more sensitive: 3+ keywords per 100 words = max score
  const argumentKeywords = Math.min(1.0, (keywordScore / wordCount) * 100 / 3);

  // Question density
  const questionMarks = (text.match(/\?/g) || []).length;
  const questions = Math.min(1.0, questionMarks / 3);

  // Transition words (indicates structured argument)
  let transitionCount = 0;
  for (const transition of PARAGRAPH_TRANSITIONS) {
    if (lowerText.includes(transition)) {
      transitionCount++;
    }
  }
  const transitions = Math.min(1.0, transitionCount / 3);

  // Complexity heuristic: longer sentences, semicolons, em dashes
  const avgSentenceLength = wordCount / (text.split(/[.!?]/).length || 1);
  const semicolons = (text.match(/;/g) || []).length;
  const emDashes = (text.match(/—/g) || []).length;
  const complexity = Math.min(1.0,
    (avgSentenceLength / 30) * 0.6 +
    (semicolons / 3) * 0.2 +
    (emDashes / 2) * 0.2
  );

  // Weighted final score
  // Give higher weight to argument keywords for better detection
  const score =
    argumentKeywords * 0.5 +
    questions * 0.2 +
    transitions * 0.15 +
    complexity * 0.15;

  return {
    score: Math.min(1.0, score),
    factors: {
      argumentKeywords,
      questions,
      transitions,
      complexity
    }
  };
}

/**
 * Chunks text into semantic units respecting sentence/paragraph boundaries
 *
 * @param text - The text to chunk
 * @param targetWordCount - Target words per chunk (default: 500)
 * @param minWordCount - Minimum words per chunk (default: 200)
 * @param maxWordCount - Maximum words per chunk (default: 800)
 * @returns Array of semantic chunks with salience scores
 */
export function createSemanticChunks(
  text: string,
  targetWordCount: number = 500,
  minWordCount: number = 200,
  maxWordCount: number = 800
): SemanticChunk[] {
  const paragraphs = detectParagraphs(text);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: SemanticChunk[] = [];
  let currentChunkSentences: SentenceBoundary[] = [];
  let currentWordCount = 0;
  let chunkStart = paragraphs[0].start;

  for (const paragraph of paragraphs) {
    for (const sentence of paragraph.sentences) {
      const sentenceWords = sentence.text.split(/\s+/).length;

      // Check if adding this sentence would exceed max
      if (currentWordCount + sentenceWords > maxWordCount && currentChunkSentences.length > 0) {
        // Finalize current chunk
        finalizeChunk();
      }

      // Add sentence to current chunk
      currentChunkSentences.push(sentence);
      currentWordCount += sentenceWords;

      // Check if we've reached target and should break at paragraph boundary
      if (currentWordCount >= targetWordCount && currentWordCount >= minWordCount) {
        // Break at paragraph end if we're at one
        const isLastSentenceInParagraph =
          paragraph.sentences[paragraph.sentences.length - 1] === sentence;

        if (isLastSentenceInParagraph) {
          finalizeChunk();
        }
      }
    }

    // Always break after paragraph if we're above minimum
    if (currentWordCount >= minWordCount && currentChunkSentences.length > 0) {
      finalizeChunk();
    }
  }

  // Add remaining sentences as final chunk
  if (currentChunkSentences.length > 0) {
    finalizeChunk();
  }

  function finalizeChunk() {
    if (currentChunkSentences.length === 0) return;

    const chunkEnd = currentChunkSentences[currentChunkSentences.length - 1].end;
    const chunkText = text.slice(chunkStart, chunkEnd);
    const salience = calculateSalience(chunkText);

    chunks.push({
      text: chunkText,
      start: chunkStart,
      end: chunkEnd,
      wordCount: currentWordCount,
      sentences: [...currentChunkSentences],
      salience: salience.score,
      salienceFactors: salience.factors
    });

    // Reset for next chunk
    const nextStart = chunkEnd;
    // Skip whitespace
    let actualStart = nextStart;
    while (actualStart < text.length && /\s/.test(text[actualStart])) {
      actualStart++;
    }
    chunkStart = actualStart;
    currentChunkSentences = [];
    currentWordCount = 0;
  }

  return chunks;
}

/**
 * Prioritizes chunks by salience score
 * Returns indices sorted by salience (highest first)
 */
export function prioritizeChunks(chunks: SemanticChunk[]): number[] {
  return chunks
    .map((chunk, index) => ({ index, salience: chunk.salience }))
    .sort((a, b) => b.salience - a.salience)
    .map(item => item.index);
}
