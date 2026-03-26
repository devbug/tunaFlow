# Plans

실행 계획, 로드맵, 리팩토링 계획, 테스트 계획 문서.

- [agentCollaborationPlan](./agentCollaborationPlan.md): 에이전트 협업 기능의 단계별 구현 계획
- [chatUiMarkdownUpgradePlan](./chatUiMarkdownUpgradePlan.md): tunaChat를 참고한 채팅 UI/Markdown 고도화 계획
- [claudeContextLightweightPlan](./claudeContextLightweightPlan.md): Claude full ContextPack을 lite/standard/full과 조건부 rawq로 줄이는 1차 계획
- [engineModelCatalogPlan](./engineModelCatalogPlan.md): 엔진별 세부 모델 카탈로그와 모델 선택 UX 설계
- [gitAwareBranchModelPlan](./gitAwareBranchModelPlan.md): 향후 git branch 연동을 고려한 작업 브랜치 모델 설계
- [harnessEngineeringAdoptionPlan](./harnessEngineeringAdoptionPlan.md): Stavros식 architect/developer/reviewer harness를 tunaFlow 구조에 단계적으로 적용하기 위한 설계
- [masterTestPlan](./masterTestPlan.md): 테스트 도입부터 커버리지/CI까지의 전체 계획
- [messageSearchAdoptionPlan](./messageSearchAdoptionPlan.md): tunaDish의 SQLite FTS 검색 UX를 참고해 tunaFlow의 Rust DB 구조에 메시지 검색을 도입하는 계획
- [modelsCommandCatalogPlan](./modelsCommandCatalogPlan.md): `!models`와 UI가 함께 쓰는 공통 모델 카탈로그 설계
- [naturalLanguageHandoffPlan](./naturalLanguageHandoffPlan.md): 자연어 기반 handoff의 단계별 고도화 방안
- [ownerAgentAssignmentPlan](./ownerAgentAssignmentPlan.md): `owner_agent`를 실제로 설정 가능하게 만드는 후속 계획
- [panelDrawerUxPlan](./panelDrawerUxPlan.md): Sidebar/Workspace Panel 리사이즈와 thread/RT drawer, 우측 패널 정보 구조를 함께 재설계하는 UX 계획
- [planBasedFollowupPlan](./planBasedFollowupPlan.md): plan/subtask를 follow-up source로 확장하는 후속 계획
- [projectOnboardingLifecyclePlan](./projectOnboardingLifecyclePlan.md): 프로젝트 추가 시 자동 설정과 초기화 라이프사이클 설계
- [projectScopedConcurrencyPlan](./projectScopedConcurrencyPlan.md): 프로젝트 간 병렬 실행과 프로젝트 내부 thread 직렬화 원칙 설계
- [progressFirstStreamingPlan](./progressFirstStreamingPlan.md): tunaChat처럼 툴 사용 로그를 먼저 스트리밍하고 완료 후 최종 답변을 렌더하는 구조 설계
- [opusRefactorPlan](./opusRefactorPlan.md): 구조 분리와 리팩토링 실행 계획
- [rawqIntegrationPlan](./rawqIntegrationPlan.md): tunaDish 수준의 rawq CLI 통합을 위한 단계별 도입 계획
- [rawqCodeReviewGraphIntegrationPlan](./rawqCodeReviewGraphIntegrationPlan.md): rawq 검색 레이어와 code-review-graph 구조 분석 레이어를 함께 쓰기 위한 병행 적용 계획
- [rawqAutomationPlan](./rawqAutomationPlan.md): rawq 자동 실행, 자동 인덱싱, 업데이트 대응 운영 계획
- [sidecarMigrationPlan](./sidecarMigrationPlan.md): tunaChat reference를 바탕으로 sidecar 계층을 단계적으로 도입하는 마스터 계획
- [tauri2PluginAdoptionPlan](./tauri2PluginAdoptionPlan.md): notification/store/dialog/window-state를 포함한 Tauri 2 플러그인 적용 상태와 확장 방향 정리
- [threadContextInheritancePlan](./threadContextInheritancePlan.md): thread와 RT에 프로젝트 맥락과 부모 대화 anchor를 어떻게 상속할지 정리한 설계
- [threadModelRoundtableRedesign](./threadModelRoundtableRedesign.md): Roundtable을 branch/thread 관점으로 재정의하는 UX/모델 설계
- [threadLocalRunQueuePlan](./threadLocalRunQueuePlan.md): 메신저형 UX와 터미널 에이전트 직렬 실행을 함께 만족하는 thread-local run queue 설계
- [workspacePanelRedesignPlan](./workspacePanelRedesignPlan.md): ContextPanel을 분류형 브라우저에서 workflow형 workspace panel로 전환하는 재설계 계획
