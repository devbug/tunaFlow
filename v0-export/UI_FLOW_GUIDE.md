# tunaFlow — UX Flow Diagrams

## Layout Structure

### Main View (Default)
```
┌─ SIDEBAR ─┬────────────────────── CHAT AREA ────────────────────┐
│           │                                                      │
│ Projects  │  ┌─ STATUS BAR ──────────────────────────────────┐  │
│ & Chat    │  │ 🔵 Roundtable | 📁 Hybrid (ACTIVE) | 4 agents │  │
│ Tree      │  └────────────────────────────────────────────────┘  │
│           │  ┌─ HEADER ──────────────────────────────────────┐  │
│ [c1]✓     │  │ Pricing Model Debate        [Stream][Roundtable]  │
│ c2        │  └────────────────────────────────────────────────┘  │
│ c3        │  ┌─ MESSAGES ────────────────────────────────────┐  │
│           │  │ You: We need to decide...                    │  │
│ [p1]✓     │  │ 🟣 Claude: From a PLG perspective...        │  │
│  [c1]✓    │  │   [Branch(2)] [Copy] [🔖] [👍] [👎] [...]   │  │
│  c2       │  │ 🔵 Codex: I'd push back slightly...         │  │
│  c3       │  │   [Branch(1)] ...                            │  │
│ p2        │  │                                               │  │
│           │  │ 🟠 Gemini: Both perspectives are valid...   │  │
│           │  └────────────────────────────────────────────────┘  │
│           │  ┌─ INPUT ───────────────────────────────────────┐  │
│           │  │ [Chat] [Roundtable] [🟣🔵🟠 3 agents] ⌘⏎   │  │
│           │  │ [📎] [⚡]  Ask anything... (⌘↵ to send)      │  │
│           │  └────────────────────────────────────────────────┘  │
└───────────┴─────────────────────────────────────────────────────┘
```

---

## Branch Click → Thread Panel Slide-In

### Before (User hovers on message)
```
Main Chat Area
├─ 🟣 Claude: From a PLG perspective...
│  [Branch(2)] [Copy] [🔖] [👍] [👎]
```

### User clicks "Branch"
→ Animation starts: Panel slides in from right (300ms)

### After (Thread Panel Overlay)
```
┌────────────────────────────────────┬──────────────── BRANCH ────────────┐
│                                    │ 📁 Hybrid pricing       [ACTIVE] [X]│
│ Main Chat (faded)                  │ Parent: Freemium path              │
│                                    │                                    │
│ 🟣 Claude: From a PLG...          │ ┌────────────────────────────────┐ │
│                                    │ │ 🟣 Claude:                      │ │
│ 🔵 Codex: I'd push back...        │ │ From a PLG perspective...     │ │
│                                    │ │ [Branch] [Copy] [...]        │ │
│ 🟠 Gemini: Both perspectives...   │ │                                │ │
│                                    │ │ 🔵 Codex:                     │ │
│                                    │ │ → responding to previous point│ │
│                                    │ │ [Branch] [Copy] [...]        │ │
│                                    │                                    │
│                                    │ [Close]    [Adopt] (apply branch) │
│                                    │                                    │
└────────────────────────────────────┴────────────────────────────────────┘
```

---

## Status Bar Explanation

### Compact Mode (Chat)
```
🔵 Chat | ⚡ 2 skills | 🔗 1 session
```

### Compact Mode (Roundtable)
```
👥 Roundtable | 🟣🔵🟠🟢 4 agents • Round 2 | ⚡ 2 skills | 🔗 1 session
```

### With Active Branch
```
👥 Roundtable | 📁 Hybrid pricing (ACTIVE) | 🟣🔵🟠🟢 4 agents • Round 2 | ⚡ 2 skills
```

**Legend:**
- 🔵 = Chat mode
- 👥 = Roundtable mode
- 📁 = Active branch
- 🟣🔵🟠🟢 = Participant agents (colored dots)
- ⚡ = Skills enabled
- 🔗 = Cross-session context

---

## Roundtable View (Improved)

### Before (Flat layout)
```
Claude: From a PLG perspective...
Codex: I'd push back slightly...
Gemini: Both perspectives are valid...
---
Claude: With that ICP, usage-based...
OpenCode: From an implementation standpoint...
```

### After (Grouped Rounds with Relationships)
```
────────────────────────────────────────
          ⭐ ROUND 1
────────────────────────────────────────

🟣 Claude
├─ From a PLG perspective...
│  [Branch(2)]

🔵 Codex
├─ I'd push back slightly...
│  [Branch(1)]

🟠 Gemini
├─ Both perspectives are valid...
│  [Branch]

────────────────────────────────────────
          ⭐ ROUND 2 (based on Round 1)
────────────────────────────────────────

🟣 Claude → responding to previous point
├─ With that ICP, usage-based...
│  [Branch(3)]

🟢 OpenCode → responding to previous point
├─ From an implementation standpoint...
│  [Branch]
```

**Improvements:**
- Clear round separation with primary color badge
- "Based on previous round" context
- "Responding to" indicators between speakers
- Connector lines show flow
- Branch button is now primary-colored on hover

---

## Message Item Variants

### Default (Main Chat)
```
┌─────────────────────────────────────────────────┐
│ 🟣 Claude • gpt-4o         14:02  streaming...  │
│                                                 │
│ From a **product-led growth** perspective,     │
│ freemium is compelling because it reduces      │
│ friction at the top of the funnel.             │
│                                 [Branch(2)]    │
│                             [Copy] [🔖] [👍]   │
└─────────────────────────────────────────────────┘
```

### Compact (Thread Panel)
```
┌─────────────────────┐
│ 🟣 Claude 14:02     │
│ From a PLG…        │
│ perspective,… [Branch]
└─────────────────────┘
```

---

## Input Area Modes

### Chat Mode
```
┌──────────────────────────────────────────────────┐
│ [Chat] [Roundtable]  [🟣 1 agent]  ⌘⏎          │
├──────────────────────────────────────────────────┤
│ [📎] [⚡]                                         │
│ Ask anything... (⌘↵ to send)                    │
│                                ⌘⏎ send [Send]  │
└──────────────────────────────────────────────────┘
```

### Roundtable Mode
```
┌──────────────────────────────────────────────────┐
│ [Chat] [Roundtable]  [🟣🔵🟠 3 agents]  ⌘⏎    │
├──────────────────────────────────────────────────┤
│ [📎] [⚡]                                         │
│ Start a roundtable discussion... (⌘↵ to send)   │
│                                ⌘⏎ send [Send]  │
└──────────────────────────────────────────────────┘
```

### With Active Branch
```
┌─ BRANCH ────────────────────────────────────────┐
│ [📁 Hybrid pricing]  [← Back to main]           │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ [Chat] [Roundtable]  [🟣🔵🟠 3 agents]  ⌘⏎    │
├──────────────────────────────────────────────────┤
│ [📎] [⚡]                                         │
│ Continue in thread... (⌘↵ to send)              │
│                                ⌘⏎ send [Send]  │
└──────────────────────────────────────────────────┘
```

---

## Color Coding System

| Element | Color | Meaning |
|---------|-------|---------|
| 🟣 Purple (Claude) | `--agent-claude` | Claude engine |
| 🔵 Blue (Codex) | `--agent-codex` | Codex engine |
| 🟠 Orange (Gemini) | `--agent-gemini` | Gemini engine |
| 🟢 Green (OpenCode) | `--agent-opencode` | OpenCode engine |
| Primary Badge | Purple | Active/Important state |
| Accent Hover | Lighter Purple | Interactive elements |
| Warning (Rejected) | Red | Artifact rejected |
| Success (Approved) | Green | Artifact approved |
| Draft (Status) | Orange | Artifact in draft |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘⏎` / `Ctrl⏎` | Send message |
| `Escape` | Close branch thread |
| `Ctrl+K` | Quick search (future) |
| `Ctrl+/` | Help (future) |

---

## Interaction Patterns

### Branching Workflow
```
1. User reads message → Hovers to reveal actions
2. Clicks [Branch] → Thread panel slides in
3. Reads branch context → Decides to adopt or discard
4. Clicks [Adopt] → Panel closes, branch becomes active
5. Input area shows branch state
6. All new messages sent in branch context
7. Click [← Back to main] to return to main chat
```

### Roundtable Workflow
```
1. Select roundtable conversation
2. StatusBar shows: Roundtable, 4 agents, Round N
3. View grouped by rounds with participant names
4. Can branch on any message to explore alternatives
5. See "based on Round X" context in next round
6. Understand causal chain of reasoning
```

---

## Accessibility Considerations

- **Screen Readers:** All icons have ARIA labels or text equivalents
- **Keyboard Nav:** Tab through messages, Space to focus, Enter to branch
- **Color:** Don't rely on color alone (badges have text labels)
- **Contrast:** All text meets WCAG AA standards
- **Motion:** Reduced motion preference respected in animations

