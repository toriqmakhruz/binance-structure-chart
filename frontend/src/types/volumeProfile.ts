export interface VolumeProfileSettings {
  // Calculation & Inputs
  rangeMode: 'visible' | 'fixed_bars'
  fixedLookbackBars: number
  rowSize: number // Number of horizontal price bins (e.g. 24, 40, 64, 100)
  valueAreaVolumePct: number // Default 70%
  volumeType: 'up_down' | 'total' | 'delta'

  // Layout & Placement
  placement: 'right' | 'left'
  widthPct: number // Max histogram width as % of chart area (15% - 45%)
  barOpacity: number // Opacity for Value Area bars (0.15 - 0.90)
  outsideVaOpacity: number // Opacity for bars outside Value Area (0.08 - 0.60)

  // Colors & Shading
  upVolumeColor: string
  downVolumeColor: string
  vaBackgroundShading: boolean
  vaBackgroundOpacity: number

  // Key Institutional Levels (POC, VAH, VAL)
  showPoc: boolean
  pocColor: string
  pocLineWidth: number
  pocExtendFull: boolean

  showVah: boolean
  vahColor: string
  vahLineWidth: number

  showVal: boolean
  valColor: string
  valLineWidth: number

  showLabels: boolean
  showHvnLvn: boolean
}

export const DEFAULT_VOLUME_PROFILE_SETTINGS: VolumeProfileSettings = {
  rangeMode: 'visible',
  fixedLookbackBars: 150,
  rowSize: 48,
  valueAreaVolumePct: 70,
  volumeType: 'up_down',

  placement: 'right',
  widthPct: 24,
  barOpacity: 0.52,
  outsideVaOpacity: 0.22,

  upVolumeColor: '#00c087',
  downVolumeColor: '#f6465d',
  vaBackgroundShading: true,
  vaBackgroundOpacity: 0.06,

  showPoc: true,
  pocColor: '#f0b90b',
  pocLineWidth: 1.8,
  pocExtendFull: true,

  showVah: true,
  vahColor: '#38bdf8',
  vahLineWidth: 1.2,

  showVal: true,
  valColor: '#38bdf8',
  valLineWidth: 1.2,

  showLabels: true,
  showHvnLvn: true
}
