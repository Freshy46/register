// J.A.R.V.I.S. front end: chat, streaming, voice in (Web Speech) and voice out (speechSynthesis).
const log = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const micBtn = document.getElementById("mic");
const voiceBtn = document.getElementById("voice-toggle");
const clearBtn = document.getElementById("clear");
const hudStatus = document.getElementById("hud-status");

const STORAGE_KEY = "jarvis.history";
const VOICE_KEY = "jarvis.voice";
const GREETING = "Good day, Sir. All systems are online. How may I be of assistance?";

let history = load(STORAGE_KEY, []);
let voiceOn = load(VOICE_KEY, false);
let busy = false;

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; carry on */
  }
}

// ---------- rendering ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

// Small, safe Markdown subset: fenced code, lists, paragraphs, inline code/bold/italic.
function renderMarkdown(src) {
  const parts = src.split(/```/);
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const code = part.replace(/^[\w+-]*\n/, "");
      html += `<pre><code>${escapeHtml(code)}</code></pre>`;
      return;
    }
    for (const block of part.split(/\n{2,}/)) {
      const text = block.trim();
      if (!text) continue;
      const lines = text.split("\n");
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        html += "<ul>" + lines.map((l) => `<li>${inline(escapeHtml(l.replace(/^\s*[-*•]\s+/, "")))}</li>`).join("") + "</ul>";
      } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        html += "<ol>" + lines.map((l) => `<li>${inline(escapeHtml(l.replace(/^\s*\d+[.)]\s+/, "")))}</li>`).join("") + "</ol>";
      } else {
        html += `<p>${inline(escapeHtml(text.replace(/^#+\s*/gm, ""))).replace(/\n/g, "<br>")}</p>`;
      }
    }
  });
  return html;
}

function addMessage(role, content, extraClass = "") {
  const el = document.createElement("div");
  el.className = `msg ${role} ${extraClass}`.trim();
  el.innerHTML = `<span class="who">${role === "user" ? "YOU" : "J.A.R.V.I.S."}</span><div class="body"></div>`;
  const body = el.querySelector(".body");
  if (role === "user") body.textContent = content;
  else body.innerHTML = renderMarkdown(content);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return body;
}

function renderAll() {
  log.innerHTML = "";
  if (!history.length) addMessage("assistant", GREETING);
  for (const m of history) addMessage(m.role, m.content);
}

function setBusy(on) {
  busy = on;
  document.body.classList.toggle("busy", on);
  sendBtn.disabled = on;
  hudStatus.textContent = on ? "PROCESSING" : "ONLINE";
}

// ---------- voice out ----------
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george|ryan/i.test(v.name)) ||
    voices.find((v) => /en-GB/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang))
  );
}

function speak(text) {
  if (!voiceOn || !("speechSynthesis" in window)) return;
  const plain = text.replace(/```[\s\S]*?```/g, " (code omitted) ").replace(/[*_`#>]/g, "");
  const u = new SpeechSynthesisUtterance(plain);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.02;
  u.pitch = 0.9;
  u.onstart = () => document.body.classList.add("speaking");
  u.onend = u.onerror = () => document.body.classList.remove("speaking");
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function updateVoiceBtn() {
  voiceBtn.setAttribute("aria-pressed", String(voiceOn));
  voiceBtn.textContent = voiceOn ? "🔊 Voice" : "🔈 Voice";
}

if (!("speechSynthesis" in window)) voiceBtn.hidden = true;
voiceBtn.addEventListener("click", () => {
  voiceOn = !voiceOn;
  save(VOICE_KEY, voiceOn);
  updateVoiceBtn();
  if (!voiceOn) speechSynthesis.cancel();
});

// ---------- voice in ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if (Recognition) {
  recognizer = new Recognition();
  recognizer.lang = "en-GB";
  recognizer.interimResults = true;
  recognizer.onresult = (e) => {
    input.value = Array.from(e.results, (r) => r[0].transcript).join("");
    autosize();
    if (e.results[e.results.length - 1].isFinal) form.requestSubmit();
  };
  recognizer.onend = () => micBtn.classList.remove("listening");
  micBtn.addEventListener("click", () => {
    if (micBtn.classList.contains("listening")) return recognizer.stop();
    micBtn.classList.add("listening");
    recognizer.start();
  });
} else {
  micBtn.hidden = true;
}

// ---------- chat ----------
async function sendMessage(text) {
  history.push({ role: "user", content: text });
  save(STORAGE_KEY, history);
  addMessage("user", text);

  const body = addMessage("assistant", "");
  body.classList.add("cursor");
  setBusy(true);

  let reply = "";
  let error = null;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history })
    });
    if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5));
        if (evt.type === "text") {
          reply += evt.text;
          body.innerHTML = renderMarkdown(reply);
          log.scrollTop = log.scrollHeight;
        } else if (evt.type === "error") {
          error = evt.message;
        }
      }
    }
  } catch (e) {
    error = `I seem to have lost contact with my server, Sir. (${e.message})`;
  }

  body.classList.remove("cursor");
  if (reply) {
    history.push({ role: "assistant", content: reply });
    save(STORAGE_KEY, history);
    speak(reply);
  }
  if (error) {
    if (!reply) {
      // Drop the unanswered turn so the next request stays well-formed.
      history.pop();
      save(STORAGE_KEY, history);
      body.parentElement.remove();
    }
    addMessage("assistant", error, "error");
  }
  setBusy(false);
  input.focus();
}

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  autosize();
  sendMessage(text);
});

input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

clearBtn.addEventListener("click", () => {
  history = [];
  save(STORAGE_KEY, history);
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  renderAll();
});

updateVoiceBtn();
renderAll();
input.focus();
