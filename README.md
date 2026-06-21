# Chexpress

毕业快递价格对比工具。页面基于现场价目表图片整理顺丰、京东、德邦、邮政的价格数据，支持按地区和重量查看预估运费曲线。

## Demo

GitHub Pages: <https://kkkstra.github.io/Chexpress/>

也可以直接用浏览器打开本地的 `index.html`，无需安装依赖或启动构建工具。

## Features

- 按省份、地级市选择目的地。
- 支持千克/斤切换，重量按计费粒度向上取整。
- 用 SVG 折线图展示 `0.5-80 kg` 区间的运费变化。
- 悬停图表查看对应重量价格，点击可固定/取消固定。
- 可查看录入后的原始价格表，包括顺丰小于 20kg 专项价格。
- 移动端自适应布局。

## Project Structure

```text
.
├── index.html   # 页面结构
├── styles.css   # 样式与响应式布局
├── app.js       # 交互、匹配和计费逻辑
└── data.js      # 价格表和地区数据
```

## Development

语法检查：

```bash
node --check app.js
node --check data.js
```

修改价格数据时，请同时对照来源图片，并抽查首重、续重区间和边界重量。
