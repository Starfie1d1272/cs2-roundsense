#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod overlay;
mod placement;
mod sidecar;

use overlay::{set_overlay_state, spawn_tracker, OverlayHost};
use sidecar::{logs_dir, SidecarState, WEB_ORIGIN};
use std::{fs, path::Path, process::Command};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

fn show_settings_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn open_dir_in_os(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("目录不存在: {}", path.display()));
    }
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("explorer");
        c.arg(path);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(path);
        c
    };
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(path);
        c
    };
    cmd.spawn().map_err(|e| format!("无法打开目录: {e}"))?;
    Ok(())
}

#[tauri::command]
fn pick_cs2_folder(window: WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != "settings" {
        return Err("invalid caller".into());
    }
    let picked = window
        .app_handle()
        .dialog()
        .file()
        .set_title("选择 Counter-Strike Global Offensive 安装目录")
        .blocking_pick_folder();
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
fn open_directory(window: WebviewWindow, path: String) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("invalid caller".into());
    }
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("目录路径为空".into());
    }
    open_dir_in_os(Path::new(trimmed))
}

#[tauri::command]
fn open_logs_dir(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("invalid caller".into());
    }
    let dir = logs_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建日志目录失败: {e}"))?;
    open_dir_in_os(&dir)
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "打开 RoundSense 设置", true, None::<&str>)?;
    let logs_item = MenuItem::with_id(app, "logs", "打开日志目录", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 RoundSense", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &logs_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("RoundSense · CS2 冻结时间经济 HUD")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_settings_window(app),
            "logs" => {
                let dir = logs_dir();
                let _ = fs::create_dir_all(&dir);
                let _ = open_dir_in_os(&dir);
            }
            "quit" => {
                app.state::<SidecarState>().stop();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_settings_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_settings_window(app);
        }))
        .manage(OverlayHost::new())
        .manage(SidecarState::empty())
        .invoke_handler(tauri::generate_handler![
            set_overlay_state,
            pick_cs2_folder,
            open_directory,
            open_logs_dir,
        ])
        .setup(|app| {
            app.state::<SidecarState>()
                .ensure_started()
                .map_err(|msg| std::io::Error::other(msg))?;

            let overlay_url = format!("{WEB_ORIGIN}/overlay");
            let overlay = WebviewWindowBuilder::new(
                app,
                "overlay",
                WebviewUrl::External(overlay_url.parse()?),
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
            .inner_size(264.0, 140.0)
            .on_navigation(|url| url.as_str() == format!("{WEB_ORIGIN}/overlay"))
            .build()?;
            overlay.set_ignore_cursor_events(true)?;

            let settings_url = format!("{WEB_ORIGIN}/");
            WebviewWindowBuilder::new(
                app,
                "settings",
                WebviewUrl::External(settings_url.parse()?),
            )
            .title("RoundSense · 经济 HUD 设置")
            .inner_size(1160.0, 760.0)
            .min_inner_size(860.0, 620.0)
            .on_navigation(|url| {
                url.as_str() == format!("{WEB_ORIGIN}/")
                    || url.as_str() == format!("{WEB_ORIGIN}/overlay")
            })
            .build()?;

            setup_tray(app.handle())?;
            spawn_tracker(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build RoundSense desktop host");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            app_handle.state::<SidecarState>().stop();
        }
    });
}
