<h1 align="center" style="padding-top: 60px;padding-bottom: 40px;">
  <a href="https://electerm.org">
    <img src="https://github.com/electerm/electerm-resource/raw/master/static/images/electerm.png" alt="electerm" />
  </a>
</h1>

[![GitHub version](https://badgers.space/github/release/electerm/electerm-android?corner_radius=m)](https://github.com/electerm/electerm-android/releases)
[![Build Status](https://github.com/electerm/electerm-android/actions/workflows/build-android.yml/badge.svg)](https://github.com/electerm/electerm-android/actions)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/electerm/electerm-android/blob/main/LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/electerm?label=Sponsors)](https://github.com/sponsors/electerm)
[![English](https://img.shields.io/badge/English-EN-blue)](README.md)
[![中文](https://img.shields.io/badge/中文-Chinese-blue)](README_cn.md)

开源的 Android 端 ssh/sftp/telnet/RDP/VNC/Spice/ftp 客户端，基于
[electerm-web](https://github.com/electerm/electerm-web) 代码库，使用
[Capacitor](https://capacitorjs.com/) 和设备端 Node.js 运行时构建。

> **关于本地终端和串口的说明：** electerm Android 版目前**不支持**本地终端和串口。
> 这些功能依赖于原生库（`node-pty`、`serialport`），目前无法为 Android 编译。
> 未来在原生依赖移植完成后有潜力添加这些功能。SSH、SFTP、Telnet、FTP、RDP、VNC
> 和 Spice 均可正常使用，因为它们是纯 JS / WASM 实现的网络协议。

- [electerm.org](https://electerm.org): 主页，下载，视频等
- [electerm-web](https://github.com/electerm/electerm-web): 运行于浏览器(支持移动设备)的web app版本
- [electerm-web-docker](https://github.com/electerm/electerm-web-docker): electerm-web的docker镜像
- [electerm online](https://cloud.electerm.org): 公共免费在线electerm应用
- [electerm demo](https://demo.electerm.org): 在线演示
- [electerm AI](https://ai.electerm.org): 免费为 electerm 用户提供 AI
- [electerm deb repo](https://repos.electerm.org/deb): Debian repo of electerm
- [electerm rpm repo](https://repos.electerm.org/rpm): RPM repo of electerm

## 工作原理

```
WebView (前端)  ── http://127.0.0.1:5577 ──►  Node.js 后端 (设备端)
   加载 index.html                                提供 UI + SSH/SFTP/...
   (本地 "loading" 页面)                          API/WebSocket 同源
```

- **Capacitor** 提供原生 Android 外壳 + WebView。
- **`@capawesome/capacitor-nodejs`** 内嵌 Node.js 运行时，应用启动时自动启动
  electerm 后端。
- electerm **前端** (React) 在 WebView 中渲染；electerm **后端** (Node.js 服务器，
  负责处理 SSH/SFTP/Telnet/FTP/RDP/VNC/Spice) 直接在设备上运行。

## 功能特性

- 🖥️ SSH / SSH 隧道 (代理) / SFTP / FTP / FTPS
- 🐚 Telnet
- 🖥️ 远程桌面: RDP / VNC / Spice
- 🔁 Zmodem (rz/sz), trzsz 文件传输
- 🌐 多语言、主题、书签、同步
- ❌ 本地终端 — **不可用** (原生 `node-pty` 目前无法为 Android 编译)
- ❌ 串口 — **不可用** (原生 `serialport` 目前无法为 Android 编译)

> 未来在所需原生库移植到 Android 后，可能会添加本地终端和串口支持。

## 安装

1. 从 [Releases 页面](https://github.com/electerm/electerm-android/releases) 下载最新的 APK。
   选择与你的设备匹配的 APK：
   - `arm64-v8a` — 大多数现代 Android 手机/平板 (64位 ARM)
   - `armeabi-v7a` — 较旧的 32位 ARM 设备
   - `x86_64` — Android 模拟器 / Intel 平板
   - `universal` — 适用于所有架构 (下载体积更大)
2. 在 Android 设备上安装 (可能需要允许"安装来自未知来源的应用")。
3. 打开 electerm，稍等片刻让引擎启动，然后连接到你的主机。

## 升级

直接从 [Releases 页面](https://github.com/electerm/electerm-android/releases) 下载最新
APK 重新安装即可。

## 已知问题

- 本地终端和串口在 Android 上已禁用 (见上方说明)。
- 设备需要允许"安装来自未知来源的应用"才能安装侧载的 APK。

## 项目结构

```
src/                 electerm-web 源码 (前端 + Node.js 后端)
build/vite/          web 构建配置
build/android/       Android 构建脚本、Capacitor 项目、原生资源
  build.mjs          构建 www/ (前端 + 打包后的后端)
  capacitor.config.ts
  res-overlay/       生成的启动器图标 + 启动画面 (来自 temp/ logo)
  android/           原生项目 (由 `cap add android` 生成)
.github/workflows/   构建 + 发布 APK 的 CI
```

本地构建和测试请参阅 [build/android/README.md](build/android/README.md)。

## 开发

```bash
# 需要 nodejs/npm 24.x 和 Java JDK 17+ (推荐 21)
# 需要 Android SDK (platform-36, build-tools 36.0.0)
npm config set legacy-peer-deps true
npm i
npm --prefix build/android install

# 构建 web 前端 + Node.js 后端打包到 build/android/www
npm run build:android

# 创建原生项目 + 同步资源/插件 (仅首次)
cd build/android
npx cap add android
npx cap sync android

# 构建 debug APK
cd android
./gradlew assembleDebug
```

debug APK 位于 `build/android/android/app/build/outputs/apk/debug/app-debug.apk`。

安装到设备：

```bash
adb install build/android/android/app/build/outputs/apk/debug/app-debug.apk
```

## 赞助项目

github sponsor

[https://github.com/sponsors/electerm](https://github.com/sponsors/electerm)

kofi

[https://ko-fi.com/zhaoxudong](https://ko-fi.com/zhaoxudong)

微信赞赏码

[![wechat donate](https://electerm.org/electerm-wechat-donate.png)](https://github.com/electerm)

TRON TRN20

[![TRN20 donate](https://github.com/electerm/electerm-resource/blob/master/static/images/trn20.png?raw=true)]

地址: TXk3pQNmQu1vihH76RaEFnK9wg13x4LLCZ

## 联系作者

[zxdong@gmail.com](mailto:zxdong@gmail.com)

## 许可证

MIT
