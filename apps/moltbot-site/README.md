# moltbot-site

一个极简的 Moltbot 介绍页（纯静态）。

## 本地预览

直接用任意静态服务器打开即可，例如：

```bash
cd moltbot-site
python3 -m http.server 5173
```

然后打开：`http://localhost:5173`

## 部署（任选其一）

### 方案 A：GitHub Pages（最省事）

1. 把本仓库推到 GitHub
2. 在 GitHub → Settings → Pages
3. Source 选择 `Deploy from a branch`
4. Branch 选择 `main`，Folder 选择 `/moltbot-site`

### 方案 B：Vercel / Netlify

- 直接导入仓库
- Build Command 留空
- Output / Publish 目录设置为 `moltbot-site`

## 改文案

`index.html` 里所有带“占位”的内容建议替换成官方/可核实信息。
