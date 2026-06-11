import React from "react";

interface RdatLogoProps {
  className?: string;
  size?: number;
}

/**
 * RDAT Copilot v1.0 Logo SVG
 * A stylized open book with bidirectional translation arrows,
 * representing computer-assisted translation between English and Arabic.
 */
export function RdatLogo({ className = "", size = 24 }: RdatLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Background rounded square */}
      <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#bg-gradient)" />
      
      {/* Open book shape */}
      <path
        d="M256 140 C220 140 160 145 130 155 L130 360 C160 350 220 345 256 345 C292 345 352 350 382 360 L382 155 C352 145 292 140 256 140Z"
        fill="url(#book-gradient)"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="2"
      />
      
      {/* Book spine / center crease */}
      <line x1="256" y1="140" x2="256" y2="345" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
      
      {/* Left page lines (English/LTR) */}
      <line x1="150" y1="185" x2="240" y2="185" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" />
      <line x1="150" y1="210" x2="230" y2="210" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="150" y1="235" x2="235" y2="235" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
      <line x1="150" y1="260" x2="220" y2="260" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
      <line x1="150" y1="285" x2="238" y2="285" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" />
      
      {/* Right page lines (Arabic/RTL) */}
      <line x1="272" y1="185" x2="362" y2="185" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round" />
      <line x1="282" y1="210" x2="362" y2="210" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="277" y1="235" x2="362" y2="235" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" />
      <line x1="292" y1="260" x2="362" y2="260" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
      <line x1="274" y1="285" x2="362" y2="285" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" />
      
      {/* Bidirectional translation arrows (L-R on top, R-L on bottom) */}
      {/* Left-to-right arrow (English → Arabic) */}
      <path
        d="M170 330 L290 330"
        stroke="#818cf8"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M280 320 L295 330 L280 340"
        stroke="#818cf8"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Right-to-left arrow (Arabic → English) */}
      <path
        d="M342 330 L222 330"
        stroke="#a5b4fc"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M232 320 L217 330 L232 340"
        stroke="#a5b4fc"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Sparkle accent dots */}
      <circle cx="180" cy="168" r="4" fill="#c7d2fe" opacity="0.8" />
      <circle cx="332" cy="168" r="4" fill="#c7d2fe" opacity="0.8" />
      <circle cx="256" cy="320" r="3" fill="#e0e7ff" opacity="0.9" />
      
      <defs>
        <linearGradient id="bg-gradient" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#312e81" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id="book-gradient" x1="130" y1="140" x2="382" y2="360" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4338ca" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default RdatLogo;
