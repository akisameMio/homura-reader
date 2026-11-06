const COMMANDS: &[&str] = &[
  "openDocument",
  "readTextBatch",
  "extract",
  "close",
  "clearBook",
  "clearAll",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
