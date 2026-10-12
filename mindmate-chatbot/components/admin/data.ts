export type Category = "suicidal" | "harm-others" | "abuse" | "distress" | "academic";
export type Status = "new" | "reviewed" | "resolved" | "false-positive";

export interface ContextMessage {
  from: "student" | "assistant";
  text: string;
}

export interface Flag {
  id: string;
  studentId: string;
  studentName: string;
  message: string;
  matched?: string;
  context: ContextMessage[];
  category: Category;
  confidence?: number;
  signals?: string[];
  status: Status;
  createdAt: string;
  notes?: string;
}

export const CATEGORY_ORDER: Category[] = ["suicidal", "harm-others", "abuse", "distress", "academic"];

export const CATEGORY_LABEL: Record<Category, string> = {
  abuse: "Abuse or bullying disclosure",
  suicidal: "Suicidal ideation",
  "harm-others": "Intent to harm others",
  academic: "Academic stress",
  distress: "Psychological distress",
};

export const STATUS_ORDER: Status[] = ["new", "reviewed", "resolved", "false-positive"];

export const STATUS_HELP: Record<Status, string> = {
  new: "Not looked at yet.",
  reviewed: "A professional has seen it and is following up.",
  resolved: "Followed up and closed.",
  "false-positive": "Flagged by mistake. Not a concern.",
};

export const CATEGORY_HELP: Record<Category, string> = {
  suicidal: "Wishing to die, not wanting to be alive, or considering suicide.",
  "harm-others": "Desire, threat or plan to hurt someone else.",
  abuse: "Experiencing, witnessing or committing abuse or bullying.",
  distress: "General emotional distress, low mood, anxiety or panic.",
  academic: "Stress about schoolwork, exams, grades or expectations.",
};

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  reviewed: "Reviewed",
  resolved: "Resolved",
  "false-positive": "False positive",
};

export function createMockFlags(now: number): Flag[] {
  const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();

  return [
    {
      id: "F-1100",
      studentId: "S-2291",
      studentName: "Maya R.",
      message: "I wish I were no longer alive.",
      matched: "no longer alive",
      context: [
        { from: "assistant", text: "How has this week been for you?" },
        { from: "student", text: "I wish I were no longer alive." },
      ],
      category: "suicidal",
      confidence: 0.95,
      signals: ["Wish not to be alive"],
      status: "new",
      createdAt: ago(6),
    },
    {
      id: "F-1101",
      studentId: "S-1420",
      studentName: "Ana C.",
      message: "Sometimes I think everyone would be better off without me.",
      matched: "better off without me",
      context: [
        { from: "assistant", text: "Do you want to tell me more?" },
        { from: "student", text: "Sometimes I think everyone would be better off without me." },
      ],
      category: "suicidal",
      confidence: 0.88,
      signals: ["Perceived burdensomeness"],
      status: "new",
      createdAt: ago(120),
    },
    {
      id: "F-1102",
      studentId: "S-2045",
      studentName: "Leo M.",
      message: "I've been thinking about ending my life.",
      matched: "ending my life",
      context: [
        { from: "assistant", text: "What's been on your mind?" },
        { from: "student", text: "I've been thinking about ending my life." },
      ],
      category: "suicidal",
      confidence: 0.96,
      signals: ["Stated suicidal thoughts"],
      status: "new",
      createdAt: ago(340),
    },
    {
      id: "F-1103",
      studentId: "S-2718",
      studentName: "Hana P.",
      message: "I don't want to wake up tomorrow.",
      matched: "don't want to wake up",
      context: [
        { from: "assistant", text: "How are you sleeping?" },
        { from: "student", text: "I don't want to wake up tomorrow." },
      ],
      category: "suicidal",
      confidence: 0.84,
      signals: ["Passive ideation phrasing"],
      status: "reviewed",
      createdAt: ago(900),
    },
    {
      id: "F-1104",
      studentId: "S-1983",
      studentName: "Tomas G.",
      message: "I just want everything to stop, forever.",
      matched: "stop, forever",
      context: [
        { from: "assistant", text: "That sounds heavy. What's going on?" },
        { from: "student", text: "I just want everything to stop, forever." },
      ],
      category: "suicidal",
      confidence: 0.71,
      signals: ["Hopelessness language"],
      status: "resolved",
      createdAt: ago(2200),
    },
    {
      id: "F-1105",
      studentId: "S-1877",
      studentName: "Daniel K.",
      message: "I'm planning to hurt my classmate.",
      matched: "hurt my classmate",
      context: [
        { from: "assistant", text: "What's been happening with him?" },
        { from: "student", text: "I'm planning to hurt my classmate." },
      ],
      category: "harm-others",
      confidence: 0.93,
      signals: ["Stated plan", "Named target"],
      status: "new",
      createdAt: ago(23),
    },
    {
      id: "F-1106",
      studentId: "S-3012",
      studentName: "Ryan F.",
      message: "If he touches me again I'll make him pay for it.",
      matched: "make him pay",
      context: [
        { from: "assistant", text: "That sounds frustrating. What happened?" },
        { from: "student", text: "If he touches me again I'll make him pay for it." },
      ],
      category: "harm-others",
      confidence: 0.81,
      signals: ["Conditional threat"],
      status: "new",
      createdAt: ago(210),
    },
    {
      id: "F-1107",
      studentId: "S-2406",
      studentName: "Kai N.",
      message: "I keep imagining hitting the people who laugh at me.",
      matched: "hitting the people",
      context: [
        { from: "assistant", text: "How do you feel at school?" },
        { from: "student", text: "I keep imagining hitting the people who laugh at me." },
      ],
      category: "harm-others",
      confidence: 0.76,
      signals: ["Violent ideation"],
      status: "reviewed",
      createdAt: ago(600),
    },
    {
      id: "F-1108",
      studentId: "S-1129",
      studentName: "Mia L.",
      message: "I'm going to get back at her after school.",
      matched: "get back at her",
      context: [
        { from: "assistant", text: "Tell me about what she did." },
        { from: "student", text: "I'm going to get back at her after school." },
      ],
      category: "harm-others",
      confidence: 0.67,
      signals: ["Retaliation language", "Location reference"],
      status: "new",
      createdAt: ago(1100),
    },
    {
      id: "F-1109",
      studentId: "S-3350",
      studentName: "Omar A.",
      message: "I'll kill him if he says that again lol.",
      matched: "kill him",
      context: [
        { from: "assistant", text: "Sounds like a rough day." },
        { from: "student", text: "I'll kill him if he says that again lol." },
      ],
      category: "harm-others",
      confidence: 0.34,
      signals: ["Humour marker lowers confidence"],
      status: "false-positive",
      createdAt: ago(1800),
    },
    {
      id: "F-1110",
      studentId: "S-0958",
      studentName: "Jordan T.",
      message: "My classmates keep threatening me.",
      matched: "keep threatening me",
      context: [
        { from: "assistant", text: "Why did you stop going to lunch?" },
        { from: "student", text: "My classmates keep threatening me." },
      ],
      category: "abuse",
      confidence: 0.9,
      signals: ["Peer threats", "Ongoing pattern"],
      status: "new",
      createdAt: ago(45),
    },
    {
      id: "F-1111",
      studentId: "S-1745",
      studentName: "Elena V.",
      message: "They share my photos in the group chat and everyone laughs.",
      matched: "share my photos",
      context: [
        { from: "assistant", text: "How are things with friends?" },
        { from: "student", text: "They share my photos in the group chat and everyone laughs." },
      ],
      category: "abuse",
      confidence: 0.85,
      signals: ["Cyberbullying"],
      status: "new",
      createdAt: ago(180),
    },
    {
      id: "F-1112",
      studentId: "S-2891",
      studentName: "Noah B.",
      message: "My older cousin hits me when no one is home.",
      matched: "hits me when no one is home",
      context: [
        { from: "assistant", text: "Is anything worrying you at home?" },
        { from: "student", text: "My older cousin hits me when no one is home." },
      ],
      category: "abuse",
      confidence: 0.89,
      signals: ["Physical abuse disclosure"],
      status: "new",
      createdAt: ago(480),
    },
    {
      id: "F-1113",
      studentId: "S-3166",
      studentName: "Zoe H.",
      message: "I saw some boys corner a younger kid and take his lunch money every day.",
      matched: "corner a younger kid",
      context: [
        { from: "assistant", text: "Did anything happen at school?" },
        { from: "student", text: "I saw some boys corner a younger kid and take his lunch money every day." },
      ],
      category: "abuse",
      confidence: 0.72,
      signals: ["Witnessed bullying"],
      status: "reviewed",
      createdAt: ago(1300),
    },
    {
      id: "F-1114",
      studentId: "S-1502",
      studentName: "Ibrahim D.",
      message: "I've been calling a girl in my class names, and I feel bad about it.",
      matched: "calling a girl in my class names",
      context: [
        { from: "assistant", text: "How are you feeling about it?" },
        { from: "student", text: "I've been calling a girl in my class names, and I feel bad about it." },
      ],
      category: "abuse",
      confidence: 0.68,
      signals: ["Self-disclosed bullying"],
      status: "reviewed",
      createdAt: ago(2600),
    },
    {
      id: "F-1115",
      studentId: "S-2650",
      studentName: "Liam O.",
      message: "I haven't slept in three days and I feel like I'm falling apart.",
      matched: "haven't slept in three days",
      context: [
        { from: "assistant", text: "Tell me what's on your mind." },
        { from: "student", text: "I haven't slept in three days and I feel like I'm falling apart." },
      ],
      category: "distress",
      confidence: 0.78,
      signals: ["Sleep disruption", "Overwhelm language"],
      status: "new",
      createdAt: ago(260),
    },
    {
      id: "F-1116",
      studentId: "S-3104",
      studentName: "Priya S.",
      message: "I can't cope with how I feel anymore. I cry every night.",
      matched: "can't cope with how I feel",
      context: [
        { from: "assistant", text: "How have you been feeling lately?" },
        { from: "student", text: "I can't cope with how I feel anymore. I cry every night." },
      ],
      category: "distress",
      confidence: 0.82,
      signals: ["Persistent low mood"],
      status: "new",
      createdAt: ago(75),
    },
    {
      id: "F-1117",
      studentId: "S-2291",
      studentName: "Maya R.",
      message: "I feel so alone, even when I'm with people.",
      matched: "so alone",
      context: [
        { from: "assistant", text: "What has your week been like?" },
        { from: "student", text: "I feel so alone, even when I'm with people." },
      ],
      category: "distress",
      confidence: 0.66,
      signals: ["Isolation language"],
      status: "resolved",
      createdAt: ago(1500),
    },
    {
      id: "F-1118",
      studentId: "S-2230",
      studentName: "Caleb J.",
      message: "Everything feels pointless and I can't stop worrying.",
      matched: "feels pointless",
      context: [
        { from: "assistant", text: "What's weighing on you?" },
        { from: "student", text: "Everything feels pointless and I can't stop worrying." },
      ],
      category: "distress",
      confidence: 0.73,
      signals: ["Anxiety", "Low motivation"],
      status: "new",
      createdAt: ago(700),
    },
    {
      id: "F-1119",
      studentId: "S-1671",
      studentName: "Nina Q.",
      message: "My chest gets tight and I panic for no reason.",
      matched: "panic for no reason",
      context: [
        { from: "assistant", text: "When does that happen?" },
        { from: "student", text: "My chest gets tight and I panic for no reason." },
      ],
      category: "distress",
      confidence: 0.64,
      signals: ["Panic symptoms"],
      status: "reviewed",
      createdAt: ago(1700),
    },
    {
      id: "F-1120",
      studentId: "S-1566",
      studentName: "Sam W.",
      message: "I feel overwhelmed by all my deadlines.",
      matched: "overwhelmed by all my deadlines",
      context: [
        { from: "assistant", text: "How is school going?" },
        { from: "student", text: "I feel overwhelmed by all my deadlines." },
      ],
      category: "academic",
      confidence: 0.77,
      signals: ["Deadline pressure"],
      status: "new",
      createdAt: ago(320),
    },
    {
      id: "F-1121",
      studentId: "S-3377",
      studentName: "Chris B.",
      message: "That test is going to kill me, I'm so stressed.",
      matched: "going to kill me",
      context: [
        { from: "assistant", text: "How did the exam go?" },
        { from: "student", text: "That test is going to kill me, I'm so stressed." },
      ],
      category: "academic",
      confidence: 0.31,
      signals: ["Figure of speech", "Exam stress"],
      status: "false-positive",
      createdAt: ago(640),
    },
    {
      id: "F-1122",
      studentId: "S-2984",
      studentName: "Grace E.",
      message: "I'm terrified of failing my exams and letting my parents down.",
      matched: "failing my exams",
      context: [
        { from: "assistant", text: "What are you worried about?" },
        { from: "student", text: "I'm terrified of failing my exams and letting my parents down." },
      ],
      category: "academic",
      confidence: 0.8,
      signals: ["Fear of failure", "Parental expectations"],
      status: "new",
      createdAt: ago(520),
    },
    {
      id: "F-1123",
      studentId: "S-1308",
      studentName: "Victor S.",
      message: "I study all night and my grades still keep dropping.",
      matched: "grades still keep dropping",
      context: [
        { from: "assistant", text: "Are you getting enough rest?" },
        { from: "student", text: "I study all night and my grades still keep dropping." },
      ],
      category: "academic",
      confidence: 0.7,
      signals: ["Grade decline"],
      status: "reviewed",
      createdAt: ago(1000),
    },
    {
      id: "F-1124",
      studentId: "S-2577",
      studentName: "Aisha K.",
      message: "I can't keep up with the pressure of finals.",
      matched: "pressure of finals",
      context: [
        { from: "assistant", text: "What is finals week like for you?" },
        { from: "student", text: "I can't keep up with the pressure of finals." },
      ],
      category: "academic",
      confidence: 0.75,
      signals: ["Exam pressure"],
      status: "new",
      createdAt: ago(90),
    },
  ];
}

export function createTrendData(now: number) {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * 86_400_000);
    const seed = (i * 7 + 3) % 5;
    return {
      day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      "All flags": 6 + ((seed * 3) % 7) + (i > 10 ? 2 : 0),
    };
  });
}

export function timeAgo(iso: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function createAdminData() {
  const now = Date.now();
  return { flags: createMockFlags(now), trendData: createTrendData(now) };
}
