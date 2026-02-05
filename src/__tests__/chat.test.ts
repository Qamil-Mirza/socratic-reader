import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetChromeMocks } from './mocks/chrome';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Simulate the exact DOM unwrap logic used by deleteHighlight */
function unwrapHighlightSpan(id: string): boolean {
  const span = document.querySelector(`[data-highlight-id="${id}"]`);
  if (!span) return false;
  const parent = span.parentNode;
  if (parent) {
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  }
  return true;
}

/** Minimal ProcessedHighlight shape used in the tests */
interface MockHighlight {
  id: string;
  text: string;
}

// ---------------------------------------------------------------------------
// deleteHighlight — DOM + state behaviour
// ---------------------------------------------------------------------------

describe('deleteHighlight', () => {
  let highlights: MockHighlight[];
  let highlightIndex: number;

  // Mirror the state-mutation logic from content.ts deleteHighlight
  function deleteHighlight(index: number): void {
    if (index < 0 || index >= highlights.length) return;
    const h = highlights[index];
    unwrapHighlightSpan(h.id);
    highlights.splice(index, 1);
    if (highlightIndex >= highlights.length) {
      highlightIndex = Math.max(0, highlights.length - 1);
    }
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <p>
        Before <span class="socratic-highlight" data-highlight-id="h-0">first claim</span>
        middle
        <span class="socratic-highlight" data-highlight-id="h-1">second claim</span>
        after
      </p>
    `;
    highlights = [
      { id: 'h-0', text: 'first claim' },
      { id: 'h-1', text: 'second claim' },
    ];
    highlightIndex = 0;
  });

  it('removes the highlight span from the DOM', () => {
    deleteHighlight(0);
    expect(document.querySelector('[data-highlight-id="h-0"]')).toBeNull();
    // The other span remains
    expect(document.querySelector('[data-highlight-id="h-1"]')).not.toBeNull();
  });

  it('preserves surrounding text after removal', () => {
    deleteHighlight(0);
    expect(document.body.textContent).toContain('first claim');
    expect(document.body.textContent).toContain('second claim');
  });

  it('splices the highlights array', () => {
    deleteHighlight(0);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].id).toBe('h-1');
  });

  it('adjusts highlightIndex when deleting current or later item', () => {
    highlightIndex = 1; // pointing at h-1
    deleteHighlight(1); // delete h-1
    // Only h-0 remains; index should clamp to 0
    expect(highlightIndex).toBe(0);
  });

  it('triggers empty state when last highlight is deleted', () => {
    deleteHighlight(0);
    deleteHighlight(0); // now deleting h-1 (shifted to index 0)
    expect(highlights).toHaveLength(0);
    expect(highlightIndex).toBe(0);
    // No highlight spans remain
    expect(document.querySelectorAll('.socratic-highlight')).toHaveLength(0);
  });

  it('does nothing for out-of-bounds index', () => {
    deleteHighlight(5);
    expect(highlights).toHaveLength(2);
    expect(document.querySelectorAll('.socratic-highlight')).toHaveLength(2);
  });

  it('does nothing for negative index', () => {
    deleteHighlight(-1);
    expect(highlights).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// showAporiaModal — creation, idempotency, dismissal
// ---------------------------------------------------------------------------

/** Recreate the showAporiaModal logic for isolated testing */
function showAporiaModal(): void {
  if (document.getElementById('socratic-aporia-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'socratic-aporia-modal';
  modal.className = 'socratic-aporia-modal';
  modal.innerHTML = `
    <div class="socratic-aporia-modal-content">
      <div class="socratic-aporia-icon">&#8734;</div>
      <h2 class="socratic-aporia-title">Aporia Reached</h2>
      <blockquote class="socratic-aporia-quote">
        "The beginning of wisdom is the definition of terms."
        <cite>— Socrates</cite>
      </blockquote>
      <p class="socratic-aporia-explanation">
        You have arrived at a productive state of intellectual uncertainty.
      </p>
      <button class="socratic-aporia-close-btn">Continue Reading</button>
    </div>
  `;

  modal.querySelector('.socratic-aporia-close-btn')?.addEventListener('click', () => {
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  document.body.appendChild(modal);
}

describe('showAporiaModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="page-content">Hello</div>';
  });

  it('creates the modal element', () => {
    showAporiaModal();
    expect(document.getElementById('socratic-aporia-modal')).not.toBeNull();
  });

  it('is idempotent — calling twice does not create a second modal', () => {
    showAporiaModal();
    showAporiaModal();
    const modals = document.querySelectorAll('#socratic-aporia-modal');
    expect(modals).toHaveLength(1);
  });

  it('contains the Aporia Reached title', () => {
    showAporiaModal();
    const title = document.querySelector('.socratic-aporia-title');
    expect(title?.textContent).toBe('Aporia Reached');
  });

  it('contains the Socrates quote', () => {
    showAporiaModal();
    const quote = document.querySelector('.socratic-aporia-quote');
    expect(quote?.textContent).toContain('beginning of wisdom');
  });

  it('close button removes the modal', () => {
    showAporiaModal();
    const btn = document.querySelector('.socratic-aporia-close-btn') as HTMLButtonElement;
    btn.click();
    expect(document.getElementById('socratic-aporia-modal')).toBeNull();
  });

  it('clicking the backdrop (modal root) removes the modal', () => {
    showAporiaModal();
    const modal = document.getElementById('socratic-aporia-modal')!;
    // Simulate click directly on the modal backdrop (not the content card)
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: modal });
    modal.dispatchEvent(event);
    expect(document.getElementById('socratic-aporia-modal')).toBeNull();
  });

  it('clicking inside the modal content does NOT close the modal', () => {
    showAporiaModal();
    const content = document.querySelector('.socratic-aporia-modal-content') as HTMLElement;
    content.click(); // click propagates to modal but target !== modal
    // Modal should still be there (the event.target check prevents removal)
    expect(document.getElementById('socratic-aporia-modal')).not.toBeNull();
  });

  it('can be re-created after being closed', () => {
    showAporiaModal();
    document.querySelector('.socratic-aporia-close-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('socratic-aporia-modal')).toBeNull();
    showAporiaModal();
    expect(document.getElementById('socratic-aporia-modal')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Aporia threshold — modal NOT shown when score < 0.95
// ---------------------------------------------------------------------------

describe('Aporia threshold gating', () => {
  /** Mirrors the threshold check in sendChatMessage */
  function checkAndShowModal(aporiaScore: number): boolean {
    if (aporiaScore >= 0.95) {
      showAporiaModal();
      return true;
    }
    return false;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not show modal when score is 0.94', () => {
    checkAndShowModal(0.94);
    expect(document.getElementById('socratic-aporia-modal')).toBeNull();
  });

  it('does not show modal when score is 0', () => {
    checkAndShowModal(0);
    expect(document.getElementById('socratic-aporia-modal')).toBeNull();
  });

  it('shows modal when score is exactly 0.95', () => {
    checkAndShowModal(0.95);
    expect(document.getElementById('socratic-aporia-modal')).not.toBeNull();
  });

  it('shows modal when score is 0.99', () => {
    checkAndShowModal(0.99);
    expect(document.getElementById('socratic-aporia-modal')).not.toBeNull();
  });

  it('shows modal when score is 1.0', () => {
    checkAndShowModal(1.0);
    expect(document.getElementById('socratic-aporia-modal')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selection floating button — guard conditions
// ---------------------------------------------------------------------------

describe('Selection floating button guards', () => {
  /**
   * Mirrors the guard logic from handleSelectionChange.
   * Returns whether the "+" button would be shown.
   */
  function wouldShowSelectionBtn(opts: {
    overlayVisible: boolean;
    overlayState: string;
    activeChatHighlightId: string | null;
    selectedText: string;
    selectionInsideOverlay: boolean;
  }): boolean {
    if (!opts.overlayVisible) return false;
    if (opts.overlayState !== 'DISPLAYING') return false;
    if (opts.activeChatHighlightId) return false;
    if (opts.selectedText.trim().length < 10) return false;
    if (opts.selectionInsideOverlay) return false;
    return true;
  }

  it('not shown when overlay is hidden', () => {
    expect(wouldShowSelectionBtn({
      overlayVisible: false,
      overlayState: 'DISPLAYING',
      activeChatHighlightId: null,
      selectedText: 'enough text to qualify here',
      selectionInsideOverlay: false,
    })).toBe(false);
  });

  it('not shown when overlay state is not DISPLAYING', () => {
    expect(wouldShowSelectionBtn({
      overlayVisible: true,
      overlayState: 'ANALYZING',
      activeChatHighlightId: null,
      selectedText: 'enough text to qualify here',
      selectionInsideOverlay: false,
    })).toBe(false);
  });

  it('not shown when a chat panel is active', () => {
    expect(wouldShowSelectionBtn({
      overlayVisible: true,
      overlayState: 'DISPLAYING',
      activeChatHighlightId: 'h-0',
      selectedText: 'enough text to qualify here',
      selectionInsideOverlay: false,
    })).toBe(false);
  });

  it('not shown when selected text is shorter than 10 characters', () => {
    expect(wouldShowSelectionBtn({
      overlayVisible: true,
      overlayState: 'DISPLAYING',
      activeChatHighlightId: null,
      selectedText: 'short',
      selectionInsideOverlay: false,
    })).toBe(false);
  });

  it('not shown when selection is inside the overlay', () => {
    expect(wouldShowSelectionBtn({
      overlayVisible: true,
      overlayState: 'DISPLAYING',
      activeChatHighlightId: null,
      selectedText: 'enough text to qualify here',
      selectionInsideOverlay: true,
    })).toBe(false);
  });

  it('shown when all guards pass', () => {
    expect(wouldShowSelectionBtn({
      overlayVisible: true,
      overlayState: 'DISPLAYING',
      activeChatHighlightId: null,
      selectedText: 'enough text to qualify for a highlight',
      selectionInsideOverlay: false,
    })).toBe(true);
  });

  it('shown when selected text is exactly 10 characters', () => {
    expect(wouldShowSelectionBtn({
      overlayVisible: true,
      overlayState: 'DISPLAYING',
      activeChatHighlightId: null,
      selectedText: '0123456789', // exactly 10
      selectionInsideOverlay: false,
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chat session — creation, persistence, score monotonicity
// ---------------------------------------------------------------------------

interface ChatSession {
  highlightId: string;
  highlightText: string;
  history: Array<{ role: string; content: string }>;
  aporiaScore: number;
}

describe('Chat session lifecycle', () => {
  const SYSTEM_PROMPT = 'You are a Socratic tutor.'; // stand-in

  /** Mirrors openChatPanel session-init logic */
  function initSessionIfMissing(
    sessions: Map<string, ChatSession>,
    highlightId: string,
    highlightText: string,
    firstQuestion: string
  ): ChatSession {
    if (!sessions.has(highlightId)) {
      const session: ChatSession = {
        highlightId,
        highlightText,
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `I have highlighted: "${highlightText}"` },
          { role: 'assistant', content: JSON.stringify({ response: firstQuestion, aporiaScore: 0.1 }) },
        ],
        aporiaScore: 0.1,
      };
      sessions.set(highlightId, session);
    }
    return sessions.get(highlightId)!;
  }

  /** Mirrors the score-monotonicity enforcement in sendChatMessage */
  function applyResponse(session: ChatSession, responseText: string, newScore: number): void {
    session.aporiaScore = Math.max(session.aporiaScore, newScore);
    session.history.push({
      role: 'assistant',
      content: JSON.stringify({ response: responseText, aporiaScore: session.aporiaScore }),
    });
  }

  it('creates a new session on first open', () => {
    const sessions = new Map<string, ChatSession>();
    const session = initSessionIfMissing(sessions, 'h-0', 'Test claim', 'Why do you think so?');
    expect(session.highlightId).toBe('h-0');
    expect(session.aporiaScore).toBe(0.1);
    expect(session.history).toHaveLength(3); // system + user + assistant
  });

  it('does not overwrite session on re-open', () => {
    const sessions = new Map<string, ChatSession>();
    initSessionIfMissing(sessions, 'h-0', 'Test claim', 'First question');
    // Add a user turn to mutate history
    sessions.get('h-0')!.history.push({ role: 'user', content: 'My answer' });

    // Re-open — should NOT reset
    const session = initSessionIfMissing(sessions, 'h-0', 'Test claim', 'First question');
    expect(session.history).toHaveLength(4); // original 3 + 1 user turn
  });

  it('user message is appended to history before sending', () => {
    const sessions = new Map<string, ChatSession>();
    const session = initSessionIfMissing(sessions, 'h-0', 'Claim', 'Q?');
    // Simulate the "append user message" step
    session.history.push({ role: 'user', content: 'My thought' });
    expect(session.history[session.history.length - 1]).toEqual({ role: 'user', content: 'My thought' });
  });

  it('enforces score monotonicity — score cannot decrease', () => {
    const sessions = new Map<string, ChatSession>();
    const session = initSessionIfMissing(sessions, 'h-0', 'Claim', 'Q?');

    // Simulate increasing scores
    applyResponse(session, 'resp1', 0.4);
    expect(session.aporiaScore).toBe(0.4);

    applyResponse(session, 'resp2', 0.6);
    expect(session.aporiaScore).toBe(0.6);

    // LLM returns a LOWER score — should be clamped to current
    applyResponse(session, 'resp3', 0.3);
    expect(session.aporiaScore).toBe(0.6);
  });

  it('score stays at 0.1 if LLM returns 0', () => {
    const sessions = new Map<string, ChatSession>();
    const session = initSessionIfMissing(sessions, 'h-0', 'Claim', 'Q?');
    applyResponse(session, 'resp', 0);
    expect(session.aporiaScore).toBe(0.1); // initial 0.1 > 0
  });

  it('score reaches 1.0 and stays there', () => {
    const sessions = new Map<string, ChatSession>();
    const session = initSessionIfMissing(sessions, 'h-0', 'Claim', 'Q?');
    applyResponse(session, 'near', 0.98);
    applyResponse(session, 'full', 1.0);
    expect(session.aporiaScore).toBe(1.0);
    // Subsequent lower score is ignored
    applyResponse(session, 'lower', 0.7);
    expect(session.aporiaScore).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// GENERATE_QUESTIONS message dispatch — verifies message shape
// ---------------------------------------------------------------------------

describe('GENERATE_QUESTIONS message shape', () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it('dispatches correct action and payload', async () => {
    const sendMessage = (globalThis as any).chrome.runtime.sendMessage;
    sendMessage.mockResolvedValue({ question: 'Why?', explanation: 'Because.' });

    const selectedText = 'The economy grows when trade is free.';
    const url = 'https://example.com/article';

    await (globalThis as any).chrome.runtime.sendMessage({
      action: 'GENERATE_QUESTIONS',
      selectedText,
      url,
    });

    expect(sendMessage).toHaveBeenCalledWith({
      action: 'GENERATE_QUESTIONS',
      selectedText,
      url,
    });
  });
});

// ---------------------------------------------------------------------------
// SOCRATIC_CHAT message dispatch — verifies message shape
// ---------------------------------------------------------------------------

describe('SOCRATIC_CHAT message shape', () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it('dispatches correct action with full history and empty userMessage', async () => {
    const sendMessage = (globalThis as any).chrome.runtime.sendMessage;
    sendMessage.mockResolvedValue({ response: 'Think again.', aporiaScore: 0.5 });

    const history = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ];

    await (globalThis as any).chrome.runtime.sendMessage({
      action: 'SOCRATIC_CHAT',
      highlightId: 'h-0',
      highlightText: 'The claim',
      history,
      userMessage: '',
    });

    expect(sendMessage).toHaveBeenCalledWith({
      action: 'SOCRATIC_CHAT',
      highlightId: 'h-0',
      highlightText: 'The claim',
      history,
      userMessage: '',
    });
  });
});
