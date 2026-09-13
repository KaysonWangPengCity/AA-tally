import { toCents, formatCents, splitExpense, totalShares, hasRemainder } from "./split.js";
import { load, save, clear } from "./storage.js";
import {
  defaultState,
  addFriend,
  removeFriend,
  renameFriend,
  createGathering,
  addExpense,
  removeExpense,
  updateExpense,
  setGatheringMembers,
  findGathering,
  deleteGathering,
  gatheringTotalCents,
} from "./data.js";

let state = load() || defaultState();
let view = { name: "list" };
let newG = { title: "", selected: new Set() };
let editMembers = null;
let draft = null;

const app = document.getElementById("app");

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---- 自定义弹窗（与整体 UI 一致，替代原生 alert/confirm/prompt）----
const modalRoot = document.createElement("div");
modalRoot.className = "modal-root";
document.body.appendChild(modalRoot);

let modalResolve = null;

function modalEsc(e) {
  if (e.key === "Escape") closeModal(null);
}

function closeModal(value) {
  if (!modalResolve) return;
  const resolve = modalResolve;
  modalResolve = null;
  modalRoot.classList.remove("open");
  modalRoot.innerHTML = "";
  document.removeEventListener("keydown", modalEsc);
  resolve(value);
}

function openModal({ title, message, input, buttons }) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    const titleHTML = title ? `<div class="modal-title">${esc(title)}</div>` : "";
    const messageHTML = message ? `<div class="modal-message">${esc(message)}</div>` : "";
    const inputHTML = input
      ? `<input class="modal-input" id="modal-input" type="text" value="${esc(input.value ?? "")}" placeholder="${esc(input.placeholder ?? "")}">`
      : "";
    const btnHTML = buttons
      .map((b) => `<button class="modal-btn ${esc(b.kind || "primary")}" data-val="${esc(b.value)}">${esc(b.label)}</button>`)
      .join("");
    modalRoot.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card">
          ${titleHTML}
          ${messageHTML}
          ${inputHTML}
          <div class="modal-actions">${btnHTML}</div>
        </div>
      </div>`;
    modalRoot.classList.add("open");

    modalRoot.querySelector(".modal-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal(null);
    });

    modalRoot.querySelectorAll(".modal-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const raw = btn.dataset.val;
        if (raw === "OK_PROMPT") {
          const inp = modalRoot.querySelector("#modal-input");
          const val = inp ? inp.value.trim() : "";
          closeModal(val === "" ? null : val);
        } else if (raw === "true") {
          closeModal(true);
        } else if (raw === "false") {
          closeModal(false);
        } else if (raw === "null") {
          closeModal(null);
        } else {
          closeModal(raw);
        }
      });
    });

    if (input) {
      const inp = modalRoot.querySelector("#modal-input");
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const val = inp.value.trim();
          closeModal(val === "" ? null : val);
        }
      });
    }

    document.addEventListener("keydown", modalEsc);
  });
}

function showAlert(message) {
  return openModal({ message, buttons: [{ label: "知道了", value: "null", kind: "primary" }] });
}

function showConfirm(message, opts = {}) {
  return openModal({
    message,
    buttons: [
      { label: opts.cancelLabel || "取消", value: "false", kind: "ghost" },
      { label: opts.confirmLabel || "确定", value: "true", kind: opts.danger ? "danger" : "primary" },
    ],
  });
}

function showPrompt(title, initial = "") {
  return openModal({
    title,
    input: { value: initial, placeholder: "输入名字" },
    buttons: [
      { label: "取消", value: "null", kind: "ghost" },
      { label: "确定", value: "OK_PROMPT", kind: "primary" },
    ],
  });
}

function persist() {
  save(state);
}

function getMembers() {
  return draft ? draft.members : [];
}

function buildSplitsFromDraft(members) {
  return members.map((name) => {
    const m = draft.splits[name];
    if (m.mode === "custom") {
      return { name, mode: "custom", amount: m.custom == null || !Number.isFinite(m.custom) ? 0 : m.custom };
    }
    if (m.mode === "equal") {
      return { name, mode: "equal", shares: m.shares || 1 };
    }
    return { name, mode: m.mode };
  });
}

function memberRowsHTML(members) {
  return members
    .map((name) => {
      const m = draft.splits[name];
      const isEqual = m.mode === "equal";
      const isExcl = m.mode === "excluded";
      const isCustom = m.mode === "custom";
      const mode = (val, label, active) =>
        `<button class="mode${active ? " on" : ""}" data-action="set-mode" data-name="${esc(name)}" data-mode="${val}">${label}</button>`;
      const customInput = isCustom
        ? `<input class="custom-input" data-action="custom-input" data-name="${esc(name)}" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${m.custom != null && Number.isFinite(m.custom) ? (m.custom / 100).toFixed(2) : ""}">`
        : "";
      const stepper = isEqual
        ? `<div class="share-stepper">
            <span class="share-label">份额</span>
            <button class="step" data-action="dec-share" data-name="${esc(name)}">−</button>
            <span class="share-count">${m.shares || 1}份</span>
            <button class="step" data-action="inc-share" data-name="${esc(name)}">＋</button>
          </div>`
        : "";
      return `<div class="member-row">
        <div class="member-head"><span class="member-name">${esc(name)}</span>${stepper}</div>
        <div class="mode-tabs">${mode("equal", "均摊", isEqual)}${mode("excluded", "取消", isExcl)}${mode("custom", "自定义", isCustom)}</div>
        ${customInput}
      </div>`;
    })
    .join("");
}

function itemsTotalCents() {
  if (!draft.items || draft.items.length === 0) return null;
  let total = 0;
  for (const it of draft.items) {
    const c = toCents(it.amountStr);
    if (!Number.isFinite(c) || c < 0) return null;
    total += c;
  }
  return total;
}

function currentAmountCents() {
  const itemsTotal = itemsTotalCents();
  if (itemsTotal != null) return itemsTotal;
  const input = document.getElementById("e-amount");
  const amountStr = input ? input.value : draft.amountStr;
  return toCents(amountStr);
}

function updateItemsTotalDisplay() {
  const el = document.querySelector(".items-total");
  if (!el) return;
  const total = itemsTotalCents();
  el.textContent = `合计 ${total != null ? formatCents(total) : "—"}`;
}

function previewHTML(members) {
  const amountCents = currentAmountCents();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return '<div class="hint">输入金额后显示分摊结果</div>';
  }
  const splits = buildSplitsFromDraft(members);
  try {
    const rows = splitExpense(amountCents, splits, draft.roundingFavor);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    let favorHTML = "";
    if (hasRemainder(amountCents, splits)) {
      const equalNames = splits.filter((s) => s.mode === "equal").map((s) => s.name);
      const chips = [
        `<button class="chip${!draft.roundingFavor ? " on" : ""}" data-action="set-favor" data-name="">不指定（首位补差）</button>`,
        ...equalNames.map(
          (n) => `<button class="chip${draft.roundingFavor === n ? " on" : ""}" data-action="set-favor" data-name="${esc(n)}">${esc(n)}</button>`
        ),
      ].join("");
      favorHTML = `<div class="favor-section"><div class="hint">总额无法整除，多出的几分钱补给：</div><div class="chips">${chips}</div></div>`;
    }
    return `<div class="preview">
      <div class="result-list">${rows
        .map((r) => `<div class="result-row"><span>${esc(r.name)}</span><span>${formatCents(r.amount)}</span></div>`)
        .join("")}</div>
      <div class="preview-total">合计 ${formatCents(total)}</div>
      ${favorHTML}
    </div>`;
  } catch (e) {
    return `<div class="hint error">${esc(e.message)}</div>`;
  }
}

function updateMembersRegion() {
  const region = document.getElementById("members-region");
  if (region) region.innerHTML = memberRowsHTML(getMembers());
}

function updatePreviewRegion() {
  const region = document.getElementById("preview-region");
  if (region) region.innerHTML = previewHTML(getMembers());
}

function renderList() {
  const gatherings = state.gatherings.slice().sort((a, b) => b.createdAt - a.createdAt);
  const cards = gatherings
    .map((g) => {
      const total = gatheringTotalCents(g);
      return `<button class="card" data-action="open-gathering" data-id="${g.id}">
        <div class="card-top"><span class="card-name">${esc(g.name)}</span><span class="card-status ${g.settled ? "ok" : "active"}">${g.settled ? "已结算" : "进行中"}</span></div>
        <div class="card-sub">${g.members.length}人 · ${g.expenses.length}笔</div>
        <div class="card-amount">${formatCents(total)}</div>
      </button>`;
    })
    .join("");
  return `<div class="header"><div class="title">我的聚会</div><div class="header-actions"><button class="ghost" data-action="friends">朋友</button><button class="ghost" data-action="backup">备份</button></div></div>
    <div class="page list-page">${cards || '<div class="empty">还没有聚会，点右下角 + 开始</div>'}</div>
    <button class="fab" data-action="new-gathering" aria-label="新建聚会">＋</button>`;
}

function renderFriends() {
  const rows = state.friends
    .map(
      (f) => `<div class="friend-row"><span>${esc(f.name)}</span><div class="friend-actions"><button class="ghost" data-action="rename-friend" data-id="${f.id}">改名</button><button class="ghost danger" data-action="remove-friend" data-id="${f.id}">删除</button></div></div>`
    )
    .join("");
  return `<div class="header"><button class="back" data-action="back">‹</button><div class="title">朋友名单</div><div class="spacer"></div></div>
    <div class="page">
      <div class="add-friend"><input id="friend-name" type="text" placeholder="输入朋友名字"><button class="primary" data-action="add-friend">添加</button></div>
      ${rows || '<div class="empty">还没有朋友，先添加吧</div>'}
    </div>`;
}

function renderNewGathering() {
  const chips = state.friends
    .map((f) => {
      const on = newG.selected.has(f.name);
      return `<button class="chip${on ? " on" : ""}" data-action="toggle-member" data-name="${esc(f.name)}">${esc(f.name)}</button>`;
    })
    .join("");
  return `<div class="header"><button class="back" data-action="back">‹</button><div class="title">新建聚会</div><div class="spacer"></div></div>
    <div class="page">
      <label>聚会名称</label>
      <input id="g-name" type="text" placeholder="例如：12月同学聚会" value="${esc(newG.title)}">
      <label>谁参加了（${newG.selected.size}人）</label>
      <div class="chips">${chips || '<div class="empty">先去「朋友」添加名单</div>'}</div>
    </div>
    <div class="footer"><button class="primary" data-action="create-gathering">开始记账</button></div>`;
}

function renderGathering() {
  const g = findGathering(state, view.id);
  if (!g) {
    view = { name: "list" };
    return renderList();
  }
  if (g.settled) {
    view = { name: "settle", id: g.id, readonly: true };
    return renderSettle();
  }
  const members = g.members.map((m) => `<span class="chip static">${esc(m)}</span>`).join("");
  const rows = g.expenses
    .map((e) => {
      const subParts = [`${totalShares(e.splits)}份分摊`];
      if (e.items && e.items.length) subParts.push(`${e.items.length}小项`);
      return `<div class="expense-row">
        <div class="expense-info"><div class="expense-title">${esc(e.title)}</div><div class="expense-sub">${subParts.join(" · ")}</div></div>
        <div class="expense-right"><span class="expense-amount">${formatCents(e.amount)}</span><button class="ghost" data-action="edit-expense" data-id="${e.id}">编辑</button><button class="ghost danger" data-action="delete-expense" data-id="${e.id}">删除</button></div>
      </div>`;
    })
    .join("");
  const total = gatheringTotalCents(g);
  return `<div class="header"><button class="back" data-action="back">‹</button><div class="title">${esc(g.name)}</div><button class="ghost danger" data-action="delete-gathering">删除</button></div>
    <div class="page">
      <div class="members-row"><div class="members">${members}</div><button class="ghost" data-action="edit-members">编辑成员</button></div>
      <div class="expense-list">${rows || '<div class="empty">还没有消费，点下方「记一笔」</div>'}</div>
      <div class="summary">共 ${g.expenses.length} 笔 · 总消费 ${formatCents(total)}</div>
    </div>
    <div class="footer split"><button class="ghost" data-action="new-expense">＋ 记一笔</button><button class="primary" data-action="settle">一键结算</button></div>`;
}

function renderSettle() {
  const g = findGathering(state, view.id);
  if (!g) {
    view = { name: "list" };
    return renderList();
  }
  const readonly = view.readonly || g.settled;

  const expenseShares = g.expenses.map((e) => {
    const shares = splitExpense(e.amount, e.splits, e.roundingFavor);
    return {
      title: e.title,
      byName: new Map(shares.map((s) => [s.name, s.amount])),
      modes: new Map(e.splits.map((s) => [s.name, s.mode])),
    };
  });

  const names = [];
  const seen = new Set();
  for (const share of expenseShares) {
    for (const name of share.byName.keys()) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  const cards = names
    .map((name) => {
      const detailRows = [];
      let total = 0;
      for (const share of expenseShares) {
        const mode = share.modes.get(name);
        if (mode === undefined || mode === "excluded") continue;
        const amount = share.byName.get(name) || 0;
        total += amount;
        detailRows.push(`<div class="settle-detail"><span>${esc(share.title)}</span><span>${formatCents(amount)}</span></div>`);
      }
      return `<div class="settle-card">
        <div class="settle-card-head"><div class="settle-ident"><span class="avatar">${esc(name[0] || "?")}</span><span class="settle-name">${esc(name)}</span></div><span class="settle-total">${formatCents(total)}</span></div>
        <div class="settle-details">${detailRows.join("")}</div>
      </div>`;
    })
    .join("");

  const grandTotal = gatheringTotalCents(g);

  const footer = readonly
    ? `<div class="footer"><button class="primary" data-action="undo-settle">撤销结算，重新编辑</button></div>`
    : `<div class="footer"><button class="primary" data-action="finish-settle">完成</button></div>`;

  return `<div class="header"><button class="back" data-action="back">‹</button><div class="title">结算结果</div><div class="spacer"></div></div>
    <div class="page">
      <div class="summary">总消费 ${formatCents(grandTotal)} · 共 ${g.expenses.length} 笔</div>
      ${cards}
    </div>
    ${footer}`;
}

function renderNewExpense() {
  const g = findGathering(state, draft.gatheringId);
  if (!g) {
    view = { name: "list" };
    return renderList();
  }
  const usingItems = draft.items && draft.items.length > 0;
  let amountSection;
  if (usingItems) {
    const itemRows = draft.items
      .map((it, idx) => `<div class="item-row">
        <input class="item-name" data-action="item-name" data-idx="${idx}" type="text" placeholder="例如：锅底" value="${esc(it.name)}">
        <input class="item-amount" data-action="item-amount" data-idx="${idx}" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${esc(it.amountStr)}">
        <button class="ghost danger" data-action="delete-item" data-idx="${idx}">删除</button>
      </div>`)
      .join("");
    const total = itemsTotalCents();
    amountSection = `<label>小项明细（总额自动汇总）</label>
      <div class="items-list">${itemRows}</div>
      <button class="ghost" data-action="add-item">＋ 添加小项</button>
      <div class="items-total">合计 ${total != null ? formatCents(total) : "—"}</div>
      <button class="ghost danger" data-action="clear-items">清除小项，改用总额</button>`;
  } else {
    amountSection = `<label>金额（元）</label>
      <input id="e-amount" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${esc(draft.amountStr)}">
      <button class="ghost" data-action="add-item">＋ 改用小项明细</button>`;
  }
  return `<div class="header"><button class="back" data-action="cancel">‹</button><div class="title">${draft.editingId ? "编辑消费" : "记一笔"}</div><div class="spacer"></div></div>
    <div class="page">
      ${amountSection}
      <label>备注</label>
      <input id="e-title" type="text" placeholder="例如：火锅" value="${esc(draft.title)}">
      <label>参与分摊</label>
      <div id="members-region"></div>
      <div id="preview-region"></div>
    </div>
    <div class="footer split"><button class="ghost" data-action="cancel">取消</button><button class="primary" data-action="save-expense">保存</button></div>`;
}

function renderEditMembers() {
  const g = findGathering(state, editMembers.gatheringId);
  if (!g) {
    view = { name: "list" };
    return renderList();
  }
  const names = [...new Set([...state.friends.map((f) => f.name), ...g.members])];
  const chips = names
    .map((name) => {
      const on = editMembers.selected.has(name);
      return `<button class="chip${on ? " on" : ""}" data-action="toggle-edit-member" data-name="${esc(name)}">${esc(name)}</button>`;
    })
    .join("");
  return `<div class="header"><button class="back" data-action="cancel-members">‹</button><div class="title">编辑成员</div><div class="spacer"></div></div>
    <div class="page">
      <div class="hint">已选 ${editMembers.selected.size} 人 · 历史消费的分摊不受影响</div>
      <div class="chips">${chips || '<div class="empty">先去「朋友」添加名单</div>'}</div>
    </div>
    <div class="footer"><button class="primary" data-action="save-members">保存</button></div>`;
}

function renderBackup() {
  return `<div class="header"><button class="back" data-action="back">‹</button><div class="title">备份</div><div class="spacer"></div></div>
    <div class="page">
      <label>导出数据（复制保存）</label>
      <textarea id="export-area" readonly>${esc(JSON.stringify(state))}</textarea>
      <button class="primary" data-action="copy-export">复制到剪贴板</button>
      <label>导入数据（粘贴后覆盖当前数据）</label>
      <textarea id="import-area" placeholder="粘贴之前导出的 JSON"></textarea>
      <button class="danger-btn" data-action="import-data">导入并覆盖</button>
    </div>`;
}

function render() {
  if (view.name === "list") app.innerHTML = renderList();
  else if (view.name === "friends") app.innerHTML = renderFriends();
  else if (view.name === "new-gathering") app.innerHTML = renderNewGathering();
  else if (view.name === "gathering") app.innerHTML = renderGathering();
  else if (view.name === "edit-members") app.innerHTML = renderEditMembers();
  else if (view.name === "settle") app.innerHTML = renderSettle();
  else if (view.name === "new-expense") {
    app.innerHTML = renderNewExpense();
    updateMembersRegion();
    updatePreviewRegion();
  } else if (view.name === "backup") app.innerHTML = renderBackup();
}

function enterNewExpense(gatheringId) {
  const g = findGathering(state, gatheringId);
  draft = {
    gatheringId,
    editingId: null,
    title: "",
    amountStr: "",
    items: [],
    roundingFavor: null,
    members: g.members.slice(),
    splits: {},
  };
  for (const name of draft.members) draft.splits[name] = { mode: "equal", custom: null, shares: 1 };
  view = { name: "new-expense" };
  render();
}

function enterEditExpense(gatheringId, expenseId) {
  const g = findGathering(state, gatheringId);
  const expense = g.expenses.find((e) => e.id === expenseId);
  if (!expense) return;
  draft = {
    gatheringId,
    editingId: expenseId,
    title: expense.title,
    amountStr: (expense.amount / 100).toFixed(2),
    items: expense.items
      ? expense.items.map((it) => ({ name: it.name || "", amountStr: it.amount ? (it.amount / 100).toFixed(2) : "" }))
      : [],
    roundingFavor: expense.roundingFavor || null,
    members: expense.splits.map((s) => s.name),
    splits: {},
  };
  for (const s of expense.splits) {
    draft.splits[s.name] = {
      mode: s.mode,
      custom: s.mode === "custom" ? s.amount : null,
      shares: s.mode === "equal" ? (s.shares || 1) : 1,
    };
  }
  view = { name: "new-expense" };
  render();
}

async function saveExpense() {
  const g = findGathering(state, draft.gatheringId);
  if (!g) return;
  const title = document.getElementById("e-title").value;
  const usingItems = draft.items && draft.items.length > 0;
  let amountCents;
  let itemsPayload = null;
  if (usingItems) {
    const total = itemsTotalCents();
    if (total == null || total <= 0) {
      await showAlert("请填写小项金额");
      return;
    }
    amountCents = total;
    itemsPayload = draft.items.map((it) => ({
      name: (it.name || "").trim(),
      amount: toCents(it.amountStr) || 0,
    }));
  } else {
    const amountStr = document.getElementById("e-amount").value;
    amountCents = toCents(amountStr);
  }
  const splits = buildSplitsFromDraft(draft.members);
  const roundingFavor = draft.roundingFavor;
  try {
    splitExpense(amountCents, splits, roundingFavor);
    if (draft.editingId) {
      updateExpense(g, draft.editingId, { title, amount: amountCents, splits, items: itemsPayload, roundingFavor });
    } else {
      addExpense(g, { title, amount: amountCents, splits, items: itemsPayload, roundingFavor });
    }
  } catch (e) {
    await showAlert(e.message);
    return;
  }
  persist();
  view = { name: "gathering", id: g.id };
  render();
}

function setMemberMode(name, mode) {
  draft.splits[name].mode = mode;
  if (mode !== "custom") draft.splits[name].custom = null;
  if (mode === "equal" && !draft.splits[name].shares) draft.splits[name].shares = 1;
  updateMembersRegion();
  updatePreviewRegion();
}

function changeShares(name, delta) {
  const m = draft.splits[name];
  const current = m.shares || 1;
  const next = Math.min(99, Math.max(1, current + delta));
  m.shares = next;
  updateMembersRegion();
  updatePreviewRegion();
}

async function handleAction(action, el) {
  if (action === "open-gathering") {
    view = { name: "gathering", id: el.dataset.id };
    render();
  } else if (action === "new-gathering") {
    newG = { title: "", selected: new Set() };
    view = { name: "new-gathering" };
    render();
  } else if (action === "toggle-member") {
    const name = el.dataset.name;
    if (newG.selected.has(name)) newG.selected.delete(name);
    else newG.selected.add(name);
    render();
  } else if (action === "create-gathering") {
    const name = document.getElementById("g-name").value;
    try {
      const g = createGathering(state, name, [...newG.selected]);
      persist();
      view = { name: "gathering", id: g.id };
      render();
    } catch (e) {
      await showAlert(e.message);
    }
  } else if (action === "friends") {
    view = { name: "friends" };
    render();
  } else if (action === "backup") {
    view = { name: "backup" };
    render();
  } else if (action === "back") {
    if (view.name === "settle") {
      view = view.readonly ? { name: "list" } : { name: "gathering", id: view.id };
    } else if (view.name === "gathering") {
      view = { name: "list" };
    } else {
      view = { name: "list" };
    }
    render();
  } else if (action === "add-friend") {
    const input = document.getElementById("friend-name");
    try {
      addFriend(state, input.value);
      persist();
      input.value = "";
      render();
    } catch (e) {
      await showAlert(e.message);
    }
  } else if (action === "rename-friend") {
    const f = state.friends.find((x) => x.id === el.dataset.id);
    if (!f) return;
    const name = await showPrompt("修改朋友名字", f.name);
    if (name == null) return;
    try {
      renameFriend(state, f.id, name);
      persist();
      render();
    } catch (e) {
      await showAlert(e.message);
    }
  } else if (action === "remove-friend") {
    const f = state.friends.find((x) => x.id === el.dataset.id);
    if (!f) return;
    if (await showConfirm(`确定删除「${f.name}」？历史账单不受影响`, { danger: true })) {
      removeFriend(state, el.dataset.id);
      persist();
      render();
    }
  } else if (action === "new-expense") {
    enterNewExpense(view.id);
  } else if (action === "edit-expense") {
    enterEditExpense(view.id, el.dataset.id);
  } else if (action === "delete-expense") {
    const g = findGathering(state, view.id);
    if (await showConfirm("删除这笔消费？", { danger: true })) {
      removeExpense(g, el.dataset.id);
      persist();
      render();
    }
  } else if (action === "edit-members") {
    const g = findGathering(state, view.id);
    editMembers = { gatheringId: g.id, selected: new Set(g.members) };
    view = { name: "edit-members" };
    render();
  } else if (action === "toggle-edit-member") {
    const name = el.dataset.name;
    if (editMembers.selected.has(name)) editMembers.selected.delete(name);
    else editMembers.selected.add(name);
    render();
  } else if (action === "save-members") {
    const g = findGathering(state, editMembers.gatheringId);
    try {
      setGatheringMembers(g, [...editMembers.selected]);
      persist();
      view = { name: "gathering", id: g.id };
      render();
    } catch (e) {
      await showAlert(e.message);
    }
  } else if (action === "cancel-members") {
    view = { name: "gathering", id: editMembers.gatheringId };
    render();
  } else if (action === "delete-gathering") {
    const g = findGathering(state, view.id);
    if (!g) return;
    if (await showConfirm(`确定删除聚会「${g.name}」？账单记录将一并删除，无法恢复`, { danger: true })) {
      deleteGathering(state, g.id);
      persist();
      view = { name: "list" };
      render();
    }
  } else if (action === "settle") {
    view = { name: "settle", id: view.id };
    render();
  } else if (action === "finish-settle") {
    const g = findGathering(state, view.id);
    if (!g) return;
    if (!(await showConfirm("确认完成结算？完成后聚会将进入只读状态，可随时撤销。", { confirmLabel: "完成结算" }))) return;
    g.settled = true;
    persist();
    view = { name: "list" };
    render();
  } else if (action === "undo-settle") {
    const g = findGathering(state, view.id);
    if (g) g.settled = false;
    persist();
    view = { name: "gathering", id: g.id };
    render();
  } else if (action === "set-mode") {
    setMemberMode(el.dataset.name, el.dataset.mode);
  } else if (action === "inc-share") {
    changeShares(el.dataset.name, 1);
  } else if (action === "dec-share") {
    changeShares(el.dataset.name, -1);
  } else if (action === "save-expense") {
    await saveExpense();
  } else if (action === "add-item") {
    if (!draft.items) draft.items = [];
    draft.items.push({ name: "", amountStr: "" });
    if (draft.items.length === 1) draft.amountStr = "";
    render();
  } else if (action === "delete-item") {
    const idx = Number(el.dataset.idx);
    draft.items.splice(idx, 1);
    if (draft.items.length === 0) draft.amountStr = "";
    render();
  } else if (action === "clear-items") {
    draft.items = [];
    draft.amountStr = "";
    render();
  } else if (action === "set-favor") {
    draft.roundingFavor = el.dataset.name || null;
    updatePreviewRegion();
  } else if (action === "cancel") {
    view = { name: "gathering", id: draft.gatheringId };
    render();
  } else if (action === "copy-export") {
    const area = document.getElementById("export-area");
    area.select();
    navigator.clipboard.writeText(area.value).then(() => showAlert("已复制到剪贴板")).catch(() => showAlert("复制失败，请手动复制"));
  } else if (action === "import-data") {
    const area = document.getElementById("import-area");
    try {
      const parsed = JSON.parse(area.value);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.friends)) {
        throw new Error("格式不正确");
      }
      if (!(await showConfirm("导入将覆盖当前全部数据，确定继续？", { danger: true }))) return;
      state = parsed;
      persist();
      view = { name: "list" };
      render();
    } catch (e) {
      await showAlert("导入失败：" + e.message);
    }
  }
}

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  handleAction(el.dataset.action, el);
});

app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "g-name") {
    newG.title = el.value;
  } else if (el.id === "e-amount") {
    draft.amountStr = el.value;
    updatePreviewRegion();
  } else if (el.id === "e-title") {
    draft.title = el.value;
  } else if (el.dataset.action === "custom-input") {
    const v = toCents(el.value);
    draft.splits[el.dataset.name].custom = Number.isFinite(v) ? v : null;
    updatePreviewRegion();
  } else if (el.dataset.action === "item-name") {
    const idx = Number(el.dataset.idx);
    draft.items[idx].name = el.value;
  } else if (el.dataset.action === "item-amount") {
    const idx = Number(el.dataset.idx);
    draft.items[idx].amountStr = el.value;
    updateItemsTotalDisplay();
    updatePreviewRegion();
  }
});

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}