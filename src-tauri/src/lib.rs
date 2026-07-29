use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State};

mod bookmark;

#[derive(Default)]
pub struct AppState {
    pub current_file: Mutex<Option<String>>,
    pub default_folder: Mutex<Option<String>>,
    pub default_folder_bookmark: Mutex<Option<Vec<u8>>>,
    pub dir_bookmarks: Mutex<HashMap<String, Vec<u8>>>,
    pub bookmarks_path: Mutex<Option<PathBuf>>,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct BookmarksStore {
    version: u32,
    default_folder: Option<String>,
    default_folder_bookmark: Option<String>,
    dir_bookmarks: HashMap<String, String>,
}

fn bookmarks_path(state: &AppState) -> Option<PathBuf> {
    state.bookmarks_path.lock().unwrap().clone()
}

fn load_bookmarks(app: &AppHandle) -> Result<BookmarksStore, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {}", e))?
        .join("bookmarks.json");
    if !path.exists() {
        return Ok(BookmarksStore::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("read bookmarks failed: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("parse bookmarks failed: {}", e))
}

fn save_bookmarks(state: &AppState, store: &BookmarksStore) -> Result<(), String> {
    let path = bookmarks_path(state).ok_or("bookmarks path not set")?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| format!("write bookmarks failed: {}", e))
}

fn apply_bookmarks_to_state(state: &AppState, store: BookmarksStore) {
    *state.default_folder.lock().unwrap() = store.default_folder;
    *state.default_folder_bookmark.lock().unwrap() = store
        .default_folder_bookmark
        .and_then(|b| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b).ok());
    let mut bm = state.dir_bookmarks.lock().unwrap();
    bm.clear();
    for (k, v) in store.dir_bookmarks {
        if let Ok(bytes) = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, v) {
            bm.insert(k, bytes);
        }
    }
}

fn store_from_state(state: &AppState) -> BookmarksStore {
    let default_folder = state.default_folder.lock().unwrap().clone();
    let default_folder_bookmark = state
        .default_folder_bookmark
        .lock()
        .unwrap()
        .as_ref()
        .map(|b| base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b));
    let dir_bookmarks: HashMap<String, String> = state
        .dir_bookmarks
        .lock()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, v),
            )
        })
        .collect();
    BookmarksStore {
        version: 1,
        default_folder,
        default_folder_bookmark,
        dir_bookmarks,
    }
}

fn resolve_access(state: &AppState, path: &str) -> Option<bookmark::ScopedURL> {
    let default = state.default_folder.lock().unwrap();
    if let Some(ref folder) = *default {
        if path == folder || path.starts_with(&format!("{}/", folder)) {
            let bookmark = state.default_folder_bookmark.lock().unwrap();
            if let Some(ref data) = *bookmark {
                if let Ok(scoped) = bookmark::resolve_bookmark(data) {
                    return Some(scoped);
                }
            }
        }
    }
    drop(default);

    let bookmarks = state.dir_bookmarks.lock().unwrap();
    let mut matches: Vec<(String, Vec<u8>)> = bookmarks
        .iter()
        .filter(|(dir, _)| path == *dir || path.starts_with(&format!("{}/", dir)))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    matches.sort_by_key(|(k, _)| k.len());
    matches.reverse();

    for (_, data) in matches {
        if let Ok(scoped) = bookmark::resolve_bookmark(&data) {
            return Some(scoped);
        }
    }
    None
}

fn with_path_access<F, T>(state: &AppState, path: &str, f: F) -> Result<T, String>
where
    F: FnOnce(&str) -> Result<T, String>,
{
    if let Some(_scoped) = resolve_access(state, path) {
        f(path)
    } else {
        f(path)
    }
}

fn ensure_dir_bookmark(state: &AppState, path: &str) -> Result<(), String> {
    let dir = Path::new(path)
        .parent()
        .ok_or("path has no parent directory")?
        .to_string_lossy()
        .to_string();
    if state.dir_bookmarks.lock().unwrap().contains_key(&dir) {
        return Ok(());
    }
    let data = bookmark::create_bookmark(&dir)?;
    state.dir_bookmarks.lock().unwrap().insert(dir, data);
    save_bookmarks(state, &store_from_state(state))
}

fn is_md_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    matches!(ext.to_lowercase().as_str(), "md" | "markdown" | "mdown" | "mkd")
}

#[tauri::command]
fn read_file(path: &str, state: State<AppState>) -> Result<String, String> {
    with_path_access(&state, path, |p| {
        std::fs::read_to_string(p).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn write_file(path: &str, content: &str, state: State<AppState>) -> Result<(), String> {
    with_path_access(&state, path, |p| std::fs::write(p, content).map_err(|e| e.to_string()))
}

#[tauri::command]
fn get_file_info(path: &str, state: State<AppState>) -> Result<(String, u64), String> {
    with_path_access(&state,
        path,
        |p| {
            let metadata = std::fs::metadata(p).map_err(|e| e.to_string())?;
            let size = metadata.len();
            let name = Path::new(p)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("untitled")
                .to_string();
            Ok((name, size))
        },
    )
}

#[tauri::command]
fn set_current_file(path: String, state: State<AppState>) {
    *state.current_file.lock().unwrap() = Some(path);
}

#[tauri::command]
fn get_current_file(state: State<AppState>) -> Option<String> {
    state.current_file.lock().unwrap().clone()
}

#[tauri::command]
fn rename_file(from: &str, to: &str, state: State<AppState>) -> Result<(), String> {
    let _from = resolve_access(&state, from);
    let _to = resolve_access(&state, to);
    std::fs::rename(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_default_folder(state: State<AppState>) -> String {
    state.default_folder.lock().unwrap().clone().unwrap_or_default()
}

#[tauri::command]
fn get_suggested_default_folder() -> String {
    dirs::document_dir()
        .map(|p| p.join("LightMD").to_string_lossy().to_string())
        .unwrap_or_else(|| "/Users".to_string())
}

#[tauri::command]
fn get_container_documents_folder(app: AppHandle) -> Result<String, String> {
    let folder = app
        .path()
        .document_dir()
        .map_err(|e| format!("document_dir failed: {}", e))?
        .join("LightMD");
    std::fs::create_dir_all(&folder).map_err(|e| format!("create container folder failed: {}", e))?;
    Ok(folder.to_string_lossy().to_string())
}

#[tauri::command]
fn set_default_folder(path: String, state: State<AppState>) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("create default folder failed: {}", e))?;
    let bookmark = bookmark::create_bookmark(&path)?;

    *state.default_folder.lock().unwrap() = Some(path);
    *state.default_folder_bookmark.lock().unwrap() = Some(bookmark);

    save_bookmarks(&state,
        &store_from_state(&state))
}

#[tauri::command]
fn open_folder(path: &str, _app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tauri_plugin_opener::open_path(path, None::<&str>)
            .map_err(|e| format!("open folder failed: {}", e))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = _app;
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn save_image(path: &str, data: Vec<u8>, state: State<AppState>) -> Result<(), String> {
    with_path_access(&state,
        path,
        |p| {
            if let Some(parent) = Path::new(p).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(p, data).map_err(|e| e.to_string())
        },
    )
}

#[tauri::command]
fn read_file_binary(path: &str, state: State<AppState>) -> Result<String, String> {
    with_path_access(&state,
        path,
        |p| {
            let data = std::fs::read(p).map_err(|e| e.to_string())?;
            Ok(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &data,
            ))
        },
    )
}

#[tauri::command]
fn show_and_focus_window(window: tauri::Window) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn content_type_from_path(path: &str) -> &'static str {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .map(|e| match e.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "tiff" | "tif" => "image/tiff",
            _ => "application/octet-stream",
        })
        .unwrap_or("application/octet-stream")
}

fn image_path_from_request(request: &tauri::http::Request<Vec<u8>>) -> Option<String> {
    let path = request.uri().path();
    let rest = path.strip_prefix("/image/")?;
    percent_encoding::percent_decode_str(rest)
        .decode_utf8_lossy()
        .parse()
        .ok()
}

fn handle_image_request(
    app_handle: &AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<tauri::http::Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let path = image_path_from_request(request).ok_or("invalid image path")?;
    let state = app_handle.state::<AppState>();
    let bytes = with_path_access(&state,
        &path,
        |p| std::fs::read(p).map_err(|e| e.to_string()),
    )?;
    let content_type = content_type_from_path(&path);
    let response = tauri::http::Response::builder()
        .header("Content-Type", content_type)
        .body(bytes)?;
    Ok(response)
}

fn emit_open_file(app_handle: &AppHandle, path: String) {
    let app_handle = app_handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let _ = app_handle.emit("open-file", path);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            get_file_info,
            set_current_file,
            get_current_file,
            rename_file,
            get_default_folder,
            get_suggested_default_folder,
            get_container_documents_folder,
            set_default_folder,
            open_folder,
            save_image,
            read_file_binary,
            show_and_focus_window
        ])
        .register_uri_scheme_protocol("lightmd", move |ctx, request| {
            handle_image_request(ctx.app_handle(), &request)
                .unwrap_or_else(|_| {
                    tauri::http::Response::builder()
                        .status(404)
                        .body(vec![])
                        .unwrap()
                })
        })
        .setup(|app| {
            let bookmarks_path = app
                .path()
                .app_data_dir()
                .map(|p| p.join("bookmarks.json"))
                .ok();
            let state = app.state::<AppState>();
            *state.bookmarks_path.lock().unwrap() = bookmarks_path;

            if let Ok(store) = load_bookmarks(app.handle()) {
                apply_bookmarks_to_state(&state, store);
            }

            if state.default_folder.lock().unwrap().is_none() {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = app_handle.emit("request-default-folder", ());
                });
            }

            // Cold-start file open from argv (mainly non-macOS or fallback)
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let file_path = args[1].clone();
                if is_md_file(Path::new(&file_path)) {
                    let app_handle = app.handle().clone();
                    let _ = ensure_dir_bookmark(&state, &file_path);
                    emit_open_file(&app_handle, file_path);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                    for path in paths {
                        if is_md_file(path) {
                            let path_str = path.to_string_lossy().to_string();
                            let app_handle = window.app_handle();
                            let state = app_handle.state::<AppState>();
                            let _ = ensure_dir_bookmark(&state, &path_str);
                            let _ = window.emit("open-file", path_str);
                        }
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                tauri::WindowEvent::Focused(focused) => {
                    if *focused {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                    if !has_visible_windows {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                tauri::RunEvent::Opened { urls } => {
                    let state = app_handle.state::<AppState>();
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            let path_str = path.to_string_lossy().to_string();
                            if is_md_file(&path) {
                                let _ = ensure_dir_bookmark(&state, &path_str);
                                emit_open_file(app_handle, path_str);
                            }
                        }
                    }
                }
                _ => {}
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app_handle, event);
            }
        });
}
