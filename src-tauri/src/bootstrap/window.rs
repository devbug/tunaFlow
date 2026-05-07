//! Main window restoration logic — logs what `tauri-plugin-window-state`
//! actually restored and centres the window when no saved position exists.

use tauri::Manager;

/// Log the window position/size that the window-state plugin restored, then
/// centre on the primary monitor when no saved position was found.
pub fn restore_window_state(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    // 2026-05-07 — issue #264 v0.1.7-beta-5 hotfix: capabilities (PR #269) +
    // CSP IPC (PR #272) + drag-region 격리 (PR #269) 모두 적용된 후 `WindowControls`
    // 의 click 이 정상 동작하므로, 다시 native chrome 을 제거해 PR #237 의
    // mac parity *"1 라인 통합"* UX 회복. Gemini code review (PR #269 #2) 가
    // 지적한 native + custom 중복 (architect dev sh02 검증) 도 동시 해소.
    //
    // 안전망: capabilities/CSP 어느 쪽이 다시 깨져도 사용자는 set_decorations(true)
    // 로 native chrome 복원 가능 (Settings or 코드 revert). devtools 도 release
    // 에서 활성됐으니 진단 가능.
    #[cfg(target_os = "windows")]
    {
        if let Err(e) = window.set_decorations(false) {
            eprintln!("[bootstrap/window] set_decorations(false) failed: {}", e);
        }
    }

    // window-state plugin restores position/size BEFORE setup runs.
    // Log actual state to diagnose restoration issues.
    let pos = window.outer_position().unwrap_or_default();
    let size = window.outer_size().unwrap_or_default();
    let scale = window.scale_factor().unwrap_or(1.0);
    eprintln!(
        "[bootstrap/window] restored: pos=({},{}) size={}x{} scale={:.1}",
        pos.x, pos.y, size.width, size.height, scale
    );

    // Only center if position is clearly unset (0,0).
    if pos.x == 0 && pos.y == 0 {
        eprintln!("[bootstrap/window] no saved position — centering on primary monitor");
        if let Some(monitor) = window.primary_monitor().ok().flatten() {
            let screen = monitor.size();
            let mon_pos = monitor.position();
            let win_w = 1200.0;
            let win_h = 800.0;
            let x = mon_pos.x as f64 + (screen.width as f64 / scale - win_w) / 2.0;
            let y = mon_pos.y as f64 + (screen.height as f64 / scale - win_h) / 2.0;
            let _ = window.set_position(tauri::PhysicalPosition::new(
                (x * scale) as i32,
                (y * scale) as i32,
            ));
        }
    }
    let _ = window.show();

    Ok(())
}
