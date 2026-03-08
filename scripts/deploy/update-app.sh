#!/usr/bin/env bash

set -Eeuo pipefail

APP_SERVICE="${APP_SERVICE:-qq-farm-bot}"
COMPOSE_APP_SERVICE="${COMPOSE_APP_SERVICE:-${APP_SERVICE}}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-${APP_SERVICE}}"
DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
DEPLOY_BASE_DIR="${DEPLOY_BASE_DIR:-/opt}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_BASE_DIR}/qq-farm-bot-current}"
REPO_SLUG="${REPO_SLUG:-smdk000/qq-farm-ui-pro-max}"
REPO_REF="${REPO_REF:-main}"
RAW_BASE_URL="${RAW_BASE_URL:-https://raw.githubusercontent.com/${REPO_SLUG}/${REPO_REF}}"
SOURCE_ARCHIVE_URL="${SOURCE_ARCHIVE_URL:-https://codeload.github.com/${REPO_SLUG}/tar.gz/${REPO_REF}}"
APP_IMAGE_OVERRIDE="${APP_IMAGE_OVERRIDE:-}"
PRESERVE_COMPOSE_LAYOUT="${PRESERVE_COMPOSE_LAYOUT:-0}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
DOCKER=(docker)
SUDO=""
COMPOSE_PULL_RETRIES="${COMPOSE_PULL_RETRIES:-3}"
PULL_RETRY_DELAY_SECONDS="${PULL_RETRY_DELAY_SECONDS:-10}"
SKIP_DOCKER_PULL="${SKIP_DOCKER_PULL:-0}"
SOURCE_CACHE_DIR="${SOURCE_CACHE_DIR:-${DEPLOY_BASE_DIR}/.qq-farm-build-src/${REPO_REF}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

trap 'print_error "主程序更新失败，请检查上方日志。"' ERR

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --deploy-dir)
                DEPLOY_DIR="${2:-}"
                shift 2
                ;;
            --image)
                APP_IMAGE_OVERRIDE="${2:-}"
                shift 2
                ;;
            --preserve-compose)
                PRESERVE_COMPOSE_LAYOUT=1
                shift
                ;;
            *)
                print_error "未知参数: $1"
                exit 1
                ;;
        esac
    done
}

if [ "${EUID:-$(id -u)}" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

ensure_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        print_error "未检测到 Docker。"
        exit 1
    fi

    if docker info >/dev/null 2>&1; then
        DOCKER=(docker)
    elif [ -n "${SUDO}" ] && "${SUDO}" docker info >/dev/null 2>&1; then
        DOCKER=("${SUDO}" docker)
    else
        print_error "Docker daemon 不可访问。"
        exit 1
    fi

    "${DOCKER[@]}" compose version >/dev/null 2>&1 || {
        print_error "当前 Docker 缺少 compose v2，请升级 Docker。"
        exit 1
    }
}

download_file() {
    local remote_path="$1"
    local target_path="$2"
    curl -fsSL "${RAW_BASE_URL}/${remote_path}" -o "${target_path}"
}

copy_file_if_needed() {
    local source_path="$1"
    local target_path="$2"

    if [ "${source_path}" = "${target_path}" ]; then
        return 0
    fi

    cp "${source_path}" "${target_path}"
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

    if [ -f "${cache_dir}/pnpm-workspace.yaml" ]; then
        return 0
    fi

    print_warning "镜像仓库不可用，开始下载源码包用于本地构建..."
    if [ -n "${SUDO}" ]; then
        "${SUDO}" mkdir -p "${cache_parent}"
        "${SUDO}" chown -R "$(id -u):$(id -g)" "${cache_parent}"
    else
        mkdir -p "${cache_parent}"
    fi

    curl -fsSL "${SOURCE_ARCHIVE_URL}" -o "${archive}"
    if [ -n "${SUDO}" ]; then
        "${SUDO}" rm -rf "${cache_dir}"
        "${SUDO}" mkdir -p "${cache_dir}"
        "${SUDO}" chown -R "$(id -u):$(id -g)" "${cache_dir}"
    else
        rm -rf "${cache_dir}"
        mkdir -p "${cache_dir}"
    fi
    first_entry="$(tar -tzf "${archive}" | head -n 1 || true)"
    if [[ "${first_entry}" == */* ]]; then
        strip_args=(--strip-components=1)
    fi
    tar -xzf "${archive}" "${strip_args[@]}" -C "${cache_dir}"
}

build_image_from_source() {
    local image="$1"
    case "${image}" in
        */qq-farm-bot-ui:*|qq-farm-bot-ui:*|smdk000/qq-farm-bot-ui:*)
            prepare_source_checkout
            ensure_official_image "node:20-alpine" || return 1
            print_warning "镜像 ${image} 拉取失败，开始从源码构建..."
            "${DOCKER[@]}" build -t "${image}" -f "${SOURCE_CACHE_DIR}/core/Dockerfile" "${SOURCE_CACHE_DIR}"
            ;;
        *)
            return 1
            ;;
    esac
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

resolve_deploy_dir() {
    if [ -f "${DEPLOY_DIR}/docker-compose.yml" ]; then
        return 0
    fi

    if [ -L "${CURRENT_LINK}" ] || [ -d "${CURRENT_LINK}" ]; then
        if [ -f "${CURRENT_LINK}/docker-compose.yml" ]; then
            DEPLOY_DIR="${CURRENT_LINK}"
            return 0
        fi
    fi

    local latest=""
    latest="$(find "${DEPLOY_BASE_DIR}" -mindepth 2 -maxdepth 2 -type d -name qq-farm-bot 2>/dev/null | sort | tail -n 1)"
    if [ -n "${latest}" ] && [ -f "${latest}/docker-compose.yml" ]; then
        DEPLOY_DIR="${latest}"
        return 0
    fi

    print_error "未找到可用部署目录。请通过 --deploy-dir 指定，或先执行 fresh-install.sh。"
    exit 1
}

sync_bundle() {
    local target_dir="$1"
    local init_dir="${target_dir}/init-db"
    local bundle_dir=""
    local bundle_env_example=""
    local bundle_readme=""
    local bundle_init_sql=""
    local bundle_update=""
    local bundle_fresh=""
    local bundle_quick=""

    mkdir -p "${init_dir}"

    if [ -f "${target_dir}/docker-compose.yml" ] && [ -f "${target_dir}/.env" ]; then
        :
    else
        print_error "部署目录缺少 docker-compose.yml 或 .env: ${target_dir}"
        exit 1
    fi

    if [ -f "${SCRIPT_DIR}/fresh-install.sh" ] \
        && [ -f "${SCRIPT_DIR}/../../deploy/docker-compose.yml" ] \
        && [ -f "${SCRIPT_DIR}/../../deploy/.env.example" ]; then
        bundle_dir="${SCRIPT_DIR}/../../deploy"
        bundle_env_example="${bundle_dir}/.env.example"
        bundle_readme="${bundle_dir}/README.md"
        bundle_init_sql="${bundle_dir}/init-db/01-init.sql"
        bundle_update="${SCRIPT_DIR}/update-app.sh"
        bundle_fresh="${SCRIPT_DIR}/fresh-install.sh"
        bundle_quick="${SCRIPT_DIR}/quick-deploy.sh"
    elif [ -f "${SCRIPT_DIR}/docker-compose.yml" ] \
        && [ -f "${SCRIPT_DIR}/.env.example" ] \
        && [ -f "${SCRIPT_DIR}/init-db/01-init.sql" ]; then
        bundle_dir="${SCRIPT_DIR}"
        bundle_env_example="${bundle_dir}/.env.example"
        bundle_readme="${bundle_dir}/README.md"
        bundle_init_sql="${bundle_dir}/init-db/01-init.sql"
        bundle_update="${bundle_dir}/update-app.sh"
        bundle_fresh="${bundle_dir}/fresh-install.sh"
        bundle_quick="${bundle_dir}/quick-deploy.sh"
    fi

    if [ -n "${bundle_dir}" ]; then
        if [ "${PRESERVE_COMPOSE_LAYOUT}" != "1" ]; then
            copy_file_if_needed "${bundle_dir}/docker-compose.yml" "${target_dir}/docker-compose.yml"
            copy_file_if_needed "${bundle_env_example}" "${target_dir}/.env.example"
            copy_file_if_needed "${bundle_readme}" "${target_dir}/README.md"
            copy_file_if_needed "${bundle_init_sql}" "${init_dir}/01-init.sql"
        elif [ ! -f "${target_dir}/.env.example" ]; then
            copy_file_if_needed "${bundle_env_example}" "${target_dir}/.env.example"
        fi

        copy_file_if_needed "${bundle_update}" "${target_dir}/update-app.sh"
        copy_file_if_needed "${bundle_fresh}" "${target_dir}/fresh-install.sh"
        copy_file_if_needed "${bundle_quick}" "${target_dir}/quick-deploy.sh"
    else
        if [ "${PRESERVE_COMPOSE_LAYOUT}" != "1" ]; then
            download_file "deploy/docker-compose.yml" "${target_dir}/docker-compose.yml"
            download_file "deploy/.env.example" "${target_dir}/.env.example"
            download_file "deploy/README.md" "${target_dir}/README.md"
            download_file "deploy/init-db/01-init.sql" "${init_dir}/01-init.sql"
        elif [ ! -f "${target_dir}/.env.example" ]; then
            download_file "deploy/.env.example" "${target_dir}/.env.example"
        fi

        download_file "scripts/deploy/update-app.sh" "${target_dir}/update-app.sh"
        download_file "scripts/deploy/fresh-install.sh" "${target_dir}/fresh-install.sh"
        download_file "scripts/deploy/quick-deploy.sh" "${target_dir}/quick-deploy.sh"
    fi

    chmod +x "${target_dir}/update-app.sh" "${target_dir}/fresh-install.sh" "${target_dir}/quick-deploy.sh"
}

wait_for_app() {
    local timeout="${1:-240}"
    local started_at
    started_at="$(date +%s)"

    while true; do
        local status="missing"
        local health="none"

        if status="$("${DOCKER[@]}" inspect -f '{{.State.Status}}' "${APP_CONTAINER_NAME}" 2>/dev/null)"; then
            health="$("${DOCKER[@]}" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${APP_CONTAINER_NAME}" 2>/dev/null || true)"
        fi

        if [ "${status}" = "running" ] && { [ "${health}" = "healthy" ] || [ "${health}" = "none" ]; }; then
            print_success "${APP_CONTAINER_NAME} 已恢复运行。"
            return 0
        fi

        if [ $(( $(date +%s) - started_at )) -ge "${timeout}" ]; then
            print_error "${APP_CONTAINER_NAME} 在 ${timeout}s 内未恢复健康。"
            "${DOCKER[@]}" logs --tail 120 "${APP_CONTAINER_NAME}" || true
            return 1
        fi

        sleep 5
    done
}

compose_pull_with_retry() {
    if [ "${SKIP_DOCKER_PULL}" = "1" ] || [ "${SKIP_DOCKER_PULL}" = "true" ]; then
        print_info "检测到 SKIP_DOCKER_PULL=${SKIP_DOCKER_PULL}，跳过主程序镜像拉取，直接使用本地镜像。"
        return 0
    fi

    local app_image="${APP_IMAGE:-smdk000/qq-farm-bot-ui:latest}"
    if ! pull_image_or_build "${app_image}"; then
        print_error "主程序镜像拉取最终失败: ${app_image}"
        print_error "请检查 GitHub / Docker Hub 官方网络连通性，或在 .env 中覆盖 APP_IMAGE。"
        return 1
    fi
}

main() {
    parse_args "$@"
    ensure_docker
    resolve_deploy_dir

    load_deploy_env "${DEPLOY_DIR}/.env"
    APP_SERVICE="${APP_SERVICE:-qq-farm-bot}"
    COMPOSE_APP_SERVICE="${COMPOSE_APP_SERVICE:-${APP_SERVICE}}"
    APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-${APP_SERVICE}}"
    if [ -n "${APP_IMAGE_OVERRIDE}" ]; then
        APP_IMAGE="${APP_IMAGE_OVERRIDE}"
    fi
    sync_bundle "${DEPLOY_DIR}"
    load_deploy_env "${DEPLOY_DIR}/.env"
    APP_SERVICE="${APP_SERVICE:-qq-farm-bot}"
    COMPOSE_APP_SERVICE="${COMPOSE_APP_SERVICE:-${APP_SERVICE}}"
    APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-${APP_SERVICE}}"
    if [ -n "${APP_IMAGE_OVERRIDE}" ]; then
        APP_IMAGE="${APP_IMAGE_OVERRIDE}"
    fi

    cd "${DEPLOY_DIR}"

    local old_image=""
    local new_image=""
    old_image="$("${DOCKER[@]}" inspect -f '{{.Image}}' "${APP_CONTAINER_NAME}" 2>/dev/null || true)"

    print_info "仅更新主程序容器，不会重启 MySQL / Redis / ipad860。"
    compose_pull_with_retry
    "${DOCKER[@]}" compose up -d --no-deps "${COMPOSE_APP_SERVICE}"
    wait_for_app 240

    new_image="$("${DOCKER[@]}" inspect -f '{{.Image}}' "${APP_CONTAINER_NAME}" 2>/dev/null || true)"

    echo ""
    "${DOCKER[@]}" compose ps
    echo ""
    print_success "主程序更新完成。"
    echo "部署目录: ${DEPLOY_DIR}"
    echo "Compose 服务: ${COMPOSE_APP_SERVICE}"
    echo "容器名称: ${APP_CONTAINER_NAME}"
    echo "旧镜像 ID: ${old_image:-unknown}"
    echo "新镜像 ID: ${new_image:-unknown}"
    echo "未变更服务: qq-farm-mysql / qq-farm-redis / qq-farm-ipad860"
    echo ""
}

main "$@"
