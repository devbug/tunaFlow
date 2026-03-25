use serde::{Deserialize, Serialize};

/// DATA_MODEL.md §1.2 Project
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub key: String,
    pub name: String,
    pub path: Option<String>,
    #[serde(rename = "type")]
    pub project_type: String,
    pub default_engine: Option<String>,
    pub workspace_root: Option<String>,
    pub source: String,
    pub updated_at: i64,
}

/// DATA_MODEL.md §1.3 Conversation
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub project_key: String,
    pub label: String,
    pub custom_label: Option<String>,
    #[serde(rename = "type")]
    pub conv_type: String,
    pub mode: String,
    pub parent_id: Option<String>,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
    // ConvSettings (inline)
    pub engine: Option<String>,
    pub model: Option<String>,
    pub persona: Option<String>,
    pub trigger_mode: Option<String>,
    // Usage tracking
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
}

/// DATA_MODEL.md §1.5 Message
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub status: String,
    pub progress_content: Option<String>,
    pub engine: Option<String>,
    pub model: Option<String>,
    pub persona: Option<String>,
}

/// DATA_MODEL.md §1.10 Memo
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub id: String,
    pub message_id: String,
    pub conversation_id: String,
    pub project_key: String,
    pub content: String,
    #[serde(rename = "type")]
    pub memo_type: String,
    pub tags: String,
    pub created_at: i64,
}

/// DATA_MODEL.md §1.9 Artifact
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub conversation_id: Option<String>,
    pub branch_id: Option<String>,
    pub subtask_id: Option<String>,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub title: String,
    pub content: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Plan state (DATA_MODEL §plan)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub conversation_id: String,
    pub branch_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub expected_outcome: Option<String>,
    /// "draft" | "active" | "done" | "abandoned"
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Subtask belonging to a Plan (DATA_MODEL §plan)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlanSubtask {
    pub id: String,
    pub plan_id: String,
    /// Display / execution order (0-based)
    pub idx: i64,
    pub title: String,
    pub details: Option<String>,
    /// "todo" | "in_progress" | "done" | "abandoned"
    pub status: String,
    pub outcome: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Evaluation run — a snapshot of a roundtable or agent execution for comparison
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalRun {
    pub id: String,
    pub conversation_id: String,
    pub title: String,
    pub prompt: String,
    pub mode: Option<String>,
    pub participants: Option<String>,
    pub rounds: i64,
    /// "pending" | "done" | "failed"
    pub status: String,
    pub created_at: i64,
}

/// Individual agent result within an evaluation run
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalResult {
    pub id: String,
    pub eval_run_id: String,
    pub agent_name: String,
    pub engine: String,
    pub round: i64,
    pub content: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub duration_ms: i64,
    pub created_at: i64,
}

/// DATA_MODEL.md §1.4 Branch
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub id: String,
    pub conversation_id: String,
    pub label: String,
    pub custom_label: Option<String>,
    pub status: String,
    pub checkpoint_id: Option<String>,
    pub parent_branch_id: Option<String>,
    pub session_id: Option<String>,
    pub git_branch: Option<String>,
    pub created_at: i64,
}
