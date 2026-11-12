def dynamic_round(val: float) -> float:
    """
    Rounds price dynamically according to order of magnitude,
    preventing low-price altcoins (PEPE, SHIB, DOGE, BONK) from collapsing to 0.0.
    """
    if val == 0 or val is None:
        return 0.0
    abs_v = abs(val)
    if abs_v >= 100:
        return round(val, 2)
    elif abs_v >= 1:
        return round(val, 4)
    elif abs_v >= 0.01:
        return round(val, 6)
    else:
        return round(val, 8)
