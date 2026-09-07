# luv-stock — the LUV chart on Highcharts Stock, served by NiceGUI

Live at https://luv.pythai.net/stock (systemd `luv-stock.service`, `/home/luv/luv-stock`, venv, port 8793; Apache proxies
`/stock`, `/_nicegui/` and the `/_nicegui_ws/` websocket, with a relaxed CSP on those paths only).

Same doctrine as the site's own chart: the price is the Uniswap buy quote for one trillion LUV from the pair's reserves
(V2 x·y=k, 0.3% pool fee, the trade's impact), sell and mid beside it; ETH/USD from the V3 USDC/WETH pool bounded by the
V2 pairs, Binance hourly/minute closes through time so LUV's dollar price moves with ETH between LUV trades; every swap
since the seed fused with luv.oracle's minute samples; reserves re-read every 15 s. Ranges 24H/7D/30D/ALL, intervals 1m…1D,
units 1T LUV/USDC · WEI/LUV · luvwei/wei · luvwei/USDC · LUV/ETH; EMA ribbon, Bollinger, RSI, MACD computed here.

Element: [gnugui/nicegui-highcharts](https://github.com/gnugui/nicegui-highcharts) (fork of zauberzeug's), which bundles
**Highcharts 11.1.0 — a commercially licensed library**: free for personal/non-commercial use, a licence from
highcharts.com is required for commercial use. Highcharts itself is not in this repository; it arrives with the pip install.

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/pip install -e ../../nicegui-highcharts
.venv/bin/python main.py   # http://127.0.0.1:8793/stock
```
