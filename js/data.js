export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultState() {
  return { friends: [], gatherings: [] };
}

export function addFriend(state, name) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("名字不能为空");
  if (state.friends.some((f) => f.name === clean)) throw new Error("该朋友已存在");
  const friend = { id: uid("f"), name: clean };
  state.friends.push(friend);
  return friend;
}

export function removeFriend(state, id) {
  state.friends = state.friends.filter((f) => f.id !== id);
}

export function renameFriend(state, id, name) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("名字不能为空");
  const friend = state.friends.find((f) => f.id === id);
  if (!friend) throw new Error("朋友不存在");
  if (state.friends.some((f) => f.id !== id && f.name === clean)) {
    throw new Error("该朋友已存在");
  }
  friend.name = clean;
}

export function createGathering(state, name, members) {
  const cleanName = (name || "").trim() || "未命名聚会";
  const uniqueMembers = [...new Set(members.map((m) => (m || "").trim()).filter(Boolean))];
  if (uniqueMembers.length === 0) throw new Error("请至少选择一位参与者");
  const gathering = {
    id: uid("g"),
    name: cleanName,
    members: uniqueMembers,
    expenses: [],
    settled: false,
    createdAt: Date.now(),
  };
  state.gatherings.push(gathering);
  return gathering;
}

export function addExpense(gathering, { title, amount, splits, items, roundingFavor }) {
  const expense = {
    id: uid("e"),
    title: (title || "").trim() || "消费",
    amount,
    splits,
    items: items || null,
    roundingFavor: roundingFavor || null,
    createdAt: Date.now(),
  };
  gathering.expenses.push(expense);
  return expense;
}

export function removeExpense(gathering, id) {
  gathering.expenses = gathering.expenses.filter((e) => e.id !== id);
}

export function updateExpense(gathering, id, { title, amount, splits, items, roundingFavor }) {
  const expense = gathering.expenses.find((e) => e.id === id);
  if (!expense) throw new Error("消费不存在");
  expense.title = (title || "").trim() || "消费";
  expense.amount = amount;
  expense.splits = splits;
  expense.items = items || null;
  expense.roundingFavor = roundingFavor || null;
  return expense;
}

export function setGatheringMembers(gathering, members) {
  const uniqueMembers = [...new Set(members.map((m) => (m || "").trim()).filter(Boolean))];
  if (uniqueMembers.length === 0) throw new Error("请至少选择一位参与者");
  gathering.members = uniqueMembers;
}

export function findGathering(state, id) {
  return state.gatherings.find((g) => g.id === id);
}

export function deleteGathering(state, id) {
  state.gatherings = state.gatherings.filter((g) => g.id !== id);
}

export function gatheringTotalCents(gathering) {
  return gathering.expenses.reduce((sum, e) => sum + e.amount, 0);
}

export function expenseParticipantCount(expense) {
  return expense.splits.filter((s) => s.mode !== "excluded").length;
}