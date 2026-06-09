use std::process::Command;
use std::path::Path;
use std::fs;

fn main() {
    let opencode_bin = Path::new("opencode-bin/opencode-x86_64-pc-windows-msvc.exe");

    // 如果编译好的 exe 不存在，从源码自动构建
    if !opencode_bin.exists() {
        build_opencode(opencode_bin);
    }

    // exe 变化时重新打包
    println!("cargo:rerun-if-changed=opencode-bin/opencode-x86_64-pc-windows-msvc.exe");

    tauri_build::build()
}

fn build_opencode(target: &Path) {
    let source_dir = Path::new("../opencode/packages/opencode");
    if !source_dir.exists() {
        panic!(
            "OpenCode 源码未找到: {:?}\n请确保 opencode/ 目录在项目根目录下",
            source_dir
        );
    }

    // 查找 bun
    let bun = find_bun();

    println!("cargo:warning=正在从源码编译 OpenCode...");

    // 编译：bun script/build.ts --single --skip-embed-web-ui
    let status = Command::new(&bun)
        .args(["script/build.ts", "--single", "--skip-embed-web-ui"])
        .current_dir(source_dir)
        .env("BUN_INSTALL", "")
        .status()
        .expect("无法运行 bun build");

    if !status.success() {
        panic!("OpenCode 编译失败，请查看上方错误");
    }

    // 找到编译产物
    let built = source_dir.join("dist/opencode-windows-x64/bin/opencode.exe");
    if !built.exists() {
        // 有些版本不带 .exe 后缀
        let built_alt = source_dir.join("dist/opencode-windows-x64/bin/opencode");
        if !built_alt.exists() {
            panic!("编译完成但找不到产物: {:?}", built);
        }
        fs::create_dir_all("opencode-bin").ok();
        fs::copy(&built_alt, target).expect("复制 opencode 二进制失败");
    } else {
        fs::create_dir_all("opencode-bin").ok();
        fs::copy(&built, target).expect("复制 opencode 二进制失败");
    }

    println!("cargo:warning=OpenCode 编译成功！");
}

fn find_bun() -> std::path::PathBuf {
    // 1. 系统 PATH
    if let Ok(output) = Command::new("where").arg("bun.exe").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout);
            if let Some(first) = path.lines().next() {
                let p = first.trim();
                if !p.is_empty() && Path::new(p).exists() {
                    return std::path::PathBuf::from(p);
                }
            }
        }
    }

    // 2. 默认安装路径
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Administrator".to_string());
    let default_path = format!("{}\\.bun\\bin\\bun.exe", home);
    if Path::new(&default_path).exists() {
        return std::path::PathBuf::from(default_path);
    }

    panic!("未找到 Bun，请安装: https://bun.sh");
}
