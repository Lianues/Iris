#!/usr/bin/env bash
# ==========================================
#  Iris 一键安装脚本
#
#  用法：curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
#
#  功能：
#  1. 检测系统和架构
#  2. 安装系统依赖 (git, curl, build-essential 等)
#  3. 安装 Node.js 22 (如未安装)
#  4. 创建 iris 用户 + /opt/iris 目录
#  5. 克隆项目 → npm run setup → npm run build
#  6. 下载预编译 iris-onboard 二进制
#  7. 安装全局 iris 命令
#  8. 安装 systemd 服务（不立即启动）
# ==========================================

set -euo pipefail

# ── 全局变量 ───────────────────────────────
IRIS_VERSION="${IRIS_VERSION:-latest}"
INSTALL_DIR="${IRIS_INSTALL_DIR:-/opt/iris}"
REPO_URL="${IRIS_REPO_URL:-https://github.com/Lianues/Iris.git}"
REPO_BRANCH="${IRIS_REPO_BRANCH:-main}"
NODE_MAJOR=22
SERVICE_NAME="iris"
BIN_DIR="/usr/local/bin"

# ── 颜色输出 ───────────────────────────────
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

# ── 清理钩子 ───────────────────────────────
cleanup() {
    rm -f /tmp/iris_install_*.tmp 2>/dev/null || true
}
trap cleanup EXIT

# ── Root 检查 ──────────────────────────────
check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        die "请以 root 用户运行此脚本：sudo bash install.sh"
    fi
}

# ── 系统检测 ───────────────────────────────
detect_os() {
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

# ── 安装系统依赖 ──────────────────────────
install_dependencies() {
    step "安装系统依赖"

    case "$OS" in
        ubuntu|debian|linuxmint|pop)
            apt-get update -qq
            apt-get install -y -qq curl git build-essential python3 ca-certificates gnupg
            ;;
        centos|rhel|rocky|almalinux|ol)
            yum install -y curl git gcc gcc-c++ make python3 ca-certificates
            ;;
        fedora)
            dnf install -y curl git gcc gcc-c++ make python3 ca-certificates
            ;;
        alpine)
            apk add --no-cache curl git build-base python3 ca-certificates
            ;;
        arch|manjaro)
            pacman -Sy --noconfirm curl git base-devel python
            ;;
        *)
            warn "未识别的系统 ($OS)，请确保已安装: curl git gcc make python3"
            ;;
    esac

    info "系统依赖安装完成"
}

# ── 安装 Node.js ──────────────────────────
install_node() {
    step "检查 Node.js"

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

    info "正在安装 Node.js ${NODE_MAJOR}..."

    case "$OS" in
        ubuntu|debian|linuxmint|pop)
            # NodeSource 仓库
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

# ── 创建用户 ──────────────────────────────
create_user() {
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

# ── 克隆并构建 ────────────────────────────
clone_and_build() {
    step "克隆并构建 Iris"

    if [ -d "$INSTALL_DIR/.git" ]; then
        info "项目已存在，拉取最新代码..."
        cd "$INSTALL_DIR"
        sudo -u iris git pull origin "$REPO_BRANCH" 2>/dev/null || {
            warn "git pull 失败，将继续使用现有代码"
        }
    else
        info "正在克隆 Iris..."
        # 先克隆到临时目录再移入
        local tmp_dir
        tmp_dir=$(mktemp -d)
        git clone --depth 1 -b "$REPO_BRANCH" "$REPO_URL" "$tmp_dir"
        # 移动内容到安装目录（保留已有的 data/ 等）
        cp -rT "$tmp_dir" "$INSTALL_DIR" 2>/dev/null || cp -a "$tmp_dir/." "$INSTALL_DIR/"
        rm -rf "$tmp_dir"
        chown -R iris:iris "$INSTALL_DIR"
    fi

    cd "$INSTALL_DIR"

    info "安装依赖..."
    sudo -u iris npm run setup 2>&1 | tail -5

    info "构建项目..."
    sudo -u iris npm run build 2>&1 | tail -5

    info "构建完成"
}

# ── 初始化配置 ────────────────────────────
init_config() {
    step "初始化配置"

    local config_dir="$INSTALL_DIR/data/configs"
    local example_dir="$INSTALL_DIR/data/configs.example"

    if [ -d "$config_dir" ] && [ "$(ls -A "$config_dir" 2>/dev/null)" ]; then
        info "配置已存在，跳过初始化（运行 iris onboard 可重新配置）"
    else
        mkdir -p "$config_dir"
        cp -n "$example_dir"/*.yaml "$config_dir/" 2>/dev/null || true
        chown -R iris:iris "$config_dir"
        info "已从模板创建默认配置"
    fi
}

# ── 下载 onboard 二进制 ──────────────────
install_onboard() {
    step "安装 onboard 工具"

    local onboard_bin="$INSTALL_DIR/bin/iris-onboard"
    mkdir -p "$INSTALL_DIR/bin"

    # 尝试从 GitHub Release 下载预编译二进制
    local download_url="https://github.com/Lianues/Iris/releases/latest/download/iris-onboard-linux-${ARCH}"

    info "正在下载 iris-onboard (${ARCH})..."
    if curl -fsSL --connect-timeout 10 --max-time 120 -o "$onboard_bin" "$download_url" 2>/dev/null; then
        chmod +x "$onboard_bin"
        chown iris:iris "$onboard_bin"
        info "iris-onboard 下载完成"
    else
        warn "iris-onboard 下载失败（Release 可能尚未发布）"
        warn "你仍然可以手动编辑配置文件：$INSTALL_DIR/data/configs/"
        # 创建一个 fallback 脚本
        cat > "$onboard_bin" << 'FALLBACK_EOF'
#!/bin/bash
echo ""
echo "iris-onboard 尚未安装（预编译二进制下载失败）"
echo ""
echo "请手动编辑配置文件："
echo "  nano /opt/iris/data/configs/llm.yaml      # 填写 API Key"
echo "  nano /opt/iris/data/configs/platform.yaml  # 选择平台类型"
echo ""
echo "或者在 onboard/ 目录中自行构建："
echo "  cd /opt/iris/onboard && bun install && bun run build"
echo ""
FALLBACK_EOF
        chmod +x "$onboard_bin"
    fi
}

# ── 安装全局命令 ──────────────────────────
install_cli() {
    step "安装 iris 命令"

    cat > "$BIN_DIR/iris" << 'CLI_EOF'
#!/usr/bin/env bash
# ==========================================
#  Iris CLI Wrapper
#  用法：
#    iris                    启动 Iris（前台运行）
#    iris start              同上
#    iris onboard            交互式配置引导
#    iris service <cmd>      管理 systemd 服务
#                            cmd: start | stop | restart | status | logs
#    iris update             更新 Iris 到最新版本
#    iris help               显示帮助
# ==========================================

set -euo pipefail

IRIS_DIR="/opt/iris"
IRIS_USER="iris"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

case "${1:-start}" in
    onboard)
        if [ -x "$IRIS_DIR/bin/iris-onboard" ]; then
            exec "$IRIS_DIR/bin/iris-onboard" "$IRIS_DIR"
        else
            echo -e "${RED}iris-onboard 未安装${NC}"
            echo "请手动编辑配置：$IRIS_DIR/data/configs/"
            exit 1
        fi
        ;;

    start|"")
        if [ ! -f "$IRIS_DIR/dist/index.js" ]; then
            echo -e "${RED}Iris 尚未构建，请先运行：cd $IRIS_DIR && npm run build${NC}"
            exit 1
        fi
        echo -e "${GREEN}正在启动 Iris...${NC}"
        cd "$IRIS_DIR"
        exec node dist/index.js
        ;;

    service)
        shift
        case "${1:-status}" in
            start)   sudo systemctl start iris   && echo -e "${GREEN}Iris 已启动${NC}" ;;
            stop)    sudo systemctl stop iris    && echo -e "${GREEN}Iris 已停止${NC}" ;;
            restart) sudo systemctl restart iris && echo -e "${GREEN}Iris 已重启${NC}" ;;
            status)  systemctl status iris ;;
            logs)    journalctl -u iris -f --no-pager ;;
            enable)  sudo systemctl enable iris  && echo -e "${GREEN}已设为开机自启${NC}" ;;
            disable) sudo systemctl disable iris && echo -e "${GREEN}已取消开机自启${NC}" ;;
            *)       echo "用法：iris service {start|stop|restart|status|logs|enable|disable}" ;;
        esac
        ;;

    update)
        echo -e "${CYAN}正在更新 Iris...${NC}"
        cd "$IRIS_DIR"
        sudo -u "$IRIS_USER" git pull origin main
        sudo -u "$IRIS_USER" npm run setup
        sudo -u "$IRIS_USER" npm run build
        echo -e "${GREEN}更新完成！使用 iris service restart 重启服务${NC}"
        ;;

    help|--help|-h)
        echo ""
        echo -e "${BOLD}Iris AI Chat Framework${NC}"
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
        echo "配置文件：$IRIS_DIR/data/configs/"
        echo "服务日志：journalctl -u iris -f"
        echo ""
        ;;

    *)
        echo "未知命令：$1"
        echo "运行 iris help 查看帮助"
        exit 1
        ;;
esac
CLI_EOF

    chmod +x "$BIN_DIR/iris"
    info "已安装 iris 命令到 $BIN_DIR/iris"
}

# ── 安装 systemd 服务 ────────────────────
install_service() {
    step "安装 systemd 服务"

    # 检查 systemd 是否可用
    if ! command -v systemctl &>/dev/null; then
        warn "系统不支持 systemd，跳过服务安装"
        warn "你可以手动启动：cd $INSTALL_DIR && node dist/index.js"
        return 0
    fi

    cp "$INSTALL_DIR/deploy/linux/iris.service" /etc/systemd/system/iris.service

    # 替换安装路径（如果自定义了）
    if [ "$INSTALL_DIR" != "/opt/iris" ]; then
        sed -i "s|/opt/iris|$INSTALL_DIR|g" /etc/systemd/system/iris.service
    fi

    systemctl daemon-reload
    systemctl enable iris

    info "systemd 服务已安装并设为开机自启"
    info "注意：服务尚未启动，请先运行 iris onboard 完成配置"
}

# ── 打印完成信息 ──────────────────────────
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
    echo -e "     nano $INSTALL_DIR/data/configs/llm.yaml"
    echo -e "     nano $INSTALL_DIR/data/configs/platform.yaml"
    echo ""
    echo -e "  ${CYAN}3.${NC} 启动服务："
    echo -e "     ${BOLD}iris service start${NC}    # 后台运行"
    echo -e "     ${BOLD}iris start${NC}            # 前台运行"
    echo ""
    echo -e "  ${CYAN}其他命令：${NC}"
    echo -e "     iris service status    # 查看状态"
    echo -e "     iris service logs      # 查看日志"
    echo -e "     iris update            # 更新版本"
    echo -e "     iris help              # 查看帮助"
    echo ""
}

# ── 主流程 ────────────────────────────────
main() {
    echo ""
    success "╔══════════════════════════════════════╗"
    success "║       Iris AI Chat Framework         ║"
    success "║         一键安装脚本                  ║"
    success "╚══════════════════════════════════════╝"
    echo ""

    check_root
    detect_os
    install_dependencies
    install_node
    create_user
    clone_and_build
    init_config
    install_onboard
    install_cli
    install_service
    print_success
}

main "$@"
