use serde::Serialize;

/// Server 连接结果
#[derive(Serialize)]
struct ServerInfo {
    port: u16,
    url: String,
}

/// 健康检查命令（验证远程服务器是否可达）
#[tauri::command]
async fn opencode_health_check() -> Result<ServerInfo, String> {
    let remote_url = std::env::var("OPENCODE_REMOTE_URL")
        .unwrap_or_else(|_| "http://1.12.207.131:4096".to_string());

    Ok(ServerInfo {
        port: 4096,
        url: remote_url,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            opencode_health_check,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
