#!/usr/bin/env bash
# 拉取 kaibush/new-api 发布到 GHCR 的镜像，并更新本机 /opt/new-api 服务。
# 只修改 NEW_API_IMAGE。不改数据库密码、SESSION_SECRET、CRYPTO_SECRET，也不删除 MySQL 数据卷。
#
# 用法：
#   bash scripts/update-local-service.sh
#   bash scripts/update-local-service.sh <commit-sha>
set -Eeuo pipefail

image_repo="ghcr.io/kaibush/new-api"
github_repo="kaibush/new-api"
deploy_dir="/opt/new-api"
compose_file="$deploy_dir/docker-compose.yml"
env_file="$deploy_dir/.env"
ref="${1:-latest}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "错误：请使用 root 执行。" >&2
  exit 1
fi
for command_name in docker curl python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "错误：缺少命令：$command_name" >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "错误：未安装 Docker Compose v2（docker compose）。" >&2
  exit 1
fi
if [[ ! -r "$compose_file" || ! -r "$env_file" ]]; then
  echo "错误：New API 尚未安装。需要 $compose_file 和 $env_file。" >&2
  exit 1
fi

resolve_commit() {
  local name="$1"
  local payload
  if ! payload="$(curl -fsS \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: new-api-local-update" \
    "https://api.github.com/repos/${github_repo}/commits/${name}")"; then
    echo "错误：无法从 GitHub 解析提交：$name" >&2
    exit 1
  fi
  python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])' <<<"$payload"
}

case "$ref" in
  latest)
    image_tag="latest"
    ;;
  sha-[0-9a-fA-F]*)
    image_tag="$ref"
    ;;
  [0-9a-fA-F]*)
    if [[ ! "$ref" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
      echo "错误：提交号必须是 7 到 40 位十六进制字符。" >&2
      exit 1
    fi
    full_sha="$(resolve_commit "$ref")"
    image_tag="sha-${full_sha}"
    ;;
  *)
    echo "错误：只接受 latest 或提交号。" >&2
    exit 1
    ;;
esac

image_ref="${image_repo}:${image_tag}"
echo "正在拉取 ${image_ref} ……"
docker pull "$image_ref" >/dev/null

pinned="$(docker image inspect "$image_ref" --format '{{index .RepoDigests 0}}')"
revision="$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
source_url="$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.source"}}')"
if [[ "$pinned" != "${image_repo}@sha256:"* || -z "$revision" || "$source_url" != "https://github.com/${github_repo}" ]]; then
  echo "错误：镜像来源或摘要不符合 ${github_repo}。" >&2
  exit 1
fi

current_image="$(awk -F= '$1=="NEW_API_IMAGE"{print substr($0,index($0,"=")+1); exit}' "$env_file")"
running_image="$(docker inspect -f '{{.Config.Image}}' new-api 2>/dev/null || true)"
if [[ "$current_image" == "$pinned" && "$running_image" == "$pinned" ]]; then
  echo "本地服务已是 ${pinned}。"
  echo "版本：${revision}"
  exit 0
fi

backup_file="$deploy_dir/.env.before-${revision:0:12}"
if [[ -e "$backup_file" ]]; then
  backup_file="${backup_file}-$(date +%Y%m%d%H%M%S)"
fi
cp -a "$env_file" "$backup_file"
chmod 0600 "$backup_file"

tmp_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

updated=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == NEW_API_IMAGE=* ]]; then
    printf 'NEW_API_IMAGE=%s\n' "$pinned"
    updated=1
  else
    printf '%s\n' "$line"
  fi
done < "$env_file" > "$tmp_file"
if [[ "$updated" -ne 1 ]]; then
  echo "错误：$env_file 缺少 NEW_API_IMAGE。" >&2
  exit 1
fi
install -m 0600 "$tmp_file" "$env_file"

port="$(awk -F= '$1=="NEW_API_PORT"{print substr($0,index($0,"=")+1); exit}' "$env_file")"
port="${port:-3000}"
if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "错误：NEW_API_PORT 不是有效端口。" >&2
  exit 1
fi

compose() {
  docker compose --project-directory "$deploy_dir" \
    --env-file "$env_file" -f "$compose_file" "$@"
}

restore_previous() {
  echo "错误：新版本未就绪，正在恢复上一版镜像。" >&2
  install -m 0600 "$backup_file" "$env_file"
  compose up -d new-api >/dev/null || true
}

echo "正在切换本地服务……"
if ! compose up -d new-api; then
  restore_previous
  exit 1
fi

ready=0
for _ in {1..40}; do
  if curl -fsS -o /dev/null --connect-timeout 2 --max-time 5 \
    "http://127.0.0.1:${port}/api/status"; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  compose logs --tail=80 new-api >&2 || true
  restore_previous
  exit 1
fi

running_revision="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' new-api)"
if [[ "$running_revision" != "$revision" ]]; then
  echo "错误：容器版本是 ${running_revision}，不是 ${revision}。" >&2
  restore_previous
  exit 1
fi

echo "本地服务已更新。"
echo "镜像：${pinned}"
echo "版本：${revision}"
echo "配置备份：${backup_file}"
