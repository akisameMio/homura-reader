/* ============================================================================
HOMURA · WebDAV 远程阅读
----------------------------------------------------------------------------
只允许配置根目录内的 PROPFIND 与有界 Range GET；不写入书本文件，不跟随
重定向，不把密码或服务器错误正文返回给日志。
========================================================================== */
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{header, Method, Url};
use serde::Serialize;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const PROPFIND: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>"#;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResponse {
    status: u16,
    body: String,
    content_range: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
}

fn scoped_url(root: &str, raw: &str) -> Result<Url, String> {
    let root = Url::parse(root).map_err(|_| "WebDAV 地址无效")?;
    let url = Url::parse(raw).map_err(|_| "WebDAV 地址无效")?;
    let loopback = matches!(root.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if raw.len() > 4096
        || root.as_str().len() > 4096
        || !(root.scheme() == "https" || root.scheme() == "http" && loopback)
        || !root.username().is_empty()
        || root.password().is_some()
        || root.query().is_some()
        || root.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !root.path().ends_with('/')
        || url.origin() != root.origin()
        || !url.path().starts_with(root.path())
    {
        return Err("NATIVE_SECURITY_LIMIT: WebDAV 路径超出配置目录".into());
    }
    // 禁止编码后的分隔符和双重编码，避免代理与源站解码层数不一致。
    for part in url.path().split('/') {
        let bytes = part.as_bytes();
        let mut decoded = Vec::new();
        let mut index = 0;
        while index < bytes.len() {
            let byte = if bytes[index] == b'%' {
                let hex = part
                    .get(index + 1..index + 3)
                    .ok_or("WebDAV 路径编码无效")?;
                index += 2;
                u8::from_str_radix(hex, 16).map_err(|_| "WebDAV 路径编码无效")?
            } else {
                bytes[index]
            };
            if byte < 32 || matches!(byte, 127 | b'/' | b'\\' | b'%') {
                return Err("NATIVE_SECURITY_LIMIT: WebDAV 路径无效".into());
            }
            decoded.push(byte);
            index += 1;
        }
        if decoded == b"." || decoded == b".." {
            return Err("NATIVE_SECURITY_LIMIT: WebDAV 路径无效".into());
        }
    }
    Ok(url)
}

fn range_size(value: &str) -> Option<usize> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start: u64 = start.parse().ok()?;
    let end: u64 = end.parse().ok()?;
    let size = end.checked_sub(start)?.checked_add(1)?;
    (size <= MAX_BYTES as u64).then_some(size as usize)
}

#[tauri::command]
pub async fn webdav_read(
    root: String,
    url: String,
    username: String,
    password: String,
    method: String,
    range: Option<String>,
    validator: Option<String>,
    modified: Option<String>,
) -> Result<ReadResponse, String> {
    let url = scoped_url(&root, &url)?;
    if username.len() > 2048
        || password.len() > 32768
        || username.contains([':', '\r', '\n', '\0'])
        || password.contains(['\r', '\n', '\0'])
    {
        return Err("WebDAV 账号或密码格式无效".into());
    }
    let limit = match method.as_str() {
        "PROPFIND" if range.is_none() && url.path().ends_with('/') => MAX_BYTES,
        "GET" => range
            .as_deref()
            .and_then(range_size)
            .ok_or("WebDAV Range 无效")?,
        _ => return Err("WebDAV 读取方法无效".into()),
    };
    let client = crate::sync_webdav::http_client()?;
    let mut request = client
        .request(
            Method::from_bytes(method.as_bytes()).map_err(|_| "WebDAV 方法无效")?,
            url,
        )
        .header(header::ACCEPT_ENCODING, "identity");
    if !username.is_empty() || !password.is_empty() {
        request = request.basic_auth(username, Some(password));
    }
    if method == "PROPFIND" {
        request = request
            .header("Depth", "1")
            .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(PROPFIND);
    }
    if let Some(range) = range {
        request = request.header(header::RANGE, range);
    }
    if let Some(validator) = validator {
        request = request.header(header::IF_MATCH, validator);
    } else if let Some(modified) = modified {
        request = request.header(header::IF_UNMODIFIED_SINCE, modified);
    }
    let mut response = request.send().await.map_err(|_| "WebDAV 网络请求失败")?;
    let status = response.status().as_u16();
    let field = |name| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let content_range = field(header::CONTENT_RANGE);
    let etag = field(header::ETAG);
    let last_modified = field(header::LAST_MODIFIED);
    // 非预期状态只返回状态码，尤其不能接收服务器忽略 Range 后返回的整本书。
    let mut bytes = Vec::new();
    if method == "PROPFIND" && status == 207 || method == "GET" && status == 206 {
        if response
            .content_length()
            .is_some_and(|size| size > limit as u64)
        {
            return Err("NATIVE_LIMIT_EXCEEDED: 远端响应超限".into());
        }
        while let Some(chunk) = response.chunk().await.map_err(|_| "WebDAV 响应读取失败")? {
            if bytes.len() + chunk.len() > limit {
                return Err("NATIVE_LIMIT_EXCEEDED: 远端响应超限".into());
            }
            bytes.extend_from_slice(&chunk);
        }
    }
    Ok(ReadResponse {
        status,
        body: STANDARD.encode(bytes),
        content_range,
        etag,
        last_modified,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_and_range_are_bounded() {
        let root = "https://dav.example/books/";
        assert!(scoped_url(root, "https://dav.example/books/%E4%B9%A6.epub").is_ok());
        for url in [
            "https://evil.example/books/a",
            "https://dav.example/books2/a",
            "https://dav.example/books/%2fetc",
            "https://dav.example/books/%252e%252e/a",
            "https://dav.example/books/%5cetc",
            "https://u:p@dav.example/books/a",
            "https://dav.example/books/a?q=1",
        ] {
            assert!(scoped_url(root, url).is_err(), "{url}");
        }
        assert_eq!(range_size("bytes=0-0"), Some(1));
        for value in [
            "bytes=0-",
            "bytes=1-0",
            "bytes=0-8388608",
            "bytes=0-1,3-4",
            "bytes=-1",
        ] {
            assert!(range_size(value).is_none());
        }
    }
    #[test]
    fn read_requests_are_scoped_and_never_accept_whole_books() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;
        for (method, raw, expected) in [
            ("PROPFIND", "HTTP/1.1 207 Multi-Status\r\nContent-Length: 4\r\n\r\n<d/>", 207),
            ("GET", "HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nContent-Range: bytes 0-0/100\r\nETag: \"v1\"\r\n\r\nx", 206),
            ("GET", "HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\n\r\n", 200),
            ("GET", "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/secret\r\nContent-Length: 0\r\n\r\n", 302),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let root = format!("http://{}/books/", listener.local_addr().unwrap());
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() { break; }
                    headers.push_str(&line);
                }
                let headers = headers.to_ascii_lowercase();
                assert!(headers.starts_with(&method.to_ascii_lowercase()));
                let auth = format!("authorization: basic {}", STANDARD.encode("user:pass")).to_ascii_lowercase();
                assert!(headers.contains(&auth));
                if method == "PROPFIND" { assert!(headers.contains("depth: 1")); }
                else { assert!(headers.contains("range: bytes=0-0")); assert!(headers.contains("if-match: \"v1\"")); }
                stream.write_all(raw.as_bytes()).unwrap();
            });
            let range = (method == "GET").then(|| "bytes=0-0".into());
            let result = tauri::async_runtime::block_on(webdav_read(root.clone(), root, "user".into(), "pass".into(), method.into(), range, Some("\"v1\"".into()), None)).unwrap();
            assert_eq!(result.status, expected);
            if expected == 200 || expected == 302 { assert!(result.body.is_empty()); }
            if expected == 206 { assert_eq!(STANDARD.decode(result.body).unwrap(), b"x"); assert_eq!(result.content_range.as_deref(), Some("bytes 0-0/100")); }
            worker.join().unwrap();
        }
    }
}
