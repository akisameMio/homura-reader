/* ============================================================================
HOMURA · 运行日志导出
----------------------------------------------------------------------------
设置页的日志导出需要用户自己挑选保存位置。WebView 的 <a download> 在
macOS / Android 上并不可靠，所以桌面端直接复用 tauri-plugin-dialog 的
保存对话框，并在 Rust 侧写盘，避免放开任意路径的 fs 权限。
Android 的保存对话框只返回 content:// URI，Rust 无法直接写入；前端会
改为复制到剪贴板。
============================================================================ */

#[cfg(desktop)]
use std::fs;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 4 * 1024 * 1024;

#[cfg(desktop)]
fn sanitize_file_name(value: &str) -> String {
    let mut name: String = value
        .trim()
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .collect();
    if name.is_empty() {
        name.push_str("homura-logs.txt");
    }
    if !name.ends_with(".txt") {
        name.push_str(".txt");
    }
    name
}

#[tauri::command]
pub async fn export_runtime_logs(
    app: AppHandle,
    contents: String,
    default_name: String,
) -> Result<Option<String>, String> {
    if contents.len() > MAX_EXPORT_BYTES {
        return Err("NATIVE_LIMIT_EXCEEDED 日志内容过大，无法导出".to_string());
    }

    #[cfg(mobile)]
    {
        let _ = (app, default_name);
        Err("NATIVE_UNSUPPORTED 当前平台不支持保存对话框".to_string())
    }

    #[cfg(desktop)]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.dialog()
            .file()
            .set_file_name(sanitize_file_name(&default_name))
            .add_filter("Text", &["txt"])
            .save_file(move |path| {
                let _ = sender.send(path);
            });

        let picked = tauri::async_runtime::spawn_blocking(move || receiver.recv().ok().flatten())
            .await
            .map_err(|error| format!("NATIVE_COMMAND_FAILED 保存对话框失败：{error}"))?;
        let Some(file_path) = picked else {
            return Ok(None);
        };
        let path = file_path
            .into_path()
            .map_err(|error| format!("NATIVE_INVALID_DATA 目标路径无效：{error}"))?;
        fs::write(&path, contents.as_bytes())
            .map_err(|error| format!("NATIVE_COMMAND_FAILED 写入日志失败：{error}"))?;
        Ok(Some(path.to_string_lossy().to_string()))
    }
}
