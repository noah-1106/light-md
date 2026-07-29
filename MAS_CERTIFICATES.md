# Light MD Mac App Store 证书与凭证申请指南

## 需要访问的网站

1. **Apple Developer**（证书、App ID）  
   https://developer.apple.com/account

2. **App Store Connect**（应用记录、TestFlight、API 密钥）  
   https://appstoreconnect.apple.com

---

## 第一步：确认 App ID

1. 登录 Apple Developer，进入 **Certificates, Identifiers & Profiles**。
2. 点击左侧 **Identifiers**，搜索 `com.tannoah.lightmd`。
3. 如果已经存在，直接跳到第二步。
4. 如果不存在，点击右上角 **+** 创建：
   - 选择 **App IDs**。
   - Description：填写 `Light MD`
   - Bundle ID：选择 **Explicit**，填写 `com.tannoah.lightmd`
   - Capabilities：保持默认即可，**不需要额外勾选 App Sandbox**。macOS App Sandbox 是否启用由项目中的 `Entitlements.plist` 决定，这个已经配置好了。

---

## 第二步：申请 Mac App Distribution 证书

这个证书用于给 `.app` 签名。

1. 在 Apple Developer 中点击 **Certificates**，然后点 **+**。
2. 选择 **Mac App Distribution**，点击 Continue。
3. 现在需要生成一个 CSR 文件：
   - 打开 Mac 上的 **钥匙串访问**（Keychain Access）。
   - 菜单栏选择 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书**。
   - 用户电子邮件地址：填你的 Apple ID 邮箱。
   - 常用名称：填 `Tan Zaichao` 或你的名字。
   - CA 电子邮件地址：留空。
   - 请求是：选择 **存储到磁盘**。
   - 点击继续，保存为 `CertificateSigningRequest.certSigningRequest`。
4. 回到 Apple Developer 网站，上传刚才保存的 CSR 文件。
5. 下载证书文件 `mac_app_distribution.cer`，双击安装到钥匙串。
6. 导出为 `.p12`：
   - 打开 **钥匙串访问**，在左侧选择 **登录**，下方选择 **我的证书**。
   - 找到 `Mac App Distribution: Tan Zaichao (UWJL48X4C8)`。
   - 右键点击，选择 **导出"Mac App Distribution..."**。
   - 文件格式选择 **个人信息交换（.p12）**。
   - 设置一个密码，保存为 `mac_app_distribution.p12`。

---

## 第三步：申请 Mac Installer Distribution 证书

这个证书用于给 `.pkg` 安装包签名。

1. 在 Apple Developer 中点击 **Certificates**，然后点 **+**。
2. 选择 **Mac Installer Distribution**，点击 Continue。
3. 使用第二步中同一个 CSR 文件上传。
4. 下载证书文件 `mac_installer_distribution.cer`，双击安装。
5. 同样在 **钥匙串访问 → 我的证书** 中找到它，导出为 `mac_installer_distribution.p12` 并设置密码。

---

## 第四步：创建 App Store Connect API 密钥

CI 需要通过这个密钥上传 `.pkg` 到 App Store Connect。

1. 登录 App Store Connect，点击右上角 **用户和访问**（Users and Access）。
2. 选择 **集成**（Integrations）标签页，再选择 **App Store Connect API**。
3. 点击 **+** 生成新密钥：
   - 名称：填 `Light MD CI`
   - 访问权限：建议选择 **Admin**，避免权限不足导致上传失败。
4. 点击生成后，点击 **下载 API 密钥**。
   - 注意：这个 `.p8` 文件只能下载一次，务必保存好。
5. 同时记录以下两个信息：
   - **Issuer ID**：页面顶部显示的一串 ID。
   - **Key ID**：刚生成的密钥旁边显示的 ID。

---

## 第五步：在 App Store Connect 创建 App 记录

1. 进入 App Store Connect，点击 **App**，然后点左上角 **+ → 新建 App**。
2. 填写信息：
   - 平台：选择 **macOS**
   - 名称：填 `Light MD`
   - 主要语言：中文或英文
   - Bundle ID：选择 `com.tannoah.lightmd`
   - SKU：填一个唯一标识，例如 `light-md-001`
   - 用户访问权限：选择 **完全访问权限**
3. 创建完成后，进入该 App 页面，填写基础信息。隐私政策 URL、App 分类、截图等信息可以先用占位内容，正式上架前再完善。

---

## 第六步：配置 GitHub Secrets

进入 GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加以下 secrets：

| Secret 名称 | 内容 |
|---|---|
| `APPLE_CERTIFICATE_MAS` | `mac_app_distribution.p12` 文件内容的 base64 |
| `APPLE_CERTIFICATE_MAS_PASSWORD` | 导出 `mac_app_distribution.p12` 时设置的密码 |
| `APPLE_CERTIFICATE_MAS_INSTALLER` | `mac_installer_distribution.p12` 文件内容的 base64 |
| `APPLE_CERTIFICATE_MAS_INSTALLER_PASSWORD` | 导出 `mac_installer_distribution.p12` 时设置的密码 |
| `APPLE_SIGNING_IDENTITY_MAS` | 完整证书名称，例如 `3rd Party Mac Developer Application: Tan Zaichao (UWJL48X4C8)` |
| `APPLE_API_KEY` | `.p8` 文件内容的 base64 |
| `APPLE_API_KEY_ID` | 第四步记录的 Key ID |
| `APPLE_API_ISSUER` | 第四步记录的 Issuer ID |

生成 base64 的命令：

```bash
base64 -i mac_app_distribution.p12 | pbcopy
base64 -i mac_installer_distribution.p12 | pbcopy
base64 -i AuthKey_你的KeyID.p8 | pbcopy
```

`pbcopy` 会把内容复制到剪贴板，直接粘贴到 GitHub Secret 里即可。

---

## 第七步：触发一次 Release 测试

1. 在本地打一个新 tag 并推送：
   ```bash
   git tag v1.0.5
   git push origin v1.0.5
   ```
2. 推送后，GitHub Actions 会自动运行三个任务：
   - Linux 和 Windows 安装包发布
   - 直接下载的 `.dmg` 发布
   - MAS `.pkg` 构建并上传到 App Store Connect
3. 上传成功后，进入 App Store Connect → **TestFlight**，应该能看到刚上传的构建版本。

---

## 常见问题

### 证书 Identity 名称不对
在 Terminal 中运行：
```bash
security find-identity -v -p codesigning
```
找到 MAS 对应的完整名称，例如 `3rd Party Mac Developer Application: Tan Zaichao (UWJL48X4C8)`，填到 `APPLE_SIGNING_IDENTITY_MAS`。

### 两个证书导入时互相覆盖
`apple-actions/import-codesign-certs` 两次导入可能会冲突。如果报错，可以把两个证书合并到一个 `.p12` 文件中再试，或者告诉我具体错误信息。

### App Store Connect API 权限不足
如果上传时报 `You do not have required roles`，把 API 密钥权限改成 **Admin** 后重新生成。

### Bundle ID 不匹配
确保 Apple Developer 中的 App ID 和 `src-tauri/tauri.conf.json` 里的 `identifier` 完全一致：`com.tannoah.lightmd`。

---

## 当前进度

- MAS 代码改造已完成。
- 本地沙盒测试通过：首次启动可选目录、自动保存、图片粘贴/预览都正常。
- 下一步就是按本指南申请证书、配置 secrets，然后触发一次 release 上传。
