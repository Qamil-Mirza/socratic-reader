import { describe, it, expect, beforeEach } from 'vitest';
import { resetChromeMocks, mockStorageData } from './mocks/chrome';
import { getConfig, saveConfig, getNotes, saveNote, deleteNote } from '../shared/storage';
import type { Config, SavedNote } from '../shared/types';

describe('Storage Layer', () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  describe('getConfig', () => {
    it('returns default config when storage is empty', async () => {
      const config = await getConfig();
      
      expect(config.provider).toBe('openai');
      expect(config.apiKey).toBeUndefined();
    });

    it('returns stored config', async () => {
      mockStorageData['config'] = { provider: 'gemini', apiKey: 'test-key' };
      
      const config = await getConfig();
      
      expect(config.provider).toBe('gemini');
      expect(config.apiKey).toBe('test-key');
    });

    it('returns stored config with all fields', async () => {
      mockStorageData['config'] = {
        provider: 'ollama',
        baseURL: 'http://custom:11434',
        model: 'custom-model',
      };
      
      const config = await getConfig();
      
      expect(config.provider).toBe('ollama');
      expect(config.baseURL).toBe('http://custom:11434');
      expect(config.model).toBe('custom-model');
    });
  });

  describe('saveConfig', () => {
    it('persists config to storage', async () => {
      const config: Config = { provider: 'ollama', baseURL: 'http://custom:11434' };
      
      await saveConfig(config);
      
      expect(mockStorageData['config']).toEqual(config);
    });

    it('overwrites existing config', async () => {
      mockStorageData['config'] = { provider: 'openai', apiKey: 'old-key' };
      
      const newConfig: Config = { provider: 'gemini', apiKey: 'new-key' };
      await saveConfig(newConfig);
      
      expect(mockStorageData['config']).toEqual(newConfig);
    });
  });

  describe('getNotes', () => {
    it('returns empty array for URL with no notes', async () => {
      const notes = await getNotes('https://example.com/article');
      
      expect(notes).toEqual([]);
    });

    it('returns notes filtered by URL', async () => {
      const note: SavedNote = {
        highlightId: 'h1',
        url: 'https://example.com/article',
        start: 0,
        end: 10,
        text: 'test text',
        note: 'my note',
        createdAt: Date.now(),
      };
      mockStorageData['notes:example.com/article:h1'] = note;
      
      const notes = await getNotes('https://example.com/article');
      
      expect(notes).toContainEqual(note);
    });

    it('does not return notes from different URLs', async () => {
      const note: SavedNote = {
        highlightId: 'h1',
        url: 'https://example.com/other-article',
        start: 0,
        end: 10,
        text: 'test text',
        note: 'my note',
        createdAt: Date.now(),
      };
      mockStorageData['notes:example.com/other-article:h1'] = note;
      
      const notes = await getNotes('https://example.com/article');
      
      expect(notes).toEqual([]);
    });

    it('returns multiple notes sorted by creation time', async () => {
      const note1: SavedNote = {
        highlightId: 'h1',
        url: 'https://example.com/article',
        start: 0,
        end: 10,
        text: 'text 1',
        note: 'note 1',
        createdAt: 1000,
      };
      const note2: SavedNote = {
        highlightId: 'h2',
        url: 'https://example.com/article',
        start: 20,
        end: 30,
        text: 'text 2',
        note: 'note 2',
        createdAt: 2000,
      };
      mockStorageData['notes:example.com/article:h1'] = note1;
      mockStorageData['notes:example.com/article:h2'] = note2;
      
      const notes = await getNotes('https://example.com/article');
      
      expect(notes).toHaveLength(2);
      expect(notes[0].createdAt).toBeLessThan(notes[1].createdAt);
    });
  });

  describe('saveNote', () => {
    it('stores note with correct key format', async () => {
      const note: SavedNote = {
        highlightId: 'h-42',
        url: 'https://example.com/path',
        start: 100,
        end: 150,
        text: 'highlighted text',
        note: 'my note',
        createdAt: Date.now(),
      };
      
      await saveNote(note);
      
      expect(mockStorageData['notes:example.com/path:h-42']).toEqual(note);
    });

    it('overwrites existing note', async () => {
      const oldNote: SavedNote = {
        highlightId: 'h-1',
        url: 'https://example.com/page',
        start: 0,
        end: 10,
        text: 'old text',
        note: 'old note',
        createdAt: 1000,
      };
      mockStorageData['notes:example.com/page:h-1'] = oldNote;
      
      const newNote: SavedNote = {
        highlightId: 'h-1',
        url: 'https://example.com/page',
        start: 0,
        end: 10,
        text: 'old text',
        note: 'updated note',
        createdAt: 2000,
      };
      await saveNote(newNote);
      
      expect((mockStorageData['notes:example.com/page:h-1'] as SavedNote).note).toBe('updated note');
    });
  });

  describe('deleteNote', () => {
    it('removes note from storage', async () => {
      const note: SavedNote = {
        highlightId: 'h-42',
        url: 'https://example.com/path',
        start: 100,
        end: 150,
        text: 'highlighted text',
        note: 'my note',
        createdAt: Date.now(),
      };
      mockStorageData['notes:example.com/path:h-42'] = note;
      
      await deleteNote('https://example.com/path', 'h-42');
      
      expect(mockStorageData['notes:example.com/path:h-42']).toBeUndefined();
    });

    it('does not throw when deleting non-existent note', async () => {
      await expect(deleteNote('https://example.com/path', 'non-existent')).resolves.not.toThrow();
    });
  });
});
