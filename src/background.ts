import {
  getConfig,
  getNotes,
  saveNote,
  deleteNote,
  getCachedAnalysis,
  setCachedAnalysis,
  clearCachedAnalysis,
  generateContentHash,
} from './shared/storage';
import { callLLM, testConnection } from './shared/llm';
import type {
  AnalyzeChunkResponse,
  TestConnectionResponse,
  TestConnectionMessage,
  AnalyzeChunkMessage,
  SavedNote,
  Highlight,
} from './shared/types';

/**
 * Handle analyze chunk request
 */
async function handleAnalyzeChunk(msg: AnalyzeChunkMessage): Promise<AnalyzeChunkResponse> {
  try {
    const config = await getConfig();
    const result = await callLLM(msg.chunkText, config);
    return { highlights: result.highlights };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[Socratic Reader] Analysis error:', error);
    return { error };
  }
}

/**
 * Handle test connection request
 */
async function handleTestConnection(msg: TestConnectionMessage): Promise<TestConnectionResponse> {
  const result = await testConnection(msg.config);
  return result;
}

/**
 * Message listener
 */
chrome.runtime.onMessage.addListener(
  (msg: Record<string, unknown>, _sender, sendResponse: (response: unknown) => void) => {
    if (msg.action === 'ANALYZE_CHUNK') {
      handleAnalyzeChunk(msg as unknown as AnalyzeChunkMessage)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: String(e) }));
      return true; // Async response
    }

    if (msg.action === 'TEST_CONNECTION') {
      handleTestConnection(msg as unknown as TestConnectionMessage)
        .then(sendResponse)
        .catch((e) => sendResponse({ success: false, error: String(e) }));
      return true; // Async response
    }

    // Storage operations for content script
    if (msg.action === 'GET_NOTES') {
      getNotes(msg.url as string)
        .then(sendResponse)
        .catch(() => sendResponse([]));
      return true;
    }

    if (msg.action === 'SAVE_NOTE') {
      saveNote(msg.note as SavedNote)
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    }

    if (msg.action === 'DELETE_NOTE') {
      deleteNote(msg.url as string, msg.highlightId as string)
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    }

    // Cache operations
    if (msg.action === 'GET_CACHED_ANALYSIS') {
      const contentHash = generateContentHash(msg.contentText as string);
      getCachedAnalysis(msg.url as string, contentHash)
        .then((highlights) => sendResponse({ highlights, contentHash }))
        .catch(() => sendResponse({ highlights: null, contentHash: '' }));
      return true;
    }

    if (msg.action === 'SET_CACHED_ANALYSIS') {
      setCachedAnalysis(
        msg.url as string,
        msg.highlights as Highlight[],
        msg.contentHash as string
      )
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    }

    if (msg.action === 'CLEAR_CACHED_ANALYSIS') {
      clearCachedAnalysis(msg.url as string)
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    }

    return false;
  }
);

/**
 * Ensure content script is injected and send toggle message
 */
async function toggleOverlayInTab(tabId: number, tabUrl?: string): Promise<void> {
  // Skip chrome:// and other restricted URLs
  if (tabUrl && (tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://'))) {
    console.log('[Socratic Reader] Cannot inject into restricted page:', tabUrl);
    return;
  }

  try {
    // Try to send message first (content script may already be loaded)
    await chrome.tabs.sendMessage(tabId, { action: 'TOGGLE_OVERLAY' });
  } catch {
    // Content script not loaded - inject it first
    console.log('[Socratic Reader] Injecting content script into tab', tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['styles.css'],
      });
      // Small delay to let script initialize
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Now send the toggle message
      await chrome.tabs.sendMessage(tabId, { action: 'TOGGLE_OVERLAY' });
    } catch (e) {
      console.error('[Socratic Reader] Failed to inject content script:', e);
    }
  }
}

/**
 * Keyboard shortcut handler
 */
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-overlay') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        toggleOverlayInTab(tab.id, tab.url);
      }
    });
  }
});

/**
 * Extension install/update handler
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }
});

console.log('[Socratic Reader] Background service worker started');
