"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Headphones,
  Heart,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Send,
  User,
  Wind,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

type Message = {
  id: number;
  role: "user" | "ai";
  text: string;
};

const SUGGESTIONS = [
  { icon: Heart, label: "I've been feeling anxious lately" },
  { icon: Wind, label: "Help me manage stress" },
  { icon: MessageCircle, label: "Talk through my emotions" },
  { icon: Headphones, label: "I need someone to listen" },
];

const AI_RESPONSES = [
  "I hear you — and it takes real courage to put those feelings into words. Can you tell me a little more about what's been weighing on you?",
  "Thank you for sharing that with me. What you're feeling is completely valid. What do you think might be contributing to this?",
  "That sounds genuinely tough, and I'm glad you're here. Let's take it one step at a time. What feels most pressing right now?",
  "You're not alone in this. What does a typical day look like for you when you're feeling this way?",
  "I appreciate your trust in sharing this. There's no rush — what would feel most helpful right now?",
];

export default function Chat() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [responseIdx, setResponseIdx] = useState(0);
  const [showAccount, setShowAccount] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isWelcome = messages.length === 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isWelcome) inputRef.current?.focus();
  }, [isWelcome]);

  const handleSend = (text?: string) => {
    const msgText = (text ?? input).trim();
    if (!msgText) return;

    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: "user", text: msgText },
    ]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "ai",
          text: AI_RESPONSES[responseIdx % AI_RESPONSES.length],
        },
      ]);
      setIsTyping(false);
      setResponseIdx((index) => index + 1);
    }, 1300);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    handleSend();
  };

  const resetChat = () => {
    setMessages([]);
    setInput("");
    setResponseIdx(0);
  };

  const renderInputBar = (autoFocus = false) => (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-2xl px-4 py-2.5 transition-all duration-150"
      style={{ background: "#F4F4F2", border: "1.5px solid #E0E0DC" }}
      onFocusCapture={(event) => {
        event.currentTarget.style.borderColor = "#111110";
        event.currentTarget.style.background = "#FFFFFF";
      }}
      onBlurCapture={(event) => {
        event.currentTarget.style.borderColor = "#E0E0DC";
        event.currentTarget.style.background = "#F4F4F2";
      }}
    >
      <input
        ref={autoFocus ? inputRef : undefined}
        type="text"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="Ask anything…"
        className="flex-1 outline-none bg-transparent"
        style={{ fontSize: "0.875rem", color: "#111110", caretColor: "#111110" }}
      />
      <button
        type="submit"
        disabled={!input.trim()}
        className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all active:scale-90"
        style={{
          width: "34px",
          height: "34px",
          background: input.trim() ? "#111110" : "#E0E0DC",
          color: input.trim() ? "#FFFFFF" : "#6B6B67",
          cursor: input.trim() ? "pointer" : "not-allowed",
          transition: "background 0.15s ease, color 0.15s ease",
        }}
      >
        <Send size={14} />
      </button>
    </form>
  );

  return (
    <div
      className="flex h-screen w-full overflow-hidden"
      style={{
        background: "#FFFFFF",
        color: "#111110",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <aside
        className="hidden md:flex flex-col w-64 flex-shrink-0"
        style={{ background: "#F8F8F6", borderRight: "1px solid #E8E8E5" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 h-[60px] flex-shrink-0"
          style={{ borderBottom: "1px solid #E8E8E5" }}
        >
          <div
            className="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0"
            style={{ background: "#111110" }}
          >
            <Bot size={14} className="text-white" />
          </div>
          <span
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontWeight: 600,
              fontSize: "0.9375rem",
              color: "#111110",
              letterSpacing: "-0.01em",
            }}
          >
            Chatbot
          </span>
        </div>

        <div className="px-4 pt-4 pb-2 flex-shrink-0">
          <button
            onClick={resetChat}
            className="w-full flex items-center justify-center gap-2 rounded-xl transition-all active:scale-[0.97]"
            style={{
              background: "#111110",
              color: "#FFFFFF",
              padding: "9px 16px",
              fontSize: "0.8125rem",
              fontWeight: 500,
            }}
            onMouseEnter={(event) => (event.currentTarget.style.background = "#2A2A28")}
            onMouseLeave={(event) => (event.currentTarget.style.background = "#111110")}
          >
            <Plus size={14} />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <p
            className="px-2 mb-2"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6B6B67",
            }}
          >
            History
          </p>
          <div
            className="px-2 py-2 rounded-lg"
            style={{ fontSize: "0.8125rem", color: "#6B6B67", fontStyle: "italic" }}
          >
            No previous chats
          </div>
        </div>

        <div
          className="flex-shrink-0 px-4 pb-4 pt-3"
          style={{ borderTop: "1px solid #E8E8E5" }}
        >
          <AnimatePresence>
            {showAccount && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="mb-2 rounded-xl overflow-hidden"
                style={{ border: "1px solid #E8E8E5", background: "#FAFAF8" }}
              >
                <div
                  className="flex items-center gap-3 px-3 py-3"
                  style={{ borderBottom: "1px solid #E8E8E5" }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "#111110" }}
                  >
                    <span style={{ color: "#FFFFFF", fontSize: "0.8125rem", fontWeight: 600 }}>
                      AJ
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        color: "#111110",
                        lineHeight: 1.3,
                      }}
                    >
                      Alex Johnson
                    </p>
                    <p
                      className="truncate"
                      style={{ fontSize: "0.75rem", color: "#6B6B67", lineHeight: 1.4 }}
                    >
                      alex@example.com
                    </p>
                  </div>
                </div>
                <div className="px-3 py-2.5 space-y-2">
                  {[
                    { label: "Plan", value: "Free" },
                    { label: "Member since", value: "Jul 2026" },
                    { label: "Sessions", value: "12" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span style={{ fontSize: "0.75rem", color: "#6B6B67" }}>{label}</span>
                      <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#111110" }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={() => setShowAccount((visible) => !visible)}
            className="flex items-center gap-2.5 w-full rounded-xl px-2 py-2.5 transition-colors"
            style={{
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "#2C2C29",
              background: showAccount ? "#EFEFED" : "transparent",
            }}
            onMouseEnter={(event) => (event.currentTarget.style.background = "#EFEFED")}
            onMouseLeave={(event) =>
              (event.currentTarget.style.background = showAccount ? "#EFEFED" : "transparent")
            }
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "#EFEFED" }}
            >
              <User size={13} style={{ color: "#2C2C29" }} />
            </div>
            Account
          </button>

          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2.5 w-full rounded-xl px-2 py-2.5 mt-0.5 transition-colors"
            style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#6B6B67" }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "#EFEFED";
              event.currentTarget.style.color = "#111110";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
              event.currentTarget.style.color = "#6B6B67";
            }}
          >
            <LogOut size={13} style={{ flexShrink: 0 }} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full min-w-0 relative overflow-hidden">
        <header
          className="md:hidden flex items-center justify-between px-4 h-[56px] flex-shrink-0"
          style={{
            borderBottom: "1px solid #E8E8E5",
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(8px)",
          }}
        >
          <button
            className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ color: "#4A4A47" }}
            onMouseEnter={(event) => (event.currentTarget.style.background = "#F4F4F2")}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
          >
            <Menu size={18} />
          </button>
          <span
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontWeight: 600,
              fontSize: "0.9375rem",
              color: "#111110",
              letterSpacing: "-0.01em",
            }}
          >
            Chatbot
          </span>
          <button
            onClick={resetChat}
            className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ color: "#4A4A47" }}
            onMouseEnter={(event) => (event.currentTarget.style.background = "#F4F4F2")}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
          >
            <Plus size={18} />
          </button>
        </header>

        <AnimatePresence mode="wait">
          {isWelcome ? (
            <motion.div
              key="welcome"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col items-center justify-center px-4 pb-8"
            >
              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontWeight: 600,
                  fontSize: "clamp(1.5rem, 4vw, 2rem)",
                  color: "#111110",
                  letterSpacing: "-0.025em",
                  lineHeight: 1.25,
                  marginBottom: "1.75rem",
                  textAlign: "center",
                }}
              >
                Where should we begin?
              </motion.h1>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="w-full"
                style={{ maxWidth: "600px" }}
              >
                {renderInputBar(true)}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.18 }}
                className="w-full mt-3"
                style={{ maxWidth: "600px" }}
              >
                {SUGGESTIONS.map(({ icon: Icon, label }, index) => (
                  <motion.button
                    key={label}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.22, delay: 0.2 + index * 0.055 }}
                    onClick={() => handleSend(label)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                    style={{ color: "#4A4A47" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = "#F4F4F2";
                      event.currentTarget.style.color = "#111110";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = "transparent";
                      event.currentTarget.style.color = "#4A4A47";
                    }}
                  >
                    <Icon size={15} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 400 }}>{label}</span>
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full px-4 py-6 space-y-5" style={{ maxWidth: "680px" }}>
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className={`flex gap-3 items-end ${
                        message.role === "user" ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      {message.role === "ai" ? (
                        <div
                          className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full"
                          style={{ background: "#111110" }}
                        >
                          <Bot size={15} className="text-white" />
                        </div>
                      ) : (
                        <div
                          className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full"
                          style={{ background: "#EFEFED", border: "1px solid #E0E0DC" }}
                        >
                          <User size={14} style={{ color: "#2C2C29" }} />
                        </div>
                      )}
                      <div
                        className="max-w-[75%] md:max-w-[65%] px-4 py-3"
                        style={{
                          fontSize: "0.875rem",
                          lineHeight: "1.65",
                          ...(message.role === "user"
                            ? {
                                background: "#111110",
                                color: "#FFFFFF",
                                borderRadius: "18px 18px 4px 18px",
                              }
                            : {
                                background: "#F4F4F2",
                                color: "#111110",
                                borderRadius: "18px 18px 18px 4px",
                              }),
                        }}
                      >
                        {message.text}
                      </div>
                    </motion.div>
                  ))}

                  {isTyping && (
                    <div className="flex gap-3 items-end">
                      <div
                        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full"
                        style={{ background: "#111110" }}
                      >
                        <Bot size={15} className="text-white" />
                      </div>
                      <div
                        className="flex items-center gap-1.5 px-4"
                        style={{
                          background: "#F4F4F2",
                          borderRadius: "18px 18px 18px 4px",
                          height: "42px",
                        }}
                      >
                        {[0, 0.15, 0.3].map((delay, index) => (
                          <motion.span
                            key={index}
                            className="block rounded-full"
                            style={{ width: "6px", height: "6px", background: "#6B6B67" }}
                            animate={{ y: [0, -5, 0] }}
                            transition={{
                              duration: 0.75,
                              repeat: Infinity,
                              delay,
                              ease: "easeInOut",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div
                className="flex-shrink-0 px-4 py-4"
                style={{
                  background: "rgba(255,255,255,0.95)",
                  backdropFilter: "blur(8px)",
                  borderTop: "1px solid #E8E8E5",
                }}
              >
                <div className="mx-auto w-full" style={{ maxWidth: "680px" }}>
                  {renderInputBar()}
                  <p
                    className="text-center mt-2.5 hidden md:block"
                    style={{ fontSize: "11px", color: "#6B6B67", letterSpacing: "0.01em" }}
                  >
                    AI responses are generated and may not always be accurate.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
