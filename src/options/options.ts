import { getConfig, saveConfig } from '../shared/storage';
import type { Config, Provider, TestConnectionResponse } from '../shared/types';
import { DEFAULT_MODELS } from '../shared/types';

// Elements
const providerSelect = document.getElementById('provider') as HTMLSelectElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const apiKeyGroup = document.getElementById('apiKeyGroup') as HTMLElement;
const apiKeyHelp = document.getElementById('apiKeyHelp') as HTMLElement;
const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement;
const baseUrlHelp = document.getElementById('baseUrlHelp') as HTMLElement;
const modelInput = document.getElementById('model') as HTMLInputElement;
const modelHelp = document.getElementById('modelHelp') as HTMLElement;
const providerInfo = document.getElementById('providerInfo') as HTMLElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const testBtn = document.getElementById('testBtn') as HTMLButtonElement;
const statusMessage = document.getElementById('statusMessage') as HTMLElement;

// Provider-specific info
const providerDetails: Record<
  Provider,
  {
    apiKeyRequired: boolean;
    apiKeyHelp: string;
    apiKeyLink: string;
    defaultBaseUrl: string;
    defaultModel: string;
    info: string;
  }
> = {
  openai: {
    apiKeyRequired: true,
    apiKeyHelp: 'Get your API key from',
    apiKeyLink: 'https://platform.openai.com/api-keys',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: DEFAULT_MODELS.openai,
    info: `
      <h4>OpenAI Setup</h4>
      <ul>
        <li>Create an account at <a href="https://platform.openai.com" target="_blank" rel="noopener">platform.openai.com</a></li>
        <li>Generate an API key in the API Keys section</li>
        <li>Recommended model: gpt-4o-mini (cost-effective)</li>
      </ul>
    `,
  },
  gemini: {
    apiKeyRequired: true,
    apiKeyHelp: 'Get your API key from',
    apiKeyLink: 'https://aistudio.google.com/app/apikey',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: DEFAULT_MODELS.gemini,
    info: `
      <h4>Google Gemini Setup</h4>
      <ul>
        <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a></li>
        <li>Create an API key</li>
        <li>Recommended model: gemini-1.5-flash (fast and free tier available)</li>
      </ul>
    `,
  },
  ollama: {
    apiKeyRequired: false,
    apiKeyHelp: '',
    apiKeyLink: '',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: DEFAULT_MODELS.ollama,
    info: `
      <h4>Ollama Setup (Local)</h4>
      <ul>
        <li>Install Ollama from <a href="https://ollama.ai" target="_blank" rel="noopener">ollama.ai</a></li>
        <li>Run <code>ollama pull llama3.2</code> to download a model</li>
        <li>Start Ollama with <code>ollama serve</code></li>
        <li>No API key required - runs completely locally</li>
      </ul>
    `,
  },
};

/**
 * Update UI based on selected provider
 */
function updateProviderUI(provider: Provider): void {
  const details = providerDetails[provider];

  // Show/hide API key field
  if (details.apiKeyRequired) {
    apiKeyGroup.classList.remove('hidden');
    apiKeyHelp.innerHTML = `${details.apiKeyHelp} <a href="${details.apiKeyLink}" target="_blank" rel="noopener">${new URL(details.apiKeyLink).hostname}</a>`;
  } else {
    apiKeyGroup.classList.add('hidden');
  }

  // Update placeholders
  baseUrlInput.placeholder = details.defaultBaseUrl;
  modelInput.placeholder = details.defaultModel;

  // Update help text
  baseUrlHelp.textContent = `Default: ${details.defaultBaseUrl}`;
  modelHelp.textContent = `Default: ${details.defaultModel}`;

  // Update provider info
  providerInfo.innerHTML = details.info;
}

/**
 * Show status message
 */
function showStatus(message: string, type: 'success' | 'error' | 'info'): void {
  statusMessage.textContent = message;
  statusMessage.className = `status-message visible ${type}`;
}

/**
 * Hide status message
 */
function hideStatus(): void {
  statusMessage.classList.remove('visible');
}

/**
 * Load current config into form
 */
async function loadConfig(): Promise<void> {
  try {
    const config = await getConfig();

    providerSelect.value = config.provider;
    apiKeyInput.value = config.apiKey ?? '';
    baseUrlInput.value = config.baseURL ?? '';
    modelInput.value = config.model ?? '';

    updateProviderUI(config.provider);
  } catch (e) {
    showStatus('Error loading settings', 'error');
  }
}

/**
 * Get current form values as Config
 */
function getFormConfig(): Config {
  const provider = providerSelect.value as Provider;

  return {
    provider,
    apiKey: apiKeyInput.value.trim() || undefined,
    baseURL: baseUrlInput.value.trim() || undefined,
    model: modelInput.value.trim() || undefined,
  };
}

/**
 * Save settings
 */
async function handleSave(): Promise<void> {
  const config = getFormConfig();

  // Validate
  if (providerDetails[config.provider].apiKeyRequired && !config.apiKey) {
    showStatus('API key is required for this provider', 'error');
    apiKeyInput.focus();
    return;
  }

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    await saveConfig(config);
    showStatus('Settings saved successfully!', 'success');

    setTimeout(hideStatus, 3000);
  } catch (e) {
    showStatus('Error saving settings', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Settings';
  }
}

/**
 * Test connection
 */
async function handleTest(): Promise<void> {
  const config = getFormConfig();

  // Validate
  if (providerDetails[config.provider].apiKeyRequired && !config.apiKey) {
    showStatus('API key is required for this provider', 'error');
    apiKeyInput.focus();
    return;
  }

  try {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    showStatus('Testing connection...', 'info');

    const response = (await chrome.runtime.sendMessage({
      action: 'TEST_CONNECTION',
      config,
    })) as TestConnectionResponse;

    if (response.success) {
      showStatus('Connection successful! Your settings are working.', 'success');
    } else {
      showStatus(`Connection failed: ${response.error}`, 'error');
    }
  } catch (e) {
    showStatus(`Error testing connection: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
}

/**
 * Handle provider change
 */
function handleProviderChange(): void {
  const provider = providerSelect.value as Provider;
  updateProviderUI(provider);
  hideStatus();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();

  providerSelect.addEventListener('change', handleProviderChange);
  saveBtn.addEventListener('click', handleSave);
  testBtn.addEventListener('click', handleTest);
});
