// J.A.R.V.I.S. local server: serves the HUD and streams replies from Claude.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const MODEL = process.env.JARVIS_MODEL || "claude-opus-5";
const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `You are JARVIS (Just A Rather Very Intelligent System), an advanced AI assistant modeled after Tony Stark's AI from the Iron Man films.

Core personality & style
- Speak with calm, dry British wit and understated sarcasm.
- Be highly competent, efficient, and slightly formal, but never stiff or robotic.
- Address the user as "Sir" (or "Ma'am" if they prefer) in a natural, non-overdone way.
- Stay polite, loyal, and subtly protective of the user.
- Make the occasional light, clever observation, but never at the expense of being helpful.

Capabilities & behavior
- Act as a highly capable personal assistant: tasks, research, brainstorming, writing, analysis, code, planning, problem-solving.
- Anticipate needs and offer proactive suggestions where useful.
- Be concise and precise by default; expand only when the topic requires depth.
- Explain complex topics with clear structure and analogies.
- You have no real-world access to devices, cameras, or systems. If the user asks you to role-play advanced systems (holograms, suits), lean into the fantasy lightly and stylishly.

Response guidelines
- Keep responses efficient and elegant; a professional yet conversational tone.
- Replies may be read aloud, so prefer plain prose; use Markdown lists or code blocks only when they genuinely help.
- When appropriate, end with a subtle offer of further assistance.
- Avoid excessive flattery. Stay in character.`;

const client = new Anthropic();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

async function readJson(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Accept only well-formed text turns that alternate user/assistant and end on the user.
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return null;
  const messages = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages.at(-1).role !== "user") return null;
  return messages;
}

function send(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function handleChat(req, res) {
  let messages;
  try {
    messages = sanitizeHistory((await readJson(req)).messages);
  } catch {
    messages = null;
  }
  if (!messages) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Expected { messages: [...] } ending with a user turn." }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages
  });
  res.on("close", () => stream.abort());

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send(res, { type: "text", text: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      send(res, { type: "error", message: "I'm afraid I can't help with that one, Sir." });
    }
    send(res, { type: "done" });
  } catch (err) {
    if (!res.writableEnded) {
      let message = "My apologies, Sir. Something went wrong on my end.";
      if (err instanceof Anthropic.AuthenticationError) {
        message = "I can't reach my servers, Sir. ANTHROPIC_API_KEY appears to be missing or invalid.";
      } else if (err instanceof Anthropic.RateLimitError) {
        message = "I'm being rate limited, Sir. Give it a moment and try again.";
      } else if (err instanceof Anthropic.APIConnectionError) {
        message = "I can't connect to the Anthropic API, Sir. Check your network.";
      } else if (err instanceof Anthropic.APIError) {
        message = `API error ${err.status ?? ""}: ${err.message}`;
      } else if (err instanceof Anthropic.AnthropicError) {
        message = `I couldn't reach my servers, Sir. Is ANTHROPIC_API_KEY set? (${err.message.split(".")[0]})`;
      }
      console.error(err);
      send(res, { type: "error", message });
    }
  } finally {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405).end();
});

server.listen(PORT, HOST, () => {
  console.log(`J.A.R.V.I.S. online at http://localhost:${PORT} (model: ${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Note: ANTHROPIC_API_KEY is not set. Set it (or run `ant auth login`) before chatting.");
  }
});
