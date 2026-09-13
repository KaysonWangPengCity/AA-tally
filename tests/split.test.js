import test from "node:test";
import assert from "node:assert/strict";
import {
  toCents,
  formatCents,
  splitExpense,
  summarizeExpenses,
  totalShares,
  hasRemainder,
} from "../js/split.js";

function sum(shares) {
  return shares.reduce((s, r) => s + r.amount, 0);
}

test("toCents 解析元和分", () => {
  assert.equal(toCents("128.5"), 12850);
  assert.equal(toCents("0.01"), 1);
  assert.equal(toCents(40), 4000);
  assert.equal(toCents(""), NaN);
});

test("formatCents 格式化金额", () => {
  assert.equal(formatCents(1334), "¥13.34");
  assert.equal(formatCents(0), "¥0.00");
});

test("均摊整除：30元 / 3人 = 10元每人", () => {
  const splits = ["张三", "李四", "王五"].map((name) => ({
    name,
    mode: "equal",
  }));
  const shares = splitExpense(3000, splits);
  assert.equal(sum(shares), 3000);
  assert.deepEqual(
    shares.map((s) => s.amount),
    [1000, 1000, 1000]
  );
});

test("均摊除不尽：40元 / 3人，补差到分", () => {
  const splits = ["张三", "李四", "王五"].map((name) => ({
    name,
    mode: "equal",
  }));
  const shares = splitExpense(4000, splits);
  assert.equal(sum(shares), 4000);
  assert.deepEqual(
    shares.map((s) => s.amount),
    [1334, 1333, 1333]
  );
});

test("取消勾选：不占均摊人数", () => {
  const shares = splitExpense(4000, [
    { name: "张三", mode: "equal" },
    { name: "李四", mode: "equal" },
    { name: "王五", mode: "excluded" },
  ]);
  assert.equal(sum(shares), 4000);
  assert.deepEqual(
    shares.map((s) => s.amount),
    [2000, 2000, 0]
  );
});

test("自定义金额：固定值，其余均摊", () => {
  const shares = splitExpense(10000, [
    { name: "张三", mode: "equal" },
    { name: "李四", mode: "equal" },
    { name: "王五", mode: "custom", amount: 4000 },
  ]);
  assert.equal(sum(shares), 10000);
  assert.deepEqual(
    shares.map((s) => s.amount),
    [3000, 3000, 4000]
  );
});

test("自定义之和 = 0：全部均摊", () => {
  const shares = splitExpense(6000, [
    { name: "张三", mode: "equal" },
    { name: "李四", mode: "equal" },
  ]);
  assert.equal(sum(shares), 6000);
  assert.deepEqual(
    shares.map((s) => s.amount),
    [3000, 3000]
  );
});

test("自定义之和 = 总额：剩余均摊为 0，无需均摊人", () => {
  const shares = splitExpense(6000, [
    { name: "张三", mode: "custom", amount: 2500 },
    { name: "李四", mode: "custom", amount: 3500 },
  ]);
  assert.equal(sum(shares), 6000);
  assert.deepEqual(
    shares.map((s) => s.amount),
    [2500, 3500]
  );
});

test("自定义之和 > 总额：拒绝", () => {
  assert.throws(
    () =>
      splitExpense(1000, [
        { name: "张三", mode: "equal" },
        { name: "李四", mode: "custom", amount: 1500 },
      ]),
    /不能超过总金额/
  );
});

test("空参与人（全部取消）：拒绝", () => {
  assert.throws(
    () =>
      splitExpense(1000, [
        { name: "张三", mode: "excluded" },
        { name: "李四", mode: "excluded" },
      ]),
    /至少需要一位参与/
  );
});

test("金额无效：拒绝", () => {
  assert.throws(() => splitExpense(0, [{ name: "张三", mode: "equal" }]), /大于 0/);
  assert.throws(() => splitExpense(-100, [{ name: "张三", mode: "equal" }]), /大于 0/);
});

test("自定义金额为负：拒绝", () => {
  assert.throws(
    () =>
      splitExpense(1000, [
        { name: "张三", mode: "equal" },
        { name: "李四", mode: "custom", amount: -5 },
      ]),
    /不能为负数/
  );
});

test("只剩自定义但未分完：拒绝", () => {
  assert.throws(
    () =>
      splitExpense(1000, [
        { name: "张三", mode: "custom", amount: 400 },
      ]),
    /未分配完/
  );
});

test("汇总多笔：按人累加且总额精确一致", () => {
  const expenses = [
    { amount: 78000, splits: ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" })) },
    { amount: 6000, splits: ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" })) },
    {
      amount: 4000,
      splits: [
        { name: "张三", mode: "equal" },
        { name: "李四", mode: "equal" },
        { name: "王五", mode: "excluded" },
      ],
    },
  ];
  const result = summarizeExpenses(expenses);
  const byName = Object.fromEntries(result.map((r) => [r.name, r.amount]));
  assert.equal(byName["张三"], 30000);
  assert.equal(byName["李四"], 30000);
  assert.equal(byName["王五"], 28000);
  assert.equal(sum(result), 88000);
});

test("份额：张三 2 份、李四 1 份，100元按 3 份均摊", () => {
  const splits = [
    { name: "张三", mode: "equal", shares: 2 },
    { name: "李四", mode: "equal", shares: 1 },
  ];
  const result = splitExpense(10000, splits);
  assert.equal(sum(result), 10000);
  // 100.00 / 3 = 33.33 余 0.01，余分按份额顺序补到张三
  assert.deepEqual(
    result.map((s) => s.amount),
    [6667, 3333]
  );
  assert.equal(totalShares(splits), 3);
});

test("份额：与自定义/取消组合，总额精确一致", () => {
  const shares = splitExpense(10000, [
    { name: "张三", mode: "equal", shares: 2 },
    { name: "李四", mode: "equal", shares: 1 },
    { name: "王五", mode: "excluded" },
  ]);
  assert.equal(sum(shares), 10000);
  assert.equal(shares.find((s) => s.name === "王五").amount, 0);
});

test("份额：未提供 shares 回退为 1（兼容旧数据）", () => {
  const shares = splitExpense(3000, [
    { name: "张三", mode: "equal" },
    { name: "李四", mode: "equal" },
  ]);
  assert.deepEqual(
    shares.map((s) => s.amount),
    [1500, 1500]
  );
});

test("hasRemainder：40元 / 3人 有余数", () => {
  const splits = ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" }));
  assert.equal(hasRemainder(4000, splits), true);
});

test("hasRemainder：30元 / 3人 整除无余数", () => {
  const splits = ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" }));
  assert.equal(hasRemainder(3000, splits), false);
});

test("hasRemainder：全部自定义无均摊人，无余数概念", () => {
  assert.equal(
    hasRemainder(4000, [
      { name: "张三", mode: "custom", amount: 2000 },
      { name: "李四", mode: "custom", amount: 2000 },
    ]),
    false
  );
});

test("补差默认（A 优先）：40元 / 3人，首位多 1 分", () => {
  const splits = ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" }));
  const shares = splitExpense(4000, splits);
  assert.equal(sum(shares), 4000);
  // 默认按 A 优先：张三多拿 1 分
  assert.equal(shares.find((s) => s.name === "张三").amount, 1334);
  assert.equal(shares.find((s) => s.name === "李四").amount, 1333);
  assert.equal(shares.find((s) => s.name === "王五").amount, 1333);
});

test("补差指定 B：40元 / 3人，指定王五多 1 分", () => {
  const splits = ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" }));
  const shares = splitExpense(4000, splits, "王五");
  assert.equal(sum(shares), 4000);
  assert.equal(shares.find((s) => s.name === "张三").amount, 1333);
  assert.equal(shares.find((s) => s.name === "李四").amount, 1333);
  assert.equal(shares.find((s) => s.name === "王五").amount, 1334);
});

test("补差指定无效人：回退到默认 A 优先", () => {
  const splits = ["张三", "李四"].map((name) => ({ name, mode: "equal" }));
  // 40.01 元 / 2 人 = 20.00 余 0.01
  const shares = splitExpense(4001, splits, "不存在的人");
  assert.equal(sum(shares), 4001);
  assert.equal(shares.find((s) => s.name === "张三").amount, 2001);
  assert.equal(shares.find((s) => s.name === "李四").amount, 2000);
});

test("补差指定但整除无余数：指定不生效", () => {
  const splits = ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" }));
  const shares = splitExpense(3000, splits, "王五");
  assert.deepEqual(
    shares.map((s) => s.amount),
    [1000, 1000, 1000]
  );
});

test("补差指定份额场景：张三 2 份/李四 1 份，指定李四多 1 分", () => {
  const splits = [
    { name: "张三", mode: "equal", shares: 2 },
    { name: "李四", mode: "equal", shares: 1 },
  ];
  const shares = splitExpense(10000, splits, "李四");
  assert.equal(sum(shares), 10000);
  // 100.00 / 3 = 33.33 余 0.01，指定李四补差
  assert.equal(shares.find((s) => s.name === "张三").amount, 6666);
  assert.equal(shares.find((s) => s.name === "李四").amount, 3334);
});

test("summarizeExpenses：尊重每笔的 roundingFavor", () => {
  const expenses = [
    {
      amount: 4000,
      splits: ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" })),
      roundingFavor: "王五",
    },
    {
      amount: 4000,
      splits: ["张三", "李四", "王五"].map((name) => ({ name, mode: "equal" })),
      roundingFavor: null,
    },
  ];
  const result = summarizeExpenses(expenses);
  const byName = Object.fromEntries(result.map((r) => [r.name, r.amount]));
  // 第一笔王五 +1，第二笔张三 +1
  assert.equal(byName["张三"], 1333 + 1334);
  assert.equal(byName["李四"], 1333 + 1333);
  assert.equal(byName["王五"], 1334 + 1333);
  assert.equal(sum(result), 8000);
});