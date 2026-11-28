use crate::placement::{place, Rect};
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};

#[derive(Clone, Deserialize)]
pub struct OverlayRequest {
    pub visible: bool,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub position: String,
}

struct Lease {
    request: Option<OverlayRequest>,
    renewed: Instant,
}

pub struct OverlayHost(Mutex<Lease>);

impl OverlayHost {
    pub fn new() -> Self {
        Self(Mutex::new(Lease {
            request: None,
            renewed: Instant::now(),
        }))
    }
}

#[tauri::command]
pub fn set_overlay_state(
    window: WebviewWindow,
    state: State<'_, OverlayHost>,
    request: OverlayRequest,
) -> Result<(), String> {
    if window.label() != "overlay" {
        return Err("invalid caller".into());
    }
    if !request.width.is_finite()
        || !request.height.is_finite()
        || !request.scale.is_finite()
        || !(100.0..=420.0).contains(&request.width)
        || !(40.0..=640.0).contains(&request.height)
        || !(0.8..=1.5).contains(&request.scale)
        || !["below-radar", "lower-left", "lower-right"].contains(&request.position.as_str())
    {
        return Err("invalid overlay geometry".into());
    }
    let mut lease = state.0.lock().map_err(|_| "overlay host unavailable")?;
    lease.request = Some(request);
    lease.renewed = Instant::now();
    Ok(())
}

/// Queries foreground window identity and client geometry only; never reads game memory.
#[cfg(windows)]
fn foreground_cs2() -> Option<Rect> {
    use windows_sys::Win32::Foundation::{CloseHandle, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() || IsIconic(hwnd) != 0 {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
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
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let mut origin = POINT { x: 0, y: 0 };
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

#[cfg(not(windows))]
fn foreground_cs2() -> Option<Rect> {
    None
}

pub fn spawn_tracker(handle: AppHandle) {
    std::thread::spawn(move || {
        let mut shown = false;
        let mut last_geometry = None;
        loop {
            std::thread::sleep(Duration::from_millis(100));
            let Some(window) = handle.get_webview_window("overlay") else {
                break;
            };
            let state = handle.state::<OverlayHost>();
            let visible_request = state.0.lock().ok().and_then(|lease| {
                if lease.renewed.elapsed() < Duration::from_secs(3) {
                    lease.request.clone().filter(|r| r.visible)
                } else {
                    None
                }
            });
            // Skip Win32 foreground/process queries completely when HUD is hidden.
            let Some(request) = visible_request else {
                if shown {
                    let _ = window.hide();
                    shown = false;
                }
                continue;
            };
            if let Some(game) = foreground_cs2() {
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
}
