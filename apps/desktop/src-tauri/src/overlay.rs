use crate::placement::{place, Rect};
use serde::{Deserialize, Serialize};
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
    viewport: Option<(Rect, f64)>,
}

pub struct OverlayHost(Mutex<Lease>);

impl OverlayHost {
    pub fn new() -> Self {
        Self(Mutex::new(Lease {
            request: None,
            renewed: Instant::now(),
            viewport: None,
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
    validate_geometry(&request)?;
    let mut lease = state.0.lock().map_err(|_| "overlay host unavailable")?;
    lease.request = Some(request);
    lease.renewed = Instant::now();
    Ok(())
}

fn validate_geometry(request: &OverlayRequest) -> Result<(), String> {
    if !(100.0..=420.0).contains(&request.width)
        || !(40.0..=640.0).contains(&request.height)
        || !(0.8..=1.5).contains(&request.scale)
        || !["below-radar", "lower-left", "lower-right"].contains(&request.position.as_str())
    {
        return Err("invalid overlay geometry".into());
    }
    Ok(())
}

fn overlay_geometry(game: Rect, dpi: f64, request: &OverlayRequest) -> (i32, i32, i32, i32) {
    let width = (request.width * request.scale * dpi).ceil() as i32;
    let height = (request.height * request.scale * dpi).ceil() as i32;
    let (x, y) = place(game, width, height, &request.position);
    (x, y, width, height)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGeometry {
    game_width: i32,
    game_height: i32,
    x: i32,
    y: i32,
    dpi: f64,
}

#[tauri::command]
pub fn preview_overlay_geometry(
    window: WebviewWindow,
    state: State<'_, OverlayHost>,
    request: OverlayRequest,
) -> Result<Option<PreviewGeometry>, String> {
    if window.label() != "settings" {
        return Err("invalid caller".into());
    }
    validate_geometry(&request)?;
    let live_viewport = find_cs2_window().map(|game| {
        let dpi = window
            .app_handle()
            .get_webview_window("overlay")
            .and_then(|w| w.scale_factor().ok())
            .or_else(|| window.scale_factor().ok())
            .unwrap_or(1.0);
        (game, dpi)
    });
    let mut lease = state.0.lock().map_err(|_| "overlay host unavailable")?;
    if let Some(viewport) = live_viewport {
        lease.viewport = Some(viewport);
    }
    let viewport = lease.viewport;
    Ok(viewport.map(|(game, dpi)| {
        let (x, y, _, _) = overlay_geometry(game, dpi, &request);
        PreviewGeometry {
            game_width: game.width,
            game_height: game.height,
            x: x - game.x,
            y: y - game.y,
            dpi,
        }
    }))
}

/// Queries window identity and client geometry only; never reads game memory.
#[cfg(windows)]
fn cs2_window_rect(hwnd: windows_sys::Win32::Foundation::HWND) -> Option<Rect> {
    use windows_sys::Win32::Foundation::{CloseHandle, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    };

    unsafe {
        if hwnd.is_null() || IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
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

/// Queries foreground window identity and client geometry only; never reads game memory.
#[cfg(windows)]
fn foreground_cs2() -> Option<Rect> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { cs2_window_rect(GetForegroundWindow()) }
}

/// On-demand lookup of a visible non-minimized CS2 window for Settings preview.
#[cfg(windows)]
fn find_cs2_window() -> Option<Rect> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let found = &mut *(lparam as *mut Option<Rect>);
        if let Some(rect) = cs2_window_rect(hwnd) {
            *found = Some(rect);
            return 0;
        }
        1
    }

    if let Some(rect) = foreground_cs2() {
        return Some(rect);
    }
    let mut found: Option<Rect> = None;
    unsafe {
        EnumWindows(Some(enum_proc), (&mut found as *mut Option<Rect>) as LPARAM);
    }
    found
}

#[cfg(not(windows))]
fn foreground_cs2() -> Option<Rect> {
    None
}

#[cfg(not(windows))]
fn find_cs2_window() -> Option<Rect> {
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
                if let Ok(mut lease) = state.0.lock() {
                    lease.viewport = Some((game, dpi));
                }
                let geometry = overlay_geometry(game, dpi, &request);
                if last_geometry != Some(geometry) {
                    let (x, y, _, _) = geometry;
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
