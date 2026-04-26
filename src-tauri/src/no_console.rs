//! Windows console window suppression for subprocess spawns.
//!
//! Rust 의 `std::process::Command` 와 `tokio::process::Command` 는 Windows 에서
//! `CREATE_NO_WINDOW` flag 없이 spawn 시 새 console window 를 띄운다. tunaFlow
//! 처럼 매 user action 마다 CLI subprocess (`claude` / `codex` / `gemini` / 모델
//! discovery / project tool 등) 를 spawn 하는 GUI 앱에선 *cmd 창이 깜박깜박*
//! 보이게 되는 사용자 가시 문제 발생 (Windows 한정).
//!
//! 본 trait 은 macOS / Linux 에선 no-op, Windows 에선 `creation_flags(0x08000000)`
//! 적용해 console window 생성을 차단한다. 모든 `Command::new(...)` 호출 직후
//! `.no_console()` chain 호출이 invariant — 새 spawn 추가 시 지킬 것.

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub trait NoConsole {
    fn no_console(&mut self) -> &mut Self;
}

impl NoConsole for std::process::Command {
    #[cfg(windows)]
    fn no_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }
    #[cfg(not(windows))]
    fn no_console(&mut self) -> &mut Self {
        self
    }
}

impl NoConsole for tokio::process::Command {
    #[cfg(windows)]
    fn no_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }
    #[cfg(not(windows))]
    fn no_console(&mut self) -> &mut Self {
        self
    }
}
