/** Line icons for the room: 16px, 1.6 stroke, currentColor. Decorative; the control around them carries the label. */
import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const IconComment = () => (
  <Icon>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z" />
  </Icon>
);
export const IconCompare = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M12 4v16" />
  </Icon>
);
export const IconDownload = () => (
  <Icon>
    <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
  </Icon>
);
export const IconKeyboard = () => (
  <Icon>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
  </Icon>
);
export const IconExpand = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);
export const IconShrink = () => (
  <Icon>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Icon>
);
export const IconPanel = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M15 4v16" />
  </Icon>
);
export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const IconChevron = ({ open }: { open?: boolean }) => (
  <span className={`inline-flex transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
    <Icon size={14}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  </span>
);
export const IconSend = () => (
  <Icon>
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </Icon>
);
