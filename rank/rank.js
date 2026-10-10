/* 排行 page: sorts and filters the precomputed rows in data/rank.json; the watchlist lives in
   localStorage. Red is up and buying, green is down and selling (Taiwan convention). */
(function () {
  "use strict";
  var PAGE = 50;
  var WATCH_KEY = "watchlist";
  var SCOPES = [["全部", "all"], ["上市", "twse"], ["上櫃", "tpex"], ["自選", "watch"]];
  var VIEWS = [["個股", "stock"], ["產業", "industry"]];
  /* industry view: key, header, decimals (null = text), signed */
  var ICOLS = [
    ["industry", "產業", null, false],
    ["fy", "外資(億)", 1, true],
    ["ty", "投信(億)", 1, true],
    ["chg", "平均漲跌", 2, true],
    ["n", "家數", 0, false],
    ["up", "上漲", 0, false],
    ["down", "下跌", 0, false],
    ["mc", "融資增減(張)", 0, true]
  ];
  var KINDS = [["股票", false], ["ETF", true]];
  /* key, header, decimals (null = text), signed */
  /* the ranking metric and the day move come first so a phone shows them without scrolling */
  var COLS = [
    ["name", "名稱", null, false],
    ["fy", "外資(億)", 1, true],
    ["chg", "漲跌", 2, true],
    ["f1", "外資(張)", 0, true],
    ["t1", "投信(張)", 0, true],
    ["f5", "外資 5 日(張)", 0, true],
    ["streak", "連買賣", 0, true],
    ["hp", "外資持股(%)", 2, false],
    ["hw", "持股 5 日(百分點)", 2, true],
    ["mc", "融資增減(張)", 0, true],
    ["sr", "券資比(%)", 2, false],
    ["close", "收盤", 2, false],
    ["pe", "本益比", 2, false],
    ["dy", "殖利率(%)", 2, false],
    ["pb", "股價淨值比", 2, false]
  ];
  /* header tooltips; the ratios are left blank unless the exchanges published them for the
     ranking's own day, so a stale file never shows */
  var VALUATION_HINT = "證交所、櫃買中心當日公布；無資料時顯示 —（虧損公司無本益比、ETF 不適用、當日尚未公布）";
  var HINTS = { pe: VALUATION_HINT, dy: VALUATION_HINT, pb: VALUATION_HINT };
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
  /* data files carry the build stamp so a reload shows new data even while GitHub Pages
     still serves the cached page for up to ten minutes */
  var buildMeta = document.querySelector('meta[name="build"]');
  var V = buildMeta && buildMeta.content ? "?v=" + encodeURIComponent(buildMeta.content) : "";
  var $ = function (id) { return document.getElementById(id); };
  var state = { rows: [], scope: 0, kind: 0, sort: "fy", dir: -1, shown: PAGE, q: "", industry: "", view: 0, isort: "fy", idir: -1 };

  function loadWatch() {
    try { var v = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function saveWatch(list) { try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) {} }
  var watch = loadWatch();
  function toggleWatch(id) {
    var i = watch.indexOf(id);
    if (i >= 0) watch.splice(i, 1); else watch.push(id);
    saveWatch(watch);
  }

  function fmt(v, d) { return Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function signed(v, d) {
    var r = Number(v.toFixed(d));
    if (r === 0) return fmt(0, d);
    return (r > 0 ? "+" : "−") + fmt(Math.abs(r), d);
  }
  function tone(v, d) { var r = Number(v.toFixed(d)); return r > 0 ? "up" : r < 0 ? "down" : ""; }

  function cell(row, col) {
    var v = row[col[0]], td = document.createElement("td");
    if (col[0] === "chg") {
      if (v === null) { td.textContent = "不比價"; td.className = "muted"; td.title = "交易所標示不比價，多為除權息當日"; return td; }
      td.innerHTML = '<span class="' + tone(v * 100, 2) + '">' + signed(v * 100, 2) + "%</span>";
      return td;
    }
    if (v === null) { td.textContent = "—"; td.className = "muted"; return td; }
    if (col[0] === "streak") {
      if (!v) { td.textContent = "—"; td.className = "muted"; return td; }
      td.innerHTML = '<span class="' + (v > 0 ? "up" : "down") + '">' + (v > 0 ? "買 " : "賣 ") + Math.abs(v) + "</span>";
      return td;
    }
    if (col[3]) { td.innerHTML = '<span class="' + tone(v, col[2]) + '">' + signed(v, col[2]) + "</span>"; return td; }
    td.textContent = fmt(v, col[2]);
    return td;
  }

  function nameCell(row) {
    var td = document.createElement("td"), on = watch.indexOf(row.id) >= 0;
    td.className = "name-cell";
    var b = document.createElement("button");
    b.type = "button"; b.className = "star"; b.innerHTML = STAR;
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", (on ? "移出自選 " : "加入自選 ") + row.name);
    b.setAttribute("data-id", row.id);
    td.appendChild(b);
    var n = document.createElement(row.page ? "a" : "span");
    n.className = "rank-name"; n.textContent = row.name;
    if (row.page) n.href = "../stock/index.html?id=" + encodeURIComponent(row.id);
    td.appendChild(n);
    var s = document.createElement("span"); s.className = "sid"; s.textContent = row.id; td.appendChild(s);
    if (row.market === "tpex") { var t = document.createElement("span"); t.className = "tag"; t.textContent = "上櫃"; td.appendChild(t); }
    return td;
  }

  function filtered() {
    var scope = SCOPES[state.scope][1], etf = KINDS[state.kind][1], q = state.q;
    return state.rows.filter(function (r) {
      if (scope === "watch") { if (watch.indexOf(r.id) < 0) return false; }
      else if (scope !== "all" && r.market !== scope) return false;
      if (scope !== "watch" && r.etf !== etf) return false;
      if (state.industry && r.industry !== state.industry) return false;
      if (q && r.id.indexOf(q) !== 0 && r.name.indexOf(q) < 0) return false;
      return true;
    });
  }

  function sorted(rows) {
    var k = state.sort, dir = state.dir;
    return rows.slice().sort(function (a, b) {
      if (k === "name") return dir * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      var x = a[k], y = b[k];
      if (x === null && y === null) return 0;
      if (x === null) return 1;  /* unknown values sink in both directions */
      if (y === null) return -1;
      return dir * (x - y);
    });
  }

  function industryView() { return VIEWS[state.view][1] === "industry"; }

  /* equal-weight industry aggregates of today's common stocks in the chosen market */
  function industryRows() {
    var scope = SCOPES[state.scope][1], groups = {};
    state.rows.forEach(function (r) {
      if (r.etf || !r.industry) return;
      if ((scope === "twse" || scope === "tpex") && r.market !== scope) return;
      var g = groups[r.industry] || (groups[r.industry] = { industry: r.industry, n: 0, up: 0, down: 0, fy: 0, ty: 0, mc: 0, chgSum: 0, chgN: 0, mcN: 0 });
      g.n += 1; g.fy += r.fy; g.ty += r.t1 * r.close / 1e5;
      if (r.chg !== null) { g.chgSum += r.chg * 100; g.chgN += 1; if (r.chg > 0) g.up += 1; else if (r.chg < 0) g.down += 1; }
      if (r.mc !== null && r.mc !== undefined) { g.mc += r.mc; g.mcN += 1; }
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.chg = g.chgN ? g.chgSum / g.chgN : null;
      if (!g.mcN) g.mc = null;
      return g;
    });
  }

  function industryHead() {
    var tr = $("r-head"); tr.innerHTML = "";
    ICOLS.forEach(function (c) {
      var th = document.createElement("th"); th.scope = "col";
      if (state.isort === c[0]) th.setAttribute("aria-sort", state.idir < 0 ? "descending" : "ascending");
      var b = document.createElement("button"); b.type = "button"; b.className = "sort"; b.textContent = c[1];
      b.setAttribute("data-key", c[0]);
      th.appendChild(b); tr.appendChild(th);
    });
  }

  function industryBody() {
    var k = state.isort, dir = state.idir, tb = $("r-body");
    var rows = industryRows().sort(function (a, b) {
      if (k === "industry") return dir * a.industry.localeCompare(b.industry, "zh-Hant");
      var x = a[k], y = b[k];
      if (x === null) return 1;
      if (y === null) return -1;
      return dir * (x - y);
    });
    tb.innerHTML = "";
    $("r-count").textContent = "共 " + rows.length + " 個產業，點產業看個股";
    rows.forEach(function (g) {
      var tr = document.createElement("tr"), name = document.createElement("td");
      var b = document.createElement("button"); b.type = "button"; b.className = "rank-name industry-pick";
      b.textContent = g.industry; b.setAttribute("data-industry", g.industry);
      name.appendChild(b); tr.appendChild(name);
      ICOLS.slice(1).forEach(function (c) {
        var v = g[c[0]], td = document.createElement("td");
        if (v === null) { td.textContent = "—"; td.className = "muted"; }
        else if (c[3]) { td.innerHTML = '<span class="' + tone(v, c[2]) + '">' + signed(v, c[2]) + (c[0] === "chg" ? "%" : "") + "</span>"; }
        else td.textContent = fmt(v, c[2]);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    $("r-more").hidden = true;
  }

  function render() {
    var ind = industryView();
    $("kind").hidden = ind || SCOPES[state.scope][1] === "watch";
    $("industry").hidden = ind;
    if (ind) { industryHead(); industryBody(); } else { head(); body(); }
  }

  function head() {
    var tr = $("r-head"); tr.innerHTML = "";
    COLS.forEach(function (c) {
      var th = document.createElement("th"); th.scope = "col";
      if (state.sort === c[0]) th.setAttribute("aria-sort", state.dir < 0 ? "descending" : "ascending");
      var b = document.createElement("button"); b.type = "button"; b.className = "sort"; b.textContent = c[1];
      b.setAttribute("data-key", c[0]);
      if (HINTS[c[0]]) b.title = HINTS[c[0]];
      th.appendChild(b); tr.appendChild(th);
    });
  }

  function body() {
    var rows = sorted(filtered()), tb = $("r-body");
    tb.innerHTML = "";
    var scope = SCOPES[state.scope][1];
    $("r-count").textContent = rows.length ? "共 " + rows.length.toLocaleString("zh-TW") + " 檔" : "";
    if (!rows.length) {
      var tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = COLS.length; td.className = "empty-cell";
      td.textContent = scope === "watch" && !watch.length
        ? "還沒有自選股。點每列名稱左邊的星號加入，清單只存在這個瀏覽器。"
        : "沒有符合條件的股票。";
      tr.appendChild(td); tb.appendChild(tr);
    }
    rows.slice(0, state.shown).forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(nameCell(r));
      COLS.slice(1).forEach(function (c) { tr.appendChild(cell(r, c)); });
      tb.appendChild(tr);
    });
    $("r-more").hidden = rows.length <= state.shown;
  }

  function segmented(container, items, active, onPick) {
    container.innerHTML = "";
    items.forEach(function (item, i) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = item[0];
      b.setAttribute("aria-pressed", String(i === active));
      b.addEventListener("click", function () { onPick(i); });
      container.appendChild(b);
    });
  }
  function pickScope(i) { state.scope = i; state.shown = PAGE; segmented($("scope"), SCOPES, i, pickScope); render(); }
  function pickView(i) { state.view = i; segmented($("view"), VIEWS, i, pickView); render(); }
  function pickKind(i) { state.kind = i; state.shown = PAGE; segmented($("kind"), KINDS, i, pickKind); body(); }

  $("r-head").addEventListener("click", function (e) {
    var b = e.target.closest("button.sort"); if (!b) return;
    var k = b.getAttribute("data-key");
    if (industryView()) {
      if (state.isort === k) state.idir = -state.idir; else { state.isort = k; state.idir = k === "industry" ? 1 : -1; }
      render(); return;
    }
    if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === "name" ? 1 : -1; }
    state.shown = PAGE; head(); body();
  });
  $("r-body").addEventListener("click", function (e) {
    var pick = e.target.closest("button.industry-pick");
    if (pick) {
      state.industry = pick.getAttribute("data-industry"); $("industry").value = state.industry;
      if (SCOPES[state.scope][1] === "watch") state.scope = 0;
      segmented($("scope"), SCOPES, state.scope, pickScope);
      state.kind = 0; segmented($("kind"), KINDS, 0, pickKind);
      state.shown = PAGE; pickView(0); window.scrollTo({ top: 0 }); return;
    }
    var b = e.target.closest("button.star"); if (!b) return;
    var id = b.getAttribute("data-id"), on = watch.indexOf(id) < 0;
    toggleWatch(id);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", (on ? "移出自選 " : "加入自選 ") + b.parentNode.querySelector(".rank-name").textContent);
    if (SCOPES[state.scope][1] === "watch") body();
  });
  $("r-more").addEventListener("click", function () { state.shown += PAGE; body(); });
  $("industry").addEventListener("change", function () { state.industry = this.value; state.shown = PAGE; body(); });
  function industries() {
    var seen = {}, names = [];
    state.rows.forEach(function (r) { if (!r.etf && r.industry && !seen[r.industry]) { seen[r.industry] = 1; names.push(r.industry); } });
    names.sort(function (a, b) { return a.localeCompare(b, "zh-Hant"); });
    var sel = $("industry");
    names.forEach(function (n) { var o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });
  }
  $("q").addEventListener("input", function () { state.q = this.value.trim(); state.shown = PAGE; body(); });
  $("search").addEventListener("submit", function (e) {
    e.preventDefault();
    var rows = filtered().filter(function (r) { return r.page; });
    if (rows.length === 1) location.href = "../stock/index.html?id=" + encodeURIComponent(rows[0].id);
  });
  window.addEventListener("storage", function (e) { if (e.key === WATCH_KEY) { watch = loadWatch(); body(); } });

  fetch("../stock/data/rank.json" + V).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (d) {
    state.rows = d.rows.map(function (a) {
      var o = {}; d.cols.forEach(function (c, i) { o[c] = a[i]; });
      /* a column the file lacks (an older build) reads as unknown, not NaN */
      COLS.forEach(function (c) { if (o[c[0]] === undefined) o[c[0]] = null; });
      o.etf = o.etf === 1; o.page = o.page === 1;
      return o;
    });
    $("r-eyebrow").textContent = "排行 · 資料截至 " + d.as_of + (d.holdings_as_of ? " · 外資持股截至 " + d.holdings_as_of : "") + (d.margin_as_of ? " · 融資截至 " + d.margin_as_of : "");
    var params = new URLSearchParams(location.search);
    var sc = SCOPES.map(function (s) { return s[1]; }).indexOf(params.get("scope") || "");
    if (sc >= 0) state.scope = sc;
    if (params.get("view") === "industry") state.view = 1;
    segmented($("scope"), SCOPES, state.scope, pickScope);
    segmented($("kind"), KINDS, state.kind, pickKind);
    segmented($("view"), VIEWS, state.view, pickView);
    industries();
    var ind = params.get("industry");
    if (ind && [].some.call($("industry").options, function (o) { return o.value === ind; })) {
      state.industry = ind; $("industry").value = ind;
    }
    render();
  }).catch(function () {
    $("r-count").textContent = "排行資料載入失敗，請稍後重新整理。";
  });

  /* shared chrome: sidebar sheet and theme */
  function side(open) {
    document.body.classList.toggle("nav-open", open);
    var o = document.querySelector(".side-open"); if (o) o.setAttribute("aria-expanded", String(open));
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-action]"); if (!a) return;
    var act = a.getAttribute("data-action");
    if (act === "side-open") side(true);
    else if (act === "side-close") side(false);
    else if (act === "theme") {
      var r = document.documentElement, cur = r.getAttribute("data-theme");
      var dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches, next = dark ? "light" : "dark";
      r.setAttribute("data-theme", next); try { localStorage.setItem("theme", next); } catch (err) {}
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") side(false); });
})();
