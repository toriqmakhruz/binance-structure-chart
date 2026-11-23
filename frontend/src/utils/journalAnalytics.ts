import {
  JournalTradeRecord,
  PerformanceKpi,
  BotVsManualComparison,
  StrategyPerformanceItem,
  BehavioralHealthReport
} from '../types/journal'
import { TradeHistoryItem } from '../services/api'

/**
 * Hitung Key Performance Indicators (KPI) dari daftar catatan trade jurnal.
 */
export function calculatePerformanceKpi(trades: JournalTradeRecord[]): PerformanceKpi {
  const total = trades.length
  if (total === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRatePct: 0,
      totalGrossProfit: 0,
      totalGrossLoss: 0,
      totalFee: 0,
      netRealizedPnl: 0,
      profitFactor: 0,
      avgWinUsd: 0,
      avgLossUsd: 0,
      winLossRatio: 0,
      expectancyUsd: 0,
      avgRealizedRr: 0,
      avgPlannedRr: 0,
      maxProfitTradeUsd: 0,
      maxLossTradeUsd: 0,
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      avgHoldWinMinutes: 0,
      avgHoldLossMinutes: 0,
      holdTimeRatio: 1.0
    }
  }

  let wins = 0
  let losses = 0
  let breakevens = 0
  let grossProfit = 0
  let grossLoss = 0
  let totalFee = 0
  let netPnl = 0

  let maxProfit = 0
  let maxLoss = 0

  const winPnlList: number[] = []
  const lossPnlList: number[] = []
  const winHoldList: number[] = []
  const lossHoldList: number[] = []
  const rrList: number[] = []
  const plannedRrList: number[] = []

  // Untuk kalkulasi Max Drawdown kumulatif
  let peakCumulative = 0
  let runningPnl = 0
  let maxDdUsd = 0

  // Urutkan trade dari waktu paling awal ke paling baru untuk kurva drawdown
  const sortedChrono = [...trades].sort((a, b) => a.entryTime - b.entryTime)

  for (const t of sortedChrono) {
    const pnl = t.netPnl
    const fee = t.fee || 0
    totalFee += fee
    netPnl += pnl
    runningPnl += pnl

    if (runningPnl > peakCumulative) {
      peakCumulative = runningPnl
    }
    const currentDd = peakCumulative - runningPnl
    if (currentDd > maxDdUsd) {
      maxDdUsd = currentDd
    }

    if (t.realizedRr && t.realizedRr > 0) rrList.push(t.realizedRr)
    if (t.plannedRr && t.plannedRr > 0) plannedRrList.push(t.plannedRr)

    if (pnl > 0.001) {
      wins++
      grossProfit += pnl
      winPnlList.push(pnl)
      if (pnl > maxProfit) maxProfit = pnl
      if (t.holdDurationMinutes && t.holdDurationMinutes > 0) winHoldList.push(t.holdDurationMinutes)
    } else if (pnl < -0.001) {
      losses++
      grossLoss += Math.abs(pnl)
      lossPnlList.push(Math.abs(pnl))
      if (Math.abs(pnl) > maxLoss) maxLoss = Math.abs(pnl)
      if (t.holdDurationMinutes && t.holdDurationMinutes > 0) lossHoldList.push(t.holdDurationMinutes)
    } else {
      breakevens++
    }
  }

  const winRate = total > 0 ? (wins / total) * 100 : 0
  const lossRate = total > 0 ? losses / total : 0
  const winRateRatio = total > 0 ? wins / total : 0
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.0 : 0

  const avgWin = wins > 0 ? grossProfit / wins : 0
  const avgLoss = losses > 0 ? grossLoss / losses : 0
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99.0 : 0
  const expectancy = (winRateRatio * avgWin) - (lossRate * avgLoss)

  const avgRealizedRr = rrList.length > 0 ? rrList.reduce((a, b) => a + b, 0) / rrList.length : (avgLoss > 0 ? avgWin / avgLoss : 0)
  const avgPlannedRr = plannedRrList.length > 0 ? plannedRrList.reduce((a, b) => a + b, 0) / plannedRrList.length : 2.5

  const avgHoldWin = winHoldList.length > 0 ? winHoldList.reduce((a, b) => a + b, 0) / winHoldList.length : 0
  const avgHoldLoss = lossHoldList.length > 0 ? lossHoldList.reduce((a, b) => a + b, 0) / lossHoldList.length : 0
  const holdTimeRatio = avgHoldLoss > 0 ? avgHoldWin / avgHoldLoss : 1.0

  const maxDdPct = peakCumulative > 0 ? (maxDdUsd / peakCumulative) * 100 : 0

  return {
    totalTrades: total,
    winningTrades: wins,
    losingTrades: losses,
    breakevenTrades: breakevens,
    winRatePct: Math.round(winRate * 10) / 10,
    totalGrossProfit: Math.round(grossProfit * 100) / 100,
    totalGrossLoss: Math.round(grossLoss * 100) / 100,
    totalFee: Math.round(totalFee * 100) / 100,
    netRealizedPnl: Math.round(netPnl * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgWinUsd: Math.round(avgWin * 100) / 100,
    avgLossUsd: Math.round(avgLoss * 100) / 100,
    winLossRatio: Math.round(winLossRatio * 100) / 100,
    expectancyUsd: Math.round(expectancy * 100) / 100,
    avgRealizedRr: Math.round(avgRealizedRr * 100) / 100,
    avgPlannedRr: Math.round(avgPlannedRr * 100) / 100,
    maxProfitTradeUsd: Math.round(maxProfit * 100) / 100,
    maxLossTradeUsd: Math.round(maxLoss * 100) / 100,
    maxDrawdownUsd: Math.round(maxDdUsd * 100) / 100,
    maxDrawdownPct: Math.round(maxDdPct * 10) / 10,
    avgHoldWinMinutes: Math.round(avgHoldWin),
    avgHoldLossMinutes: Math.round(avgHoldLoss),
    holdTimeRatio: Math.round(holdTimeRatio * 100) / 100
  }
}

/**
 * Komparasi Performa Head-to-Head: BOT vs MANUAL.
 */
export function compareBotVsManual(trades: JournalTradeRecord[]): BotVsManualComparison {
  const botTrades = trades.filter((t) => t.source === 'bot')
  const manualTrades = trades.filter((t) => t.source === 'manual')

  const botKpi = calculatePerformanceKpi(botTrades)
  const manualKpi = calculatePerformanceKpi(manualTrades)

  let verdict = 'Data belum cukup untuk perbandingan signifikan.'
  let recommendation = 'Lanjutkan pencatatan trade untuk melihat pola statistik.'

  if (botKpi.totalTrades >= 3 && manualKpi.totalTrades >= 3) {
    if (botKpi.winRatePct > manualKpi.winRatePct && botKpi.netRealizedPnl > manualKpi.netRealizedPnl) {
      verdict = `Bot Otomatis unggul: Win rate bot (${botKpi.winRatePct}%) lebih tinggi dari manual (${manualKpi.winRatePct}%). Net PnL bot +$${botKpi.netRealizedPnl}.`
      recommendation = 'Pertahankan eksekusi via Bot otomatis. Kurangi intervensi manual yang memotong posisi terlalu cepat.'
    } else if (manualKpi.winRatePct > botKpi.winRatePct && manualKpi.netRealizedPnl > botKpi.netRealizedPnl) {
      verdict = `Eksekusi Manual unggul: Win rate manual (${manualKpi.winRatePct}%) mengungguli bot (${botKpi.winRatePct}%). Net PnL manual +$${manualKpi.netRealizedPnl}.`
      recommendation = 'Disiplin manual Anda sangat baik. Periksa parameter filter bot agar mendekati intuisi diskresioner Anda.'
    } else {
      verdict = `Performa seimbang: Bot Win Rate ${botKpi.winRatePct}% vs Manual ${manualKpi.winRatePct}%.`
      recommendation = 'Gunakan Bot untuk setup berbasis aturan ketat (SMC/Quant) dan manual untuk konfirmasi level likuiditas tinggi.'
    }
  } else if (botKpi.totalTrades > 0 && manualKpi.totalTrades === 0) {
    verdict = `Seluruh ${botKpi.totalTrades} trade dieksekusi secara otomatis oleh Bot. Net PnL: $${botKpi.netRealizedPnl}.`
    recommendation = 'Eksekusi bot berjalan konsisten tanpa bias emosional.'
  } else if (manualKpi.totalTrades > 0 && botKpi.totalTrades === 0) {
    verdict = `Seluruh ${manualKpi.totalTrades} trade dieksekusi secara manual. Net PnL: $${manualKpi.netRealizedPnl}.`
    recommendation = 'Pertimbangkan mengaktifkan modul otomatisasi bot untuk membebaskan waktu pemantauan Anda.'
  }

  return {
    bot: botKpi,
    manual: manualKpi,
    verdict,
    recommendation
  }
}

/**
 * Breakdown Performa Berdasarkan Strategi / Setup Engine.
 */
export function getStrategyPerformanceBreakdown(trades: JournalTradeRecord[]): StrategyPerformanceItem[] {
  const groups: Record<string, JournalTradeRecord[]> = {}

  for (const t of trades) {
    const strat = t.strategy || 'Manual Discretionary'
    if (!groups[strat]) groups[strat] = []
    groups[strat].push(t)
  }

  const items: StrategyPerformanceItem[] = []

  for (const [name, list] of Object.entries(groups)) {
    const kpi = calculatePerformanceKpi(list)
    items.push({
      strategyName: name,
      tradesCount: list.length,
      winRatePct: kpi.winRatePct,
      netPnlUsd: kpi.netRealizedPnl,
      profitFactor: kpi.profitFactor,
      avgRr: kpi.avgRealizedRr
    })
  }

  // Urutkan strategi paling profit di atas
  items.sort((a, b) => b.netPnlUsd - a.netPnlUsd)
  return items
}

/**
 * Deteksi Pola Perilaku & Kesehatan Psikologis Trading (Sesuai Kurikulum trade-journal).
 */
export function analyzeBehavioralHealth(trades: JournalTradeRecord[]): BehavioralHealthReport {
  if (trades.length === 0) {
    return {
      disciplineScore: 100,
      revengeTradesCount: 0,
      tiltTradesCount: 0,
      cuttingWinnersRisk: false,
      summaryNotes: ['Belum ada riwayat transaksi tercatat.']
    }
  }

  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime)
  let revengeCount = 0
  let tiltCount = 0
  const disciplineScores: number[] = []

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]
    if (curr.disciplineRating) disciplineScores.push(curr.disciplineRating)

    if (i > 0) {
      const prev = sorted[i - 1]
      // 1. Revenge trade: jika trade sebelumnya rugi dan trade ini dibuka < 15 menit sesudahnya
      if (prev.outcome === 'LOSS' && prev.exitTime) {
        const gapMinutes = (curr.entryTime - prev.exitTime) / (60 * 1000)
        if (gapMinutes >= 0 && gapMinutes <= 15) {
          curr.isRevengeTrade = true
          revengeCount++
        }

        // 2. Tilt trade: jika ukuran margin membesar > 1.5x setelah rugi
        const prevMargin = prev.margin || 0
        const currMargin = curr.margin || 0
        if (prevMargin > 0 && currMargin >= prevMargin * 1.5) {
          curr.isTiltTrade = true
          tiltCount++
        }
      }
    }
  }

  // 3. Cutting winners vs riding losers
  const kpi = calculatePerformanceKpi(trades)
  const cuttingWinners = kpi.avgHoldLossMinutes > 0 && kpi.avgHoldLossMinutes > kpi.avgHoldWinMinutes * 1.3

  // Hitung rata-rata skor disiplin (0 - 100%)
  const avgDiscipline = disciplineScores.length > 0
    ? (disciplineScores.reduce((a, b) => a + b, 0) / disciplineScores.length) * 10
    : 85.0

  const summaryNotes: string[] = []
  if (revengeCount > 0) {
    summaryNotes.push(`⚠️ Terdeteksi ${revengeCount} transaksi tergesa-gesa (Revenge Trading) yang dibuka <15 menit setelah rugi. Terapkan jeda istirahat wajib setelah SL.`)
  }
  if (tiltCount > 0) {
    summaryNotes.push(`⚠️ Terdeteksi ${tiltCount} transaksi dengan peningkatan ukuran modal tiba-tiba setelah rugi (Tilt/Martingale). Jaga alokasi margin tetap!`)
  }
  if (cuttingWinners) {
    summaryNotes.push(`⚠️ Risiko 'Cutting Winners & Riding Losers': Rata-rata posisi rugi ditahan (${kpi.avgHoldLossMinutes}m) lebih lama dari posisi menang (${kpi.avgHoldWinMinutes}m). Biarkan posisi menang mencapai TP institusional.`)
  }
  if (summaryNotes.length === 0) {
    summaryNotes.push('✅ Kedisiplinan trading sangat prima! Tidak ada pola revenge trading atau eskalasi ukuran modal yang merusak.')
  }

  return {
    disciplineScore: Math.round(avgDiscipline),
    revengeTradesCount: revengeCount,
    tiltTradesCount: tiltCount,
    cuttingWinnersRisk: cuttingWinners,
    summaryNotes
  }
}

// Cutoff epoch (21 Nov, 20:18 ETHUSDT trade = 1795267097824): remove all older non-ETH trades prior to this timestamp
const MIN_HISTORY_EPOCH_MS = 1795267097000

/**
 * Bersihkan riwayat trade lama selain ETHUSDT di atas (sebelum 1795267097000)
 * dan gabungkan pecahan partial-fill (micro-fills) pada simbol & waktu eksekusi yang sama (<= 60 detik)
 * menjadi 1 baris total Realized PnL utuh seperti di Binance Position History.
 */
export function consolidateAndCleanJournalRecords(
  records: JournalTradeRecord[]
): JournalTradeRecord[] {
  if (!Array.isArray(records) || records.length === 0) return []

  // 1. Filter: hapus semua riwayat lama sebelum trade ETHUSDT (1795267097000)
  const validRecords = records.filter((r) => {
    const t = r.exitTime || r.entryTime || 0
    return t >= MIN_HISTORY_EPOCH_MS
  })

  // Pisahkan catatan manual murni yang dibuat via form ("manual_...") dari catatan sinkronisasi bursa
  const manualFormRecords = validRecords.filter((r) => String(r.id).startsWith('manual_'))
  const exchangeRecords = validRecords.filter((r) => !String(r.id).startsWith('manual_'))

  // Jika sudah ada record terkonsolidasi ("pos_...") pada (symbol, window 60s),
  // buang pecahan lama ber-ID numerik pada window waktu yang sama agar tidak terhitung ganda
  const posConsolidated = exchangeRecords.filter((r) => String(r.id).startsWith('pos_'))
  const legacySplits = exchangeRecords.filter((r) => !String(r.id).startsWith('pos_'))

  const unmergedSplits = legacySplits.filter((leg) => {
    const legTime = leg.exitTime || leg.entryTime || 0
    return !posConsolidated.some(
      (pos) =>
        pos.symbol.toUpperCase() === leg.symbol.toUpperCase() &&
        Math.abs((pos.exitTime || pos.entryTime || 0) - legTime) <= 60000
    )
  })

  // Urutkan kronologis untuk menggabungkan partial-fill yang berada dalam window 60 detik
  const allExchange = [...posConsolidated, ...unmergedSplits].sort(
    (a, b) => (a.exitTime || a.entryTime || 0) - (b.exitTime || b.entryTime || 0)
  )

  const clustersBySymbol = new Map<string, JournalTradeRecord[]>()

  for (const rec of allExchange) {
    const sym = rec.symbol.toUpperCase()
    const recTime = rec.exitTime || rec.entryTime || 0
    const symList = clustersBySymbol.get(sym) || []

    if (symList.length > 0) {
      const last = symList[symList.length - 1]
      const lastTime = last.exitTime || last.entryTime || 0
      if (Math.abs(recTime - lastTime) <= 60000) {
        // Jika sama-sama ID "pos_..." yang identik, jangan dijumlahkan dua kali
        if (last.id === rec.id) {
          continue
        }
        const totalGross = Math.round(((last.grossPnl || last.netPnl) + (rec.grossPnl || rec.netPnl)) * 100) / 100
        const totalFee = Math.round(((last.fee || 0) + (rec.fee || 0)) * 10000) / 10000
        const totalNet = Math.round((last.netPnl + rec.netPnl) * 100) / 100
        const outcome = totalNet > 0.001 ? 'WIN' : totalNet < -0.001 ? 'LOSS' : 'BREAKEVEN'

        symList[symList.length - 1] = {
          ...last,
          id: String(last.id).startsWith('pos_') ? last.id : `pos_${sym}_${lastTime}`,
          grossPnl: totalGross,
          fee: totalFee,
          netPnl: totalNet,
          outcome,
          quantity: (last.quantity || 0) + (rec.quantity || 0),
          lessons: last.lessons || rec.lessons,
          rationale:
            last.rationale && last.rationale !== 'Realized PnL'
              ? last.rationale
              : rec.rationale || 'Realized PnL'
        }
        continue
      }
    }

    symList.push({
      ...rec,
      id: String(rec.id).startsWith('pos_') ? rec.id : `pos_${sym}_${recTime}`
    })
    clustersBySymbol.set(sym, symList)
  }

  const consolidatedExchange: JournalTradeRecord[] = []
  for (const list of clustersBySymbol.values()) {
    consolidatedExchange.push(...list)
  }

  const finalRecords = [...manualFormRecords, ...consolidatedExchange]
  finalRecords.sort((a, b) => (b.exitTime || b.entryTime) - (a.exitTime || a.entryTime))
  return finalRecords
}

/**
 * Sinkronisasi data server TradeHistoryItem ke JournalTradeRecord.
 */
export function mergeHistoryIntoJournal(
  serverHistory: TradeHistoryItem[],
  existingRecords: JournalTradeRecord[]
): JournalTradeRecord[] {
  const cleanedExisting = consolidateAndCleanJournalRecords(existingRecords)
  const existingMap = new Map<string, JournalTradeRecord>()
  for (const r of cleanedExisting) {
    existingMap.set(r.id, r)
  }

  const merged: JournalTradeRecord[] = [...cleanedExisting]

  for (const item of serverHistory) {
    if ((item.time || 0) < MIN_HISTORY_EPOCH_MS) continue

    const sym = item.symbol.toUpperCase()
    const canonicalId = String(item.id).startsWith('pos_') ? item.id : `pos_${sym}_${item.time}`

    if (!existingMap.has(canonicalId) && !existingMap.has(item.id)) {
      const netPnl = item.netPnl !== undefined ? item.netPnl : item.realizedPnl
      const outcome = netPnl > 0.001 ? 'WIN' : netPnl < -0.001 ? 'LOSS' : 'BREAKEVEN'

      const newRecord: JournalTradeRecord = {
        id: canonicalId,
        symbol: sym,
        market: 'futures',
        direction: (item.side.toUpperCase() === 'SHORT' || item.side.toUpperCase() === 'SELL') ? 'SHORT' : 'LONG',
        source: item.reason && item.reason.toLowerCase().includes('bot') ? 'bot' : 'manual',
        strategy: item.reason?.includes('Smart Risk')
          ? 'Smart Risk SMC'
          : item.reason?.includes('Craig')
          ? 'Craig 10x'
          : item.reason?.includes('Apex')
          ? 'Apex Quant'
          : 'Manual Discretionary',
        mode: item.is_simulated ? 'demo' : 'live',
        entryTime: item.time - (15 * 60 * 1000),
        exitTime: item.time,
        holdDurationMinutes: 15,
        entryPrice: item.entryPrice || item.price || 0,
        exitPrice: item.closePrice || item.price || 0,
        quantity: item.quantity || 0,
        margin: item.margin || 0,
        leverage: item.leverage || 10,
        grossPnl: item.grossPnl !== undefined ? item.grossPnl : item.realizedPnl,
        fee: item.fee || item.commission || 0,
        netPnl: netPnl,
        roePct: item.roePct || 0,
        outcome: outcome,
        rationale: item.reason || 'Realized PnL',
        disciplineRating: 9,
        emotionalState: 'calm',
        tags: [item.is_simulated ? 'demo' : 'live']
      }
      merged.unshift(newRecord)
      existingMap.set(canonicalId, newRecord)
    }
  }

  return consolidateAndCleanJournalRecords(merged)
}

/**
 * Ekspor Catatan Jurnal ke format CSV.
 */
export function exportJournalToCsv(trades: JournalTradeRecord[]): string {
  const headers = [
    'ID',
    'Tanggal Masuk',
    'Tanggal Keluar',
    'Simbol',
    'Arah',
    'Sumber (Bot/Manual)',
    'Strategi',
    'Mode',
    'Harga Entry',
    'Harga Exit',
    'Jumlah (Qty)',
    'Margin ($)',
    'Leverage',
    'Net PnL ($)',
    'ROE (%)',
    'Hasil (Outcome)',
    'Durasi (Menit)',
    'Skor Disiplin',
    'Emosi',
    'Alasan Entry (Rationale)',
    'Pelajaran (Lessons)'
  ]

  const rows = trades.map((t) => [
    `"${t.id}"`,
    `"${new Date(t.entryTime).toISOString()}"`,
    t.exitTime ? `"${new Date(t.exitTime).toISOString()}"` : '""',
    `"${t.symbol}"`,
    `"${t.direction}"`,
    `"${t.source.toUpperCase()}"`,
    `"${t.strategy}"`,
    `"${t.mode.toUpperCase()}"`,
    t.entryPrice,
    t.exitPrice || '',
    t.quantity,
    t.margin || '',
    t.leverage || '',
    t.netPnl,
    t.roePct || '',
    `"${t.outcome}"`,
    t.holdDurationMinutes || '',
    t.disciplineRating || '',
    `"${t.emotionalState || ''}"`,
    `"${(t.rationale || '').replace(/"/g, '""')}"`,
    `"${(t.lessons || '').replace(/"/g, '""')}"`
  ])

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
}
