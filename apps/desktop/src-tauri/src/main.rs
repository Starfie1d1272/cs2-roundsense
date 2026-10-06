#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
mod placement;

#[cfg(windows)]
mod windows_host {
    use super::placement::{place, Rect};
    use serde::Deserialize;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use tauri::{
        LogicalSize, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
        WebviewWindowBuilder,
    };

    #[repr(C)]
    struct WinRect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn GetClientRect(hwnd: isize, rect: *mut WinRect) -> i32;
        fn ClientToScreen(hwnd: isize, point: *mut Point) -> i32;
        fn IsIconic(hwnd: isize) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn QueryFullProcessImageNameW(
            process: isize,
            flags: u32,
            buffer: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }

    /** Queries window identity and geometry only; never reads game memory. */
    fn foreground_cs2() -> Option<Rect> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == 0 || IsIconic(hwnd) != 0 {
                return None;
            }
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            let process = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if process == 0 {
                return None;
            }
            let mut buffer = [0u16; 1024];
            let mut size = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size);
            CloseHandle(process);
            if ok == 0 {
                return None;
            }
            let path = String::from_utf16_lossy(&buffer[..size as usize]);
            if !path.rsplit('\\').next()?.eq_ignore_ascii_case("cs2.exe") {
                return None;
            }
            let mut rect = WinRect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let mut origin = Point { x: 0, y: 0 };
            if GetClientRect(hwnd, &mut rect) == 0 || ClientToScreen(hwnd, &mut origin) == 0 {
                return None;
            }
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            if width < 640 || height < 360 {
                return None;
            }
            Some(Rect {
                x: origin.x,
                y: origin.y,
                width,
                height,
            })
        }
    }

    #[derive(Clone, Deserialize)]
    pub struct OverlayRequest {
        visible: bool,
        width: f64,
        height: f64,
        scale: f64,
        position: String,
    }
    struct Lease {
        request: Option<OverlayRequest>,
        renewed: Instant,
    }
    pub struct Host(Mutex<Lease>);

    #[tauri::command]
    pub fn set_overlay_state(
        window: WebviewWindow,
        state: State<'_, Host>,
        request: OverlayRequest,
    ) -> Result<(), String> {
        if window.label() != "overlay" {
            return Err("invalid caller".into());
        }
        if !request.width.is_finite()
            || !request.height.is_finite()
            || !request.scale.is_finite()
            || !(100.0..=400.0).contains(&request.width)
            || !(40.0..=600.0).contains(&request.height)
            || !(0.8..=1.5).contains(&request.scale)
            || !["below-radar", "lower-left", "lower-right"].contains(&request.position.as_str())
        {
            return Err("invalid overlay geometry".into());
        }
        let mut lease = state.0.lock().map_err(|_| "host state unavailable")?;
        lease.request = Some(request);
        lease.renewed = Instant::now();
        Ok(())
    }

    pub fn run() {
        // One fixed loopback origin matches the capability allowlist. A custom
        // web port may be used for browser debugging, not for the native host.
        tauri::Builder::default()
            .manage(Host(Mutex::new(Lease {
                request: None,
                renewed: Instant::now(),
            })))
            .invoke_handler(tauri::generate_handler![set_overlay_state])
            .setup(|app| {
                let origin = "http://127.0.0.1:3100";
                let overlay = WebviewWindowBuilder::new(
                    app,
                    "overlay",
                    WebviewUrl::External(format!("{origin}/overlay").parse()?),
                )
                .title("RoundSense HUD")
                .decorations(false)
                .shadow(false)
                .resizable(false)
                .transparent(true)
                .always_on_top(true)
                .focusable(false)
                .focused(false)
                .skip_taskbar(true)
                .visible(false)
                .inner_size(248.0, 80.0)
                .on_navigation(|url| url.as_str() == "http://127.0.0.1:3100/overlay")
                .build()?;
                overlay.set_ignore_cursor_events(true)?;
                WebviewWindowBuilder::new(
                    app,
                    "settings",
                    WebviewUrl::External(format!("{origin}/").parse()?),
                )
                .title("RoundSense · HUD 设置")
                .inner_size(850.0, 720.0)
                .on_navigation(|url| url.as_str() == "http://127.0.0.1:3100/")
                .build()?;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut shown = false;
                    let mut last_geometry = None;
                    loop {
                        std::thread::sleep(Duration::from_millis(100));
                        let Some(window) = handle.get_webview_window("overlay") else {
                            break;
                        };
                        let state = handle.state::<Host>();
                        let request = state.0.lock().ok().and_then(|lease| {
                            if lease.renewed.elapsed() < Duration::from_secs(3) {
                                lease.request.clone()
                            } else {
                                None
                            }
                        });
                        let game = foreground_cs2();
                        if let (Some(request), Some(game)) = (request.filter(|r| r.visible), game) {
                            let dpi = window.scale_factor().unwrap_or(1.0);
                            let width = (request.width * request.scale * dpi).ceil() as i32;
                            let height = (request.height * request.scale * dpi).ceil() as i32;
                            let (x, y) = place(game, width, height, &request.position);
                            let geometry = (x, y, width, height);
                            if last_geometry != Some(geometry) {
                                let _ = window.set_position(PhysicalPosition::new(x, y));
                                let _ = window.set_size(LogicalSize::new(
                                    request.width * request.scale,
                                    request.height * request.scale,
                                ));
                                last_geometry = Some(geometry);
                            }
                            if !shown {
                                shown = window.show().is_ok();
                            }
                        } else if shown {
                            let _ = window.hide();
                            shown = false;
                        }
                    }
                });
                Ok(())
            })
            .on_window_event(|window, event| {
                if window.label() == "settings"
                    && matches!(event, tauri::WindowEvent::CloseRequested { .. })
                {
                    window.app_handle().exit(0);
                }
            })
            .run(tauri::generate_context!())
            .expect("RoundSense desktop host failed");
    }
}

#[cfg(windows)]
fn main() {
    windows_host::run();
}
#[cfg(not(windows))]
fn main() {
    eprintln!("RoundSense native overlay currently supports Windows only. Use pnpm hud for browser debugging.");
}
