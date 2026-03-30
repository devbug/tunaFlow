use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::agents::{claude, codex, gemini, opencode};
use crate::db::{migrations::now_epoch_ms, DbState};
use crate::errors::AppError;
use crate::guardrail;

use super::agents_helpers::context_pack::assemble_system_prompt;
use super::agents_helpers::trace_log::{insert_trace_log_with_context, new_span_id, new_trace_id, SpanInfo};
use super::jobs;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkPayload {
    pub message_id: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendWithClaudeInput {
    pub project_key: String,
    pub conversation_id: String,
    pub user_message_id: Option<String>,
    pub prompt: String,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub agent_name: Option<String>,
    #[serde(default)]
    pub active_skills: Vec<String>,
    #[serde(default)]
    pub cross_session_ids: Vec<String>,
    #[serde(default)]
    pub persona_fragment: Option<String>,
    #[serde(default)]
    pub persona_label: Option<String>,
    /// Context mode override: "lite", "standard", "full", or null (auto)
    #[serde(default)]
    pub context_mode_override: Option<String>,
    /// Total context budget cap override (chars). null = use default (60000)
    #[serde(default)]
    pub context_budget_cap: Option<usize>,
}

/// Wrap persona_fragment with identity framing block for a given engine.
fn identity_fragment(input: &SendWithClaudeInput, engine: &str) -> Option<String> {
    super::agents_helpers::send_common::build_identity_persona_fragment(
        input.persona_label.as_deref(),
        engine,
        input.persona_fragment.as_deref(),
    )
}

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// Background / event-driven start_* commands (Phase 1)
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunResult { pub message_id: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDonePayload { pub message_id: String, pub conversation_id: String, pub engine: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorPayload { pub message_id: String, pub conversation_id: String, pub engine: String, pub error: String }

/// Background Claude stream — returns immediately, subprocess runs in background.
#[tauri::command]
pub fn start_claude_stream(
    input: SendWithClaudeInput, app: AppHandle,
    state: State<DbState>, cancel: State<crate::CancelRegistry>,
) -> Result<StartRunResult, AppError> {
    use super::agents_helpers::send_common::*;
    let id_frag = identity_fragment(&input, "claude-code");
    let (resume_token, project_path, msg_id, system_prompt, ctx_meta) = {
        let conn = state.write.lock().map_err(|_| AppError::Lock)?;
        persist_user_message(&conn, &input.conversation_id, &input.prompt, &input.user_message_id)?;
        let pp = load_project_path(&conn, &input.project_key);

        // Unified context assembly — same pipeline as all other engines
        let (_, sys_ctx, meta) = build_normalized_prompt_with_budget(
            &conn, &input.conversation_id, &input.prompt, pp.as_deref(),
            &input.active_skills, &input.cross_session_ids, id_frag.as_deref(),
            input.context_mode_override.as_deref(), input.context_budget_cap,
        );

        // Claude-specific: agent loader prompt + custom system_prompt (appended to normalized context)
        let agent_sp = assemble_system_prompt(
            input.agent_name.as_deref(), pp.as_deref(), input.system_prompt.as_deref(),
        );
        let system_prompt = match (sys_ctx, agent_sp) {
            (Some(c), Some(a)) => Some(format!("{}\n\n{}", c, a)),
            (c @ Some(_), None) => c,
            (None, a @ Some(_)) => a,
            (None, None) => None,
        };

        // Pre-create streaming assistant message
        let mid = Uuid::new_v4().to_string();
        let now = now_epoch_ms();
        conn.execute(
            "INSERT INTO messages(id,conversation_id,role,content,timestamp,status,engine,model,persona)\
             VALUES(?1,?2,'assistant','',?3,'streaming','claude-code',?4,?5)",
            params![mid, input.conversation_id, now, input.model, input.persona_label],
        )?;

        // Load stored resume token; discard if engine differs
        let rt = conn.query_row(
            "SELECT resume_token, resume_token_engine FROM conversations WHERE id=?1",
            [&input.conversation_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
        ).ok().and_then(|(t, e)| if e.as_deref() == Some("claude-code") { t } else { None });

        (rt, pp, mid, system_prompt, meta)
    };

    // Create durable job record
    let job_id = format!("job-{}", Uuid::new_v4());
    {
        let conn = state.write.lock().map_err(|_| AppError::Lock)?;
        let _ = jobs::create_job(&conn, &job_id, &input.conversation_id, Some(&msg_id), "claude-code", "agent");
    }

    let carc = std::sync::Arc::clone(&cancel.0);
    let write_arc = std::sync::Arc::clone(&state.write);
    let ab = app;
    let ret = msg_id.clone();
    let jid = job_id;
    let cid = input.conversation_id;
    let pr = input.prompt;
    let mo = input.model;
    let plen = pr.len() + system_prompt.as_ref().map_or(0, |s| s.len());
    std::thread::spawn(move || {
        let pa = ab.clone(); let pi = msg_id.clone();
        let c2 = ab.clone(); let ci = msg_id.clone();
        let t0 = std::time::Instant::now();
        let rr = claude::stream_run(
            claude::RunInput { prompt: pr, model: mo.clone(), system_prompt, resume_token, project_path },
            move |t| { let _ = pa.emit("claude:progress", ChunkPayload { message_id: pi.clone(), text: t }); },
            move |t| { let _ = c2.emit("claude:chunk", ChunkPayload { message_id: ci.clone(), text: t }); },
            { let c = cid.clone(); let r = carc; move || { if let Ok(mut s) = r.lock() { s.remove(&c) } else { false } } },
        );
        let dur = t0.elapsed().as_millis();
        guardrail::log_run("claude-bg", mo.as_deref(), dur, plen, rr.is_ok());
        if let Ok(conn) = write_arc.lock() {
            let now = now_epoch_ms();
            match rr {
                Ok(out) => {
                    let _ = conn.execute("UPDATE messages SET content=?1,status='done',timestamp=?2 WHERE id=?3", params![out.content, now, msg_id]);
                    let _ = conn.execute(
                        "UPDATE conversations SET total_input_tokens=total_input_tokens+?1,total_output_tokens=total_output_tokens+?2,\
                         total_cost_usd=total_cost_usd+?3,updated_at=?4,resume_token=?5,\
                         resume_token_engine=CASE WHEN ?5 IS NOT NULL THEN 'claude-code' ELSE resume_token_engine END WHERE id=?6",
                        params![out.input_tokens, out.output_tokens, out.cost_usd, now / 1000, out.session_id, cid],
                    );
                    insert_trace_log_with_context(&conn, &cid, out.input_tokens, out.output_tokens, out.cost_usd, now,
                        &SpanInfo { trace_id: &new_trace_id(), span_id: new_span_id(), parent_span_id: None,
                            operation: "agent.stream", engine: "claude-code", duration_ms: dur as i64, status: "ok" },
                        &ctx_meta);
                    let _ = jobs::complete_job(&conn, &jid, "done", None);
                    let _ = ab.emit("agent:completed", AgentDonePayload { message_id: msg_id, conversation_id: cid, engine: "claude-code".into() });
                }
                Err(ref e) => {
                    let em = guardrail::fallback_error("claude-code", e);
                    let _ = conn.execute("UPDATE messages SET content=?1,status='error',timestamp=?2 WHERE id=?3", params![em, now, msg_id]);
                    let _ = jobs::complete_job(&conn, &jid, "error", Some(&em));
                    let _ = ab.emit("agent:error", AgentErrorPayload { message_id: msg_id, conversation_id: cid, engine: "claude-code".into(), error: em });
                }
            }
        }
    });
    Ok(StartRunResult { message_id: ret })
}

/// Background Gemini stream — returns immediately.
#[tauri::command]
pub fn start_gemini_stream(input:SendWithClaudeInput,app:AppHandle,state:State<DbState>,cancel:State<crate::CancelRegistry>)->Result<StartRunResult,AppError>{
    use super::agents_helpers::send_common::*;
    let id_frag=identity_fragment(&input,"gemini");
    let(ep,pp,mid,ep_meta)={let conn=state.write.lock().map_err(|_|AppError::Lock)?;
        persist_user_message(&conn,&input.conversation_id,&input.prompt,&input.user_message_id)?;
        let pp=load_project_path(&conn,&input.project_key);let (ep,_,ep_meta)=build_normalized_prompt_with_budget(&conn,&input.conversation_id,&input.prompt,pp.as_deref(),&input.active_skills,&input.cross_session_ids,id_frag.as_deref(),input.context_mode_override.as_deref(),input.context_budget_cap);
        let mid=format!("msg-{}",Uuid::new_v4());let now=now_epoch_ms();
        conn.execute("INSERT INTO messages(id,conversation_id,role,content,timestamp,status,engine,model,persona)VALUES(?1,?2,'assistant','',?3,'streaming','gemini',?4,?5)",params![mid,input.conversation_id,now,input.model,input.persona_label])?;
        (ep,pp,mid,ep_meta)};
    let jid=format!("job-{}",Uuid::new_v4());
    {let conn=state.write.lock().map_err(|_|AppError::Lock)?;let _=jobs::create_job(&conn,&jid,&input.conversation_id,Some(&mid),"gemini","agent");}
    let ca=std::sync::Arc::clone(&cancel.0);let write_arc=std::sync::Arc::clone(&state.write);
    let ab=app;let r=mid.clone();let cid=input.conversation_id;let m=input.model;
    std::thread::spawn(move||{
        let pa=ab.clone();let pi=mid.clone();let c2=ab.clone();let ci=mid.clone();
        let t0=std::time::Instant::now();
        let rr=gemini::stream_run(claude::RunInput{prompt:ep,model:m.clone(),system_prompt:None,resume_token:None,project_path:pp},
            move|t|{let _=pa.emit("gemini:progress",ChunkPayload{message_id:pi.clone(),text:t});},
            move|t|{let _=c2.emit("gemini:chunk",ChunkPayload{message_id:ci.clone(),text:t});},
            {let c=cid.clone();let r=ca;move||{if let Ok(mut s)=r.lock(){s.remove(&c)}else{false}}});
        let _dur=t0.elapsed().as_millis();
        if let Ok(conn)=write_arc.lock(){let now=now_epoch_ms();match rr{
            Ok(out)=>{let c=if out.content.is_empty(){"(gemini returned no output)".into()}else{out.content};
                let _=conn.execute("UPDATE messages SET content=?1,status='done',timestamp=?2 WHERE id=?3",params![c,now,mid]);
                let _=conn.execute("UPDATE conversations SET total_input_tokens=total_input_tokens+?1,total_output_tokens=total_output_tokens+?2,updated_at=?3 WHERE id=?4",params![out.input_tokens,out.output_tokens,now/1000,cid]);
                insert_trace_log_with_context(&conn,&cid,out.input_tokens,out.output_tokens,out.cost_usd,now,&SpanInfo{trace_id:&new_trace_id(),span_id:new_span_id(),parent_span_id:None,operation:"agent.stream",engine:"gemini",duration_ms:_dur as i64,status:"ok"},&ep_meta);
                let _=jobs::complete_job(&conn,&jid,"done",None);
                let _=ab.emit("agent:completed",AgentDonePayload{message_id:mid,conversation_id:cid,engine:"gemini".into()});}
            Err(ref e)=>{let em=guardrail::fallback_error("gemini",e);
                let _=conn.execute("UPDATE messages SET content=?1,status='error',timestamp=?2 WHERE id=?3",params![em,now,mid]);
                let _=jobs::complete_job(&conn,&jid,"error",Some(&em));
                let _=ab.emit("agent:error",AgentErrorPayload{message_id:mid,conversation_id:cid,engine:"gemini".into(),error:em});}
        }}
    });
    Ok(StartRunResult{message_id:r})
}

/// Background Codex run — returns immediately.
#[tauri::command]
pub fn start_codex_run(input:SendWithClaudeInput,app:AppHandle,state:State<DbState>)->Result<StartRunResult,AppError>{
    use super::agents_helpers::send_common::*;
    let id_frag=identity_fragment(&input,"codex");
    let(ep,pp,mid,ep_meta)={let conn=state.write.lock().map_err(|_|AppError::Lock)?;
        persist_user_message(&conn,&input.conversation_id,&input.prompt,&input.user_message_id)?;
        let pp=load_project_path(&conn,&input.project_key);let (ep,_,ep_meta)=build_normalized_prompt_with_budget(&conn,&input.conversation_id,&input.prompt,pp.as_deref(),&input.active_skills,&input.cross_session_ids,id_frag.as_deref(),input.context_mode_override.as_deref(),input.context_budget_cap);
        let mid=format!("msg-{}",Uuid::new_v4());let now=now_epoch_ms();
        conn.execute("INSERT INTO messages(id,conversation_id,role,content,timestamp,status,engine,model,persona)VALUES(?1,?2,'assistant','',?3,'streaming','codex',?4,?5)",params![mid,input.conversation_id,now,input.model,input.persona_label])?;
        (ep,pp,mid,ep_meta)};
    let jid=format!("job-{}",Uuid::new_v4());
    {let conn=state.write.lock().map_err(|_|AppError::Lock)?;let _=jobs::create_job(&conn,&jid,&input.conversation_id,Some(&mid),"codex","agent");}
    let write_arc=std::sync::Arc::clone(&state.write);
    let ab=app;let r=mid.clone();let cid=input.conversation_id;
    std::thread::spawn(move||{
        let chunk_mid=mid.clone();let chunk_app=ab.clone();
        let progress_mid=mid.clone();let progress_app=ab.clone();
        let t0=std::time::Instant::now();
        let rr=codex::stream_run(
            claude::RunInput{prompt:ep,model:input.model.clone(),system_prompt:None,resume_token:None,project_path:pp},
            |event_type|{let _=progress_app.emit("codex:progress",ChunkPayload{message_id:progress_mid.clone(),text:format!("codex: {}",event_type)});},
            |accumulated|{let _=chunk_app.emit("codex:chunk",ChunkPayload{message_id:chunk_mid.clone(),text:accumulated.to_string()});},
        );
        let dur=t0.elapsed().as_millis();
        if let Ok(conn)=write_arc.lock(){let now=now_epoch_ms();match rr{
            Ok(out)=>{let c=if out.content.is_empty(){"(codex returned no output)".into()}else{out.content};
                let _=conn.execute("UPDATE messages SET content=?1,status='done',timestamp=?2 WHERE id=?3",params![c,now,mid]);
                let _=conn.execute("UPDATE conversations SET total_input_tokens=total_input_tokens+?1,total_output_tokens=total_output_tokens+?2,total_cost_usd=total_cost_usd+?3,updated_at=?4 WHERE id=?5",params![out.input_tokens,out.output_tokens,out.cost_usd,now/1000,cid]);
                insert_trace_log_with_context(&conn,&cid,out.input_tokens,out.output_tokens,out.cost_usd,now,&SpanInfo{trace_id:&new_trace_id(),span_id:new_span_id(),parent_span_id:None,operation:"agent.stream",engine:"codex",duration_ms:dur as i64,status:"ok"},&ep_meta);
                let _=jobs::complete_job(&conn,&jid,"done",None);
                let _=ab.emit("agent:completed",AgentDonePayload{message_id:mid,conversation_id:cid,engine:"codex".into()});}
            Err(ref e)=>{let em=guardrail::fallback_error("codex",e);
                let _=conn.execute("UPDATE messages SET content=?1,status='error',timestamp=?2 WHERE id=?3",params![em,now,mid]);
                let _=jobs::complete_job(&conn,&jid,"error",Some(&em));
                let _=ab.emit("agent:error",AgentErrorPayload{message_id:mid,conversation_id:cid,engine:"codex".into(),error:em});}
        }}
    });
    Ok(StartRunResult{message_id:r})
}

/// Eval-only: run a prompt through an engine synchronously, return content only.
/// Does NOT persist to conversations/messages — result goes to eval_results instead.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalAgentResult {
    pub content: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub duration_ms: i64,
}

#[tauri::command]
pub fn run_eval_agent(
    engine: String,
    prompt: String,
    model: Option<String>,
    project_path: Option<String>,
) -> Result<EvalAgentResult, AppError> {
    let t0 = std::time::Instant::now();

    let run_input = claude::RunInput {
        prompt: prompt.clone(),
        model: model.clone(),
        system_prompt: None,
        resume_token: None,
        project_path: project_path.clone(),
    };

    let result = match engine.as_str() {
        "codex" => codex::run(run_input),
        "gemini" => gemini::run(run_input),
        "opencode" => opencode::run(run_input),
        _ => claude::run(run_input), // default to claude
    };

    let duration_ms = t0.elapsed().as_millis() as i64;

    match result {
        Ok(out) => Ok(EvalAgentResult {
            content: if out.content.is_empty() { "(no output)".into() } else { out.content },
            input_tokens: out.input_tokens,
            output_tokens: out.output_tokens,
            cost_usd: out.cost_usd,
            duration_ms,
        }),
        Err(e) => Err(AppError::Agent(format!("{} eval failed: {}", engine, e))),
    }
}

/// Background OpenCode run — returns immediately.
#[tauri::command]
pub fn start_opencode_run(input:SendWithClaudeInput,app:AppHandle,state:State<DbState>)->Result<StartRunResult,AppError>{
    use super::agents_helpers::send_common::*;
    let id_frag=identity_fragment(&input,"opencode");
    let(ep,pp,mid,ep_meta)={let conn=state.write.lock().map_err(|_|AppError::Lock)?;
        persist_user_message(&conn,&input.conversation_id,&input.prompt,&input.user_message_id)?;
        let pp=load_project_path(&conn,&input.project_key);let (ep,_,ep_meta)=build_normalized_prompt_with_budget(&conn,&input.conversation_id,&input.prompt,pp.as_deref(),&input.active_skills,&input.cross_session_ids,id_frag.as_deref(),input.context_mode_override.as_deref(),input.context_budget_cap);
        let mid=format!("msg-{}",Uuid::new_v4());let now=now_epoch_ms();
        conn.execute("INSERT INTO messages(id,conversation_id,role,content,timestamp,status,engine,model,persona)VALUES(?1,?2,'assistant','',?3,'streaming','opencode',?4,?5)",params![mid,input.conversation_id,now,input.model,input.persona_label])?;
        (ep,pp,mid,ep_meta)};
    let jid=format!("job-{}",Uuid::new_v4());
    {let conn=state.write.lock().map_err(|_|AppError::Lock)?;let _=jobs::create_job(&conn,&jid,&input.conversation_id,Some(&mid),"opencode","agent");}
    let write_arc=std::sync::Arc::clone(&state.write);
    let ab=app;let r=mid.clone();let cid=input.conversation_id;
    std::thread::spawn(move||{
        let _=ab.emit("opencode:progress",ChunkPayload{message_id:mid.clone(),text:"OpenCode starting...".into()});
        let t0=std::time::Instant::now();
        let rr=opencode::run(claude::RunInput{prompt:ep,model:input.model.clone(),system_prompt:None,resume_token:None,project_path:pp});
        let dur=t0.elapsed().as_millis();
        if let Ok(conn)=write_arc.lock(){let now=now_epoch_ms();match rr{
            Ok(out)=>{let c=if out.content.is_empty(){"(opencode returned no output)".into()}else{out.content};
                let _=conn.execute("UPDATE messages SET content=?1,status='done',timestamp=?2 WHERE id=?3",params![c,now,mid]);
                let _=conn.execute("UPDATE conversations SET total_input_tokens=total_input_tokens+?1,total_output_tokens=total_output_tokens+?2,updated_at=?3 WHERE id=?4",params![out.input_tokens,out.output_tokens,now/1000,cid]);
                insert_trace_log_with_context(&conn,&cid,out.input_tokens,out.output_tokens,out.cost_usd,now,&SpanInfo{trace_id:&new_trace_id(),span_id:new_span_id(),parent_span_id:None,operation:"agent.run",engine:"opencode",duration_ms:dur as i64,status:"ok"},&ep_meta);
                let _=jobs::complete_job(&conn,&jid,"done",None);
                let _=ab.emit("agent:completed",AgentDonePayload{message_id:mid,conversation_id:cid,engine:"opencode".into()});}
            Err(ref e)=>{let em=guardrail::fallback_error("opencode",e);
                let _=conn.execute("UPDATE messages SET content=?1,status='error',timestamp=?2 WHERE id=?3",params![em,now,mid]);
                let _=jobs::complete_job(&conn,&jid,"error",Some(&em));
                let _=ab.emit("agent:error",AgentErrorPayload{message_id:mid,conversation_id:cid,engine:"opencode".into(),error:em});}
        }}
    });
    Ok(StartRunResult{message_id:r})
}
