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
          ? state.data.listed + " 掛牌首日收盤以來漲跌（興櫃期間不列入）"
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
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = "";
    if (bars.length < 2) return;
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
      el("text", { x: t[0], y: H - 4, "text-anchor": "middle", "class": "tick" }, svg).textContent = t[1];
    });
    var cursor = el("line", { x1: 0, x2: 0, y1: PAD_T, y2: H - PAD_B, "class": "cursor", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot " + dir, visibility: "hidden" }, svg);
    svg.setAttribute("aria-label", "股價走勢，" + RANGES[state.range][0] + "：" + fmt(bars[0][4], 2) + " 到 " + fmt(bars[bars.length - 1][4], 2));
    function at(evt) {
      var r = svg.getBoundingClientRect(), px = (evt.clientX - r.left) / r.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (bars.length - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(bars[i][4])); dot.setAttribute("visibility", "visible");
      header(bars[i], bars[0], true, mas.map(function (s) { return s[i]; }));
    }
    function leave() {
      cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
      header(bars[bars.length - 1], bars[0], false);
    }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave; svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    leave();
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
    $("r-sub").textContent = "上市櫃公司每月 10 日前公布前一個月營收。最新一期 " + ym(last[0]) +
      (state.data.revenue_source === "exchange"
        ? "，取自交易所彙總表，本站 " + state.data.revenue_available + " 取得"
        : "，公布於 " + state.data.revenue_available) +
      "。年增率用當時公布的數字計算，公司事後重編去年數字時會與官方公告略有不同。";
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
      "在圖上滑動可查看每日數值。";
    var W = Math.max(320, svg.parentNode.clientWidth || 640), top = 12, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + VAL_H);
    svg.innerHTML = "";
    svg.onpointermove = svg.onpointerdown = svg.onpointerleave = svg.onpointerup = null;
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
        ? "現金增資除權的參考價要扣除認購權利價值，資料來源未提供，以「—」表示。" : "");
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

  /* the largest stocks of the same industry by turnover, from the rankings file */
  var PEERS = 8;
  function peers(d) {
    fetch("data/rank.json" + V).then(function (r) { return r.json(); }).then(function (rk) {
      var idx = {}; rk.cols.forEach(function (c, i) { idx[c] = i; });
      var rows = rk.rows.filter(function (a) { return a[idx.industry] === d.industry && !a[idx.etf]; });
      if (rows.length < 2) return;
      rows.sort(function (a, b) { return b[idx.tv] - a[idx.tv]; });
      var top = rows.slice(0, PEERS), tb = $("peer-body");
      if (!top.some(function (a) { return a[idx.id] === d.id; })) {
        var self = rows.filter(function (a) { return a[idx.id] === d.id; })[0];
        if (self) top[top.length - 1] = self;
      }
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
         [signed(a[idx.f5], 0), cls(a[idx.f5])]].forEach(function (c) {
          var td = document.createElement("td");
          if (c[1]) { var s = document.createElement("span"); s.className = c[1]; s.textContent = c[0]; td.appendChild(s); }
          else td.textContent = c[0];
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      $("peer-sub").textContent = d.industry + "成交金額最大的 " + top.length + " 檔，資料截至 " + rk.as_of + "。";
      $("peer-sec").hidden = false;
    }).catch(function () {});
  }

  function pickRange(i) { state.range = i; segmented($("ranges"), RANGES, i, pickRange); drawPrice(); }
  function pickKind(i) { state.kind = i; segmented($("kinds"), KINDS, i, pickKind); drawFlows(); }

  function render() {
    var d = state.data;
    document.title = d.name + " " + d.id + " · 台股研究";
    $("nav-title").textContent = d.name + " " + d.id;
    var eb = $("s-eyebrow"), link = document.createElement("a");
    eb.textContent = (d.market === "tpex" ? "上櫃" : "上市") + " · ";
    link.href = "../rank/index.html?industry=" + encodeURIComponent(d.industry);
    link.textContent = d.industry; eb.appendChild(link);
    eb.appendChild(document.createTextNode(" · " + d.id));
    peers(d);
    $("s-name").textContent = d.name;
    segmented($("ranges"), RANGES, state.range, pickRange);
    segmented($("kinds"), KINDS, state.kind, pickKind);
    redraw(); holders(); stats(); profile(); fills(d); events(); watchButton(d.id);
  }
  function redraw() { drawPrice(); drawFlows(); drawRevenue(); drawValuation(); drawHoldings(); drawMargin(); }

  fetch("data/" + encodeURIComponent(id) + ".json" + V).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (d) { state.data = d; render(); }).catch(function () {
    $("s-name").textContent = "找不到 " + id;
    $("s-meta").textContent = "最近一個交易日有成交的股票與 ETF 都有走勢頁，請用上方搜尋。";
  });
  fetch("data/index.json" + V).then(function (r) { return r.json(); }).then(function (list) {
    var dl = $("stock-list");
    list.forEach(function (s) { var o = document.createElement("option"); o.value = s.id; o.label = s.name; dl.appendChild(o); });
    $("search").addEventListener("submit", function (e) {
      e.preventDefault();
      var q = $("q").value.trim(), hit = list.find(function (s) { return s.id === q || s.name === q; });
      if (hit) location.search = "?id=" + encodeURIComponent(hit.id);
    });
  }).catch(function () {});
  var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { if (state.data) redraw(); }, 150); });

  /* shared chrome: sidebar sheet and theme */
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-action]"); if (!a) return;
    var act = a.getAttribute("data-action");
    if (act === "side-open") side(true);
    else if (act === "side-close") side(false);
    else if (act === "theme") {
      var r = document.documentElement, cur = r.getAttribute("data-theme");
      var dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches, next = dark ? "light" : "dark";
      r.setAttribute("data-theme", next); try { localStorage.setItem("theme", next); } catch (err) {}
      if (state.data) redraw();
    }
  });
  function side(open) {
    document.body.classList.toggle("nav-open", open);
    var o = document.querySelector(".side-open"); if (o) o.setAttribute("aria-expanded", String(open));
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") side(false); });
})();
