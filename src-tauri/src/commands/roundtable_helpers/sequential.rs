//! Sequential RT execution — participants run one by one, each sees prior responses.

use tauri::Emitter;

use crate::db::{models::Message, DbState};
use crate::errors::AppError;
use crate::CancelRegistry;

use super::executor::{
    RtContextCache, RtVectorIndex, RtParticipantStatus, RoundtableParticipant,
    SessionMap, stream_participant, participant_identity,
};
use super::prompt::{build_round_prompt_with_identity, build_round_prompt_with_vector_context, PromptSources};
use super::persist::{persist_streaming_start, persist_streaming_done};

/// Sequential: run participants one by one. Each sees prior-round + current-round context.
pub async fn execute_sequential(
    participants: &[RoundtableParticipant],
    transcript: &[(String, String)],
    prior_refs: &[String],
    round_num: u32, total_rounds: u32,
    topic: &str, rt_mode: &str,
    conversation_id: &str, state: &DbState, app: &tauri::AppHandle,
    cancel: &CancelRegistry, trace_id: &str, root_span_id: &str,
    project_path: Option<&str>,
    session_map: &mut SessionMap,
) -> Result<(Vec<Message>, Vec<(String, String)>), AppError> {
    let mut messages = Vec::new();
    let mut round_responses: Vec<(String, String)> = Vec::new();

    let has_local = participants.iter().any(|p| matches!(p.engine.as_deref(), Some("ollama" | "opencode")));
    let ctx_cache = RtContextCache::build(state, conversation_id, topic, project_path, has_local);

    let mut vec_index = RtVectorIndex::new();
    if crate::agents::rawq::is_daemon_ready() {
        for (name, content) in transcript {
            vec_index.add(name, content);
        }
        if !vec_index.is_empty() {
            eprintln!("[rt] vector index built: {} entries from prior transcript", vec_index.entries_len());
        }
    }

    for p in participants {
        if cancel.check_and_consume(conversation_id) {
            return Err(AppError::Agent("cancelled by user".into()));
        }

        let sources = PromptSources {
            round: round_num, total_rounds,
            mode: rt_mode.to_string(),
            prior_round_refs: prior_refs.to_vec(),
            current_round_refs: round_responses.iter().map(|(n, _)| n.clone()).collect(),
        };
        let sources_json = serde_json::to_string(&sources).unwrap_or_default();

        let engine_key = p.engine.as_deref().unwrap_or("claude");
        let engine_label = match engine_key {
            "claude" => "claude-code",
            "ollama" => "ollama",
            other => other,
        };

        let streaming_msg = {
            let conn = state.write.lock().map_err(|_| AppError::Lock)?;
            persist_streaming_start(&conn, conversation_id, &p.name, engine_label, p.model.as_deref(), &sources_json)?
        };
        let msg_id = streaming_msg.id.clone();
        let _ = app.emit("roundtable:progress", &streaming_msg);

        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: p.name.clone(), engine: engine_key.to_string(), model: p.model.clone(),
            round: round_num, status: "running".into(), blind: p.blind,
        });

        let identity = participant_identity(p);
        let mut prompt = if p.blind {
            eprintln!("[rt] blind verifier: {} — no transcript", p.name);
            build_round_prompt_with_identity(topic, &[], &[], Some(&identity))
        } else if !vec_index.is_empty() {
            let vec_ctx = vec_index.search(topic, 5);
            eprintln!("[rt] {} using vector context: {} chunks (vs {} full transcript)", p.name, vec_ctx.len(), transcript.len());
            build_round_prompt_with_vector_context(topic, &vec_ctx, &round_responses, Some(&identity))
        } else {
            build_round_prompt_with_identity(topic, transcript, &round_responses, Some(&identity))
        };
        if let Some(ctx) = ctx_cache.get(engine_key) {
            prompt = format!("{}\n\n---\n\n{}", ctx, prompt);
        }
        let resume = session_map.get(&p.name).cloned();
        let r = stream_participant(
            p, prompt, sources_json, project_path.map(|s| s.to_string()),
            msg_id.clone(), conversation_id.to_string(), app.clone(), std::sync::Arc::clone(&cancel.0),
            resume,
        ).await;

        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: r.name.clone(), engine: r.engine.clone(), model: r.model.clone(),
            round: round_num, status: r.status.clone(), blind: r.blind,
        });

        if let Some(ref sid) = r.session_id {
            session_map.insert(p.name.clone(), sid.clone());
        }

        let final_msg = {
            let conn = state.write.lock().map_err(|_| AppError::Lock)?;
            persist_streaming_done(&conn, conversation_id, &msg_id, &r, trace_id, root_span_id)?
        };
        let _ = app.emit("roundtable:progress", &final_msg);
        messages.push(final_msg);

        if r.status == "done" {
            if crate::agents::rawq::is_daemon_ready() {
                vec_index.add(&r.name, &r.content);
            }
            round_responses.push((r.name.clone(), r.content.clone()));
        }
    }

    Ok((messages, round_responses))
}
