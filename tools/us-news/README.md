# us-news

抓取美国“宏观 + 美股市场”主要消息（RSS 聚合，不需要 API Key）。

## 安装

```bash
cd tools/us-news
npm install
```

## 抓取更新

```bash
npm run update
```

## 生成摘要

```bash
npm run digest
# 或者最近 6 小时：
npm run digest -- --lookback-hours 6
```

## 可选：按标签过滤

例如只看宏观：
```bash
npm run digest -- --tags macro
```

只看市场：
```bash
npm run digest -- --tags markets
```

## 配置

编辑 `feeds.json` 增删新闻源。
