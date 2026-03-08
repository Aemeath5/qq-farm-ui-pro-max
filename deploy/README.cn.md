# QQ 农场智能助手 - 国内网络部署说明

本文档用于中国大陆或访问 GitHub / Docker Hub 不稳定的服务器环境。

默认部署脚本仍以官方源为准：

- GitHub：`raw.githubusercontent.com` / `codeload.github.com`
- Docker：`docker.io`

如果你的服务器已经可以稳定访问官方源，请直接使用 [deploy/README.md](README.md) 的标准部署流程；本文重点说明国内网络下更稳的两种做法。

## 推荐方式

优先级建议如下：

1. 使用维护者提前打好的离线一体包
2. 手动传输部署文件和镜像包，再在服务器本地启动
3. 只有在服务器能直接访问官方源时，才使用在线一键脚本

## 方案 1：离线一体包部署

这是国内网络最稳的方式。维护者先在网络正常的环境中生成离线包，再上传到服务器执行。

维护者在本地执行：

```bash
cd deploy/scripts
bash build-all-and-push.sh
```

脚本中选择：

- `1`：全部构建（主程序 + ipad860 + 离线包）
- 或 `4`：仅导出离线包（前提是镜像已提前构建完成）

生成结果在：

```bash
deploy/offline/qq-farm-bot-v<版本号>-offline.tar.gz
```

上传到服务器后执行：

```bash
tar xzf qq-farm-bot-v<版本号>-offline.tar.gz
cd qq-farm-bot-release
cp .env.example .env
vi .env
chmod +x install.sh
./install.sh
```

完成后再检查：

```bash
docker compose ps
curl http://127.0.0.1:3080/api/ping
```

## 方案 2：部署文件 + 镜像包分开传输

如果你不想传整包，可以把部署文件和镜像文件分开上传。

维护者在本地准备：

```bash
cd deploy/scripts
bash build-all-and-push.sh
```

需要的文件：

- `deploy/offline/qq-farm-bot-images.tar.gz`
- `deploy/offline/qq-farm-bot-deploy.tar.gz`

服务器执行：

```bash
mkdir -p /opt/$(date +%Y_%m_%d)/qq-farm-bot
cd /opt/$(date +%Y_%m_%d)/qq-farm-bot

tar xzf /path/to/qq-farm-bot-deploy.tar.gz
cp .env.example .env
vi .env

docker load < /path/to/qq-farm-bot-images.tar.gz
docker compose up -d

ln -sfn "$(pwd)" /opt/qq-farm-bot-current
```

验证：

```bash
docker compose ps
docker compose logs -f qq-farm-bot
curl http://127.0.0.1:3080/api/ping
```

## 已部署服务器只更新主程序

国内网络下更新主程序，建议也走“预载镜像 + 跳过在线拉取”的方式。

先把新的主程序镜像导入服务器，然后执行：

```bash
cd /opt/qq-farm-bot-current
SKIP_DOCKER_PULL=1 ./update-app.sh --image smdk000/qq-farm-bot-ui:v4.5.10
```

这个模式只更新主程序，不会重启：

- `qq-farm-mysql`
- `qq-farm-redis`
- `qq-farm-ipad860`

## 如果服务器可以直连官方源

可以直接使用标准部署文档：

- 标准部署说明：[deploy/README.md](README.md)
- 根 README 部署章节：[README.md](../README.md)

在线一键命令：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/smdk000/qq-farm-ui-pro-max/main/scripts/deploy/fresh-install.sh)
```

## 说明

- 本文档不改变默认部署脚本行为，只提供更适合国内网络的交付方式。
- 国内网络最稳定的方案仍然是“离线包”或“预载镜像后再启动”。
- 如果你后续要频繁给客户部署，建议每次发布版本时同步产出离线包。
