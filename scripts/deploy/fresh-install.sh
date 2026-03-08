#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="QQ 农场智能助手"
APP_SERVICE="qq-farm-bot"
STACK_CONTAINERS=("qq-farm-bot" "qq-farm-mysql" "qq-farm-redis" "qq-farm-ipad860")
REPO_SLUG="${REPO_SLUG:-smdk000/qq-farm-ui-pro-max}"
REPO_REF="${REPO_REF:-main}"
RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/${REPO_SLUG}/${REPO_REF}}"
SOURCE_ARCHIVE_URL="${SOURCE_ARCHIVE_URL:-https://codeload.github.com/${REPO_SLUG}/tar.gz/${REPO_REF}}"
DATE_STAMP="$(date +%Y_%m_%d)"
DEPLOY_BASE_DIR="${DEPLOY_BASE_DIR:-/opt}"
DEPLOY_DIR="${DEPLOY_DIR:-${DEPLOY_BASE_DIR}/${DATE_STAMP}/qq-farm-bot}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_BASE_DIR}/qq-farm-bot-current}"
SOURCE_CACHE_DIR="${SOURCE_CACHE_DIR:-${DEPLOY_BASE_DIR}/.qq-farm-build-src/${REPO_REF}}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
COMPOSE_PULL_RETRIES="${COMPOSE_PULL_RETRIES:-3}"
PULL_RETRY_DELAY_SECONDS="${PULL_RETRY_DELAY_SECONDS:-10}"

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || pwd)"
USE_LOCAL_BUNDLE=0
DOCKER=(docker)
SUDO=""
SKIP_DOCKER_PULL="${SKIP_DOCKER_PULL:-0}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"

trap 'print_error "脚本执行失败，请检查上方日志。"' ERR

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --web-port)
                WEB_PORT="${2:-}"
                shift 2
                ;;
            --deploy-dir)
                DEPLOY_DIR="${2:-}"
                shift 2
                ;;
            --deploy-base-dir)
                DEPLOY_BASE_DIR="${2:-}"
                shift 2
                ;;
            --non-interactive)
                NON_INTERACTIVE=1
                shift
                ;;
            *)
                print_error "未知参数: $1"
                exit 1
                ;;
        esac
    done

    if [ -n "${DEPLOY_BASE_DIR:-}" ] && [ -z "${DEPLOY_DIR:-}" ]; then
        DEPLOY_DIR="${DEPLOY_BASE_DIR}/${DATE_STAMP}/qq-farm-bot"
    fi
}

if [ -f "${REPO_ROOT}/deploy/docker-compose.yml" ] \
    && [ -f "${REPO_ROOT}/deploy/.env.example" ] \
    && [ -f "${REPO_ROOT}/deploy/init-db/01-init.sql" ]; then
    USE_LOCAL_BUNDLE=1
fi

if [ "${EUID:-$(id -u)}" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

run_root() {
    if [ -n "${SUDO}" ]; then
        "${SUDO}" "$@"
    else
        "$@"
    fi
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        print_error "缺少命令: $1"
        exit 1
    fi
}

ensure_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        print_warning "未检测到 Docker，开始自动安装。"
        require_cmd curl
        curl -fsSL https://get.docker.com | run_root sh
        run_root systemctl enable docker >/dev/null 2>&1 || true
        run_root systemctl start docker >/dev/null 2>&1 || true
    fi

    if docker info >/dev/null 2>&1; then
        DOCKER=(docker)
    elif [ -n "${SUDO}" ] && "${SUDO}" docker info >/dev/null 2>&1; then
        DOCKER=("${SUDO}" docker)
    else
        print_error "Docker 已安装，但当前用户无法访问 Docker daemon。"
        exit 1
    fi

    "${DOCKER[@]}" compose version >/dev/null 2>&1 || {
        print_error "当前 Docker 缺少 compose v2，请升级 Docker。"
        exit 1
    }
}

port_in_use() {
    local port="$1"
    if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then
        return 0
    fi
    if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${port}" -sTCP:LISTEN -nP >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

choose_web_port() {
    local port="${WEB_PORT:-3080}"
    while port_in_use "${port}"; do
        print_warning "端口 ${port} 已被占用。"
        if [ "${NON_INTERACTIVE}" = "1" ]; then
            port="$((port + 1))"
            print_warning "非交互模式下自动切换到端口 ${port}"
            continue
        fi
        read -r -p "请输入新的 Web 端口（直接回车使用 $((port + 1))）: " new_port
        port="${new_port:-$((port + 1))}"
    done
    echo "${port}"
}

ensure_target_dir_ready() {
    if [ -d "${DEPLOY_DIR}" ] && find "${DEPLOY_DIR}" -mindepth 1 -maxdepth 1 >/dev/null 2>&1; then
        print_error "部署目录已存在且非空: ${DEPLOY_DIR}"
        print_error "请更换 DEPLOY_DIR，或先清理旧目录后再执行。"
        exit 1
    fi
}

ensure_clean_target() {
    local existing=()
    for name in "${STACK_CONTAINERS[@]}"; do
        if "${DOCKER[@]}" container inspect "${name}" >/dev/null 2>&1; then
            existing+=("${name}")
        fi
    done

    if [ "${#existing[@]}" -gt 0 ]; then
        print_error "检测到已有部署容器: ${existing[*]}"
        print_error "全新部署脚本不会覆盖现有环境，请改用 update-app.sh 或手动处理旧容器。"
        exit 1
    fi
}

download_file() {
    local remote_path="$1"
    local target_path="$2"
    curl -fsSL "${RAW_BASE_URL}/${remote_path}" -o "${target_path}"
}

copy_or_download_bundle() {
    local target_dir="$1"

    run_root mkdir -p "${target_dir}/init-db"
    if [ -n "${SUDO}" ]; then
        run_root chown -R "$(id -u):$(id -g)" "${target_dir}"
    fi

    if [ "${USE_LOCAL_BUNDLE}" -eq 1 ]; then
        cp "${REPO_ROOT}/deploy/docker-compose.yml" "${target_dir}/docker-compose.yml"
        cp "${REPO_ROOT}/deploy/.env.example" "${target_dir}/.env.example"
        cp "${REPO_ROOT}/deploy/init-db/01-init.sql" "${target_dir}/init-db/01-init.sql"
        cp "${REPO_ROOT}/deploy/README.md" "${target_dir}/README.md"
        cp "${REPO_ROOT}/scripts/deploy/update-app.sh" "${target_dir}/update-app.sh"
        cp "${REPO_ROOT}/scripts/deploy/fresh-install.sh" "${target_dir}/fresh-install.sh"
        cp "${REPO_ROOT}/scripts/deploy/quick-deploy.sh" "${target_dir}/quick-deploy.sh"
    else
        download_file "deploy/docker-compose.yml" "${target_dir}/docker-compose.yml"
        download_file "deploy/.env.example" "${target_dir}/.env.example"
        download_file "deploy/init-db/01-init.sql" "${target_dir}/init-db/01-init.sql"
        download_file "deploy/README.md" "${target_dir}/README.md"
        download_file "scripts/deploy/update-app.sh" "${target_dir}/update-app.sh"
        download_file "scripts/deploy/fresh-install.sh" "${target_dir}/fresh-install.sh"
        download_file "scripts/deploy/quick-deploy.sh" "${target_dir}/quick-deploy.sh"
    fi

    cp "${target_dir}/.env.example" "${target_dir}/.env"
    chmod +x "${target_dir}/update-app.sh"
    chmod +x "${target_dir}/fresh-install.sh"
    chmod +x "${target_dir}/quick-deploy.sh"
}

set_env_value() {
    local key="$1"
    local value="$2"
    local file="$3"
    local escaped="${value//&/\\&}"
    if grep -q "^${key}=" "${file}"; then
        sed -i.bak "s|^${key}=.*|${key}=${escaped}|" "${file}"
        rm -f "${file}.bak"
    else
        printf '%s=%s\n' "${key}" "${value}" >> "${file}"
    fi
}

sync_env_from_shell() {
    local file="$1"
    local keys=(
        ADMIN_PASSWORD
        MYSQL_ROOT_PASSWORD
        MYSQL_DATABASE
        MYSQL_USER
        MYSQL_PASSWORD
        MYSQL_POOL_LIMIT
        REDIS_PASSWORD
        COOKIE_SECURE
        CORS_ORIGINS
        JWT_SECRET
        WX_API_KEY
        WX_API_URL
        WX_APP_ID
        LOG_LEVEL
        TZ
    )

    local key
    for key in "${keys[@]}"; do
        if [ -n "${!key:-}" ]; then
            set_env_value "${key}" "${!key}" "${file}"
        fi
    done
}

load_deploy_env() {
    local file="$1"
    if [ -f "${file}" ]; then
        set -a
        # shellcheck disable=SC1090
        . "${file}"
        set +a
    fi
}

get_required_images() {
    printf '%s\n' \
        "${APP_IMAGE:-smdk000/qq-farm-bot-ui:latest}" \
        "${MYSQL_IMAGE:-mysql:8.0}" \
        "${REDIS_IMAGE:-redis:7-alpine}" \
        "${IPAD860_IMAGE:-smdk000/ipad860:latest}"
}

pull_one_image() {
    local image="$1"
    local attempt=1

    while [ "${attempt}" -le "${COMPOSE_PULL_RETRIES}" ]; do
        if "${DOCKER[@]}" pull "${image}"; then
            return 0
        fi
        if [ "${attempt}" -lt "${COMPOSE_PULL_RETRIES}" ]; then
            print_warning "拉取 ${image} 失败，${PULL_RETRY_DELAY_SECONDS}s 后重试（${attempt}/${COMPOSE_PULL_RETRIES}）..."
            sleep "${PULL_RETRY_DELAY_SECONDS}"
        fi
        attempt=$((attempt + 1))
    done

    return 1
}

prepare_source_checkout() {
    local cache_dir="${SOURCE_CACHE_DIR}"
    local cache_parent
    cache_parent="$(dirname "${cache_dir}")"
    local archive="/tmp/qq-farm-source-${REPO_REF//\//_}.tar.gz"
    local first_entry=""
    local strip_args=()

    if [ -f "${cache_dir}/pnpm-workspace.yaml" ] && [ -d "${cache_dir}/services/ipad860" ]; then
        return 0
    fi

    print_warning "镜像仓库不可用，开始下载源码包用于本地构建..."
    run_root mkdir -p "${cache_parent}"
    if [ -n "${SUDO}" ]; then
        run_root chown -R "$(id -u):$(id -g)" "${cache_parent}"
    fi

    curl -fsSL "${SOURCE_ARCHIVE_URL}" -o "${archive}"
    run_root rm -rf "${cache_dir}"
    run_root mkdir -p "${cache_dir}"
    if [ -n "${SUDO}" ]; then
        run_root chown -R "$(id -u):$(id -g)" "${cache_dir}"
    fi
    first_entry="$(tar -tzf "${archive}" | head -n 1 || true)"
    if [[ "${first_entry}" == */* ]]; then
        strip_args=(--strip-components=1)
    fi
    tar -xzf "${archive}" "${strip_args[@]}" -C "${cache_dir}"
}

build_image_from_source() {
    local image="$1"
    local context=""
    local dockerfile=""

    case "${image}" in
        */qq-farm-bot-ui:*|qq-farm-bot-ui:*|smdk000/qq-farm-bot-ui:*)
            context="${SOURCE_CACHE_DIR}"
            dockerfile="${SOURCE_CACHE_DIR}/core/Dockerfile"
            ensure_official_image "node:20-alpine" || return 1
            ;;
        */ipad860:*|ipad860:*|smdk000/ipad860:*)
            context="${SOURCE_CACHE_DIR}/services/ipad860"
            dockerfile="${SOURCE_CACHE_DIR}/services/ipad860/Dockerfile"
            ensure_official_image "golang:1.24-bookworm" || return 1
            ensure_official_image "ubuntu:24.04" || return 1
            ;;
        *)
            return 1
            ;;
    esac

    prepare_source_checkout
    print_warning "镜像 ${image} 拉取失败，开始从源码构建..."
    "${DOCKER[@]}" build -t "${image}" -f "${dockerfile}" "${context}"
}

ensure_official_image() {
    local image="$1"
    print_info "拉取官方镜像: ${image}"

    if pull_one_image "${image}"; then
        return 0
    fi

    print_error "官方镜像拉取失败: ${image}"
    print_error "请确认服务器可正常访问 Docker Hub，或手动提前导入该镜像。"
    return 1
}

pull_image_or_build() {
    local image="$1"
    print_info "拉取官方镜像: ${image}"

    if pull_one_image "${image}"; then
        return 0
    fi

    if build_image_from_source "${image}"; then
        return 0
    fi

    return 1
}

pull_required_images() {
    if [ "${SKIP_DOCKER_PULL}" = "1" ] || [ "${SKIP_DOCKER_PULL}" = "true" ]; then
        print_info "检测到 SKIP_DOCKER_PULL=${SKIP_DOCKER_PULL}，跳过镜像拉取，直接使用本地镜像。"
        return 0
    fi

    local image
    while IFS= read -r image; do
        [ -n "${image}" ] || continue
        pull_image_or_build "${image}" || {
            print_error "镜像拉取最终失败: ${image}"
            print_error "请检查 GitHub / Docker Hub 官方网络连通性，或在 .env 中覆盖镜像地址。"
            return 1
        }
    done < <(get_required_images)
}

wait_for_container() {
    local name="$1"
    local timeout="${2:-180}"
    local started_at
    started_at="$(date +%s)"

    while true; do
        local status="missing"
        local health="none"

        if status="$("${DOCKER[@]}" inspect -f '{{.State.Status}}' "${name}" 2>/dev/null)"; then
            health="$("${DOCKER[@]}" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${name}" 2>/dev/null || true)"
        fi

        if [ "${status}" = "running" ] && { [ "${health}" = "healthy" ] || [ "${health}" = "none" ]; }; then
            print_success "${name} 已就绪 (${health})"
            return 0
        fi

        if [ $(( $(date +%s) - started_at )) -ge "${timeout}" ]; then
            print_error "${name} 在 ${timeout}s 内未就绪。"
            "${DOCKER[@]}" logs --tail 80 "${name}" || true
            return 1
        fi

        sleep 5
    done
}

mark_current_release() {
    local target_dir="$1"
    local current_parent
    current_parent="$(dirname "${CURRENT_LINK}")"
    run_root mkdir -p "${current_parent}"
    run_root ln -sfn "${target_dir}" "${CURRENT_LINK}"
}

main() {
    parse_args "$@"

    echo ""
    echo "=========================================="
    echo "  ${APP_NAME} - 全新服务器一键部署"
    echo "=========================================="
    echo ""

    require_cmd date
    require_cmd mkdir
    require_cmd chmod
    require_cmd sed
    require_cmd grep
    require_cmd curl

    ensure_docker
    ensure_clean_target

    local arch
    arch="$(uname -m)"
    print_info "服务器架构: ${arch}"
    if [ "${arch}" = "aarch64" ] || [ "${arch}" = "arm64" ]; then
        print_warning "当前为 ARM64，ipad860 将以 linux/amd64 模式运行，请确认宿主机支持 QEMU 模拟。"
        run_root sysctl -w vm.overcommit_memory=1 >/dev/null 2>&1 || true
    fi

    local web_port
    web_port="$(choose_web_port)"

    print_info "部署目录: ${DEPLOY_DIR}"
    ensure_target_dir_ready
    run_root mkdir -p "${DEPLOY_DIR}"
    if [ -n "${SUDO}" ]; then
        run_root chown -R "$(id -u):$(id -g)" "${DEPLOY_DIR}"
    fi

    copy_or_download_bundle "${DEPLOY_DIR}"
    set_env_value "WEB_PORT" "${web_port}" "${DEPLOY_DIR}/.env"
    sync_env_from_shell "${DEPLOY_DIR}/.env"
    load_deploy_env "${DEPLOY_DIR}/.env"

    cd "${DEPLOY_DIR}"

    print_info "拉取镜像并启动服务..."
    pull_required_images
    "${DOCKER[@]}" compose up -d

    wait_for_container "qq-farm-mysql" 240
    wait_for_container "qq-farm-redis" 120
    wait_for_container "qq-farm-ipad860" 180
    wait_for_container "qq-farm-bot" 240

    if command -v curl >/dev/null 2>&1; then
        curl -fsS "http://127.0.0.1:${web_port}/api/ping" >/dev/null 2>&1 || print_warning "接口探活未通过，请稍后执行: curl http://127.0.0.1:${web_port}/api/ping"
    fi

    mark_current_release "${DEPLOY_DIR}"

    echo ""
    "${DOCKER[@]}" compose ps
    echo ""
    print_success "部署完成。"
    echo "目录: ${DEPLOY_DIR}"
    echo "当前版本链接: ${CURRENT_LINK}"
    echo "访问地址: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${web_port}"
    echo "默认管理员: admin"
    echo "管理员密码: 见 ${DEPLOY_DIR}/.env 中的 ADMIN_PASSWORD"
    echo "后续仅更新主程序: ${CURRENT_LINK}/update-app.sh"
    echo ""
}

main "$@"
