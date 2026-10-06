fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let attributes = tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["set_overlay_state"]));
        tauri_build::try_build(attributes).expect("failed to build Windows HUD metadata");
    }
}
