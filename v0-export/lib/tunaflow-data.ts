import type {
  Project,
  Message,
  Branch,
  Artifact,
  Memo,
  Skill,
  CrossSession,
  RoundtableParticipant,
} from "./tunaflow-types";
import { AGENTS } from "./tunaflow-types";

export const MOCK_PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Product Strategy Q2",
    isExpanded: true,
    conversations: [
      { id: "c1", title: "Pricing Model Debate", type: "roundtable", updatedAt: "2m ago", isActive: true },
      { id: "c2", title: "Feature Roadmap Review", type: "chat", updatedAt: "1h ago" },
      { id: "c3", title: "Competitor Analysis", type: "chat", updatedAt: "3h ago" },
    ],
  },
  {
    id: "p2",
    name: "Architecture Refactor",
    isExpanded: false,
    conversations: [
      { id: "c4", title: "API Design Review", type: "roundtable", updatedAt: "1d ago" },
      { id: "c5", title: "DB Schema Planning", type: "chat", updatedAt: "2d ago" },
    ],
  },
  {
    id: "p3",
    name: "Marketing Copy",
    isExpanded: false,
    conversations: [
      { id: "c6", title: "Landing Page Headlines", type: "chat", updatedAt: "3d ago" },
    ],
  },
];

export const MOCK_MESSAGES: Message[] = [
  {
    id: "m1",
    role: "user",
    content: "We need to decide between a freemium model and a usage-based pricing model for our new developer platform. What are the key trade-offs we should consider?",
    timestamp: "14:02",
  },
  {
    id: "m2",
    role: "agent",
    agent: AGENTS.claude,
    content: "From a product-led growth perspective, freemium is compelling for developer tools because it **reduces friction at the top of the funnel**. Developers rarely pay for tools they haven't already embedded into their workflow. The key risk is that free-tier abuse (especially from hobbyists) can spike infrastructure costs without conversion.\n\nMy recommendation: consider a hybrid — freemium with hard rate limits, then usage-based after a threshold. This gives you the PLG benefits without the cost exposure.",
    timestamp: "14:02",
    roundtableRound: 1,
    branchCount: 2,
    memoCount: 1,
  },
  {
    id: "m3",
    role: "agent",
    agent: AGENTS.codex,
    content: "I'd push back slightly on the freemium framing. For a *developer* platform specifically, usage-based pricing aligns incentives better — you grow as your customers grow. The predictability problem is overstated; most serious teams forecast API costs as part of sprint planning.\n\nThe real question is your **ICP**. If you're targeting indie hackers, freemium wins. If you're targeting engineering teams at Series A+ companies, usage-based is cleaner and signals seriousness.",
    timestamp: "14:03",
    roundtableRound: 1,
    branchCount: 1,
  },
  {
    id: "m4",
    role: "agent",
    agent: AGENTS.gemini,
    content: "Both perspectives are valid, but I want to surface a data point: Stripe, Twilio, and Vercel all started with usage-based and built free tiers *later*, not the other way around. This isn't coincidental — it's much easier to add a free tier than to migrate from free to paid.\n\nAlso worth modeling: what's your **marginal cost per active user**? If it's near-zero (pure software), freemium is fine. If you have meaningful compute costs per user, usage-based protects your margin from day one.",
    timestamp: "14:03",
    roundtableRound: 1,
    branchCount: 0,
  },
  {
    id: "m5",
    role: "user",
    content: "Good points. Let's go deeper on the ICP question. Our primary targets are growth-stage startups (Series A–C) with dedicated engineering teams of 5–20 devs. Secondary is larger enterprises.",
    timestamp: "14:05",
  },
  {
    id: "m6",
    role: "agent",
    agent: AGENTS.claude,
    content: "With that ICP, usage-based with a **seats + consumption hybrid** is likely optimal. Here's the logic:\n\n- Series A–C teams have predictable headcount → seats give finance teams something to budget\n- Consumption layer captures upside as they scale usage\n- Enterprise can negotiate ELAs on top of this base\n\nThis is essentially how Linear, Figma, and Notion structured their enterprise expansion — predictable base, variable upside.",
    timestamp: "14:05",
    roundtableRound: 2,
    branchCount: 3,
    memoCount: 2,
  },
  {
    id: "m7",
    role: "agent",
    agent: AGENTS.opencode,
    content: "From an implementation standpoint, I want to flag the **billing complexity** of hybrid models. You'll need metering infrastructure from day one — not trivial. If engineering bandwidth is limited, pure usage-based is operationally simpler and you can layer in seat-based later.\n\nAlso: consider your sales motion. If you're self-serve, usage-based removes the friction of \"talking to sales.\" If you have an outbound team, hybrid gives them a predictable ARR story to sell.",
    timestamp: "14:06",
    roundtableRound: 2,
    branchCount: 0,
    isStreaming: false,
  },
];

export const MOCK_ROUNDTABLE_PARTICIPANTS: RoundtableParticipant[] = [
  { agent: AGENTS.claude, messages: [MOCK_MESSAGES[1], MOCK_MESSAGES[5]] },
  { agent: AGENTS.codex, messages: [MOCK_MESSAGES[2]] },
  { agent: AGENTS.gemini, messages: [MOCK_MESSAGES[3]] },
  { agent: AGENTS.opencode, messages: [MOCK_MESSAGES[6]] },
];

export const MOCK_BRANCHES: Branch[] = [
  {
    id: "b1",
    label: "Freemium path",
    parentMessageId: "m2",
    messageCount: 8,
    isActive: false,
    children: [
      { id: "b1a", label: "Rate limit design", parentMessageId: "m2", messageCount: 4, isActive: false },
    ],
  },
  {
    id: "b2",
    label: "Usage-based path",
    parentMessageId: "m2",
    messageCount: 12,
    isActive: true,
    children: [
      { id: "b2a", label: "Hybrid model", parentMessageId: "m6", messageCount: 6, isActive: true },
    ],
  },
  {
    id: "b3",
    label: "Enterprise-first pivot",
    parentMessageId: "m5",
    messageCount: 3,
    isActive: false,
  },
];

export const MOCK_ARTIFACTS: Artifact[] = [
  {
    id: "a1",
    title: "Pricing Model Decision Doc",
    status: "draft",
    excerpt: "Recommendation: Usage-based with seat floor for Series A–C ICP. Rationale includes margin protection, billing simplicity...",
    updatedAt: "5m ago",
  },
  {
    id: "a2",
    title: "Competitor Pricing Matrix",
    status: "approved",
    excerpt: "Analyzed pricing for Stripe, Twilio, Vercel, Linear, and Figma. Key finding: all usage-based at launch...",
    updatedAt: "1h ago",
  },
  {
    id: "a3",
    title: "ICP Analysis Report",
    status: "rejected",
    excerpt: "Initial draft focused on SMB segment — rejected in favor of growth-stage focus per session discussion...",
    updatedAt: "2h ago",
  },
];

export const MOCK_MEMOS: Memo[] = [
  {
    id: "mem1",
    content: "Key insight: billing complexity is the blocker, not the model itself",
    createdAt: "10m ago",
    pinned: true,
  },
  {
    id: "mem2",
    content: "Follow up: check Stripe's original pricing page from 2011 for reference",
    createdAt: "25m ago",
    pinned: false,
  },
  {
    id: "mem3",
    content: "Claude's hybrid model framing is strongest so far — seats + consumption",
    createdAt: "1h ago",
    pinned: false,
  },
];

export const MOCK_SKILLS: Skill[] = [
  { id: "sk1", name: "Web Search", description: "Real-time web search via Brave", enabled: true },
  { id: "sk2", name: "Code Execution", description: "Run Python/JS sandboxed", enabled: true },
  { id: "sk3", name: "File Analysis", description: "Parse PDFs, CSVs, images", enabled: false },
  { id: "sk4", name: "Memory Recall", description: "Retrieve past sessions", enabled: true },
  { id: "sk5", name: "Draft Generator", description: "Auto-create artifact drafts", enabled: false },
];

export const MOCK_CROSS_SESSIONS: CrossSession[] = [
  { id: "cs1", title: "Feature Roadmap Review", date: "Yesterday", included: true },
  { id: "cs2", title: "Competitor Analysis", date: "3h ago", included: false },
  { id: "cs3", title: "API Design Review", date: "1d ago", included: true },
  { id: "cs4", title: "DB Schema Planning", date: "2d ago", included: false },
];
