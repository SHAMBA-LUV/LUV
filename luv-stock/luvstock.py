"""luvstock.py — the LUV market data for the Highstock chart, computed server-side.
Sources: luv.pythai.net mirrors (market.json, market-history.json, market-trades.json), Binance ETH/USD klines
(1h for the pair's life, 1m for the last 48 h), the pair's reserves live from Ethereum (publicnode) with ETH/USD from
the V3 USDC/WETH pool bounded by the V2 pairs — the same doctrine as the site's own chart. THE PRICE = the Uniswap buy
quote for one trillion LUV (V2 x·y=k, 0.3% pool fee, the trade's own impact); sell and mid alongside."""
from __future__ import annotations
import json, math, time, urllib.request
SITE = "https://luv.pythai.net"; RPC = "https://ethereum-rpc.publicnode.com"
LUV = "0x2711111111683B8708cb9a48cBf36a51315F8254"; PAIR = "0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31"
USDC_WETH = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc"; DAI_WETH = "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11"; V3 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
PAIR_CREATED_MS = 1785116795000; SEED_NATIVE = 1e-17; T = 1e12
UA = {"User-Agent": "luv-stock/1.0"}

def _get(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r: return json.load(r)
def _rpc(calls):
    body = json.dumps([{"jsonrpc": "2.0", "id": i + 1, "method": m, "params": p} for i, (m, p) in enumerate(calls)]).encode()
    with urllib.request.urlopen(urllib.request.Request(RPC, body, {**UA, "content-type": "application/json"}), timeout=20) as r:
        rs = sorted(json.load(r), key=lambda x: x["id"]); return [x["result"] for x in rs]
def _words(h): h = h[2:]; return [int(h[i:i + 64], 16) for i in range(0, len(h) - len(h) % 64, 64)]

def read_pair() -> dict:
    sel = "0x0902f1ac"
    r = _rpc([("eth_call", [{"to": PAIR, "data": sel}, "latest"]), ("eth_call", [{"to": USDC_WETH, "data": sel}, "latest"]),
              ("eth_call", [{"to": DAI_WETH, "data": sel}, "latest"]), ("eth_call", [{"to": V3, "data": "0x3850c7bd"}, "latest"]), ("eth_blockNumber", [])])
    a, b, c = _words(r[0]), _words(r[1]), _words(r[2]); luv, weth = a[0] / 1e18, a[1] / 1e18
    e1 = (b[0] / 1e6) / (b[1] / 1e18); e2 = (c[0] / 1e18) / (c[1] / 1e18); sq = int(r[3][2:66], 16) / 2 ** 96; e3 = 1e12 / (sq * sq)
    es = sorted(x for x in (e1, e2, e3) if x > 0); med = es[len(es) // 2]; eth = e3 if abs(e3 / med - 1) < 0.02 else med
    nat = weth / luv
    buy_eth = (weth * T * 1000) / ((luv - T) * 997); sell_eth = (weth * T * 997) / (luv * 1000 + T * 997)
    return {"t": int(time.time() * 1000), "luv": luv, "weth": weth, "nat": nat, "eth": eth, "usd": nat * eth, "block": int(r[4], 16),
            "quotes": {"buy1T": buy_eth * eth, "sell1T": sell_eth * eth, "mid1T": nat * T * eth}, "buy_factor": buy_eth / (nat * T)}

def read_eth() -> list[tuple[int, float]]:
    out = []; fine_from = int(time.time() * 1000) - 48 * 3600e3
    start = PAIR_CREATED_MS
    while True:
        rows = _get(f"https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=1000&startTime={start}&endTime={int(fine_from)}")
        if not rows: break
        for k in rows:
            t0, o, h, l, c = int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4])
            out += [(t0 + 1, o), (t0 + 1200000, l if c >= o else h), (t0 + 2400000, h if c >= o else l), (t0 + 3599000, c)]
        if len(rows) < 1000: break
        start = int(rows[-1][0]) + 1
    start = int(fine_from)
    while True:
        rows = _get(f"https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=1000&startTime={start}")
        if not rows: break
        out += [(int(k[0]) + 59000, float(k[4])) for k in rows]
        if len(rows) < 1000: break
        start = int(rows[-1][0]) + 1
    return sorted(out)

class Market:
    def __init__(self): self.tape = []; self.live = None; self.eth = []; self.loaded_at = 0; self.oracle = None
    def eth_at(self, t):
        a = self.eth
        if not a: return None
        lo, hi = 0, len(a) - 1
        if t <= a[0][0]: return a[0][1]
        while lo < hi:
            m = (lo + hi + 1) // 2
            if a[m][0] <= t: lo = m
            else: hi = m - 1
        return a[lo][1]
    def load(self):
        self.eth = read_eth(); self.live = read_pair(); self.eth.append((self.live["t"], self.live["eth"]))
        try: self.oracle = _get(f"{SITE}/market.json")
        except Exception: pass
        trades = _get(f"{SITE}/market-trades.json").get("trades", []); hist = _get(f"{SITE}/market-history.json").get("points", [])
        tape = []
        for r in trades:
            nat, weth = float(r[6]), float(r[4]); e = self.eth_at(r[0]) or self.live["eth"]
            if nat > 0: tape.append({"t": r[0], "nat": nat, "usd": nat * e, "vol": weth * e, "buy": r[2] == "b", "trade": True})
        for p in hist:
            if p[1] > 0 and p[2] > 0:
                e = self.eth_at(p[0]); tape.append({"t": p[0], "nat": float(p[2]), "usd": float(p[2]) * (e or 0) if e else float(p[1]), "vol": 0, "buy": None, "trade": False})
        tape.sort(key=lambda x: x["t"])
        # ETH ticks: between LUV events the dollar price follows ETH
        k, last_nat, ticks = 0, None, []
        for et, ev in self.eth:
            while k < len(tape) and tape[k]["t"] <= et: last_nat = tape[k]["nat"]; k += 1
            near = (k > 0 and et - tape[k - 1]["t"] < 30000) or (k < len(tape) and tape[k]["t"] - et < 30000)
            if last_nat and not near and et > tape[0]["t"]: ticks.append({"t": et, "nat": last_nat, "usd": last_nat * ev, "vol": 0, "buy": None, "trade": False})
        tape += ticks; tape.sort(key=lambda x: x["t"])
        tape.append({"t": self.live["t"], "nat": self.live["nat"], "usd": self.live["usd"], "vol": 0, "buy": None, "trade": False, "live": True})
        self.tape = tape; self.loaded_at = time.time()
    def tick(self):
        try: self.oracle = _get(f"{SITE}/market.json")
        except Exception: pass
        self.live = read_pair(); self.eth.append((self.live["t"], self.live["eth"]))
        self.tape = [x for x in self.tape if not x.get("live")] + [{"t": self.live["t"], "nat": self.live["nat"], "usd": self.live["usd"], "vol": 0, "buy": None, "trade": False, "live": True}]

UNITS = {
    "t1usdc": ("1T LUV / USDC · buy", lambda s, f: s["usd"] * T * f, "${value:.6f}"),
    "weiluv": ("WEI / LUV", lambda s, f: s["nat"] * 1e18, "{value:.4f} wei"),
    "lwwei": ("luvwei / wei", lambda s, f: s["nat"], "{value:.4e}"),
    "lwusdc": ("luvwei / USDC", lambda s, f: s["usd"] / 1e18, "{value:.4e}"),
    "luveth": ("LUV / ETH (T)", lambda s, f: (1 / s["nat"]) / T if s["nat"] > 0 else None, "{value:.2f}T"),
}
def candles(m: Market, interval_ms: int, unit: str):
    _, val, _ = UNITS[unit]; f = m.live["buy_factor"] if m.live else 1.0; by = {}
    for s in m.tape:
        v = val(s, f)
        if v is None or not math.isfinite(v) or v <= 0: continue
        k = (s["t"] // interval_ms) * interval_ms; b = by.get(k)
        if b is None: b = by[k] = {"t": k, "o": v, "h": v, "l": v, "c": v, "cu": s["usd"], "vol": 0.0, "bvol": 0.0, "svol": 0.0, "n": 0}
        b["h"] = max(b["h"], v); b["l"] = min(b["l"], v); b["c"] = v; b["cu"] = s["usd"]
        if s["trade"]: b["vol"] += s["vol"]; b["n"] += 1; (b.__setitem__("bvol", b["bvol"] + s["vol"]) if s["buy"] else b.__setitem__("svol", b["svol"] + s["vol"]))
    out, prev = [], None
    for k in sorted(by):
        b = by[k]
        if prev and k - prev["t"] > interval_ms:
            g = prev["t"] + interval_ms
            while g < k and len(out) < 6000: out.append({"t": g, "o": prev["c"], "h": prev["c"], "l": prev["c"], "c": prev["c"], "cu": prev["cu"], "vol": 0.0, "bvol": 0.0, "svol": 0.0, "n": 0}); g += interval_ms
        out.append(b); prev = b
    return out[-6000:]
def ema(v, p):
    k, out, prev = 2 / (p + 1), [], None
    for x in v: prev = x if prev is None else x * k + prev * (1 - k); out.append(prev)
    return out
def rsi(v, p=14):
    out = [None] * len(v); g = l = 0.0
    for i in range(1, len(v)):
        d = v[i] - v[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= p:
            g += up; l += dn
            if i == p: g /= p; l /= p; out[i] = 100 if l == 0 else 100 - 100 / (1 + g / l)
        else:
            g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; out[i] = 100 if l == 0 else 100 - 100 / (1 + g / l)
    return out
def macd(v):
    e12, e26 = ema(v, 12), ema(v, 26); m = [e12[i] - e26[i] if i >= 25 else None for i in range(len(v))]
    valid = [x for x in m if x is not None]; sv = ema(valid, 9); sig = [None] * len(v); j = 0
    for i in range(len(v)):
        if m[i] is not None: sig[i] = sv[j] if j >= 8 else None; j += 1
    return m, sig, [m[i] - sig[i] if m[i] is not None and sig[i] is not None else None for i in range(len(v))]
def bollinger(v, p=20, k=2.0):
    mid, up, lo = [], [], []
    for i in range(len(v)):
        if i < p - 1: mid.append(None); up.append(None); lo.append(None); continue
        w = v[i - p + 1:i + 1]; m = sum(w) / p; sd = (sum((x - m) ** 2 for x in w) / p) ** 0.5
        mid.append(m); up.append(m + k * sd); lo.append(m - k * sd)
    return mid, up, lo
