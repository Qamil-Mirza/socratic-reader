# Socratic Reader

A Chrome Extension that helps you read philosophy intentionally by highlighting key claims and generating Socratic questions.

## Features

- **Smart Text Extraction**: Analyzes selected text or visible content in the viewport
- **AI-Powered Analysis**: Identifies key claims and arguments worth interrogating
- **Socratic Questions**: Generates thought-provoking questions for each highlighted claim
- **Note-Taking**: Save your thoughts and reflections tied to specific highlights
- **Multiple LLM Providers**: Supports OpenAI, Google Gemini, and Ollama (local)
- **Keyboard Shortcut**: Quick toggle with `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac)

## Installation

### Prerequisites

- Node.js 18+ and npm
- Chrome browser

### Build from Source

1. Clone or download this repository:
   ```bash
   cd socratic-reader
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `dist` folder

### Development Mode

For active development with hot reload:
```bash
npm run dev
```

This watches for file changes and rebuilds automatically. You'll still need to reload the extension in Chrome after changes.

## Configuration

### Setting Up an LLM Provider

1. Click the extension icon and select "Settings" (or right-click the icon → Options)
2. Choose your provider:

#### OpenAI (Recommended)
- Create an account at [platform.openai.com](https://platform.openai.com)
- Generate an API key at [API Keys](https://platform.openai.com/api-keys)
- Paste your API key in the settings
- Recommended model: `gpt-4o-mini` (cost-effective)

#### Google Gemini
- Get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
- Paste your API key in the settings
- Recommended model: `gemini-1.5-flash` (fast, free tier available)

#### Ollama (Local/Private)
- Install Ollama from [ollama.ai](https://ollama.ai)
- Pull a model: `ollama pull llama3.2`
- Start the server: `ollama serve`
- No API key required - runs completely offline

### Test Your Configuration

Click "Test Connection" in settings to verify your setup is working.

## Usage

### Basic Usage

1. Navigate to an article or philosophical text
2. **Option A**: Select specific text you want to analyze
3. **Option B**: Just scroll to the content (it will analyze visible text)
4. Click the extension icon and press "Analyze Page" (or use `Ctrl+Shift+S`)
5. Wait for the analysis to complete
6. Review highlights in the sidebar

### Working with Highlights

- **Navigate**: Use the Prev/Next buttons or click items in the sidebar
- **Jump to text**: Click a highlight in the sidebar to scroll to it on the page
- **Take notes**: Each highlight has a note field - type and click "Save Note"
- **Close**: Click the × button or press the keyboard shortcut again

### Keyboard Shortcuts

- `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac): Toggle the overlay

## PDF Files

Chrome's built-in PDF viewer creates a sandboxed environment that prevents extensions from accessing the document content. To use Socratic Reader with PDFs:

### Workarounds

1. **Use HTML versions**: Many academic papers have HTML versions (look for "View HTML" links)

2. **Copy text manually**: 
   - Select and copy text from the PDF
   - Paste into a text editor or note-taking app
   - Use Socratic Reader on that page

3. **Use online PDF readers**: Services like [Hypothesis](https://hypothes.is/) or browser-based PDF viewers may allow extension access

4. **Convert to HTML**: Use tools like Calibre or online converters to convert PDFs to HTML

## Testing

Run the test suite:
```bash
npm run test
```

Watch mode for development:
```bash
npm run test:watch
```

Generate coverage report:
```bash
npm run test:coverage
```

## Manual Test Checklist

Before releasing, verify these scenarios:

- [ ] Selection analysis works on a Wikipedia article
- [ ] Viewport fallback works when nothing is selected
- [ ] Highlights render correctly and are clickable
- [ ] Clicking a highlight in the sidebar scrolls to it on the page
- [ ] Notes persist after page refresh
- [ ] Notes persist after browser restart
- [ ] Provider switching works (OpenAI → Gemini → Ollama)
- [ ] Test connection button works for each provider
- [ ] Test connection shows error for invalid API key
- [ ] Keyboard shortcut toggles overlay
- [ ] Error states display correctly in sidebar
- [ ] Long articles chunk properly with progress indicator
- [ ] Overlay close button works
- [ ] Prev/Next navigation cycles through highlights

## Project Structure

```
socratic-reader/
├── manifest.json           # Chrome extension manifest (MV3)
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Build configuration
├── vitest.config.ts        # Test configuration
├── src/
│   ├── background.ts       # Service worker (message hub, LLM calls)
│   ├── content.ts          # Content script (extraction, highlighting, UI)
│   ├── styles.css          # Overlay and highlight styles
│   ├── popup/
│   │   ├── popup.html      # Extension popup
│   │   └── popup.ts        # Popup logic
│   ├── options/
│   │   ├── options.html    # Settings page
│   │   └── options.ts      # Settings logic
│   ├── shared/
│   │   ├── types.ts        # TypeScript interfaces
│   │   ├── storage.ts      # Chrome storage wrappers
│   │   └── llm.ts          # LLM provider abstraction
│   └── __tests__/          # Test files
├── public/
│   └── icons/              # Extension icons
└── dist/                   # Build output (load this in Chrome)
```

## Privacy

- **No page text is stored**: Only your notes and character offsets are saved
- **Notes sync with Chrome**: Uses `chrome.storage.sync` to persist across devices
- **API calls are direct**: Text is sent directly to your chosen LLM provider
- **Local option**: Use Ollama for completely offline, private analysis

## Troubleshooting

### "Could not highlight on this page"

Some pages have complex DOM structures that prevent highlighting. The analysis results will still appear in the sidebar.

### "API key not set"

Open Settings and configure your LLM provider with a valid API key.

### Extension doesn't work on certain pages

Chrome extensions cannot run on:
- `chrome://` pages (Chrome internal pages)
- `chrome-extension://` pages (Other extensions)
- Chrome Web Store pages
- PDF files in Chrome's built-in viewer

### Highlights don't appear

1. Make sure there's enough text content on the page
2. Try selecting specific text before analyzing
3. Check the browser console for errors (`F12` → Console)

## License

MIT License - feel free to use, modify, and distribute.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request
