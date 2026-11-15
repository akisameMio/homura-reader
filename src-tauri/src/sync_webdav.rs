/* ============================================================================
HOMURA · WebDAV 元数据同步与原文件指纹
----------------------------------------------------------------------------
原生网络只访问已配置目录中的固定文档，保留 TLS 校验与条件写入；文件指纹
只允许读取应用私有原文件目录，按块处理，不把整本书搬进 WebView。
========================================================================== */

use reqwest::{header, Client, Method, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};
#[cfg(target_os = "android")]
use webpki_root_certs::TLS_SERVER_ROOT_CERTS;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Serialize)]
pub struct DavResponse {
    status: u16,
    etag: Option<String>,
    body: String,
}

fn endpoint(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "WebDAV 地址无效".to_string())?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if raw.len() > 4096
        || !(url.scheme() == "https" || url.scheme() == "http" && loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().ends_with("/homura-sync-v1.json")
    {
        return Err("WebDAV 地址须使用 HTTPS 且指向固定同步文档".into());
    }
    Ok(url)
}

fn strong_etag(value: &str) -> bool {
    value.len() <= 1024
        && value.starts_with('"')
        && value.ends_with('"')
        && value.len() >= 2
        && value.as_bytes()[1..value.len() - 1]
            .iter()
            .all(|byte| *byte == 0x21 || (0x23..=0x7e).contains(byte) || *byte >= 0x80)
}

async fn request(
    raw_url: String,
    username: String,
    password: String,
    method: String,
    body: Option<String>,
    etag: Option<String>,
) -> Result<DavResponse, String> {
    let url = endpoint(&raw_url)?;
    if username.len() > 2048
        || password.len() > 32768
        || username.contains([':', '\r', '\n', '\0'])
        || password.contains(['\r', '\n', '\0'])
        || body.as_ref().is_some_and(|body| body.len() > MAX_BYTES)
        || etag.as_ref().is_some_and(|tag| !strong_etag(tag))
    {
        return Err("WebDAV 请求参数无效或超过限制".into());
    }
    let method = match method.as_str() {
        "GET" if body.is_none() => Method::GET,
        "PUT" if body.is_some() => Method::PUT,
        "OPTIONS" if body.is_none() => Method::OPTIONS,
        _ => return Err("WebDAV 请求方法无效".into()),
    };
    let builder = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("HOMURA/", env!("CARGO_PKG_VERSION")));
    // 与更新下载器一样，Android 使用随包根证书，避免未初始化 JNI 校验器。
    #[cfg(target_os = "android")]
    let builder = builder.tls_certs_only(
        TLS_SERVER_ROOT_CERTS
            .iter()
            .map(|certificate| reqwest::Certificate::from_der(certificate.as_ref()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "WebDAV TLS 初始化失败".to_string())?,
    );
    #[cfg(test)]
    let builder = builder.no_proxy();
    let client = builder
        .build()
        .map_err(|_| "WebDAV 网络初始化失败".to_string())?;
    let mut request = client
        .request(method.clone(), url)
        .header(header::ACCEPT, "application/json");
    if !username.is_empty() || !password.is_empty() {
        request = request.basic_auth(username, Some(password));
    }
    if method == Method::PUT {
        request = request.header(header::CONTENT_TYPE, "application/json; charset=utf-8");
        request = match etag {
            Some(etag) => request.header(header::IF_MATCH, etag),
            None => request.header(header::IF_NONE_MATCH, "*"),
        };
        request = request.body(body.unwrap_or_default());
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "WebDAV 网络请求失败".to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return Err("NATIVE_LIMIT_EXCEEDED: 远端同步文档超过 8 MiB 上限".into());
    }
    let status = response.status().as_u16();
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "WebDAV 响应读取失败".to_string())?
    {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("NATIVE_LIMIT_EXCEEDED: 远端同步文档超过 8 MiB 上限".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| "远端同步文档编码无效".to_string())?;
    Ok(DavResponse { status, etag, body })
}

#[tauri::command]
pub async fn sync_webdav_request(
    url: String,
    username: String,
    password: String,
    method: String,
    body: Option<String>,
    etag: Option<String>,
) -> Result<DavResponse, String> {
    request(url, username, password, method, body, etag).await
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FingerprintSource {
    File {
        #[serde(rename = "nativePath")]
        native_path: String,
    },
    Folder {
        entries: Vec<FingerprintEntry>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FingerprintEntry {
    relative_path: String,
    native_path: String,
}

fn source_path(data_root: &Path, raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() || raw.len() > 4096 {
        return Err("NATIVE_INVALID_DATA: 原文件路径无效".into());
    }
    let root = data_root
        .join("homura-native-sources")
        .canonicalize()
        .map_err(|_| "NATIVE_INVALID_DATA: 原文件目录不可用".to_string())?;
    let candidate = Path::new(raw);
    if candidate
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("NATIVE_SECURITY_LIMIT: 原文件路径包含目录穿越".into());
    }
    let candidate = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        data_root.join(candidate)
    };
    let file = candidate
        .canonicalize()
        .map_err(|_| "NATIVE_INVALID_DATA: 原文件不存在".to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("NATIVE_SECURITY_LIMIT: 原文件路径不在存档目录内".into());
    }
    Ok(file)
}

fn file_digest(path: PathBuf) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|_| "NATIVE_INVALID_DATA: 原文件无法读取".to_string())?;
    let expected = file
        .metadata()
        .map_err(|_| "NATIVE_INVALID_DATA: 原文件信息不可用".to_string())?;
    if expected.len() > MAX_SOURCE_BYTES {
        return Err("NATIVE_LIMIT_EXCEEDED: 原文件超过 16 GiB 上限".into());
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut read_bytes = 0u64;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "NATIVE_INVALID_DATA: 原文件读取失败".to_string())?;
        if read == 0 {
            break;
        }
        read_bytes += read as u64;
        if read_bytes > MAX_SOURCE_BYTES {
            return Err("NATIVE_LIMIT_EXCEEDED: 原文件超过 16 GiB 上限".into());
        }
        hasher.update(&buffer[..read]);
    }
    let actual = file
        .metadata()
        .map_err(|_| "NATIVE_INVALID_DATA: 原文件信息不可用".to_string())?;
    if read_bytes != expected.len()
        || actual.modified().ok() != expected.modified().ok()
        || actual.len() != expected.len()
    {
        return Err("NATIVE_INVALID_DATA: 计算指纹时原文件已变化".into());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn fingerprint(data_root: &Path, source: FingerprintSource) -> Result<String, String> {
    let digest = match source {
        FingerprintSource::File { native_path } => {
            file_digest(source_path(data_root, &native_path)?)?
        }
        FingerprintSource::Folder { mut entries } => {
            if entries.is_empty() || entries.len() > 20_000 {
                return Err("NATIVE_LIMIT_EXCEEDED: 图片文件夹条目数量无效".into());
            }
            // JavaScript 默认排序比较 UTF-16 码元，避免非 BMP 文件名在两端顺序不同。
            entries.sort_by(|a, b| {
                a.relative_path
                    .encode_utf16()
                    .cmp(b.relative_path.encode_utf16())
            });
            let mut manifest = Vec::with_capacity(entries.len());
            let mut previous: Option<String> = None;
            for entry in entries {
                if entry.relative_path.is_empty()
                    || entry.relative_path.len() > 4096
                    || entry.relative_path.contains(['\\', '\0'])
                    || entry.relative_path.starts_with('/')
                    || entry
                        .relative_path
                        .split('/')
                        .any(|part| part == "." || part == ".." || part.is_empty())
                    || previous.as_ref() == Some(&entry.relative_path)
                {
                    return Err("NATIVE_INVALID_DATA: 图片文件夹相对路径无效".into());
                }
                previous = Some(entry.relative_path.clone());
                manifest.push((
                    entry.relative_path,
                    file_digest(source_path(data_root, &entry.native_path)?)?,
                ));
            }
            let bytes = serde_json::to_vec(&manifest)
                .map_err(|_| "NATIVE_INVALID_DATA: 图片清单无效".to_string())?;
            format!("{:x}", Sha256::digest(bytes))
        }
    };
    Ok(format!("sha256:{digest}"))
}

#[tauri::command]
pub async fn sync_fingerprint_source(
    app: AppHandle,
    source: FingerprintSource,
) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "NATIVE_UNAVAILABLE: AppData 不可用".to_string())?;
    tauri::async_runtime::spawn_blocking(move || fingerprint(&root, source))
        .await
        .map_err(|_| "NATIVE_COMMAND_FAILED: 指纹任务未完成".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    #[test]
    fn endpoint_and_etag_reject_unsafe_values() {
        assert!(endpoint("https://dav.example/files/homura-sync-v1.json").is_ok());
        for url in [
            "http://dav.example/homura-sync-v1.json",
            "https://user:pass@dav.example/homura-sync-v1.json",
            "https://dav.example/other.json",
            "https://dav.example/homura-sync-v1.json?q=1",
        ] {
            assert!(endpoint(url).is_err());
        }
        assert!(strong_etag("\"v1\""));
        assert!(!strong_etag("W/\"v1\""));
        assert!(!strong_etag("\"v1\"\r\nx: 1"));
    }

    #[test]
    fn conditional_put_and_response_limits() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://{}/homura-sync-v1.json",
            listener.local_addr().unwrap()
        );
        let worker = std::thread::spawn(move || {
            for expected in ["if-none-match: *", "if-match: \"v1\""] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut lines = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    lines.push_str(&line);
                }
                assert!(lines.to_lowercase().contains(expected));
                stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            }
        });
        for etag in [None, Some("\"v1\"".into())] {
            let result = tauri::async_runtime::block_on(request(
                url.clone(),
                "".into(),
                "".into(),
                "PUT".into(),
                Some("{}".into()),
                etag,
            ))
            .unwrap();
            assert_eq!(result.status, 204);
        }
        worker.join().unwrap();
        assert!(tauri::async_runtime::block_on(request(
            url,
            "".into(),
            "".into(),
            "PUT".into(),
            Some("x".repeat(MAX_BYTES + 1)),
            None
        ))
        .is_err());
    }

    #[test]
    fn fingerprint_is_streamed_and_scoped() {
        let root =
            std::env::temp_dir().join(format!("homura-sync-fingerprint-{}", std::process::id()));
        let source = root.join("homura-native-sources");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("a.txt"), b"abc").unwrap();
        let digest = fingerprint(
            &root,
            FingerprintSource::File {
                native_path: "homura-native-sources/a.txt".into(),
            },
        )
        .unwrap();
        assert_eq!(
            digest,
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(source_path(&root, "homura-native-sources/../outside").is_err());
        std::fs::write(root.join("outside"), b"secret").unwrap();
        assert!(source_path(&root, root.join("outside").to_str().unwrap()).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("outside"), source.join("link")).unwrap();
            assert!(source_path(&root, "homura-native-sources/link").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn folder_fingerprint_matches_javascript_utf16_and_json() {
        let root = std::env::temp_dir().join(format!("homura-sync-folder-{}", std::process::id()));
        let source = root.join("homura-native-sources");
        std::fs::create_dir_all(&source).unwrap();
        let mut entries = Vec::new();
        for (index, (path, content)) in [
            ("😀.jpg", "emoji"),
            ("\u{e000}.jpg", "private"),
            ("中\".jpg", "quote"),
            ("a.jpg", "ascii"),
        ]
        .iter()
        .enumerate()
        {
            let native_path = format!("homura-native-sources/{index}");
            std::fs::write(root.join(&native_path), content.as_bytes()).unwrap();
            entries.push(FingerprintEntry {
                relative_path: (*path).into(),
                native_path,
            });
        }
        assert_eq!(
            fingerprint(&root, FingerprintSource::Folder { entries }).unwrap(),
            "sha256:6c30f67403dfc095959141db9301f36212cdd503f3bc35dd57d818af96b46c1b"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn response_size_is_bounded_and_redirect_is_not_followed() {
        for raw in [
            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", MAX_BYTES + 1),
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/homura-sync-v1.json", listener.local_addr().unwrap());
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop { let mut line = String::new(); reader.read_line(&mut line).unwrap(); if line == "\r\n" { break; } }
                stream.write_all(raw.as_bytes()).unwrap();
            });
            let result = tauri::async_runtime::block_on(request(url, "".into(), "".into(), "GET".into(), None, None));
            match result {
                Ok(response) => assert_eq!(response.status, 302),
                Err(error) => assert!(error.starts_with("NATIVE_LIMIT_EXCEEDED")),
            }
            worker.join().unwrap();
        }
    }
}
