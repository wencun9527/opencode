use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;
use serde::Serialize;

/// OpenCode server 进程状态
struct ServerState {
    child: Option<Child>,
    port: u16,
}

/// 全局 server 状态（Mutex 保证线程安全）
static SERVER_STATE: Mutex<Option<ServerState>> = Mutex::new(None);

/// Server 启动结果
#[derive(Serialize)]
struct ServerInfo {
    port: u16,
    url: String,
}

/// 查找 bun 可执行文件
fn find_bun() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Administrator".to_string());
    let candidates = [
        format!("{}\\.bun\\bin\\bun.exe", home),
        "C:\\Users\\Administrator\\.bun\\bin\\bun.exe".to_string(),
    ];
    for candidate in &candidates {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// 构建 PATH 环境变量，确保包含 bun 所在目录
fn build_path_with_bun(bun_path: &PathBuf) -> String {
    let bun_dir = bun_path.parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();
    if bun_dir.is_empty() || current_path.contains(&bun_dir) {
        current_path
    } else {
        format!("{};{}", bun_dir, current_path)
    }
}

/// 获取项目根目录
fn get_project_root() -> Result<PathBuf, String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.parent()
        .ok_or("无法获取项目根目录".to_string())
        .map(|p| p.to_path_buf())
}

/// 从 server stdout 中解析端口号
/// 格式: "opencode server listening on http://127.0.0.1:XXXXX"
fn parse_port_from_output(line: &str) -> Option<u16> {
    // 匹配 http://hostname:port
    if let Some(start) = line.find("http://") {
        let rest = &line[start + 7..];
        // 跳过 hostname，找到冒号后的端口号
        if let Some(colon_pos) = rest.find(':') {
            let port_str = &rest[colon_pos + 1..];
            // 端口号到非数字字符截止
            let end = port_str.find(|c: char| !c.is_ascii_digit()).unwrap_or(port_str.len());
            if end > 0 {
                return port_str[..end].parse::<u16>().ok();
            }
        }
    }
    None
}

/// 启动 OpenCode server（持久化模式）
#[tauri::command]
async fn opencode_server_start(
    app: tauri::AppHandle,
    api_key: String,
    opencode_password: String,
    custom_api_base_url: String,
    port: Option<u16>,
) -> Result<ServerInfo, String> {
    // 检查是否已有 server 在运行
    {
        let state = SERVER_STATE.lock().map_err(|e| format!("锁错误: {}", e))?;
        if state.is_some() {
            // 检查进程是否还活着
            if let Some(ref ss) = *state {
                return Ok(ServerInfo {
                    port: ss.port,
                    url: format!("http://127.0.0.1:{}", ss.port),
                });
            }
        }
    }

    let project_root = get_project_root()?;
    let bun_path = find_bun();
    let path_env = bun_path.as_ref().map(|p| build_path_with_bun(p));
    let specified_port = port.unwrap_or(0);

    let compiled_exe = project_root.join("opencode-bin").join("opencode-x86_64-pc-windows-msvc.exe");

    let mut cmd = if compiled_exe.exists() {
        let mut c = Command::new(&compiled_exe);
        let mut args = vec!["serve".to_string(), "--format".to_string(), "json".to_string()];
        if specified_port > 0 {
            args.push("--port".to_string());
            args.push(specified_port.to_string());
        }
        c.args(&args)
            .env("DEEPSEEK_API_KEY", &api_key)
            .env("OPENAI_API_KEY", &api_key)
            .env("OPENCODE_SERVER_PASSWORD", &opencode_password)
            .current_dir(&project_root);
        if !custom_api_base_url.is_empty() {
            c.env("OPENAI_BASE_URL", &custom_api_base_url);
        }
        c
    } else {
        let opencode_entry = project_root.join("opencode").join("packages").join("opencode").join("src").join("index.ts");
        if !opencode_entry.exists() {
            return Err(format!("OpenCode 源码未找到: {:?}", opencode_entry));
        }
        let entry_str = opencode_entry.to_str().ok_or("路径编码错误")?;
        let bun = bun_path.ok_or("未找到 Bun，请安装: https://bun.sh")?;

        let mut c = Command::new(&bun);
        let mut args = vec!["run".to_string(), entry_str.to_string(), "serve".to_string()];
        if specified_port > 0 {
            args.push("--port".to_string());
            args.push(specified_port.to_string());
        }
        c.args(&args)
            .env("DEEPSEEK_API_KEY", &api_key)
            .env("OPENAI_API_KEY", &api_key)
            .env("OPENCODE_SERVER_PASSWORD", &opencode_password)
            .current_dir(&project_root);
        if !custom_api_base_url.is_empty() {
            c.env("OPENAI_BASE_URL", &custom_api_base_url);
        }
        c
    };

    if let Some(ref path) = path_env {
        cmd.env("PATH", path);
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 opencode server 失败: {}", e))?;

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    // 在独立线程读取 stderr，转发为事件
    let app_err = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        let payload = serde_json::json!({
                            "type": "server_stderr",
                            "data": trimmed
                        });
                        let _ = app_err.emit("opencode-event", payload.to_string());
                    }
                }
                Err(_) => break,
            }
        }
    });

    // 从 stdout 读取直到获取端口号
    let detected_port;
    let app_out = app.clone();
    {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut found_port = None;

        // 最多等 30 秒找端口号
        let timeout = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            if std::time::Instant::now() > timeout {
                return Err("等待 server 启动超时（30秒）".to_string());
            }

            match lines.next() {
                Some(Ok(text)) => {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        // 尝试解析端口号
                        if let Some(p) = parse_port_from_output(&trimmed) {
                            found_port = Some(p);
                        }
                        // 转发 stdout 事件
                        let payload = serde_json::json!({
                            "type": "server_stdout",
                            "data": trimmed
                        });
                        let _ = app_out.emit("opencode-event", payload.to_string());
                    }
                }
                Some(Err(_)) | None => break,
            }

            if found_port.is_some() {
                break;
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        detected_port = found_port.ok_or("未能从 server 输出中解析端口号")?;
    }

    // 保存 server 状态
    {
        let mut state = SERVER_STATE.lock().map_err(|e| format!("锁错误: {}", e))?;
        *state = Some(ServerState {
            child: Some(child),
            port: detected_port,
        });
    }

    Ok(ServerInfo {
        port: detected_port,
        url: format!("http://127.0.0.1:{}", detected_port),
    })
}

/// 查询 server 状态
#[tauri::command]
async fn opencode_server_status() -> Result<ServerInfo, String> {
    let state = SERVER_STATE.lock().map_err(|e| format!("锁错误: {}", e))?;
    match *state {
        Some(ref ss) => Ok(ServerInfo {
            port: ss.port,
            url: format!("http://127.0.0.1:{}", ss.port),
        }),
        None => Err("server 未运行".to_string()),
    }
}

/// 停止 server
#[tauri::command]
async fn opencode_server_stop() -> Result<String, String> {
    let mut state = SERVER_STATE.lock().map_err(|e| format!("锁错误: {}", e))?;
    match state.take() {
        Some(mut ss) => {
            if let Some(ref mut child) = ss.child {
                // 尝试优雅终止
                let _ = child.kill();
                let _ = child.wait();
            }
            Ok("server 已停止".to_string())
        }
        None => Err("server 未运行".to_string()),
    }
}

/// 原有的 opencode_run 命令（作为 fallback 保留）
#[tauri::command]
async fn opencode_run(
    app: tauri::AppHandle,
    message: String,
    api_key: String,
    session_id: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.parent()
        .ok_or("无法获取项目根目录")?
        .to_path_buf();

    let bun_path = find_bun();
    let path_env = bun_path.as_ref().map(|p| build_path_with_bun(p));

    let compiled_exe = manifest_dir.join("opencode-bin").join("opencode-x86_64-pc-windows-msvc.exe");

    let mut child = if compiled_exe.exists() {
        let mut cmd = Command::new(&compiled_exe);
        let mut args = vec!["run".to_string(), "--format".to_string(), "json".to_string()];
        // 会话继续：如果提供了 session_id，使用 --session 参数
        if let Some(ref sid) = session_id {
            args.push("--session".to_string());
            args.push(sid.clone());
        }
        // Model 选择
        if let Some(ref m) = model {
            args.push("--model".to_string());
            args.push(m.clone());
        }
        args.push(message);
        cmd.args(&args)
            .env("DEEPSEEK_API_KEY", &api_key)
            .current_dir(&project_root);
        if let Some(ref path) = path_env {
            cmd.env("PATH", path);
        }
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 opencode 失败: {}", e))?
    } else {
        let opencode_entry = project_root.join("opencode").join("packages").join("opencode").join("src").join("index.ts");
        if !opencode_entry.exists() {
            return Err(format!("OpenCode 源码未找到: {:?}", opencode_entry));
        }
        let entry_str = opencode_entry.to_str().ok_or("路径编码错误")?;
        let bun = bun_path.ok_or("未找到 Bun，请安装: https://bun.sh")?;

        let mut cmd = Command::new(&bun);
        let mut args = vec!["run".to_string(), entry_str.to_string(), "run".to_string(), "--format".to_string(), "json".to_string()];
        if let Some(ref sid) = session_id {
            args.push("--session".to_string());
            args.push(sid.clone());
        }
        if let Some(ref m) = model {
            args.push("--model".to_string());
            args.push(m.clone());
        }
        args.push(message);
        cmd.args(&args)
            .env("DEEPSEEK_API_KEY", &api_key)
            .current_dir(&project_root);
        if let Some(ref path) = path_env {
            cmd.env("PATH", path);
        }
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 opencode 失败: {}", e))?
    };

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    // 读取 stderr 的线程
    let app_stderr = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        let payload = serde_json::json!({
                            "type": "stderr",
                            "data": trimmed
                        });
                        let _ = app_stderr.emit("opencode-event", payload.to_string());
                    }
                }
                Err(_) => break,
            }
        }
    });

    // 在独立线程读取 stdout，不阻塞 Tauri 主线程
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        let _ = app.emit("opencode-event", &trimmed);
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app.emit("opencode-event", "{\"type\":\"process_exit\"}");
    });

    Ok("started".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            opencode_run,
            opencode_server_start,
            opencode_server_stop,
            opencode_server_status,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
