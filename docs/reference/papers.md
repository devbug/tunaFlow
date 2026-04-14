---
title: 참고 문헌
updated_at: 2026-04-14
description: tunaFlow 설계에 참고한 연구 및 방법론
canonical: true
---

# 참고 문헌

tunaFlow의 설계에 참고한 글과 연구입니다.

---

## 근본 영감 — tunaFlow의 시작

이 세 글이 tunaFlow 설계의 출발점입니다.

1. **Stavros Korokithakis**, "Building with Claude Code" (2025) — Claude Code로 프로젝트를 진행하면서 자연스럽게 형성된 워크플로우(Plan → 승인 → 구현 → 리뷰)가 tunaFlow 워크플로우 파이프라인의 근본 영감. [stavros.io](https://www.stavros.io/posts/building-with-claude-code/)

2. **Sebastian Raschka**, "Components of a Coding Agent" (2025) — 코딩 에이전트의 6개 핵심 컴포넌트 분석. *"model quality = context quality"* — ContextPack 설계의 핵심 명제. [Ahead of AI](https://magazine.sebastianraschka.com/p/components-of-a-coding-agent)

3. **Addy Osmani**, "Orchestrating Coding Agents" (2025) — 멀티 에이전트 오케스트레이션의 패턴, 스케일링, 품질 게이트 종합. Architect-Developer-Reviewer 3-role 분리와 Review RT 설계에 직접 영향. [addyosmani.com](https://addyosmani.com/blog/code-agent-orchestra/)

---

## 에이전트 코드 수정 성공률

1. C. E. Jimenez et al., "SWE-bench: Can Language Models Resolve Real-world Github Issues?", 2024. — 수정 파일/라인 수와 에이전트 성공률의 강한 음의 상관관계. [GitHub](https://github.com/SWE-bench/SWE-bench)

2. Scale AI, "SWE-bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?", 2025. — 평균 107줄/4.1파일 수정 문제에서 에이전트 성능 급격 저하. [Paper](https://static.scale.com/uploads/654197dc94d34f66c0f5184e/SWEAP_Eval_Scale%20(9).pdf)

3. I. Bouzenia et al., "RepairAgent: An Autonomous, LLM-Based Agent for Program Repair", ICSE 2025. — 파일 수가 수정 난이도의 가장 좋은 프록시. [Paper](https://software-lab.org/publications/icse2025_RepairAgent.pdf)

4. "CodeCureAgent: Automatic Classification and Repair of Static Analysis Warnings", 2025. — SonarQube 경고 96.8% 자동 수정, Change Approver 패턴. [arXiv](https://arxiv.org/pdf/2509.11787)

---

## 기술 부채 관리

5. J.-L. Letouzey, "The SQALE Method for Evaluating Technical Debt", MTD 2012. — remediation/non-remediation cost 기반 ROI 우선순위. [ACM](https://dl.acm.org/doi/abs/10.5555/2666036.2666042)

6. Sonar, "SQALE, the ultimate Quality Model to assess Technical Debt". [Blog](https://www.sonarsource.com/blog/sqale-the-ultimate-quality-model-to-assess-technical-debt/)

7. "On the Technical Debt Prioritization and Cost Estimation with SonarQube tool". — SonarQube 추정 대비 실제 수정 시간 50% 이하. [ResearchGate](https://www.researchgate.net/publication/345632101)

8. vFunction, "How to Prioritize Tech Debt: Strategies for Effective Management", 2025. — Quadrant Method (Impact × Cost). [Blog](https://vfunction.com/blog/how-to-prioritize-tech-debt-strategies-for-effective-management/)

---

## LLM 기반 소프트웨어 엔지니어링

9. "A Survey of LLM-based Automated Program Repair", 2025. [arXiv](https://arxiv.org/pdf/2506.23749)

10. "LLM-based Agents for Automated Bug Fixing: How Far Are We?", 2024. [arXiv](https://arxiv.org/html/2411.10213v2)

11. "LLM-Based Agentic Systems for Software Engineering", 2026. [arXiv](https://arxiv.org/pdf/2601.09822)
