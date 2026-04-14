---
title: 개발 이력
updated_at: 2026-04-14
description: tunaFlow 프로젝트 계보 및 세션별 개발 성과
canonical: true
---

# 개발 이력

> 100% AI-authored — 모든 코드는 Claude Code가 작성했으며, 사용자는 아키텍처와 방향만 결정합니다.

---

## 프로젝트 계보

tunaFlow는 4개 프로젝트의 경험이 수렴된 결과물입니다.

```
tunaDish (채팅 UI, 3/20)  ──┐
                             ├→ tunaChat (합체 1차, Python sidecar, 3/24)
tunaPi (브릿지 서버, 3/22) ──┘           │
                                        ↓
                                  tunaFlow (합체 2차, 전체 Rust, 3/26~)
                                        ↑
tunaInsight (분석 서비스) ──────────────┘ (Insight 탭으로 통합)
```

| 프로젝트 | 역할 | 주요 기여 |
|---------|------|----------|
| **tunaPi** | 채팅앱 ↔ AI 에이전트 브릿지 (Python) | RT 토론, Branch, rawq, 크로스 세션, 3,538 tests |
| **tunaDish** | tunaPi 전용 웹/모바일 UI | Tauri v2, 브랜치 UI, 실시간 스트리밍, 모바일 |
| **tunaChat** | 스탠드얼론 데스크톱 1차 시도 | tunaDish+tunaPi 합체, Python sidecar 아키텍처 |
| **tunaInsight** | 멀티 에이전트 GitHub 분석 | 페르소나별 병렬 분석 → tunaFlow Insight 탭으로 흡수 |
| **tunaFlow** | 최종 통합 — 전체 Rust 전환 | 위 4개 프로젝트의 핵심 기능을 네이티브로 재구현 |

---

## 세션별 성과

약 18일, 500+ commits

| 세션 | 날짜 | 핵심 성과 |
|------|------|----------|
| 1 | 2026-03-28~29 | Linear UI, 4-engine parity, Branch/RT 통합, Skills, Agent Profile/Persona |
| 2 | 2026-03-30 | ContextPack 전체 파이프라인, identity, compressed memory |
| 3 | 2026-03-30 | Claude parity fix (통합 `build_normalized_prompt_with_budget()`), agents.rs 1168→260줄 |
| 4 | 2026-03-31 | Multi-agent context 3-layer, project scaffold, rawq fs watcher |
| 5 | 2026-04-01 | 오케스트레이션 워크플로우 Phase A-E 전체 완료 |
| 6 | 2026-04-02 | zod 스키마, Ollama 엔진, Tool Steps 가시화 |
| 7 | 2026-04-02~03 | 장기기억 4단계, Vector DB, virtuoso, cmdk, 실사용 검증 50+ 버그 수정 |
| 8-9 | 2026-04-03~04 | 이벤트 격리, RT 전면 수정, 스트리밍 race condition 해결, DB v23 |
| 10 | 2026-04-04 | Trace Phase 1, 스킬 4-layer + 레지스트리, CRG 통합, 마커 기반 도구 호출, DB v25 |
| 11 | 2026-04-04 | 전수조사, 문서 정합성 복구, expect 패닉 제거 |
| 12 | 2026-04-05 | 테스트 180→352, 3-role 프롬프트 근본 수정, 에스컬레이션 경로 완성, DB v26 |
| 13 | 2026-04-05~06 | Review 자동 감지, doom loop 안정화, 코드 품질 감사 7항목 |
| 14 | 2026-04-06~07 | Failure Learning (DB v27-28), Artifacts Plan 그룹핑, Insight 탭 설계 |
| 15 | 2026-04-07~08 | Insight 탭 구현 (Phase A~G, DB v29), 디자인 시스템 Phase 1 |
| 16 | 2026-04-10 | RT 중간 스트리밍, ContextPack Tiering (~70% 절감), PTY Phase 1-2, MCP 서버 |
| 17 | 2026-04-11 | PTY Phase 3-5 (delta 주입, ToolSteps 고도화, TerminalPanel) |
| 18 | 2026-04-11 | Tiering 완료, sqlite-vec 18x, Structured Memory, HTTP API, DB v30 |
| 19 | 2026-04-11 | HTTP API E2E + Phase 2 (16 endpoints) |
| 20 | 2026-04-11 | 문서 RAG, 장기기억 자동 트리거, Document Graph |
| 22 | 2026-04-12 | bge-m3 CPU 수정, PTY 터미널, 사이드바 리사이즈 5섹션 |
| 25 | 2026-04-12 | 버그 9건 수정, adoptBranch 충돌, Insight 우측 패널 |
| 26-27 | 2026-04-13 | 리팩토링 v3 전체 — 5 god-file → 18모듈 |
| 28 | 2026-04-13 | 사이드바 폰트, Tailwind 4 JIT 이슈 해결 |
| 29-31 | 2026-04-13 | Insight Phase I, 모바일 웹 초안, plan-proposal 파서 수정 |
| 32-34 | 2026-04-13 | 우클릭 메뉴, 라이트모드, 사용자 프로필→ContextPack, InsightPanel 재설계 |
| 35 | 2026-04-13 | PTY Enter 수정, bge-m3 CPU 스파이크 수정 (ONNX 스레드 제한+세마포어) |
