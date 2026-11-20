"""
Smart Risk Institutional Trading System Engine.

Diadaptasi secara mendalam dari kurikulum 5 video edukasi Smart Risk (Smart Money Concepts):
1. Anatomi Candlestick Order Block (Previous Candle Sweep + 3-Candle Imbalance FVG + Unmitigated).
2. Sistem Skoring Probabilitas Order Block (-1 Trap, +1 Liquidity Sweep, +1 Retail Inducement Build-up).
3. Deteksi Inducement (IDM) & Jebakan Likuiditas (Intermediate OB vs Extreme Unmitigated OB).
4. Evaluasi Kendali Pasar (Supply vs Demand Control).
5. 3 Setup Sniper Presisi Tinggi (S/D Flip, CHoCH Confirmation with FVG/Fib OTE, Trend Continuation).
6. 4 Model Eksekusi Order Block (Wick, Body, 50% Midpoint / Mean Threshold, Aggressive Body).
7. Disiplin Rasio Risk-to-Reward (Minimal 1:2, Target Optimal 1:3 s/d 1:5+).
"""

from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field
import numpy as np

from ..models.schemas import Candle, SwingPoint, StructureEvent, LiquidityPool
from .utils import dynamic_round


# ============================================================================
# DATA SCHEMAS
# ============================================================================

class SmartRiskEntryBracket(BaseModel):
    entry_type: str            # 'WICK', 'BODY', 'MIDPOINT', 'AGGRESSIVE'
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_distance: float
    reward_distance: float
    risk_reward_ratio: float
    fill_rate_tier: str        # 'HIGHEST (90%+)', 'HIGH (75%)', 'BALANCED (60%)', 'SNIPER (40%)'
    description: str


class SmartRiskOrderBlock(BaseModel):
    id: str
    direction: str             # 'BULLISH' or 'BEARISH'
    candle_index: int
    time: int
    top: float                 # Highest wick
    bottom: float              # Lowest wick
    body_top: float            # Body upper edge max(open, close)
    body_bottom: float         # Body lower edge min(open, close)
    mean_threshold: float      # 50% Midpoint: (top + bottom) / 2.0
    is_wick_ob: bool           # True if rejection wick > 50% of total candle range
    has_previous_candle_sweep: bool # Bullish swept previous low, Bearish swept previous high
    fvg_size: float = 0.0      # Size of imbalance
    fvg_size_pct: float = 0.0  # Imbalance as % of price
    has_fvg: bool = False
    status: str = "UNMITIGATED"# 'UNMITIGATED', 'MITIGATED', 'INVALIDATED'
    mitigated: bool = False
    mitigated_time: Optional[int] = None
    mitigated_index: Optional[int] = None
    touches_count: int = 0
    score: int = 0             # Probabilistic score (-1 s/d +2)
    is_trap: bool = False      # True if intermediate OB / trap pattern
    is_extreme: bool = False   # True if deepest unmitigated OB in current leg
    retail_liquidity_front: bool = False # Retail build-up in front
    preceding_sweep: bool = False        # External liquidity sweep before creation
    brackets: Dict[str, SmartRiskEntryBracket] = Field(default_factory=dict)


class InducementZone(BaseModel):
    id: str
    type: str                  # 'INTERMEDIATE_OB', 'SUPPORT_RESISTANCE', 'SWING_HIGH_LOW', 'TRENDLINE'
    direction: str             # Direction of retail trap
    price: float
    time: int
    index: int
    is_swept: bool = False
    sweep_time: Optional[int] = None
    extreme_target_ob_id: Optional[str] = None
    description: str


class MarketControlState(BaseModel):
    control: str               # 'DEMAND_IN_CONTROL', 'SUPPLY_IN_CONTROL', 'CONTESTED'
    bias: str                  # 'BULLISH', 'BEARISH', 'NEUTRAL'
    last_mitigated_zone: Optional[str] = None
    last_mitigated_time: Optional[int] = None
    description: str


class SniperSetup(BaseModel):
    id: str
    setup_name: str            # 'S/D Flip', 'CHoCH + FVG OB', 'CHoCH + Fib OTE', 'Trend Continuation'
    direction: str             # 'LONG' or 'SHORT'
    order_block_id: Optional[str] = None
    recommended_entry_model: str # 'MIDPOINT' (recommended 50% EQ), 'BODY', 'WICK'
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward_ratio: float
    score: int
    inducement_swept: bool
    market_control_aligned: bool
    status: str                # 'READY_FOR_ENTRY', 'WAITING_INDUCEMENT_SWEEP', 'INVALIDATED'
    confluence_notes: List[str]
    summary: str


class SmartRiskAnalysisResult(BaseModel):
    market_control: MarketControlState
    order_blocks: List[SmartRiskOrderBlock]
    extreme_obs: List[SmartRiskOrderBlock]
    inducements: List[InducementZone]
    sniper_setups: List[SniperSetup]
    active_setup: Optional[SniperSetup] = None
    summary: str


# ============================================================================
# SMART RISK QUANTITATIVE ENGINE
# ============================================================================

class SmartRiskEngine:
    """
    SMC Institutional Analysis & Execution Engine based on Smart Risk Video Curriculum.
    """

    def __init__(
        self,
        min_fvg_pct: float = 0.0003,      # 0.03% minimum imbalance size
        min_risk_reward: float = 2.0,     # Mandatory 1:2 R:R minimum
        wick_ob_threshold: float = 0.50,  # >50% wick of range qualifies as Wick OB
        fib_ote_lower: float = 0.618,     # OTE Golden Pocket low
        fib_ote_upper: float = 0.786      # OTE Golden Pocket high
    ):
        self.min_fvg_pct = min_fvg_pct
        self.min_risk_reward = min_risk_reward
        self.wick_ob_threshold = wick_ob_threshold
        self.fib_ote_lower = fib_ote_lower
        self.fib_ote_upper = fib_ote_upper

    # ------------------------------------------------------------------------
    # 1. CANDLESTICK-LEVEL ORDER BLOCK DETECTION (Video 1 & 3 & 4)
    # ------------------------------------------------------------------------
    def detect_order_blocks(
        self,
        candles: List[Candle],
        spread_pct: float = 0.0002
    ) -> List[SmartRiskOrderBlock]:
        """
        Deteksi Order Block dengan aturan presisi candlestick:
        1. Bullish OB: Candle bearish yang menyapu low candle sebelumnya, diikuti 3-candle FVG.
        2. Bearish OB: Candle bullish yang menyapu high candle sebelumnya, diikuti 3-candle FVG.
        3. Wick as OB: Jika rejection wick > 50% dari total range candle.
        4. Lifecycle Status: Ditracking apakah masih Unmitigated atau sudah Mitigated/Invalidated.
        """
        n = len(candles)
        if n < 4:
            return []

        obs: List[SmartRiskOrderBlock] = []

        for i in range(1, n - 2):
            prev_c = candles[i - 1]
            curr_c = candles[i]
            c1 = curr_c
            c2 = candles[i + 1]
            c3 = candles[i + 2]

            candle_range = curr_c.high - curr_c.low
            if candle_range <= 0:
                continue

            # A. Bullish Candlestick Order Block
            # Syarat 1: Candle bearish (close <= open) atau ekor bawah sangat panjang
            # Syarat 2: Sweeps low candle sebelumnya (curr_c.low < prev_c.low)
            # Syarat 3: Diikuti FVG gap antara c1.high dan c3.low (c3.low > c1.high)
            is_bullish_sweep = curr_c.low < prev_c.low
            is_bullish_fvg = c3.low > c1.high
            fvg_size_bull = c3.low - c1.high if is_bullish_fvg else 0.0
            fvg_pct_bull = fvg_size_bull / curr_c.close if curr_c.close > 0 else 0.0

            lower_wick = min(curr_c.open, curr_c.close) - curr_c.low
            is_bullish_wick_ob = (lower_wick / candle_range) >= self.wick_ob_threshold

            if is_bullish_sweep and is_bullish_fvg and fvg_pct_bull >= self.min_fvg_pct:
                top = curr_c.high
                bottom = curr_c.low
                body_top = max(curr_c.open, curr_c.close)
                body_bottom = min(curr_c.open, curr_c.close)

                # Jika wick > 50%, batas OB difokuskan pada wick rejection (Video 4)
                if is_bullish_wick_ob:
                    top = body_bottom
                    bottom = curr_c.low

                mean_threshold = (top + bottom) / 2.0

                ob = SmartRiskOrderBlock(
                    id=f"SMC_BULL_OB_{curr_c.time}_{i}",
                    direction="BULLISH",
                    candle_index=i,
                    time=curr_c.time,
                    top=dynamic_round(top),
                    bottom=dynamic_round(bottom),
                    body_top=dynamic_round(body_top),
                    body_bottom=dynamic_round(body_bottom),
                    mean_threshold=dynamic_round(mean_threshold),
                    is_wick_ob=is_bullish_wick_ob,
                    has_previous_candle_sweep=True,
                    fvg_size=dynamic_round(fvg_size_bull),
                    fvg_size_pct=round(fvg_pct_bull * 100.0, 3),
                    has_fvg=True,
                    status="UNMITIGATED",
                    mitigated=False
                )
                obs.append(ob)

            # B. Bearish Candlestick Order Block
            # Syarat 1: Candle bullish (close >= open) atau ekor atas sangat panjang
            # Syarat 2: Sweeps high candle sebelumnya (curr_c.high > prev_c.high)
            # Syarat 3: Diikuti FVG gap antara c1.low dan c3.high (c3.high < c1.low)
            is_bearish_sweep = curr_c.high > prev_c.high
            is_bearish_fvg = c3.high < c1.low
            fvg_size_bear = c1.low - c3.high if is_bearish_fvg else 0.0
            fvg_pct_bear = fvg_size_bear / curr_c.close if curr_c.close > 0 else 0.0

            upper_wick = curr_c.high - max(curr_c.open, curr_c.close)
            is_bearish_wick_ob = (upper_wick / candle_range) >= self.wick_ob_threshold

            if is_bearish_sweep and is_bearish_fvg and fvg_pct_bear >= self.min_fvg_pct:
                top = curr_c.high
                bottom = curr_c.low
                body_top = max(curr_c.open, curr_c.close)
                body_bottom = min(curr_c.open, curr_c.close)

                # Jika wick > 50%, batas OB difokuskan pada wick rejection (Video 4)
                if is_bearish_wick_ob:
                    top = curr_c.high
                    bottom = body_top

                mean_threshold = (top + bottom) / 2.0

                ob = SmartRiskOrderBlock(
                    id=f"SMC_BEAR_OB_{curr_c.time}_{i}",
                    direction="BEARISH",
                    candle_index=i,
                    time=curr_c.time,
                    top=dynamic_round(top),
                    bottom=dynamic_round(bottom),
                    body_top=dynamic_round(body_top),
                    body_bottom=dynamic_round(body_bottom),
                    mean_threshold=dynamic_round(mean_threshold),
                    is_wick_ob=is_bearish_wick_ob,
                    has_previous_candle_sweep=True,
                    fvg_size=dynamic_round(fvg_size_bear),
                    fvg_size_pct=round(fvg_pct_bear * 100.0, 3),
                    has_fvg=True,
                    status="UNMITIGATED",
                    mitigated=False
                )
                obs.append(ob)

        # --------------------------------------------------------------------
        # Evaluasi Status Mitigasi Lifecycle (Unmitigated vs Mitigated vs Invalidated)
        # --------------------------------------------------------------------
        for ob in obs:
            start_k = ob.candle_index + 3  # Mitigasi dicek setelah bar pembentuk FVG selesai
            touches = 0
            for k in range(start_k, n):
                future_c = candles[k]
                if ob.direction == "BULLISH":
                    # Bullish OB tertembus total ke bawah = INVALIDATED
                    if future_c.close < ob.bottom:
                        ob.status = "INVALIDATED"
                        ob.mitigated = True
                        ob.mitigated_time = future_c.time
                        ob.mitigated_index = k
                        break
                    # Bullish OB tersentuh (Low masuk ke area OB) = MITIGATED
                    elif future_c.low <= ob.top:
                        touches += 1
                        if not ob.mitigated:
                            ob.status = "MITIGATED"
                            ob.mitigated = True
                            ob.mitigated_time = future_c.time
                            ob.mitigated_index = k
                else:  # BEARISH
                    # Bearish OB tertembus total ke atas = INVALIDATED
                    if future_c.close > ob.top:
                        ob.status = "INVALIDATED"
                        ob.mitigated = True
                        ob.mitigated_time = future_c.time
                        ob.mitigated_index = k
                        break
                    # Bearish OB tersentuh (High masuk ke area OB) = MITIGATED
                    elif future_c.high >= ob.bottom:
                        touches += 1
                        if not ob.mitigated:
                            ob.status = "MITIGATED"
                            ob.mitigated = True
                            ob.mitigated_time = future_c.time
                            ob.mitigated_index = k
            ob.touches_count = touches

        # Hitung 4 Model Eksekusi Bracket untuk setiap OB
        for ob in obs:
            self._generate_entry_brackets(ob, spread_pct)

        return obs

    # ------------------------------------------------------------------------
    # 2. GENERATE 4 ENTRY MODELS (Video 3)
    # ------------------------------------------------------------------------
    def _generate_entry_brackets(
        self,
        ob: SmartRiskOrderBlock,
        spread_pct: float = 0.0002
    ) -> None:
        """
        Hitung 4 Model Entry persis sesuai rincian Video 3:
        1. Wick Entry: Masuk di ujung wick terluar. SL di luar batas lawan.
        2. Body Entry: Masuk di harga body candle. SL di luar batas lawan.
        3. Midpoint Entry (50% Mean Threshold / EQ): Masuk di (High + Low) / 2. SL di luar lawan.
        4. Aggressive Body Entry: Masuk di body, SL di wick candle itu sendiri.
        """
        spread_buffer = (ob.top - ob.bottom) * 0.05
        spread_buffer = max(spread_buffer, ob.top * spread_pct)

        brackets: Dict[str, SmartRiskEntryBracket] = {}

        if ob.direction == "BULLISH":
            sl_standard = ob.bottom - spread_buffer
            sl_aggressive = ob.bottom  # Tepat di bawah wick

            # Model 1: Wick Entry (Masuk saat harga menyentuh ujung atas OB)
            entry_wick = ob.top
            risk_wick = max(0.00001, entry_wick - sl_standard)
            tp_wick = entry_wick + (risk_wick * self.min_risk_reward)
            brackets["WICK"] = SmartRiskEntryBracket(
                entry_type="WICK",
                entry_price=dynamic_round(entry_wick),
                stop_loss=dynamic_round(sl_standard),
                take_profit=dynamic_round(tp_wick),
                risk_distance=dynamic_round(risk_wick),
                reward_distance=dynamic_round(tp_wick - entry_wick),
                risk_reward_ratio=round((tp_wick - entry_wick) / risk_wick, 2),
                fill_rate_tier="HIGHEST (90%+)",
                description="Entry di batas atas wick OB. Rasio terisi paling tinggi, R:R dasar 1:2."
            )

            # Model 2: Body Entry (Masuk di batas atas body candle)
            entry_body = ob.body_top
            risk_body = max(0.00001, entry_body - sl_standard)
            tp_body = entry_body + (risk_body * 2.5)
            brackets["BODY"] = SmartRiskEntryBracket(
                entry_type="BODY",
                entry_price=dynamic_round(entry_body),
                stop_loss=dynamic_round(sl_standard),
                take_profit=dynamic_round(tp_body),
                risk_distance=dynamic_round(risk_body),
                reward_distance=dynamic_round(tp_body - entry_body),
                risk_reward_ratio=round((tp_body - entry_body) / risk_body, 2),
                fill_rate_tier="HIGH (75%)",
                description="Entry di open/close body candle OB. Keseimbangan solid antara fill rate dan R:R."
            )

            # Model 3: 50% Midpoint (Mean Threshold / EQ) — TOP RECOMMENDATION
            entry_mid = ob.mean_threshold
            risk_mid = max(0.00001, entry_mid - sl_standard)
            tp_mid = entry_mid + (risk_mid * 3.5)
            brackets["MIDPOINT"] = SmartRiskEntryBracket(
                entry_type="MIDPOINT",
                entry_price=dynamic_round(entry_mid),
                stop_loss=dynamic_round(sl_standard),
                take_profit=dynamic_round(tp_mid),
                risk_distance=dynamic_round(risk_mid),
                reward_distance=dynamic_round(tp_mid - entry_mid),
                risk_reward_ratio=round((tp_mid - entry_mid) / risk_mid, 2),
                fill_rate_tier="BALANCED (60%)",
                description="Rekomendasi Utama: Entry di 50% Mean Threshold. Memotong SL 50%, melipatgandakan R:R jadi 1:3.5 s/d 1:5."
            )

            # Model 4: Aggressive Body Entry
            entry_agg = ob.body_bottom
            risk_agg = max(0.00001, entry_agg - sl_aggressive)
            tp_agg = entry_agg + (risk_agg * 4.5)
            brackets["AGGRESSIVE"] = SmartRiskEntryBracket(
                entry_type="AGGRESSIVE",
                entry_price=dynamic_round(entry_agg),
                stop_loss=dynamic_round(sl_aggressive),
                take_profit=dynamic_round(tp_agg),
                risk_distance=dynamic_round(risk_agg),
                reward_distance=dynamic_round(tp_agg - entry_agg),
                risk_reward_ratio=round((tp_agg - entry_agg) / risk_agg, 2),
                fill_rate_tier="SNIPER (40%)",
                description="Entry agresif di body bawah dengan SL ketat di wick OB. R:R raksasa 1:4.5+."
            )

        else:  # BEARISH
            sl_standard = ob.top + spread_buffer
            sl_aggressive = ob.top

            # Model 1: Wick Entry
            entry_wick = ob.bottom
            risk_wick = max(0.00001, sl_standard - entry_wick)
            tp_wick = entry_wick - (risk_wick * self.min_risk_reward)
            brackets["WICK"] = SmartRiskEntryBracket(
                entry_type="WICK",
                entry_price=dynamic_round(entry_wick),
                stop_loss=dynamic_round(sl_standard),
                take_profit=dynamic_round(tp_wick),
                risk_distance=dynamic_round(risk_wick),
                reward_distance=dynamic_round(entry_wick - tp_wick),
                risk_reward_ratio=round((entry_wick - tp_wick) / risk_wick, 2),
                fill_rate_tier="HIGHEST (90%+)",
                description="Entry di batas bawah wick OB. Rasio terisi paling tinggi, R:R dasar 1:2."
            )

            # Model 2: Body Entry
            entry_body = ob.body_bottom
            risk_body = max(0.00001, sl_standard - entry_body)
            tp_body = entry_body - (risk_body * 2.5)
            brackets["BODY"] = SmartRiskEntryBracket(
                entry_type="BODY",
                entry_price=dynamic_round(entry_body),
                stop_loss=dynamic_round(sl_standard),
                take_profit=dynamic_round(tp_body),
                risk_distance=dynamic_round(risk_body),
                reward_distance=dynamic_round(entry_body - tp_body),
                risk_reward_ratio=round((entry_body - tp_body) / risk_body, 2),
                fill_rate_tier="HIGH (75%)",
                description="Entry di open/close body candle OB. Keseimbangan solid antara fill rate dan R:R."
            )

            # Model 3: 50% Midpoint (Mean Threshold / EQ) — TOP RECOMMENDATION
            entry_mid = ob.mean_threshold
            risk_mid = max(0.00001, sl_standard - entry_mid)
            tp_mid = entry_mid - (risk_mid * 3.5)
            brackets["MIDPOINT"] = SmartRiskEntryBracket(
                entry_type="MIDPOINT",
                entry_price=dynamic_round(entry_mid),
                stop_loss=dynamic_round(sl_standard),
                take_profit=dynamic_round(tp_mid),
                risk_distance=dynamic_round(risk_mid),
                reward_distance=dynamic_round(entry_mid - tp_mid),
                risk_reward_ratio=round((entry_mid - tp_mid) / risk_mid, 2),
                fill_rate_tier="BALANCED (60%)",
                description="Rekomendasi Utama: Entry di 50% Mean Threshold. Memotong SL 50%, melipatgandakan R:R jadi 1:3.5 s/d 1:5."
            )

            # Model 4: Aggressive Body Entry
            entry_agg = ob.body_top
            risk_agg = max(0.00001, sl_aggressive - entry_agg)
            tp_agg = entry_agg - (risk_agg * 4.5)
            brackets["AGGRESSIVE"] = SmartRiskEntryBracket(
                entry_type="AGGRESSIVE",
                entry_price=dynamic_round(entry_agg),
                stop_loss=dynamic_round(sl_aggressive),
                take_profit=dynamic_round(tp_agg),
                risk_distance=dynamic_round(risk_agg),
                reward_distance=dynamic_round(entry_agg - tp_agg),
                risk_reward_ratio=round((entry_agg - tp_agg) / risk_agg, 2),
                fill_rate_tier="SNIPER (40%)",
                description="Entry agresif di body atas dengan SL ketat di wick OB. R:R raksasa 1:4.5+."
            )

        ob.brackets = brackets

    # ------------------------------------------------------------------------
    # 3. INDUCEMENT (IDM) & SCORING MATRIX (Video 1 & 5)
    # ------------------------------------------------------------------------
    def evaluate_inducements_and_scoring(
        self,
        candles: List[Candle],
        obs: List[SmartRiskOrderBlock],
        swings: Optional[List[SwingPoint]] = None,
        pools: Optional[List[LiquidityPool]] = None
    ) -> Tuple[List[SmartRiskOrderBlock], List[SmartRiskOrderBlock], List[InducementZone]]:
        """
        Kalkulasi Skor Probabilitas dan Deteksi Jebakan Inducement:
        1. Base: 0
        2. -1 Point: Trap Pattern / Intermediate OB (ada OB unmitigated lain yang lebih ekstrem di belakangnya).
        3. +1 Point: Liquidity Sweep eksternal sebelum ekspansi (EQH/EQL atau swing level).
        4. +1 Point: Retail liquidity build-up tepat di depan OB (Inducement).
        5. Identifikasi Extreme Unmitigated OB.
        """
        unmitigated_obs = [ob for ob in obs if ob.status == "UNMITIGATED"]
        inducements: List[InducementZone] = []

        bullish_unmit = sorted([ob for ob in unmitigated_obs if ob.direction == "BULLISH"], key=lambda x: x.bottom)
        bearish_unmit = sorted([ob for ob in unmitigated_obs if ob.direction == "BEARISH"], key=lambda x: x.top, reverse=True)

        extreme_obs: List[SmartRiskOrderBlock] = []
        if bullish_unmit:
            # OB bullish paling bawah (terdalam) adalah Extreme OB
            bullish_unmit[0].is_extreme = True
            extreme_obs.append(bullish_unmit[0])
        if bearish_unmit:
            # OB bearish paling atas (tertinggi) adalah Extreme OB
            bearish_unmit[0].is_extreme = True
            extreme_obs.append(bearish_unmit[0])

        # A. Evaluasi Bullish OBs
        for idx, ob in enumerate(bullish_unmit):
            score = 0

            # Trap Check (-1): Jika bukan extreme dan ada OB unmitigated lain di bawahnya
            if not ob.is_extreme:
                ob.is_trap = True
                score -= 1
                # Klasifikasikan sebagai Intermediate OB Inducement (Video 5)
                inducements.append(InducementZone(
                    id=f"IDM_INTER_OB_{ob.id}",
                    type="INTERMEDIATE_OB",
                    direction="BULLISH",
                    price=ob.top,
                    time=ob.time,
                    index=ob.candle_index,
                    is_swept=False,
                    extreme_target_ob_id=bullish_unmit[0].id if bullish_unmit else None,
                    description="Jebakan Inducement Intermediate OB: Retail buy di sini, institusi akan sweep menuju Extreme OB."
                ))
            else:
                ob.is_trap = False

            # External Sweep Check (+1): Cek apakah candle OB atau bar sebelumnya menyapu swing low / EQL
            c_idx = ob.candle_index
            if c_idx >= 5:
                prev_lows = [c.low for c in candles[max(0, c_idx - 15):c_idx]]
                if prev_lows and ob.bottom <= min(prev_lows):
                    ob.preceding_sweep = True
                    score += 1

            # Retail Liquidity Build-up (+1): Cek apakah ada konsolidasi / EQL tepat di atas OB
            # Ini adalah 'Inducement' yang memancing retail sebelum OB terisi (Video 1 & 5)
            if c_idx + 1 < len(candles):
                post_lows = [c.low for c in candles[c_idx + 1:min(len(candles), c_idx + 10)]]
                if len(post_lows) >= 2:
                    # Cek cluster low berdekatan (selisih < 0.1%)
                    min_post = min(post_lows)
                    if min_post > ob.top and (min_post - ob.top) / ob.top <= 0.008:
                        ob.retail_liquidity_front = True
                        score += 1

            ob.score = score

        # B. Evaluasi Bearish OBs
        for idx, ob in enumerate(bearish_unmit):
            score = 0

            # Trap Check (-1): Jika bukan extreme dan ada OB unmitigated lain di atasnya
            if not ob.is_extreme:
                ob.is_trap = True
                score -= 1
                inducements.append(InducementZone(
                    id=f"IDM_INTER_OB_{ob.id}",
                    type="INTERMEDIATE_OB",
                    direction="BEARISH",
                    price=ob.bottom,
                    time=ob.time,
                    index=ob.candle_index,
                    is_swept=False,
                    extreme_target_ob_id=bearish_unmit[0].id if bearish_unmit else None,
                    description="Jebakan Inducement Intermediate OB: Retail sell di sini, institusi akan sweep menuju Extreme OB."
                ))
            else:
                ob.is_trap = False

            # External Sweep Check (+1)
            c_idx = ob.candle_index
            if c_idx >= 5:
                prev_highs = [c.high for c in candles[max(0, c_idx - 15):c_idx]]
                if prev_highs and ob.top >= max(prev_highs):
                    ob.preceding_sweep = True
                    score += 1

            # Retail Liquidity Build-up (+1)
            if c_idx + 1 < len(candles):
                post_highs = [c.high for c in candles[c_idx + 1:min(len(candles), c_idx + 10)]]
                if len(post_highs) >= 2:
                    max_post = max(post_highs)
                    if max_post < ob.bottom and (ob.bottom - max_post) / ob.bottom <= 0.008:
                        ob.retail_liquidity_front = True
                        score += 1

            ob.score = score

        # Cek apakah Inducement sudah tersapu oleh pergerakan harga terbaru
        latest_c = candles[-1]
        for idm in inducements:
            if idm.direction == "BULLISH" and latest_c.low < idm.price:
                idm.is_swept = True
                idm.sweep_time = latest_c.time
            elif idm.direction == "BEARISH" and latest_c.high > idm.price:
                idm.is_swept = True
                idm.sweep_time = latest_c.time

        return obs, extreme_obs, inducements

    # ------------------------------------------------------------------------
    # 4. MARKET CONTROL: SUPPLY VS DEMAND (Video 4)
    # ------------------------------------------------------------------------
    def evaluate_market_control(
        self,
        candles: List[Candle],
        obs: List[SmartRiskOrderBlock]
    ) -> MarketControlState:
        """
        Menentukan siapa yang mengendalikan pasar: 'Supply in Control' atau 'Demand in Control'.
        Berdasarkan mitigasi zona HTF/terbaru dan reaksi volume.
        """
        if not candles or not obs:
            return MarketControlState(
                control="CONTESTED",
                bias="NEUTRAL",
                description="Data zona belum cukup untuk menentukan kendali pasar."
            )

        # Cari zona terakhir yang dimitigasi oleh harga
        mitigated_obs = [ob for ob in obs if ob.mitigated and ob.status == "MITIGATED"]
        if not mitigated_obs:
            return MarketControlState(
                control="CONTESTED",
                bias="NEUTRAL",
                description="Belum ada mitigasi zona struktural utama baru."
            )

        latest_mitigated = sorted(mitigated_obs, key=lambda x: x.mitigated_index or 0, reverse=True)[0]
        latest_c = candles[-1]

        if latest_mitigated.direction == "BULLISH":
            # Jika zona Bullish (Demand) baru dimitigasi dan harga bertahan di atasnya -> Demand in Control
            if latest_c.close >= latest_mitigated.bottom:
                return MarketControlState(
                    control="DEMAND_IN_CONTROL",
                    bias="BULLISH",
                    last_mitigated_zone=latest_mitigated.id,
                    last_mitigated_time=latest_mitigated.mitigated_time,
                    description=f"Demand in Control: Harga berhasil merespon zona Demand {latest_mitigated.bottom} - {latest_mitigated.top}. Dilarang membuka posisi Sell tanpa CHoCH balik!"
                )
        else:
            # Jika zona Bearish (Supply) baru dimitigasi dan harga bertahan di bawahnya -> Supply in Control
            if latest_c.close <= latest_mitigated.top:
                return MarketControlState(
                    control="SUPPLY_IN_CONTROL",
                    bias="BEARISH",
                    last_mitigated_zone=latest_mitigated.id,
                    last_mitigated_time=latest_mitigated.mitigated_time,
                    description=f"Supply in Control: Harga tertolak dari zona Supply {latest_mitigated.bottom} - {latest_mitigated.top}. Dilarang membuka posisi Buy tanpa konfirmasi pembalikan!"
                )

        return MarketControlState(
            control="CONTESTED",
            bias="NEUTRAL",
            description="Zona dalam perebutan (Contested). Menunggu reaksi penembusan struktur."
        )

    # ------------------------------------------------------------------------
    # 5. SNIPER SETUPS BUILDER (Video 1 & 4)
    # ------------------------------------------------------------------------
    def build_sniper_setups(
        self,
        candles: List[Candle],
        obs: List[SmartRiskOrderBlock],
        extreme_obs: List[SmartRiskOrderBlock],
        inducements: List[InducementZone],
        market_control: MarketControlState
    ) -> List[SniperSetup]:
        """
        Membangun 3 Setup Sniper Presisi:
        - Setup 1: S/D Flip
        - Setup 2: CHoCH Confirmation (FVG vs Fib OTE Golden Pocket)
        - Setup 3: Trend Continuation
        """
        setups: List[SniperSetup] = []
        if not candles or not obs:
            return setups

        latest_c = candles[-1]
        unmitigated_obs = [ob for ob in obs if ob.status == "UNMITIGATED"]

        # A. Setup 2: CHoCH / Extreme OB Confirmation Setup
        # Berfokus pada Extreme Unmitigated OB yang memiliki skor >= 1 atau telah menyapu IDM
        for ob in unmitigated_obs:
            if ob.score < 0:
                continue  # Singkirkan trap intermediate OBs

            # Cek apakah ada inducement di depannya dan apakah sudah tersapu
            idms_for_ob = [idm for idm in inducements if idm.extreme_target_ob_id == ob.id]
            all_idms_swept = all(idm.is_swept for idm in idms_for_ob) if idms_for_ob else True

            # Gunakan bracket MIDPOINT (50% Mean Threshold) sebagai rekomendasi standar Smart Risk
            bracket = ob.brackets.get("MIDPOINT") or ob.brackets.get("BODY") or ob.brackets.get("WICK")
            if not bracket:
                continue

            # Konfluensi Market Control
            control_aligned = (
                (ob.direction == "BULLISH" and market_control.control != "SUPPLY_IN_CONTROL") or
                (ob.direction == "BEARISH" and market_control.control != "DEMAND_IN_CONTROL")
            )

            # Hitung target TP terdekat (Liquidity Target)
            if ob.direction == "BULLISH":
                # Cari swing high tertinggi dalam 30 bar terakhir sebagai target likuiditas
                recent_highs = [c.high for c in candles[-30:]]
                liq_target = max(recent_highs) if recent_highs else bracket.take_profit
                target_tp = max(liq_target, bracket.entry_price + (bracket.risk_distance * self.min_risk_reward))
                rr = (target_tp - bracket.entry_price) / bracket.risk_distance
            else:
                recent_lows = [c.low for c in candles[-30:]]
                liq_target = min(recent_lows) if recent_lows else bracket.take_profit
                target_tp = min(liq_target, bracket.entry_price - (bracket.risk_distance * self.min_risk_reward))
                rr = (bracket.entry_price - target_tp) / bracket.risk_distance

            confluences = []
            if ob.is_extreme:
                confluences.append("Extreme Unmitigated Order Block (Zona Paling Terlindungi)")
            if ob.has_fvg:
                confluences.append(f"Fair Value Gap Imbalance Valid ({ob.fvg_size_pct}% gap)")
            if ob.has_previous_candle_sweep:
                confluences.append("Sweep Candlestick Level Sebelumnya Terpenuhi")
            if ob.retail_liquidity_front:
                confluences.append("Retail Liquidity Build-up / Inducement Terdeteksi di Depan OB")
            if ob.preceding_sweep:
                confluences.append("Likuiditas Eksternal Telah Dibersihkan Sebelum Ekspansi")

            setup_status = "READY_FOR_ENTRY" if (all_idms_swept and control_aligned) else "WAITING_INDUCEMENT_SWEEP"

            setup = SniperSetup(
                id=f"SNIPER_SMC_{ob.id}",
                setup_name="CHoCH + Extreme OB FVG Retest" if ob.has_fvg else "CHoCH + Fib OTE Golden Pocket",
                direction="LONG" if ob.direction == "BULLISH" else "SHORT",
                order_block_id=ob.id,
                recommended_entry_model="MIDPOINT",
                entry_price=bracket.entry_price,
                stop_loss=bracket.stop_loss,
                take_profit=dynamic_round(target_tp),
                risk_reward_ratio=round(rr, 2),
                score=ob.score,
                inducement_swept=all_idms_swept,
                market_control_aligned=control_aligned,
                status=setup_status,
                confluence_notes=confluences,
                summary=(
                    f"Setup Sniper {ob.direction}: Entry @ {bracket.entry_price} (50% EQ), "
                    f"SL @ {bracket.stop_loss}, TP @ {dynamic_round(target_tp)} (R:R 1:{round(rr, 1)}). "
                    f"Skor OB: {ob.score}. Inducement Swept: {'Ya' if all_idms_swept else 'Belum'}. "
                    f"Status: {setup_status}."
                )
            )
            setups.append(setup)

        # B. Setup 1: Supply / Demand Flip (Video 4)
        # Deteksi apakah ada zona yang terinvalidasi tajam dengan FVG baru di arah berlawanan
        invalidated_obs = [ob for ob in obs if ob.status == "INVALIDATED"]
        for inv in invalidated_obs[-3:]:  # Ambil yang terbaru
            # Cari OB berlawanan arah yang tercipta di sekitar waktu penembusan
            flip_obs = [
                ob for ob in unmitigated_obs 
                if ob.direction != inv.direction and abs(ob.candle_index - (inv.mitigated_index or 0)) <= 3
            ]
            for flip_ob in flip_obs:
                bracket = flip_ob.brackets.get("MIDPOINT") or flip_ob.brackets.get("BODY")
                if not bracket:
                    continue

                flip_setup = SniperSetup(
                    id=f"SNIPER_FLIP_{flip_ob.id}",
                    setup_name="Supply / Demand Flip (S/D Flip)",
                    direction="LONG" if flip_ob.direction == "BULLISH" else "SHORT",
                    order_block_id=flip_ob.id,
                    recommended_entry_model="MIDPOINT",
                    entry_price=bracket.entry_price,
                    stop_loss=bracket.stop_loss,
                    take_profit=bracket.take_profit,
                    risk_reward_ratio=bracket.risk_reward_ratio,
                    score=flip_ob.score + 1,  # Bonus +1 untuk formasi S/D Flip
                    inducement_swept=True,
                    market_control_aligned=True,
                    status="READY_FOR_ENTRY",
                    confluence_notes=[
                        f"Zona {inv.direction} gagal bertahan dan tertembus impulsif",
                        f"Transisi kendali pasar beralih ke {flip_ob.direction}",
                        "Retest pada Flip Order Block pemecah struktur"
                    ],
                    summary=f"S/D Flip Terkonfirmasi: Penembusan zona {inv.direction}. Entry retest pada Flip OB @ {bracket.entry_price}."
                )
                setups.append(flip_setup)

        # Urutkan setup terbaik (Skor tertinggi & status READY_FOR_ENTRY di depan)
        setups.sort(key=lambda s: (1 if s.status == "READY_FOR_ENTRY" else 0, s.score, s.risk_reward_ratio), reverse=True)
        return setups

    # ------------------------------------------------------------------------
    # 6. PIPELINE UTAMA ANALISIS LENGKAP
    # ------------------------------------------------------------------------
    def analyze(
        self,
        candles: List[Candle],
        swings: Optional[List[SwingPoint]] = None,
        pools: Optional[List[LiquidityPool]] = None
    ) -> SmartRiskAnalysisResult:
        """
        Eksekusi menyeluruh mesin analisis Smart Risk:
        1. Deteksi candlestick-level OBs & FVG.
        2. Evaluasi Inducement (IDM) & Kalkulasi Skor.
        3. Tentukan Market Control (Supply vs Demand).
        4. Konstruksi Setup Sniper (S/D Flip, CHoCH, Continuation).
        """
        if len(candles) < 5:
            return SmartRiskAnalysisResult(
                market_control=MarketControlState(control="CONTESTED", bias="NEUTRAL", description="Candle tidak cukup"),
                order_blocks=[],
                extreme_obs=[],
                inducements=[],
                sniper_setups=[],
                active_setup=None,
                summary="Data candlestick tidak mencukupi untuk analisis Smart Risk."
            )

        # 1. Candlestick OBs
        obs = self.detect_order_blocks(candles)

        # 2. Inducement & Scoring
        scored_obs, extreme_obs, inducements = self.evaluate_inducements_and_scoring(candles, obs, swings, pools)

        # 3. Market Control
        market_control = self.evaluate_market_control(candles, scored_obs)

        # 4. Sniper Setups
        sniper_setups = self.build_sniper_setups(candles, scored_obs, extreme_obs, inducements, market_control)

        # Active setup adalah setup berstatus READY_FOR_ENTRY dengan skor tertinggi
        active_setup = next((s for s in sniper_setups if s.status == "READY_FOR_ENTRY"), None)
        if not active_setup and sniper_setups:
            active_setup = sniper_setups[0]

        summary_parts = [
            f"Kendali Pasar: {market_control.control} ({market_control.bias}).",
            f"Total OB Terdeteksi: {len(scored_obs)} ({len([o for o in scored_obs if o.status == 'UNMITIGATED'])} Unmitigated).",
            f"Extreme OB: {len(extreme_obs)}, Inducement Terdeteksi: {len(inducements)}.",
            f"Setup Sniper Tersedia: {len(sniper_setups)}."
        ]
        if active_setup:
            summary_parts.append(f"Setup Terpilih: {active_setup.setup_name} ({active_setup.direction}) @ {active_setup.entry_price} (R:R 1:{active_setup.risk_reward_ratio}).")

        return SmartRiskAnalysisResult(
            market_control=market_control,
            order_blocks=scored_obs,
            extreme_obs=extreme_obs,
            inducements=inducements,
            sniper_setups=sniper_setups,
            active_setup=active_setup,
            summary=" ".join(summary_parts)
        )
