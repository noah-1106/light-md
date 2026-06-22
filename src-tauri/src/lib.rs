use std::sync::Mutex;
use tauri::{DragDropEvent, Emitter, Manager, State};

#[derive(Default)]
pub struct AppState {
    pub current_file: Mutex<Option<String>>,
}

#[tauri::command]
fn read_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: &str, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_file_info(path: &str) -> Result<(String, u64), String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = metadata.len();
    let name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("untitled")
        .to_string();
    Ok((name, size))
}

#[tauri::command]
fn set_current_file(path: String, state: State<AppState>) {
    let mut current = state.current_file.lock().unwrap();
    *current = Some(path);
}

#[tauri::command]
fn get_current_file(state: State<AppState>) -> Option<String> {
    state.current_file.lock().unwrap().clone()
}

#[tauri::command]
fn rename_file(from: &str, to: &str) -> Result<(), String> {
    std::fs::rename(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_default_folder() -> String {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/Users".to_string());
    let folder = format!("{}/Documents/LightMD", home);
    let _ = std::fs::create_dir_all(&folder);
    folder
}

#[tauri::command]
fn open_folder(path: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_image(path: &str, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_binary(path: &str) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data))
}

#[tauri::command]
fn show_and_focus_window(window: tauri::Window) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn is_md_file(path: &std::path::Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    matches!(ext.to_lowercase().as_str(), "md" | "markdown" | "mdown" | "mkd")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            get_file_info,
            set_current_file,
            get_current_file,
            rename_file,
            get_default_folder,
            open_folder,
            save_image,
            read_file_binary,
            show_and_focus_window
        ])
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let file_path = args[1].clone();
                if is_md_file(std::path::Path::new(&file_path)) {
                    let app_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        let _ = app_handle.emit("open-file", file_path);
                    });
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
                            let _ = window.emit("open-file", path.to_string_lossy().to_string());
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
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app_handle, event);
            }
        });
}
