// 窗口状态记忆（仅桌面端）
//
// 记忆上次退出时的窗口尺寸 / 位置 / 最大化状态，下次启动在窗口显示前恢复。
// 状态写在 $APPDATA/homura-window-state.json；最大化时不覆盖普通窗口几何，
// 全屏与最小化状态不持久化，避免下次启动直接把用户锁进全屏。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, Manager, Monitor, PhysicalPosition, WebviewWindow, WindowEvent};

const FILE_NAME: &str = "homura-window-state.json";
const MIN_WIDTH: f64 = 900.0;
const MIN_HEIGHT: f64 = 600.0;
const MIN_VISIBLE: f64 = 80.0;
const MAX_DIMENSION: f64 = 20_000.0;
const SAVE_DEBOUNCE: Duration = Duration::from_millis(350);

static HAS_SAVED_STATE: AtomicBool = AtomicBool::new(false);
static RESTORE_MAXIMIZED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedState {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    maximized: bool,
}

impl SavedState {
    fn is_sane(&self) -> bool {
        self.width.is_finite()
            && self.height.is_finite()
            && (100.0..=MAX_DIMENSION).contains(&self.width)
            && (100.0..=MAX_DIMENSION).contains(&self.height)
    }
}

fn state_path(window: &WebviewWindow) -> Option<PathBuf> {
    window
        .app_handle()
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

fn read(window: &WebviewWindow) -> Option<SavedState> {
    let path = state_path(window)?;
    let raw = fs::read_to_string(path).ok()?;
    let state: SavedState = serde_json::from_str(&raw).ok()?;
    state.is_sane().then_some(state)
}

fn write(window: &WebviewWindow, state: &SavedState) -> std::io::Result<()> {
    let Some(path) = state_path(window) else {
        return Ok(());
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let raw = serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?;
    fs::write(path, raw)
}

// 只在普通窗口状态下取几何；最大化时 outer 尺寸等于屏幕，会污染下次的还原尺寸
fn capture(window: &WebviewWindow) -> Option<SavedState> {
    if window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || window.is_maximized().unwrap_or(false)
    {
        return None;
    }

    let scale = window.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let state = SavedState {
        x: position.x,
        y: position.y,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        maximized: false,
    };
    state.is_sane().then_some(state)
}

// 保存的窗口矩形与某块屏幕至少有 80×80 的可见交集，才认为它还在当前桌面里
fn overlaps_monitor(state: &SavedState, monitor: &Monitor) -> bool {
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return false;
    }
    let monitor_x = monitor.position().x as f64;
    let monitor_y = monitor.position().y as f64;
    let monitor_w = monitor.size().width as f64;
    let monitor_h = monitor.size().height as f64;
    let window_x = state.x as f64;
    let window_y = state.y as f64;
    let window_w = state.width * scale;
    let window_h = state.height * scale;

    let overlap_x = (window_x + window_w).min(monitor_x + monitor_w) - window_x.max(monitor_x);
    let overlap_y = (window_y + window_h).min(monitor_y + monitor_h) - window_y.max(monitor_y);

    overlap_x >= MIN_VISIBLE && overlap_y >= MIN_VISIBLE
}

pub fn restore(window: &WebviewWindow) {
    let Some(saved) = read(window) else {
        HAS_SAVED_STATE.store(false, Ordering::Relaxed);
        RESTORE_MAXIMIZED.store(false, Ordering::Relaxed);
        let _ = window.center();
        return;
    };
    HAS_SAVED_STATE.store(true, Ordering::Relaxed);
    RESTORE_MAXIMIZED.store(saved.maximized, Ordering::Relaxed);
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors
        .iter()
        .find(|monitor| overlaps_monitor(&saved, monitor));
    // 保存位置所在的显示器已经拔掉时，仍要按主屏尺寸收口，
    // 否则 4K 上保存的大窗口会在小屏上恢复得比屏幕还大。
    let primary = window.primary_monitor().ok().flatten();
    let clamp_monitor = monitor.or(primary.as_ref());

    let (width, height) = match clamp_monitor {
        Some(monitor) => {
            let scale = monitor.scale_factor();
            if scale <= 0.0 {
                return;
            }
            let max_width = monitor.size().width as f64 / scale;
            let max_height = monitor.size().height as f64 / scale;
            (
                saved.width.clamp(MIN_WIDTH.min(max_width), max_width),
                saved.height.clamp(MIN_HEIGHT.min(max_height), max_height),
            )
        }
        None => (saved.width.max(MIN_WIDTH), saved.height.max(MIN_HEIGHT)),
    };

    if let Err(err) = window.set_size(LogicalSize::new(width, height)) {
        eprintln!("恢复窗口尺寸失败: {err}");
    }
    // 屏幕布局变了（拔掉外接显示器等）时不恢复坐标，改为居中显示
    if monitor.is_some() {
        if let Err(err) = window.set_position(PhysicalPosition::new(saved.x, saved.y)) {
            eprintln!("恢复窗口位置失败: {err}");
        }
    } else if let Err(err) = window.center() {
        eprintln!("窗口居中失败: {err}");
    }
    if saved.maximized {
        if let Err(err) = window.maximize() {
            eprintln!("恢复窗口最大化失败: {err}");
        }
    }
}

// macOS 在窗口首次 order front 时可能把窗口挪到系统默认位置（即使此前已经
// set_position），所以显示前记下实际坐标，显示后原样补回去。
pub fn position_before_show(window: &tauri::Window) -> Option<PhysicalPosition<i32>> {
    if window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || window.is_maximized().unwrap_or(false)
    {
        return None;
    }
    window.outer_position().ok()
}

pub fn reapply_position(window: &tauri::Window, position: Option<PhysicalPosition<i32>>) {
    // 最大化同样要等窗口真正显示后再调用，macOS 在隐藏状态下会忽略该请求
    if RESTORE_MAXIMIZED.load(Ordering::Relaxed) {
        if let Err(err) = window.maximize() {
            eprintln!("显示后恢复窗口最大化失败: {err}");
        }
        return;
    }
    if !HAS_SAVED_STATE.load(Ordering::Relaxed) {
        if let Err(err) = window.center() {
            eprintln!("窗口居中失败: {err}");
        }
        return;
    }
    let Some(position) = position else {
        return;
    };
    if let Err(err) = window.set_position(position) {
        eprintln!("显示后恢复窗口位置失败: {err}");
    }
}

pub fn attach(window: WebviewWindow) {
    let (tx, rx) = mpsc::channel::<()>();
    let worker_window = window.clone();
    let initial = read(&window).or_else(|| capture(&window));

    // 移动 / 缩放事件会在拖拽时连续触发，攒到静默后再写，避免频繁落盘；
    // 写之前重新读实时几何，防止把恢复过程中的中间坐标存下来。
    std::thread::spawn(move || {
        let mut last_normal = initial;
        while rx.recv().is_ok() {
            loop {
                match rx.recv_timeout(SAVE_DEBOUNCE) {
                    Ok(()) => {}
                    Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
                }
            }
            if worker_window.is_fullscreen().unwrap_or(false)
                || worker_window.is_minimized().unwrap_or(false)
            {
                continue;
            }
            let state = if worker_window.is_maximized().unwrap_or(false) {
                // 最大化期间保留上一次的普通窗口几何，只翻转 maximized 标记
                let Some(mut state) = last_normal.clone() else {
                    continue;
                };
                state.maximized = true;
                state
            } else {
                let Some(state) = capture(&worker_window) else {
                    continue;
                };
                last_normal = Some(state.clone());
                state
            };
            let _ = write(&worker_window, &state);
        }
    });

    let tracked = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let _ = tx.send(());
        }
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            // 关闭时进程随时可能退出，直接同步写最终状态，不等防抖线程
            save_current(&tracked);
            let _ = tx.send(());
        }
        _ => {}
    });
}

pub fn save_current(window: &WebviewWindow) {
    if window.is_fullscreen().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }
    let state = if window.is_maximized().unwrap_or(false) {
        let Some(mut state) = read(window) else {
            return;
        };
        state.maximized = true;
        state
    } else {
        let Some(state) = capture(window) else {
            return;
        };
        state
    };
    let _ = write(window, &state);
}
