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

/// Checks whether a healthy RoundSense HUD backend is already listening on 127.0.0.1:3100.
pub fn is_backend_healthy() -> bool {
    let addr: SocketAddr = WEB_ADDR.parse().expect("fixed loopback address");
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let req = format!(
        "GET /health HTTP/1.1\r\nHost: {WEB_ADDR}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.take(32 * 1024).read_to_string(&mut response).is_err() {
        return false;
    }
    let Some(body) = response.split("\r\n\r\n").nth(1) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    json["ok"] == true && json["product"] == "roundsense"
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
    ui_dir: Option<PathBuf>,
}

fn resolve_sidecar_paths() -> Result<SidecarPaths, String> {
    let root = bundle_root()?;
    let sidecar_dir = root.join("sidecar");

    #[cfg(windows)]
    let bundled_node = sidecar_dir.join("node.exe");
    #[cfg(not(windows))]
    let bundled_node = sidecar_dir.join("node");

    let bundled_script = sidecar_dir.join("roundsense-server.mjs");
    if bundled_script.is_file() {
        let node_bin = if bundled_node.is_file() {
            bundled_node
        } else {
            PathBuf::from("node")
        };
        let ui_dir = sidecar_dir.join("ui");
        return Ok(SidecarPaths {
            node_bin,
            server_script: bundled_script,
            ui_dir: ui_dir.is_dir().then_some(ui_dir),
        });
    }

    if let Ok(explicit) = std::env::var("ROUNDSENSE_SIDECAR_SCRIPT") {
        let script = PathBuf::from(explicit);
        if script.is_file() {
            return Ok(SidecarPaths {
                node_bin: PathBuf::from(
                    std::env::var("ROUNDSENSE_NODE_BIN").unwrap_or_else(|_| "node".into()),
                ),
                server_script: script,
                ui_dir: std::env::var("ROUNDSENSE_UI_DIR").ok().map(PathBuf::from),
            });
        }
    }

    Err(format!(
        "未找到内置后端文件: {}。请确认便携包解压完整，或先启动本地服务。",
        bundled_script.display()
    ))
}

#[cfg(windows)]
mod win_job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: u32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

    #[repr(C)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    struct JobObjectBasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct JobObjectExtendedLimitInformation {
        basic_limit_information: JobObjectBasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *mut core::ffi::c_void, name: *const u16) -> isize;
        fn SetInformationJobObject(
            job: isize,
            class: u32,
            info: *const core::ffi::c_void,
            length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: isize, process: isize) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }

    /// Holds a Windows Job Object configured with KILL_ON_JOB_CLOSE so the Node
    /// sidecar can never leak as an orphan even if RoundSense.exe terminates abruptly.
    pub struct JobGuard(isize);

    unsafe impl Send for JobGuard {}

    impl JobGuard {
        pub fn attach(child: &Child) -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(core::ptr::null_mut(), core::ptr::null());
                if job == 0 {
                    return None;
                }
                let mut info: JobObjectExtendedLimitInformation = core::mem::zeroed();
                info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    &info as *const _ as *const core::ffi::c_void,
                    core::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
                );
                if ok == 0 || AssignProcessToJobObject(job, child.as_raw_handle() as isize) == 0 {
                    CloseHandle(job);
                    return None;
                }
                Some(Self(job))
            }
        }
    }

    impl Drop for JobGuard {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    CloseHandle(self.0);
                }
                self.0 = 0;
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

    /// Ensures the local Node HUD backend is reachable on 127.0.0.1:3100.
    /// If already healthy (e.g. dev mode), attaches to it without spawning a duplicate.
    pub fn ensure_started(&self) -> Result<(), String> {
        if is_backend_healthy() {
            return Ok(());
        }

        let paths = resolve_sidecar_paths()?;
        let log_dir = logs_dir();
        let _ = fs::create_dir_all(&log_dir);
        let log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_dir.join("sidecar.log"))
            .ok();

        let mut cmd = Command::new(&paths.node_bin);
        cmd.arg(&paths.server_script);
        if let Some(ui_dir) = paths.ui_dir {
            cmd.env("ROUNDSENSE_UI_DIR", ui_dir);
        }
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
        let job = win_job::JobGuard::attach(&child);

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
                return Err(format!("内置 Node 服务意外退出（exit: {status}），请查看 sidecar.log。"));
            }
            std::thread::sleep(Duration::from_millis(120));
        }

        let _ = child.kill();
        let _ = child.wait();
        Err("等待内置 Node 服务就绪超时（10s），请查看 sidecar.log。".to_string())
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
