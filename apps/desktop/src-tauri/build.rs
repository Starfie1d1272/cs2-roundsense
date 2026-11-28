fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "set_overlay_state",
                "pick_cs2_folder",
                "open_directory",
                "open_logs_dir",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
