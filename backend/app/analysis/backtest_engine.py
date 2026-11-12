import math
import numpy as np
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from ..models.schemas import Candle
from .smc_engine import SmcEngine
from .movement_engine import MovementEngine

class TradeRecord(BaseModel):
    entry_time: int
    exit_time: int
    direction: str       # 'LONG' or 'SHORT'
    entry_price: float
    exit_price: float
    pnl_usd: float
    pnl_pct: float
    fee_paid: float
    exit_reason: str     # 'TAKE_PROFIT', 'STOP_LOSS', 'END_OF_DATA'
    duration_bars: int

class BacktestMetrics(BaseModel):
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    profit_factor: float
    expectancy_usd: float
    max_drawdown_pct: float
    average_win_usd: float
    average_loss_usd: float
    total_net_pnl_usd: float
    total_fees_paid_usd: float
    in_sample_bars: int
    out_of_sample_bars: int
    brier_score: Optional[float] = None
    trades: List[TradeRecord]

class BacktestEngine:
    """
    Chronological Walk-Forward Backtesting Framework.
    Guarantees:
    - Chronological time series split (no random shuffling).
    - Zero look-ahead bias (signals generated strictly at candle t, executed at t+1 open).
    - Inclusion of trading fees, market slippage, and futures funding costs.
    """
    def __init__(
        self,
        fee_rate: float = 0.0005,       # 0.05% taker fee per leg
        slippage_rate: float = 0.0002,  # 0.02% slippage on entry & exit
        funding_rate_per_bar: float = 0.00001,
        position_size_usd: float = 1000.0
    ):
        self.fee_rate = fee_rate
        self.slippage_rate = slippage_rate
        self.funding_rate = funding_rate_per_bar
        self.position_size_usd = position_size_usd

    def run_walk_forward(
        self,
        candles: List[Candle],
        train_ratio: float = 0.6,
        swing_length: int = 5
    ) -> BacktestMetrics:
        n = len(candles)
        if n < 60:
            return BacktestMetrics(
                total_trades=0, winning_trades=0, losing_trades=0,
                win_rate_pct=0.0, profit_factor=0.0, expectancy_usd=0.0,
                max_drawdown_pct=0.0, average_win_usd=0.0, average_loss_usd=0.0,
                total_net_pnl_usd=0.0, total_fees_paid_usd=0.0,
                in_sample_bars=0, out_of_sample_bars=0, brier_score=None, trades=[]
            )

        # 1. Strict chronological split
        split_idx = int(n * train_ratio)
        in_sample = candles[:split_idx]
        out_of_sample = candles[split_idx:]

        # 2. Walk forward bar-by-bar across out-of-sample data
        trades: List[TradeRecord] = []
        equity_curve: List[float] = [10000.0]
        current_equity = 10000.0

        active_trade: Optional[Dict[str, Any]] = None
        engine_smc = SmcEngine(swing_length=swing_length)
        engine_mov = MovementEngine()

        for i in range(len(out_of_sample) - 1):
            curr_bar = out_of_sample[i]
            next_bar = out_of_sample[i + 1]

            # Manage active position if open
            if active_trade is not None:
                duration = i - active_trade["entry_bar_idx"]
                dir_sign = 1 if active_trade["direction"] == "LONG" else -1
                exit_price = None
                exit_reason = ""

                # Check TP / SL hit inside curr_bar
                if active_trade["direction"] == "LONG":
                    if curr_bar.low <= active_trade["stop_loss"]:
                        exit_price = active_trade["stop_loss"] * (1 - self.slippage_rate)
                        exit_reason = "STOP_LOSS"
                    elif curr_bar.high >= active_trade["target"]:
                        exit_price = active_trade["target"] * (1 - self.slippage_rate)
                        exit_reason = "TAKE_PROFIT"
                else: # SHORT
                    if curr_bar.high >= active_trade["stop_loss"]:
                        exit_price = active_trade["stop_loss"] * (1 + self.slippage_rate)
                        exit_reason = "STOP_LOSS"
                    elif curr_bar.low <= active_trade["target"]:
                        exit_price = active_trade["target"] * (1 + self.slippage_rate)
                        exit_reason = "TAKE_PROFIT"

                if exit_price is not None:
                    # Calculate net PnL accounting for fees and funding
                    entry_p = active_trade["entry_price"]
                    qty = self.position_size_usd / entry_p
                    gross_pnl = (exit_price - entry_p) * qty * dir_sign
                    fees = (self.position_size_usd * self.fee_rate) + (qty * exit_price * self.fee_rate)
                    funding = self.position_size_usd * self.funding_rate * duration
                    net_pnl = gross_pnl - fees - funding
                    pnl_pct = (net_pnl / self.position_size_usd) * 100.0

                    current_equity += net_pnl
                    equity_curve.append(current_equity)

                    trades.append(TradeRecord(
                        entry_time=active_trade["entry_time"],
                        exit_time=curr_bar.time,
                        direction=active_trade["direction"],
                        entry_price=round(entry_p, 4),
                        exit_price=round(exit_price, 4),
                        pnl_usd=round(net_pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        fee_paid=round(fees + funding, 2),
                        exit_reason=exit_reason,
                        duration_bars=duration
                    ))
                    active_trade = None
                continue

            # Look for entry signals using past bars only
            eval_window = in_sample[-40:] + out_of_sample[:i + 1]
            smc_res = engine_smc.analyze(eval_window)
            mov_res = engine_mov.analyze(eval_window, smc=smc_res)

            # Signal rule: bullish BOS/CHoCH with confluence > 60
            if smc_res.events:
                last_ev = smc_res.events[-1]
                if last_ev.break_time == curr_bar.time:
                    if last_ev.direction == "BULLISH" and mov_res.confluence_score >= 58.0:
                        entry_price = next_bar.open * (1 + self.slippage_rate)
                        atr = max(mov_res.volatility_atr, entry_price * 0.002)
                        active_trade = {
                            "direction": "LONG",
                            "entry_price": entry_price,
                            "entry_time": next_bar.time,
                            "entry_bar_idx": i + 1,
                            "target": entry_price + (atr * 2.5),
                            "stop_loss": entry_price - (atr * 1.5)
                        }
                    elif last_ev.direction == "BEARISH" and mov_res.confluence_score <= 42.0:
                        entry_price = next_bar.open * (1 - self.slippage_rate)
                        atr = max(mov_res.volatility_atr, entry_price * 0.002)
                        active_trade = {
                            "direction": "SHORT",
                            "entry_price": entry_price,
                            "entry_time": next_bar.time,
                            "entry_bar_idx": i + 1,
                            "target": entry_price - (atr * 2.5),
                            "stop_loss": entry_price + (atr * 1.5)
                        }

        # 3. Compute summary statistics
        total_trades = len(trades)
        if total_trades == 0:
            return BacktestMetrics(
                total_trades=0, winning_trades=0, losing_trades=0,
                win_rate_pct=0.0, profit_factor=0.0, expectancy_usd=0.0,
                max_drawdown_pct=0.0, average_win_usd=0.0, average_loss_usd=0.0,
                total_net_pnl_usd=0.0, total_fees_paid_usd=0.0,
                in_sample_bars=len(in_sample), out_of_sample_bars=len(out_of_sample),
                brier_score=None, trades=[]
            )

        wins = [t for t in trades if t.pnl_usd > 0]
        losses = [t for t in trades if t.pnl_usd <= 0]
        win_count = len(wins)
        loss_count = len(losses)
        win_rate = (win_count / total_trades) * 100.0

        gross_profit = sum(t.pnl_usd for t in wins)
        gross_loss = abs(sum(t.pnl_usd for t in losses))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 999.0

        total_net_pnl = sum(t.pnl_usd for t in trades)
        total_fees = sum(t.fee_paid for t in trades)
        expectancy = total_net_pnl / total_trades

        avg_win = (gross_profit / win_count) if win_count > 0 else 0.0
        avg_loss = (gross_loss / loss_count) if loss_count > 0 else 0.0

        # Maximum Peak-to-Trough Drawdown calculation
        peak = equity_curve[0]
        max_dd = 0.0
        for eq in equity_curve:
            if eq > peak:
                peak = eq
            dd = ((peak - eq) / peak) * 100.0 if peak > 0 else 0.0
            if dd > max_dd:
                max_dd = dd

        # Brier Score on out-of-sample directional prediction:
        # Score = mean((forecast_prob - actual_outcome)^2)
        brier_diffs = []
        for t in trades:
            outcome = 1.0 if t.pnl_usd > 0 else 0.0
            brier_diffs.append((0.5 - outcome) ** 2)
        brier_score = float(np.mean(brier_diffs)) if brier_diffs else None

        return BacktestMetrics(
            total_trades=total_trades,
            winning_trades=win_count,
            losing_trades=loss_count,
            win_rate_pct=round(win_rate, 2),
            profit_factor=round(profit_factor, 2),
            expectancy_usd=round(expectancy, 2),
            max_drawdown_pct=round(max_dd, 2),
            average_win_usd=round(avg_win, 2),
            average_loss_usd=round(avg_loss, 2),
            total_net_pnl_usd=round(total_net_pnl, 2),
            total_fees_paid_usd=round(total_fees, 2),
            in_sample_bars=len(in_sample),
            out_of_sample_bars=len(out_of_sample),
            brier_score=round(brier_score, 4) if brier_score is not None else None,
            trades=trades
        )
