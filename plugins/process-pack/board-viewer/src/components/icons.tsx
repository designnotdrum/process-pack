// Hand-rolled, minimal inline icons. A whole icon-library dependency isn't
// worth the bytes for the six glyphs this app needs — see README for why.
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const IconUpload = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M12 16V4" />
    <path d="m6 9 6-6 6 6" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const IconAlert = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="m12 3 9.5 16.5H2.5Z" />
    <path d="M12 10v4" />
    <path d="M12 17.5v.01" />
  </svg>
);

export const IconGantt = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M4 6h8" />
    <path d="M4 12h14" />
    <path d="M4 18h6" />
  </svg>
);

export const IconKanban = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M4 4h16v16H4z" />
    <path d="M9 4v16" />
    <path d="M15 4v10" />
  </svg>
);

export const IconFile = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
  </svg>
);

export const IconLink = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <path d="M8 12h8" />
  </svg>
);
