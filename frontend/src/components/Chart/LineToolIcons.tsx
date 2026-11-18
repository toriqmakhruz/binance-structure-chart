import React from 'react'

interface IconProps {
  className?: string
}

export const IconTrendline: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="5" cy="19" r="2" fill="currentColor" fillOpacity="0.2" />
    <circle cx="19" cy="5" r="2" fill="currentColor" fillOpacity="0.2" />
    <line x1="6.5" y1="17.5" x2="17.5" y2="6.5" />
  </svg>
)

export const IconRay: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="4" cy="20" r="2" fill="currentColor" fillOpacity="0.2" />
    <circle cx="13" cy="11" r="1.5" fill="currentColor" />
    <line x1="5.5" y1="18.5" x2="22" y2="2" />
  </svg>
)

export const IconInfoLine: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="4" y1="19" x2="20" y2="5" />
    <circle cx="4" cy="19" r="1.5" />
    <circle cx="20" cy="5" r="1.5" />
    <rect x="10" y="10" width="8" height="6" rx="1" strokeWidth="1.5" fill="#1e222d" />
    <line x1="12" y1="13" x2="16" y2="13" strokeWidth="1.2" />
  </svg>
)

export const IconExtendedLine: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="2" y1="22" x2="22" y2="2" />
    <circle cx="8" cy="16" r="1.5" fill="currentColor" />
    <circle cx="16" cy="8" r="1.5" fill="currentColor" />
  </svg>
)

export const IconTrendAngle: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="4" y1="19" x2="20" y2="19" />
    <line x1="4" y1="19" x2="18" y2="5" />
    <path d="M10 19 A6 6 0 0 0 8.5 14.5" strokeWidth="1.5" />
    <circle cx="4" cy="19" r="1.5" fill="currentColor" />
  </svg>
)

export const IconHorizontalLine: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="2" y1="12" x2="22" y2="12" />
    <circle cx="12" cy="12" r="2" fill="currentColor" fillOpacity="0.2" />
  </svg>
)

export const IconHorizontalRay: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="5" cy="12" r="2" fill="currentColor" fillOpacity="0.2" />
    <line x1="7" y1="12" x2="22" y2="12" />
  </svg>
)

export const IconVerticalLine: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="12" y1="2" x2="12" y2="22" />
    <circle cx="12" cy="12" r="2" fill="currentColor" fillOpacity="0.2" />
  </svg>
)

export const IconCrossline: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <circle cx="12" cy="12" r="2" fill="currentColor" fillOpacity="0.2" />
  </svg>
)

export const IconParallelChannel: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="3" y1="15" x2="17" y2="3" />
    <line x1="7" y1="21" x2="21" y2="9" />
    <line x1="5" y1="18" x2="19" y2="6" strokeDasharray="2 2" strokeWidth="1.2" />
    <circle cx="3" cy="15" r="1.5" />
    <circle cx="17" cy="3" r="1.5" />
    <circle cx="7" cy="21" r="1.5" />
  </svg>
)

export const IconRegressionTrend: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="3" y1="17" x2="21" y2="7" strokeWidth="2.2" />
    <line x1="3" y1="12" x2="21" y2="2" strokeWidth="1.2" strokeDasharray="2 2" />
    <line x1="3" y1="22" x2="21" y2="12" strokeWidth="1.2" strokeDasharray="2 2" />
  </svg>
)

export const IconFlatTopBottom: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="20" x2="21" y2="10" />
    <circle cx="3" cy="6" r="1.5" />
    <circle cx="21" cy="6" r="1.5" />
    <circle cx="3" cy="20" r="1.5" />
  </svg>
)

export const IconDisjointChannel: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="4" y1="10" x2="20" y2="4" />
    <line x1="4" y1="14" x2="20" y2="20" />
    <circle cx="4" cy="10" r="1.5" />
    <circle cx="4" cy="14" r="1.5" />
  </svg>
)

export const IconPitchfork: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="3" cy="12" r="1.5" />
    <circle cx="11" cy="5" r="1.5" />
    <circle cx="11" cy="19" r="1.5" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="11" y1="5" x2="21" y2="5" />
    <line x1="11" y1="19" x2="21" y2="19" />
    <line x1="11" y1="5" x2="11" y2="19" strokeWidth="1" strokeDasharray="2 2" />
  </svg>
)

export const IconSchiffPitchfork: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="5" cy="15" r="1.5" />
    <circle cx="12" cy="6" r="1.5" />
    <circle cx="12" cy="18" r="1.5" />
    <line x1="5" y1="15" x2="21" y2="10" />
    <line x1="12" y1="6" x2="22" y2="3" />
    <line x1="12" y1="18" x2="22" y2="15" />
  </svg>
)

export const IconModifiedSchiff: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="7" cy="10" r="1.5" />
    <circle cx="13" cy="5" r="1.5" />
    <circle cx="13" cy="19" r="1.5" />
    <line x1="7" y1="10" x2="21" y2="10" />
    <line x1="13" y1="5" x2="22" y2="5" />
    <line x1="13" y1="19" x2="22" y2="19" />
  </svg>
)

export const IconInsidePitchfork: React.FC<IconProps> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="5" cy="5" r="1.5" />
    <circle cx="5" cy="19" r="1.5" />
    <line x1="12" y1="12" x2="22" y2="12" />
    <line x1="5" y1="5" x2="20" y2="8" />
    <line x1="5" y1="19" x2="20" y2="16" />
  </svg>
)

