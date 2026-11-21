/* 策略 v2 試算 page: 0050 70% / cash 30%, rebalanced on the year's first trading day, monthly
   deposits split 70 / 30 on the month's first trading day. The latest 0050 close and the next
   dates are embedded at build time (research/site/build.py write_rebalance_page, the same
   facts as the brief's 策略 v2 今日動作 block, its 模型比重 line included). Everything is computed here; the inputs are
   kept in localStorage only and never sent anywhere. Red is buying, green is selling (the
   Taiwan convention the rank page uses). */
(function () {
  "use strict";
  var STORE_KEY = "v2-calc";
  var LOT = 1000;
  var STOCK_SHARE = 0.7;
  var PER_UNIT = 10000;
  var EPS = 1e-9;
  function $(id) { return document.getElementById(id); }

  var facts = null;
  try { facts = JSON.parse($("v2-data").textContent); } catch (e) { facts = null; }
  var close = facts && typeof facts.close === "number" && facts.close > 0 ? facts.close : null;
  var stockShare = facts && facts.target ? facts.target.stock / 100 : STOCK_SHARE;
  /* the brief's own split of one NT$10,000 deposit (shares and price), so the deposit rows
     say what the brief says (review 2026-10-21 L4); without it the close prices the split */
  var perDeposit = facts && facts.per_deposit && typeof facts.per_deposit.price === "number" &&
    facts.per_deposit.price > 0 ? facts.per_deposit : null;
  var depositPrice = perDeposit ? perDeposit.price : close;
  var depositLabel = perDeposit && perDeposit.price_label ? perDeposit.price_label : "收盤";

  function fmt(n, dp) { return Number(n).toLocaleString("zh-TW", { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function money(n) { return fmt(Math.round(n), 0) + " 元"; }
  function pct(n) { return fmt(n * 100, 1) + "%"; }
  function floorShares(amount) { return Math.floor(amount / close + EPS); }
  /* whole lots of 1,000 and the odd remainder */
  function lotsText(shares) {
    var lots = Math.floor(shares / LOT), odd = shares % LOT;
    if (shares <= 0) return "0 股";
    if (!lots) return fmt(odd, 0) + " 股（零股）";
    return fmt(shares, 0) + " 股（" + fmt(lots, 0) + " 張" + (odd ? "又 " + fmt(odd, 0) + " 股" : "") + "）";
  }
  /* a typed amount: "3,000" and "3000 元" read as 3000, an empty field as 0; a negative,
     unreadable or non-finite entry is NaN, which compute() reports next to the field instead
     of guessing (review 2026-10-21 L5: "-5,000" used to read as 5,000) */
  var INVALID = "請填 0 以上的數字";
  /* the fields' names in the summary row, so it says which entry to fix (QA 2026-10-22 #7) */
  var FIELD_NAMES = { "c-shares": "0050 持股", "c-value": "0050 市值", "c-cash": "現金", "c-deposit": "本月存款" };
  function parse(text) {
    var raw = String(text === undefined || text === null ? "" : text).trim();
    if (!raw) return 0;
    var clean = raw.replace(/^\u2212/, "-").replace(/[,\s元]/g, "");
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(clean)) return NaN;
    var n = parseFloat(clean);
    return isFinite(n) && n >= 0 ? n : NaN;
  }
  function display(input, n, dp) { input.value = n > 0 ? fmt(n, dp) : ""; }
  /* the field's message: shown while its entry is invalid, hidden otherwise */
  function flag(input, invalid) {
    var err = $(input.id + "-error");
    if (err) { err.textContent = invalid ? INVALID : ""; err.hidden = !invalid; }
    input.setAttribute("aria-invalid", invalid ? "true" : "false");
  }

  /* the brief's advice opens with the rule's own words when there is nothing to do (不用動作。
     下一個存款日 …); the bold label in front already says them, so the line says them once
     (QA 2026-10-22 #6) */
  function withoutLabel(action, label) {
    if (!label || action.indexOf(label) !== 0) return action;
    return action.slice(label.length).replace(/^[。，；\s]+/, "");
  }

  /* the hero: close, next dates, target */
  function dateText(item) { return item && item.date ? item.date : "—"; }
  function dateNote(item, count) {
    if (!item || !item.date) return "";
    var parts = [];
    if (count && typeof item.trading_days === "number") parts.push(item.trading_days + " 個交易日後");
    if (item.confirmed === false) parts.push("待交易所公布休市日曆後確認");
    return parts.join("，");
  }
  if (facts) {
    if (close) {
      $("c-close").textContent = fmt(close, 2);
      var move = facts.change === null || facts.change === undefined ? "不比價" :
        (facts.change > 0 ? "+" : facts.change < 0 ? "−" : "") + fmt(Math.abs(facts.change), 2) +
        (typeof facts.change_pct === "number" ? "（" + (facts.change_pct > 0 ? "+" : facts.change_pct < 0 ? "−" : "") + fmt(Math.abs(facts.change_pct), 2) + "%）" : "");
      $("c-close-note").textContent = facts.as_of + " " + move;
      var st = $("st-close");
      if (facts.change > 0) st.classList.add("up"); else if (facts.change < 0) st.classList.add("down");
    }
    $("c-next-dep").textContent = dateText(facts.next_deposit);
    $("c-next-dep-note").textContent = dateNote(facts.next_deposit, true);
    $("c-next-reb").textContent = dateText(facts.next_rebalance);
    $("c-next-reb-note").textContent = dateNote(facts.next_rebalance, false);
    if (facts.target) $("c-target").textContent = facts.target.stock + "／" + facts.target.cash;
    if (facts.decided) $("c-target-note").textContent = "Vincent " + facts.decided + " 選定";
    if (facts.conclusion && facts.action) {
      var today = $("c-today"), ruleLabel = facts.rule_label || "";
      today.textContent = "";
      var b = document.createElement("b"); b.textContent = ruleLabel + "　";
      today.appendChild(b);
      today.appendChild(document.createTextNode(facts.conclusion + withoutLabel(facts.action, ruleLabel)));
      today.hidden = false;
    }
    /* the model portfolio's drift (research.strategy.v2.drift_facts), the brief's own
       sentence; left out when the brief has none */
    if (facts.drift && facts.drift.text) {
      var drift = $("c-drift");
      drift.textContent = "";
      var label = document.createElement("b"); label.textContent = "模型比重　";
      drift.appendChild(label);
      drift.appendChild(document.createTextNode(facts.drift.text));
      drift.hidden = false;
    }
    if (facts.disclaimer) $("c-disclaimer").textContent = facts.disclaimer;
  } else {
    $("c-close-note").textContent = "尚無收盤資料";
  }

  var shares = $("c-shares"), value = $("c-value"), cash = $("c-cash"), deposit = $("c-deposit");
  var driver = "shares"; /* which of shares / value the reader typed last; the other follows the close */
  if (!close) {
    $("c-shares-hint").textContent = "尚無 0050 收盤資料，請直接填市值。";
    shares.disabled = true;
  } else {
    $("c-shares-hint").textContent = "以收盤 " + fmt(close, 2) + " 換算市值";
    $("c-value-hint").textContent = "以收盤 " + fmt(close, 2) + " 換算股數";
  }

  function row(dl, label, text, cls, sub) {
    var div = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = text;
    if (cls) dd.className = cls;
    if (sub) { var s = document.createElement("span"); s.className = "sub"; s.textContent = sub; dd.appendChild(s); }
    div.appendChild(dt); div.appendChild(dd); dl.appendChild(div);
  }
  function clear(dl) { while (dl.firstChild) dl.removeChild(dl.firstChild); }

  function compute() {
    var s = parse(shares.value), v = parse(value.value), c = parse(cash.value), d = parse(deposit.value);
    var now = $("o-now"), dep = $("o-dep"), reb = $("o-reb");
    var bad = [];
    [[shares, s], [value, v], [cash, c], [deposit, d]].forEach(function (f) {
      var invalid = isNaN(f[1]);
      flag(f[0], invalid);
      if (invalid) bad.push(FIELD_NAMES[f[0].id]);
    });
    if (bad.length) { /* an invalid entry: name it and compute nothing, save nothing */
      clear(now); clear(dep); clear(reb);
      row(now, "尚未計算", bad.join("、") + "：" + INVALID);
      return;
    }
    if (close) {
      if (driver === "shares") { v = s * close; display(value, v, 0); }
      else { s = floorShares(v); display(shares, s, 0); }
    }
    clear(now); clear(dep); clear(reb);
    var total = v + c;
    if (total > 0) {
      row(now, "合計（0050＋現金）", money(total), "lead-row");
      row(now, "0050 比例", pct(v / total), "", "目標 " + pct(stockShare));
      row(now, "現金比例", pct(c / total), "", "目標 " + pct(1 - stockShare));
    } else {
      row(now, "合計", "請先填 0050 市值（或股數）與現金");
    }
    /* deposit day: the month's deposit, or one NT$10,000 as the example; the example is the
       brief's own per_deposit, a reader's deposit is priced the same way */
    var example = !(d > 0) && perDeposit && typeof perDeposit.shares === "number" && perDeposit.deposit === PER_UNIT;
    var unit = d > 0 ? d : PER_UNIT, toStock = example ? perDeposit.stock : unit * stockShare, toCash = unit - toStock;
    var depShares = example ? perDeposit.shares : (depositPrice ? Math.floor(toStock / depositPrice + EPS) : null);
    var head = d > 0 ? "本月存款 " + money(unit) : "每 " + fmt(PER_UNIT, 0) + " 元（未填存款時的示例）";
    row(dep, head, money(toStock) + " 買 0050", "up", depShares === null ? "" : "≈ " + lotsText(depShares) + "，" + depositLabel + " " + fmt(depositPrice, 2));
    row(dep, "留現金", money(toCash));
    /* rebalance day: the whole account, deposit included */
    var all = total + d;
    if (all > 0) {
      var targetStock = all * stockShare, targetCash = all - targetStock, diff = targetStock - v;
      row(reb, d > 0 ? "合計（含本月存款）" : "合計", money(all), "lead-row");
      row(reb, "目標 0050 市值（" + pct(stockShare) + "）", money(targetStock));
      row(reb, "目標現金（" + pct(1 - stockShare) + "）", money(targetCash));
      var n = close ? floorShares(Math.abs(diff)) : null;
      if (Math.abs(diff) < 0.5 || (close && n === 0)) {
        row(reb, "要做的事", "不到 1 股，不用動作", "", "差額 " + money(Math.abs(diff)));
      } else if (diff > 0) {
        row(reb, "買進 0050", money(diff), "up", close ? "≈ " + lotsText(n) + "，收盤 " + fmt(close, 2) : "");
      } else {
        row(reb, "賣出 0050", money(-diff), "down", close ? "≈ " + lotsText(n) + "，收盤 " + fmt(close, 2) : "");
      }
    } else {
      row(reb, "合計", "請先填 0050 市值（或股數）與現金");
    }
    save({ shares: s, value: v, cash: c, deposit: d, driver: driver });
  }

  function save(state) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); $("c-saved").textContent = "已存在這個瀏覽器"; }
    catch (e) { $("c-saved").textContent = ""; }
  }
  function restore() {
    var st = null;
    try { st = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { st = null; }
    if (!st || typeof st !== "object") return;
    driver = st.driver === "value" ? "value" : "shares";
    display(shares, parse(st.shares), 0);
    display(value, parse(st.value), 0);
    display(cash, parse(st.cash), 0);
    display(deposit, parse(st.deposit), 0);
  }

  shares.addEventListener("input", function () { driver = "shares"; compute(); });
  value.addEventListener("input", function () { driver = "value"; compute(); });
  cash.addEventListener("input", compute);
  deposit.addEventListener("input", compute);
  [shares, value, cash, deposit].forEach(function (el) {
    el.addEventListener("blur", function () { var n = parse(el.value); if (el.value.trim() && !isNaN(n)) display(el, n, 0); });
  });
  $("c-clear").addEventListener("click", function () {
    [shares, value, cash, deposit].forEach(function (el) { el.value = ""; });
    driver = "shares";
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    compute();
    $("c-saved").textContent = "";
    shares.disabled ? value.focus() : shares.focus();
  });
  restore();
  compute();

  /* shared chrome: sidebar sheet and theme */
  /* opening the sheet moves focus into it; closing it hands focus back to the menu button */
  function side(open) {
    var body = document.body, was = body.classList.contains("nav-open"), o = document.querySelector(".side-open");
    body.classList.toggle("nav-open", open);
    if (o) o.setAttribute("aria-expanded", String(open));
    if (open) {
      var cur = document.querySelector(".side .current a") || document.querySelector(".side a");
      if (cur) cur.focus({ preventScroll: true });
    } else if (was && o && document.activeElement && document.activeElement.closest(".side")) o.focus();
  }
  /* while the phone sheet is open (its close button showing), Tab and Shift+Tab cycle through
     its visible controls instead of leaving for the page underneath */
  function trapTab(e) {
    var close = document.querySelector(".side-close");
    if (!document.body.classList.contains("nav-open") || !close || !close.getClientRects().length) return;
    var items = [].filter.call(document.querySelectorAll(".side a[href], .side button"), function (x) { return x.getClientRects().length; });
    if (!items.length) return;
    var at = document.activeElement, inside = at && at.closest && at.closest(".side");
    var edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (!inside || at === edge) { e.preventDefault(); (e.shiftKey ? items[items.length - 1] : items[0]).focus(); }
  }
  /* the theme button is a toggle for the dark theme; aria-pressed follows the theme in use */
  var darkQuery = matchMedia("(prefers-color-scheme: dark)");
  function isDark() { var cur = document.documentElement.getAttribute("data-theme"); return cur ? cur === "dark" : darkQuery.matches; }
  function syncTheme() { var b = document.querySelector('[data-action="theme"]'); if (b) b.setAttribute("aria-pressed", String(isDark())); }
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", syncTheme); else if (darkQuery.addListener) darkQuery.addListener(syncTheme);
  syncTheme();
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-action]"); if (!a) return;
    var act = a.getAttribute("data-action");
    if (act === "side-open") side(true);
    else if (act === "side-close") side(false);
    else if (act === "theme") {
      var next = isDark() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem("theme", next); } catch (err) {}
      syncTheme();
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") side(false); else if (e.key === "Tab") trapTab(e); });
})();
