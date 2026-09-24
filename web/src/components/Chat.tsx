import { useEffect, useRef, useState } from "react";
import { SPEECH_LOCALE, levelLabel, tr } from "../i18n";
import { levelClass } from "../format";
import type { ChatResponse } from "../types";

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  res?: ChatResponse;
  error?: boolean;
}

interface Props {
  messages: Message[];
  busy: boolean;
  lang: string;
  activeId: string | null;
  suggestions: string[];
  onSend: (text: string) => void;
  onSelect: (id: string) => void;
}

const SpeechRecognitionImpl: any =
  typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

export default function Chat({ messages, busy, lang, activeId, suggestions, onSend, onSelect }: Props) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    // scroll the message list only — never the page (on phones the decision card must stay in view)
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
  };

  const toggleMic = () => {
    if (!SpeechRecognitionImpl) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognitionImpl();
    rec.lang = SPEECH_LOCALE[lang === "auto" ? "en" : lang] ?? "en-IN";
    rec.interimResults = false;
    rec.onresult = (e: any) => setText((prev) => (prev ? prev + " " : "") + e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const speak = (m: Message) => {
    if (!("speechSynthesis" in window) || !m.res) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(m.text);
    u.lang = SPEECH_LOCALE[m.res.language] ?? "en-IN";
    window.speechSynthesis.speak(u);
  };

  return (
    <section className="chat card" aria-label="Conversation">
      <div className="messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="welcome">
            <p>
              <b>Namaste! ORCA</b> checks sea safety, fishing zones, routes, tides and official warnings — in English, हिन्दी, தமிழ்,
              తెలుగు, മലയാളം and more.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`msg ${m.role} ${m.error ? "error" : ""} ${m.id === activeId ? "active" : ""}`}
            onClick={() => m.res && onSelect(m.id)}
          >
            {m.role === "assistant" && m.res?.cards.safety && (
              <span className={`badge ${levelClass(m.res.cards.safety.risk_level)}`}>
                {levelLabel(lang === "auto" ? m.res.language : lang, m.res.cards.safety.risk_level)}
              </span>
            )}
            <div className="msg-text" lang={m.res?.language}>
              {m.text}
            </div>
            {m.role === "assistant" && m.res && (
              <div className="msg-meta small muted">
                {m.res.answer_source === "llm" ? "LLM explanation (verified)" : "template explanation"} · {m.res.language_name}
                {m.res.simulated && " · SIMULATED"}
                {"speechSynthesis" in window && (
                  <button className="linkish" onClick={(e) => (e.stopPropagation(), speak(m))}>
                    🔊 {tr(lang === "auto" ? m.res.language : lang, "listen")}
                  </button>
                )}
                {m.res.answer_note && <div className="note">{m.res.answer_note}</div>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant pending">ORCA agents are working…</div>}
      </div>
      <div className="chips" aria-label="Suggestions">
        {suggestions.map((s) => (
          <button key={s} className="chip" disabled={busy} onClick={() => submit(s)}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tr(lang === "auto" ? "en" : lang, "placeholder")}
          aria-label="Your question"
        />
        {SpeechRecognitionImpl && (
          <button type="button" className={`icon ${listening ? "active" : ""}`} onClick={toggleMic} aria-label="Speak">
            🎤
          </button>
        )}
        <button type="submit" disabled={busy || !text.trim()}>
          {tr(lang === "auto" ? "en" : lang, "send")}
        </button>
      </form>
    </section>
  );
}
