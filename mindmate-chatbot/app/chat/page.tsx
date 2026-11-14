"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { readChatReply } from "@/lib/chat-stream";
import { ChatTimings } from "@/lib/chat-performance";
import type { StudentSupport } from "@/lib/support/types";
import { parseStudentSupport, restoreStudentMessages, type StudentChatMessage } from "@/lib/support/student-history";
import SupportNotice from "@/components/chat/SupportNotice";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Bot,
  ChevronDown,
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

type Message = StudentChatMessage;

type ConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ConversationHistoryGroup = {
  dateKey: string;
  label: string;
  conversations: ConversationSummary[];
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ChatApiResponse = {
  error?: string;
};

type ResponseProgressStage = "saving-message" | "generating-response" | "saving-response";

const RESPONSE_PROGRESS_STEPS: Array<{
  id: ResponseProgressStage;
  label: string;
}> = [
  { id: "saving-message", label: "Saving your message" },
  { id: "generating-response", label: "Preparing a response" },
  { id: "saving-response", label: "Saving to history" },
];

const PROCESSING_LABEL = "mindmate is working";
const HISTORY_WINDOW = 200;

const SUGGESTIONS = [
  { icon: Heart, label: "I've been feeling anxious lately" },
  { icon: Wind, label: "Help me manage stress" },
  { icon: MessageCircle, label: "Talk through my emotions" },
  { icon: Headphones, label: "I need someone to listen" },
];

function createConversationTitle(message: string) {
  const normalizedTitle = message.replace(/\s+/g, " ").trim();

  return normalizedTitle.length > 60
    ? `${normalizedTitle.slice(0, 57)}…`
    : normalizedTitle;
}

function getLocalDayNumber(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function getHistoryDay(timestamp: string, today: Date) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return { dateKey: "unknown", label: "Unknown date" };
  }

  const dateKey = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const daysAgo = getLocalDayNumber(today) - getLocalDayNumber(date);

  if (daysAgo === 0) return { dateKey, label: "Today" };
  if (daysAgo === 1) return { dateKey, label: "Yesterday" };

  return {
    dateKey,
    label: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
    }).format(date),
  };
}

function groupConversationsByDay(conversations: ConversationSummary[]) {
  const today = new Date();
  const groups = new Map<string, ConversationHistoryGroup>();

  conversations.forEach((conversation) => {
    const { dateKey, label } = getHistoryDay(conversation.updated_at, today);
    const existingGroup = groups.get(dateKey);

    if (existingGroup) {
      existingGroup.conversations.push(conversation);
      return;
    }

    groups.set(dateKey, {
      dateKey,
      label,
      conversations: [conversation],
    });
  });

  return Array.from(groups.values());
}

export default function Chat() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [progressStage, setProgressStage] = useState<ResponseProgressStage | null>(null);
  const [progressElapsedSeconds, setProgressElapsedSeconds] = useState(0);
  const [isProgressExpanded, setIsProgressExpanded] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [hasEarlierMessages, setHasEarlierMessages] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const messageIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const authUserIdRef = useRef<string | null>(null);
  const authEventVersionRef = useRef(0);
  const isWelcome = messages.length === 0 && !isHistoryLoading;
  const conversationHistoryGroups = useMemo(
    () => groupConversationsByDay(conversations),
    [conversations],
  );

  const displayName = useMemo(() => {
    const metadataName = user?.user_metadata?.name ?? user?.user_metadata?.full_name;

    if (typeof metadataName === "string" && metadataName.trim()) {
      return metadataName.trim();
    }

    return user?.email?.split("@")[0] || "Account";
  }, [user]);

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  const memberSince = user
    ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
        new Date(user.created_at),
      )
    : "—";

  const progressStageIndex = progressStage
    ? RESPONSE_PROGRESS_STEPS.findIndex((step) => step.id === progressStage)
    : 0;

  const progressActivity =
    progressStage === "saving-message"
      ? "Adding your message to this conversation..."
      : progressStage === "saving-response"
        ? "Keeping this response in your history..."
        : progressElapsedSeconds < 2
          ? "Reading the conversation..."
          : progressElapsedSeconds < 6
            ? "Putting together a supportive reply..."
            : "Writing the response...";

  const refreshConversationHistory = useCallback(async () => {
    const accountId = authUserIdRef.current;
    if (!accountId) return;
    const requestId = ++historyRequestIdRef.current;
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("user_id", accountId)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (requestId !== historyRequestIdRef.current || accountId !== authUserIdRef.current) return;
    if (error) {
      setHistoryError("Unable to load your conversation history.");
      return;
    }

    setConversations((data ?? []) as ConversationSummary[]);
    setHistoryError(null);
  }, [supabase]);

  useEffect(() => {
    let isMounted = true;
    const initialAuthVersion = authEventVersionRef.current;
    const applyUser = (currentUser: SupabaseUser | null) => {
      const accountId = currentUser?.id ?? null;
      // A direct signed-in account switch is as much a privacy boundary as sign-out.
      // Token refreshes for the same user preserve the active conversation.
      if (accountId !== authUserIdRef.current) {
        requestControllerRef.current?.abort();
        requestControllerRef.current = null;
        historyRequestIdRef.current += 1;
        authUserIdRef.current = accountId;
        setConversations([]);
        setActiveConversationId(null);
        setMessages([]);
        setInput("");
        setChatError(null);
        setHistoryError(null);
        setShowAccount(false);
        setIsHistoryLoading(false);
        setHasEarlierMessages(false);
        setIsTyping(false);
        setProgressStage(null);
        setProgressElapsedSeconds(0);
        setIsProgressExpanded(false);
      }

      setUser(currentUser);
      if (currentUser) void refreshConversationHistory();
      else router.replace("/login");
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      authEventVersionRef.current += 1;
      // Keep the auth callback synchronous; do not wait on Supabase auth while its lock is held.
      applyUser(session?.user ?? null);
    });

    const loadUser = async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        // A newer auth event is authoritative over this potentially older network result.
        if (isMounted && initialAuthVersion === authEventVersionRef.current) applyUser(currentUser);
      } catch {
        if (isMounted && initialAuthVersion === authEventVersionRef.current) applyUser(null);
      }
    };
    void loadUser();

    return () => {
      isMounted = false;
      historyRequestIdRef.current += 1;
      subscription.unsubscribe();
    };
  }, [refreshConversationHistory, router, supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping, progressStage]);

  useEffect(() => {
    if (!isTyping) return;

    const startedAt = Date.now();
    const updateElapsedTime = () => {
      setProgressElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };

    updateElapsedTime();
    const timer = window.setInterval(updateElapsedTime, 1000);

    return () => window.clearInterval(timer);
  }, [isTyping]);

  useEffect(() => {
    if (isWelcome) inputRef.current?.focus();
  }, [isWelcome]);

  useEffect(
    () => () => {
      requestControllerRef.current?.abort();
    },
    [],
  );

  const handleSend = async (text?: string) => {
    const msgText = (text ?? input).trim();
    if (!user || user.id !== authUserIdRef.current) return;
    if (!msgText || isTyping || isHistoryLoading || (requestControllerRef.current && !requestControllerRef.current.signal.aborted)) return;
    const timings = new ChatTimings();
    let firstReplyRecorded = false;

    messageIdRef.current += 1;
    const userMessage: Message = {
      id: `local-${messageIdRef.current}`,
      role: "user",
      text: msgText,
    };
    const conversation = [...messages, userMessage];
    const controller = new AbortController();
    let conversationId = activeConversationId;
    let createdConversation = false;
    let savedUserMessage = false;
    let localAssistantMessageId: string | null = null;
    let responseSupport: StudentSupport | null = null;

    requestControllerRef.current = controller;
    setMessages(conversation);
    setInput("");
    setChatError(null);
    setProgressElapsedSeconds(0);
    setIsProgressExpanded(false);
    setProgressStage("saving-message");
    setIsTyping(true);

    try {
      if (!user) {
        throw new Error("You must be signed in to save a conversation.");
      }

      if (!conversationId) {
        const { data: newConversation, error: conversationError } = await supabase
          .from("conversations")
          .insert({
            user_id: user.id,
            title: createConversationTitle(msgText),
          })
          .select("id, title, created_at, updated_at")
          .single();

        if (conversationError || !newConversation) {
          const databaseError = conversationError
            ? [
                conversationError.code && `code=${conversationError.code}`,
                conversationError.message && `message=${conversationError.message}`,
                conversationError.details && `details=${conversationError.details}`,
                conversationError.hint && `hint=${conversationError.hint}`,
              ]
                .filter(Boolean)
                .join("; ")
            : "Supabase returned no conversation record.";

          console.error(`Unable to create conversation: ${databaseError}`);
          throw new Error("Unable to start a saved conversation. Please try again.");
        }

        conversationId = newConversation.id;
        createdConversation = true;

        if (controller.signal.aborted) {
          await supabase.from("conversations").delete().eq("id", conversationId);
          return;
        }

        setActiveConversationId(conversationId);
        setConversations((previousConversations) => [
          newConversation as ConversationSummary,
          ...previousConversations.filter(
            (conversationItem) => conversationItem.id !== newConversation.id,
          ),
        ]);
      }

      const { data: storedUserMessage, error: userMessageError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "user",
          content: msgText,
        })
        .select("id, role, content, created_at")
        .single();

      if (controller.signal.aborted) return;
      if (userMessageError || !storedUserMessage) {
        console.error("Unable to save user message:", userMessageError);

        if (createdConversation) {
          await supabase.from("conversations").delete().eq("id", conversationId);
          setActiveConversationId(null);
          setConversations((previousConversations) =>
            previousConversations.filter(
              (conversationItem) => conversationItem.id !== conversationId,
            ),
          );
        }

        throw new Error("Your message could not be saved. Please try again.");
      }

      savedUserMessage = true;
      timings.record("save_user");
      setMessages((previousMessages) =>
        previousMessages.map((message) =>
          message.id === userMessage.id
            ? { ...message, id: storedUserMessage.id }
            : message,
        ),
      );
      if (controller.signal.aborted) return;

      setProgressStage("generating-response");

      const { data: { session } } = await timings.measure("session", () => supabase.auth.getSession());
      if (!session) throw new Error("Please sign in to continue.");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          conversationId,
          messageId: storedUserMessage.id,
          messages: conversation.slice(-200).map((message) => ({
            role: message.role === "ai" ? "assistant" : "user",
            content: message.text,
          })),
        }),
        signal: controller.signal,
      });
      timings.record("headers_elapsed");

      if (!response.ok) {
        const data = (await response.json()) as ChatApiResponse;
        throw new Error(data.error ?? "MindMate could not generate a response.");
      }

      const reply = await readChatReply(response, (content) => {
        if (controller.signal.aborted) return;
        if (!firstReplyRecorded) { firstReplyRecorded = true; timings.record("first_text"); }
        if (!localAssistantMessageId) {
          messageIdRef.current += 1;
          const messageId = `local-${messageIdRef.current}`;
          localAssistantMessageId = messageId;
          setMessages((previousMessages) => [
            ...previousMessages,
            { id: messageId, role: "ai", text: content.trimStart(), ...(responseSupport ? { support: responseSupport } : {}) },
          ]);
        } else {
          const messageId = localAssistantMessageId;
          setMessages((previousMessages) =>
            previousMessages.map((message) =>
              message.id === messageId ? { ...message, text: content.trimStart() } : message,
            ),
          );
        }
      }, (value) => {
        if (controller.signal.aborted) return;
        responseSupport = parseStudentSupport(value);
        if (!responseSupport) return;
        const support = responseSupport;
        setMessages((previousMessages) => previousMessages.map((message) =>
          message.id === storedUserMessage.id || message.id === localAssistantMessageId ? { ...message, support } : message));
      });

      if (controller.signal.aborted) return;
      timings.record("reply_complete");
      setProgressStage("saving-response");

      const { data: storedAssistantMessage, error: assistantMessageError } = await timings.measure("save_assistant", () => supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: reply,
        })
        .select("id, role, content, created_at")
        .single());

      if (controller.signal.aborted) return;
      if (assistantMessageError || !storedAssistantMessage) {
        console.error("Unable to save assistant message:", assistantMessageError);
        setChatError("MindMate replied, but the response could not be saved.");
      } else {
        setMessages((previousMessages) =>
          previousMessages.map((message) =>
            message.id === localAssistantMessageId
              ? { ...message, id: storedAssistantMessage.id, text: reply }
              : message,
          ),
        );
      }

      timings.record("complete");
      if (process.env.NEXT_PUBLIC_CHAT_PERFORMANCE === "true") console.info("chat_timing", timings.snapshot());
      // The reply is already displayed and saved; refreshing the sidebar need not block the next message.
      void refreshConversationHistory();
    } catch (error) {
      if (controller.signal.aborted) return;

      if (localAssistantMessageId) {
        setMessages((previousMessages) =>
          previousMessages.filter((message) => message.id !== localAssistantMessageId),
        );
      }

      if (!savedUserMessage) {
        setMessages((previousMessages) =>
          previousMessages.filter((message) => message.id !== userMessage.id),
        );
        setInput(msgText);
      }

      setChatError(
        error instanceof Error
          ? error.message
          : "Unable to connect to MindMate. Please try again.",
      );
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setProgressStage(null);
        setIsTyping(false);
      }
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    handleSend();
  };

  const loadConversation = async (conversationId: string) => {
    if (!user || user.id !== authUserIdRef.current) return;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setIsProgressExpanded(false);
    setProgressStage(null);
    setIsTyping(false);
    setIsHistoryLoading(true);
    setChatError(null);
    setActiveConversationId(conversationId);
    setMessages([]);
    setHasEarlierMessages(false);
    setInput("");

    // Support metadata is optional. A missing audit service must not prevent history from opening.
    const loadSupport = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || controller.signal.aborted) return null;
        const response = await fetch(`/api/chat/support?conversation_id=${encodeURIComponent(conversationId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
        });
        return response.ok ? await response.json() : null;
      } catch { return null; }
    };
    try {
      const [{ data, error }, supportHistory] = await Promise.all([
        supabase.from("messages").select("id, role, content, created_at")
          .eq("conversation_id", conversationId).order("created_at", { ascending: false })
          .order("id", { ascending: false }).limit(HISTORY_WINDOW + 1).abortSignal(controller.signal),
        loadSupport(),
      ]);
      if (controller.signal.aborted || requestControllerRef.current !== controller) return;
      if (error) throw new Error("Unable to open this conversation. Please try again.");
      const storedMessages = (data ?? []) as StoredMessage[];
      setHasEarlierMessages(storedMessages.length > HISTORY_WINDOW);
      setMessages(restoreStudentMessages(storedMessages.slice(0, HISTORY_WINDOW).reverse(), supportHistory));
    } catch (error) {
      if (!controller.signal.aborted) {
        setChatError(error instanceof Error ? error.message : "Unable to open this conversation. Please try again.");
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setIsHistoryLoading(false);
      }
    }
  };

  const resetChat = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setHasEarlierMessages(false);
    setInput("");
    setChatError(null);
    setIsProgressExpanded(false);
    setProgressStage(null);
    setIsTyping(false);
    setIsHistoryLoading(false);
  };

  const handleSignOut = async () => {
    resetChat();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const renderChatError = () => chatError && (
    <p
      role="alert"
      className="mb-2 rounded-xl px-3 py-2"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: "0.75rem" }}
    >
      {chatError}
    </p>
  );

  const renderInputBar = (autoFocus = false) => {
    const canSend = !isTyping && !isHistoryLoading && input.trim().length > 0;

    return (
      <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-2xl px-4 py-2.5 transition-all duration-150"
      style={{
        background: "var(--surface)",
        borderWidth: "1.5px",
        borderStyle: "solid",
        borderColor: "var(--border)",
      }}
      onFocusCapture={(event) => {
        event.currentTarget.style.borderColor = "var(--primary)";
        event.currentTarget.style.background = "var(--background)";
      }}
      onBlurCapture={(event) => {
        event.currentTarget.style.borderColor = "var(--border)";
        event.currentTarget.style.background = "var(--surface)";
      }}
    >
      <input
        ref={autoFocus ? inputRef : undefined}
        type="text"
        aria-label="Message MindMate"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        maxLength={4000}
        placeholder={
          isHistoryLoading
            ? "Loading conversation…"
            : isTyping
              ? "MindMate is responding…"
              : "Ask anything…"
        }
        disabled={isTyping || isHistoryLoading}
        className="flex-1 outline-none bg-transparent"
        style={{ fontSize: "0.875rem", color: "var(--foreground)", caretColor: "var(--foreground)" }}
      />
      <button
        type="submit"
        aria-label="Send message"
        disabled={!canSend}
        className="flex-shrink-0 flex items-center justify-center rounded-xl transition-all active:scale-90"
        style={{
          width: "34px",
          height: "34px",
          background: canSend ? "var(--primary)" : "var(--border)",
          color: canSend ? "var(--on-primary)" : "var(--text-muted)",
          cursor: canSend ? "pointer" : "not-allowed",
          transition: "background 0.15s ease, color 0.15s ease",
        }}
      >
        <Send size={14} />
      </button>
    </form>
    );
  };

  return (
    <div
      className="flex h-screen w-full overflow-hidden"
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <aside
        className="hidden md:flex flex-col w-64 flex-shrink-0"
        style={{ background: "var(--surface-subtle)", borderRight: "1px solid var(--border-subtle)" }}
      >
        <div
          className="flex items-center gap-2.5 px-5 h-[60px] flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div
            className="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0"
            style={{ background: "var(--primary)" }}
          >
            <Bot size={14} style={{ color: "var(--on-primary)" }} />
          </div>
          <span
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontWeight: 600,
              fontSize: "0.9375rem",
              color: "var(--foreground)",
              letterSpacing: "-0.01em",
            }}
          >
            Chatbot
          </span>
          <ThemeToggle className="ml-auto" />
        </div>

        <div className="px-4 pt-4 pb-2 flex-shrink-0">
          <button
            onClick={resetChat}
            aria-label="New conversation"
            className="w-full flex items-center justify-center gap-2 rounded-xl transition-all active:scale-[0.97]"
            style={{
              background: "var(--primary)",
              color: "var(--on-primary)",
              padding: "9px 16px",
              fontSize: "0.8125rem",
              fontWeight: 500,
            }}
            onMouseEnter={(event) => (event.currentTarget.style.background = "var(--primary-hover)")}
            onMouseLeave={(event) => (event.currentTarget.style.background = "var(--primary)")}
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
              color: "var(--text-muted)",
            }}
          >
            History
          </p>
          {historyError ? (
            <p
              role="alert"
              className="px-2 py-2"
              style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
            >
              {historyError}
            </p>
          ) : conversations.length === 0 ? (
            <p
              className="px-2 py-2"
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              No previous chats
            </p>
          ) : (
            <div className="space-y-4">
              {conversationHistoryGroups.map((group) => (
                <section
                  key={group.dateKey}
                  aria-labelledby={`history-group-${group.dateKey}`}
                >
                  <h3
                    id={`history-group-${group.dateKey}`}
                    className="px-2 pb-1"
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                    }}
                  >
                    {group.label}
                  </h3>
                  <div className="space-y-1">
                    {group.conversations.map((conversationItem) => (
                      <button
                        key={conversationItem.id}
                        type="button"
                        onClick={() => void loadConversation(conversationItem.id)}
                        disabled={isHistoryLoading}
                        title={conversationItem.title}
                        className="w-full truncate rounded-lg px-2 py-2 text-left transition-colors"
                        style={{
                          background:
                            activeConversationId === conversationItem.id
                              ? "var(--surface-active)"
                              : "transparent",
                          color:
                            activeConversationId === conversationItem.id
                              ? "var(--foreground)"
                              : "var(--text-secondary)",
                          cursor: isHistoryLoading ? "wait" : "pointer",
                          fontSize: "0.8125rem",
                        }}
                      >
                        {conversationItem.title}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div
          className="flex-shrink-0 px-4 pb-4 pt-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <AnimatePresence>
            {showAccount && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="mb-2 rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-elevated)", boxShadow: "0 8px 24px var(--shadow)" }}
              >
                <div
                  className="flex items-center gap-3 px-3 py-3"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--primary)" }}
                  >
                    <span style={{ color: "var(--on-primary)", fontSize: "0.8125rem", fontWeight: 600 }}>
                      {initials}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        color: "var(--foreground)",
                        lineHeight: 1.3,
                      }}
                    >
                      {displayName}
                    </p>
                    <p
                      className="truncate"
                      style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4 }}
                    >
                      {user?.email ?? ""}
                    </p>
                  </div>
                </div>
                <div className="px-3 py-2.5 space-y-2">
                  {[
                    { label: "Plan", value: "Free" },
                    { label: "Member since", value: memberSince },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{label}</span>
                      <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--foreground)" }}>
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
              color: "var(--text-strong)",
              background: showAccount ? "var(--surface-active)" : "transparent",
            }}
            onMouseEnter={(event) => (event.currentTarget.style.background = "var(--surface-active)")}
            onMouseLeave={(event) =>
              (event.currentTarget.style.background = showAccount ? "var(--surface-active)" : "transparent")
            }
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--surface-active)" }}
            >
              <User size={13} style={{ color: "var(--text-strong)" }} />
            </div>
            Account
          </button>

          <button
            onClick={handleSignOut}
            className="flex items-center gap-2.5 w-full rounded-xl px-2 py-2.5 mt-0.5 transition-colors"
            style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-muted)" }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "var(--surface-active)";
              event.currentTarget.style.color = "var(--foreground)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
              event.currentTarget.style.color = "var(--text-muted)";
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
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--header-overlay)",
            backdropFilter: "blur(8px)",
          }}
        >
          <button
            className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(event) => (event.currentTarget.style.background = "var(--surface)")}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
          >
            <Menu size={18} />
          </button>
          <span
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontWeight: 600,
              fontSize: "0.9375rem",
              color: "var(--foreground)",
              letterSpacing: "-0.01em",
            }}
          >
            Chatbot
          </span>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <button
              onClick={resetChat}
              aria-label="New conversation"
              className="w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(event) => (event.currentTarget.style.background = "var(--surface)")}
              onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
            >
              <Plus size={18} />
            </button>
          </div>
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
                  color: "var(--foreground)",
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
                {renderChatError()}
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
                    style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = "var(--surface)";
                      event.currentTarget.style.color = "var(--foreground)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = "transparent";
                      event.currentTarget.style.color = "var(--text-secondary)";
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
                  {isHistoryLoading && <p role="status" aria-live="polite" className="py-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>Loading conversation…</p>}
                  {hasEarlierMessages && <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>Some earlier messages are outside this view.</p>}
                  {messages.map((message, index) => (
                    <motion.div
                      key={message.id}
                      data-testid="chat-message"
                      data-role={message.role}
                      data-message-id={message.id}
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
                          style={{ background: "var(--primary)" }}
                        >
                          <Bot size={15} style={{ color: "var(--on-primary)" }} />
                        </div>
                      ) : (
                        <div
                          className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full"
                          style={{ background: "var(--surface-active)", border: "1px solid var(--border)" }}
                        >
                          <User size={14} style={{ color: "var(--text-strong)" }} />
                        </div>
                      )}
                      <div className="max-w-[85%] min-w-0 md:max-w-[75%]">
                        <div
                        className="whitespace-pre-wrap break-words px-4 py-3"
                        style={{
                          fontSize: "0.875rem",
                          lineHeight: "1.65",
                          ...(message.role === "user"
                            ? {
                                background: "var(--primary)",
                                color: "var(--on-primary)",
                                borderRadius: "18px 18px 4px 18px",
                              }
                            : {
                                background: "var(--surface)",
                                color: "var(--foreground)",
                                borderRadius: "18px 18px 18px 4px",
                              }),
                        }}
                      >
                        {message.text}
                        </div>
                        {message.support && (message.role === "ai" || messages[index + 1]?.role !== "ai") && <SupportNotice support={message.support} />}
                      </div>
                    </motion.div>
                  ))}

                  <AnimatePresence>
                    {isTyping && progressStage && (
                      <motion.div
                        data-testid="chat-progress"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        className="flex gap-3 items-end"
                      >
                      <div
                        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full"
                        style={{ background: "var(--primary)" }}
                      >
                        <Bot size={15} style={{ color: "var(--on-primary)" }} />
                      </div>
                      <div
                        className="w-full max-w-[85%] md:max-w-[70%] px-4 py-3"
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "18px 18px 18px 4px",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setIsProgressExpanded((isExpanded) => !isExpanded)}
                          aria-expanded={isProgressExpanded}
                          aria-controls="mindmate-progress-details"
                          className="flex w-full items-center justify-between gap-4 text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <motion.span
                              className="block flex-shrink-0 rounded-full"
                              style={{ width: "7px", height: "7px", background: "var(--primary)" }}
                              animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] }}
                              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                            />
                            <span
                              className="truncate"
                              style={{
                                color: "var(--text-strong)",
                                fontSize: "0.78rem",
                                fontWeight: 600,
                              }}
                            >
                              <span className="sr-only">{PROCESSING_LABEL}</span>
                              <span aria-hidden="true" className="inline-flex">
                                {PROCESSING_LABEL.split("").map((character, index) => (
                                  <motion.span
                                    key={`${character}-${index}`}
                                    className="inline-block"
                                    animate={{ y: [0, -2, 0], opacity: [0.55, 1, 0.55] }}
                                    transition={{
                                      duration: 1.1,
                                      repeat: Infinity,
                                      delay: index * 0.045,
                                      ease: "easeInOut",
                                    }}
                                  >
                                    {character === " " ? "\u00A0" : character}
                                  </motion.span>
                                ))}
                              </span>
                            </span>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className="tabular-nums"
                              style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}
                            >
                              {progressElapsedSeconds}s
                            </span>
                            <motion.span
                              aria-hidden="true"
                              className="flex items-center justify-center"
                              animate={{ rotate: isProgressExpanded ? 180 : 0 }}
                              transition={{ duration: 0.18 }}
                              style={{ color: "var(--text-muted)" }}
                            >
                              <ChevronDown size={14} />
                            </motion.span>
                          </div>
                        </button>

                        <AnimatePresence initial={false}>
                          {isProgressExpanded && (
                            <motion.div
                              id="mindmate-progress-details"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                              <AnimatePresence mode="wait">
                                <motion.span
                                  key={progressActivity}
                                  initial={{ opacity: 0, y: 3 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -3 }}
                                  transition={{ duration: 0.15 }}
                                  aria-live="polite"
                                  className="mt-2 block"
                                  style={{ color: "var(--text-secondary)", fontSize: "0.76rem" }}
                                >
                                  {progressActivity}
                                </motion.span>
                              </AnimatePresence>

                              <div className="mt-3 space-y-1.5">
                                {RESPONSE_PROGRESS_STEPS.map((step, index) => {
                                  const isComplete = index < progressStageIndex;
                                  const isActive = index === progressStageIndex;

                                  return (
                                    <div key={step.id} className="flex items-center gap-2">
                                      <span
                                        className="flex flex-shrink-0 items-center justify-center rounded-full"
                                        style={{
                                          width: "14px",
                                          height: "14px",
                                          border: `1px solid ${
                                            isComplete || isActive
                                              ? "var(--primary)"
                                              : "var(--border)"
                                          }`,
                                          background: isComplete ? "var(--primary)" : "transparent",
                                          color: "var(--on-primary)",
                                          fontSize: "0.58rem",
                                          fontWeight: 700,
                                        }}
                                      >
                                        {isComplete ? (
                                          "✓"
                                        ) : isActive ? (
                                          <motion.span
                                            className="block rounded-full"
                                            style={{
                                              width: "5px",
                                              height: "5px",
                                              background: "var(--primary)",
                                            }}
                                            animate={{ opacity: [0.35, 1, 0.35] }}
                                            transition={{ duration: 1, repeat: Infinity }}
                                          />
                                        ) : null}
                                      </span>
                                      <span
                                        style={{
                                          color: isActive
                                            ? "var(--foreground)"
                                            : "var(--text-muted)",
                                          fontSize: "0.7rem",
                                          fontWeight: isActive ? 500 : 400,
                                        }}
                                      >
                                        {step.label}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div
                className="flex-shrink-0 px-4 py-4"
                style={{
                  background: "var(--footer-overlay)",
                  backdropFilter: "blur(8px)",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <div className="mx-auto w-full" style={{ maxWidth: "680px" }}>
                  {renderChatError()}
                  {renderInputBar()}
                  <p
                    className="text-center mt-2.5 hidden md:block"
                    style={{ fontSize: "11px", color: "var(--text-muted)", letterSpacing: "0.01em" }}
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
