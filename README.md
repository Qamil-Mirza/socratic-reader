# Socratic Reader

A Chrome Extension that helps you read philosophy intentionally by highlighting key claims and generating Socratic questions.

## Features

- **Smart Text Extraction**: Analyzes selected text or visible content in the viewport
- **AI-Powered Analysis**: Identifies key claims and arguments worth interrogating
- **Socratic Questions**: Generates thought-provoking questions for each highlighted claim
- **User Highlights**: Select any text while the sidebar is open — a floating `+` button appears; tap it to create a highlight and auto-generate a Socratic question for it
- **Socratic Chat**: Open a multi-turn dialogue on any highlight. The extension conducts elenchus — asking one question at a time — and never lectures
- **Aporia Meter**: A progress bar tracks how close you are to genuine intellectual uncertainty. When you reach aporia (≥ 95 %), a congratulations modal appears
- **Delete Highlights**: Remove any highlight individually with the × button on its card
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
- **Jump to text**: Click the numbered badge on a card to scroll to that highlight on the page
- **Delete**: Hover over a card header and click the × button to remove the highlight and its card
- **Close**: Click the × button in the overlay header or press the keyboard shortcut again

### Highlighting Your Own Text

1. Open the sidebar (`Ctrl+Shift+S`) and let the page finish analyzing
2. Select any passage of 10+ characters on the page
3. A green `+` button appears near the selection — click it
4. The text is immediately highlighted and a Socratic question is generated for it

### Socratic Chat

1. Expand any highlight card and click **▶ Discuss**
2. The sidebar switches to a chat view showing the highlighted passage and an opening question
3. Type your response and press Enter (or click Send) to continue the dialogue
4. The **Progress** bar at the top tracks your journey toward aporia — genuine intellectual uncertainty
5. When the score reaches 95 % or above, a congratulations modal appears. Dismiss it and keep reading

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
│   │   ├── types.ts        # TypeScript interfaces (config, highlights, chat messages)
│   │   ├── storage.ts      # Chrome storage wrappers
│   │   ├── llm.ts          # LLM provider abstraction (analysis, question gen, chat)
│   │   ├── anchoring.ts    # Robust text-anchor descriptors for persistent highlights
│   │   └── semantic-chunking.ts  # Sentence/paragraph-aware text chunking
│   └── __tests__/          # Test files (llm, chat, highlighting, anchoring, …)
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
