use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-volume-keys")
        .setup(|_app, api| {
            #[cfg(target_os = "android")]
            {
                api.register_android_plugin(
                    "com.homura.reader.volumekeys",
                    "VolumeKeysPlugin",
                )?;
            }

            #[cfg(not(target_os = "android"))]
            let _ = api;

            Ok(())
        })
        .build()
}
