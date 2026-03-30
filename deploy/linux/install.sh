#!/usr/bin/env bash
# ==========================================
#  Iris 一键安装脚本
#
#  用法：curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
#
#  支持环境：
#  - Linux (x64 / arm64)：Ubuntu, Debian, CentOS, Fedora, Alpine, Arch ...
#  - Termux (Android)
#
#  工作流程：
#  1. 检测系统、架构、环境（Linux / Termux）
#  2. 安装脚本依赖（curl / git）
#  3. 从 GitHub Release 下载预编译包并解压
#  4. 初始化用户数据目录与配置模板
#  5. 安装全局 iris 命令
#  6. 安装 systemd 服务（仅 Linux，不立即启动）
#
#  环境变量（可覆盖默认值）：
#    IRIS_VERSION          Release tag，默认 latest
#    IRIS_INSTALL_DIR      安装目录，默认 /opt/iris 或 $HOME/iris (Termux)
#    IRIS_DATA_DIR         运行时数据目录，默认 /opt/iris/.iris 或 ~/.iris
#    IRIS_REPO_URL         GitHub 仓库 URL（仅 fallback 构建时使用）
#    IRIS_REPO_BRANCH      分支名（仅 fallback 构建时使用）
#    IRIS_MIRROR           下载镜像前缀，如 https://ghproxy.com/
# ==========================================

set -euo pipefail

# ── 全局变量 ─────────────────────────────
IRIS_VERSION="${IRIS_VERSION:-latest}"
REPO_URL="${IRIS_REPO_URL:-https://github.com/Lianues/Iris.git}"
REPO_BRANCH="${IRIS_REPO_BRANCH:-main}"
GH_REPO="Lianues/Iris"
NODE_MAJOR=22
SERVICE_NAME="iris"
IS_TERMUX=false
IS_ROOT=false
INSTALL_DIR=""   # 稍后根据环境决定
BIN_DIR=""       # 同上
APP_DATA_DIR=""  # 运行时数据目录（配置、会话、日志）
MIRROR_PREFIX="${IRIS_MIRROR:-}"

# ── 颜色输出 ─────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }
step()    { echo -e "\n${BLUE}${BOLD}── $* ──${NC}"; }
success() { echo -e "${CYAN}${BOLD}$*${NC}"; }

# ── 清理钩子 ─────────────────────────────
cleanup() {
    rm -f /tmp/iris_install_*.tmp 2>/dev/null || true
}
trap cleanup EXIT

# ==========================================
#  环境检测
# ==========================================

detect_environment() {
    step "检测运行环境"

    # ── Termux 检测
    if [ -n "${TERMUX_VERSION:-}" ] || [ -d "$HOME/.termux" ] || [[ "${PREFIX:-}" == *com.termux* ]]; then
        IS_TERMUX=true
        info "检测到 Termux 环境 (Android)"
    fi

    # ── Root 检测
    if [ "$(id -u)" -eq 0 ]; then
        IS_ROOT=true
    fi

    # ── 非 Termux 且非 Root：提示
    if ! $IS_TERMUX && ! $IS_ROOT; then
        warn "当前不是 root 用户。将安装到 \$HOME/iris，不安装 systemd 服务。"
        warn "如需安装到 /opt/iris 并配置 systemd，请使用：sudo bash install.sh"
    fi

    # ── 决定安装目录
    if [ -n "${IRIS_INSTALL_DIR:-}" ]; then
        INSTALL_DIR="$IRIS_INSTALL_DIR"
    elif $IS_TERMUX; then
        INSTALL_DIR="$HOME/iris"
    elif $IS_ROOT; then
        INSTALL_DIR="/opt/iris"
    else
        INSTALL_DIR="$HOME/iris"
    fi

    # ── 决定 CLI 安装位置
    if $IS_TERMUX; then
        BIN_DIR="$PREFIX/bin"
    elif $IS_ROOT; then
        BIN_DIR="/usr/local/bin"
    else
        BIN_DIR="$HOME/.local/bin"
        mkdir -p "$BIN_DIR"
    fi

    # ── 决定运行时数据目录
    if [ -n "${IRIS_DATA_DIR:-}" ]; then
        APP_DATA_DIR="$IRIS_DATA_DIR"
    elif $IS_ROOT && ! $IS_TERMUX; then
        APP_DATA_DIR="$INSTALL_DIR/.iris"
    else
        APP_DATA_DIR="$HOME/.iris"
    fi

    info "安装目录：$INSTALL_DIR"
    info "CLI 路径：$BIN_DIR/iris"
    info "数据目录：$APP_DATA_DIR"
}

detect_os() {
    if $IS_TERMUX; then
        OS="termux"
        VER=""
        ARCH=$(uname -m)
        case "$ARCH" in
            aarch64|arm64) ARCH="arm64" ;;
            x86_64|amd64)  ARCH="x64" ;;
            armv7l|armv8l) ARCH="arm64" ;;  # Termux 多数仍跑 aarch64 用户空间
            *)             die "不支持的架构：$ARCH" ;;
        esac
        info "系统：Termux/Android ($ARCH)"
        return
    fi

    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS="$ID"
        VER="${VERSION_ID:-}"
    elif command -v lsb_release &>/dev/null; then
        OS=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
        VER=$(lsb_release -sr)
    else
        OS=$(uname -s | tr '[:upper:]' '[:lower:]')
        VER=""
    fi

    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64|amd64)   ARCH="x64" ;;
        aarch64|arm64)  ARCH="arm64" ;;
        armv7l)         ARCH="armv7" ;;
        *)              die "不支持的架构：$ARCH" ;;
    esac

    info "系统：$OS ${VER} ($ARCH)"
}

# ==========================================
#  依赖安装
# ==========================================

install_dependencies() {
    step "检查运行时依赖"

    if $IS_TERMUX; then
        pkg update -y
        pkg install -y nodejs-lts git curl
        info "Termux 依赖安装完成"
        return
    fi

    # Linux：预编译包安装只需要 curl/git，不需要 Node.js 和构建工具链
    local need_install=false
    for cmd in curl git; do
        if ! command -v "$cmd" &>/dev/null; then
            need_install=true
            break
        fi
    done

    if $need_install && $IS_ROOT; then
        case "$OS" in
            ubuntu|debian|linuxmint|pop)
                apt-get update -qq
                apt-get install -y -qq curl git ca-certificates
                ;;
            centos|rhel|rocky|almalinux|ol)
                yum install -y curl git ca-certificates
                ;;
            fedora)
                dnf install -y curl git ca-certificates
                ;;
            alpine)
                apk add --no-cache curl git ca-certificates
                ;;
            arch|manjaro)
                pacman -Sy --noconfirm curl git
                ;;
            *)
                warn "未识别的系统 ($OS)，请确保已安装: curl git"
                ;;
        esac
    elif $need_install; then
        die "缺少 curl 或 git。请先安装：sudo apt install curl git（或对应包管理器命令）"
    fi

    info "基础依赖已就绪"
}

install_node() {
    step "检查 Node.js"

    # Termux 已在 install_dependencies 中安装
    if $IS_TERMUX; then
        info "Node.js $(node -v) 已通过 Termux pkg 安装"
        return
    fi

    if command -v node &>/dev/null; then
        local node_ver
        node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$node_ver" -ge 18 ]; then
            info "Node.js $(node -v) 已安装，满足要求"
            return 0
        else
            warn "Node.js $(node -v) 版本过低，将升级到 v${NODE_MAJOR}"
        fi
    fi

    if ! $IS_ROOT; then
        die "Node.js 未安装或版本过低。请先安装 Node.js >= 18，或使用 sudo 运行本脚本自动安装。"
    fi

    info "正在安装 Node.js ${NODE_MAJOR}..."

    case "$OS" in
        ubuntu|debian|linuxmint|pop)
            mkdir -p /etc/apt/keyrings
            curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
                | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
            echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
                > /etc/apt/sources.list.d/nodesource.list
            apt-get update -qq
            apt-get install -y -qq nodejs
            ;;
        centos|rhel|rocky|almalinux|ol|fedora)
            curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
            yum install -y nodejs || dnf install -y nodejs
            ;;
        alpine)
            apk add --no-cache nodejs npm
            ;;
        arch|manjaro)
            pacman -S --noconfirm nodejs npm
            ;;
        *)
            die "无法为 $OS 自动安装 Node.js，请手动安装 Node.js >= 18"
            ;;
    esac

    info "Node.js $(node -v) 安装完成"
}

# ==========================================
#  下载并解压预编译包
# ==========================================

resolve_download_url() {
    local filename="$1"
    local base_url

    if [ "$IRIS_VERSION" = "latest" ]; then
        base_url="https://github.com/$GH_REPO/releases/latest/download"
    else
        base_url="https://github.com/$GH_REPO/releases/download/$IRIS_VERSION"
    fi

    local url="$base_url/$filename"

    # 如果配置了镜像前缀，拼接到 URL 前面
    if [ -n "$MIRROR_PREFIX" ]; then
        echo "${MIRROR_PREFIX}${url}"
    else
        echo "$url"
    fi
}

download_and_extract() {
    step "下载 Iris 预编译包"

    local tarball="iris-linux-${ARCH}.tar.gz"
    local url
    url=$(resolve_download_url "$tarball")

    info "下载地址：$url"

    local tmp_tar
    tmp_tar=$(mktemp /tmp/iris_install_XXXXXX.tar.gz)

    if ! curl -fSL --connect-timeout 15 --max-time 300 --retry 2 -o "$tmp_tar" "$url" 2>&1; then
        rm -f "$tmp_tar"
        warn "预编译包下载失败（Release 可能尚未发布）"
        warn "将回退到源码构建模式..."
        fallback_build
        return
    fi

    # 解压
    mkdir -p "$INSTALL_DIR"
    tar xzf "$tmp_tar" -C "$INSTALL_DIR" --strip-components=1
    rm -f "$tmp_tar"

    # 修复权限
    if $IS_ROOT && id -u iris &>/dev/null 2>&1; then
        chown -R iris:iris "$INSTALL_DIR"
    fi

    info "解压完成：$INSTALL_DIR"
}

# ── Fallback：源码构建（Release 未发布时的降级方案）
fallback_build() {
    step "回退：源码克隆与构建"

    if ! $IS_TERMUX && $IS_ROOT; then
        case "$OS" in
            ubuntu|debian|linuxmint|pop)
                apt-get install -y -qq build-essential python3 2>/dev/null || true
                ;;
            centos|rhel|rocky|almalinux|ol)
                yum install -y gcc gcc-c++ make python3 2>/dev/null || true
                ;;
            fedora)
                dnf install -y gcc gcc-c++ make python3 2>/dev/null || true
                ;;
        esac
    fi

    install_node

    if ! command -v bun &>/dev/null; then
        info "安装 Bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi

    local tmp_dir
    tmp_dir=$(mktemp -d)

    info "正在克隆 Iris..."
    git clone --depth 1 -b "$REPO_BRANCH" "$REPO_URL" "$tmp_dir"

    cd "$tmp_dir"

    info "安装依赖..."
    bun install 2>&1 | tail -5
    if [ -d extensions/web/web-ui ]; then
        cd extensions/web/web-ui && npm install 2>&1 | tail -5 && cd "$tmp_dir"
    fi

    info "构建 Web UI..."
    npm run build:ui 2>&1 | tail -5

    info "构建二进制发布包..."
    bun run build:compile -- --single 2>&1 | tail -5

    local package_dir="$tmp_dir/dist/bin/iris-linux-${ARCH}"
    if [ ! -d "$package_dir" ]; then
        rm -rf "$tmp_dir"
        die "未找到构建产物：$package_dir"
    fi

    mkdir -p "$INSTALL_DIR"
    cp -a "$package_dir/." "$INSTALL_DIR/"
    rm -rf "$tmp_dir"

    if $IS_ROOT && id -u iris &>/dev/null 2>&1; then
        chown -R iris:iris "$INSTALL_DIR"
    fi

    info "源码编译完成并已安装到 $INSTALL_DIR"
}

# ==========================================
#  配置与安装
# ==========================================

create_user() {
    if ! $IS_ROOT || $IS_TERMUX; then
        return 0
    fi

    step "创建 iris 用户"

    if id -u iris &>/dev/null; then
        info "用户 iris 已存在"
    else
        useradd -r -s /bin/bash -m -d "$INSTALL_DIR" iris
        info "已创建用户 iris"
    fi

    mkdir -p "$INSTALL_DIR"
    chown iris:iris "$INSTALL_DIR"
}

init_config() {
    step "初始化配置"

    local config_dir="$APP_DATA_DIR/configs"
    local example_dir="$INSTALL_DIR/data/configs.example"

    mkdir -p "$APP_DATA_DIR"

    if [ -d "$config_dir" ] && [ "$(ls -A "$config_dir" 2>/dev/null)" ]; then
        info "配置已存在，跳过初始化（运行 iris onboard 可重新配置）"
    else
        mkdir -p "$config_dir"
        if [ -d "$example_dir" ]; then
            cp -n "$example_dir"/*.yaml "$config_dir/" 2>/dev/null || true
            info "已从模板创建默认配置"
        else
            warn "配置模板目录不存在，跳过配置初始化"
        fi
    fi

    if $IS_ROOT && id -u iris &>/dev/null 2>&1; then
        chown -R iris:iris "$APP_DATA_DIR"
    fi
}

verify_onboard() {
    step "检查 onboard 工具"

    local onboard_bin="$INSTALL_DIR/bin/iris-onboard"

    if [ -x "$onboard_bin" ]; then
        info "iris-onboard 已就绪：$onboard_bin"
    else
        warn "iris-onboard 未包含在安装包中"
        warn "你仍然可以手动编辑配置文件：$APP_DATA_DIR/configs/"
    fi
}

install_cli() {
    step "安装 iris 命令"

    local cli_path="$BIN_DIR/iris"

    cat > "$cli_path" << CLIEOF
#!/usr/bin/env bash
# Iris CLI Wrapper (自动生成)
set -euo pipefail

IRIS_DIR="$INSTALL_DIR"
IRIS_INSTALL_DIR="$INSTALL_DIR"
IRIS_DATA_DIR="$APP_DATA_DIR"

RED='\\033[0;31m'
GREEN='\\033[0;32m'
CYAN='\\033[0;36m'
BOLD='\\033[1m'
NC='\\033[0m'
export IRIS_INSTALL_DIR
export IRIS_DATA_DIR

case "\${1:-start}" in
    onboard)
        if [ -x "\$IRIS_DIR/bin/iris" ]; then
            export IRIS_DATA_DIR
            exec "\$IRIS_DIR/bin/iris" onboard
        else
            echo -e "\${RED}未找到 Iris 主二进制。\${NC}"
            exit 1
        fi
        ;;

    start|"")
        if [ ! -x "\$IRIS_DIR/bin/iris" ]; then
            echo -e "\${RED}Iris 二进制不存在。\${NC}"
            exit 1
        fi
        echo -e "\${GREEN}正在启动 Iris...\${NC}"
        export IRIS_DATA_DIR
        exec "\$IRIS_DIR/bin/iris" start
        ;;

    service)
        shift
        case "\${1:-status}" in
            start)   sudo systemctl start iris   && echo -e "\${GREEN}Iris 已启动\${NC}" ;;
            stop)    sudo systemctl stop iris    && echo -e "\${GREEN}Iris 已停止\${NC}" ;;
            restart) sudo systemctl restart iris && echo -e "\${GREEN}Iris 已重启\${NC}" ;;
            status)  systemctl status iris ;;
            logs)    journalctl -u iris -f --no-pager ;;
            enable)  sudo systemctl enable iris  && echo -e "\${GREEN}已设为开机自启\${NC}" ;;
            disable) sudo systemctl disable iris && echo -e "\${GREEN}已取消开机自启\${NC}" ;;
            *)       echo "用法：iris service {start|stop|restart|status|logs|enable|disable}" ;;
        esac
        ;;

    update)
        echo -e "\${CYAN}正在更新 Iris...\${NC}"
        curl -fsSL https://raw.githubusercontent.com/$GH_REPO/main/deploy/linux/install.sh | bash
        ;;

    help|--help|-h)
        echo ""
        echo -e "\${BOLD}Iris AI Chat Framework\${NC}"
        echo ""
        echo "用法：iris <command>"
        echo ""
        echo "命令："
        echo "  start              启动 Iris（前台运行，默认）"
        echo "  onboard            交互式配置引导（TUI）"
        echo "  service <cmd>      管理 systemd 服务"
        echo "    start/stop/restart/status/logs/enable/disable"
        echo "  update             更新到最新版本"
        echo "  help               显示此帮助"
        echo ""
        echo "配置文件：\$IRIS_DATA_DIR/configs/"
        echo ""
        ;;

    *)
        echo "未知命令：\$1"
        echo "运行 iris help 查看帮助"
        exit 1
        ;;
esac
CLIEOF

    chmod +x "$cli_path"
    info "已安装 iris 命令到 $cli_path"

    # 检查 PATH
    if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
        warn "$BIN_DIR 不在 PATH 中。请添加到 shell 配置："
        warn "  echo 'export PATH=\"$BIN_DIR:\\\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
    fi
}

install_service() {
    # Termux 或非 root 不安装 systemd
    if $IS_TERMUX || ! $IS_ROOT; then
        return 0
    fi

    step "安装 systemd 服务"

    if ! command -v systemctl &>/dev/null; then
        warn "系统不支持 systemd，跳过服务安装"
        warn "你可以手动启动：IRIS_DATA_DIR=$APP_DATA_DIR $INSTALL_DIR/bin/iris start"
        return 0
    fi

    cat > /etc/systemd/system/iris.service <<SERVICEEOF
[Unit]
Description=Iris AI Chat Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/bin/iris serve
User=iris
Group=iris
Environment=NODE_ENV=production
Environment=IRIS_DATA_DIR=$APP_DATA_DIR
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DATA_DIR

[Install]
WantedBy=multi-user.target
SERVICEEOF

    systemctl daemon-reload
    systemctl enable iris

    info "systemd 服务已安装并设为开机自启"
}

# ==========================================
#  完成信息
# ==========================================

print_success() {
    echo ""
    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo -e "${GREEN}${BOLD}   ✅  Iris 安装完成！${NC}"
    echo -e "${GREEN}${BOLD}============================================${NC}"
    echo ""
    echo -e "  ${BOLD}下一步：${NC}"
    echo ""
    echo -e "  ${CYAN}1.${NC} 运行交互式配置引导："
    echo -e "     ${BOLD}iris onboard${NC}"
    echo ""
    echo -e "  ${CYAN}2.${NC} 或手动编辑配置文件："
    echo -e "     nano $APP_DATA_DIR/configs/llm.yaml"
    echo -e "     nano $APP_DATA_DIR/configs/platform.yaml"
    echo ""
    echo -e "  ${CYAN}3.${NC} 启动："

    if $IS_TERMUX; then
        echo -e "     ${BOLD}iris start${NC}"
    elif $IS_ROOT; then
        echo -e "     ${BOLD}iris service start${NC}    # 后台运行"
        echo -e "     ${BOLD}iris start${NC}            # 前台运行"
    else
        echo -e "     ${BOLD}iris start${NC}"
    fi

    echo ""

    if ! $IS_TERMUX && $IS_ROOT; then
        echo -e "  ${CYAN}其他命令：${NC}"
        echo -e "     iris service status    # 查看状态"
        echo -e "     iris service logs      # 查看日志"
        echo -e "     iris update            # 更新版本"
        echo -e "     iris help              # 查看帮助"
        echo ""
    fi
}

# ==========================================
#  主流程
# ==========================================

main() {
    echo ""
    success "╔══════════════════════════════════════╗"
    success "║       Iris AI Chat Framework         ║"
    success "║         一键安装脚本                  ║"
    success "╚══════════════════════════════════════╝"
    echo ""

    detect_environment
    detect_os
    install_dependencies
    create_user
    download_and_extract
    init_config
    verify_onboard
    install_cli
    install_service
    print_success
}

main "$@"
