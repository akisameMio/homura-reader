/* ============================================================================
HOMURA · 磁盘存储统计
----------------------------------------------------------------------------
设置页需要区分「本应用占用 / 其他应用占用 / 磁盘剩余」，而 WebView 的
navigator.storage.estimate() 只给网页缓存配额，和磁盘容量无关。
这里直接查询应用数据目录所在磁盘，并递归统计 AppData / AppCache 体积。
========================================================================== */

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// 归档目录可能有几十万个小文件；超过上限就返回已统计部分，避免设置页卡死。
const MAX_ENTRIES: usize = 300_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub app_bytes: u64,
}

#[tauri::command]
pub async fn storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    let data_dir = app.path().app_data_dir().ok();
    let cache_dir = app.path().app_cache_dir().ok();
    let probe = data_dir
        .clone()
        .or_else(|| cache_dir.clone())
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "无法定位应用目录".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut app_bytes = 0u64;
        if let Some(dir) = data_dir {
            app_bytes = app_bytes.saturating_add(dir_size(&dir));
        }
        if let Some(dir) = cache_dir {
            app_bytes = app_bytes.saturating_add(dir_size(&dir));
        }
        let (total_bytes, free_bytes) = disk_space(&existing_ancestor(&probe))?;
        Ok(StorageStats {
            total_bytes,
            free_bytes,
            app_bytes,
        })
    })
    .await
    .map_err(|err| format!("统计存储失败：{err}"))?
}

// 新装环境里 AppData 可能还没创建，沿父目录找到第一个存在的路径再问文件系统。
fn existing_ancestor(path: &Path) -> PathBuf {
    let mut candidate = path.to_path_buf();
    while !candidate.exists() {
        match candidate.parent() {
            Some(parent) if parent != candidate => candidate = parent.to_path_buf(),
            _ => break,
        }
    }
    candidate
}

fn dir_size(root: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![root.to_path_buf()];
    let mut visited = 0usize;

    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_ENTRIES {
                return total;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push(entry.path());
            } else if meta.is_file() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

#[cfg(unix)]
fn disk_space(path: &Path) -> Result<(u64, u64), String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| "应用路径包含非法字符".to_string())?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if rc != 0 {
        return Err(format!(
            "读取磁盘空间失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    let total = (stat.f_blocks as u64).saturating_mul(stat.f_frsize as u64);
    let free = (stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64);
    Ok((total, free))
}

#[cfg(windows)]
fn disk_space(path: &Path) -> Result<(u64, u64), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free = 0u64;
    let mut total = 0u64;
    let ok =
        unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, std::ptr::null_mut()) };
    if ok == 0 {
        return Err(format!(
            "读取磁盘空间失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok((total, free))
}
