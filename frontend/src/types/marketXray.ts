export interface StopLossPool {
  price: number;
  side: 'SHORT_LIQ' | 'LONG_LIQ';
  tier: string;
  est_usd: number;
  distance_pct: number;
  label: string;
}

export interface WhaleWall {
  price: number;
  usd_value: number;
  distance_pct: number;
}

export interface MarketXrayTelemetry {
  intent: 'HUNTING_SHORT_SL' | 'HUNTING_LONG_SL' | 'WHALE_BUY_WALL_DEFENSE' | 'WHALE_SELL_WALL_PRESSURE' | 'NEUTRAL_ACCUMULATION';
  confidence: number;
  intent_description: string;
  whale_bias_pct: number;
  retail_long_pct: number;
  top_trader_long_pct: number;
  taker_buy_pct: number;
  open_interest_coins: number;
  open_interest_usd: number;
}

export interface LimitOrderAverage {
  price: number;
  usd_value: number;
  distance_pct: number;
  order_count?: number;
  label: string;
}

export interface MarketXrayData {
  symbol: string;
  market: string;
  current_price: number;
  timestamp: number;
  telemetry: MarketXrayTelemetry;
  stop_loss_pools: {
    short_sl_magnet: StopLossPool;
    long_sl_cascade: StopLossPool;
  };
  whale_fortress: {
    top_bid_wall: WhaleWall;
    top_ask_wall: WhaleWall;
    total_inst_bids_usd: number;
    total_inst_asks_usd: number;
  };
  average_limit_orders?: {
    whale_avg_long: LimitOrderAverage;
    whale_avg_short: LimitOrderAverage;
    retail_avg_long: LimitOrderAverage;
    retail_avg_short: LimitOrderAverage;
  };
}
