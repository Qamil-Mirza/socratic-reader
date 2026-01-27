import { getConfig } from '../shared/storage';
import type { Config } from '../shared/types';

// Elements
const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
const optionsLink = document.getElementById('optionsLink') as HTMLAnchorElement;
const statusDot = document.getElementById('statusDot') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const shortcutKey = document.getElementById('shortcutKey') as HTMLElement;

/**
 * Check if config is valid
 */
function isConfigured(config: Config): boolean {
  if (config.provider === 'ollama') {
    return true; // Ollama doesn't need API key
  }
  return Boolean(config.apiKey);
}

/**
 * Update status display
 */
async function updateStatus(): Promise<void> {
  try {
    const config = await getConfig();
    
    if (isConfigured(config)) {
      statusDot.classList.add('configured');
      statusDot.classList.remove('error');
      statusText.textContent = `${config.provider} configured`;
    } else {
      statusDot.classList.remove('configured');
      statusDot.classList.remove('error');
      statusText.textContent = 'API key not set';
    }
  } catch (e) {
    statusDot.classList.remove('configured');
    statusDot.classList.add('error');
    statusText.textContent = 'Error loading config';
  }
}

/**
 * Send toggle message to content script
 */
async function toggleOverlay(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab?.id) {
    alert('No active tab found.');
    return;
  }

  // Check if we can inject into this tab
  const url = tab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    alert('Socratic Reader cannot run on browser internal pages.');
    return;
  }
  
  if (url.startsWith('https://chrome.google.com/webstore')) {
    alert('Socratic Reader cannot run on the Chrome Web Store.');
    return;
  }

  // First, try to send message to existing content script
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_OVERLAY' });
    window.close();
    return;
  } catch {
    // Content script not loaded yet, try to inject it
  }

  // Try injecting the content script manually
  try {
    // Insert CSS first
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles.css'],
    });
    
    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    
    // Small delay to let the script initialize
    await new Promise(resolve => setTimeout(resolve, 200));
    
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_OVERLAY' });
    window.close();
  } catch (injectError) {
    console.error('Injection failed:', injectError);
    alert('Could not activate Socratic Reader on this page.\n\nPlease refresh the page and try again.');
  }
}

/**
 * Open options page
 */
function openOptions(e: Event): void {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
}

/**
 * Update shortcut key display for Mac
 */
function updateShortcutDisplay(): void {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  if (isMac) {
    shortcutKey.textContent = '⌘+Shift+S';
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  updateStatus();
  updateShortcutDisplay();
  
  toggleBtn.addEventListener('click', toggleOverlay);
  optionsLink.addEventListener('click', openOptions);
});
