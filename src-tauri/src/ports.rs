use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortUsage {
    pub protocol: String,
    pub local_address: String,
    pub port: u16,
    pub state: String,
    pub pid: u32,
    pub process_name: String,
    pub process_path: Option<String>,
    pub process_started_at_ticks: Option<String>,
}

#[cfg(windows)]
const LIST_PORTS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$requestedPort = [int]$env:DEV_TOOLKIT_PORT
function Get-OwnerInfo([int]$ownerProcessId) {
  $name = if ($ownerProcessId -eq 0) { 'System Idle' } else { '未知进程' }
  $path = $null
  $started = $null
  try {
    $process = Get-Process -Id $ownerProcessId -ErrorAction Stop
    $name = $process.ProcessName
    try { $path = $process.Path } catch { }
    try { $started = $process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) } catch { }
  } catch { }
  return [pscustomobject]@{ processName = $name; processPath = $path; processStartedAtTicks = $started }
}
$results = [System.Collections.Generic.List[object]]::new()
foreach ($connection in @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.LocalPort -eq $requestedPort })) {
  $owner = Get-OwnerInfo ([int]$connection.OwningProcess)
  $results.Add([pscustomobject]@{ protocol = 'TCP'; localAddress = [string]$connection.LocalAddress; port = [int]$connection.LocalPort; state = [string]$connection.State; pid = [uint32]$connection.OwningProcess; processName = $owner.processName; processPath = $owner.processPath; processStartedAtTicks = $owner.processStartedAtTicks })
}
foreach ($endpoint in @(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object { $_.LocalPort -eq $requestedPort })) {
  $owner = Get-OwnerInfo ([int]$endpoint.OwningProcess)
  $results.Add([pscustomobject]@{ protocol = 'UDP'; localAddress = [string]$endpoint.LocalAddress; port = [int]$endpoint.LocalPort; state = 'Bound'; pid = [uint32]$endpoint.OwningProcess; processName = $owner.processName; processPath = $owner.processPath; processStartedAtTicks = $owner.processStartedAtTicks })
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject ([pscustomobject]@{ results = $results }) -Depth 3 -Compress))
"#;

#[cfg(windows)]
const TERMINATE_PROCESS_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $ownerProcessId = [int]$env:DEV_TOOLKIT_PROCESS_ID
  $process = Get-Process -Id $ownerProcessId -ErrorAction Stop
  $currentPath = $process.Path
  $currentStarted = $process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
  if ($process.ProcessName -ine $env:DEV_TOOLKIT_EXPECTED_NAME -or $currentPath -ine $env:DEV_TOOLKIT_EXPECTED_PATH -or $currentStarted -cne $env:DEV_TOOLKIT_EXPECTED_STARTED) {
    throw '进程身份已变化，请重新查询后再操作。'
  }
  $process.Kill()
  if (-not $process.WaitForExit(5000)) { throw '进程已收到结束请求，但未能在 5 秒内退出。' }
  [Console]::Out.WriteLine('{"stopped":true}')
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
"#;

#[cfg(windows)]
fn powershell_path() -> Result<std::path::PathBuf, String> {
    use std::path::PathBuf;
    let root = std::env::var_os("SystemRoot").ok_or_else(|| "无法确定 Windows 系统目录".to_string())?;
    Ok(PathBuf::from(root).join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe"))
}

#[cfg(windows)]
fn run_powershell(script: &str, environment: &[(&str, String)]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let mut command = std::process::Command::new(powershell_path()?);
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]);
    command.creation_flags(0x08000000);
    for (name, value) in environment {
        command.env(name, value);
    }
    let output = command.output().map_err(|error| format!("无法启动本机进程查询：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { "本机进程查询失败".into() } else { detail });
    }
    String::from_utf8(output.stdout).map_err(|_| "系统进程信息不是有效 UTF-8".into())
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortQueryResult {
    results: Vec<PortUsage>,
}

#[tauri::command]
pub async fn find_port_usage(port: u16) -> Result<Vec<PortUsage>, String> {
    if port == 0 {
        return Err("端口号必须在 1–65535 之间".into());
    }
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            let stdout = run_powershell(LIST_PORTS_SCRIPT, &[("DEV_TOOLKIT_PORT", port.to_string())])?;
            let response: PortQueryResult = serde_json::from_str(&stdout).map_err(|error| format!("无法解析系统端口信息：{error}"))?;
            Ok(response.results)
        }).await.map_err(|error| format!("端口查询任务失败：{error}"))?;
    }
    #[cfg(not(windows))]
    { let _ = port; Err("端口进程查询当前仅支持 Windows 桌面端".into()) }
}

#[tauri::command]
pub async fn terminate_port_process(
    pid: u32,
    process_name: String,
    process_path: String,
    process_started_at_ticks: String,
) -> Result<(), String> {
    if pid == 0 || process_name.trim().is_empty() || process_path.trim().is_empty() || process_started_at_ticks.trim().is_empty() {
        return Err("缺少可验证的进程身份信息，已取消结束操作".into());
    }
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            run_powershell(TERMINATE_PROCESS_SCRIPT, &[
                ("DEV_TOOLKIT_PROCESS_ID", pid.to_string()),
                ("DEV_TOOLKIT_EXPECTED_NAME", process_name),
                ("DEV_TOOLKIT_EXPECTED_PATH", process_path),
                ("DEV_TOOLKIT_EXPECTED_STARTED", process_started_at_ticks),
            ]).map(|_| ())
        }).await.map_err(|error| format!("结束进程任务失败：{error}"))?;
    }
    #[cfg(not(windows))]
    { let _ = (pid, process_name, process_path, process_started_at_ticks); Err("结束本机进程当前仅支持 Windows 桌面端".into()) }
}
