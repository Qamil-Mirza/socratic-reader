import { Config, DEFAULT_CONFIG, SavedNote, Highlight } from './types';

const CONFIG_KEY = 'config';
const NOTES_PREFIX = 'notes:';
const CACHE_PREFIX = 'cache:';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cached analysis result
interface CachedAnalysis {
  highlights: Highlight[];
  timestamp: number;
  contentHash: string; // To detect if page content changed
}

/**
 * Extract origin + pathname from URL for storage key
 */
function getUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Generate storage key for a note
 */
function getNoteKey(url: string, highlightId: string): string {
  return `${NOTES_PREFIX}${getUrlKey(url)}:${highlightId}`;
}

/**
 * Get configuration from storage
 */
export async function getConfig(): Promise<Config> {
  const result = await chrome.storage.sync.get(CONFIG_KEY);
  return result[CONFIG_KEY] ?? { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to storage
 */
export async function saveConfig(config: Config): Promise<void> {
  await chrome.storage.sync.set({ [CONFIG_KEY]: config });
}

/**
 * Get all notes for a given URL
 */
export async function getNotes(url: string): Promise<SavedNote[]> {
  const urlKey = getUrlKey(url);
  const prefix = `${NOTES_PREFIX}${urlKey}:`;
  
  // Get all storage items
  const allItems = await chrome.storage.sync.get(null);
  
  // Filter for notes matching this URL
  const notes: SavedNote[] = [];
  for (const [key, value] of Object.entries(allItems)) {
    if (key.startsWith(prefix) && value) {
      notes.push(value as SavedNote);
    }
  }
  
  // Sort by creation time
  notes.sort((a, b) => a.createdAt - b.createdAt);
  return notes;
}

/**
 * Get a specific note by URL and highlight ID
 */
export async function getNote(url: string, highlightId: string): Promise<SavedNote | null> {
  const key = getNoteKey(url, highlightId);
  const result = await chrome.storage.sync.get(key);
  return result[key] ?? null;
}

/**
 * Save a note
 */
export async function saveNote(note: SavedNote): Promise<void> {
  const key = getNoteKey(note.url, note.highlightId);
  await chrome.storage.sync.set({ [key]: note });
}

/**
 * Delete a note
 */
export async function deleteNote(url: string, highlightId: string): Promise<void> {
  const key = getNoteKey(url, highlightId);
  await chrome.storage.sync.remove(key);
}

/**
 * Delete all notes for a URL
 */
export async function deleteNotesForUrl(url: string): Promise<void> {
  const urlKey = getUrlKey(url);
  const prefix = `${NOTES_PREFIX}${urlKey}:`;
  
  const allItems = await chrome.storage.sync.get(null);
  const keysToRemove: string[] = [];
  
  for (const key of Object.keys(allItems)) {
    if (key.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }
  
  if (keysToRemove.length > 0) {
    await chrome.storage.sync.remove(keysToRemove);
  }
}

/**
 * Get storage usage info (chrome.storage.sync has 100KB limit)
 */
export async function getStorageUsage(): Promise<{ used: number; total: number }> {
  const bytesInUse = await chrome.storage.sync.getBytesInUse(null);
  return {
    used: bytesInUse,
    total: chrome.storage.sync.QUOTA_BYTES,
  };
}

// =============================================================================
// Analysis Cache (using chrome.storage.local for larger storage)
// =============================================================================

/**
 * Generate a simple hash of content for cache invalidation
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Get cache key for a URL
 */
function getCacheKey(url: string): string {
  return `${CACHE_PREFIX}${getUrlKey(url)}`;
}

/**
 * Get cached analysis for a URL
 */
export async function getCachedAnalysis(
  url: string,
  contentHash: string
): Promise<Highlight[] | null> {
  const key = getCacheKey(url);
  const result = await chrome.storage.local.get(key);
  const cached = result[key] as CachedAnalysis | undefined;

  if (!cached) {
    return null;
  }

  // Check if cache is expired
  if (Date.now() - cached.timestamp > CACHE_MAX_AGE_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }

  // Check if content has changed
  if (cached.contentHash !== contentHash) {
    await chrome.storage.local.remove(key);
    return null;
  }

  return cached.highlights;
}

/**
 * Save analysis to cache
 */
export async function setCachedAnalysis(
  url: string,
  highlights: Highlight[],
  contentHash: string
): Promise<void> {
  const key = getCacheKey(url);
  const cached: CachedAnalysis = {
    highlights,
    timestamp: Date.now(),
    contentHash,
  };
  await chrome.storage.local.set({ [key]: cached });
}

/**
 * Clear cache for a URL
 */
export async function clearCachedAnalysis(url: string): Promise<void> {
  const key = getCacheKey(url);
  await chrome.storage.local.remove(key);
}

/**
 * Generate content hash for cache key
 */
export function generateContentHash(text: string): string {
  return hashContent(text);
}
