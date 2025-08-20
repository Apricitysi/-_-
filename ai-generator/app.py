import os
import json
import random
import re
from typing import Dict, Iterable, List, Tuple

from flask import Flask, Response, request, send_from_directory, jsonify
from dotenv import load_dotenv

# Optional OpenAI import
try:
	from openai import OpenAI  # type: ignore
	_has_openai = True
except Exception:
	OpenAI = None  # type: ignore
	_has_openai = False

load_dotenv()

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")
CORPUS_PATH = os.path.join(APP_DIR, "corpus", "sample.txt")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")


def _read_corpus() -> str:
	try:
		with open(CORPUS_PATH, "r", encoding="utf-8") as f:
			return f.read()
	except Exception:
		# Fallback mini-corpus
		return (
			"Creativity is allowing yourself to make mistakes. "
			"Art is knowing which ones to keep. Inspiration appears during work. "
			"The future belongs to those who learn, unlearn, and relearn."
		)


# Build a simple Markov chain from the corpus
Word = str
State = Tuple[Word, Word]


def build_markov_chain(text: str) -> Dict[State, List[Word]]:
	words = re.findall(r"\b[\w'\-]+\b|[.!?]", text)
	pairs: Dict[State, List[Word]] = {}
	if len(words) < 3:
		return pairs
	for i in range(len(words) - 2):
		state = (words[i], words[i + 1])
		next_word = words[i + 2]
		pairs.setdefault(state, []).append(next_word)
	return pairs


_MARKOV_TEXT = _read_corpus()
_MARKOV_CHAIN = build_markov_chain(_MARKOV_TEXT)


@app.get("/")
def index() -> Response:
	return send_from_directory(STATIC_DIR, "index.html")


@app.get("/health")
def health() -> Response:
	return jsonify({"ok": True})


def _sse(data: Dict) -> str:
	return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _decide_provider(user_choice: str) -> str:
	user_choice = (user_choice or "auto").lower()
	if user_choice == "auto":
		if os.getenv("OPENAI_API_KEY") and _has_openai:
			return "openai"
		return "markov"
	return user_choice


def _normalize_params(body: Dict) -> Dict:
	prompt = (body.get("prompt") or "").strip()
	provider = _decide_provider(body.get("provider") or "auto")
	model = body.get("model") or "gpt-4o-mini"
	max_tokens = int(body.get("maxTokens") or body.get("max_tokens") or 400)
	temperature = float(body.get("temperature") or 0.7)
	return {
		"prompt": prompt,
		"provider": provider,
		"model": model,
		"max_tokens": max_tokens,
		"temperature": temperature,
	}


def stream_openai(prompt: str, model: str, max_tokens: int, temperature: float) -> Iterable[str]:
	if not (_has_openai and os.getenv("OPENAI_API_KEY")):
		yield _sse({"error": "OpenAI not configured", "done": True})
		return
	client = OpenAI()
	messages = [
		{"role": "system", "content": "You are a helpful assistant. Write concise, vivid responses."},
		{"role": "user", "content": prompt},
	]
	try:
		stream = client.chat.completions.create(
			model=model,
			messages=messages,
			max_tokens=max_tokens,
			temperature=temperature,
			stream=True,
		)
		for chunk in stream:
			try:
				delta = chunk.choices[0].delta
				content = getattr(delta, "content", None) if hasattr(delta, "content") else (delta.get("content") if isinstance(delta, dict) else None)
				if content:
					yield _sse({"text": content, "done": False})
			except Exception:
				# Skip malformed chunks
				continue
		yield _sse({"done": True})
	except Exception as e:
		yield _sse({"error": str(e), "done": True})


def stream_markov(prompt: str, max_tokens: int, temperature: float) -> Iterable[str]:
	# Generate words using a simple 2-gram model
	words = re.findall(r"\b[\w'\-]+\b|[.!?]", prompt)
	state: State
	if len(words) >= 2 and (words[-2], words[-1]) in _MARKOV_CHAIN:
		state = (words[-2], words[-1])
	else:
		state = random.choice(list(_MARKOV_CHAIN.keys())) if _MARKOV_CHAIN else ("The", "art")
	generated: List[str] = []
	for _ in range(max_tokens):
		next_candidates = _MARKOV_CHAIN.get(state)
		if not next_candidates:
			break
		# Temperature-controlled sampling: skew selection by duplicating options
		k = max(1, int(1 + temperature * 3))
		bag = next_candidates * k
		next_word = random.choice(bag)
		generated.append(next_word)
		# stream per token
		yield _sse({"text": next_word + (" " if next_word not in ".!?" else ""), "done": False})
		state = (state[1], next_word)
	yield _sse({"done": True})


@app.post("/api/generate")
def generate() -> Response:
	try:
		body = request.get_json(force=True, silent=False) or {}
	except Exception:
		return Response(_sse({"error": "Invalid JSON"}), mimetype="text/event-stream")

	params = _normalize_params(body)
	prompt = params["prompt"]
	provider = params["provider"]
	model = params["model"]
	max_tokens = params["max_tokens"]
	temperature = params["temperature"]

	if not prompt:
		return Response(_sse({"error": "Prompt is required", "done": True}), mimetype="text/event-stream")

	def generate_stream() -> Iterable[str]:
		if provider == "openai":
			yield from stream_openai(prompt, model, max_tokens, temperature)
		else:
			yield from stream_markov(prompt, max_tokens, temperature)

	resp = Response(generate_stream(), mimetype="text/event-stream")
	resp.headers["Cache-Control"] = "no-cache"
	resp.headers["X-Accel-Buffering"] = "no"
	resp.headers["Connection"] = "keep-alive"
	return resp


if __name__ == "__main__":
	host = os.getenv("HOST", "0.0.0.0")
	port = int(os.getenv("PORT", "5000"))
	debug = os.getenv("FLASK_ENV") == "development"
	print(f"Starting server on http://{host}:{port}")
	app.run(host=host, port=port, debug=debug, threaded=True)