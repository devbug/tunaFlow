import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import {
  Play, Loader2, Download, RefreshCw, GitBranch,
  AlertTriangle, Info, XCircle,
} from "lucide-react";
import type { InsightSession, InsightFinding, InsightCategory, InsightSeverity } from "@/types";
import * as insightApi from "@/lib/api/insight";
import { runInsightAnalysis, revalidateFindings } from "@/lib/insightOrchestration";
import { toast } from "sonner";
import { CATEGORY_META, SEVERITY_META, classifyQuadrant } from "./insight/insightConstants";
import type { QuadrantKey } from "./insight/insightConstants";
import { FindingDetail } from "./insight/InsightFindingCards";
import { QuadrantSection } from "./insight/InsightQuadrant";

export function InsightPanel() {
  const selectedProjectKey = useChatStore((s) => s.selectedProjectKey);
  const projects = useChatStore((s) => s.projects);

  const [sessions, setSessions] = useState<InsightSession[]>([]);
  const [activeSession, setActiveSession] = useState<InsightSession | null>(null);
  const [findings, setFindings] = useState<InsightFinding[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<InsightCategory | "all">("all");
  const [activeFinding, setActiveFinding] = useState<InsightFinding | null>(null);
  // Previous session preview — shown in the right panel instead of replacing the main list
  const [previewSession, setPreviewSession] = useState<InsightSession | null>(null);
  const [previewFindings, setPreviewFindings] = useState<InsightFinding[]>([]);

  // Load sessions
  useEffect(() => {
    if (!selectedProjectKey) return;
    insightApi.listInsightSessions(selectedProjectKey).then((list) => {
      setSessions(list);
      if (list.length > 0) setActiveSession(list[0]);
    }).catch(console.error);
  }, [selectedProjectKey]);

  // Load findings when session changes
  useEffect(() => {
    if (!activeSession) { setFindings([]); return; }
    insightApi.listInsightFindings(activeSession.id).then(setFindings).catch(console.error);
  }, [activeSession?.id]);

  // Load preview findings when previewSession changes
  useEffect(() => {
    if (!previewSession) { setPreviewFindings([]); return; }
    insightApi.listInsightFindings(previewSession.id).then(setPreviewFindings).catch(console.error);
  }, [previewSession?.id]);

  // Run analysis
  const handleRunAnalysis = useCallback(async () => {
    if (!selectedProjectKey || running) return;
    const project = projects.find((p) => p.key === selectedProjectKey);
    if (!project?.path) {
      toast.error("프로젝트 경로 없음");
      return;
    }

    setRunning(true);
    setProgress("시작...");
    try {
      const cats = categoryFilter !== "all" ? [categoryFilter] : undefined;
      const { session, findings: newFindings } = await runInsightAnalysis({
        projectKey: selectedProjectKey,
        projectPath: project.path,
        categories: cats,
        onProgress: setProgress,
      });
      setActiveSession(session);
      setFindings(newFindings);
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
      toast.success(`분석 완료: ${newFindings.length}건 발견`);
    } catch (err) {
      toast.error(`분석 실패: ${err}`);
    } finally {
      setRunning(false);
      setProgress("");
    }
  }, [selectedProjectKey, projects, categoryFilter, running]);

  // Toggle selection
  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Dismiss selected
  const handleDismiss = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    await insightApi.updateInsightFindingsBatchStatus(ids, "dismissed");
    setFindings((prev) => prev.map((f) => ids.includes(f.id) ? { ...f, status: "dismissed" as const } : f));
    setSelectedIds(new Set());
  }, [selectedIds]);

  // Export findings to project files
  const handleExportToFiles = useCallback(async () => {
    if (!activeSession || !selectedProjectKey) return;
    const project = projects.find((p) => p.key === selectedProjectKey);
    if (!project?.path) { toast.error("프로젝트 경로 없음"); return; }
    try {
      const count = await insightApi.exportInsightToFiles(activeSession.id, project.path);
      toast.success(`${count}개 파일 저장 완료 (docs/insight/)`);
    } catch (err) {
      toast.error(`파일 저장 실패: ${err}`);
    }
  }, [activeSession, selectedProjectKey, projects]);

  // Send findings to Architect via a new Review Branch (B안)
  const handleSendToArchitect = useCallback(async (targetFindings: InsightFinding[]) => {
    if (targetFindings.length === 0) return;
    const store = useChatStore.getState();
    const convId = store.selectedConversationId;
    if (!convId) { toast.error("대화를 먼저 선택해주세요"); return; }

    const lines = targetFindings.map((f) => {
      let entry = `### ${f.title}\n- **카테고리**: ${f.category} | **심각도**: ${f.severity} | **난이도**: ${f.fixDifficulty}`;
      if (f.filePath) entry += `\n- **위치**: \`${f.filePath}${f.lineNumber ? `:${f.lineNumber}` : ""}\``;
      entry += `\n- **설명**: ${f.description}`;
      if (f.snippet) entry += `\n\`\`\`\n${f.snippet.slice(0, 300)}\n\`\`\``;
      return entry;
    });

    const prompt = `## Insight 분석 결과 검토 요청

다음 ${targetFindings.length}건의 코드 품질 이슈를 검토해주세요.

각 항목에 대해 **자율적으로 판단**해주세요:
- 관련 파일을 직접 읽고 현재 상태 확인
- Plan으로 승격할지, 단순 메모로 처리할지, 이미 해결됐는지 판단
- Plan이 필요하다면 여러 항목을 묶어 하나의 plan-proposal로 작성 (불필요한 Plan 낭비 방지)
- Plan 없이 처리 가능한 것들은 처리 방법을 간략히 설명

---

${lines.join("\n\n")}`;

    try {
      // Create Architect Review Branch
      await store.createBranch(convId, undefined, `Insight Review (${targetFindings.length}건)`, "chat");
      // Branch is now at top of list — find it
      const newBranch = useChatStore.getState().branches
        .filter((b) => b.conversationId === convId && b.mode !== "roundtable")
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      if (!newBranch) { toast.error("브랜치 생성 실패"); return; }

      // Mark findings as in_progress
      const ids = targetFindings.map((f) => f.id);
      await insightApi.updateInsightFindingsBatchStatus(ids, "in_progress");
      setFindings((prev) => prev.map((f) => ids.includes(f.id) ? { ...f, status: "in_progress" as const } : f));
      setSelectedIds(new Set());

      // Open branch drawer and send message
      store.openThread(newBranch.id);
      setTimeout(() => {
        store.sendThreadMessage(prompt);
      }, 300);

      toast.success(`Architect Review Branch 생성 → ${targetFindings.length}건 전달`);
    } catch (err) {
      toast.error(`브랜치 생성 실패: ${err}`);
    }
  }, []);

  // Revalidate open findings against current codebase
  const handleRevalidate = useCallback(async () => {
    if (running || !selectedProjectKey) return;
    const openCount = findings.filter((f) => f.status === "open").length;
    if (openCount === 0) { toast.info("재검토할 open findings가 없습니다"); return; }

    setRunning(true);
    setProgress(`${openCount}건 재검토 중...`);
    try {
      const results = await revalidateFindings(findings, selectedProjectKey, setProgress);
      const resolved = results.filter((r) => r.status === "resolved");
      const uncertain = results.filter((r) => r.status === "uncertain");

      // Update resolved findings in DB and local state
      for (const r of resolved) {
        await insightApi.updateInsightFindingStatus(r.id, "resolved", r.reason);
      }
      if (resolved.length > 0) {
        setFindings((prev) => prev.map((f) => {
          const match = resolved.find((r) => r.id === f.id);
          return match ? { ...f, status: "resolved" as const } : f;
        }));
      }

      const msg = resolved.length > 0
        ? `재검토 완료: ${resolved.length}건 해결됨으로 업데이트${uncertain.length > 0 ? `, ${uncertain.length}건 불확실` : ""}`
        : `재검토 완료: 모든 findings가 여전히 유효합니다`;
      toast.success(msg);
    } catch (err) {
      toast.error(`재검토 실패: ${err}`);
    } finally {
      setRunning(false);
      setProgress("");
    }
  }, [running, findings, selectedProjectKey]);

  // Auto fix — disabled, pending meta-agent (see docs/ideas/onboardingMetaAgentIdea.md §8)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleAutoFix = useCallback(() => {}, []);

  // Filter findings
  const filtered = categoryFilter === "all"
    ? findings
    : findings.filter((f) => f.category === categoryFilter);

  // Group by quadrant
  const quadrants: Record<QuadrantKey, InsightFinding[]> = {
    "quick-wins": [],
    "strategic": [],
    "fill-ins": [],
    "deprioritize": [],
  };
  for (const f of filtered) {
    quadrants[classifyQuadrant(f)].push(f);
  }

  if (!selectedProjectKey) {
    return <div className="p-4 text-center text-muted-foreground/50 text-xs">프로젝트를 선택하세요</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/20 shrink-0">
        <button
          onClick={handleRunAnalysis}
          disabled={running}
          className={cn(
            "flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium transition-colors",
            running
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-accent text-accent-foreground hover:bg-accent/80",
          )}
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {running ? "분석 중..." : "분석 실행"}
        </button>

        {activeSession && findings.length > 0 && (
          <button
            onClick={handleRevalidate}
            disabled={running}
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded text-prose-muted hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="현재 코드 기반으로 open findings 재검토"
          >
            <RefreshCw className="w-3 h-3" />
            재검토
          </button>
        )}

        {activeSession && findings.length > 0 && (
          <button
            onClick={handleExportToFiles}
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded text-prose-muted hover:text-foreground hover:bg-muted/30 transition-colors"
            title="docs/insight/ 에 파일 저장"
          >
            <Download className="w-3 h-3" />
            저장
          </button>
        )}

        <span className="w-px h-3 bg-border/30 mx-0.5" />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as InsightCategory | "all")}
          className="text-[10px] bg-transparent border border-border/30 rounded px-1.5 py-0.5 text-foreground"
        >
          <option value="all">전체 카테고리</option>
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {activeSession && (
          <span className="text-[9px] text-muted-foreground/35 ml-auto">
            {new Date(activeSession.createdAt * 1000).toLocaleString()}
          </span>
        )}
      </div>

      {/* Summary strip — always visible when findings exist */}
      {findings.length > 0 && (() => {
        const open = findings.filter((f) => f.status === "open").length;
        const resolved = findings.filter((f) => f.status === "resolved").length;
        const inProgress = findings.filter((f) => f.status === "in_progress").length;
        const total = findings.length;
        const bySeverity = { critical: 0, major: 0, minor: 0, info: 0 };
        for (const f of findings.filter((f) => f.status === "open")) {
          bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
        }
        return (
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/10 shrink-0 text-[9px] bg-card/20">
            {bySeverity.critical > 0 && (
              <span className="flex items-center gap-0.5 text-red-500/80">
                <XCircle className="w-2.5 h-2.5" />{bySeverity.critical}
              </span>
            )}
            {bySeverity.major > 0 && (
              <span className="flex items-center gap-0.5 text-orange-500/80">
                <AlertTriangle className="w-2.5 h-2.5" />{bySeverity.major}
              </span>
            )}
            {bySeverity.minor > 0 && (
              <span className="flex items-center gap-0.5 text-yellow-500/70">
                <Info className="w-2.5 h-2.5" />{bySeverity.minor}
              </span>
            )}
            {bySeverity.info > 0 && (
              <span className="flex items-center gap-0.5 text-blue-400/70">
                <Info className="w-2.5 h-2.5" />{bySeverity.info}
              </span>
            )}
            <span className="w-px h-2.5 bg-border/30" />
            <span className="text-prose-disabled">
              {open > 0 && <span className="text-foreground/50">{open} open</span>}
              {inProgress > 0 && <span className="ml-1.5 text-primary/50">{inProgress} 진행 중</span>}
              {resolved > 0 && <span className="ml-1.5 text-status-approved/60">{resolved}/{total} 해결</span>}
            </span>
            {resolved > 0 && (
              <div className="ml-auto w-20 h-1 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-status-approved/50 rounded-full transition-all"
                  style={{ width: `${Math.round((resolved / total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* Progress */}
      {running && progress && (
        <div className="px-3 py-1.5 text-[10px] text-accent bg-accent/5 border-b border-border/10">
          {progress}
        </div>
      )}

      {/* Content — master-detail layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left: findings list */}
        <div className={cn(
          "overflow-y-auto p-3 space-y-3 border-r border-border/20",
          (activeFinding || previewSession) ? "w-[40%] shrink-0" : "flex-1",
        )}>
          {findings.length > 0 ? (
            <>
              <QuadrantSection quadrant="quick-wins" findings={quadrants["quick-wins"]} selectedIds={selectedIds} activeFindingId={activeFinding?.id ?? null} onToggle={handleToggle} onSelect={setActiveFinding} />
              <QuadrantSection quadrant="strategic" findings={quadrants["strategic"]} selectedIds={selectedIds} activeFindingId={activeFinding?.id ?? null} onToggle={handleToggle} onSelect={setActiveFinding} />
              <QuadrantSection quadrant="fill-ins" findings={quadrants["fill-ins"]} selectedIds={selectedIds} activeFindingId={activeFinding?.id ?? null} onToggle={handleToggle} onSelect={setActiveFinding} />
              <QuadrantSection quadrant="deprioritize" findings={quadrants["deprioritize"]} selectedIds={selectedIds} activeFindingId={activeFinding?.id ?? null} onToggle={handleToggle} onSelect={setActiveFinding} />

              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                  <span className="text-tf-xs text-prose-muted">{selectedIds.size}개 선택</span>
                  <button
                    onClick={() => {
                      const selected = findings.filter((f) => selectedIds.has(f.id));
                      handleSendToArchitect(selected);
                    }}
                    className="text-tf-xs text-primary hover:text-primary/80 px-2 py-0.5 rounded border border-primary/30 flex items-center gap-0.5"
                  >
                    <GitBranch className="w-2.5 h-2.5" />
                    Architect 검토
                  </button>
                  <button
                    onClick={handleDismiss}
                    className="text-tf-xs text-prose-faint hover:text-foreground px-2 py-0.5 rounded border border-border/30"
                  >
                    무시
                  </button>
                </div>
              )}
            </>
          ) : activeSession ? (
            <div className="text-center text-prose-faint text-tf-sm py-8">
              {activeSession.status === "completed" ? "발견 사항 없음" : activeSession.summary || "세션 로드 중..."}
            </div>
          ) : (
            <div className="text-center text-prose-faint text-tf-sm py-8">
              <p>아직 분석을 실행하지 않았습니다.</p>
              <p className="mt-1">"분석 실행" 버튼으로 프로젝트 품질을 분석하세요.</p>
            </div>
          )}

          {/* Session history */}
          {sessions.length > 1 && (
            <div className="pt-3 border-t border-border/20">
              <p className="text-tf-micro text-prose-disabled mb-1">이전 분석</p>
              {sessions.slice(1, 5).map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setPreviewSession(s); setActiveFinding(null); }}
                  className={cn(
                    "block w-full text-left text-tf-micro px-2 py-1 rounded hover:bg-muted/30 transition-colors",
                    s.id === previewSession?.id ? "bg-muted/40 text-foreground/70" : "text-prose-disabled",
                  )}
                >
                  <span>{new Date(s.createdAt * 1000).toLocaleString()}</span>
                  {s.summary && <span className="ml-2 text-prose-faint">{s.summary}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: detail panel — finding detail OR previous session preview */}
        {(activeFinding || previewSession) && (
          <div className="flex-1 min-w-0 relative flex flex-col">
            <button
              onClick={() => { setActiveFinding(null); setPreviewSession(null); }}
              className="absolute top-2 right-2 z-10 text-prose-disabled hover:text-foreground p-1 rounded hover:bg-muted/30"
            >
              <XCircle className="w-4 h-4" />
            </button>
            {activeFinding ? (
              <FindingDetail finding={activeFinding} onSendToArchitect={(f) => handleSendToArchitect([f])} />
            ) : previewSession && (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <div className="pr-6">
                  <p className="text-tf-xs font-medium text-foreground/70 mb-0.5">
                    {new Date(previewSession.createdAt * 1000).toLocaleString()}
                  </p>
                  {previewSession.summary && (
                    <p className="text-tf-micro text-prose-muted mb-2">{previewSession.summary}</p>
                  )}
                </div>
                {previewFindings.length === 0 ? (
                  <p className="text-tf-micro text-prose-faint text-center py-4">발견 사항 없음</p>
                ) : previewFindings.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setActiveFinding(f)}
                    className="w-full text-left rounded-md border border-border/20 bg-card/30 hover:bg-card/60 px-3 py-2 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={cn("flex items-center gap-0.5 text-tf-micro px-1 py-0.5 rounded", SEVERITY_META[f.severity]?.cls)}>
                        {SEVERITY_META[f.severity]?.icon} {f.severity}
                      </span>
                      <span className={cn("text-tf-micro", CATEGORY_META[f.category]?.color)}>
                        {CATEGORY_META[f.category]?.label}
                      </span>
                    </div>
                    <p className="text-tf-xs text-foreground/80 leading-snug">{f.title}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
