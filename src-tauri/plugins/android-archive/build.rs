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
  "pickImportFolder",
  "stageImportUri",
  "resolveReference",
  "readReference",
  "hashReference",
  "openReferenceArchive",
  "releaseReference",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
