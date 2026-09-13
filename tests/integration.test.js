import test from "node:test";
import assert from "node:assert/strict";
import { defaultState, addFriend, createGathering, addExpense, updateExpense, setGatheringMembers, deleteGathering } from "../js/data.js";
import { summarizeExpenses } from "../js/split.js";

function equal(names) {
  return names.map((name) => ({ name, mode: "equal" }));
}

test("端到端：张三/李四/王五 3 笔消费结算", () => {
  const state = defaultState();
  addFriend(state, "张三");
  addFriend(state, "李四");
  addFriend(state, "王五");

  const g = createGathering(state, "12月同学聚会", ["张三", "李四", "王五"]);

  addExpense(g, { title: "火锅", amount: 78000, splits: equal(g.members) });
  addExpense(g, { title: "奶茶", amount: 6000, splits: equal(g.members) });
  addExpense(g, {
    title: "打车",
    amount: 4000,
    splits: [
      { name: "张三", mode: "equal" },
      { name: "李四", mode: "equal" },
      { name: "王五", mode: "excluded" },
    ],
  });

  const result = summarizeExpenses(g.expenses);
  const byName = Object.fromEntries(result.map((r) => [r.name, r.amount]));
  assert.equal(byName["张三"], 30000);
  assert.equal(byName["李四"], 30000);
  assert.equal(byName["王五"], 28000);
  assert.equal(result.reduce((s, r) => s + r.amount, 0), 88000);
});

test("端到端：删除朋友不影响历史聚会（成员姓名快照）", () => {
  const state = defaultState();
  addFriend(state, "张三");
  addFriend(state, "李四");
  const g = createGathering(state, "老友聚餐", ["张三", "李四"]);
  addExpense(g, { title: "火锅", amount: 30000, splits: equal(g.members) });

  const zhang = state.friends.find((f) => f.name === "张三");
  state.friends = state.friends.filter((f) => f.id !== zhang.id);

  assert.equal(state.friends.length, 1);
  assert.deepEqual(g.members, ["张三", "李四"]);
  const result = summarizeExpenses(g.expenses);
  assert.equal(result.reduce((s, r) => s + r.amount, 0), 30000);
});

test("端到端：修改成员与编辑已记消费", () => {
  const state = defaultState();
  addFriend(state, "张三");
  addFriend(state, "李四");
  const g = createGathering(state, "老友聚餐", ["张三", "李四"]);
  const expense = addExpense(g, { title: "火锅", amount: 30000, splits: equal(g.members) });

  setGatheringMembers(g, ["张三", "李四", "王五"]);
  assert.deepEqual(g.members, ["张三", "李四", "王五"]);

  updateExpense(g, expense.id, {
    title: "火锅（改）",
    amount: 40000,
    splits: [
      { name: "张三", mode: "equal", shares: 2 },
      { name: "李四", mode: "equal", shares: 1 },
      { name: "王五", mode: "excluded" },
    ],
  });
  assert.equal(g.expenses[0].title, "火锅（改）");
  const result = summarizeExpenses(g.expenses);
  assert.equal(result.reduce((s, r) => s + r.amount, 0), 40000);
  const byName = Object.fromEntries(result.map((r) => [r.name, r.amount]));
  assert.equal(byName["王五"], 0);
});

test("端到端：删除未结算聚会", () => {
  const state = defaultState();
  addFriend(state, "张三");
  const g = createGathering(state, "临时聚会", ["张三"]);
  addExpense(g, { title: "火锅", amount: 30000, splits: equal(g.members) });

  deleteGathering(state, g.id);
  assert.equal(state.gatherings.length, 0);
});

test("端到端：小项汇总金额，addExpense 保存 items", () => {
  const state = defaultState();
  addFriend(state, "张三");
  addFriend(state, "李四");
  const g = createGathering(state, "火锅局", ["张三", "李四"]);
  const items = [
    { name: "锅底", amount: 9800 },
    { name: "肥牛", amount: 12000 },
    { name: "蔬菜", amount: 3200 },
  ];
  const expense = addExpense(g, {
    title: "火锅",
    amount: 25000,
    splits: equal(g.members),
    items,
  });
  assert.equal(expense.items.length, 3);
  assert.equal(expense.items[0].name, "锅底");
  assert.equal(expense.amount, 25000);
  const result = summarizeExpenses(g.expenses);
  assert.equal(result.reduce((s, r) => s + r.amount, 0), 25000);
});

test("端到端：updateExpense 保存 items 和 roundingFavor，回填可读", () => {
  const state = defaultState();
  addFriend(state, "张三");
  addFriend(state, "李四");
  addFriend(state, "王五");
  const g = createGathering(state, "聚会", ["张三", "李四", "王五"]);
  const expense = addExpense(g, {
    title: "酒水",
    amount: 4000,
    splits: equal(g.members),
  });
  updateExpense(g, expense.id, {
    title: "酒水（含小项）",
    amount: 4000,
    splits: equal(g.members),
    items: [{ name: "啤酒", amount: 2400 }, { name: "可乐", amount: 1600 }],
    roundingFavor: "王五",
  });
  assert.equal(g.expenses[0].items.length, 2);
  assert.equal(g.expenses[0].roundingFavor, "王五");
  // 指定王五补差，王五应多 1 分
  const result = summarizeExpenses(g.expenses);
  const byName = Object.fromEntries(result.map((r) => [r.name, r.amount]));
  assert.equal(byName["张三"], 1333);
  assert.equal(byName["李四"], 1333);
  assert.equal(byName["王五"], 1334);
});

test("端到端：旧数据无 items/roundingFavor 字段，兼容读取", () => {
  const state = defaultState();
  addFriend(state, "张三");
  addFriend(state, "李四");
  const g = createGathering(state, "老聚会", ["张三", "李四"]);
  // 模拟旧数据：手动构造无 items 字段的消费
  g.expenses.push({
    id: "e-old",
    title: "旧账单",
    amount: 3000,
    splits: equal(g.members),
    createdAt: Date.now(),
  });
  const result = summarizeExpenses(g.expenses);
  assert.equal(result.reduce((s, r) => s + r.amount, 0), 3000);
});