#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(desktop)]
use std::env;
#[cfg(desktop)]
use std::io::{self, Write};
#[cfg(desktop)]
use std::net::{Shutdown, TcpStream};
#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::process::{Child, Command, Stdio};
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use std::thread;
#[cfg(desktop)]
use std::time::Duration;

#[cfg(all(desktop, target_os = "windows"))]
use std::os::windows::process::CommandExt;

#[cfg(desktop)]
use tauri::{AppHandle, Manager, RunEvent, State};

#[cfg(desktop)]
const BACKEND_HOST: &str = "127.0.0.1";
#[cfg(desktop)]
const BACKEND_PORT: &str = "8787";
#[cfg(desktop)]
const CHARACTER_ID_MAX_LENGTH: usize = 80;

#[cfg(desktop)]
#[derive(Default)]
struct BackendState(Mutex<Option<Child>>);

#[cfg(desktop)]
#[tauri::command]
fn open_character_directory(character_id: String) -> Result<(), String> {
    if !is_valid_character_id(&character_id) {
        return Err("无效的角色 id".to_string());
    }

    let target = data_root()?.join("characters").join(&character_id);
    if !target.is_dir() {
        return Err(format!("角色目录不存在: {}", target.display()));
    }

    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(&target);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&target);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&target);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开角色目录失败: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let builder = tauri::Builder::default()
        .manage(BackendState::default())
        .setup(|app| {
            let root = resolve_app_root(app.handle())
                .map_err(|error| io::Error::other(format!("解析应用目录失败: {error}")))?;
            let child = start_backend(&root)
                .map_err(|error| io::Error::other(format!("启动 Python 后端失败: {error}")))?;
            app.state::<BackendState>().0.lock().unwrap().replace(child);
            if let Err(error) = wait_for_backend() {
                stop_backend(app.state::<BackendState>());
                return Err(io::Error::other(error).into());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_character_directory]);

    #[cfg(mobile)]
    let builder = tauri::Builder::default();

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(desktop)]
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                stop_backend(app_handle.state::<BackendState>());
            }
        });
}

#[cfg(desktop)]
fn resolve_app_root(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法解析项目根目录".to_string());
    }

    app.path()
        .resource_dir()
        .map(|path| path.join("runtime"))
        .map_err(|error| error.to_string())
}

#[cfg(desktop)]
fn start_backend(root: &Path) -> Result<Child, String> {
    let script = root.join("web_server.py");
    if !script.is_file() {
        return Err(format!("后端入口不存在: {}", script.display()));
    }

    let mut command = if cfg!(target_os = "windows") {
        Command::new("python")
    } else if cfg!(target_os = "macos") && Path::new("/usr/bin/python3").is_file() {
        Command::new("/usr/bin/python3")
    } else {
        Command::new("python3")
    };

    command
        .arg("web_server.py")
        .current_dir(root)
        .env("AI_CHARACTER_HOST", BACKEND_HOST)
        .env("AI_CHARACTER_PORT", BACKEND_PORT)
        .env("AI_CHARACTER_APP_ROOT", root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    command.spawn().map_err(|error| error.to_string())
}

#[cfg(desktop)]
fn wait_for_backend() -> Result<(), String> {
    let address = format!("{BACKEND_HOST}:{BACKEND_PORT}");
    for _ in 0..80 {
        if TcpStream::connect_timeout(
            &address
                .parse()
                .map_err(|error| format!("解析后端地址失败: {error}"))?,
            Duration::from_millis(300),
        )
        .is_ok()
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Python 后端未能在限定时间内启动".to_string())
}

#[cfg(desktop)]
fn stop_backend(state: State<'_, BackendState>) {
    let mut child = state.0.lock().unwrap().take();
    if child.is_none() {
        return;
    }

    request_backend_shutdown();
    if let Some(ref mut process) = child {
        for _ in 0..15 {
            match process.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
        let _ = process.kill();
        let _ = process.wait();
    }
}

#[cfg(desktop)]
fn request_backend_shutdown() {
    let address = format!("{BACKEND_HOST}:{BACKEND_PORT}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &address.parse().expect("valid backend address"),
        Duration::from_millis(300),
    ) else {
        return;
    };

    let request = format!(
        "POST /api/shutdown HTTP/1.1\r\nHost: {BACKEND_HOST}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    let _ = stream.write_all(request.as_bytes());
    let _ = stream.shutdown(Shutdown::Both);
}

#[cfg(desktop)]
fn data_root() -> Result<PathBuf, String> {
    if let Ok(configured) = env::var("AI_CHARACTER_DATA_DIR") {
        let configured = configured.trim();
        if !configured.is_empty() {
            return Ok(PathBuf::from(configured));
        }
    }

    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法解析用户目录".to_string())?;
    let base = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else if cfg!(target_os = "windows") {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"))
    };
    Ok(base.join("AI Character Platform"))
}

#[cfg(desktop)]
fn is_valid_character_id(value: &str) -> bool {
    if value.len() < 2 || value.len() > CHARACTER_ID_MAX_LENGTH {
        return false;
    }
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_alphanumeric())
        && chars.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}
