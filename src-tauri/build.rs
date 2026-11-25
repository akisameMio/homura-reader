fn main() {
    // 图标更新也要重编译 Windows 资源，避免只更新页面图标、EXE 仍沿用旧缓存。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");

    // Android 15+ 的 16 KB 页设备要求 native 库 ELF LOAD 段按 16 KB 对齐，
    // 否则安装 / 启动时系统会弹「不符合 16 KB 对齐」兼容性警告（Google Play 上架也强制）。
    // 经 NDK 26 的 clang/lld 链接时默认仍是 4 KB，这里显式提高；32 位 armv7 没有 16 KB 页设备，不处理。
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_os == "android" && (target_arch == "aarch64" || target_arch == "x86_64") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg=-Wl,-z,common-page-size=16384");
    }

    tauri_build::build()
}
