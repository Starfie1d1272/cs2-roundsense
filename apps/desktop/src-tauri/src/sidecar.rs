use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

pub const WEB_ORIGIN: &str = "http://127.0.0.1:3100";
const WEB_ADDR: &str = "127.0.0.1:3100";
const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// Returns the per-user RoundSense data directory (%LOCALAPPDATA%\RoundSense on Windows,
/// ~/.config/RoundSense elsewhere), matching apps/roundsense/src/hud/index.ts.
pub fn data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local).join("RoundSense");
        }
    }
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        return PathBuf::from(home).join(".config").join("RoundSense");
    }
    std::env::temp_dir().join("RoundSense")
}

pub fn logs_dir() -> PathBuf {
    data_dir().join("logs")
}

fn is_port_occupied() -> bool {
    let addr: SocketAddr = WEB_ADDR.parse().expect("fixed loopback address");
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Validates an HTTP 200 /health JSON response from our bundled sidecar.
fn parse_health_response(response: &str) -> bool {
    let Some((head, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let Some(status_line) = head.lines().next() else {
        return false;
    };
    if !status_line.starts_with("HTTP/1.1 200") && !status_line.starts_with("HTTP/1.0 200") {
        return false;
    }
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body.trim()) else {
        return false;
    };
    json["ok"] == true && json["product"] == "roundsense"
}

/// Checks whether the RoundSense HUD backend is listening and healthy on 127.0.0.1:3100.
pub fn is_backend_healthy() -> bool {
    let addr: SocketAddr = WEB_ADDR.parse().expect("fixed loopback address");
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let req = format!(
        "GET /health HTTP/1.0\r\nHost: {WEB_ADDR}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.take(32 * 1024).read_to_string(&mut response).is_err() {
        return false;
    }
    parse_health_response(&response)
}

fn bundle_root() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|e| format!("无法定位程序目录: {e}"))?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法定位程序目录".to_string())
}

struct SidecarPaths {
    node_bin: PathBuf,
    server_script: PathBuf,
    ui_dir: PathBuf,
}

fn resolve_sidecar_paths() -> Result<SidecarPaths, String> {
    let root = bundle_root()?;
    let sidecar_dir = root.join("sidecar");

    #[cfg(windows)]
    let bundled_node = sidecar_dir.join("node.exe");
    #[cfg(not(windows))]
    let bundled_node = sidecar_dir.join("node");

    let bundled_script = sidecar_dir.join("roundsense-server.mjs");
    let bundled_ui = sidecar_dir.join("ui");

    if bundled_node.is_file() && bundled_script.is_file() && bundled_ui.is_dir() {
        return Ok(SidecarPaths {
            node_bin: bundled_node,
            server_script: bundled_script,
            ui_dir: bundled_ui,
        });
    }

    #[cfg(debug_assertions)]
    if let Ok(explicit) = std::env::var("ROUNDSENSE_SIDECAR_SCRIPT") {
        let script = PathBuf::from(explicit);
        let ui_dir = std::env::var("ROUNDSENSE_UI_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| script.parent().unwrap_or(Path::new(".")).join("ui"));
        if script.is_file() && ui_dir.is_dir() {
            return Ok(SidecarPaths {
                node_bin: PathBuf::from(
                    std::env::var("ROUNDSENSE_NODE_BIN").unwrap_or_else(|_| "node".into()),
                ),
                server_script: script,
                ui_dir,
            });
        }
    }

    Err(format!(
        "便携包文件不完整（缺少 sidecar 运行时或 UI 资源，目录: {}）。请重新完整解压 RoundSense 压缩包后再启动。",
        sidecar_dir.display()
    ))
}

#[cfg(windows)]
mod win_job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Holds a Windows Job Object configured with KILL_ON_JOB_CLOSE so the Node
    /// sidecar can never leak as an orphan even if RoundSense.exe terminates abruptly.
    pub struct JobGuard(HANDLE);

    unsafe impl Send for JobGuard {}

    impl JobGuard {
        pub fn attach(child: &Child) -> Result<Self, String> {
            unsafe {
                let job = CreateJobObjectW(core::ptr::null(), core::ptr::null());
                if job.is_null() {
                    return Err("无法创建 Windows Job Object".into());
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = core::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    core::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0
                    || AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0
                {
                    CloseHandle(job);
                    return Err("无法将内置 Node 进程绑定到生命周期 Job Object".into());
                }
                Ok(Self(job))
            }
        }
    }

    impl Drop for JobGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
                self.0 = core::ptr::null_mut();
            }
        }
    }
}

struct SidecarInner {
    child: Option<Child>,
    #[cfg(windows)]
    _job: Option<win_job::JobGuard>,
}

pub struct SidecarState(Mutex<SidecarInner>);

impl SidecarState {
    pub fn empty() -> Self {
        Self(Mutex::new(SidecarInner {
            child: None,
            #[cfg(windows)]
            _job: None,
        }))
    }

    /// Starts the bundled Node HUD sidecar and waits until /health returns HTTP 200.
    /// In release builds, RoundSense.exe is the sole lifecycle owner of its sidecar.
    pub fn ensure_started(&self) -> Result<(), String> {
        #[cfg(debug_assertions)]
        if is_backend_healthy() {
            return Ok(());
        }

        if is_port_occupied() {
            return Err(format!(
                "本地端口 3100 已被其他程序占用，RoundSense 无法启动内置服务。请关闭占用端口的程序后重试。"
            ));
        }

        let paths = resolve_sidecar_paths()?;
        let log_dir = logs_dir();
        let _ = fs::create_dir_all(&log_dir);
        let log_path = log_dir.join("sidecar.log");
        if fs::metadata(&log_path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
            let _ = fs::write(&log_path, b"");
        }
        let log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();

        let mut cmd = Command::new(&paths.node_bin);
        cmd.arg(&paths.server_script);
        cmd.env("ROUNDSENSE_UI_DIR", &paths.ui_dir);
        if let Some(file) = log_file {
            if let Ok(err_file) = file.try_clone() {
                cmd.stdout(Stdio::from(file));
                cmd.stderr(Stdio::from(err_file));
            }
        } else {
            cmd.stdout(Stdio::null());
            cmd.stderr(Stdio::null());
        }
        cmd.stdin(Stdio::null());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动内置 Node 服务失败 ({}): {e}", paths.node_bin.display()))?;

        #[cfg(windows)]
        let job = match win_job::JobGuard::attach(&child) {
            Ok(j) => Some(j),
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(err);
            }
        };

        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if is_backend_healthy() {
                if let Ok(mut guard) = self.0.lock() {
                    guard.child = Some(child);
                    #[cfg(windows)]
                    {
                        guard._job = job;
                    }
                }
                return Ok(());
            }
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!(
                    "内置 Node 服务意外退出（exit: {status}）。请查看日志：{}",
                    log_path.display()
                ));
            }
            std::thread::sleep(Duration::from_millis(120));
        }

        let _ = child.kill();
        let _ = child.wait();
        Err(format!(
            "等待内置 Node 服务就绪超时（10s）。请查看日志：{}",
            log_path.display()
        ))
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(windows)]
            {
                guard._job = None;
            }
        }
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_http10_health_response() {
        let resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 34\r\n\r\n{\"ok\":true,\"product\":\"roundsense\"}";
        assert!(parse_health_response(resp));
    }

    #[test]
    fn rejects_non_200_health_response() {
        let resp = "HTTP/1.1 500 Internal Server Error\r\n\r\n{\"ok\":true,\"product\":\"roundsense\"}";
        assert!(!parse_health_response(resp));
    }
}
