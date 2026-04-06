<div align="center">

# tunaFlow

**AI Agent Orchestration Client**

[![Tauri 2](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-363_passing-22c55e)](.)
[![DB Schema](https://img.shields.io/badge/DB_Schema-v28-8b5cf6)](.)

[![Korean](https://img.shields.io/badge/한국어-9ca3af)](./README.md)
[![Language: English](https://img.shields.io/badge/Language-English-2563eb)](./README.en.md)

> **Of the agent, By the agent, For the agent**

</div>

---

Not just a chat app for user convenience. This tool prioritizes making agents work with less friction, better context, and less waste.

The user decides **domain knowledge and direction**; agents execute those decisions under **optimal conditions**. The philosophy: when agents are comfortable, results are better — every design decision in ContextPack, identity, memory, and retrieval is judged by "can the agent work without unnecessary token waste, with accurate context, without role confusion?"

> **100% AI-authored codebase** — All code is written by Claude Code. The user only decides architecture and direction.

---

## Table of Contents

- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [DB Schema](#db-schema-v28)
- [Project Structure](#project-structure)
- [Development History](#development-history)
- [References](#references)
- [Contact](#contact)
- [License](#license)

---

## Key Features

### 1. Multi-Engine Agent Execution

Unified support for 5 engines. All execution runs on background threads/tokio tasks.

| Engine | Integration | Streaming |
|--------|------------|-----------|
| Claude (Anthropic) | CLI subprocess | stream-json |
| Codex (OpenAI) | CLI subprocess | JSONL synthetic |
| Gemini (Google) | CLI subprocess | stream-json |
| OpenCode | CLI subprocess | one-shot |
| OpenAI Compatible (Ollama/LM Studio/vLLM) | HTTP SSE | SSE streaming |

- **Agent Profiles**: Bundle engine/model/persona/default-skill into profiles for quick switching
- **Tool Steps Visualization**: Real-time display of intermediate work (thinking, tool_use, file_change) from Claude/Codex/Gemini
- **Model Discovery**: Automatic detection of available models per engine
- **CLI Auto-resolve**: Binary discovery including fnm/nvm paths

### 2. Roundtable (RT) — Multi-Agent Discussion

Multiple agents debate a single topic.

- **Sequential mode**: Agents speak in order, referencing previous responses
- **Deliberative mode**: All agents respond simultaneously, collected in completion order
- **Per-participant identity injection**: Name/engine/role explicitly stated in prompts to prevent role confusion
- **ContextPack RT injection**: Commercial engines get auto context, local engines get lite (15k cap) with RtContextCache
- **Branch extension mode**: Every RT operates as a Branch extension, opening in a drawer

### 3. Branch & Adopt — Conversation Forking

Fork at any point in a conversation for independent experimentation, then adopt the summary.

- Create Branch from any message in the main conversation
- Independent conversation/RT execution within Branch
- **Adopt**: Summarize Branch results and insert into parent conversation
- All Branches open in a right-side drawer (up to 80% width)
- Nested Branch support (parent_branch_id chain)

### 4. Orchestration Workflow Pipeline

Plan-based 3-role automation pipeline.

```
Chat → Plan Promotion → Approval (approve/review/hold)
  → Implementation Branch → Developer auto-invocation
  → Review RT (2-agent) → Verdict (pass/fail/conditional)
  → Done or Rework loop
```

**3-Role System**:

| Role | Responsibility | Agent |
|------|---------------|-------|
| **Architect** | Plan design, subtask decomposition, task file authoring | Main chat agent |
| **Developer** | Task file-based implementation, verification command execution | Implementation Branch |
| **Reviewer** | Code-reading review, verdict judgment | Review RT (2-agent) |

**Key Capabilities**:
- `<!-- tunaflow:plan-proposal -->` **marker-based auto-detection**: 5 marker types (plan-proposal, impl-plan, impl-complete, review-verdict, subtask-done)
- **PlanProposalCard / ApprovalGate / ImplPlanCard / ReviewVerdictCard** UI components
- **Doom Loop Detection**: Auto-escalation after 3 review failures → Architect redesign request
- **Targeted subtask rework**: Only rework failed subtasks via failed_subtask_ids
- **zod schema validation**: 5 workflow schemas with graceful degradation
- **Follow-up Plans**: Plan lineage tracking via parent_plan_id

### 5. Failure Learning — Learning from Review Failures

Prevents repeating the same mistakes by learning from review failures.

- Auto-saves findings to `failure_lessons` table on review fail (file path, pattern auto-extraction)
- **Auto-injects similar failures into rework prompts**: FTS5 keyword + file path hybrid search
- Auto-fills resolution on review pass for unresolved lessons
- Project-scoped search only (no cross-project contamination)

### 6. ContextPack — Unified Prompt Assembly for All 4 Engines

Assembles identical structured normalized prompts for every engine on every request.

```
+- Identity --------------------------------+
| Profile -> Engine -> Model -> Persona     |
| Response language rules                   |
+- Context ---------------------------------+
| Recent messages (author attribution)      |
| Parent/Thread inheritance                 |
| Compressed conversation memory            |
| Cross-session context                     |
+- Knowledge -------------------------------+
| Plan document + task files                |
| Findings + Artifacts                      |
| Skills (phase-based auto-injection)       |
| rawq code search results                  |
| context-hub library docs                  |
| code-review-graph dependency info         |
| Failure lessons (rework only)             |
+- Agent Role Document ---------------------+
| docs/agents/{architect|developer|         |
| reviewer}.md (per workflow role)          |
+-------------------------------------------+
```

- **Context modes**: Lite / Standard / Full / Auto (auto-selects based on conversation length)
- **Budget control**: Per-section compression targets, total cap adjustable in Settings
- **Multi-agent context**: Participants meta + budget-based dynamic window + per-agent last-message guarantee
- **Marker-based multi-turn tool calls**: `<!-- tunaflow:tool-request:TYPE:QUERY -->` — docs/rawq/graph/plans

### 7. Long-term Memory & Vector Search

- **Topic-based memory**: JSON array topic splitting (1-5 topics per conversation) at 12+ messages, with provenance/model tracking
- **Auto session discovery**: FTS5 + Vector hybrid for automatic related conversation linking (session_links table)
- **Vector DB**: rawq embed CLI (snowflake-arctic-embed-s 384-dim), conversation_chunks BLOB embeddings, brute-force cosine search
- **Manual pins**: Users can manually link related conversations

### 8. rawq — Code Search Engine

- **Sidecar binary**: Daemon auto-starts with the app, embedding model stays resident (30-min idle timeout)
- `.gitignore`-respecting indexing (auto-excludes node_modules, target, etc.)
- **SearchOptions**: rerank, token-budget, text-weight, rrf-weight
- Auto-detects concept vs code queries → automatic weight adjustment
- `prompt_needs_rawq()` gate: auto-includes for 10+ char prompts
- Auto re-index on agent completion (fs watcher)

### 9. code-review-graph Integration

- CLI query/impact commands for dependency/impact analysis
- Rust sidecar integration + ContextPack auto-injection
- Auto-update on `agent:completed`
- Marker-based tool calls: `<!-- tunaflow:tool-request:graph:QUERY -->`

### 10. Skills System

4-layer skill architecture:

| Layer | Description |
|-------|-------------|
| **A** Project auto-detect | Auto-recommends skills matching project stack |
| **B** Project-persisted | Fixed skill pack per project |
| **C** Prompt dynamic activation | Keyword-matching skill auto-activation |
| **D** Persona recommendations | Per-persona recommendedSkills |

- `~/.tunaflow/skills/` vendor-specific skill snapshots
- **skills.sh registry**: API search + download installation
- **Multi-tool skill scan**: 12 tool paths + Claude plugin collection
- **Workflow phase auto-injection**: Automatically includes phase-appropriate skills

### 11. Artifacts — Output Management

- **Plan-based grouping**: Each artifact auto-linked to plan_id, displayed as collapsible Plan groups in Artifacts tab
- **Workflow auto-creation**: Plan approval → architect-decision, Review RT → test-report, Review verdict → review-findings
- **Type filters**: All / Notes / Code / Specs / Harness
- **Harness types**: task-brief, test-report, review-findings, architect-decision
- **Forward**: Send artifacts to other agents

### 12. UI/UX

- **Linear-inspired layout**: Sidebar + 5-tab CenterPanel + Drawers + RuntimeStatusBar
- **react-virtuoso**: Virtual scrolling for large message lists (followOutput + scrollToIndex)
- **cmdk**: Cmd+K command palette (tab/conversation/project switching, new conversation, settings)
- **RuntimeStatusBar**: trace (active/skipped) + context mode + memory + rawq status + cost + tok/s + context %
- **Custom titlebar**: macOS overlay with project name display
- **Right-click context menu**: Per-message/sidebar menus (Shift+right-click preserves devtools)
- **Settings**: Agents / Personas / Runtime section separation
- **Project-first startup**: ProjectStartup screen when no project selected
- **Smart scaffold**: Auto-detect project stack on creation → auto-generate CLAUDE.md + docs/

---

## Architecture

```
+--------------------------------------------------------------+
| Frontend (React 18 + Zustand 5 + Tailwind CSS 4)            |
| |- Sidebar -- Project selector / Chats / Artifacts / Skills |
| |- CenterPanel -- Chat / Plan / Artifacts / Review / Test   |
| |- Drawers -- Branch / RT (right-side slider)               |
| |- Settings -- Agents / Personas / Runtime                  |
| +- RuntimeStatusBar + TraceModal + CommandPalette           |
+--------------------------------------------------------------+
| Tauri 2 Host (Rust + Tokio async)                           |
| |- Commands -- CRUD + background agent execution            |
| |- Agents -- claude, codex, gemini, opencode, ollama + SDKs |
| |- Context -- ContextPack, compression, vector search       |
| |- Workflow -- Plan/Approval/Review/Verdict pipeline        |
| |- Failure Learning -- FTS5 search + rework injection       |
| +- DB -- SQLite WAL, dual read/write, v28 schema           |
+--------------------------------------------------------------+
| CLI Agents / Sidecars                                       |
| |- claude (Anthropic) -- CLI subprocess                     |
| |- codex (OpenAI) -- CLI subprocess                         |
| |- gemini (Google) -- CLI subprocess                        |
| |- opencode -- CLI subprocess                               |
| |- ollama/LM Studio/vLLM -- OpenAI-compatible HTTP          |
| |- rawq -- code retrieval + embedding sidecar               |
| |- code-review-graph -- dependency analysis sidecar         |
| +- context-hub -- knowledge search sidecar                  |
+--------------------------------------------------------------+
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri 2 |
| Frontend | React 18, TypeScript, Zustand 5, Tailwind CSS 4 |
| Backend | Rust, Tokio (async), rusqlite (bundled SQLite) |
| Virtual scroll | react-virtuoso |
| Command palette | cmdk |
| Toast | sonner |
| Markdown | react-markdown, remark-gfm, react-syntax-highlighter (Prism + oneDark) |
| Schema validation | zod |
| Icons | Lucide React |
| Testing | Vitest + jsdom (frontend), Cargo test (Rust) |

---

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) stable
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)
- At least one agent CLI:
  - `claude` — [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
  - `codex` — [OpenAI Codex CLI](https://github.com/openai/codex)
  - `gemini` — [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- (Optional) rawq sidecar — build with `./scripts/build-rawq.sh`
- (Optional) Ollama — for local LLM execution

---

## Getting Started

```bash
# Install dependencies
npm install

# Development
npm run tauri dev

# Production build
npm run tauri build
```

### Build Verification

```bash
npx tsc --noEmit              # TypeScript check
npx vite build                # Frontend build
cd src-tauri && cargo check   # Rust check

# Tests
npx vitest run                # Frontend (175 tests)
cd src-tauri && cargo test --lib  # Rust unit (188 tests)
```

Currently Rust 188 + Frontend 175 = **363 tests** passing.

---

## DB Schema (v28)

| Table | Purpose |
|-------|---------|
| `projects` | Projects (path, type, soft-delete) |
| `conversations` | Conversations (chat/roundtable mode, rt_config JSON) |
| `messages` | Messages (role, content, engine, model, persona) |
| `messages_fts` | FTS5 full-text search (trigger-synced) |
| `branches` | Conversation forks (chat/roundtable mode, parent chain, git_branch) |
| `plans` | Workflow plans (phase, 3-role engines, parent_plan_id, slug) |
| `plan_subtasks` | Plan subtasks (depends_on, parallel_group) |
| `plan_events` | Plan event timeline |
| `artifacts` | Outputs (type, status, subtask/plan linkage) |
| `failure_lessons` | Failure learning (finding, pattern, file_path, resolution) |
| `failure_lessons_fts` | FTS5 failure lesson search (trigger-synced) |
| `memos` | Memos (message linkage, tags) |
| `trace_log` | ContextPack traces (mode, sections, length, truncation) |
| `agent_jobs` | Agent job registry |
| `conversation_memory` | Topic-based compressed memory (topic, provenance, model) |
| `session_links` | Auto session discovery links (score, method) |
| `conversation_chunks` | Vector embeddings (BLOB, 384-dim) |

28 migrations + 2 FTS5 virtual tables.

---

## Project Structure

```
tunaFlow/
|- src-tauri/                # Rust backend
|  |- src/
|  |  |- lib.rs              # Tauri app builder + command registration
|  |  |- agents/             # CLI adapters (claude, codex, gemini, opencode, ollama, rawq)
|  |  |- commands/           # Tauri commands + helpers
|  |  |  |- agents.rs               # 5-engine background stream commands
|  |  |  |- agents_helpers/         # ContextPack, identity, send_common
|  |  |  |- roundtable.rs           # RT orchestration
|  |  |  |- roundtable_helpers/     # RT executor, prompt, persist
|  |  |  |- failure_lessons.rs      # Failure learning CRUD + FTS5 search
|  |  |  |- conversation_memory.rs  # Topic-based compressed memory
|  |  |  |- session_discovery.rs    # FTS5+Vector session discovery
|  |  |  |- vector_search.rs        # Vector embedding/search
|  |  |  +- ...
|  |  |- db/                 # SQLite schema, migrations (v1-v28), models
|  |  |- errors.rs           # AppError enum
|  |  +- guardrail.rs        # Context budget limits
|  |- binaries/              # rawq sidecar (gitignored)
|  +- Cargo.toml
|- src/                      # React frontend
|  |- components/tunaflow/
|  |  |- chat/               # Markdown rendering, FileViewer
|  |  |- context-panel/      # Plans, Review, Test, Trace, Skills, Artifacts, Evaluation
|  |  |- settings/           # Agents, Personas, Runtime sections
|  |  |- input/              # EngineSelector, ModelSelector, RoundtableControls
|  |  |- message/            # MessageMeta, MessageActions, ProgressSurface
|  |  |- sidebar/            # Chats, TreeRow, Artifacts, Files
|  |  |- CenterPanel.tsx     # 5-tab center (Chat/Plan/Artifacts/Review/Test)
|  |  +- RuntimeStatusBar.tsx
|  |- stores/slices/         # Zustand slices (6)
|  |- lib/                   # utils, schemas, parsers, api/, engineConfig
|  +- tests/                 # vitest tests
|- docs/
|  |- plans/                 # Implementation plans (~100, see index.md)
|  |- prompts/               # Execution prompts
|  |- reference/             # SSOT documents
|  |- ideas/                 # Ideas (Insight tab design, etc.)
|  +- how-to/               # Operations guides
|- scripts/                  # build-rawq.sh, publish-skills.sh
|- CLAUDE.md                 # Claude Code handoff document
+- package.json
```

---

## Development History

Developed over 14 sessions. All code authored by Claude Code.

| Session | Date | Key Achievements |
|---------|------|-----------------|
| 1 | 2026-03-28~29 | Linear UI, 4-engine parity, Branch/RT unification, Skills, Agent Profile/Persona |
| 2 | 2026-03-30 | Full ContextPack pipeline, identity, compressed memory |
| 3 | 2026-03-30 | Claude parity fix, agents.rs 1168→260 lines refactoring |
| 4 | 2026-03-31 | Multi-agent context 3-layer, project scaffold, rawq fs watcher |
| 5 | 2026-04-01 | Orchestration workflow pipeline Phase A-E complete |
| 6 | 2026-04-02 | zod schemas, Ollama engine, Tool Steps visualization |
| 7 | 2026-04-02~03 | Long-term memory 4 phases, Vector DB, virtuoso, cmdk, 50+ bug fixes from real-world testing |
| 8-9 | 2026-04-03~04 | Event isolation, RT overhaul, streaming race condition resolution |
| 10 | 2026-04-04 | Skills 4-layer + registry, CRG integration, marker-based tool calls, DB v25 |
| 11 | 2026-04-04 | Full audit, doc consistency recovery, expect panic removal |
| 12 | 2026-04-05 | Tests 180→352, 3-role prompt overhaul, escalation path completion |
| 13 | 2026-04-05~06 | Auto review detection, doom loop stabilization, code quality audit (7 items) |
| 14 | 2026-04-06 | Failure Learning, Artifacts Plan grouping, Insight tab design |

---

## Documentation

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](./CLAUDE.md) | Detailed handoff for Claude Code (architecture, schema, conventions) |
| [Data Model](./docs/reference/dataModelRevised.md) | Domain model SSOT |
| [Implementation Status](./docs/reference/implementationStatus.md) | Feature status tracker |
| [Plans Index](./docs/plans/index.md) | Implementation plans index (~100) |
| [Insight Design](./docs/ideas/insightTabDesign.md) | Insight tab design (category-based project analysis) |
| [Known Issues](./docs/reference/knownIssues_2026-04-05.md) | Unresolved issues |

---

## References

Research and methodologies referenced in this project's design.

### Agent Code Repair Success Rate Research

1. C. E. Jimenez et al., "SWE-bench: Can Language Models Resolve Real-world Github Issues?", 2024. — Strong negative correlation between file/line count and agent success rate. [GitHub](https://github.com/SWE-bench/SWE-bench)

2. Scale AI, "SWE-bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?", 2025. — Sharp performance degradation at avg 107 lines / 4.1 files. [Paper](https://static.scale.com/uploads/654197dc94d34f66c0f5184e/SWEAP_Eval_Scale%20(9).pdf)

3. I. Bouzenia et al., "RepairAgent: An Autonomous, LLM-Based Agent for Program Repair", ICSE 2025. — File count as the best proxy for fix difficulty. [Paper](https://software-lab.org/publications/icse2025_RepairAgent.pdf)

4. "CodeCureAgent: Automatic Classification and Repair of Static Analysis Warnings", 2025. — 96.8% auto-fix rate on SonarQube warnings, Change Approver pattern. [arXiv](https://arxiv.org/pdf/2509.11787)

### Technical Debt Management

5. J.-L. Letouzey, "The SQALE Method for Evaluating Technical Debt", MTD 2012. — ROI-based prioritization via remediation/non-remediation cost. [ACM](https://dl.acm.org/doi/abs/10.5555/2666036.2666042)

6. Sonar, "SQALE, the ultimate Quality Model to assess Technical Debt". — SonarQube's SQALE implementation. [Blog](https://www.sonarsource.com/blog/sqale-the-ultimate-quality-model-to-assess-technical-debt/)

7. "On the Technical Debt Prioritization and Cost Estimation with SonarQube tool". — Actual fix time under 50% of SonarQube estimates. [ResearchGate](https://www.researchgate.net/publication/345632101)

8. vFunction, "How to Prioritize Tech Debt: Strategies for Effective Management", 2025. — Quadrant Method (Impact x Cost). [Blog](https://vfunction.com/blog/how-to-prioritize-tech-debt-strategies-for-effective-management/)

### LLM-based Software Engineering

9. "A Survey of LLM-based Automated Program Repair", 2025. — Comprehensive LLM APR survey. [arXiv](https://arxiv.org/pdf/2506.23749)

10. "LLM-based Agents for Automated Bug Fixing: How Far Are We?", 2024. — Agent-based bug fixing limits and potential. [arXiv](https://arxiv.org/html/2411.10213v2)

11. "LLM-Based Agentic Systems for Software Engineering", 2026. — SE agent paradigm comparison. [arXiv](https://arxiv.org/pdf/2601.09822)

---

## Contact

- Email: d9ng@outlook.com

---

## License

Private project.
