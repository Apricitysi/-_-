# AI Generator (Streaming)

A minimal full-stack AI text generator with streaming:

- Backend: Python Flask
- Providers: OpenAI (if `OPENAI_API_KEY` is set) or an offline Markov fallback
- Frontend: Simple HTML/JS that streams tokens as they arrive

## Quick start

1. Create and activate a virtual environment (optional but recommended):
```bash
python3 -m venv .venv && source .venv/bin/activate
```

2. Install dependencies:
```bash
python3 -m pip install -r requirements.txt
```

3. (Optional) Configure OpenAI:
- Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
- You can also export the variable directly:
```bash
export OPENAI_API_KEY=sk-...
```

4. Run the server:
```bash
python app.py
```

5. Open the app:
- Visit `http://localhost:5000` in your browser.
- Enter a prompt and click Generate. If `OPENAI_API_KEY` is configured, it will stream from OpenAI. Otherwise, it will stream from the built-in Markov generator.

## API

POST `/api/generate`

Request body (JSON):
```json
{
  "prompt": "Explain quantum computing in simple terms",
  "provider": "auto",
  "model": "gpt-4o-mini",
  "maxTokens": 400,
  "temperature": 0.7
}
```

Response: `text/event-stream`
- Server streams lines prefixed with `data: ` containing JSON chunks:
```json
{"text": "partial text...", "done": false}
```
- Final message: `{ "done": true }`

## Notes
- The Markov fallback uses a small bundled corpus in `corpus/sample.txt` and does not require network or keys.
- The OpenAI integration uses the Chat Completions streaming API.