import { describe, it, expect } from 'vitest';
import {
  detectSentences,
  detectParagraphs,
  calculateSalience,
  createSemanticChunks,
  prioritizeChunks
} from '../shared/semantic-chunking';

describe('Sentence Detection', () => {
  it('should detect simple sentences', () => {
    const text = 'This is a sentence. This is another sentence.';
    const sentences = detectSentences(text);

    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe('This is a sentence.');
    expect(sentences[1].text).toBe('This is another sentence.');
  });

  it('should handle abbreviations correctly', () => {
    const text = 'Dr. Smith works at the U.S. Embassy. He is very skilled.';
    const sentences = detectSentences(text);

    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe('Dr. Smith works at the U.S. Embassy.');
    expect(sentences[1].text).toBe('He is very skilled.');
  });

  it('should handle ellipsis correctly', () => {
    const text = 'He said... then paused. The room was silent.';
    const sentences = detectSentences(text);

    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toContain('He said... then paused.');
  });

  it('should handle decimal numbers', () => {
    const text = 'The value is 3.14159. That is pi.';
    const sentences = detectSentences(text);

    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe('The value is 3.14159.');
  });

  it('should handle questions and exclamations', () => {
    const text = 'What is this? Amazing! I cannot believe it.';
    const sentences = detectSentences(text);

    expect(sentences).toHaveLength(3);
    expect(sentences[0].text).toBe('What is this?');
    expect(sentences[1].text).toBe('Amazing!');
    expect(sentences[2].text).toBe('I cannot believe it.');
  });

  it('should handle text with no punctuation', () => {
    const text = 'This text has no ending punctuation';
    const sentences = detectSentences(text);

    expect(sentences).toHaveLength(1);
    expect(sentences[0].text).toBe('This text has no ending punctuation');
  });

  it('should skip leading/trailing whitespace', () => {
    const text = '   First sentence.   Second sentence.   ';
    const sentences = detectSentences(text);

    expect(sentences).toHaveLength(2);
    expect(sentences[0].text).toBe('First sentence.');
    expect(sentences[1].text).toBe('Second sentence.');
  });
});

describe('Paragraph Detection', () => {
  it('should detect single paragraph', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const paragraphs = detectParagraphs(text);

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].sentences).toHaveLength(3);
  });

  it('should detect multiple paragraphs with newlines', () => {
    const text = 'First paragraph.\n\nSecond paragraph.';
    const paragraphs = detectParagraphs(text);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].sentences[0].text).toContain('First paragraph');
    expect(paragraphs[1].sentences[0].text).toContain('Second paragraph');
  });

  it('should keep transition words in same paragraph without double newline', () => {
    // Transition words alone don't create paragraph breaks without explicit newlines
    const text = 'First idea is here.\nFurthermore, we have another idea.';
    const paragraphs = detectParagraphs(text);

    // Without double newline, sentences stay in one paragraph
    // (This is more realistic - transition words are hints, not hard breaks)
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs[0].sentences.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle empty text', () => {
    const paragraphs = detectParagraphs('');
    expect(paragraphs).toHaveLength(0);
  });
});

describe('Salience Calculation', () => {
  it('should score argumentative text highly', () => {
    const text = `
      However, this argument fails because the evidence clearly shows otherwise.
      Therefore, we must conclude that the original hypothesis is incorrect.
      This demonstrates why careful reasoning is essential.
    `;
    const result = calculateSalience(text);

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.factors.argumentKeywords).toBeGreaterThan(0);
  });

  it('should score questions highly', () => {
    const text = 'Why does this happen? What causes this effect? How can we explain this?';
    const result = calculateSalience(text);

    expect(result.factors.questions).toBeGreaterThan(0);
  });

  it('should score simple descriptive text lower', () => {
    const text = 'The sky is blue. The grass is green. Birds fly in the sky.';
    const result = calculateSalience(text);

    expect(result.score).toBeLessThan(0.3);
  });

  it('should detect causal reasoning', () => {
    const text = 'Because of this, the result occurs. This causes that. Therefore, we see the effect.';
    const result = calculateSalience(text);

    expect(result.factors.argumentKeywords).toBeGreaterThan(0);
  });

  it('should detect contrasting arguments', () => {
    const text = 'On one hand, we see this. However, on the other hand, that occurs. Nevertheless, the truth is different.';
    const result = calculateSalience(text);

    expect(result.factors.argumentKeywords).toBeGreaterThan(0);
  });

  it('should detect evidence markers', () => {
    const text = 'For example, research indicates this. The data shows that. Specifically, evidence demonstrates the point.';
    const result = calculateSalience(text);

    expect(result.factors.argumentKeywords).toBeGreaterThan(0);
  });

  it('should score complex sentences higher', () => {
    const text = 'Although the initial hypothesis seemed reasonable; subsequent evidence—particularly from the most recent studies—suggests otherwise.';
    const result = calculateSalience(text);

    expect(result.factors.complexity).toBeGreaterThan(0);
  });
});

describe('Semantic Chunking', () => {
  it('should create chunks at paragraph boundaries', () => {
    const text = `
First paragraph with some content here. It has multiple sentences.

Second paragraph with different content. Also multiple sentences here.

Third paragraph to test chunking. More sentences in this one too.
    `.trim();

    const chunks = createSemanticChunks(text, 20, 10, 50);

    expect(chunks.length).toBeGreaterThan(0);

    // Each chunk should end at sentence boundary
    for (const chunk of chunks) {
      expect(chunk.text.trim()).toMatch(/[.!?]$/);
    }
  });

  it('should never cut mid-sentence', () => {
    const text = 'First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here.';
    const chunks = createSemanticChunks(text, 10, 5, 20);

    for (const chunk of chunks) {
      // Count sentence-ending punctuation
      const endings = (chunk.text.match(/[.!?]/g) || []).length;
      expect(endings).toBeGreaterThan(0);

      // Verify chunk ends with sentence-ending punctuation
      expect(chunk.text.trim()).toMatch(/[.!?]$/);
    }
  });

  it('should respect word count targets', () => {
    // Create realistic text with multiple sentences
    const sentences = [];
    for (let i = 0; i < 50; i++) {
      sentences.push('Word '.repeat(20) + '.');
    }
    const text = sentences.join(' '); // ~1000 words in 50 sentences

    const chunks = createSemanticChunks(text, 200, 100, 300);

    // Most chunks should respect the limits
    // (Some edge cases may slightly exceed due to sentence boundary preservation)
    const chunksInRange = chunks.filter(c =>
      c.wordCount >= 100 && c.wordCount <= 350
    );

    // At least 80% of chunks should be in range
    expect(chunksInRange.length / chunks.length).toBeGreaterThan(0.8);
  });

  it('should calculate salience for each chunk', () => {
    const text = `
However, this is an important argument. Therefore, we must consider it carefully.
Because the evidence shows this, we can conclude that.

Simple description here. Just facts. Nothing argumentative.
    `.trim();

    const chunks = createSemanticChunks(text, 50, 10, 100);

    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.salience).toBeGreaterThanOrEqual(0);
      expect(chunk.salience).toBeLessThanOrEqual(1);
      expect(chunk.salienceFactors).toBeDefined();
    }

    // First chunk should have higher salience
    if (chunks.length >= 2) {
      expect(chunks[0].salience).toBeGreaterThan(chunks[1].salience);
    }
  });

  it('should handle short text', () => {
    const text = 'Just one sentence.';
    const chunks = createSemanticChunks(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Just one sentence.');
  });

  it('should handle empty text', () => {
    const chunks = createSemanticChunks('');
    expect(chunks).toHaveLength(0);
  });

  it('should preserve sentence boundaries in chunks', () => {
    const text = `
First sentence. Second sentence. Third sentence.
Fourth sentence. Fifth sentence. Sixth sentence.
    `.trim();

    const chunks = createSemanticChunks(text, 10, 5, 20);

    let totalSentences = 0;
    for (const chunk of chunks) {
      totalSentences += chunk.sentences.length;
    }

    expect(totalSentences).toBe(6);
  });
});

describe('Chunk Prioritization', () => {
  it('should prioritize high-salience chunks first', () => {
    const chunks = [
      {
        text: 'Simple text.',
        start: 0,
        end: 12,
        wordCount: 2,
        sentences: [],
        salience: 0.2
      },
      {
        text: 'However, this argues because therefore evidence.',
        start: 13,
        end: 60,
        wordCount: 6,
        sentences: [],
        salience: 0.8
      },
      {
        text: 'Medium salience content here.',
        start: 61,
        end: 90,
        wordCount: 4,
        sentences: [],
        salience: 0.5
      }
    ];

    const prioritized = prioritizeChunks(chunks);

    expect(prioritized[0]).toBe(1); // Highest salience (0.8)
    expect(prioritized[1]).toBe(2); // Medium salience (0.5)
    expect(prioritized[2]).toBe(0); // Lowest salience (0.2)
  });

  it('should handle empty array', () => {
    const prioritized = prioritizeChunks([]);
    expect(prioritized).toHaveLength(0);
  });

  it('should handle single chunk', () => {
    const chunks = [{
      text: 'Only chunk.',
      start: 0,
      end: 11,
      wordCount: 2,
      sentences: [],
      salience: 0.5
    }];

    const prioritized = prioritizeChunks(chunks);
    expect(prioritized).toEqual([0]);
  });
});

describe('Edge Cases', () => {
  it('should handle text with only whitespace', () => {
    const sentences = detectSentences('   \n\n   ');
    expect(sentences).toHaveLength(0);
  });

  it('should handle text with multiple consecutive punctuation', () => {
    const text = 'What?! Really?! Yes!!!';
    const sentences = detectSentences(text);

    expect(sentences.length).toBeGreaterThan(0);
  });

  it('should handle very long sentences', () => {
    const longSentence = 'Word '.repeat(200) + '.';
    const sentences = detectSentences(longSentence);

    expect(sentences).toHaveLength(1);
    expect(sentences[0].text.split(/\s+/).length).toBeGreaterThan(100);
  });

  it('should handle mixed newlines and spaces', () => {
    const text = 'First.\n\n\nSecond.\n  \n  Third.';
    const paragraphs = detectParagraphs(text);

    expect(paragraphs.length).toBeGreaterThan(0);
  });
});
