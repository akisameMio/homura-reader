const COMMANDS: &[&str] = &["enable", "disable"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
