//! Deliberative (parallel) RT execution — all participants run simultaneously.

use tauri::Emitter;

use crate::db::{models::Message, DbState};
use crate::errors::AppError;
use crate::CancelRegistry;

use super::executor::{
    RtContextCache, RtVectorIndex, RtParticipantStatus, RoundtableParticipant,
    ParticipantResult, SessionMap, stream_participant, participant_identity,
};
use super::prompt::{build_round_prompt_with_identity, build_round_prompt_with_vector_context, PromptSources};
use super::persist::{persist_streaming_start, persist_streaming_done};

/// Deliberative: run all participants in parallel via tokio tasks, then persist results.
/// Each sees prior-round context but not current-round peers.
pub async fn execute_parallel(
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
    if cancel.check_and_consume(conversation_id) {
        return Err(AppError::Agent("cancelled by user".into()));
    }

    for p in participants {
        let engine_key = p.engine.as_deref().unwrap_or("claude");
        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: p.name.clone(), engine: engine_key.to_string(), model: p.model.clone(),
            round: round_num, status: "running".into(), blind: p.blind,
        });
    }

    let sources = PromptSources {
        round: round_num, total_rounds,
        mode: rt_mode.to_string(),
        prior_round_refs: prior_refs.to_vec(),
        current_round_refs: Vec::new(),
    };
    let sources_json = serde_json::to_string(&sources).unwrap_or_default();

    let has_local = participants.iter().any(|p| matches!(p.engine.as_deref(), Some("ollama" | "opencode")));
    let ctx_cache = RtContextCache::build(state, conversation_id, topic, project_path, has_local);

    let mut msg_ids: Vec<String> = Vec::with_capacity(participants.len());
    {
        let conn = state.write.lock().map_err(|_| AppError::Lock)?;
        for p in participants {
            let engine_key = p.engine.as_deref().unwrap_or("claude");
            let engine_label = match engine_key {
                "claude" => "claude-code",
                "ollama" => "ollama",
                other => other,
            };
            let streaming_msg = persist_streaming_start(
                &conn, conversation_id, &p.name, engine_label, p.model.as_deref(), &sources_json,
            )?;
            msg_ids.push(streaming_msg.id.clone());
            let _ = app.emit("roundtable:progress", &streaming_msg);
        }
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<(String, ParticipantResult)>(participants.len());
    let participant_count = participants.len();

    let transcript_owned: Vec<(String, String)> = transcript.to_vec();
    let topic_owned = topic.to_string();

    let mut vec_index = RtVectorIndex::new();
    if crate::agents::rawq::is_daemon_ready() {
        for (name, content) in transcript {
            vec_index.add(name, content);
        }
        if !vec_index.is_empty() {
            eprintln!("[rt-parallel] vector index built: {} entries", vec_index.entries_len());
        }
    }

    let vec_ctx: Vec<(String, String)> = if !vec_index.is_empty() {
        vec_index.search(&topic_owned, 5)
    } else {
        Vec::new()
    };

    for (i, p) in participants.iter().enumerate() {
        let p_clone = p.clone();
        let identity = participant_identity(p);
        let engine_key = p.engine.as_deref().unwrap_or("claude");
        let tr = transcript_owned.clone();
        let tp = topic_owned.clone();
        let vc = vec_ctx.clone();
        let mut pr = if p.blind {
            eprintln!("[rt] blind verifier: {} — no transcript (deliberative)", p.name);
            build_round_prompt_with_identity(&tp, &[], &[], Some(&identity))
        } else if !vc.is_empty() {
            eprintln!("[rt-parallel] {} using vector context: {} chunks", p.name, vc.len());
            build_round_prompt_with_vector_context(&tp, &vc, &[], Some(&identity))
        } else {
            build_round_prompt_with_identity(&tp, &tr, &[], Some(&identity))
        };
        if let Some(ctx) = ctx_cache.get(engine_key) {
            pr = format!("{}\n\n---\n\n{}", ctx, pr);
        }
        let sj = sources_json.clone();
        let pp = project_path.map(|s| s.to_string());
        let tx = tx.clone();
        let mid = msg_ids[i].clone();
        let cid = conversation_id.to_string();
        let a = app.clone();
        let ca = std::sync::Arc::clone(&cancel.0);
        let resume = session_map.get(&p.name).cloned();
        tokio::spawn(async move {
            let result = stream_participant(&p_clone, pr, sj, pp, mid.clone(), cid, a, ca, resume).await;
            let _ = tx.send((mid, result)).await;
        });
    }
    drop(tx);

    let mut messages = Vec::new();
    let mut round_responses: Vec<(String, String)> = Vec::new();
    let mut received = 0;

    while let Some((mid, r)) = rx.recv().await {
        received += 1;
        eprintln!("[rt] deliberative result {}/{}: {} ({})", received, participant_count, r.name, r.status);

        let _ = app.emit("roundtable:participant_status", RtParticipantStatus {
            conversation_id: conversation_id.to_string(),
            name: r.name.clone(), engine: r.engine.clone(), model: r.model.clone(),
            round: round_num, status: r.status.clone(), blind: r.blind,
        });

        let final_msg = {
            let conn = state.write.lock().map_err(|_| AppError::Lock)?;
            persist_streaming_done(&conn, conversation_id, &mid, &r, trace_id, root_span_id)?
        };
        let _ = app.emit("roundtable:progress", &final_msg);
        messages.push(final_msg);

        if r.status == "done" {
            if let Some(ref sid) = r.session_id {
                session_map.insert(r.name.clone(), sid.clone());
            }
            round_responses.push((r.name.clone(), r.content.clone()));
        }
    }

    Ok((messages, round_responses))
}
