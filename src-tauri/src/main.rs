#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
#[cfg(windows)]
use std::path::PathBuf;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Default)]
struct PingProcess {
    child: Mutex<Option<(u64, Child)>>,
    next_id: AtomicU64,
}

#[derive(Clone, Serialize)]
struct PingOutput {
    chunk: String,
    done: bool,
}

fn validate_target(target: &str) -> Result<(), String> {
    let mut characters = target.chars();
    let first = characters.next().ok_or_else(|| "请输入要 Ping 的主机名或 IP 地址".to_string())?;
    if target.len() > 253
        || !(first.is_ascii_alphanumeric() || first == ':')
        || !characters.all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | ':' | '%' | '_' | '-'))
    {
        return Err("请输入有效的主机名或 IP 地址（不支持空格和命令参数）".into());
    }
    Ok(())
}

fn decode_ping_output(bytes: &[u8]) -> String {
    #[cfg(windows)]
    { encoding_rs::GBK.decode(bytes).0.into_owned() }
    #[cfg(not(windows))]
    { String::from_utf8_lossy(bytes).into_owned() }
}

fn stream_ping_output<R: Read>(reader: R, channel: Channel<PingOutput>) {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) => { let _ = channel.send(PingOutput { chunk: decode_ping_output(&line), done: false }); }
            Err(error) => {
                let _ = channel.send(PingOutput { chunk: format!("\n读取 Ping 输出失败：{error}\n"), done: false });
                break;
            }
        }
    }
}

#[tauri::command]
fn start_ping(
    target: String,
    count: u32,
    continuous: bool,
    on_output: Channel<PingOutput>,
    state: State<'_, Arc<PingProcess>>,
) -> Result<(), String> {
    let target = target.trim();
    validate_target(target)?;
    if !continuous && !(1..=100).contains(&count) {
        return Err("Ping 次数应为 1–100 的整数".into());
    }

    #[cfg(windows)]
    let mut command = Command::new(
        std::env::var_os("SystemRoot")
            .map(|root| PathBuf::from(root).join("System32").join("ping.exe"))
            .ok_or_else(|| "无法确定 Windows 系统目录，未启动 Ping".to_string())?,
    );
    #[cfg(not(windows))]
    let mut command = Command::new("ping");

    let count = count.to_string();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        if continuous { command.args(["-t", target]); }
        else { command.args(["-n", count.as_str(), "-w", "1000", target]); }
    }
    #[cfg(not(windows))]
    if continuous { command.args(["-i", "1", target]); }
    else { command.args(["-c", count.as_str(), "-W", "1", target]); }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut active = state.child.lock().map_err(|_| "Ping 状态不可用".to_string())?;
    if active.is_some() { return Err("已有 Ping 进程正在运行".into()); }
    let mut child = command.spawn().map_err(|error| format!("无法启动本机 ping：{error}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "无法读取 Ping 输出".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "无法读取 Ping 错误输出".to_string())?;
    let run_id = state.next_id.fetch_add(1, Ordering::Relaxed);
    *active = Some((run_id, child));
    drop(active);

    let stdout_channel = on_output.clone();
    let stdout_reader = thread::spawn(move || stream_ping_output(stdout, stdout_channel));
    let stderr_channel = on_output.clone();
    let stderr_reader = thread::spawn(move || stream_ping_output(stderr, stderr_channel));

    let process = state.inner().clone();
    thread::spawn(move || loop {
        let finished = {
            let Ok(mut active) = process.child.lock() else {
                break;
            };
            match active.as_mut() {
                Some((active_id, child)) if *active_id == run_id => match child.try_wait() {
                    Ok(Some(_)) => { active.take(); Some(String::new()) }
                    Ok(None) => None,
                    Err(error) => { active.take(); Some(format!("\n读取 Ping 进程状态失败：{error}\n")) }
                },
                _ => break,
            }
        };
        if let Some(chunk) = finished {
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = on_output.send(PingOutput { chunk, done: true });
            break;
        }
        thread::sleep(Duration::from_millis(100));
    });

    Ok(())
}

#[tauri::command]
fn stop_ping(state: State<'_, Arc<PingProcess>>) -> Result<(), String> {
    let mut active = state.child.lock().map_err(|_| "Ping 状态不可用".to_string())?;
    if let Some((_, child)) = active.as_mut() {
        let _ = child.kill();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(PingProcess::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![start_ping, stop_ping])
        .run(tauri::generate_context!())
        .expect("failed to run 实用工具箱");
}
