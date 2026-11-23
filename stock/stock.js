/* Stock page: loads data/<id>.json and draws an Apple Stocks style chart with plain SVG.
   Red is up and green is down (Taiwan convention). No external libraries. */
(function () {
  "use strict";
  var RANGES = [["1 個月", 21], ["3 個月", 63], ["6 個月", 126], ["1 年", 250], ["2 年", 500]];
  var KINDS = [["外資", 1], ["投信", 2], ["自營商", 3]];
  var FLOW_DAYS = 60, H = 280, VOL_H = 44, PAD_R = 56, PAD_T = 12, PAD_B = 22;
  var NS = "http://www.w3.org/2000/svg";
  var MAS = [[20, "ma20", "月線"], [60, "ma60", "季線"]];
  var state = { data: null, range: 2, kind: 0, ma: true, vkind: null };
  try { state.ma = localStorage.getItem("ma") !== "off"; } catch (e) {}
  /* data files carry the build stamp so a reload shows new data even while GitHub Pages
     still serves the cached page for up to ten minutes */
  var buildMeta = document.querySelector('meta[name="build"]');
  var V = buildMeta && buildMeta.content ? "?v=" + encodeURIComponent(buildMeta.content) : "";
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var id = (params.get("id") || "2330").trim();

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmt(v, d) { return Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function signed(v, d) { var r = Number(Number(v).toFixed(d)), s = fmt(Math.abs(r), d); return r > 0 ? "+" + s : r < 0 ? "−" + s : s; }
  function cls(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }
  function md(date) { return Number(date.slice(5, 7)) + "/" + Number(date.slice(8, 10)); }
  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function decimals(step) {
    var dp = 0;
    while (dp < 3 && Math.abs(Math.round(step * Math.pow(10, dp)) - step * Math.pow(10, dp)) > 1e-9) dp++;
    return dp;
  }
  function weekday(date) { return new Date(date + "T00:00:00Z").getUTCDay(); }
  /* Axis labels: week starts for one month, otherwise every Nth month (January shows the year). */
  function xLabels(bars, x, plotW) {
    var out = [], edge = 20, short = bars.length <= 25;
    var perMonth = plotW / Math.max(1, bars.length / 21);
    var stride = [1, 2, 3, 6, 12].filter(function (s) { return perMonth * s >= 52; })[0] || 12;
    for (var i = 1; i < bars.length; i++) {
      var d = bars[i][0], p = bars[i - 1][0], label = null, mon = Number(d.slice(5, 7));
      if (short) { if (weekday(d) < weekday(p)) label = md(d); }
      else if (d.slice(0, 7) !== p.slice(0, 7) && (mon - 1) % stride === 0) {
        label = mon === 1 ? d.slice(0, 4) + " 年" : mon + " 月";
      }
      if (label && x(i) > edge && x(i) < plotW - edge) out.push([x(i), label]);
    }
    return out;
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

  /* Keyboard alternative to scrubbing a chart (WCAG 2.1.1): a focused chart steps one point with
     the arrow keys (ten with Shift), Home and End jump to the ends, and Escape or moving focus away
     restores the summary. The pointer handler gets the matching position, so both paths show the
     same readout, and the readout text goes to one polite live region for screen readers.
     xOf(i) is the chart's own x of point i in viewBox units; n < 2 turns the keys off. */
  var live = null;
  function keyScrub(svg, n, xOf, at, leave, readout) {
    svg.onkeydown = svg.onblur = null;
    if (n < 2) { svg.removeAttribute("tabindex"); svg.removeAttribute("aria-describedby"); return; }
    if (!live) {
      live = document.createElement("p"); live.className = "vh"; live.setAttribute("aria-live", "polite");
      document.body.appendChild(live);
      var keys = document.createElement("p"); keys.className = "vh"; keys.id = "scrub-keys";
      keys.textContent = "按左右方向鍵逐日查看，加 Shift 一次十日，Home、End 跳到頭尾，Esc 回到摘要。";
      document.body.appendChild(keys);
    }
    svg.setAttribute("tabindex", "0"); svg.setAttribute("aria-describedby", "scrub-keys");
    var cur = null;
    svg.onkeydown = function (e) {
      var step = e.shiftKey ? 10 : 1, next = null;
      if (e.key === "ArrowLeft") next = cur === null ? n - 1 : cur - step;
      else if (e.key === "ArrowRight") next = cur === null ? n - 1 : cur + step;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      else if (e.key === "Escape" && cur !== null) { cur = null; leave(); e.stopPropagation(); return; }
      if (next === null) return;
      e.preventDefault();
      cur = Math.min(Math.max(next, 0), n - 1);
      var r = svg.getBoundingClientRect(), w = svg.viewBox.baseVal.width || r.width;
      at({ clientX: r.left + xOf(cur) / w * r.width });
      live.textContent = typeof readout === "function" ? readout() : readout.textContent;
    };
    svg.onblur = function () { if (cur !== null) { cur = null; leave(); } };
  }

  function header(bar, base, scrubbing, maVals) {
    var price = bar[4], chg = price - base[4], pct = base[4] ? chg / base[4] : 0;
    $("s-price").textContent = fmt(price, 2);
    var c = $("s-chg");
    c.textContent = signed(chg, 2) + "（" + signed(pct * 100, 2) + "%）";
    c.className = "quote-chg " + cls(chg);
    $("s-meta").textContent = scrubbing
      ? bar[0] + "　開 " + fmt(bar[1], 2) + "　高 " + fmt(bar[2], 2) + "　低 " + fmt(bar[3], 2) + "　量 " + fmt(bar[5], 0) + " 張" +
        (maVals || []).map(function (v, m) { return v === null ? "" : "　" + MAS[m][2] + " " + fmt(v, 2); }).join("")
      : (state.data.listed && base[0] === state.data.bars[0][0]
          ? state.data.listed + " 掛牌首日收盤以來漲跌" + (state.data.industry === "ETF" ? "" : "（興櫃期間不列入）")
          : RANGES[state.range][0] + "漲跌") + "，資料截至 " + state.data.updated;
  }

  /* moving average of closes, null until n bars exist; computed on the full history */
  function movingAvg(all, n) {
    var out = [], sum = 0;
    for (var i = 0; i < all.length; i++) {
      sum += all[i][4];
      if (i >= n) sum -= all[i - n][4];
      out.push(i >= n - 1 ? sum / n : null);
    }
    return out;
  }

  function drawPrice() {
    var svg = $("chart"), all = state.data.bars, bars = all.slice(-RANGES[state.range][1]);
    var off = all.length - bars.length;
    var mas = state.ma ? MAS.map(function (m) { return movingAvg(all, m[0]).slice(off); }) : [];
    var W = Math.max(320, svg.parentNode.clientWidth || 640);
    /* a lane for the event markers under the volume bars, kept in every range for a steady layout */
    var lane = reactRows().length ? MARK_LANE : 0, TH = H + lane;
    svg.setAttribute("viewBox", "0 0 " + W + " " + TH);
    svg.innerHTML = "";
    if (bars.length < 2) {  /* a stock on its listing day has one bar: the quote, no chart */
      if (bars.length) header(bars[0], bars[0], false);
      eventReadout(null); keyScrub(svg, 0); return;
    }
    var lo = Infinity, hi = -Infinity, vmax = 0;
    bars.forEach(function (b) { lo = Math.min(lo, b[3]); hi = Math.max(hi, b[2]); vmax = Math.max(vmax, b[5]); });
    mas.forEach(function (s) { s.forEach(function (v) { if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    var pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    var plotW = W - PAD_R, plotH = H - PAD_T - PAD_B - VOL_H;
    var x = function (i) { return (i / (bars.length - 1)) * plotW; };
    var y = function (v) { return PAD_T + (hi - v) / (hi - lo) * plotH; };
    var dir = cls(bars[bars.length - 1][4] - bars[0][4]) || "flat";
    var step = niceStep(hi - lo, 4), dp = decimals(step);
    for (var k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) {
      var gy = y(k * step);
      el("line", { x1: 0, x2: plotW, y1: gy, y2: gy, "class": "grid" }, svg);
      el("text", { x: W - 4, y: gy + 4, "text-anchor": "end", "class": "tick" }, svg).textContent = fmt(k * step, dp);
    }
    var vy0 = H - PAD_B, vh = VOL_H - 6, bw = Math.max(1, plotW / bars.length - 1);
    bars.forEach(function (b, i) {
      var h = vmax ? b[5] / vmax * vh : 0;
      el("rect", { x: x(i) - bw / 2, y: vy0 - h, width: bw, height: h, "class": "vol" }, svg);
    });
    var line = bars.map(function (b, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(b[4]).toFixed(1); }).join("");
    el("path", { d: line + "L" + plotW + "," + (PAD_T + plotH) + "L0," + (PAD_T + plotH) + "Z", "class": "area " + dir }, svg);
    mas.forEach(function (s, m) {
      var d = "", pen = "M";
      s.forEach(function (v, i) {
        if (v === null) { pen = "M"; return; }
        d += pen + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = "L";
      });
      if (d) el("path", { d: d, "class": "ma " + MAS[m][1] }, svg);
    });
    el("path", { d: line, "class": "line " + dir }, svg);
    xLabels(bars, x, plotW).forEach(function (t) {
      el("text", { x: t[0], y: TH - 4, "text-anchor": "middle", "class": "tick" }, svg).textContent = t[1];
    });
    var groups = lane ? drawMarks(svg, bars, x, plotW, H - PAD_B + lane / 2) : [], lit = null;
    var cursor = el("line", { x1: 0, x2: 0, y1: PAD_T, y2: TH - PAD_B, "class": "cursor", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot " + dir, visibility: "hidden" }, svg);
    /* the marker group nearest the cursor, if it is within SNAP_PX */
    function near(i) {
      var best = null;
      groups.forEach(function (g) { if (Math.abs(g.x - x(i)) <= SNAP_PX && (!best || Math.abs(g.x - x(i)) < Math.abs(best.x - x(i)))) best = g; });
      return best;
    }
    function light(g) {
      if (lit === g) return;
      if (lit) lit.nodes.forEach(function (n) { n.classList.remove("on"); });
      if (g) g.nodes.forEach(function (n) { n.classList.add("on"); });
      lit = g; eventReadout(g ? g.rows : null);
    }
    svg.setAttribute("aria-label", "股價走勢，" + RANGES[state.range][0] + "：" + fmt(bars[0][4], 2) + " 到 " + fmt(bars[bars.length - 1][4], 2));
    function at(evt) {
      var r = svg.getBoundingClientRect(), px = (evt.clientX - r.left) / r.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (bars.length - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(bars[i][4])); dot.setAttribute("visibility", "visible");
      header(bars[i], bars[0], true, mas.map(function (s) { return s[i]; }));
      light(near(i));
    }
    function leave() {
      cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
      header(bars[bars.length - 1], bars[0], false);
      lit = null; groups.forEach(function (g) { g.nodes.forEach(function (n) { n.classList.remove("on"); }); });
      eventReadout(null, groups);
    }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave; svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, bars.length, x, at, leave, function () {
      var e = $("e-readout"), lit = e.querySelector(".react-ev") ? " " + e.textContent : "";
      return $("s-price").textContent + " " + $("s-chg").textContent + " " + $("s-meta").textContent + lit;
    });
    leave();
    /* phones wrap the scrubbing line (date, open, high, low, volume, averages) to three lines;
       reserve that height up front, so the chart under the finger never moves */
    var meta = $("s-meta"), lastBar = bars.length - 1;
    meta.style.minHeight = "";
    header(bars[lastBar], bars[0], true, mas.map(function (s) { return s[lastBar]; }));
    meta.style.minHeight = meta.offsetHeight + "px";
    header(bars[lastBar], bars[0], false);
  }

  function drawFlows() {
    var svg = $("flows"), rows = state.data.flows.slice(-FLOW_DAYS), k = KINDS[state.kind][1];
    var W = Math.max(320, svg.parentNode.clientWidth || 640), FH = 180, top = 16, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + FH);
    svg.innerHTML = "";
    if (!rows.length) return;
    var m = 0; rows.forEach(function (r) { m = Math.max(m, Math.abs(r[k])); }); m = m || 1;
    var zero = top + (FH - top - bottom) / 2, half = (FH - top - bottom) / 2, slot = W / rows.length;
    var bw = Math.min(10, slot * 0.7), name = KINDS[state.kind][0];
    var hover = el("rect", { x: 0, y: top, width: slot, height: FH - top - bottom, rx: 2, "class": "hover-band", visibility: "hidden" }, svg);
    el("line", { x1: 0, x2: W, y1: zero, y2: zero, "class": "axis" }, svg);
    rows.forEach(function (r, i) {
      var h = Math.abs(r[k]) / m * half, x0 = i * slot + (slot - bw) / 2;
      if (!h) return;
      el("rect", { x: x0, y: r[k] > 0 ? zero - h : zero, width: bw, height: h, rx: 1.5, "class": "bar " + (r[k] > 0 ? "pos" : "neg") }, svg);
    });
    el("text", { x: 0, y: FH - 4, "class": "tick" }, svg).textContent = md(rows[0][0]);
    el("text", { x: W, y: FH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = md(rows[rows.length - 1][0]);
    var sum = rows.reduce(function (a, r) { return a + r[k]; }, 0);
    svg.setAttribute("aria-label", name + " 近 " + rows.length + " 日累計 " + signed(sum, 0) + " 張");
    function readout(label, v) {
      var p = $("f-readout"), s = document.createElement("span");
      p.textContent = label + " "; s.className = cls(v); s.textContent = signed(v, 0) + " 張"; p.appendChild(s);
    }
    function at(evt) {
      var r = svg.getBoundingClientRect(), i = Math.floor((evt.clientX - r.left) / r.width * W / slot);
      i = Math.min(Math.max(i, 0), rows.length - 1);
      hover.setAttribute("x", i * slot); hover.setAttribute("visibility", "visible");
      readout(md(rows[i][0]) + " " + name, rows[i][k]);
    }
    function leave() {
      hover.setAttribute("visibility", "hidden");
      readout(name + "近 " + rows.length + " 日累計", sum);
    }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, rows.length, function (i) { return (i + 0.5) * slot; }, at, leave, $("f-readout"));
    leave();
  }

  /* monthly revenue as published: bars in thousands of NT$, readout with year-over-year growth */
  function ym(p) { return p.slice(0, 4) + "/" + Number(p.slice(5, 7)); }
  function revText(k) {
    var v = k * 1000;
    return Math.abs(v) >= 1e8 ? fmt(v / 1e8, 2) + " 億" : fmt(v / 1e4, 0) + " 萬";
  }
  function drawRevenue() {
    var rows = state.data.revenue || [], sec = $("r-sec"), svg = $("rev");
    sec.hidden = rows.length < 2;
    if (sec.hidden) return;
    var W = Math.max(320, svg.parentNode.clientWidth || 640), RH = 160, top = 12, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + RH);
    svg.innerHTML = "";
    var m = 0; rows.forEach(function (r) { m = Math.max(m, r[1]); }); m = m || 1;
    var base = RH - bottom, span = RH - top - bottom, slot = W / rows.length, bw = Math.min(18, slot * 0.7);
    var hover = el("rect", { x: 0, y: top, width: slot, height: span, rx: 2, "class": "hover-band", visibility: "hidden" }, svg);
    el("line", { x1: 0, x2: W, y1: base, y2: base, "class": "axis" }, svg);
    rows.forEach(function (r, i) {
      var h = Math.max(0, r[1]) / m * span;
      if (h) el("rect", { x: i * slot + (slot - bw) / 2, y: base - h, width: bw, height: h, rx: 1.5, "class": "bar rev" }, svg);
    });
    el("text", { x: 0, y: RH - 4, "class": "tick" }, svg).textContent = ym(rows[0][0]);
    el("text", { x: W, y: RH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = ym(rows[rows.length - 1][0]);
    var last = rows[rows.length - 1];
    svg.setAttribute("aria-label", "月營收，最新 " + ym(last[0]) + " " + revText(last[1]));
    /* FinMind store rows carry the real announcement day; rows fetched day by day from FinMind
       (finmind_daily) or taken from the exchanges' lists (exchange) carry the day this site first
       saw them (research/data/revenue_daily.py), which can be later than the announcement */
    var src = state.data.revenue_source, seen = src === "exchange" || src === "finmind_daily";
    $("r-sub").textContent = "上市櫃公司每月 10 日前公布前一個月營收。最新一期 " + ym(last[0]) +
      (src === "exchange" ? "，取自交易所彙總表" : "") +
      (seen ? "，本站取得於 " : "，公布於 ") + state.data.revenue_available + "。";
    function readout(r) {
      var p = $("r-readout");
      p.textContent = ym(r[0]) + " 營收 " + revText(r[1]);
      if (r[2] !== null) {
        var s = document.createElement("span");
        p.appendChild(document.createTextNode("，年增 "));
        s.className = cls(r[2]); s.textContent = signed(r[2] * 100, 1) + "%"; p.appendChild(s);
      }
    }
    function at(evt) {
      var b = svg.getBoundingClientRect(), i = Math.floor((evt.clientX - b.left) / b.width * W / slot);
      i = Math.min(Math.max(i, 0), rows.length - 1);
      hover.setAttribute("x", i * slot); hover.setAttribute("visibility", "visible");
      readout(rows[i]);
    }
    function leave() { hover.setAttribute("visibility", "hidden"); readout(last); }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, rows.length, function (i) { return (i + 0.5) * slot; }, at, leave, $("r-readout"));
    leave();
  }

  /* valuation as the exchanges publish it on each close, one ratio at a time: the dashed line
     is the look-back median and the readout gives today's percentile (both built at build time) */
  var VKINDS = [["本益比", 1, "pe", " 倍"], ["股價淨值比", 2, "pb", " 倍"], ["殖利率", 3, "dy", "%"]];
  var VAL_H = 160, VAL_MIN_POINTS = 2, PE_COL = 1, LOOKBACK_YEARS = 5, LOOKBACK_SLACK_DAYS = 31, DAY_MS = 864e5;
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function ymd(date) { return date.slice(0, 4) + "/" + md(date); }
  /* [date, pe, pb, dy] rows inside the price chart's window; malformed entries are skipped */
  function valRows() {
    var d = state.data, rows = Array.isArray(d.valuation) ? d.valuation : [], bars = d.bars;
    if (!bars.length) return [];
    var first = bars[0][0], last = bars[bars.length - 1][0];
    return rows.filter(function (r) {
      return Array.isArray(r) && r.length > 3 && typeof r[0] === "string" && r[0] >= first && r[0] <= last;
    });
  }
  function countPoints(rows, k) { return rows.reduce(function (a, r) { return a + (isNum(r[k]) ? 1 : 0); }, 0); }
  /* "近 5 年" when the statistics span five years, otherwise when they start */
  function lookback(st) {
    if (!st || typeof st.since !== "string" || typeof st.as_of !== "string") return "";
    var span = (Date.parse(st.as_of) - Date.parse(st.since)) / DAY_MS;
    return span >= LOOKBACK_YEARS * 365 - LOOKBACK_SLACK_DAYS ? "近 " + LOOKBACK_YEARS + " 年" : "自 " + ym(st.since) + " 起";
  }
  function pickVKind(i) { state.vkind = i; drawValuation(); }
  function drawValuation() {
    var rows = valRows(), sec = $("v-sec"), svg = $("val"), p = $("v-readout");
    var usable = VKINDS.map(function (v) { return countPoints(rows, v[1]) >= VAL_MIN_POINTS; });
    sec.hidden = usable.indexOf(true) < 0;
    if (sec.hidden) return;
    if (state.vkind === null) state.vkind = usable.indexOf(true);
    segmented($("v-kinds"), VKINDS, state.vkind, pickVKind);
    var kind = VKINDS[state.vkind], k = kind[1], name = kind[0], unit = kind[3];
    var st = state.data.valuation_stats || null, ks = st && st[kind[2]] ? st[kind[2]] : null;
    var span = lookback(st), n = rows.length, med = ks && isNum(ks.median) ? ks.median : null;
    $("v-sub").textContent = "交易所每日依收盤價公布的本益比、股價淨值比與殖利率。" +
      (span ? "虛線是" + span + "的中位數，百分位表示" + span + "有多少比例的交易日低於目前數值。" : "") +
      "在圖上滑動或用方向鍵可查看每日數值。";
    var W = Math.max(320, svg.parentNode.clientWidth || 640), top = 12, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + VAL_H);
    svg.innerHTML = "";
    svg.onpointermove = svg.onpointerdown = svg.onpointerleave = svg.onpointerup = null;
    keyScrub(svg, 0);
    var blank = "交易所未公布" + name + (k === PE_COL ? "，通常是近四季虧損" : "");
    if (!usable[state.vkind]) {
      p.textContent = "圖表期間" + blank + "。";
      svg.setAttribute("aria-label", name + "無資料");
      return;
    }
    var lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) { if (isNum(r[k])) { lo = Math.min(lo, r[k]); hi = Math.max(hi, r[k]); } });
    if (med !== null) { lo = Math.min(lo, med); hi = Math.max(hi, med); }
    var pad = (hi - lo) * 0.15 || Math.max(0.1, hi * 0.05); lo = Math.max(0, lo - pad); hi += pad;
    var plotW = W - PAD_R, plotH = VAL_H - top - bottom;
    var x = function (i) { return i / (n - 1) * plotW; };
    var y = function (v) { return top + (hi - v) / (hi - lo) * plotH; };
    var step = niceStep(hi - lo, 3), dp = decimals(step), tickUnit = unit === "%" ? "%" : "";
    for (var g = Math.ceil(lo / step); g * step <= hi + 1e-9; g++) {
      var gy = y(g * step);
      el("line", { x1: 0, x2: plotW, y1: gy, y2: gy, "class": "grid" }, svg);
      el("text", { x: W - 4, y: gy + 4, "text-anchor": "end", "class": "tick" }, svg).textContent = fmt(g * step, dp) + tickUnit;
    }
    if (med !== null) el("line", { x1: 0, x2: plotW, y1: y(med), y2: y(med), "class": "ma ma60" }, svg);
    var d = "", pen = "M";
    rows.forEach(function (r, i) {
      if (!isNum(r[k])) { pen = "M"; return; }  /* a blank day breaks the line */
      d += pen + x(i).toFixed(1) + "," + y(r[k]).toFixed(1); pen = "L";
    });
    el("path", { d: d, "class": "line hold" }, svg);
    xLabels(rows, x, plotW).forEach(function (t) {
      el("text", { x: t[0], y: VAL_H - 4, "text-anchor": "middle", "class": "tick" }, svg).textContent = t[1];
    });
    var cursor = el("line", { x1: 0, x2: 0, y1: top, y2: VAL_H - bottom, "class": "cursor", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot hold", visibility: "hidden" }, svg);
    var last = rows[n - 1];
    function val(v) { return fmt(v, 2) + unit; }
    svg.setAttribute("aria-label", name + "走勢 " + ymd(rows[0][0]) + " 到 " + ymd(last[0]) +
      (isNum(last[k]) ? "，最新 " + val(last[k]) : "") + (med !== null ? "，" + span + "中位數 " + val(med) : ""));
    function readout(i) {
      var r = i === null ? last : rows[i];
      if (!isNum(r[k])) {
        p.textContent = ymd(r[0]) + " " + blank + (i === null && med !== null ? "；" + span + "中位數 " + val(med) : "");
        return;
      }
      var text = ymd(r[0]) + " " + name + " " + val(r[k]);
      if (i === null) {
        text += ks && isNum(ks.percentile) && med !== null
          ? "，" + span + "第 " + ks.percentile + " 百分位（中位數 " + val(med) + "）"
          : "，歷史資料累積中，暫不計算百分位";
      }
      p.textContent = text;
    }
    function at(evt) {
      var b = svg.getBoundingClientRect(), px = (evt.clientX - b.left) / b.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (n - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      if (isNum(rows[i][k])) {
        dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(rows[i][k])); dot.setAttribute("visibility", "visible");
      } else dot.setAttribute("visibility", "hidden");
      readout(i);
    }
    function leave() {
      cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
      readout(null);
    }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, n, x, at, leave, p);
    leave();
  }

  function drawHoldings() {
    var rows = state.data.holdings || [], sec = $("h-sec"), svg = $("hold");
    sec.hidden = rows.length < 2;
    if (sec.hidden) return;
    var W = Math.max(320, svg.parentNode.clientWidth || 640), HH = 160, top = 12, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + HH);
    svg.innerHTML = "";
    var lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) { lo = Math.min(lo, r[1]); hi = Math.max(hi, r[1]); });
    var pad = (hi - lo) * 0.15 || 0.5; lo -= pad; hi += pad;
    var plotW = W - PAD_R, plotH = HH - top - bottom;
    var x = function (i) { return i / (rows.length - 1) * plotW; };
    var y = function (v) { return top + (hi - v) / (hi - lo) * plotH; };
    var step = niceStep(hi - lo, 3), dp = decimals(step);
    for (var k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) {
      var gy = y(k * step);
      el("line", { x1: 0, x2: plotW, y1: gy, y2: gy, "class": "grid" }, svg);
      el("text", { x: W - 4, y: gy + 4, "text-anchor": "end", "class": "tick" }, svg).textContent = fmt(k * step, dp) + "%";
    }
    var d = rows.map(function (r, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(r[1]).toFixed(1); }).join("");
    el("path", { d: d, "class": "line hold" }, svg);
    el("text", { x: 0, y: HH - 4, "class": "tick" }, svg).textContent = md(rows[0][0]);
    el("text", { x: plotW, y: HH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = md(rows[rows.length - 1][0]);
    var cursor = el("line", { x1: 0, x2: 0, y1: top, y2: HH - bottom, "class": "cursor", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot hold", visibility: "hidden" }, svg);
    var n = rows.length, last = rows[n - 1];
    svg.setAttribute("aria-label", "外資持股比率 " + md(rows[0][0]) + " " + fmt(rows[0][1], 2) + "% 到 " + md(last[0]) + " " + fmt(last[1], 2) + "%");
    function readout(r, lead) {
      var p = $("h-readout");
      p.textContent = md(r[0]) + " 外資持股 " + fmt(r[1], 2) + "%";
      if (lead && n > 5) {
        var chg = r[1] - rows[n - 6][1], s = document.createElement("span");
        p.appendChild(document.createTextNode("，5 日 "));
        s.className = cls(Number(chg.toFixed(2))); s.textContent = signed(chg, 2) + " 個百分點";
        p.appendChild(s);
      }
    }
    function at(evt) {
      var r = svg.getBoundingClientRect(), px = (evt.clientX - r.left) / r.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (n - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(rows[i][1])); dot.setAttribute("visibility", "visible");
      readout(rows[i], false);
    }
    function leave() {
      cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
      readout(last, true);
    }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, rows.length, x, at, leave, $("h-readout"));
    leave();
  }

  function drawMargin() {
    var rows = state.data.margin || [], sec = $("m-sec"), svg = $("marg");
    sec.hidden = rows.length < 2;
    if (sec.hidden) return;
    var W = Math.max(320, svg.parentNode.clientWidth || 640), HH = 160, top = 12, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + HH);
    svg.innerHTML = "";
    var lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) { lo = Math.min(lo, r[1]); hi = Math.max(hi, r[1]); });
    var pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.05); lo = Math.max(0, lo - pad); hi += pad;
    var plotW = W - PAD_R, plotH = HH - top - bottom, n = rows.length;
    var x = function (i) { return i / (n - 1) * plotW; };
    var y = function (v) { return top + (hi - v) / (hi - lo) * plotH; };
    var step = niceStep(hi - lo, 3), dp = Math.max(0, decimals(step));
    for (var k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) {
      var gy = y(k * step);
      el("line", { x1: 0, x2: plotW, y1: gy, y2: gy, "class": "grid" }, svg);
      el("text", { x: W - 4, y: gy + 4, "text-anchor": "end", "class": "tick" }, svg).textContent = fmt(k * step, dp);
    }
    var d = rows.map(function (r, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(r[1]).toFixed(1); }).join("");
    el("path", { d: d, "class": "line hold" }, svg);
    el("text", { x: 0, y: HH - 4, "class": "tick" }, svg).textContent = md(rows[0][0]);
    el("text", { x: plotW, y: HH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = md(rows[n - 1][0]);
    var cursor = el("line", { x1: 0, x2: 0, y1: top, y2: HH - bottom, "class": "cursor", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot hold", visibility: "hidden" }, svg);
    svg.setAttribute("aria-label", "融資餘額 " + md(rows[0][0]) + " " + fmt(rows[0][1], 0) + " 張到 " + md(rows[n - 1][0]) + " " + fmt(rows[n - 1][1], 0) + " 張");
    function readout(i, lead) {
      var r = rows[i], p = $("m-readout");
      var ratio = r[1] > 0 ? "，券資比 " + fmt(r[2] / r[1] * 100, 2) + "%" : "";
      p.textContent = md(r[0]) + " 融資 " + fmt(r[1], 0) + " 張・融券 " + fmt(r[2], 0) + " 張" + ratio;
      if (lead && n > 5) {
        var chg = r[1] - rows[n - 6][1], s = document.createElement("span");
        p.appendChild(document.createTextNode("；融資 5 日 "));
        s.className = cls(chg); s.textContent = signed(chg, 0) + " 張";
        p.appendChild(s);
      }
    }
    function at(evt) {
      var b = svg.getBoundingClientRect(), px = (evt.clientX - b.left) / b.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (n - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(rows[i][1])); dot.setAttribute("visibility", "visible");
      readout(i, false);
    }
    function leave() {
      cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
      readout(n - 1, true);
    }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, n, x, at, leave, $("m-readout"));
    leave();
  }

  /* 借券賣出 (research/site/sbldata.stock_block): a year of lending days as [date, lending
     short balance, 融券 balance] in lots, drawn as two lines on one axis from zero, plus the
     newest day's figures built at build time (the share of issued shares and its percentile
     among common stocks). Neither line is red or green: those colours mean up and down. */
  var SBL_RANGES = RANGES.slice(0, 4), SBL_H = 180, WAN = 1e4, WAN_TICKS = 1e5;
  function lots(v) { return fmt(v, 0) + " 張"; }
  function drawLending() {
    var st = state.data.sbl_stats, sec = $("sb-sec");
    sec.hidden = !st || typeof st !== "object";
    if (sec.hidden) return;
    var all = Array.isArray(state.data.sbl) ? state.data.sbl.filter(function (r) {
      return Array.isArray(r) && r.length === 3 && isNum(r[1]) && isNum(r[2]);
    }) : [];
    $("sb-sub").textContent = "借券賣出是向出借人借來股票後賣出，餘額是尚未還券的股數，與信用交易的融券分開統計。" +
      "證交所與櫃買中心晚上公布，最新資料日 " + ymd(st.as_of) + "，通常比股價晚一天。" +
      (isNum(st.pctile) ? "百分位是占發行股數在當天 " + fmt(st.n, 0) + " 檔普通股中的位置：低於本股的比例，同值算一半。" : "");
    var items = [
      ["借券賣出餘額", lots(st.lots), ymd(st.as_of)],
      ["占發行股數", isNum(st.pct) ? fmt(st.pct, 2) + "%" : "—",
        isNum(st.pctile) ? "普通股中第 " + st.pctile + " 百分位"
          : st.etf ? "ETF 不計算占比" : "當天沒有發行股數資料"],
      ["5 日增減", isNum(st.chg5) ? signed(st.chg5, 0) + " 張" : "—", "較 5 個交易日前"],
      ["20 日增減", isNum(st.chg20) ? signed(st.chg20, 0) + " 張" : "—", "較 20 個交易日前"]
    ];
    var list = $("sb-stats"); list.innerHTML = "";
    items.forEach(function (it) {
      var li = document.createElement("li"); li.className = "stat";
      var v = document.createElement("p"); v.className = "stat-value small"; v.textContent = it[1];
      var l = document.createElement("p"); l.className = "stat-label"; l.textContent = it[0];
      var n = document.createElement("p"); n.className = "stat-note"; n.textContent = it[2];
      li.appendChild(v); li.appendChild(l); li.appendChild(n); list.appendChild(li);
    });
    var box = $("sb-chart-box"), note = $("sb-note");
    box.hidden = all.length < 2;
    note.textContent = box.hidden ? "近一年借券賣出與融券餘額都是 0 張，沒有走勢可畫。" : "兩條線都以張為單位；融券餘額取自同一張交易所報表。在圖上滑動或用方向鍵可查看每日數值。";
    if (box.hidden) return;
    if (state.sbrange === undefined) state.sbrange = SBL_RANGES.length - 1;
    segmented($("sb-ranges"), SBL_RANGES, state.sbrange, function (i) { state.sbrange = i; drawLending(); });
    var rows = all.slice(-SBL_RANGES[state.sbrange][1]), n = rows.length, svg = $("sbl"), p = $("sb-readout");
    var W = Math.max(320, svg.parentNode.clientWidth || 640), top = 12, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + SBL_H);
    svg.innerHTML = "";
    svg.onpointermove = svg.onpointerdown = svg.onpointerleave = svg.onpointerup = null;
    keyScrub(svg, 0);
    function readout(r) { p.textContent = ymd(r[0]) + " 借券賣出 " + lots(r[1]) + "・融券 " + lots(r[2]); }
    if (n < 2) { readout(rows[n - 1]); return; }
    var hi = 0; rows.forEach(function (r) { hi = Math.max(hi, r[1], r[2]); });
    hi = hi > 0 ? hi * 1.1 : 1;
    var plotW = W - PAD_R, plotH = SBL_H - top - bottom, wan = hi >= WAN_TICKS;
    var x = function (i) { return i / (n - 1) * plotW; };
    var y = function (v) { return top + (hi - v) / hi * plotH; };
    var step = niceStep(hi, 4), dp = decimals(wan ? step / WAN : step);
    for (var g = 0; g * step <= hi + 1e-9; g++) {
      var gy = y(g * step);
      el("line", { x1: 0, x2: plotW, y1: gy, y2: gy, "class": "grid" }, svg);
      el("text", { x: W - 4, y: gy + 4, "text-anchor": "end", "class": "tick" }, svg).textContent =
        wan ? fmt(g * step / WAN, dp) + " 萬" : fmt(g * step, dp);
    }
    function path(k) { return rows.map(function (r, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(r[k]).toFixed(1); }).join(""); }
    el("path", { d: path(2), "class": "line sbl-short" }, svg);
    el("path", { d: path(1), "class": "line hold" }, svg);
    xLabels(rows, x, plotW).forEach(function (t) {
      el("text", { x: t[0], y: SBL_H - 4, "text-anchor": "middle", "class": "tick" }, svg).textContent = t[1];
    });
    var cursor = el("line", { x1: 0, x2: 0, y1: top, y2: SBL_H - bottom, "class": "cursor", visibility: "hidden" }, svg);
    var dotShort = el("circle", { r: 4, "class": "dot sbl-short", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot hold", visibility: "hidden" }, svg);
    var last = rows[n - 1];
    svg.setAttribute("aria-label", "借券賣出餘額 " + ymd(rows[0][0]) + " " + lots(rows[0][1]) + " 到 " + ymd(last[0]) + " " +
      lots(last[1]) + "；融券餘額 " + lots(rows[0][2]) + " 到 " + lots(last[2]));
    function at(evt) {
      var b = svg.getBoundingClientRect(), px = (evt.clientX - b.left) / b.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (n - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(rows[i][1])); dot.setAttribute("visibility", "visible");
      dotShort.setAttribute("cx", x(i)); dotShort.setAttribute("cy", y(rows[i][2])); dotShort.setAttribute("visibility", "visible");
      readout(rows[i]);
    }
    function leave() {
      [cursor, dot, dotShort].forEach(function (nd) { nd.setAttribute("visibility", "hidden"); });
      readout(last);
    }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, n, x, at, leave, p);
    leave();
  }

  function holders() {
    var rows = state.data.holders || [], sec = $("d-sec"), list = $("d-stats");
    sec.hidden = !rows.length;
    if (!rows.length) return;
    var last = rows[rows.length - 1], prev = rows.length > 1 ? rows[rows.length - 2] : null;
    $("d-sub").textContent = "集保結算所每週公布的股權分散，最新一週為 " + md(last[0]) + "。" +
      (prev ? "" : "週變化從下一週開始累積。");
    var items = [
      ["千張大戶持股", fmt(last[3], 2) + "%", prev ? last[3] - prev[3] : null, " 個百分點"],
      ["400 張以上持股", fmt(last[2], 2) + "%", prev ? last[2] - prev[2] : null, " 個百分點"],
      ["股東人數", fmt(last[1], 0) + " 人", prev ? last[1] - prev[1] : null, " 人"]
    ];
    list.innerHTML = "";
    items.forEach(function (it) {
      var li = document.createElement("li"); li.className = "stat";
      var v = document.createElement("p"); v.className = "stat-value small"; v.textContent = it[1];
      var l = document.createElement("p"); l.className = "stat-label"; l.textContent = it[0];
      li.appendChild(v); li.appendChild(l);
      if (it[2] !== null) {
        var n = document.createElement("p"); n.className = "stat-note";
        n.textContent = "較前週 " + signed(it[2], it[3] === " 人" ? 0 : 2) + it[3];
        li.appendChild(n);
      }
      list.appendChild(li);
    });
  }

  function profile() {
    var p = state.data.profile, sec = $("p-sec"), dl = $("p-list");
    sec.hidden = !p;
    if (!p) return;
    dl.innerHTML = "";
    [["公司名稱", p.full_name], ["董事長", p.chairman], ["總經理", p.president], ["成立日期", p.founded],
      [state.data.market === "tpex" ? "上櫃日期" : "上市日期", p.listed],
      ["實收資本額", p.capital ? fmt(p.capital / 1e8, 2) + " 億元" : ""], ["網址", p.website]
    ].forEach(function (r) {
      if (!r[1]) return;
      var div = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = r[0];
      if (r[0] === "網址") {
        var a = document.createElement("a");
        a.href = /^https?:\/\//i.test(r[1]) ? r[1] : "https://" + r[1];
        a.rel = "noopener"; a.target = "_blank"; a.textContent = r[1].replace(/^https?:\/\//i, "");
        dd.appendChild(a);
      } else dd.textContent = r[1];
      div.appendChild(dt); div.appendChild(dd); dl.appendChild(div);
    });
  }

  function stats() {
    var s = state.data.stats, list = $("s-stats");
    var items = [["開盤", fmt(s.open, 2)], ["最高", fmt(s.high, 2)], ["最低", fmt(s.low, 2)], ["成交量", fmt(s.volume_lots, 0) + " 張"],
      ["52 週最高", fmt(s.high_52w, 2)], ["52 週最低", fmt(s.low_52w, 2)], ["20 日均成交額", fmt(s.turnover_20d / 1e8, 1) + " 億"],
      ["市場", state.data.market === "tpex" ? "上櫃" : "上市"],
      ["本益比", s.pe === null || s.pe === undefined ? "—" : fmt(s.pe, 2)],
      ["殖利率", s.dividend_yield === null || s.dividend_yield === undefined ? "—" : fmt(s.dividend_yield, 2) + "%"],
      ["股價淨值比", s.pb === null || s.pb === undefined ? "—" : fmt(s.pb, 2)]];
    list.innerHTML = "";
    items.forEach(function (it) {
      var li = document.createElement("li"); li.className = "stat";
      var v = document.createElement("p"); v.className = "stat-value small"; v.textContent = it[1];
      var l = document.createElement("p"); l.className = "stat-label"; l.textContent = it[0];
      li.appendChild(v); li.appendChild(l); list.appendChild(li);
    });
  }

  function events() {
    var ul = $("s-events"), rows = [];
    state.data.events.forEach(function (e) { rows.push([e.date, e.title, e.note || "除權息預告"]); });
    state.data.material.forEach(function (m) { rows.push([m.date, m.subject, "重大訊息 · " + m.category]); });
    ul.innerHTML = "";
    if (!rows.length) { var p = document.createElement("li"); p.className = "empty-row"; p.textContent = "近期沒有除權息預告或重大訊息。"; ul.appendChild(p); return; }
    rows.sort(function (a, b) { return a[0] < b[0] ? 1 : -1; }).forEach(function (r) {
      var li = document.createElement("li");
      var d = document.createElement("p"); d.className = "ev-date";
      d.innerHTML = '<span class="ev-month"></span><span class="ev-day"></span>';
      d.firstChild.textContent = Number(r[0].slice(5, 7)) + " 月"; d.lastChild.textContent = Number(r[0].slice(8, 10));
      var b = document.createElement("div"); b.className = "ev-body";
      var t = document.createElement("p"); t.className = "ev-title"; t.textContent = r[1];
      var n = document.createElement("p"); n.className = "ev-note"; n.textContent = r[2];
      b.appendChild(t); b.appendChild(n); li.appendChild(d); li.appendChild(b); ul.appendChild(li);
    });
  }

  /* watchlist: shared with the 排行 page through localStorage */
  function loadWatch() {
    try { var v = JSON.parse(localStorage.getItem("watchlist") || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function watchButton(sid) {
    var b = $("s-watch"), list = loadWatch(), on = list.indexOf(sid) >= 0;
    b.hidden = false;
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "已加入自選" : "加入自選";
  }
  $("s-watch").addEventListener("click", function () {
    var list = loadWatch(), i = list.indexOf(state.data.id);
    if (i >= 0) list.splice(i, 1); else list.push(state.data.id);
    try { localStorage.setItem("watchlist", JSON.stringify(list)); } catch (e) {}
    watchButton(state.data.id);
  });

  function maToggle() {
    var b = $("ma-toggle");
    b.setAttribute("aria-pressed", String(state.ma));
  }
  $("ma-toggle").addEventListener("click", function () {
    state.ma = !state.ma;
    try { localStorage.setItem("ma", state.ma ? "on" : "off"); } catch (e) {}
    maToggle(); if (state.data) drawPrice();
  });
  maToggle();

  /* ex-dividend / ex-rights history: whether and how fast each gap filled (built at build time) */
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), n = s.length;
    return n ? (s[(n - 1) >> 1] + s[n >> 1]) / 2 : null;
  }
  function fills(d) {
    var list = d.fills || [];
    $("g-sec").hidden = !list.length;
    if (!list.length) return;
    var done = list.filter(function (f) { return f.filled; });
    var mid = median(done.map(function (f) { return f.days; }));
    $("g-sub").textContent = "最近 " + list.length + " 次除權息，" +
      (done.length
        ? done.length + " 次已回到除權息前一日收盤，所需交易日中位數 " + fmt(mid, mid % 1 ? 1 : 0) + " 天。"
        : "都還沒回到除權息前一日收盤。") +
      "「填權息」是收盤回到除權息前一日收盤所需的交易日數，當天回到記為當天；價格已還原分割與減資。" +
      (list.some(function (f) { return f.rights_issue; })
        ? "標「現增」的是現金增資除權，官方參考價不低於前一日收盤，以「—」表示。" : "");
    var tb = $("g-body"); tb.innerHTML = "";
    list.forEach(function (f) {
      var tr = document.createElement("tr");
      var md = f.filled ? Number(f.filled.slice(5, 7)) + "/" + Number(f.filled.slice(8)) : "";
      var fill = f.filled
        ? (f.days === 0 ? "當天" : f.days + " 天（" + md + "）")
        : "尚未，低 " + fmt(Math.abs(f.gap) * 100, 1) + "%";
      [f.date, fill, f.kind + (f.rights_issue ? "（現增）" : ""), fmt(f.target, 2),
       f.reference === null ? "—" : fmt(f.reference, 2)].forEach(function (v) {
        var td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  /* the largest stocks of the same industry by the day's turnover, this one included, and every
     published P/E of the industry: chosen from the rankings at build time (stockdata.peer_block) */
  var MIN_PE_PEERS = 3;  /* fewer stocks with a P/E than this and the industry median says little */
  /* exchange-published ratio cell: 2 decimals, a muted dash when not published for the ranking's day */
  function ratio(v) { return v === null || v === undefined ? ["—", "muted"] : [fmt(v, 2), ""]; }
  function peers(d) {
    var rk = d.peers;
    if (!rk || !Array.isArray(rk.rows) || rk.rows.length < 2) return;
    var idx = {}; rk.cols.forEach(function (c, i) { idx[c] = i; });
    var top = rk.rows, tb = $("peer-body");
    tb.innerHTML = "";
    top.forEach(function (a) {
      var tr = document.createElement("tr"), name = document.createElement("td");
      var mine = a[idx.id] === d.id, link = document.createElement(a[idx.page] && !mine ? "a" : "span");
      link.className = "rank-name"; link.textContent = a[idx.name];
      if (a[idx.page] && !mine) link.href = "index.html?id=" + encodeURIComponent(a[idx.id]);
      name.appendChild(link);
      var sid = document.createElement("span"); sid.className = "sid"; sid.textContent = a[idx.id] + (mine ? " · 本股" : "");
      name.appendChild(sid); tr.appendChild(name);
      var chg = a[idx.chg];
      [[fmt(a[idx.close], 2), ""],
       [chg === null ? "不比價" : signed(chg * 100, 2) + "%", chg === null ? "" : cls(chg)],
       [signed(a[idx.fy], 1), cls(Number(a[idx.fy].toFixed(1)))],
       [signed(a[idx.f5], 0), cls(a[idx.f5])],
       ratio(a[idx.pe]), ratio(a[idx.dy])].forEach(function (c) {
        var td = document.createElement("td");
        if (c[1] === "muted") { td.className = "muted"; td.textContent = c[0]; }
        else if (c[1]) { var s = document.createElement("span"); s.className = c[1]; s.textContent = c[0]; td.appendChild(s); }
        else td.textContent = c[0];
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    /* the industry median uses every same-industry stock with a published P/E, not just the rows shown */
    var pes = (rk.pe || []).filter(function (v) { return v !== null && v !== undefined; });
    /* the valuation headers' definition is printed under the table, so touch and keyboard
       readers see it too (the headers keep it as a hover title) */
    $("peer-note").textContent = (pes.length >= MIN_PE_PEERS
      ? "同產業本益比中位數 " + fmt(median(pes), 1) + " 倍（" + pes.length + " 檔有本益比）。" : "") +
      "本益比、殖利率為證交所、櫃買中心當日公布；「—」表示無資料（虧損公司無本益比、ETF 不適用、當日尚未公布）。";
    $("peer-sub").textContent = d.industry + "成交金額最大的 " + top.length + " 檔，資料截至 " + rk.as_of + "。";
    $("peer-sec").hidden = false;
  }

  /* 事件與股價反應: rows [date, kind, lag, excess 0 / 5 / 20, raw 0 / 5 / 20, note] built by
     stockdata.reaction_block, returns in percent; the event day is date + lag calendar days. Each
     kind has its own marker shape, so it never depends on colour (red and green mean up and down). */
  var EKINDS = {
    rev: { name: "營收公布", shape: "square" },
    div: { name: "除權息", shape: "circle" },
    cap: { name: "減資", shape: "diamond" },
    split: { name: "分割／面額變更", shape: "hollow" },
    conf: { name: "法說會", shape: "triangle" },
    news: { name: "重大訊息", shape: "plus" }
  };
  var EORDER = ["rev", "div", "cap", "split", "conf", "news"];
  var REACT_FIELDS = 10, NOTE = 9, EXCESS = 3, RAW = 6, HORIZON_NAMES = ["當天", "5 日", "20 日"];
  var MARK_LANE = 16, MARK_R = 4, MARK_STACK = 9, SNAP_PX = 8, EVENT_ROWS = 8;
  var INDEX_NAMES = { twse: "加權指數", tpex: "櫃買指數" };
  function reactRows() {
    var r = state.data && state.data.reactions;
    return Array.isArray(r) ? r.filter(function (x) { return Array.isArray(x) && x.length === REACT_FIELDS && EKINDS[x[1]]; }) : [];
  }
  function hasNum(v) { return typeof v === "number" && isFinite(v); }
  function eventDay(r) { return hasNum(r[2]) ? new Date(Date.parse(r[0] + "T00:00:00Z") + r[2] * DAY_MS).toISOString().slice(0, 10) : null; }
  function indexName() { var s = state.data.reaction_summary; return (s && INDEX_NAMES[s.index]) || "大盤"; }
  /* one marker: filled circle, square, diamond or triangle, a hollow diamond, or a plus sign */
  function mark(parent, kind, cx, cy) {
    var shape = EKINDS[kind].shape, c = "mk " + shape, r = MARK_R, d = r + 0.8;
    if (shape === "circle") return el("circle", { cx: cx, cy: cy, r: r, "class": c }, parent);
    if (shape === "square") return el("rect", { x: cx - r + 0.5, y: cy - r + 0.5, width: 2 * r - 1, height: 2 * r - 1, "class": c }, parent);
    if (shape === "plus") return el("path", { d: "M" + (cx - r) + "," + cy + "H" + (cx + r) + "M" + cx + "," + (cy - r) + "V" + (cy + r), "class": c }, parent);
    if (shape === "triangle") return el("path", { d: "M" + cx + "," + (cy - d) + "L" + (cx + d) + "," + (cy + r) + "L" + (cx - d) + "," + (cy + r) + "Z", "class": c }, parent);
    return el("path", { d: "M" + cx + "," + (cy - d) + "L" + (cx + d) + "," + cy + "L" + cx + "," + (cy + d) + "L" + (cx - d) + "," + cy + "Z", "class": c }, parent);
  }
  function icon(kind) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 12 12"); svg.setAttribute("class", "mk-icon"); svg.setAttribute("aria-hidden", "true");
    mark(svg, kind, 6, 6);
    return svg;
  }
  /* markers in the lane under the volume bars: one per kind and trading day, stacked upwards */
  function drawMarks(svg, bars, x, plotW, cy) {
    var pos = {}, byBar = {}, groups = [];
    bars.forEach(function (b, i) { pos[b[0]] = i; });
    reactRows().forEach(function (r) {
      var i = pos[eventDay(r)];
      if (i !== undefined) (byBar[i] = byBar[i] || []).push(r);
    });
    el("line", { x1: 0, x2: plotW, y1: cy - MARK_LANE / 2, y2: cy - MARK_LANE / 2, "class": "axis" }, svg);
    Object.keys(byBar).forEach(function (k) {
      var i = Number(k), rows = byBar[k], kinds = [];
      rows.forEach(function (r) { if (kinds.indexOf(r[1]) < 0) kinds.push(r[1]); });
      kinds.sort(function (a, b) { return EORDER.indexOf(a) - EORDER.indexOf(b); });
      groups.push({ x: x(i), rows: rows, nodes: kinds.map(function (kind, j) { return mark(svg, kind, x(i), cy - j * MARK_STACK); }) });
    });
    return groups;
  }
  function pctSpan(v, parent) {
    var s = document.createElement("span");
    if (!hasNum(v)) { s.className = "muted"; s.textContent = "—"; }
    else { s.className = cls(Number(v.toFixed(1))); s.textContent = signed(v, 1) + "%"; }
    if (parent) parent.appendChild(s);
    return s;
  }
  function revYoy(period) {
    var hit = (state.data.revenue || []).filter(function (r) { return r[0] === period; })[0];
    return hit && hasNum(hit[2]) ? hit[2] : null;
  }
  /* [label, detail] of an event: what the table's 事件 column and the readout say */
  function eventText(r) {
    var n = r[NOTE];
    if (r[1] === "rev") {
      var yoy = revYoy(n);
      return [Number(String(n).slice(5, 7)) + " 月營收公布", yoy === null ? "" : "年增\u00a0" + signed(yoy * 100, 1) + "%"];
    }
    if (r[1] === "div") return [String(n), ""];
    if (r[1] === "cap") return ["減資後恢復買賣", String(n)];
    if (r[1] === "split") return [String(n) + "後恢復買賣", ""];
    if (r[1] === "conf") {  /* note [time, venue, summary] */
      var cf = Array.isArray(n) ? n : ["", "", ""];
      return ["法說會" + (cf[0] ? " " + cf[0] : ""), [cf[1], cf[2]].filter(Boolean).join("・")];
    }
    var news = Array.isArray(n) ? n : ["", ""];
    return ["重大訊息・" + news[0], String(news[1])];
  }
  /* under the price chart: the legend, or the events at the cursor with their reactions */
  function eventReadout(rows, groups) {
    var p = $("e-readout");
    p.innerHTML = "";
    if (!rows) {
      var kinds = [];
      (groups || []).forEach(function (g) { g.rows.forEach(function (r) { if (kinds.indexOf(r[1]) < 0) kinds.push(r[1]); }); });
      p.hidden = !kinds.length;
      if (p.hidden) return;
      var lg = document.createElement("span"); lg.className = "react-legend";
      EORDER.filter(function (k) { return kinds.indexOf(k) >= 0; }).forEach(function (k) {
        var it = document.createElement("span"); it.appendChild(icon(k)); it.appendChild(document.createTextNode(EKINDS[k].name)); lg.appendChild(it);
      });
      var hint = document.createElement("span"); hint.textContent = "滑到圖下標記查看股價反應"; lg.appendChild(hint);
      p.appendChild(lg);
      return;
    }
    p.hidden = false;
    var head = document.createElement("span"); head.className = "react-ev";
    rows.forEach(function (r, j) {
      var t = eventText(r);
      if (j) head.appendChild(document.createTextNode("；"));
      head.appendChild(icon(r[1]));
      head.appendChild(document.createTextNode((j ? "" : ymd(r[0]) + " ") + t[0] + (t[1] ? "：" + t[1] : "")));
    });
    p.appendChild(head);
    var r0 = rows[0], line = document.createElement("span"); line.className = "react-line";
    line.appendChild(document.createTextNode("反應日 " + md(eventDay(r0)) + "　超額"));
    HORIZON_NAMES.forEach(function (h, k) {  /* each horizon stays on one line when the readout wraps */
      var seg = document.createElement("span"); seg.className = "react-h";
      seg.textContent = h + " "; pctSpan(r0[EXCESS + k], seg);
      line.appendChild(document.createTextNode("　")); line.appendChild(seg);
    });
    var raw = document.createElement("span"); raw.className = "react-raw";
    raw.textContent = "（股價 " + HORIZON_NAMES.map(function (h, k) { return hasNum(r0[RAW + k]) ? signed(r0[RAW + k], 1) + "%" : "—"; }).join("／") + "）";
    line.appendChild(raw);
    p.appendChild(line);
  }
  /* one line per kind, numbers from the build (stockdata._reaction_summary) */
  function summaryLine(k) {
    var name = EKINDS[k.kind].name, lead = k.n + " 次" + name, after = "後";
    if (k.kind === "rev" || k.kind === "div") lead = "近 " + k.n + " 次" + name;
    if (k.kind === "cap") lead = k.n + " 次減資後恢復買賣";
    if (k.kind === "split") lead = k.n + " 次分割或面額變更後恢復買賣";
    if (k.kind === "conf") { lead = k.n + " 場法說會"; after = "召開後"; }
    if (k.kind === "news") { lead = "近 " + k.n + " 則重大訊息"; after = "公布後"; }
    if (k.kind === "rev") after = "公布後";
    if (k.kind === "div") after = "除權息後";
    if (k.kind === "cap" || k.kind === "split") after = "恢復後";
    var li = document.createElement("li");
    li.appendChild(icon(k.kind));
    var t = document.createElement("span"); li.appendChild(t);
    if (!hasNum(k.mean)) { t.textContent = lead + "：尚未有交易日反應。"; return li; }
    var span = k.horizon === 0 ? "當天" : " " + k.horizon + " 日";  /* a space before digits, as elsewhere */
    t.appendChild(document.createTextNode(lead + "：" + after + span + (k.valid > 1 ? "平均" : "") + "超額 "));
    pctSpan(k.mean, t);
    t.appendChild(document.createTextNode(k.valid > 1
      ? "，" + k.beat + "／" + k.valid + " 次跑贏" + indexName() + "。"
      : (k.beat ? "，跑贏" : "，落後") + indexName() + "。"));
    if (k.valid < k.n) t.appendChild(document.createTextNode("其餘 " + (k.n - k.valid) + " 次尚無" + span + "資料。"));
    return li;
  }
  function reactions() {
    var rows = reactRows(), sec = $("e-sec"), st = state.data.reaction_summary;
    sec.hidden = !rows.length;
    if (sec.hidden) return;
    $("e-sub").textContent = "把除權息、減資、營收、法說會與重大訊息對到股價。表中是超額報酬：事件前一個交易日收盤到事件當天、之後第 5、第 20 個交易日收盤的漲跌，減去同期" +
      indexName() + "漲跌；紅色表示優於大盤。圖下的標記是事件反應日，滑到標記可查看。";
    var ul = $("e-sum"); ul.innerHTML = "";
    ((st && st.kinds) || []).forEach(function (k) { if (EKINDS[k.kind]) ul.appendChild(summaryLine(k)); });
    var list = rows.slice().reverse(), tb = $("e-body"), btn = $("e-more");
    tb.innerHTML = "";
    list.forEach(function (r, j) {
      var tr = document.createElement("tr"), t = eventText(r);
      if (j >= EVENT_ROWS && !state.eAll) tr.hidden = true;
      var d = document.createElement("td"); d.className = "date-cell"; d.textContent = r[0]; tr.appendChild(d);
      var ev = document.createElement("td"); ev.className = "ev-cell";
      var name = document.createElement("span"); name.className = "ev-name"; name.appendChild(icon(r[1])); name.appendChild(document.createTextNode(t[0]));
      ev.appendChild(name);
      /* the date repeats here for phones, where the date column is hidden */
      var sub = document.createElement("span"), when = document.createElement("span");
      sub.className = "ev-detail"; when.className = "ev-when"; when.textContent = r[0]; sub.appendChild(when);
      if (t[1]) {
        var more = document.createElement("span"); more.className = "ev-more"; more.textContent = t[1];
        sub.appendChild(more); ev.title = t[1];
      }
      ev.appendChild(sub); tr.appendChild(ev);
      for (var k = 0; k < 3; k++) { var td = document.createElement("td"); pctSpan(r[EXCESS + k], td); tr.appendChild(td); }
      tb.appendChild(tr);
    });
    $("e-more-row").hidden = list.length <= EVENT_ROWS;
    btn.textContent = state.eAll ? "收合" : "顯示全部 " + list.length + " 筆";
    btn.setAttribute("aria-expanded", String(!!state.eAll));
    $("e-note").textContent = "營收與 13:30 收盤後公布的重大訊息，以公布後第一個交易日為當天；法說會以召開日為準，13:30 以後或時間不明的以次一交易日為當天。營收公布日取 FinMind 或交易所的紀錄，最晚以法定期限（次月 10 日）計；2026 年 3 月以前的紀錄只有期限日，實際公布可能更早。股價含股利還原；" +
      indexName() + "不含股利，除權息旺季的超額報酬會略為高估。現金增資除權缺官方參考價、或資料倉之後無法確認還原的期間不計算。重大訊息只收錄本站開始保存以後的公告；法說會從 2026-10-22 公告的場次起累積。";
  }
  $("e-more").addEventListener("click", function () { state.eAll = !state.eAll; reactions(); });

  function pickRange(i) { state.range = i; segmented($("ranges"), RANGES, i, pickRange); drawPrice(); }
  function pickKind(i) { state.kind = i; segmented($("kinds"), KINDS, i, pickKind); drawFlows(); }

  function render() {
    var d = state.data;
    document.title = d.name + " " + d.id + " · 台股研究";
    $("nav-title").textContent = d.name + " " + d.id;
    var eb = $("s-eyebrow"), link = document.createElement("a");
    eb.textContent = (d.market === "tpex" ? "上櫃" : "上市") + " · ";
    if (d.industry) {
      link.href = "../rank/index.html?industry=" + encodeURIComponent(d.industry);
      link.textContent = d.industry; eb.appendChild(link);
    } else {
      eb.appendChild(document.createTextNode("—"));  /* a new listing before its industry is known */
    }
    eb.appendChild(document.createTextNode(" · " + d.id));
    try { peers(d); } catch (e) { console.error("同業比較", e); }  /* a bad block only hides the table */
    $("s-name").textContent = d.name;
    segmented($("ranges"), RANGES, state.range, pickRange);
    segmented($("kinds"), KINDS, state.kind, pickKind);
    redraw(); holders(); stats(); profile(); fills(d); events(); watchButton(d.id);
    try { reactions(); } catch (e) { console.error("事件與股價反應", e); }  /* a bad block only hides the table */
  }
  function redraw() {
    drawPrice(); drawFlows(); drawRevenue(); drawValuation(); drawHoldings(); drawMargin();
    try { drawLending(); } catch (e) { console.error("借券賣出", e); }  /* a bad block only hides itself */
  }

  /* data files store dated series by column, the dates as the first date and then the gap in
     days to each next row (research/site/packing.py); rebuild the [date, ...values] rows */
  var GAP_MS = 864e5;
  function unpackSeries(cols) {
    if (!cols.length) return [];
    var dates = cols[0], rows = [], t = Date.parse(dates[0] + "T00:00:00Z");
    for (var i = 0; i < dates.length; i++) {
      if (i) t += dates[i] * GAP_MS;
      var row = [i ? new Date(t).toISOString().slice(0, 10) : dates[0]];
      for (var c = 1; c < cols.length; c++) row.push(cols[c][i]);
      rows.push(row);
    }
    return rows;
  }
  function unpack(d) {
    (d.packed || []).forEach(function (k) { d[k] = unpackSeries(d[k]); });
    delete d.packed;
    return d;
  }
  /* the stock's file first; the search list (about 25 KB compressed) only after it, so it never
     competes with the chart's data on a slow connection */
  fetch("data/" + encodeURIComponent(id) + ".json" + V).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (d) { state.data = unpack(d); render(); }).catch(function () {
    $("s-name").textContent = "找不到 " + id;
    $("s-meta").textContent = "最近一個交易日有成交的股票與 ETF 都有走勢頁，請用上方搜尋。";
  }).then(searchList);
  function searchList() {
    fetch("data/index.json" + V).then(function (r) { return r.json(); }).then(function (list) {
      var dl = $("stock-list");
      list.forEach(function (s) { var o = document.createElement("option"); o.value = s.id; o.label = s.name; dl.appendChild(o); });
      $("search").addEventListener("submit", function (e) {
        e.preventDefault();
        var q = $("q").value.trim(), hit = list.find(function (s) { return s.id === q || s.name === q; });
        if (hit) location.search = "?id=" + encodeURIComponent(hit.id);
      });
    }).catch(function () {});
  }
  var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { if (state.data) redraw(); }, 150); });

  /* shared chrome: sidebar sheet and theme */
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
      if (state.data) redraw();
    }
  });
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
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") side(false); else if (e.key === "Tab") trapTab(e); });
})();
