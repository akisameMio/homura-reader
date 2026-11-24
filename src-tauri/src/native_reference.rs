/* ============================================================================
HOMURA · 桌面原位置文件引用
----------------------------------------------------------------------------
文件只在用户通过系统选择器明确选中后登记，前端拿不到真实路径，也不能用
任意路径创建引用。登记记录存到 AppData，后续只允许通过不透明 token 做有界
只读操作；每次解析都会重新验证规范路径、文件类型、大小和选择时基线。外部
文件不会加入插件 FS scope，所有读取只经过本模块的 Rust 命令。
============================================================================ */

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fmt::Write as FmtWrite;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const REGISTRY_FILE: &str = "homura-native-references.json";
const REGISTRY_TEMP_FILE: &str = ".homura-native-references.json.tmp";
const REGISTRY_VERSION: u32 = 1;
const REFERENCE_PATH_PREFIX: &str = "homura-reference:";
const TOKEN_HEX_BYTES: usize = 64;
const MAX_REFERENCES: usize = 20_000;
const MAX_REGISTRY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_REFERENCE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_RANGE_BYTES: u64 = 8 * 1024 * 1024;
const HASH_BUFFER_BYTES: usize = 256 * 1024;
const MAX_FOLDER_DEPTH: usize = 64;

static TOKEN_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Default)]
pub struct NativeReferenceState {
    registry: Mutex<Option<ReferenceRegistry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceRegistry {
    version: u32,
    references: HashMap<String, ReferenceRecord>,
}

impl Default for ReferenceRegistry {
    fn default() -> Self {
        Self {
            version: REGISTRY_VERSION,
            references: HashMap::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceRecord {
    path: String,
    size: u64,
    last_modified: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedReference {
    pub path: PathBuf,
    pub size: u64,
    pub last_modified: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeReferenceMetadata {
    token: String,
    file_name: String,
    size: u64,
    last_modified: u64,
    changed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeReferenceHash {
    token: String,
    sha256: String,
    size: u64,
    last_modified: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeReferenceFolderFile {
    token: String,
    file_name: String,
    relative_path: String,
    size: u64,
    last_modified: u64,
    changed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeReferenceFolderSelection {
    folder_key: String,
    folder_name: String,
    files: Vec<NativeReferenceFolderFile>,
}

fn native_error(code: &str, message: impl AsRef<str>) -> String {
    format!("{code}: {}", message.as_ref())
}

fn invalid_data(message: impl AsRef<str>) -> String {
    native_error("NATIVE_INVALID_DATA", message)
}

fn limit_exceeded(message: impl AsRef<str>) -> String {
    native_error("NATIVE_LIMIT_EXCEEDED", message)
}

fn unsupported(message: impl AsRef<str>) -> String {
    native_error("NATIVE_UNSUPPORTED", message)
}

fn command_failed(message: impl AsRef<str>) -> String {
    native_error("NATIVE_COMMAND_FAILED", message)
}

fn security_limit(message: impl AsRef<str>) -> String {
    native_error("NATIVE_SECURITY_LIMIT", message)
}

fn valid_token(token: &str) -> bool {
    token.len() == TOKEN_HEX_BYTES && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn reference_token(path: &str) -> Option<&str> {
    path.strip_prefix(REFERENCE_PATH_PREFIX)
}

pub(crate) fn resolve_archive_spec(app: &AppHandle, path: &str) -> Result<Option<PathBuf>, String> {
    reference_token(path)
        .map(|token| resolve_reference(app, token).map(|reference| reference.path))
        .transpose()
}

fn is_supported_reference_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        ".epub", ".cbz", ".zip", ".pdf", ".mobi", ".prc", ".azw", ".txt", ".md",
    ]
    .iter()
    .any(|extension| lower.ends_with(extension))
}

fn is_supported_folder_reference_name(name: &str) -> bool {
    if is_supported_reference_name(name) {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') || name == "__MACOSX"
}

fn relative_reference_path(path: &Path, root: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| security_limit("引用文件越过所选文件夹"))?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => return Err(security_limit("引用文件包含非法相对路径")),
        }
    }
    if parts.is_empty() {
        return Err(invalid_data("引用文件缺少相对路径"));
    }
    Ok(parts.join("/"))
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn validate_selected_file(path: &Path, allow_images: bool) -> Result<(u64, u64), String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| invalid_data("引用文件名无效"))?;
    let supported = if allow_images {
        is_supported_folder_reference_name(name)
    } else {
        is_supported_reference_name(name)
    };
    if !supported {
        return Err(unsupported("该文件类型不支持原位置引用"));
    }
    let metadata =
        fs::metadata(path).map_err(|error| invalid_data(format!("无法读取引用文件：{error}")))?;
    if !metadata.is_file() {
        return Err(invalid_data("引用路径不是普通文件"));
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(limit_exceeded("引用文件过大"));
    }
    Ok((metadata.len(), modified_ms(&metadata)))
}

#[derive(Debug)]
struct FolderReferenceFile {
    path: PathBuf,
    relative_path: String,
    size: u64,
    last_modified: u64,
}

fn collect_folder_reference_files(
    root: &Path,
    current: &Path,
    depth: usize,
    files: &mut Vec<FolderReferenceFile>,
) -> Result<(), String> {
    if depth > MAX_FOLDER_DEPTH {
        return Err(limit_exceeded("引用文件夹层级过深"));
    }
    let entries = fs::read_dir(current)
        .map_err(|error| command_failed(format!("读取引用文件夹失败：{error}")))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| command_failed(format!("读取引用文件夹条目失败：{error}")))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden_name(&name) {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| command_failed(format!("读取引用文件信息失败：{error}")))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_folder_reference_files(root, &path, depth + 1, files)?;
            continue;
        }
        if !metadata.is_file() || !is_supported_folder_reference_name(&name) {
            continue;
        }
        if files.len() >= MAX_REFERENCES {
            return Err(limit_exceeded("引用文件夹内文件数量过多"));
        }
        let canonical = path
            .canonicalize()
            .map_err(|error| invalid_data(format!("引用文件不可用：{error}")))?;
        if !canonical.starts_with(root) {
            return Err(security_limit("引用文件越过所选文件夹"));
        }
        let (size, last_modified) = validate_selected_file(&canonical, true)?;
        files.push(FolderReferenceFile {
            relative_path: relative_reference_path(&canonical, root)?,
            path: canonical,
            size,
            last_modified,
        });
    }
    Ok(())
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(REGISTRY_FILE))
        .map_err(|error| command_failed(format!("无法定位 AppData：{error}")))
}

fn load_registry(app: &AppHandle) -> Result<ReferenceRegistry, String> {
    let path = registry_path(app)?;
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ReferenceRegistry::default())
        }
        Err(error) => return Err(command_failed(format!("读取引用登记失败：{error}"))),
    };
    if metadata.len() > MAX_REGISTRY_BYTES {
        return Err(limit_exceeded("引用登记文件过大"));
    }
    let bytes =
        fs::read(&path).map_err(|error| command_failed(format!("读取引用登记失败：{error}")))?;
    let registry: ReferenceRegistry = serde_json::from_slice(&bytes)
        .map_err(|error| invalid_data(format!("引用登记格式无效：{error}")))?;
    if registry.version != REGISTRY_VERSION {
        return Err(invalid_data("引用登记版本不受支持"));
    }
    if registry.references.len() > MAX_REFERENCES {
        return Err(limit_exceeded("引用登记条目过多"));
    }
    if registry
        .references
        .iter()
        .any(|(token, record)| !valid_token(token) || record.path.is_empty())
    {
        return Err(invalid_data("引用登记包含无效条目"));
    }
    Ok(registry)
}

fn save_registry(app: &AppHandle, registry: &ReferenceRegistry) -> Result<(), String> {
    let path = registry_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| command_failed(format!("创建引用登记目录失败：{error}")))?;
    }
    let bytes = serde_json::to_vec(registry)
        .map_err(|error| command_failed(format!("序列化引用登记失败：{error}")))?;
    if bytes.len() as u64 > MAX_REGISTRY_BYTES {
        return Err(limit_exceeded("引用登记文件过大"));
    }
    write_registry_atomic(&path, &bytes)
}

fn write_registry_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(REGISTRY_TEMP_FILE);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| command_failed(format!("创建引用登记临时文件失败：{error}")))?;
        file.write_all(bytes)
            .map_err(|error| command_failed(format!("写入引用登记临时文件失败：{error}")))?;
        file.sync_all()
            .map_err(|error| command_failed(format!("刷新引用登记临时文件失败：{error}")))?;
        drop(file);
        replace_registry_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(windows))]
fn replace_registry_file(temporary: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temporary, target)
        .map_err(|error| command_failed(format!("提交引用登记失败：{error}")))
}

#[cfg(windows)]
fn replace_registry_file(temporary: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    if !target.exists() {
        return fs::rename(temporary, target)
            .map_err(|error| command_failed(format!("提交引用登记失败：{error}")));
    }
    let target_wide: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let temporary_wide: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        return Err(command_failed(format!(
            "提交引用登记失败：{}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
}

fn loaded_registry(
    app: &AppHandle,
    state: &NativeReferenceState,
) -> Result<ReferenceRegistry, String> {
    let mut guard = state
        .registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        *guard = Some(load_registry(app)?);
    }
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| command_failed("引用登记不可用"))
}

fn lookup_record(app: &AppHandle, token: &str) -> Result<ReferenceRecord, String> {
    if !valid_token(token) {
        return Err(security_limit("引用 token 无效"));
    }
    let state = app.state::<NativeReferenceState>();
    loaded_registry(app, state.inner())?
        .references
        .get(token)
        .cloned()
        .ok_or_else(|| security_limit("引用 token 未登记"))
}

fn resolve_reference_current(
    app: &AppHandle,
    token: &str,
) -> Result<(ReferenceRecord, ResolvedReference), String> {
    let record = lookup_record(app, token)?;
    let stored = PathBuf::from(&record.path);
    if !stored.is_absolute() {
        return Err(security_limit("引用登记路径必须为绝对路径"));
    }
    let canonical = stored
        .canonicalize()
        .map_err(|error| invalid_data(format!("引用文件不可用：{error}")))?;
    if canonical != stored {
        return Err(security_limit("引用文件路径在授权后发生变化"));
    }
    let (size, last_modified) = validate_selected_file(&canonical, true)?;
    Ok((
        record,
        ResolvedReference {
            path: canonical,
            size,
            last_modified,
        },
    ))
}

fn ensure_unchanged_baseline(
    record: &ReferenceRecord,
    reference: &ResolvedReference,
) -> Result<(), String> {
    if reference.size != record.size || reference.last_modified != record.last_modified {
        return Err(invalid_data("引用文件自登记后发生变化，请重新定位"));
    }
    Ok(())
}

pub(crate) fn resolve_reference(app: &AppHandle, token: &str) -> Result<ResolvedReference, String> {
    let (record, reference) = resolve_reference_current(app, token)?;
    ensure_unchanged_baseline(&record, &reference)?;
    Ok(reference)
}

fn make_token(path: &Path) -> String {
    static PROCESS_SEED: OnceLock<u64> = OnceLock::new();
    let process_seed = *PROCESS_SEED.get_or_init(|| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        (now as u64) ^ u64::from(std::process::id())
    });
    let sequence = TOKEN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(process_seed.to_le_bytes());
    hasher.update(sequence.to_le_bytes());
    hasher.update(path.to_string_lossy().as_bytes());
    to_hex(&hasher.finalize())
}

fn make_folder_key(root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"homura-reference-folder-v1\0");
    hasher.update(root.to_string_lossy().as_bytes());
    to_hex(&hasher.finalize())
}

fn metadata_for(
    token: String,
    path: &Path,
    record: &ReferenceRecord,
    size: u64,
    last_modified: u64,
) -> NativeReferenceMetadata {
    NativeReferenceMetadata {
        token,
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        size,
        last_modified,
        changed: record.size != size || record.last_modified != last_modified,
    }
}

fn register_selected_references(
    app: &AppHandle,
    state: &NativeReferenceState,
    selected: Vec<(PathBuf, ReferenceRecord)>,
) -> Result<Vec<(String, PathBuf, ReferenceRecord)>, String> {
    let mut guard = state
        .registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        *guard = Some(load_registry(app)?);
    }
    let mut next = guard
        .as_ref()
        .cloned()
        .ok_or_else(|| command_failed("引用登记不可用"))?;
    let mut results = Vec::with_capacity(selected.len());
    for (path, record) in selected {
        // 每次选择保留自己的基线；候选文件校验失败时不能改动原书的引用。
        let mut token = make_token(&path);
        while next.references.contains_key(&token) {
            token = make_token(&path);
        }
        if next.references.len() >= MAX_REFERENCES {
            return Err(limit_exceeded("原位置引用数量过多"));
        }
        next.references.insert(token.clone(), record.clone());
        results.push((token, path, record));
    }
    save_registry(app, &next)?;
    *guard = Some(next);
    Ok(results)
}

#[tauri::command(async, rename = "pickNativeReference")]
pub async fn pick_native_reference(
    app: AppHandle,
    state: State<'_, NativeReferenceState>,
    multiple: Option<bool>,
) -> Result<Vec<NativeReferenceMetadata>, String> {
    #[cfg(not(desktop))]
    {
        let _ = (app, state);
        return Err(unsupported("原位置引用仅支持桌面端"));
    }

    #[cfg(desktop)]
    {
        let dialog = app
            .dialog()
            .file()
            .set_title("选择要保持原位置的文件")
            .add_filter(
                "HOMURA 书籍",
                &[
                    "epub", "cbz", "zip", "pdf", "mobi", "prc", "azw", "txt", "md",
                ],
            );
        let (sender, receiver) = std::sync::mpsc::channel::<Vec<tauri_plugin_dialog::FilePath>>();
        if multiple.unwrap_or(false) {
            dialog.pick_files(move |paths| {
                let _ = sender.send(paths.unwrap_or_default());
            });
        } else {
            dialog.pick_file(move |path| {
                let _ = sender.send(path.map(|path| vec![path]).unwrap_or_default());
            });
        }

        let picked =
            tauri::async_runtime::spawn_blocking(move || receiver.recv().unwrap_or_default())
                .await
                .map_err(|error| command_failed(format!("文件选择器任务失败：{error}")))?;
        if picked.is_empty() {
            return Ok(Vec::new());
        }
        if picked.len() > MAX_REFERENCES {
            return Err(limit_exceeded("一次选择的原位置引用数量过多"));
        }

        let mut selected = Vec::with_capacity(picked.len());
        let mut seen = HashSet::with_capacity(picked.len());
        for file_path in picked {
            let raw_path = file_path
                .into_path()
                .map_err(|error| invalid_data(format!("选中文件路径无效：{error}")))?;
            let path = raw_path
                .canonicalize()
                .map_err(|error| invalid_data(format!("选中文件不可用：{error}")))?;
            if !seen.insert(path.clone()) {
                continue;
            }
            let path_string = path
                .to_str()
                .ok_or_else(|| unsupported("不支持非 UTF-8 文件路径"))?
                .to_string();
            let (size, last_modified) = validate_selected_file(&path, false)?;
            selected.push((
                path,
                ReferenceRecord {
                    path: path_string,
                    size,
                    last_modified,
                },
            ));
        }

        let registered = register_selected_references(&app, state.inner(), selected)?;
        Ok(registered
            .into_iter()
            .map(|(token, path, record)| {
                metadata_for(token, &path, &record, record.size, record.last_modified)
            })
            .collect())
    }
}

#[tauri::command(async, rename = "pickNativeReferenceFolder")]
pub async fn pick_native_reference_folder(
    app: AppHandle,
    state: State<'_, NativeReferenceState>,
) -> Result<Option<NativeReferenceFolderSelection>, String> {
    #[cfg(not(desktop))]
    {
        let _ = (app, state);
        return Err(unsupported("原位置引用文件夹仅支持桌面端"));
    }

    #[cfg(desktop)]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.dialog()
            .file()
            .set_title("选择要保持原位置的文件夹")
            .pick_folder(move |path| {
                let _ = sender.send(path);
            });
        let picked = tauri::async_runtime::spawn_blocking(move || receiver.recv().ok().flatten())
            .await
            .map_err(|error| command_failed(format!("文件夹选择器任务失败：{error}")))?;
        let Some(folder_path) = picked else {
            return Ok(None);
        };
        let root = folder_path
            .into_path()
            .map_err(|error| invalid_data(format!("选中文件夹路径无效：{error}")))?
            .canonicalize()
            .map_err(|error| invalid_data(format!("选中文件夹不可用：{error}")))?;
        if !fs::metadata(&root)
            .map_err(|error| invalid_data(format!("无法读取选中文件夹：{error}")))?
            .is_dir()
        {
            return Err(invalid_data("选中路径不是文件夹"));
        }

        let mut folder_files = Vec::new();
        collect_folder_reference_files(&root, &root, 0, &mut folder_files)?;
        folder_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        if folder_files.is_empty() {
            return Err(invalid_data("所选文件夹内没有支持的书籍或图片"));
        }

        let mut relative_paths = HashMap::with_capacity(folder_files.len());
        let mut selected = Vec::with_capacity(folder_files.len());
        for file in folder_files {
            relative_paths.insert(file.path.clone(), file.relative_path);
            selected.push((
                file.path.clone(),
                ReferenceRecord {
                    path: file
                        .path
                        .to_str()
                        .ok_or_else(|| unsupported("不支持非 UTF-8 文件夹路径"))?
                        .to_string(),
                    size: file.size,
                    last_modified: file.last_modified,
                },
            ));
        }
        let registered = register_selected_references(&app, state.inner(), selected)?;
        let files = registered
            .into_iter()
            .map(|(token, path, record)| {
                let relative_path = relative_paths
                    .remove(&path)
                    .ok_or_else(|| invalid_data("引用文件缺少相对路径"))?;
                Ok(NativeReferenceFolderFile {
                    token,
                    file_name: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    relative_path,
                    size: record.size,
                    last_modified: record.last_modified,
                    changed: false,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Some(NativeReferenceFolderSelection {
            folder_key: make_folder_key(&root),
            folder_name: root
                .file_name()
                .unwrap_or_else(|| root.as_os_str())
                .to_string_lossy()
                .into_owned(),
            files,
        }))
    }
}

#[tauri::command(async, rename = "inspectNativeReference")]
pub async fn inspect_native_reference(
    app: AppHandle,
    token: String,
) -> Result<NativeReferenceMetadata, String> {
    let (record, reference) = resolve_reference_current(&app, &token)?;
    Ok(metadata_for(
        token,
        &reference.path,
        &record,
        reference.size,
        reference.last_modified,
    ))
}

#[tauri::command(async, rename = "forgetNativeReference")]
pub async fn forget_native_reference(
    app: AppHandle,
    state: State<'_, NativeReferenceState>,
    tokens: Vec<String>,
) -> Result<bool, String> {
    if tokens.len() > MAX_REFERENCES || tokens.iter().any(|token| !valid_token(token)) {
        return Err(security_limit("引用 token 无效"));
    }
    let mut guard = state
        .registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        *guard = Some(load_registry(&app)?);
    }
    let mut next = guard
        .as_ref()
        .cloned()
        .ok_or_else(|| command_failed("引用登记不可用"))?;
    let count = next.references.len();
    for token in tokens {
        next.references.remove(&token);
    }
    let removed = next.references.len() != count;
    if removed {
        save_registry(&app, &next)?;
        *guard = Some(next);
    }
    Ok(removed)
}

fn validate_range(file_size: u64, offset: u64, length: u64) -> Result<usize, String> {
    if length > MAX_RANGE_BYTES {
        return Err(limit_exceeded("单次引用读取超过 8 MiB"));
    }
    let end = offset
        .checked_add(length)
        .ok_or_else(|| invalid_data("引用读取范围溢出"))?;
    if end > file_size {
        return Err(invalid_data("引用读取范围越界"));
    }
    usize::try_from(length).map_err(|_| limit_exceeded("引用读取长度过大"))
}

fn read_range(reference: &ResolvedReference, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    let capacity = validate_range(reference.size, offset, length)?;
    let mut file = File::open(&reference.path)
        .map_err(|error| invalid_data(format!("打开引用文件失败：{error}")))?;
    let metadata = file
        .metadata()
        .map_err(|error| invalid_data(format!("读取引用文件状态失败：{error}")))?;
    if metadata.len() != reference.size || modified_ms(&metadata) != reference.last_modified {
        return Err(invalid_data("引用文件在读取前发生变化"));
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| command_failed(format!("定位引用文件失败：{error}")))?;
    let mut bytes = vec![0u8; capacity];
    file.read_exact(&mut bytes)
        .map_err(|error| invalid_data(format!("引用文件读取不完整：{error}")))?;
    let after = file
        .metadata()
        .map_err(|error| invalid_data(format!("读取引用文件状态失败：{error}")))?;
    if after.len() != reference.size || modified_ms(&after) != reference.last_modified {
        return Err(invalid_data("引用文件在读取期间发生变化"));
    }
    Ok(bytes)
}

#[tauri::command(async, rename = "readNativeReferenceRange")]
pub async fn read_native_reference_range(
    app: AppHandle,
    token: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    let reference = resolve_reference(&app, &token)?;
    let bytes =
        tauri::async_runtime::spawn_blocking(move || read_range(&reference, offset, length))
            .await
            .map_err(|error| command_failed(format!("引用读取任务失败：{error}")))??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn hash_file(reference: &ResolvedReference) -> Result<String, String> {
    let file = File::open(&reference.path)
        .map_err(|error| invalid_data(format!("打开引用文件失败：{error}")))?;
    let before = file
        .metadata()
        .map_err(|error| invalid_data(format!("读取引用文件状态失败：{error}")))?;
    if before.len() != reference.size || modified_ms(&before) != reference.last_modified {
        return Err(invalid_data("引用文件在校验前发生变化"));
    }

    let mut reader = BufReader::with_capacity(HASH_BUFFER_BYTES, file);
    let mut buffer = vec![0u8; HASH_BUFFER_BYTES];
    let mut hasher = Sha256::new();
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| command_failed(format!("流式读取引用文件失败：{error}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let file = reader.into_inner();
    let after = file
        .metadata()
        .map_err(|error| invalid_data(format!("读取引用文件状态失败：{error}")))?;
    if after.len() != reference.size || modified_ms(&after) != reference.last_modified {
        return Err(invalid_data("引用文件在校验期间发生变化"));
    }
    Ok(to_hex(&hasher.finalize()))
}

#[tauri::command(async, rename = "hashNativeReference")]
pub async fn hash_native_reference(
    app: AppHandle,
    token: String,
) -> Result<NativeReferenceHash, String> {
    let reference = resolve_reference(&app, &token)?;
    let size = reference.size;
    let last_modified = reference.last_modified;
    let sha256 = tauri::async_runtime::spawn_blocking(move || hash_file(&reference))
        .await
        .map_err(|error| command_failed(format!("引用校验任务失败：{error}")))??;
    Ok(NativeReferenceHash {
        token,
        sha256,
        size,
        last_modified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_file(label: &str, bytes: &[u8]) -> PathBuf {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "homura-native-reference-{label}-{}-{sequence}.bin",
            std::process::id()
        ));
        fs::write(&path, bytes).unwrap();
        path
    }

    fn temp_dir(label: &str) -> PathBuf {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "homura-native-reference-{label}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn tokens_and_reference_prefix_are_strict() {
        let token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert!(valid_token(token));
        assert!(!valid_token("../outside"));
        assert_eq!(
            reference_token(&format!("homura-reference:{token}")),
            Some(token)
        );
        assert_eq!(reference_token("/tmp/book.epub"), None);
    }

    #[test]
    fn only_supported_reference_extensions_are_accepted() {
        assert!(is_supported_reference_name("book.kepub.epub"));
        assert!(is_supported_reference_name("BOOK.CBZ"));
        assert!(is_supported_reference_name("notes.md"));
        assert!(!is_supported_reference_name("secret.env"));
        assert!(!is_supported_reference_name("book.azw3"));
        assert!(is_supported_folder_reference_name("pages/001.JPG"));
        assert!(is_supported_folder_reference_name("book.epub"));
        assert!(!is_supported_folder_reference_name("script.sh"));
    }

    #[test]
    fn scans_folder_books_images_and_relative_paths_without_hidden_entries() {
        let root = temp_dir("folder");
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::create_dir_all(root.join("__MACOSX")).unwrap();
        fs::write(root.join("book.epub"), b"epub").unwrap();
        fs::write(root.join("nested/001.jpg"), b"jpg").unwrap();
        fs::write(root.join("nested/ignore.tmp"), b"tmp").unwrap();
        fs::write(root.join(".hidden/secret.png"), b"hidden").unwrap();
        fs::write(root.join("__MACOSX/ignored.cbz"), b"ignored").unwrap();
        let canonical_root = root.canonicalize().unwrap();

        let mut files = Vec::new();
        collect_folder_reference_files(&canonical_root, &canonical_root, 0, &mut files).unwrap();
        files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        let relative: Vec<&str> = files
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect();
        assert_eq!(relative, vec!["book.epub", "nested/001.jpg"]);
        assert_eq!(
            make_folder_key(&canonical_root),
            make_folder_key(&canonical_root)
        );
        assert_eq!(make_folder_key(&canonical_root).len(), TOKEN_HEX_BYTES);
        assert!(validate_selected_file(&canonical_root.join("nested/001.jpg"), true).is_ok());
        assert!(validate_selected_file(&canonical_root.join("nested/001.jpg"), false).is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_registered_file_changes_against_the_selection_baseline() {
        let path = temp_file("baseline", b"original");
        let metadata = fs::metadata(&path).unwrap();
        let record = ReferenceRecord {
            path: path.to_string_lossy().into_owned(),
            size: metadata.len(),
            last_modified: modified_ms(&metadata),
        };
        let mut reference = ResolvedReference {
            path: path.clone(),
            size: record.size,
            last_modified: record.last_modified,
        };
        ensure_unchanged_baseline(&record, &reference).unwrap();
        reference.last_modified = reference.last_modified.saturating_add(1);
        assert!(ensure_unchanged_baseline(&record, &reference)
            .unwrap_err()
            .starts_with("NATIVE_INVALID_DATA"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn writes_registry_atomically_without_leaving_a_temporary_file() {
        let root = temp_dir("registry-atomic");
        let target = root.join(REGISTRY_FILE);
        fs::write(&target, b"old").unwrap();
        write_registry_atomic(&target, b"new registry").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new registry");
        assert!(!root.join(REGISTRY_TEMP_FILE).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn range_is_bounded_and_exact() {
        assert_eq!(validate_range(16, 4, 8).unwrap(), 8);
        assert!(validate_range(16, 12, 8)
            .unwrap_err()
            .starts_with("NATIVE_INVALID_DATA"));
        assert!(validate_range(MAX_RANGE_BYTES + 1, 0, MAX_RANGE_BYTES + 1)
            .unwrap_err()
            .starts_with("NATIVE_LIMIT_EXCEEDED"));
    }

    #[test]
    fn streams_sha256_without_modifying_the_original() {
        let bytes = b"homura-reference-hash";
        let path = temp_file("hash", bytes);
        let metadata = fs::metadata(&path).unwrap();
        let reference = ResolvedReference {
            path: path.clone(),
            size: metadata.len(),
            last_modified: modified_ms(&metadata),
        };
        assert_eq!(
            hash_file(&reference).unwrap(),
            "fa5c93387f3282e8f2d1e9a1a8f073183aa8cf927a7003590d35076befa6a907"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reads_exact_range_from_original_file() {
        let path = temp_file("range", b"0123456789abcdef");
        let metadata = fs::metadata(&path).unwrap();
        let reference = ResolvedReference {
            path: path.clone(),
            size: metadata.len(),
            last_modified: modified_ms(&metadata),
        };
        assert_eq!(read_range(&reference, 4, 8).unwrap(), b"456789ab");
        assert_eq!(fs::read(&path).unwrap(), b"0123456789abcdef");
        let _ = fs::remove_file(path);
    }
}
