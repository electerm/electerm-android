# electerm-android 发布到 Google Play 完整指南

面向已注册并通过验证的 **组织账号** 开发者。

> 本文档中的所有结论均在本机实测验证过（构建产物、ELF 段对齐、签名注入、
> CI 步骤序列），不是照抄文档。

---

## 第 0 步：先看结论

### 合规性自检结果

| 检查项 | 要求 | 当前值 | 结论 |
|---|---|---|---|
| 目标 API 级别 | 2026-08-31 起新应用需 API 36 | 36 | 通过 |
| 最低 SDK | 无硬性要求 | 24 | 通过 |
| 16 KB 内存页 | 64 位设备必须支持 | arm64-v8a / x86_64 均为 16384 对齐 | 通过 |
| 64 位原生库 | 必须 | arm64-v8a + x86_64 | 通过 |
| 上传格式 | 新应用只收 .aab | bundleRelease 可产出 | 通过 |
| 签名 | Play App Signing | upload key 注入 AAB 生效 | 通过 |
| versionCode | 每次上传必须递增 | 原为硬编码 1 | **已修复** |
| 敏感权限 | 无需声明 | 只有 INTERNET 等基础权限 | 通过 |
| 隐私政策 URL | 必填 | electerm.org/privacy-policy/ | 通过 |

### 体积实测（5.8.0）

| 指标 | 数值 |
|---|---|
| `app-release.aab`（上传的文件） | 107 MB |
| 单设备压缩后下载（最大 ABI） | 约 24 MB |
| Play 上限（单设备压缩下载） | 200 MB |

**注意**：200 MB 上限算的是**单台设备的压缩下载量**，不是上传的 .aab 文件大小。
AAB 里有三个 ABI 的原生库，Play 会按设备裁剪，所以真实下载量只有约 24 MB。

### 16 KB 那项的细节

`armeabi-v7a/libc++_shared.so` 仍是 4096 对齐，**不影响过审**——16 KB 要求只针对
64 位设备，32 位 ARM 不在范围内。

---

## 第 1 步：Play Console 里创建应用

### 1.1 创建应用条目

打开 <https://play.google.com/console> → 左上角 **全部应用** → **创建应用**

| 字段 | 填写 | 说明 |
|---|---|---|
| 应用名称 | `electerm` | 上限 30 字符，可后续改 |
| 默认语言 | 英语（美国） | |
| 应用还是游戏 | 应用 | |
| 免费还是付费 | **免费** | **此选项发布后不可逆**，想清楚再选 |
| 联系邮箱 | 你的邮箱 | 会在商店页展示 |
| 声明 | 全部勾选 | 开发者计划政策、美国出口法规、Play 应用签名条款 |

包名 **不需要填**——它从 AAB 的 manifest 里读，即 `org.electerm.electerm`。
创建后**永久不可改**，也无法复用。

### 1.2 填「应用内容」（政策 → 应用内容）

这是最常见的卡审环节，每一项都要填：

| 项目 | 怎么填 | 说明 |
|---|---|---|
| 隐私政策 | `https://electerm.org/privacy-policy/` | 已存在，内容完整，且已提及 Android |
| 广告 | **此应用不含广告** | 项目里无任何广告 SDK |
| 应用访问 | 见下方说明 | 需要审核员能进得去 |
| 内容分级 | IARC 问卷，如实回答 | 无暴力/色情/赌博，通常评所有人级 |
| 目标受众和内容 | 建议只选 18 岁及以上 | 选到 13 岁以下会触发「面向家庭」政策 |
| 数据安全 | 见下方说明 | **必须与隐私政策一致** |
| 敏感权限 | 无需填 | 项目里没有敏感权限 |

#### 「应用访问」怎么写

这个应用**不需要登录**就能用（`ENABLE_AUTH` 未开启，Web UI 自动登录），
内置服务器只监听 `127.0.0.1`。所以照实写即可：

> 本应用无需登录或任何特殊访问权限即可使用全部功能。启动后直接进入主界面，
> 即可创建 SSH / SFTP / Telnet / RDP / VNC 连接。

#### 「数据安全」怎么填

项目里**没有任何遥测、统计、崩溃上报 SDK**（已核查 package.json，无
analytics / sentry / firebase / mixpanel 等）。所以：

- 收集：**无**
- 共享：**无**
- 数据在传输中加密：SSH / SFTP / RDP / VNC 协议本身加密，可如实说明

> ⚠️ **一个容易被忽略的点**：应用会在设备本地保存 SSH 密码和密钥
> （存于 `files/capawesome_nodejs/electerm-data`）。Play 的「数据安全」问的是
> **是否传出设备**，本地存储不算收集，所以选「不收集」是准确的。
> 但隐私政策里要提到本地存储，避免两边不一致被拒。

### 1.3 商店展示信息（增长 → 商店展示信息）

| 素材 | 要求 | 现状 |
|---|---|---|
| 应用图标 | 512 × 512 PNG，32 位 | **仓库里没有**，最大只有 192 px |
| 特色图片 | 1024 × 500 | **仓库里没有** |
| 手机截图 | 至少 2 张，320–3840 px | **仓库里没有** |
| 短说明 | 80 字符内 | 待撰写 |
| 完整说明 | 4000 字符内 | 待撰写 |
| 分类 | 工具 / 效率 | |
| 联系邮箱 | 必填 | |

**图标怎么生成**：源图是 `build/electerm-logo-square.png`（2160×2160，不带 alpha），
用 macOS 自带的 `sips` 缩到 512 即可，无需装 Python 依赖：

```bash
cd /Users/zxd/dev/electerm-android
sips -z 512 512 build/electerm-logo-square.png --out temp/play-icon-512.png
```

产出 512×512 PNG，正好符合 Play 要求（32 位、可带 alpha）。

> 注意别直接用 `build/android/res-overlay/mipmap-*/ic_launcher.png`——那是启动图标，
> 已经过圆角遮罩和密度裁切，做商店图标会变形。
> （`build/android/scripts/gen-assets.py` 引用的源在 `temp/` 下，那目录是构建中间物、
> 会被清理；长期可用的源图在 `build/` 下。）

> 特色图片和截图需要人工在真机/模拟器上截取。

---

## 第 2 步：Play App Signing 的密钥决策（**最关键**）

### 两个密钥的区别

| 密钥 | 作用 | 谁持有 |
|---|---|---|
| **upload key**（上传密钥） | 签名你上传的 .aab | 你（CI 里的 keystore） |
| **app signing key**（应用签名密钥） | 签名发给用户的 APK | Google（默认）或你 |

### 必须做的一个决策

现有 GitHub Release 的 APK 都用 `ANDROID_RELEASE_KEYSTORE_BASE64` 这把密钥签名。

- **如果让 Google 自己生成 app signing key**：Play 版和侧载版**签名不同**，
  侧载用户装 Play 版时必须先卸载原版，**用户数据（书签、凭据）会丢**。
- **如果把同一把密钥注册为 Play 的 app signing key**：两个渠道签名一致，
  侧载用户可以直接覆盖升级，数据保留。

### 推荐做法

用同一把密钥，操作路径：

**Play Console → 版本 → 设置 → 应用签名 → 更改应用签名密钥 →
从 Java 密钥库上传新的应用签名密钥**

Google 会让你下载两样东西：
- **PEPK 工具** `pepk.jar`
  （官方地址 `https://www.gstatic.com/play-apps-publisher-rapid/signing-tool/prod/pepk.jar`）
- **加密公钥** `encryption_public_key.pem`（每个应用不同，从页面下载）

然后在本地跑（本仓库已用 JDK 21 + 官方 pepk.jar 实测通过）：

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"

# 产出 Play 要的 zip（内含 encryptedPrivateKey + certificate.pem）
java -jar pepk.jar \
  --keystore release.keystore \
  --alias electerm \
  --output=signing_key.zip \
  --keystore-pass "$STORE_PASS" \
  --key-pass "$KEY_PASS" \
  --rsa-aes-encryption \
  --encryption-key-path=encryption_public_key.pem \
  --include-cert

# upload key 的公开证书（上传到 "Upload your upload key certificate"）
keytool -export -rfc \
  -keystore release.keystore \
  -alias electerm \
  -file upload_certificate.pem \
  -storepass "$STORE_PASS"
```

两个产物对应 Play Console 的两个上传位：

| 产物 | Play Console 的位置 |
|---|---|
| `signing_key.zip` | 上传新的应用签名密钥（Java 密钥库） |
| `upload_certificate.pem` | 上传 upload key 证书 |

> **JDK 版本**：PEPK 用 `RSA/NONE/OAEPWithSHA1AndMGF1Padding`，
> 老 JDK 会报 `Cannot find any provider supporting...`。
> 用 JDK 21 没问题（JDK 11 及以下可能失败）。

### 怎么拿到 keystore 文件

**GitHub 无法读回 secret 的值**，两条路都不通：

- `gh secret get` 这个子命令在 gh 2.x 已不存在（只有 `set` / `list` / `delete`）
- `gh api repos/{owner}/{repo}/actions/secrets/<NAME>` 只返回
  `name` / `created_at` / `updated_at`，**不含** `encrypted_value`

所以 keystore 文件只能来自**你自己当初创建它时保存的位置**
（密码管理器、离线备份、当初那台机器）。这密钥是 2026-07-17 前后创建的，
应该还能找到。

### 找不到时的替代方案：用 CI 直接做 PEPK 导出

**不需要**把 keystore 弄到本地。仓库里加了一个
`.github/workflows/export-play-signing.yml`，在 runner 内部完成
「解出 keystore → PEPK 加密导出 → 删掉 keystore」的全过程：

- **明文 keystore 不会进入 artifact**，只有加密后的产物会
- 产物正是 Play Console 要的那两个文件

需要的额外 secret：

```bash
# 从 Play Console 的 "Upload a new app signing key from Java Keystore"
# 页面下载 encryption_public_key.pem，转成 base64 存进去
base64 -i encryption_public_key.pem | tr -d '\n' > /tmp/ek.txt
gh secret set PLAY_ENCRYPTION_KEY_B64 < /tmp/ek.txt
```

> `encryption_public_key.pem` 是**公钥**，存进 secret 只是为了免去每次手动上传，
> 它本身不是敏感信息。

触发后下载 artifact `play-signing-material`，得到：

| 文件 | 用途 |
|---|---|
| `signing_key.zip` | Play 的「Upload a new app signing key from Java Keystore」 |
| `encrypted_private_key.pem` | 同上，单文件版本 |
| `upload_certificate.pem` | Play 的「Upload your upload key certificate」 |
| `keystore-info.txt` | 密钥指纹（SHA1/SHA256） |

> **关于安全性**：公开仓库的 artifact **列表**可以匿名访问，但**下载需要认证**
> （实测匿名下载返回 401）。不过别当它安全——artifact 保留 7 天，
> 拿到 `signing_key.zip` 就能解出你的签名私钥。用完请立刻删除 artifact。

### 如果连 PEPK 方案也不走

那就**别再追求和侧载版签名一致**，改用 Google 推荐的标准做法：

| 密钥 | 用哪把 |
|---|---|
| upload key | **新生成一把**，专供 Play 上传用 |
| app signing key | 让 Google 自动生成 |

代价是明确的：**Play 版和侧载版成为两个不同的应用**，侧载用户装 Play 版
必须先卸载原版，本地书签和凭据会丢。

如果你能找回原 keystore，仍然推荐按上面的「同一把密钥」方案，两边可平滑升级。

> 无论走哪条路，**upload key 和 app signing key 都应该不同**
> （Google 官方建议）。upload key 泄露可以重置，app signing key 泄露就只能
> 联系 Google 了。

---

## 第 3 步：创建 Service Account（CI 自动上传用）

### 3.1 建服务账号

1. 打开 <https://console.cloud.google.com/>
2. 启用 **Google Play Android Developer API**
   （<https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com>）
3. **IAM 和管理 → 服务账号 → 创建服务账号**
   - 名称随意，例如 `electerm-play-uploader`
   - **不需要**授予任何项目角色
4. 点进服务账号 → **密钥 → 添加密钥 → JSON**
   - 下载的 JSON 文件就是 CI 需要的凭据

### 3.2 在 Play Console 里授权

1. <https://play.google.com/console> → 右上角**用户和权限**
2. **邀请新用户**
3. 填入服务账号邮箱：`xxx@xxx-project.iam.gserviceaccount.com`
4. 权限勾选：
   - **管理测试轨道**（往 internal/beta 轨上传）
   - **管理正式版发布**（要发生产才需要）
   - 应用权限里选中 `electerm` 这个应用
5. 点邀请

**链接立即生效**，不需要对方接受——服务账号没有收件箱。
（网上说「API 访问」在 Play Console 找不到，那是旧界面，现在合并到「用户和权限」了。）

### 3.3 存进 GitHub Secret

```bash
cd /Users/zxd/dev/electerm-android
gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON < /path/to/service-account.json
```

---

## 第 4 步：首次上传必须手工做

> **这是最容易卡住的一步。**
> Android Publisher API 只认手工上传过的包名——没手工传过就调 API，
> 一律返回 `Package not found`，CI 会一直失败，跟配置无关。

### 操作步骤

1. Play Console → 选中 electerm → **测试和发布 → 测试 → 内部测试**
2. **创建新版本**
3. 上传 `.aab` 文件（见第 5 步获取）
4. 首次上传会引导你配置 Play 应用签名，按第 2 步的决策走
5. 填发布说明 → **保存并发布**

内部测试最多 100 个测试员，版本发布后**几秒内**就能装到手机上。

> 补充：首次上传时，Google 可能显示临时的应用名和商店信息，**最长 48 小时**。
> 测试员反馈「名字不对」属于正常现象，不是打包出错。

---

## 第 5 步：用 CI 构建并上传

### 已完成的准备

仓库里已经加好了：

| 文件 | 作用 |
|---|---|
| `.github/workflows/publish-google-play.yml` | Play 发布 CI（手动触发） |
| `build/android/scripts/set-version.mjs` | 注入 versionCode / versionName |
| `build/android/scripts/verify-aab.mjs` | 上传前校验 AAB |

### 需要的 Secrets

**只需新增一个**，其余四个现有的直接复用：

```bash
cd /Users/zxd/dev/electerm-android

# 新增（唯一需要新建的）
gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON < service-account.json

# 以下已存在，无需改动
#   SERVER_SECRET
#   ANDROID_RELEASE_KEYSTORE_BASE64
#   ANDROID_RELEASE_KEYSTORE_PASSWORD
#   ANDROID_RELEASE_KEY_ALIAS
#   ANDROID_RELEASE_KEY_PASSWORD
```

查看现状：

```bash
gh secret list
```

### 触发发布

GitHub 页面 → Actions → **Publish Android AAB to Google Play** → Run workflow

三个可选项：

| 输入 | 可选值 | 建议 |
|---|---|---|
| `track` | internal / alpha / beta / production | 先用 `internal` |
| `status` | draft / completed / inProgress / halted | 先用 `draft`，确认无误再改 |
| `release_notes` | 任意文本 | 留空会自动填版本号 |

`status: draft` 会把版本放进 Play Console 等待你确认，**不会**自动推给用户。
想自动发布就改 `completed`。

### CI 内部做了什么

```
checkout → Node 24 → JDK 21 → Android SDK 36
  → npm i → npm run build:android
  → cap add android → cap sync android
  → overlay（res-overlay → 原生工程）
  → set-version（注入 versionCode / versionName）
  → gradle bundleRelease（签名）
  → verify-aab（校验签名 + 版本 + targetSdk）
  → 上传 artifact → 上传到 Play
```

其中 overlay 那一步是**手工复制** `res-overlay/`，而不是调 `build.mjs --overlay-only`，
因为 CI 会从零重建原生工程——和 `build-android.yml` 的做法一致。

### versionCode 规则

Capacitor 模板里写死 `versionCode 1`，Play 会因为重复而拒绝上传。
所以按 package.json 的版本号换算：

```
versionCode = major × 1000000 + minor × 1000 + patch
```

| package.json | versionCode |
|---|---|
| 5.8.0 | 5008000 |
| 5.7.21 | 5007021 |
| 5.5.77 | 5005077 |

Play 上限是 2100000000，major 到 2100、patch 到 999 都够用。
上游版本号的第三位本来就是构建计数（5.5.77、5.7.21），不会撞。

> **两个 workflow 都用这一套**：
> `build-android.yml`（GitHub Release 的 APK）和 `publish-google-play.yml`（Play 的 AAB）
> 都在构建前跑 `build/android/scripts/set-version.mjs`。
>
> 这不只是为了 Play——**不注入的话，所有 APK 在 Android 眼里都是 1.0 版**
> （系统设置里显示的版本、`dumpsys package` 输出的 versionName 都是 "1.0"）。
> 文件名写着 5.8.0、系统里却显示 1.0，这本身就是 bug。
> 顺带也让 GitHub Release 的 APK 能直接上传到 Play，两边共用一套版本号。

### 出问题时

CI 会把 AAB 存成 artifact（保留 30 天）。下载它就能手工上传到 Play Console，
也可以本地复现：

```bash
# 本地跑一遍完整构建
export PATH="$HOME/.local/share/fnm/node-versions/v24.20.0/installation/bin:$PATH"
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk" ANDROID_SDK_ROOT="$ANDROID_HOME"

node build/android/build.mjs          # 产出 www/
cd build/android
[ -d android ] || ./node_modules/.bin/cap add android
./node_modules/.bin/cap sync android
cd android && printf 'sdk.dir=%s/Library/Android/sdk\n' "$HOME" > local.properties
cd .. && node build/android/build.mjs --overlay-only
cd android && ./gradlew bundleRelease
```

---

## 第 6 步：发布到生产

内部测试验证没问题后：

1. **测试和发布 → 正式版 → 创建新版本**
2. 上传新的 AAB（versionCode 必须比之前所有版本都大）
3. 选国家/地区、选择分批发布比例（建议先 10%）
4. 提交审核

### 组织账号的一个优势

> 「12 名测试者连续 14 天封闭测试」这个门槛**只针对 2023-11-13 之后创建的个人账号**。
> 你是组织账号，**豁免**，可以直接进正式版，省下至少两周。

### 审核周期

新应用的首次审核通常要几天到一周。首次发布建议留出余量。

---

## 第 7 步：上线后的持续发布

之后每次发版只要改 `package.json` 的版本号，走这套流程：

```bash
# 1. 改版本号并提交
cd /Users/zxd/dev/electerm-android
npm version 5.8.1 --no-git-tag-version

# 2. 提交 + 打 tag（沿用仓库现有的 build 分支发布流程）
git add package.json package-lock.json
git commit -m "Ver -> 5.8.1"

# 3. 手动触发 Play CI，track 选 production，status 选 completed
```

CI 会自动用新版本号算出更大的 versionCode 并上传。

> **注意**：仓库现有的 GitHub Release 发布流程走 `build` 分支
> （`build/bin/release` 脚本：切 main → pull → 建 build 分支 → push）。
> 如果要让 GitHub Release 和 Play 同步发版，两个流程都要走。

---

## 常见问题排查

| 报错 | 原因 | 解决 |
|---|---|---|
| `Package not found` | 没手工上传过 | 回第 4 步手工传一次 |
| `Version code already exists` | versionCode 没变大 | 检查 set-version.mjs 是否执行 |
| `Target API level too low` | targetSdk < 36 | `build/android/android/variables.gradle` |
| 16KB 对齐警告 | 32 位库未对齐 | 正常，64 位才要求 |
| CI 报 `D-U-N-S` 缺失 | 账号资料没填完 | Play Console 补组织资料 |

---

## 参考

- [创建和设置应用](https://support.google.com/googleplay/android-developer/answer/9859152?hl=zh-Hans)
- [使用 Play 应用签名功能](https://support.google.com/googleplay/android-developer/answer/9842756?hl=zh-Hans)
- [目标 API 级别要求](https://support.google.com/googleplay/android-developer/answer/11926878?hl=zh-Hans)
- [支持 16 KB 内存页](https://developer.android.com/guide/practices/page-sizes)
- [新个人开发者账号的测试要求](https://support.google.com/googleplay/android-developer/answer/14151465?hl=zh-Hans)
- [为应用签名（PEPK 流程）](https://developer.android.com/studio/publish/app-signing)
