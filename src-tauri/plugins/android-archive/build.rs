const COMMANDS: &[&str] = &[
  "open",
  "openDocument",
  "readTextBatch",
  "extract",
  "close",
  "clearBook",
  "clearAll",
  "inspectImportUris",
  "pickImportUris",
  "stageImportUri",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
