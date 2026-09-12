# 实现计划：聚会记账 AA 结算 App

对应设计文档：`docs/superpowers/specs/2026-09-12-gathering-bill-splitter-design.md`

## 技术栈决定

- 纯前端、无后端、无构建步骤：原生 HTML + CSS + 原生 JavaScript（ES Modules）
- 数据存 localStorage
- 计算逻辑拆成纯函数模块，用 Node 内置 `node:test` 做单元测试，无需第三方依赖
- PWA：`manifest.json` + `service-worker.js`，支持「添加到主屏」与离线缓存

## 目录结构

```
/workspace/
  index.html                 # 应用外壳（单页）
  manifest.json              # PWA 清单
  service-worker.js          # 离线缓存
  styles.css                 # 样式
  js/
    main.js                  # 入口：路由 + 状态 + 渲染 + 事件绑定
    storage.js               # localStorage 读写封装
    split.js                 # 纯函数：分账计算（重点）
    data.js                  # 数据模型工厂/校验（创建聚合、朋友、消费）
    ui/
      ...（如需要再拆分；初期集中 main.js 亦可）
  tests/
    split.test.js            # 分账算法单测
```

## 任务清单（按依赖顺序）

### 1. 项目脚手架
- [ ] 创建上述目录结构、`.gitignore`（忽略 `.superpowers/`）
- [ ] 创建 `package.json`（仅用于 `"test": "node --test"`，无依赖）
- **验证**：`ls` 结构正确；`node --test` 能跑（即使暂无测试）

### 2. 分账纯函数 `split.js`
- [ ] `toCents(yuan)` / `fromCents(cents)`：元↔分转换、格式化
- [ ] `splitExpense(amountCents, splits)`：输入总金额（分）+ 分摊明细，输出每人应付（分）映射
  - mode：`equal` / `custom` / `excluded`
  - 校验：金额≤0 抛错；无有效参与人抛错；自定义为负/超总额抛错
  - 补差：除不尽时余分按顺序补到前几位
- [ ] `summarizeGathering(expenses)`：多笔聚合成每人应付总额
- **验证**：跑完第 3 步的测试

### 3. 分账算法单元测试 `tests/split.test.js`
- [ ] 覆盖设计文档「测试要点」全部 9 条（整除、除不尽补差、excluded、custom、custom=0、custom=总额、超总额拒绝、空参与人拒绝、总额精确一致）
- **验证**：`npm test` 全绿；断言「每人应付之和 === 总消费」在每条成立

### 4. 数据层 `data.js` + `storage.js`
- [ ] `storage.js`：`load()` / `save(state)`，键名如 `gathering-splitter/v1`，含 JSON 序列化与异常兜底
- [ ] `data.js`：生成 id、创建朋友/聚会/消费、增删改查、金额校验
- [ ] 导出/导入整个 state（JSON 字符串）
- [ ] 朋友删除不影响历史聚会（成员是姓名快照）
- **验证**：`node --test` 补数据层测试（可选若时间紧）；手工在浏览器控制台验证读写

### 5. UI 引用层：聚会列表（历史账单）
- [ ] 渲染聚会卡片（名称/人数/状态/总金额）
- [ ] 「＋」新建按钮
- [ ] 「朋友名单」管理入口 + 设置（导出/导入）入口
- **验证**：浏览器打开 `index.html`（`npx serve` 或直接 `python3 -m http.server`），列表能显示样例数据

### 6. UI：新建聚会
- [ ] 名称输入
- [ ] 从朋友名单 chip 勾选到场人
- [ ] 「开始记账」→ 创建聚会并进入详情
- **验证**：能创建聚会并跳转详情，数据持久化到 localStorage

### 7. UI：聚会详情
- [ ] 展示到场人标签
- [ ] 消费流水列表 + 汇总（共 N 笔/总消费）
- [ ] 「＋记一笔」「一键结算」按钮
- **验证**：新增/查看消费、金额汇总正确

### 8. UI：记一笔
- [ ] 金额/备注输入
- [ ] 到场人列表，每人可切三种模式：均摊✓ / 取消— / 自定义¥
- [ ] 实时均摊预览（如 128÷2=64/人）
- [ ] 保存校验（金额≤0、无人参与、自定义超总额时提示并阻止）
- **验证**：各种微调保存结果与 `split.js` 一致

### 9. UI：结算结果
- [ ] 展示每人应付清单（精确到分）
- [ ] 「完成」返回列表
- **验证**：多笔合并后每人应付正确，且总和===总消费

### 10. UI：朋友名单管理 + 备份
- [ ] 增删改朋友
- [ ] 导出 JSON（复制/下载）、导入 JSON
- **验证**：删除朋友不影响历史账单；导出后清空再导入能还原

### 11. PWA 化
- [ ] `manifest.json`（名称、图标占位、独立窗口）
- [ ] `service-worker.js` 离线缓存静态资源
- **验证**：Lighthouse/chrome 检查可安装；断网刷新仍可用

### 12. 端到端人工验收
- [ ] 跑通完整场景：建名单 → 建聚会 → 记 3 笔（含取消/自定义/除不尽）→ 结算 → 核对金额与历史账单
- **验证**：用设计文档示例（火锅780/奶茶60/打车40）核对张三300、李四300、王五280 一致

## 验收标准

1. `npm test` 全绿，分账总额精确到分、和总消费严格一致
2. 完整走通「建名单→建聚会→多笔记账→结算→历史回看」流程
3. 数据离线持久化、可导出/导入
4. PWA 可添加到主屏、离线可用