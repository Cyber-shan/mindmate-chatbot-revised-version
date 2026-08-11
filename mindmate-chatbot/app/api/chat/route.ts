type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type OllamaResponse = {
  message?: {
    content?: string;
  };
  error?: string;
};

const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

const SYSTEM_PROMPT = `
You are MindMate, a supportive conversational companion for college students.

Your role is to:
- Listen carefully and respond warmly.
- Use simple, natural, conversational language.
- Ask gentle follow-up questions when appropriate.
- Help students express what they are feeling.
- Offer practical coping suggestions for ordinary stress, school pressure, loneliness, frustration, and similar concerns.
- Avoid sounding robotic or overly formal.
- Keep most responses short unless the student asks for more detail.
- Do not diagnose mental-health conditions.
- Do not claim to be a psychologist, counselor, doctor, or therapist.
- Do not tell a student that they definitely have depression, anxiety, or another disorder.
- Encourage appropriate human support when a student's situation appears serious.
- Never override a safety or counselor-escalation decision made by the application.
- Respect privacy and avoid requesting unnecessary sensitive personal information.

Conversation style:
- empathetic
- calm
- friendly
- non-judgmental
- student-friendly
- supportive without being overly dramatic
`.trim();

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
    };

    if (!Array.isArray(body.messages)) {
      return Response.json(
        { error: "Messages must be an array." },
        { status: 400 },
      );
    }

    const messages = body.messages
      .filter(
        (message): message is ChatMessage =>
          (message?.role === "user" ||
            message?.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim().length > 0,
      )
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.content.trim().slice(0, 4000),
      }));

    if (messages.length === 0) {
      return Response.json(
        { error: "At least one message is required." },
        { status: 400 },
      );
    }

    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3.5:9b",
        stream: false,
        think: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        options: {
          num_ctx: 8192,
          temperature: 0.7,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const data = (await ollamaResponse.json()) as OllamaResponse;

    if (!ollamaResponse.ok) {
      return Response.json(
        { error: data.error ?? "Ollama request failed." },
        { status: 502 },
      );
    }

    const reply = data.message?.content?.trim();

    if (!reply) {
      return Response.json(
        { error: "Ollama returned an empty response." },
        { status: 502 },
      );
    }

    return Response.json({ reply });
  } catch (error) {
    const timedOut =
      error instanceof Error && error.name === "TimeoutError";

    console.error("Chat API error:", error);

    return Response.json(
      {
        error: timedOut
          ? "The local model took too long to respond."
          : "Unable to connect to the local model.",
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}