/* 大盤走勢: index line with ranges and scrubbing, official foreign flows and margin balance, all
   read from the precomputed data/market.json. Red is up and buying, green down and selling. */
(function () {
  "use strict";
  var RANGES = [["1 個月", 21], ["3 個月", 63], ["6 個月", 126], ["1 年", 250], ["2 年", 500], ["5 年", 1250], ["全部", 100000]];
  var MARKETS = [["加權指數", "twse"], ["櫃買指數", "tpex"]];
  var FLOW_DAYS = 60, MARGIN_DAYS = 250, H = 260, PAD_R = 64, PAD_T = 12, PAD_B = 22;
  var NS = "http://www.w3.org/2000/svg";
  var buildMeta = document.querySelector('meta[name="build"]');
  var V = buildMeta && buildMeta.content ? "?v=" + encodeURIComponent(buildMeta.content) : "";
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, market: 0, range: 2, vkind: 0, vrange: 2 };

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
  /* axis label: month/day within a year, year/month when the span is longer */
  function axisLabel(date, first, last) {
    var long = (Date.parse(last) - Date.parse(first)) > 370 * 864e5;
    return long ? date.slice(0, 4) + "/" + Number(date.slice(5, 7)) : md(date);
  }
  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function decimals(step) {
    var dp = 0;
    while (dp < 3 && Math.abs(Math.round(step * Math.pow(10, dp)) - step * Math.pow(10, dp)) > 1e-9) dp++;
    return dp;
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
  function rows() {
    var d = state.data, cols = d.cols;
    return (d[MARKETS[state.market][1]] || []).map(function (a) {
      var o = {}; cols.forEach(function (c, i) { o[c] = a[i]; }); return o;
    });
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function ymd(date) { return date.slice(0, 4) + "/" + md(date); }
  function yi(v) { return v === null || v === undefined ? "—" : signed(v, 1) + " 億"; }
  /* common-stock medians of the published ratios; days not yet backfilled are left out */
  var MEDIANS = [["pe_median", "本益比中位數 ", 1, ""], ["pb_median", "股價淨值比中位數 ", 2, ""], ["dy_median", "殖利率中位數 ", 2, "%"]];
  function medians(r) {
    return MEDIANS.map(function (m) {
      var v = r[m[0]];
      return typeof v === "number" && isFinite(v) ? "　" + m[1] + fmt(v, m[2]) + m[3] : "";
    }).join("");
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

  /* a line chart with nice ticks, end-date labels and a scrub cursor; onAt(i | null).
     opts: height, tone, area, unit (tick suffix), ref (a value drawn as a dashed line),
     min and max (a fixed value axis, e.g. 0 to 100 for percentages; otherwise it fits the data),
     say (the readout element, or a function returning its text, for keyboard scrubbing) */
  function lineChart(svg, pts, opts, onAt) {
    var W = Math.max(320, svg.parentNode.clientWidth || 640), HH = opts.height || 160;
    svg.setAttribute("viewBox", "0 0 " + W + " " + HH); svg.innerHTML = "";
    if (pts.length < 2) { onAt(null); keyScrub(svg, 0); return; }
    var lo = Infinity, hi = -Infinity, ref = isNum(opts.ref) ? opts.ref : null;
    pts.forEach(function (p) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
    if (ref !== null) { lo = Math.min(lo, ref); hi = Math.max(hi, ref); }
    if (isNum(opts.min) && isNum(opts.max)) { lo = opts.min; hi = opts.max; }
    else { var pad = (hi - lo) * 0.08 || Math.max(1, Math.abs(hi) * 0.02); lo -= pad; hi += pad; }
    var plotW = W - PAD_R, plotH = HH - PAD_T - PAD_B, n = pts.length;
    var x = function (i) { return i / (n - 1) * plotW; };
    var y = function (v) { return PAD_T + (hi - v) / (hi - lo) * plotH; };
    var step = niceStep(hi - lo, 4), dp = decimals(step);
    for (var k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) {
      var gy = y(k * step);
      el("line", { x1: 0, x2: plotW, y1: gy, y2: gy, "class": "grid" }, svg);
      el("text", { x: W - 4, y: gy + 4, "text-anchor": "end", "class": "tick" }, svg).textContent = fmt(k * step, dp) + (opts.unit || "");
    }
    if (ref !== null) el("line", { x1: 0, x2: plotW, y1: y(ref), y2: y(ref), "class": "ma ma60" }, svg);
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(p.v).toFixed(1); }).join("");
    if (opts.area) el("path", { d: line + "L" + plotW + "," + (PAD_T + plotH) + "L0," + (PAD_T + plotH) + "Z", "class": "area " + opts.tone }, svg);
    el("path", { d: line, "class": "line " + opts.tone }, svg);
    el("text", { x: 0, y: HH - 4, "class": "tick" }, svg).textContent = axisLabel(pts[0].d, pts[0].d, pts[n - 1].d);
    el("text", { x: plotW, y: HH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = axisLabel(pts[n - 1].d, pts[0].d, pts[n - 1].d);
    var cursor = el("line", { x1: 0, x2: 0, y1: PAD_T, y2: HH - PAD_B, "class": "cursor", visibility: "hidden" }, svg);
    var dot = el("circle", { r: 4.5, "class": "dot " + opts.tone, visibility: "hidden" }, svg);
    function at(evt) {
      var r = svg.getBoundingClientRect(), px = (evt.clientX - r.left) / r.width * W;
      var i = Math.round(Math.min(Math.max(px, 0), plotW) / plotW * (n - 1));
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(pts[i].v)); dot.setAttribute("visibility", "visible");
      onAt(i);
    }
    function leave() { cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); onAt(null); }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, n, x, at, leave, opts.say);
    leave();
  }

  function drawIndex() {
    var all = rows(), bars = all.slice(-RANGES[state.range][1]);
    if (!bars.length) return;
    var base = all.length > bars.length ? all[all.length - bars.length - 1] : bars[0];
    var last = bars[bars.length - 1], tone = cls(last.close - base.close) || "flat";
    $("k-name").textContent = MARKETS[state.market][0];
    document.title = MARKETS[state.market][0] + " · 大盤走勢 · 台股研究";
    function header(i) {
      var r = i === null ? last : bars[i], chg = r.close - base.close;
      $("k-close").textContent = fmt(r.close, 2);
      var c = $("k-chg"); c.textContent = signed(chg, 2) + "（" + signed(chg / base.close * 100, 2) + "%）"; c.className = "quote-chg " + cls(chg);
      $("k-meta").textContent = i === null
        ? (RANGES[state.range][1] >= all.length ? bars[0].date + " 以來" : RANGES[state.range][0]) + "漲跌，資料截至 " + last.date
        : r.date + "　當日 " + signed(r.change, 2) + "　成交 " + (r.turnover === null ? "—" : fmt(r.turnover, 0) + " 億") +
          "　外資 " + yi(r.foreign) + "　投信 " + yi(r.trust) + "　融資 " + (r.margin === null ? "—" : fmt(r.margin, 0) + " 億") +
          medians(r);
    }
    lineChart($("k-chart"), bars.map(function (r) { return { d: r.date, v: r.close }; }), { height: H, area: true, tone: tone, say: function () {
      return $("k-close").textContent + " " + $("k-chg").textContent + " " + $("k-meta").textContent;
    } }, header);
    /* reserve the scrubbing line's height (four lines on a phone), so the chart never moves */
    var meta = $("k-meta");
    meta.style.minHeight = ""; header(bars.length - 1);
    meta.style.minHeight = meta.offsetHeight + "px"; header(null);
  }

  function drawFlows() {
    var svg = $("k-flows"), pts = rows().filter(function (r) { return r.foreign !== null; }).slice(-FLOW_DAYS);
    var W = Math.max(320, svg.parentNode.clientWidth || 640), FH = 180, top = 16, bottom = 22;
    svg.setAttribute("viewBox", "0 0 " + W + " " + FH); svg.innerHTML = "";
    if (!pts.length) { $("k-flow-readout").textContent = "官方金額回補中。"; keyScrub(svg, 0); return; }
    var m = 0; pts.forEach(function (r) { m = Math.max(m, Math.abs(r.foreign)); }); m = m || 1;
    var half = (FH - top - bottom) / 2, zero = top + half, slot = W / pts.length, bw = Math.min(10, slot * 0.7);
    var hover = el("rect", { x: 0, y: top, width: slot, height: FH - top - bottom, rx: 2, "class": "hover-band", visibility: "hidden" }, svg);
    el("line", { x1: 0, x2: W, y1: zero, y2: zero, "class": "axis" }, svg);
    pts.forEach(function (r, i) {
      var h = Math.abs(r.foreign) / m * half; if (!h) return;
      el("rect", { x: i * slot + (slot - bw) / 2, y: r.foreign > 0 ? zero - h : zero, width: bw, height: h, rx: 1.5, "class": "bar " + (r.foreign > 0 ? "pos" : "neg") }, svg);
    });
    el("text", { x: 0, y: FH - 4, "class": "tick" }, svg).textContent = md(pts[0].date);
    el("text", { x: W, y: FH - 4, "text-anchor": "end", "class": "tick" }, svg).textContent = md(pts[pts.length - 1].date);
    var sum = pts.reduce(function (a, r) { return a + r.foreign; }, 0);
    function readout(label, v, extra) {
      var p = $("k-flow-readout"), s = document.createElement("span");
      p.textContent = label + " "; s.className = cls(Number(v.toFixed(1))); s.textContent = signed(v, 1) + " 億"; p.appendChild(s);
      if (extra) p.appendChild(document.createTextNode(extra));
    }
    function at(evt) {
      var r = svg.getBoundingClientRect(), i = Math.floor((evt.clientX - r.left) / r.width * W / slot);
      i = Math.min(Math.max(i, 0), pts.length - 1);
      hover.setAttribute("x", i * slot); hover.setAttribute("visibility", "visible");
      readout(md(pts[i].date) + " 外資", pts[i].foreign, "　投信 " + yi(pts[i].trust) + "　自營商 " + yi(pts[i].dealer));
    }
    function leave() { hover.setAttribute("visibility", "hidden"); readout("外資近 " + pts.length + " 日合計", sum); }
    svg.onpointermove = at; svg.onpointerdown = at; svg.onpointerleave = leave;
    svg.onpointerup = function (e) { if (e.pointerType !== "mouse") leave(); };
    keyScrub(svg, pts.length, function (i) { return (i + 0.5) * slot; }, at, leave, $("k-flow-readout"));
    leave();
  }

  function drawMargin() {
    var pts = rows().filter(function (r) { return r.margin !== null; }).slice(-MARGIN_DAYS);
    var n = pts.length;
    if (n < 2) { $("k-margin-readout").textContent = "融資資料回補中。"; $("k-margin").innerHTML = ""; keyScrub($("k-margin"), 0); return; }
    var back = pts[Math.max(0, n - 21)];
    lineChart($("k-margin"), pts.map(function (r) { return { d: r.date, v: r.margin }; }), { height: 160, tone: "hold", say: $("k-margin-readout") }, function (i) {
      var r = i === null ? pts[n - 1] : pts[i], p = $("k-margin-readout");
      p.textContent = md(r.date) + " 融資餘額 " + fmt(r.margin, 1) + " 億";
      if (i === null && n > 20) {
        var s = document.createElement("span"), chg = r.margin - back.margin;
        p.appendChild(document.createTextNode("，20 日 "));
        s.className = cls(Number(chg.toFixed(1))); s.textContent = signed(chg, 1) + " 億"; p.appendChild(s);
      }
    });
  }

  /* 借券賣出餘額: each market's total lending short balance in lots (every row of the exchange's
     table, ETFs included; research/site/sbldata.market_totals), shown in 萬張 over the index
     chart's range. It is published in the evening and written a day late, so the newest index
     day usually has none yet. */
  var WAN = 1e4, SBL_BACK = 20;
  function wan(v) { return fmt(v / WAN, 1) + " 萬張"; }
  function drawLending() {
    var all = rows(), sec = $("sbl-sec"), noun = MARKET_NOUNS[state.market];
    var hist = all.filter(function (r) { return isNum(r.sbl); });
    sec.hidden = hist.length < 2;
    if (sec.hidden) return;
    var last = hist[hist.length - 1];
    $("sbl-sub").textContent = "證交所與櫃買中心每日公布的借券賣出餘額，" + noun + "每一檔（含 ETF）加總，單位萬張（1 張 = 1,000 股）；" +
      "晚上公布，通常比指數晚一天，最新資料日 " + ymd(last.date) + "。";
    var shown = all.slice(-RANGES[state.range][1]).filter(function (r) { return isNum(r.sbl); }), n = shown.length;
    var p = $("k-sbl-readout"), svg = $("k-sbl");
    if (n < 2) { p.textContent = "所選期間沒有資料。"; svg.innerHTML = ""; return; }
    var back = shown.length > SBL_BACK ? shown[n - 1 - SBL_BACK] : null;
    svg.setAttribute("aria-label", noun + "借券賣出餘額 " + ymd(shown[0].date) + " " + wan(shown[0].sbl) + " 到 " +
      ymd(shown[n - 1].date) + " " + wan(shown[n - 1].sbl));
    lineChart(svg, shown.map(function (r) { return { d: r.date, v: r.sbl / WAN }; }), { height: 160, tone: "hold", say: p }, function (i) {
      var r = i === null ? shown[n - 1] : shown[i];
      p.textContent = ymd(r.date) + " 借券賣出餘額 " + wan(r.sbl);
      if (i === null && back) {
        var s = document.createElement("span"), chg = (r.sbl - back.sbl) / WAN;
        p.appendChild(document.createTextNode("，" + SBL_BACK + " 個交易日 "));
        s.className = cls(Number(chg.toFixed(1))); s.textContent = signed(chg, 1) + " 萬張"; p.appendChild(s);
      }
    });
  }

  /* 市場估值: the daily median ratio of the market's common stocks over a chosen window, a dashed
     line at the full-history median, percentiles as the share of days below (ties count half) */
  var VKINDS = [["本益比", "pe_median", 1, " 倍"], ["股價淨值比", "pb_median", 2, " 倍"], ["殖利率", "dy_median", 2, "%"]];
  var VRANGES = [["1 年", 250], ["5 年", 1250], ["全部", 100000]];
  var MARKET_NOUNS = ["上市", "上櫃"], VAL_H = 180, PCT_MIN_DAYS = 60;  /* as on the stock pages */
  function sortedValues(list, col) {
    return list.map(function (r) { return r[col]; }).sort(function (a, b) { return a - b; });
  }
  function median(sorted) {
    var n = sorted.length, h = n >> 1;
    return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
  }
  /* index of the first value >= v (or > v when after), sorted ascending */
  function bound(sorted, v, after) {
    var lo = 0, hi = sorted.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (sorted[mid] < v || (after && sorted[mid] === v)) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  function percentile(sorted, v) {
    var below = bound(sorted, v, false), ties = bound(sorted, v, true) - below;
    return Math.round((below + ties / 2) / sorted.length * 100);
  }
  function drawValuation() {
    var all = rows(), sec = $("v-sec");
    sec.hidden = !VKINDS.some(function (k) { return all.some(function (r) { return isNum(r[k[1]]); }); });
    if (sec.hidden) return;
    segmented($("v-kinds"), VKINDS, state.vkind, function (i) { state.vkind = i; drawValuation(); });
    segmented($("v-ranges"), VRANGES, state.vrange, function (i) { state.vrange = i; drawValuation(); });
    var kind = VKINDS[state.vkind], name = kind[0], col = kind[1], noun = MARKET_NOUNS[state.market];
    var hist = all.filter(function (r) { return isNum(r[col]); }), sub = $("v-sub"), p = $("v-readout"), svg = $("v-chart");
    sub.textContent = "";
    if (hist.length < 2) {
      sub.textContent = noun + "股票" + name + "資料回補中。"; p.textContent = ""; svg.innerHTML = "";
      return;
    }
    function val(v) { return fmt(v, kind[2]) + kind[3]; }
    var histSorted = sortedValues(hist, col), med = median(histSorted), last = hist[hist.length - 1];
    var since = hist[0].date.slice(0, 4) + " 年以來", lead = document.createElement("strong");
    lead.className = "lead-in";
    lead.textContent = noun + "股票" + name + "中位數 " + val(last[col]) + (histSorted.length >= PCT_MIN_DAYS
      ? "，" + since + "第 " + percentile(histSorted, last[col]) + " 百分位。" : "。");
    sub.appendChild(lead);
    sub.appendChild(document.createTextNode("每日取" + noun + "普通股（不含 ETF）交易所公布數值的中位數" +
      (col === "pe_median" ? "，虧損股不計" : "") + "；虛線是 " + since + "的中位數 " + val(med) + "。"));
    var shown = hist.slice(-VRANGES[state.vrange][1]), n = shown.length;
    var span = n >= hist.length ? since : "近 " + VRANGES[state.vrange][0];
    var shownSorted = sortedValues(shown, col), ranked = shownSorted.length >= PCT_MIN_DAYS;
    svg.setAttribute("aria-label", noun + "股票" + name + "中位數走勢 " + ymd(shown[0].date) + " 到 " + ymd(last.date) +
      "，最新 " + val(last[col]) + "，虛線為 " + since + "中位數 " + val(med));
    lineChart(svg, shown.map(function (r) { return { d: r.date, v: r[col] }; }),
      { height: VAL_H, tone: "hold", ref: med, unit: kind[3] === "%" ? "%" : "", say: p }, function (i) {
        var r = i === null ? shown[n - 1] : shown[i];
        p.textContent = ymd(r.date) + " " + name + "中位數 " + val(r[col]) +
          (ranked ? "，" + span + "第 " + percentile(shownSorted, r[col]) + " 百分位" : "，資料累積中，暫不計算百分位");
      });
  }

  /* 市場廣度: the share of the market's common stocks closing above their own 20-, 60- and
     200-day averages (adjusted prices) and the day's 250-day new highs and lows, precomputed
     by research/report/breadth.py. The chart follows the index chart's range; the axis is
     fixed at 0-100% with a dashed line at 50%. Percents show as whole numbers and the
     percentile ranks the whole history, rounded and kept within 1-99 as in the daily brief. */
  var BREADTH_H = 180, BREADTH_MID = 50, PCT_SHOWN = [1, 99];
  function whole(v) { return isNum(v) ? Math.floor(v + 0.5) + "%" : "—"; }
  function count(v) { return isNum(v) ? fmt(v, 0) + " 檔" : "—"; }
  function shownRank(sorted, v) {
    var below = bound(sorted, v, false), ties = bound(sorted, v, true) - below;
    var raw = Math.floor((below + ties / 2) / sorted.length * 100 + 0.5);
    return Math.min(PCT_SHOWN[1], Math.max(PCT_SHOWN[0], raw));
  }
  function drawBreadth() {
    var all = rows(), sec = $("b-sec"), noun = MARKET_NOUNS[state.market];
    var hist = all.filter(function (r) { return isNum(r.b200); });
    sec.hidden = hist.length < 2;
    if (sec.hidden) return;
    var sub = $("b-sub"), p = $("b-readout"), svg = $("b-chart"), last = hist[hist.length - 1];
    var since = hist[0].date.slice(0, 4) + " 年以來", lead = document.createElement("strong");
    sub.textContent = "";
    lead.className = "lead-in";
    lead.textContent = noun + "普通股站上 200 日均線 " + whole(last.b200) + "，" + since + "第 " +
      shownRank(sortedValues(hist, "b200"), last.b200) + " 百分位。";
    sub.appendChild(lead);
    sub.appendChild(document.createTextNode("每日計算" + noun + "普通股（不含 ETF）收盤價高於自身 200 日均線的比例，" +
      "用還原股價；20 日、60 日為站上 20 日、60 日均線的比例，新高、新低為創 250 日新高、新低的家數。"));
    var shown = all.slice(-RANGES[state.range][1]).filter(function (r) { return isNum(r.b200); }), n = shown.length;
    if (n < 2) { p.textContent = "所選期間沒有資料。"; svg.innerHTML = ""; return; }
    svg.setAttribute("aria-label", noun + "普通股站上 200 日均線比例 " + ymd(shown[0].date) + " 到 " + ymd(shown[n - 1].date) +
      "，最新 " + whole(shown[n - 1].b200) + "，虛線為 50%");
    lineChart(svg, shown.map(function (r) { return { d: r.date, v: r.b200 }; }),
      { height: BREADTH_H, tone: "hold", ref: BREADTH_MID, unit: "%", min: 0, max: 100, say: p }, function (i) {
        var r = i === null ? shown[n - 1] : shown[i];
        p.textContent = ymd(r.date) + " 站上 200 日均線 " + whole(r.b200);
        p.appendChild(document.createElement("br"));
        p.appendChild(document.createTextNode("20 日 " + whole(r.b20) + "、60 日 " + whole(r.b60) +
          "；新高 " + count(r.nh) + "、新低 " + count(r.nl)));
      });
  }

  /* 市場狀態: the daily brief's 市場狀態總表 for the selected market, precomputed at build time by
     research/site/statedata.py. A row is an indicator's latest value and its percentile in the
     indicator's own history (a whole number kept within 1-99, as the brief prints it), with a
     sparkline of the percentile each trading day of the last year had at the time: 0 at the
     bottom, 100 at the top, dashed at 50, a gap where a day has no value. */
  var SPARK_H = 32, SPARK_PAD = 4, SPARK_MID = 50, SPARK_MIN_W = 48, SPARK_W = 112;
  function shownPct(v) { return Math.min(PCT_SHOWN[1], Math.max(PCT_SHOWN[0], Math.floor(v + 0.5))); }
  function sinceLabel(day) { return "比較起點 " + day.slice(0, 4) + "/" + Number(day.slice(5, 7)); }
  function sparkline(svg, path, col, label) {
    var W = Math.max(SPARK_MIN_W, Math.round(svg.parentNode.clientWidth || SPARK_W)), n = path.length;
    svg.setAttribute("viewBox", "0 0 " + W + " " + SPARK_H); svg.innerHTML = "";
    var x = function (i) { return SPARK_PAD + (n > 1 ? i / (n - 1) : 1) * (W - 2 * SPARK_PAD); };
    var y = function (v) { return SPARK_PAD + (100 - v) / 100 * (SPARK_H - 2 * SPARK_PAD); };
    el("line", { x1: 0, x2: W, y1: y(SPARK_MID), y2: y(SPARK_MID), "class": "mid" }, svg);
    var d = "", pen = false, first = null, last = null, lo = Infinity, hi = -Infinity;
    path.forEach(function (r, i) {
      var v = r[col];
      if (!isNum(v)) { pen = false; return; }
      d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = true;
      if (first === null) first = i;
      last = i; lo = Math.min(lo, v); hi = Math.max(hi, v);
    });
    var text = label + "近一年百分位";
    if (last === null) { svg.setAttribute("aria-label", text + "：沒有資料"); return; }
    el("path", { d: d, "class": "line" }, svg);
    el("circle", { cx: x(last), cy: y(path[last][col]), r: 2.5, "class": "dot" }, svg);
    text += "：" + ymd(path[first][0]) + " 第 " + shownPct(path[first][col]) + "，" + ymd(path[last][0]) + " 第 " +
      shownPct(path[last][col]) + "；期間最低第 " + shownPct(lo) + "、最高第 " + shownPct(hi);
    svg.setAttribute("aria-label", text);
    el("title", {}, svg).textContent = text;
  }
  function div(cls, text) {
    var n = document.createElement("div"); n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function drawRegime() {
    var block = state.data.regime, sec = $("s-sec"), m = block && block[MARKETS[state.market][1]];
    sec.hidden = !(m && m.rows && m.rows.length);
    if (sec.hidden) return;
    var sub = $("s-sub"), list = $("s-list"), cols = block.cols || [], sparks = [];
    sub.textContent = "";
    if (m.lead) {
      var lead = document.createElement("strong"); lead.className = "lead-in"; lead.textContent = m.lead;
      sub.appendChild(lead);
    }
    sub.appendChild(document.createTextNode("資料日 " + ymd(block.date) + "。百分位是當天數值在該指標歷史中的位置" +
      "（低於當天的交易日占比，相同的算一半），比較起點標在名稱下方；小圖是近一年每個交易日當時的百分位，" +
      "虛線為第 50 百分位。指數切換到櫃買即顯示上櫃。"));
    list.innerHTML = "";
    m.rows.forEach(function (r) {
      var li = document.createElement("li"), name = div("ms-name", r.label), since = document.createElement("span");
      since.className = "ms-since"; since.textContent = sinceLabel(r.since); name.appendChild(since);
      var box = div("ms-spark"), svg = el("svg", { role: "img" }, box), pct = div("ms-pct"), b = document.createElement("b");
      b.textContent = shownPct(r.pct);
      pct.appendChild(document.createTextNode("第 ")); pct.appendChild(b); pct.appendChild(document.createTextNode(" 百分位"));
      li.className = "ms-row";
      [name, div("ms-value", r.text), box, pct].forEach(function (c) { li.appendChild(c); });
      list.appendChild(li);
      sparks.push([svg, cols.indexOf(r.key), r.label]);
    });
    /* drawn once the rows are in the page, so each sparkline can take its box's width */
    sparks.forEach(function (s) { if (s[1] > 0) sparkline(s[0], m.path || [], s[1], s[2]); });
  }

  function render() {
    segmented($("k-markets"), MARKETS, state.market, function (i) { state.market = i; render(); });
    segmented($("k-ranges"), RANGES, state.range, function (i) { state.range = i; render(); });
    var r = rows();
    $("k-eyebrow").textContent = "大盤 · 資料截至 " + (r.length ? r[r.length - 1].date : "—");
    drawIndex();
    try { drawRegime(); } catch (e) { $("s-sec").hidden = true; console.error("市場狀態", e); }  /* a bad block only hides itself */
    drawBreadth(); drawFlows(); drawMargin(); drawValuation();
    try { drawLending(); } catch (e) { console.error("借券賣出餘額", e); }  /* a bad block only hides itself */
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
    var regime = d.regime;  /* 市場狀態: each market's percentile path is packed on its own */
    if (regime) MARKETS.forEach(function (m) { if (regime[m[1]]) regime[m[1]].path = unpackSeries(regime[m[1]].path || []); });
    return d;
  }
  fetch("../stock/data/market.json" + V).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (d) {
    state.data = unpack(d);
    if (new URLSearchParams(location.search).get("m") === "tpex") state.market = 1;
    render();
  }).catch(function () { $("k-meta").textContent = "大盤資料載入失敗，請稍後重新整理。"; });
  var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { if (state.data) render(); }, 150); });

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
      if (state.data) render();
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") side(false); else if (e.key === "Tab") trapTab(e); });
})();
