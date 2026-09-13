export function toCents(amount) {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) return NaN;
    amount = String(amount);
  }
  const s = String(amount).trim();
  if (s === "") return NaN;
  const negative = s.startsWith("-");
  const t = s.replace(/^-/, "");
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") return NaN;
  const [intPart = "", decPart = ""] = t.split(".");
  const cents = Number(intPart || "0") * 100 + Number((decPart + "00").slice(0, 2));
  if (!Number.isFinite(cents)) return NaN;
  return negative ? -cents : cents;
}

export function formatCents(cents) {
  return "¥" + (Math.round(cents) / 100).toFixed(2);
}

export function hasRemainder(amountCents, splits) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return false;
  if (!Array.isArray(splits) || splits.length === 0) return false;
  let equalShares = 0;
  let customSum = 0;
  for (const s of splits) {
    if (s.mode === "excluded") continue;
    if (s.mode === "equal") equalShares += validShares(s.shares);
    else if (s.mode === "custom") customSum += s.amount;
  }
  if (equalShares === 0) return false;
  const remaining = amountCents - customSum;
  const base = Math.floor(remaining / equalShares);
  return remaining - base * equalShares > 0;
}

export function splitExpense(amountCents, splits, roundingFavor) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("金额必须大于 0");
  }
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new Error("至少需要一位参与者");
  }

  const equal = [];
  const custom = [];
  for (const s of splits) {
    if (s.mode === "excluded") continue;
    if (s.mode === "equal") {
      equal.push(s);
    } else if (s.mode === "custom") {
      if (!Number.isInteger(s.amount) || s.amount < 0) {
        throw new Error("自定义金额不能为负数");
      }
      custom.push(s);
    }
  }

  if (equal.length === 0 && custom.length === 0) {
    throw new Error("至少需要一位参与者");
  }

  const customSum = custom.reduce((sum, s) => sum + s.amount, 0);
  if (customSum > amountCents) {
    throw new Error("自定义金额之和不能超过总金额");
  }

  const remaining = amountCents - customSum;
  if (equal.length === 0 && remaining !== 0) {
    throw new Error("剩余金额未分配完");
  }

  const result = new Map();
  for (const s of splits) {
    if (s.mode === "excluded") {
      result.set(s.name, 0);
    } else if (s.mode === "custom") {
      result.set(s.name, s.amount);
    }
  }

  if (equal.length > 0) {
    const units = [];
    for (const s of equal) {
      const shares = validShares(s.shares);
      for (let i = 0; i < shares; i++) units.push(s.name);
    }

    // 补差顺序：如果指定了 roundingFavor，该人排到最前
    let orderedUnits = units;
    if (roundingFavor && units.includes(roundingFavor)) {
      const favored = [];
      const rest = [];
      for (const name of units) {
        if (name === roundingFavor) favored.push(name);
        else rest.push(name);
      }
      orderedUnits = [...favored, ...rest];
    }

    const base = Math.floor(remaining / orderedUnits.length);
    let remainder = remaining - base * orderedUnits.length;
    const perName = new Map();
    for (const name of orderedUnits) {
      let amount = base;
      if (remainder > 0) {
        amount += 1;
        remainder -= 1;
      }
      perName.set(name, (perName.get(name) || 0) + amount);
    }
    for (const s of equal) {
      result.set(s.name, perName.get(s.name) || 0);
    }
  }

  return splits.map((s) => ({ name: s.name, amount: result.get(s.name) }));
}

function validShares(shares) {
  return Number.isInteger(shares) && shares > 0 ? shares : 1;
}

export function totalShares(splits) {
  let n = 0;
  for (const s of splits) {
    if (s.mode === "excluded") continue;
    if (s.mode === "equal") n += validShares(s.shares);
    else if (s.mode === "custom") n += 1;
  }
  return n;
}

export function summarizeExpenses(expenses) {
  const totals = new Map();
  for (const expense of expenses) {
    const shares = splitExpense(expense.amount, expense.splits, expense.roundingFavor);
    for (const share of shares) {
      totals.set(share.name, (totals.get(share.name) || 0) + share.amount);
    }
  }
  return [...totals.entries()].map(([name, amount]) => ({ name, amount }));
}