//! Embedding backfill — reindex chunks whose `embedding` is NULL.
//!
//! Background: v32 migration cleared all 384dim embeddings to upgrade to bge-m3 1024dim,
//! but a bug in `index_chunks_blocking` (already_indexed lacked `IS NOT NULL`) caused
//! existing NULL chunks to be skipped forever. After Fix 1, new completions recover
//! their own conversation. This module proactively recovers ALL conversations and
//! documents at app startup, so users don't have to send a message in every old chat
//! just to restore Vector search.
//!
//! Throttling: processes one conversation/project at a time with a short sleep between
//! ONNX calls to avoid CPU spikes (s35 lesson on bge-m3 thread pressure).

use crate::db::DbState;
use crate::errors::AppError;

/// Fire-and-forget background backfill task.
/// Spawned from `setup` after embedder init. Logs progress; never propagates errors.
pub fn spawn_startup_backfill(db: DbState) {
    std::thread::spawn(move || {
        // Wait briefly for embedder/rawq to settle before starting heavy ONNX work.
        std::thread::sleep(std::time::Duration::from_secs(15));
        if let Err(e) = run_backfill(&db) {
            eprintln!("[backfill] error: {e:?}");
        }
    });
}

fn run_backfill(db: &DbState) -> Result<(), AppError> {
    if !crate::agents::embedder::is_available() {
        eprintln!("[backfill] skipped — bge-m3 embedder not available");
        return Ok(());
    }

    backfill_conversations(db);
    backfill_documents(db);
    Ok(())
}

// ─── Conversation chunks ─────────────────────────────────────────────────────

fn backfill_conversations(db: &DbState) {
    let conv_ids: Vec<String> = {
        let Ok(conn) = db.read.lock() else { return; };
        // Conversations that have at least one NULL-embedding chunk.
        // Exclude document sentinel conversations (handled separately).
        conn.prepare(
            "SELECT DISTINCT conversation_id FROM conversation_chunks
             WHERE embedding IS NULL
               AND (source_type IS NULL OR source_type = 'conversation')
             LIMIT 200",
        )
        .and_then(|mut s| {
            s.query_map([], |r| r.get::<_, String>(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default()
    };

    if conv_ids.is_empty() {
        return;
    }

    eprintln!("[backfill] {} conversations with NULL embeddings — starting recovery", conv_ids.len());

    let mut total_recovered = 0usize;
    for (i, cid) in conv_ids.iter().enumerate() {
        match super::index::index_chunks_blocking(db, cid) {
            Ok(n) if n > 0 => {
                total_recovered += n;
                eprintln!("[backfill] {}/{}: {} chunks recovered for {}",
                    i + 1, conv_ids.len(), n, &cid[..cid.len().min(12)]);
            }
            Ok(_) => {}
            Err(e) => eprintln!("[backfill] {}/{}: error for {}: {:?}",
                i + 1, conv_ids.len(), &cid[..cid.len().min(12)], e),
        }
        // Throttle: ~200ms between conversations to keep CPU sane.
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    eprintln!("[backfill] conversations done — {} chunks recovered total", total_recovered);
}

// ─── Document chunks ─────────────────────────────────────────────────────────

fn backfill_documents(db: &DbState) {
    // Gather projects that have at least one NULL-embedding document chunk.
    // Resolve each project's filesystem path via `projects` table.
    let projects: Vec<(String, String)> = {
        let Ok(conn) = db.read.lock() else { return; };
        conn.prepare(
            "SELECT DISTINCT cc.project_key, p.path
             FROM conversation_chunks cc
             JOIN projects p ON p.key = cc.project_key
             WHERE cc.source_type = 'document'
               AND cc.embedding IS NULL
               AND p.path IS NOT NULL
             LIMIT 50",
        )
        .and_then(|mut s| {
            s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default()
    };

    if projects.is_empty() {
        return;
    }

    eprintln!("[backfill] {} projects with NULL document embeddings — starting recovery", projects.len());

    for (i, (pk, path)) in projects.iter().enumerate() {
        // Wipe NULL document chunks for this project so index_project_documents'
        // SHA-skip path doesn't re-skip them (file content unchanged → skipped
        // unless chunks are missing).
        let wiped = {
            let Ok(conn) = db.write.lock() else { continue; };
            let stale_rowids: Vec<i64> = conn.prepare(
                "SELECT rowid FROM conversation_chunks
                 WHERE project_key = ?1 AND source_type = 'document' AND embedding IS NULL"
            ).and_then(|mut s| s.query_map([pk], |r| r.get(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect::<Vec<i64>>()))
                .unwrap_or_default();
            for rid in &stale_rowids {
                conn.execute("DELETE FROM vec_chunks WHERE rowid = ?1", [rid]).ok();
            }
            conn.execute(
                "DELETE FROM conversation_chunks
                 WHERE project_key = ?1 AND source_type = 'document' AND embedding IS NULL",
                [pk],
            ).ok();
            stale_rowids.len()
        };

        match crate::commands::document_index::index_project_documents(db, pk, path) {
            Ok(r) => eprintln!("[backfill] {}/{}: project={} wiped={} → {} files indexed, {} chunks",
                i + 1, projects.len(), pk, wiped, r.files_indexed, r.chunks_created),
            Err(e) => eprintln!("[backfill] {}/{}: project={} reindex error: {:?}",
                i + 1, projects.len(), pk, e),
        }
        // Per-project throttle.
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    eprintln!("[backfill] documents done");
}
