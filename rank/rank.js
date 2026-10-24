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
  /* valuation presets (stock view only): label, URL value, column, "min" or "max", threshold.
     A blank value (loss-making company, ETF, not yet published) never passes a preset. */
  var VAL_DY_MIN = 5;
  var VAL_PB_MAX = 1;
  var VAL_PE_MAX = 12;
  var VALS = [
    ["全部", "", null, null, null],
    ["殖利率 ≥ " + VAL_DY_MIN + "%", "dy" + VAL_DY_MIN, "dy", "min", VAL_DY_MIN],
    ["淨值比 ≤ " + VAL_PB_MAX, "pb" + VAL_PB_MAX, "pb", "max", VAL_PB_MAX],
    ["本益比 ≤ " + VAL_PE_MAX, "pe" + VAL_PE_MAX, "pe", "max", VAL_PE_MAX]
  ];
  /* lending presets (stock view only): label, URL value, test. sb is the lending short balance
     as a percent of issued shares, sq its percentile among common stocks (both built at build
     time, research/site/sbldata.py); ETFs and stocks outside the lending table have neither and
     never pass a preset. 前 10% means the 90th percentile or above. */
  var SBL_MIN_PCT = 5;
  var SBL_TOP_PCTILE = 90;
  var SBLS = [
    ["借券不限", "", null],
    ["借券占比 ≥ " + SBL_MIN_PCT + "%", String(SBL_MIN_PCT), function (r) { return r.sb >= SBL_MIN_PCT; }],
    ["借券占比前 " + (100 - SBL_TOP_PCTILE) + "%", "top" + (100 - SBL_TOP_PCTILE), function (r) { return r.sq >= SBL_TOP_PCTILE; }]
  ];
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
    ["sb", "借券占比(%)", 2, false],
    ["close", "收盤", 2, false],
    ["pe", "本益比", 2, false],
    ["dy", "殖利率(%)", 2, false],
    ["pb", "股價淨值比", 2, false]
  ];
  /* column definitions: keys, term, text. They are listed in 欄位說明 under the table, so touch
     and keyboard readers reach them, and each header button points at its definition with
     aria-describedby and keeps it as a hover title. The ratios are left blank unless the
     exchanges published them for the ranking's own day, so a stale file never shows. */
  var VALUATION_HINT = "證交所、櫃買中心當日公布；無資料時顯示 —（虧損公司無本益比、ETF 不適用、當日尚未公布）";
  var DEFS = [
    [["fy"], "外資(億)", "外資淨買賣股數乘當日收盤的估計，與交易所公布的金額會有小差距。"],
    [["chg"], "漲跌", "依交易所公布的漲跌價差計算的漲跌幅；交易所標示不比價（多為除權息當日）時顯示「不比價」。"],
    [["f5"], "外資 5 日(張)", "最近 5 個交易日外資買賣超的合計。"],
    [["streak"], "連買賣", "外資淨買超（或淨賣超）連續的交易日數，到最新一日為止。"],
    [["hp", "hw"], "外資持股(%)、持股 5 日", "交易所公布的外資及陸資持股比率，以及與 5 個交易日前相差的百分點；晚上才公布，資料日與排行不同時頁首另外標出。"],
    [["mc", "sr"], "融資增減、券資比", "當日融資餘額減前一日（張）；券資比是融券餘額除以融資餘額。晚上才公布，資料日與排行不同時頁首另外標出。"],
    [["sb"], "借券占比(%)", "借券賣出餘額占發行股數（交易所晚上公布，通常比排行晚一天）；ETF 不計算，不在借券賣出表的股票顯示 —"],
    [["pe", "dy", "pb"], "本益比、殖利率、股價淨值比", VALUATION_HINT]
  ];
  /* the industry view adds up today's common stocks (no ETFs) in the chosen market */
  var IDEFS = [
    [["fy", "ty"], "外資(億)、投信(億)", "產業內普通股外資、投信淨買賣股數乘當日收盤的合計，是估計值；不含 ETF。"],
    [["chg"], "平均漲跌", "產業內普通股漲跌幅的等權平均，不比價的股票不計。"],
    [["n", "up", "down"], "家數、上漲、下跌", "產業內普通股的家數，以及其中上漲、下跌的家數。"],
    [["mc"], "融資增減(張)", "產業內普通股融資餘額增減的合計。"]
  ];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
  /* data files carry the build stamp so a reload shows new data even while GitHub Pages
     still serves the cached page for up to ten minutes */
  var buildMeta = document.querySelector('meta[name="build"]');
  var V = buildMeta && buildMeta.content ? "?v=" + encodeURIComponent(buildMeta.content) : "";
  var $ = function (id) { return document.getElementById(id); };
  var state = { rows: [], scope: 0, kind: 0, val: 0, sbl: 0, sort: "fy", dir: -1, shown: PAGE, q: "", industry: "", view: 0, isort: "fy", idir: -1 };

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
    if (col[0] === "sb" && row.sq !== null && row.sq !== undefined) td.title = "普通股第 " + row.sq + " 百分位";
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

  function passesVal(row, preset) {
    if (!preset[2]) return true;
    var v = row[preset[2]];
    if (v === null || v === undefined) return false;
    return preset[3] === "min" ? v >= preset[4] : v <= preset[4];
  }

  function passesSbl(row, preset) {
    if (!preset[2]) return true;
    if (row.etf || row.sb === null || row.sb === undefined || row.sq === null || row.sq === undefined) return false;
    return preset[2](row);
  }

  function filtered() {
    var scope = SCOPES[state.scope][1], etf = KINDS[state.kind][1], q = state.q, val = VALS[state.val], sbl = SBLS[state.sbl];
    return state.rows.filter(function (r) {
      if (scope === "watch") { if (watch.indexOf(r.id) < 0) return false; }
      else if (scope !== "all" && r.market !== scope) return false;
      if (scope !== "watch" && r.etf !== etf) return false;
      if (state.industry && r.industry !== state.industry) return false;
      if (!passesVal(r, val)) return false;
      if (!passesSbl(r, sbl)) return false;
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
      describe(b, c[0], IDEFS);
      th.appendChild(b); tr.appendChild(th);
    });
  }

  /* 欄位說明 for the current view; ids are per view, so headers are linked after each render */
  function renderDefs(defs) {
    var dl = $("r-defs"); dl.innerHTML = "";
    defs.forEach(function (d, i) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = d[1]; dd.textContent = d[2]; dd.id = "r-def-" + i;
      dl.appendChild(dt); dl.appendChild(dd);
    });
    $("r-notes").hidden = false;
  }
  function describe(button, key, defs) {
    for (var i = 0; i < defs.length; i++) {
      if (defs[i][0].indexOf(key) >= 0) { button.setAttribute("aria-describedby", "r-def-" + i); button.title = defs[i][2]; return; }
    }
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

  /* keep the address shareable: every filter is a parameter in a fixed order, defaults are
     left out, and parameters this page does not own are kept */
  function syncUrl() {
    var p = new URLSearchParams(location.search), own = [
      ["view", industryView() ? "industry" : ""],
      ["scope", state.scope ? SCOPES[state.scope][1] : ""],
      ["kind", KINDS[state.kind][1] ? "etf" : ""],
      ["industry", state.industry],
      ["val", VALS[state.val][1]],
      ["sbl", SBLS[state.sbl][1]]
    ];
    own.forEach(function (kv) { p.delete(kv[0]); });
    own.forEach(function (kv) { if (kv[1]) p.append(kv[0], kv[1]); });
    var qs = p.toString(), url = location.pathname + (qs ? "?" + qs : "") + location.hash;
    if (url === location.pathname + location.search + location.hash) return;
    try { history.replaceState(history.state, "", url); } catch (e) {}
  }

  function render() {
    var ind = industryView();
    $("kind").hidden = ind || SCOPES[state.scope][1] === "watch";
    $("industry-wrap").hidden = ind;
    $("val").hidden = ind;
    $("sbl").hidden = ind;
    syncUrl();
    renderDefs(ind ? IDEFS : DEFS);
    if (ind) { industryHead(); industryBody(); } else { head(); body(); }
  }

  function head() {
    var tr = $("r-head"); tr.innerHTML = "";
    COLS.forEach(function (c) {
      var th = document.createElement("th"); th.scope = "col";
      if (state.sort === c[0]) th.setAttribute("aria-sort", state.dir < 0 ? "descending" : "ascending");
      var b = document.createElement("button"); b.type = "button"; b.className = "sort"; b.textContent = c[1];
      b.setAttribute("data-key", c[0]);
      describe(b, c[0], DEFS);
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
        : (state.val || state.sbl) && scope !== "watch" && KINDS[state.kind][1]
          ? "ETF 沒有本益比、殖利率、淨值比與借券占比，估值與借券篩選只適用於股票。"
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

  function segmented(container, items, active, onPick, hint) {
    container.innerHTML = "";
    items.forEach(function (item, i) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = item[0];
      b.setAttribute("aria-pressed", String(i === active));
      if (hint) { var h = hint(item); if (h) b.title = h; }
      b.addEventListener("click", function () { onPick(i); });
      container.appendChild(b);
    });
  }
  function valHint(preset) {
    if (!preset[2]) return "不篩選估值";
    return "只列出" + preset[0] + " 的股票；無資料者（" + (preset[2] === "pe" ? "虧損、" : "") + "ETF、當日未公布）不列入";
  }
  function pickScope(i) { state.scope = i; state.shown = PAGE; segmented($("scope"), SCOPES, i, pickScope); render(); }
  function pickView(i) { state.view = i; segmented($("view"), VIEWS, i, pickView); render(); }
  function pickKind(i) { state.kind = i; state.shown = PAGE; segmented($("kind"), KINDS, i, pickKind); render(); }
  function pickVal(i) { state.val = i; state.shown = PAGE; segmented($("val"), VALS, i, pickVal, valHint); render(); }
  function sblHint(preset) {
    if (!preset[2]) return "不篩選借券占比";
    return "只列出借券賣出餘額占發行股數" + (preset[1] === String(SBL_MIN_PCT) ? " ≥ " + SBL_MIN_PCT + "%"
      : "在普通股中第 " + SBL_TOP_PCTILE + " 百分位以上") + " 的股票；ETF 與無資料者不列入";
  }
  function pickSbl(i) { state.sbl = i; state.shown = PAGE; segmented($("sbl"), SBLS, i, pickSbl, sblHint); render(); }

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
  $("industry").addEventListener("change", function () { state.industry = this.value; state.shown = PAGE; render(); });
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

  /* rank.json stores its rows by column (research/site/packing.py); rebuild them */
  function unpackTable(cols) {
    return cols.length ? cols[0].map(function (x, i) { return cols.map(function (c) { return c[i]; }); }) : [];
  }
  fetch("../stock/data/rank.json" + V).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (d) {
    if (d.columns) d.rows = unpackTable(d.columns);
    state.rows = d.rows.map(function (a) {
      var o = {}; d.cols.forEach(function (c, i) { o[c] = a[i]; });
      /* a column the file lacks (an older build) reads as unknown, not NaN */
      COLS.forEach(function (c) { if (o[c[0]] === undefined) o[c[0]] = null; });
      if (o.sq === undefined) o.sq = null;
      o.etf = o.etf === 1; o.page = o.page === 1;
      return o;
    });
    /* one date when every dataset is current; a dataset that lags gets its own date. Each part
       stays on one line, so a phone never breaks a date at its hyphens. */
    var eb = $("r-eyebrow"), parts = ["排行", "資料截至 " + d.as_of];
    [["外資持股", d.holdings_as_of], ["融資", d.margin_as_of], ["借券", d.sbl_as_of]].forEach(function (x) {
      if (x[1] && x[1] !== d.as_of) parts.push(x[0] + "截至 " + x[1]);
    });
    eb.textContent = "";
    parts.forEach(function (t, i) {
      if (i) eb.appendChild(document.createTextNode(" · "));
      var s = document.createElement("span"); s.className = "nowrap"; s.textContent = t; eb.appendChild(s);
    });
    if (d.sbl_as_of) DEFS.forEach(function (x) { if (x[0][0] === "sb") x[2] = "資料日 " + d.sbl_as_of + "：" + x[2]; });
    var params = new URLSearchParams(location.search);
    var sc = SCOPES.map(function (s) { return s[1]; }).indexOf(params.get("scope") || "");
    if (sc >= 0) state.scope = sc;
    if (params.get("view") === "industry") state.view = 1;
    if (params.get("kind") === "etf") state.kind = 1;
    var vi = params.get("val") ? VALS.map(function (v) { return v[1]; }).indexOf(params.get("val")) : -1;
    if (vi > 0) state.val = vi;
    var si = params.get("sbl") ? SBLS.map(function (v) { return v[1]; }).indexOf(params.get("sbl")) : -1;
    if (si > 0) state.sbl = si;
    segmented($("scope"), SCOPES, state.scope, pickScope);
    segmented($("kind"), KINDS, state.kind, pickKind);
    segmented($("view"), VIEWS, state.view, pickView);
    segmented($("val"), VALS, state.val, pickVal, valHint);
    segmented($("sbl"), SBLS, state.sbl, pickSbl, sblHint);
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
