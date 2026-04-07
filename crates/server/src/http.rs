use std::path::{Component, Path, PathBuf};

use anyhow::Context;

pub struct AssetResponse {
    pub body: Vec<u8>,
    pub content_type: &'static str,
}

/// Loads a frontend asset from the built web bundle and injects bridge script content into
/// HTML responses when requested.
///
/// # Errors
///
/// Returns an error if the requested asset path is invalid, if the asset cannot be read from
/// disk, or if HTML injection requires invalid UTF-8 input.
pub async fn load_asset_response(
    web_dist_dir: &Path,
    request_path: &str,
    injected_head_script: Option<&str>,
) -> anyhow::Result<AssetResponse> {
    let asset_path = resolve_asset_path(web_dist_dir, request_path).await?;
    let content_type = content_type_for_path(&asset_path);
    let mut body = tokio::fs::read(&asset_path)
        .await
        .with_context(|| format!("failed to read {}", asset_path.display()))?;

    if content_type == "text/html; charset=utf-8" {
        if let Some(script) = injected_head_script {
            let html = String::from_utf8(body).context("html asset must be valid utf-8")?;
            let injected = inject_head_script(&html, script);
            body = injected.into_bytes();
        }
    }

    Ok(AssetResponse { body, content_type })
}

async fn resolve_asset_path(web_dist_dir: &Path, request_path: &str) -> anyhow::Result<PathBuf> {
    let normalized = request_path.trim_start_matches('/');
    let candidate = if normalized.is_empty() {
        PathBuf::from("index.html")
    } else {
        sanitize_relative_path(normalized)?
    };

    let direct = web_dist_dir.join(&candidate);
    if tokio::fs::try_exists(&direct).await? {
        return Ok(direct);
    }

    Ok(web_dist_dir.join("index.html"))
}

fn sanitize_relative_path(path: &str) -> anyhow::Result<PathBuf> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        anyhow::bail!("absolute asset paths are not allowed");
    }

    let mut clean = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(segment) => clean.push(segment),
            Component::CurDir => {}
            Component::ParentDir => anyhow::bail!("parent traversal is not allowed"),
            Component::RootDir | Component::Prefix(_) => {
                anyhow::bail!("unexpected rooted asset path")
            }
        }
    }

    Ok(clean)
}

fn inject_head_script(html: &str, script: &str) -> String {
    let injection = format!("<script>{script}</script>");
    if let Some(index) = html.find("</head>") {
        let mut out = String::with_capacity(html.len() + injection.len());
        out.push_str(&html[..index]);
        out.push_str(&injection);
        out.push_str(&html[index..]);
        return out;
    }

    let mut out = String::with_capacity(html.len() + injection.len());
    out.push_str(&injection);
    out.push_str(html);
    out
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("ico") => "image/x-icon",
        Some("jpeg" | "jpg") => "image/jpeg",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("txt") => "text/plain; charset=utf-8",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}
