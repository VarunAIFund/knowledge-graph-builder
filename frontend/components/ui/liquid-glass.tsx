"use client";

import React from "react";

interface GlassEffectProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  tint?: string;
}

/**
 * Apple-quality glass surface wrapper.
 * Wraps children with backdrop blur + specular highlight border.
 */
export const GlassEffect: React.FC<GlassEffectProps> = ({
  children,
  className = "",
  style = {},
  tint,
}) => (
  <div className={`relative overflow-hidden ${className}`} style={style}>
    {/* Frosted layer */}
    <div
      aria-hidden="true"
      className="absolute inset-0 rounded-[inherit]"
      style={{
        backdropFilter: "blur(32px) saturate(200%)",
        WebkitBackdropFilter: "blur(32px) saturate(200%)",
      }}
    />
    {/* Tint + specular border */}
    <div
      aria-hidden="true"
      className="absolute inset-0 rounded-[inherit]"
      style={{
        background: tint ?? "rgba(255, 255, 255, 0.07)",
        boxShadow: [
          "inset 0 1.5px 0 rgba(255, 255, 255, 0.24)",
          "inset 0 -1px 0 rgba(255, 255, 255, 0.06)",
          "inset 1px 0 0 rgba(255, 255, 255, 0.1)",
          "inset -1px 0 0 rgba(255, 255, 255, 0.04)",
          "0 0 0 1px rgba(255, 255, 255, 0.1)",
          "0 8px 32px rgba(0, 0, 0, 0.4)",
          "0 2px 8px rgba(0, 0, 0, 0.2)",
        ].join(", "),
      }}
    />
    <div className="relative z-10">{children}</div>
  </div>
);

/**
 * Invisible SVG filter for liquid glass distortion.
 * Place once in the page root — referenced by CSS backdrop-filter.
 */
export const GlassFilter: React.FC = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    style={{
      position: "absolute",
      width: 0,
      height: 0,
      overflow: "hidden",
      pointerEvents: "none",
    }}
  >
    <defs>
      <filter
        id="liquid-glass-filter"
        x="-10%"
        y="-10%"
        width="120%"
        height="120%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.03 0.06"
          numOctaves="1"
          seed="5"
          result="turbulence"
        />
        <feGaussianBlur in="turbulence" stdDeviation="2.5" result="blurredNoise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="blurredNoise"
          scale="14"
          xChannelSelector="R"
          yChannelSelector="G"
          result="displaced"
        />
        <feGaussianBlur in="displaced" stdDeviation="0.8" />
      </filter>

      {/* Subtle specular lighting filter for panels */}
      <filter id="glass-specular" x="0%" y="0%" width="100%" height="100%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
        <feSpecularLighting
          in="blur"
          surfaceScale="4"
          specularConstant="0.8"
          specularExponent="60"
          lightingColor="white"
          result="specLight"
        >
          <fePointLight x="-100" y="-200" z="400" />
        </feSpecularLighting>
        <feComposite
          in="specLight"
          in2="SourceAlpha"
          operator="in"
          result="litSurface"
        />
        <feComposite in="SourceGraphic" in2="litSurface" operator="over" />
      </filter>
    </defs>
  </svg>
);
