#!/usr/bin/env python3
"""LUV stock chart — NiceGUI + Highcharts Stock (vendored in nicegui_highcharts). Served at /stock behind luv.pythai.net."""
import asyncio, time
from nicegui import ui, app
from nicegui_highcharts import highchart
from luvstock import Market, UNITS, candles, ema, rsi, macd, bollinger

M = Market()
RANGES = [("24H", 86400e3, 300e3), ("7D", 7 * 86400e3, 3600e3), ("30D", 30 * 86400e3, 4 * 3600e3), ("ALL", None, 86400e3)]
INTERVALS = [("1m", 60e3), ("5m", 300e3), ("15m", 900e3), ("1h", 3600e3), ("4h", 14400e3), ("1D", 86400e3)]
GOLD, PINK, PURPLE, UP, DN, MUTED, SURFACE, GROUND, INK = "#e3b25f", "#ff006e", "#8338ec", "#0ecb81", "#ff4d6d", "#9b8bb0", "#150d22", "#0b0712", "#f7f2f9"

def options(unit: str, interval: float, ind: dict):
    label, _, fmt = UNITS[unit]; cs = candles(M, int(interval), unit)
    ohlc = [[b["t"], b["o"], b["h"], b["l"], b["c"]] for b in cs]; vol = [{"x": b["t"], "y": b["vol"], "color": UP if b["bvol"] >= b["svol"] else DN} for b in cs]
    closes_u = [b["c"] for b in cs]; closes_usd = [b["cu"] for b in cs]; ts = [b["t"] for b in cs]
    axes = [{"id": "price", "height": "60%", "labels": {"format": fmt, "align": "left", "x": 4, "style": {"color": MUTED}}, "gridLineColor": "rgba(247,242,249,.07)", "crosshair": {"label": {"enabled": True, "format": fmt, "backgroundColor": INK, "style": {"color": GROUND}}}, "opposite": True, "title": {"text": None}},
            {"id": "vol", "top": "62%", "height": "10%", "labels": {"enabled": False}, "gridLineWidth": 0, "title": {"text": None}, "opposite": True}]
    series = [{"type": "candlestick", "id": "luv", "name": label, "data": ohlc, "yAxis": "price", "color": DN, "upColor": UP, "lineColor": DN, "upLineColor": UP, "lastPrice": {"enabled": True, "color": GOLD, "label": {"enabled": True, "backgroundColor": GOLD, "style": {"color": GROUND}, "format": fmt}}, "tooltip": {"pointFormat": "O {point.open:.6f} · H {point.high:.6f} · L {point.low:.6f} · C {point.close:.6f}"}},
              {"type": "column", "id": "vol", "name": "volume, USD", "data": vol, "yAxis": "vol", "tooltip": {"valuePrefix": "$", "valueDecimals": 2}}]
    if ind.get("ribbon"):
        for p, col in ((8, "#ffb3c1"), (13, "#ff4d6d"), (21, PINK), (34, "#b23bd6"), (55, PURPLE)):
            series.append({"type": "line", "name": f"EMA {p}", "data": list(zip(ts, ema(closes_u, p))), "yAxis": "price", "color": col, "lineWidth": 1, "opacity": .6, "enableMouseTracking": False, "marker": {"enabled": False}})
    if ind.get("bb"):
        mid, up, lo = bollinger(closes_u)
        series.append({"type": "arearange", "name": "Bollinger 20,2", "data": [[t, l, u] for t, l, u in zip(ts, lo, up) if l is not None], "yAxis": "price", "color": PURPLE, "fillOpacity": .12, "lineWidth": 1, "marker": {"enabled": False}})
        series.append({"type": "line", "name": "BB mid", "data": [[t, m] for t, m in zip(ts, mid) if m is not None], "yAxis": "price", "color": GOLD, "lineWidth": 1, "marker": {"enabled": False}})
    top = 74
    if ind.get("rsi"):
        axes.append({"id": "rsi", "top": f"{top}%", "height": "12%", "min": 0, "max": 100, "tickPositions": [30, 70], "labels": {"style": {"color": MUTED}}, "gridLineColor": "rgba(247,242,249,.15)", "gridLineDashStyle": "Dash", "opposite": True, "title": {"text": "RSI 14", "style": {"color": MUTED}}, "plotBands": [{"from": 30, "to": 70, "color": "rgba(131,56,236,.10)"}]}); top += 13
        series.append({"type": "line", "name": "RSI 14", "data": [[t, v] for t, v in zip(ts, rsi(closes_usd)) if v is not None], "yAxis": "rsi", "color": PINK, "lineWidth": 1.5, "marker": {"enabled": False}})
    if ind.get("macd"):
        m_, s_, h_ = macd(closes_usd)
        axes.append({"id": "macd", "top": f"{top}%", "height": "12%", "labels": {"enabled": False}, "gridLineWidth": 0, "opposite": True, "title": {"text": "MACD 12·26·9", "style": {"color": MUTED}}}); top += 13
        series.append({"type": "column", "name": "MACD hist", "data": [{"x": t, "y": v, "color": UP if v >= 0 else DN} for t, v in zip(ts, h_) if v is not None], "yAxis": "macd", "opacity": .7})
        series.append({"type": "line", "name": "MACD", "data": [[t, v] for t, v in zip(ts, m_) if v is not None], "yAxis": "macd", "color": GOLD, "lineWidth": 1.4, "marker": {"enabled": False}})
        series.append({"type": "line", "name": "signal", "data": [[t, v] for t, v in zip(ts, s_) if v is not None], "yAxis": "macd", "color": PINK, "lineWidth": 1.4, "marker": {"enabled": False}})
    return {"chart": {"backgroundColor": SURFACE, "style": {"fontFamily": "ui-monospace, Menlo, monospace"}, "height": 560 if top <= 74 else 560 + (top - 74) * 6},
            "credits": {"enabled": False}, "title": {"text": None}, "rangeSelector": {"enabled": False}, "navigator": {"enabled": True, "series": {"color": GOLD, "lineWidth": 1}, "outlineColor": "#2c1f45", "maskFill": "rgba(227,178,95,.12)", "xAxis": {"labels": {"style": {"color": MUTED}}}},
            "scrollbar": {"enabled": False}, "legend": {"enabled": False}, "tooltip": {"split": False, "shared": True, "backgroundColor": INK, "style": {"color": GROUND}, "xDateFormat": "%Y-%m-%d %H:%M UTC"},
            "time": {"useUTC": True}, "xAxis": {"labels": {"style": {"color": MUTED}}, "gridLineColor": "rgba(247,242,249,.07)", "crosshair": {"label": {"enabled": True, "backgroundColor": INK, "style": {"color": GROUND}}}, "lineColor": "#2c1f45", "tickColor": "#2c1f45"},
            "yAxis": axes, "plotOptions": {"candlestick": {"pointPadding": .1, "groupPadding": .1}, "series": {"dataGrouping": {"enabled": False}, "animation": False}},
            "series": series}

@ui.page("/stock", title="LUV stock chart — SHAMBA LUV", dark=True, response_timeout=60)
async def stock_page():
    ui.add_head_html(f"<style>body{{background:{GROUND};color:{INK}}} .q-btn{{text-transform:none}}</style>")
    state = {"unit": "t1usdc", "range": 1, "interval": 3600e3, "ind": {"ribbon": False, "bb": False, "rsi": False, "macd": False}, "pinned": False}
    if not M.tape: await asyncio.get_event_loop().run_in_executor(None, M.load)
    with ui.column().classes("w-full max-w-6xl mx-auto p-4 gap-2"):
        with ui.row().classes("items-baseline gap-4"):
            ui.label("SHAMBA LUV").style(f"font-family:Georgia,serif;font-size:1.6rem;color:{INK}")
            head = ui.label().style(f"font-family:Georgia,serif;font-size:1.6rem;color:{GOLD}")
            sub = ui.label().style(f"color:{MUTED}")
        with ui.row().classes("items-center gap-2"):
            rng = ui.toggle({i: r[0] for i, r in enumerate(RANGES)}, value=1).props("dense no-caps color=grey-9 toggle-color=amber-8")
            unit = ui.toggle({k: v[0] for k, v in UNITS.items()}, value="t1usdc").props("dense no-caps color=grey-9 toggle-color=amber-8")
            itv = ui.toggle({v: k for k, v in INTERVALS}, value=3600e3).props("dense no-caps color=grey-9 toggle-color=amber-8")
        with ui.row().classes("items-center gap-2"):
            ui.label("indicators").style(f"color:{MUTED}")
            checks = {k: ui.checkbox(lbl, value=False).props("dense color=pink-7") for k, lbl in (("ribbon", "EMA ribbon"), ("bb", "Bollinger"), ("rsi", "RSI"), ("macd", "MACD"))}
        chart = highchart(options(state["unit"], state["interval"], state["ind"]), type="stockChart", extras=["stock", "price-indicator", "drag-panes", "full-screen", "exporting"]).classes("w-full")
        note = ui.label("Highcharts Stock via NiceGUI · the price is the Uniswap buy quote for one trillion LUV · reserves read every 15 s · ETH/USD: V3 USDC/WETH pool bounded by the V2 pairs").style(f"color:{MUTED};font-size:.85rem")
    def paint_head():
        q = M.live["quotes"]; head.text = f"${q['buy1T']:.6f} per trillion LUV"
        sub.text = f"buy ${q['buy1T']:.6f} · sell ${q['sell1T']:.6f} · mid ${q['mid1T']:.6f} · {M.live['nat']*1e18:.4f} wei per LUV × ETH ${M.live['eth']:.2f} · block {M.live['block']:,}"
    def redraw():
        state["ind"] = {k: c.value for k, c in checks.items()}
        o = options(state["unit"], state["interval"], state["ind"]); r = RANGES[state["range"]]
        if r[1]: o["xAxis"]["min"] = int(time.time() * 1000 - r[1])
        chart.options.clear(); chart.options.update(o); chart.update(); paint_head()
    def on_range(e):
        state["range"] = e.value
        if not state["pinned"]: state["interval"] = RANGES[e.value][2]; itv.value = state["interval"]
        redraw()
    rng.on_value_change(on_range); unit.on_value_change(lambda e: (state.__setitem__("unit", e.value), redraw())); itv.on_value_change(lambda e: (state.__setitem__("interval", e.value), state.__setitem__("pinned", True), redraw()))
    for c in checks.values(): c.on_value_change(lambda e: redraw())
    paint_head()
    async def live():
        try: await asyncio.get_event_loop().run_in_executor(None, M.tick); redraw()
        except Exception: pass
    async def full():
        try: await asyncio.get_event_loop().run_in_executor(None, M.load); redraw()
        except Exception: pass
    ui.timer(15, live); ui.timer(300, full)

def _preload():
    try: M.load()
    except Exception as e: print("preload failed:", e)
app.on_startup(lambda: asyncio.get_event_loop().run_in_executor(None, _preload))

ui.run(host="127.0.0.1", port=8793, show=False, reload=False, title="LUV stock chart", favicon="❤", storage_secret=None)
