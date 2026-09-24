# J.A.R.V.I.S.

A local AI assistant with an Iron Man–style HUD, powered by Claude. It stays in character: dry British wit, calls you "Sir", and gets straight to the point.

## Run it

Requires Node.js 18+ and an [Anthropic API key](https://console.anthropic.com/).

```bash
cd jarvis
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

Then open http://localhost:3000.

## Features

- Animated HUD core that speeds up while JARVIS is thinking or speaking
- Replies stream in token by token
- **Voice:** click 🔈 Voice to have replies read aloud (uses a British English voice if your system has one). Click 🎙 to speak your request (Chrome and Edge only)
- The conversation is kept in your browser's local storage. **Reset** clears it

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Your API key (required) |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind. Localhost only by default |
| `JARVIS_MODEL` | `claude-opus-5` | Claude model to use |

The persona lives in `SYSTEM_PROMPT` in `server.js` if you'd like to adjust it.
