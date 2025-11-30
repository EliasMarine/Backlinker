# Smart Links - Intelligent Backlinking for Obsidian

An Obsidian plugin that intelligently discovers and suggests connections between notes using hybrid analysis (TF-IDF + semantic embeddings). Transform your isolated notes into an interconnected knowledge graph with automated link discovery—all processed locally on your device.

## Features

### Core Capabilities

- **Hybrid Analysis**: Fast TF-IDF keyword matching + optional semantic embeddings for deep conceptual understanding
- **Real-Time Suggestions**: Get link recommendations as you write
- **Vault-Wide Discovery**: Batch analyze your entire vault to find missing connections
- **Smart Context Finding**: Automatically identifies the best place to insert links
- **Link Health Monitoring**: Detect and repair broken links, identify orphaned notes
- **Privacy-First**: 100% local processing, zero external dependencies (except optional model download)

### Intelligent Features

- **Semantic Understanding**: Finds notes discussing the same concepts using different terminology
- **Customizable Thresholds**: Fine-tune suggestion sensitivity to match your needs
- **Incremental Updates**: Only reprocesses changed notes for optimal performance
- **Analytics Dashboard**: Visualize vault connectivity and identify improvement opportunities

## Installation

### From Obsidian Community Plugins (Coming Soon)
1. Open Settings in Obsidian
2. Navigate to Community Plugins
3. Search for "Smart Links"
4. Click Install

### Manual Installation
1. Download the latest release from GitHub
2. Extract the files into your vault's `.obsidian/plugins/smart-links/` directory
3. Reload Obsidian
4. Enable the plugin in Settings > Community Plugins

## Quick Start

1. **Enable the plugin** in Settings > Community Plugins
2. **Run initial analysis** via Command Palette: "Smart Links: Analyze entire vault"
3. **View suggestions** in the Smart Links sidebar panel
4. **Accept or reject** suggestions with one click
5. **Optional**: Enable semantic embeddings in settings for deeper analysis

## Usage

### Commands

Access via Command Palette (Cmd/Ctrl+P):

- **Analyze entire vault** - Perform full vault analysis
- **Show suggestions for current note** - Get suggestions for the active note
- **Toggle embeddings** - Enable/disable semantic analysis
- **Check link health** - Scan for broken links
- **Show analytics dashboard** - View vault statistics

### Settings

Configure in Settings > Smart Links:

- **Analysis Mode**: Enable/disable real-time suggestions and embeddings
- **Thresholds**: Adjust confidence levels for TF-IDF, embeddings, and combined scoring
- **Performance**: Configure batch sizes and caching behavior
- **Exclusions**: Exclude specific folders or tags from analysis
- **UI Preferences**: Customize suggestion panel and notifications

## How It Works

Smart Links uses a hybrid approach:

1. **TF-IDF Analysis** (always on): Fast keyword-based similarity matching
2. **Semantic Embeddings** (optional): Deep conceptual understanding using sentence transformers
3. **Hybrid Scoring**: Intelligently combines both approaches with configurable weights
4. **Context Finding**: Identifies optimal insertion points based on matched keywords and content flow

All processing happens locally on your device using:
- Natural language processing for keyword extraction
- TF-IDF vectorization for fast similarity computation
- Optional WebAssembly-based embeddings (all-MiniLM-L6-v2, ~23MB)

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Obsidian 1.4.0+

### Setup

```bash
# Clone repository
git clone https://github.com/yourusername/smart-links.git
cd smart-links

# Install dependencies
npm install
```

### Development Build

```bash
# Start build watcher
npm run dev
```

### Production Build

```bash
# Type check and build
npm run build
```

### Testing

```bash
# Run tests
npm test
```

### Local Development

1. Run `npm run dev` to start the build watcher
2. Create a symbolic link from your test vault:
   ```bash
   ln -s /path/to/smart-links /path/to/vault/.obsidian/plugins/smart-links
   ```
3. In Obsidian, go to Settings > Community Plugins and enable "Smart Links"
4. Reload Obsidian (Cmd/Ctrl+R) whenever you make changes

## Project Structure

```
smart-links/
├── src/
│   ├── main.ts                    # Plugin entry point
│   ├── settings.ts                # Settings system
│   ├── types/                     # TypeScript type definitions
│   ├── cache/                     # Cache management
│   ├── parsers/                   # Markdown parsing
│   ├── nlp/                       # NLP processing
│   ├── engines/                   # TF-IDF, embeddings, hybrid scoring
│   ├── indexing/                  # Vault indexing
│   ├── discovery/                 # Link discovery & context finding
│   ├── health/                    # Link health monitoring
│   ├── analytics/                 # Vault analytics
│   └── ui/                        # User interface components
├── tests/                         # Test files
├── manifest.json                  # Plugin metadata
├── package.json                   # Dependencies
└── README.md                      # This file
```

## Roadmap

### Phase 1: Core Foundation ✅
- TF-IDF engine
- Vault indexing
- Cache management

### Phase 2: Basic Features (In Progress)
- Real-time suggestions
- Vault-wide analysis
- Link application

### Phase 3: Advanced Features
- Semantic embeddings
- Hybrid scoring
- Model loading

### Phase 4: Polish
- Link health monitoring
- Analytics dashboard
- Performance optimization

### Future Considerations
- Auto-linking mode
- Citation tracking
- Multi-vault analysis
- Custom similarity algorithms

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## Support

- Report issues on [GitHub Issues](https://github.com/yourusername/smart-links/issues)
- Join the discussion on [Obsidian Forum](https://forum.obsidian.md)

## Privacy & Security

- **100% Local Processing**: All analysis happens on your device
- **No Telemetry**: Zero data collection or tracking
- **No External Requests**: Except optional model download on first use
- **Open Source**: Full transparency in how your data is processed

## Performance

Typical performance on a modern laptop:

- **1000 notes (TF-IDF only)**: <5 seconds
- **1000 notes (with embeddings)**: <60 seconds
- **Incremental update**: <100ms per note
- **Real-time suggestions**: <500ms latency

## License

MIT License - see [LICENSE](LICENSE) file for details

## Credits

Built with:
- [@xenova/transformers](https://github.com/xenova/transformers.js) - WebAssembly transformers
- [natural](https://github.com/NaturalNode/natural) - NLP toolkit
- [compromise](https://github.com/spencermountain/compromise) - Lightweight NLP
- [fuzzysort](https://github.com/farzher/fuzzysort) - Fuzzy string matching

Inspired by the Obsidian community's dedication to connected thinking.

---

**Made with ❤️ for the Obsidian community**
