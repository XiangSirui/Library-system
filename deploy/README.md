# 生产部署与备份

此目录是自建 Linux 服务器的部署方案。当前尚未连接真实服务器、签发真实域名证书或完成微信真机验收；本机没有 Docker，容器构建需在准备好的服务器执行。不要把本地 Flask 开发服务作为正式服务。

## 需要准备的配置

- 大陆服务器及适用备案、可解析到服务器的域名、开放 80 / 443 端口。
- 微信后台的 AppID、AppSecret；AppSecret 只填写在服务器，不能进入小程序、Git 或聊天。
- 微信后台按实际服务域名配置 request / uploadFile / downloadFile；填写隐私保护指引、运营联系方式和服务类目。
- 新管理员密码（至少 12 位）和新的随机 SECRET_KEY（至少 32 字符）。
- Linux 安装 Docker Engine 与 Compose 插件。域名 DNS 指向服务器后，Caddy 自动申请和续期 HTTPS 证书。

## 首次安装

代码放在 /opt/yuexiang（也可以使用其他路径，同步修改定时任务的 WorkingDirectory）。

```sh
cd /opt/yuexiang
cp deploy/.env.example deploy/.env
cp deploy/app.env.example deploy/app.env
chmod 600 deploy/.env deploy/app.env
```

在服务器本地编辑两个文件：
- .env 的 SITE_DOMAIN 只填域名，不带 https:// 或路径。
- app.env 的 PUBLIC_BASE_URL 填相同域名的 https:// 地址。
- 填入 SECRET_KEY、WECHAT_APP_ID、WECHAT_APP_SECRET、DOOR_CODE_KEY、INITIAL_ADMIN_PASSWORD。
- 使用随机密码；env 文件中有特殊字符时按 Compose env 文件语法正确加引号。

DOOR_CODE_KEY 必须在服务器本地生成一次，并长期保管；安装 requirements.txt 后运行：

```sh
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

仅把输出填入受限的 app.env，不发送到聊天或提交 Git。SECRET_KEY 也需单独生成随机值，不能复用门锁密钥。门锁采用 [Fernet 认证加密](https://cryptography.io/en/latest/fernet/)；丢失密钥后旧密码无法解密，需管理员重新登记。密钥应在独立的安全存储中备份，恢复快照时配置原密钥；不要随意替换密钥，轮换前应安排旧密码重新加密或重新设置。

然后：

```sh
cd /opt/yuexiang/deploy
docker compose build app
docker compose up -d
docker compose ps
docker compose logs --tail 60 app proxy
```

浏览器访问 https://你的域名/healthz 应返回 {"status":"ok"}，/garden 应显示图片。
生产模式会拒绝缺少配置、开发用 SECRET_KEY、全新数据库未设置初始密码、已有库仍用 admin123 的情况。新库的管理员用户名为 admin；确认初始化后可清空 INITIAL_ADMIN_PASSWORD 并重新创建 app 容器，已有库不会重置密码。

修改 miniprogram/config.js 的 develop / trial / release 到测试或生产 HTTPS 地址。project.config.json 的 AppID 必须与服务端一致。本地 urlCheck:false 不能作为正式发布设置。

架构：Caddy 负责 HTTPS，Gunicorn 运行单个进程和 4 个线程。SQLite 与照片存于 data 命名卷，备份在 backups 卷；应用以非 root 用户运行。访问日志只记录 URL 路径，不记录手机号查询参数、令牌或门锁密码。只对外暴露 80 / 443，不对外开放数据库或 8000 端口。单个数据卷对应一个应用实例；不要复制成各自使用独立 SQLite 的多实例。

## 旧数据迁移与身份归属

旧版本不认识新的备份锁，因此迁移前先停止旧服务，再成套备份原 library.db 和志愿照片。可在原机器执行：

```sh
python scripts/backup_restore.py backup --database /原路径/library.db --uploads /原路径/static/uploads/volunteer --output /安全备份目录
```

把生成的整个快照目录通过安全连接传到服务器，不要放进 static 或公开网站。首次启动前可以使用 app 镜像把快照恢复到新的 data 子目录：

```sh
docker compose run --rm --no-deps -v /安全快照目录:/snapshot:ro app python scripts/backup_restore.py restore --snapshot /snapshot --target /data/imported
```

在 deploy/.env 设置：
```dotenv
LIBRARY_DB_PATH=/data/imported/library.db
LIBRARY_UPLOAD_DIR=/data/imported/uploads
```

旧管理员密码如果仍为默认值，先运行以下命令交互修改，再启动服务：
```sh
docker compose run --rm --no-deps app python scripts/set_admin_password.py --username admin
docker compose up -d
```

数据库迁移添加微信账户、会话、审计表、记录归属列和加密门锁密码表。旧记录保留，初始归属为空：
1. 读者在小程序微信登录，在“我的”出示账户编号。
2. 管理员核对原始借阅证、业务记录等，不以输入的手机号作为唯一核验依据。
3. 管理员在小程序管理页找到旧借阅 / 预约 / 书评，点击“核验并绑定旧记录”，填写账户编号及说明。
4. 系统记录处理人、记录编号、目标账户和说明。已绑定记录不能通过此入口换绑；有争议时先人工核实。

书评资格跟随真实借阅记录；有旧书评的读者应先完成旧借阅记录的绑定。手机号只是联系信息，没有进行短信或微信手机号验证，也不用于取得其他账户的记录。

## 门锁密码操作

小程序管理员在“预约 → 门锁密码”登记每条预约对应的实体密码；电脑浏览器后台也支持设置、替换及移除。4–32 位数字、字母、* 或 #。该居民保存后即可查看，到预约结束（北京时间）自动隐藏，取消和签退即时失去读取权限。未设置时提示联系管理员。管理员列表及接口不返回旧密码，只显示是否设置。

本功能不远程操作实体门锁，也无法使居民已记住的密码失效。请在实体门锁上设置预约有效期或及时更换密码，并同步更新预约。设置和移除会记录管理员审计日志，日志不保存密码。

## 已知旧照片缺失的迁移

默认备份与恢复拒绝照片引用缺失。只有需要先保全现有旧数据时，才在 backup、verify、restore 命令中显式添加 `--allow-missing-photos`；快照会在 manifest.json 的 missingPhotos 中记录缺失引用。该模式不会补造照片或删除旧记录，恢复后缺失仍然存在，不能用于宣称完整恢复。每日自动备份仍保持严格模式。

本机已知例外及保全快照见 [验证记录](../docs/VERIFICATION.md)。正式上线前先核实并处理缺失旧照片，再执行不带此参数的完整备份恢复演练。

## 每日备份

新服务写操作与备份共享跨进程锁；备份期间公开读取仍可用，写入短暂等待，等待超时会要求重试。脚本使用 SQLite 在线备份，随后复制一致的照片集合，并校验数据库、照片引用及 SHA-256 清单。临时目录验证成功后才成为正式快照。

手动备份：
```sh
cd /opt/yuexiang/deploy
docker compose --profile maintenance run --rm -T backup
```

安装每天北京时间 03:30 的 systemd 定时任务：
```sh
sudo cp yuexiang-backup.service yuexiang-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yuexiang-backup.timer
sudo systemctl start yuexiang-backup.service
sudo systemctl status yuexiang-backup.service
sudo systemctl list-timers yuexiang-backup.timer
```

快照位置在 backups 数据卷中；命令输出的目录名即 SNAPSHOT_ID。请安排将快照加密复制到另一台机器或受限对象存储，监控任务失败及磁盘空间。当前未配置外部存储凭据，不能把本机备份称为异地备份；脚本不会自动删除旧快照，清理前先确认异地副本及恢复演练通过。

可导出快照到主机的受限目录，再通过安全连接转存：
```sh
umask 077
docker compose --profile maintenance run --rm -T backup tar -C /backups -czf - SNAPSHOT_ID > /安全目录/SNAPSHOT_ID.tar.gz
```

备份包含个人数据和密码哈希，文件校验只能检测损坏，不能替代访问控制或加密。

## 恢复演练与故障恢复

先验证快照：
```sh
docker compose --profile maintenance run --rm -T backup python scripts/backup_restore.py verify /backups/SNAPSHOT_ID
```

恢复到新目录，不覆盖当前数据库：
```sh
docker compose --profile maintenance run --rm -T backup python scripts/backup_restore.py restore --snapshot /backups/SNAPSHOT_ID --target /data/restored-check
```

脚本拒绝覆盖已有目录、损坏清单、路径越界和照片缺失，恢复后删除所有旧登录会话，要求用户及管理员重新登录。

正式切换时，先停止 app，保留现有数据；在 deploy/.env 将 LIBRARY_DB_PATH / LIBRARY_UPLOAD_DIR 指向恢复目录，再启动 app：
```sh
docker compose stop app
# 本地编辑 .env，设置 /data/restored-check/library.db 与 /data/restored-check/uploads
docker compose up -d app
```

检查健康接口、馆藏数量、借阅状态、日历和照片。恢复会回退快照之后的数据，请记录恢复点、核对差异并按需重设管理员密码。回滚也通过切换目录完成，禁止 docker compose down -v 删除业务数据卷。

## 上线验收

按 [真机验收清单](../docs/DEVICE_ACCEPTANCE.md) 完成两名真实微信用户的隔离测试、手机和电脑微信布局、照片授权与上传、备份恢复、域名与证书验证后，再上传体验版及提审。

公开网页继续展示花园、馆藏和开放时段；个人操作统一引导到微信登录。网页管理后台仍支持管理员登录，并增加 CSRF 校验及可撤销会话。

旧 render.yaml 的免费临时磁盘方案已停用，统一使用本目录的持久化部署方案。
