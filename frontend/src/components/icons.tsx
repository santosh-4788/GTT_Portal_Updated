/**
 * Line icons for the admin portal.
 *
 * These replace the mixed bag of emoji and typographic symbols that was in the
 * sidebar — emoji render differently on every machine and gave the navigation an
 * uneven, unfinished baseline. All icons share one 24×24 grid, a 1.6 stroke and
 * `currentColor`, so they inherit their colour from the link around them.
 */
import { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const Base = ({ children, ...p }: P & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="18"
    height="18"
    aria-hidden="true"
    {...p}
  >
    {children}
  </svg>
);

export const IconDashboard = (p: P) => (
  <Base {...p}>
    <rect x="3" y="3" width="7.5" height="8.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
    <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.5" />
  </Base>
);

export const IconBookings = (p: P) => (
  <Base {...p}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M3 9.5h18M8 3v3M16 3v3" />
    <path d="M8.5 14.5l2 2 4.5-4.5" />
  </Base>
);

export const IconVendors = (p: P) => (
  <Base {...p}>
    <path d="M3 21h18" />
    <path d="M5 21V6.5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 13 6.5V21" />
    <path d="M13 21V11h5.5A1.5 1.5 0 0 1 20 12.5V21" />
    <path d="M8 9h2M8 13h2M8 17h2M16 15h1.5M16 18h1.5" />
  </Base>
);

export const IconBilling = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 8h6M9 11.5h6M13.5 8c1.6 0 2 1 2 1.8s-.4 1.7-2 1.7H9l4.5 4.5" />
  </Base>
);

export const IconInvoices = (p: P) => (
  <Base {...p}>
    <path d="M6 2.5h9.5L20 7v13.2a1.3 1.3 0 0 1-2 1.1l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2a1.3 1.3 0 0 1-2-1.1V3.8A1.3 1.3 0 0 1 6 2.5Z" />
    <path d="M15 2.5V7h4.5M8.5 11h7M8.5 14.5h4.5" />
  </Base>
);

export const IconPayments = (p: P) => (
  <Base {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 9.5h19M6 14.5h3.5" />
  </Base>
);

export const IconReports = (p: P) => (
  <Base {...p}>
    <path d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21" />
    <path d="M7 16.5V12M11.5 16.5V7.5M16 16.5v-6M20.5 16.5V5" />
  </Base>
);

export const IconSettings = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.7-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.3a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1.1-2.7l-.1-.1A1.8 1.8 0 1 1 7.9 4.7l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.3.9Z" />
  </Base>
);

export const IconUsers = (p: P) => (
  <Base {...p}>
    <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
    <circle cx="10" cy="8" r="3.5" />
    <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.6a3.5 3.5 0 0 1 0 6.8" />
  </Base>
);

export const IconAudit = (p: P) => (
  <Base {...p}>
    <path d="M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
    <path d="M9 8h6M9 12h6M9 16h3.5" />
  </Base>
);

export const IconTemplates = (p: P) => (
  <Base {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="2" />
    <path d="M3 9h18M9 9v11.5" />
  </Base>
);

export const IconSearch = (p: P) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Base>
);

export const IconMenu = (p: P) => (
  <Base {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);

export const IconClose = (p: P) => (
  <Base {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Base>
);

export const IconChevron = (p: P) => (
  <Base {...p}>
    <path d="m6 9 6 6 6-6" />
  </Base>
);

export const IconExternal = (p: P) => (
  <Base {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5" />
    <path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" />
  </Base>
);

export const IconLogout = (p: P) => (
  <Base {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Base>
);

export const IconKey = (p: P) => (
  <Base {...p}>
    <circle cx="7.5" cy="15.5" r="4" />
    <path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l2.5 2.5" />
  </Base>
);

export const IconPlus = (p: P) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

/* --- row actions --------------------------------------------------------- */

export const IconEdit = (p: P) => (
  <Base {...p}>
    <path d="M4 20h4L20 8a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="M15 6.5 17.5 9" />
  </Base>
);

export const IconDuplicate = (p: P) => (
  <Base {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 5.5A2 2 0 0 0 13.5 3.5H5.5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" />
  </Base>
);

export const IconTrash = (p: P) => (
  <Base {...p}>
    <path d="M4 6.5h16M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
    <path d="M6.5 6.5 7.4 19a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12.5" />
    <path d="M10.5 10.5v6M13.5 10.5v6" />
  </Base>
);

export const IconEye = (p: P) => (
  <Base {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const IconDownload = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5v11M8 11l4 4 4-4" />
    <path d="M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1" />
  </Base>
);

export const IconRefresh = (p: P) => (
  <Base {...p}>
    <path d="M3.5 12a8.5 8.5 0 0 1 14.6-6M20.5 12a8.5 8.5 0 0 1-14.6 6" />
    <path d="M18.5 2.5V6H15M5.5 21.5V18H9" />
  </Base>
);

export const IconPrint = (p: P) => (
  <Base {...p}>
    <path d="M6.5 9V3.5h11V9" />
    <path d="M6.5 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1.5" />
    <rect x="6.5" y="14" width="11" height="6.5" rx="1" />
  </Base>
);

export const IconWarning = (p: P) => (
  <Base {...p}>
    <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17v.3" />
  </Base>
);

export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Base>
);

/* --- public site --------------------------------------------------------- */

export const IconPhone = (p: P) => (
  <Base {...p}>
    <path d="M21 16.9v2.5a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 3.7 2 2 0 0 1 3.1 1.5h2.5a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L6.8 9.2a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
  </Base>
);

export const IconMail = (p: P) => (
  <Base {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="m3.5 7 7.4 5.2a2 2 0 0 0 2.2 0L20.5 7" />
  </Base>
);

export const IconPin = (p: P) => (
  <Base {...p}>
    <path d="M20 10.2c0 5.4-8 11.3-8 11.3s-8-5.9-8-11.3a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="2.8" />
  </Base>
);

export const IconLock = (p: P) => (
  <Base {...p}>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Base>
);

export const IconCalendar = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8.5 3.5v3M15.5 3.5v3" />
  </Base>
);

export const IconClock = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 1.9" />
  </Base>
);

/* --- service / benefit icons for the public site ------------------------- */

export const IconPlane = (p: P) => (
  <Base {...p}>
    <path d="M10.2 12.6 3 10.4V8.6l2.2.6 2 1.6 3.9-.6-3.4-5.5V3.4l1.9.5 4.5 5.6 4.4-.7c1.3-.2 2.5.7 2.5 2s-1.1 2.2-2.4 2.1l-4.5-.3-4.4 5.7-1.9.5v-1.7l3.4-5.5Z" />
  </Base>
);

export const IconCity = (p: P) => (
  <Base {...p}>
    <path d="M3 21h18" />
    <path d="M5 21V9l6-4v16M11 21V11l8-3v13" />
    <path d="M7.5 12h1M7.5 15.5h1M14.5 13h1M14.5 16.5h1" />
  </Base>
);

export const IconRoad = (p: P) => (
  <Base {...p}>
    <path d="M7 3 4 21M17 3l3 18" />
    <path d="M12 4v3M12 10.5v3M12 17v3" />
  </Base>
);

export const IconMap = (p: P) => (
  <Base {...p}>
    <path d="m9 3.5-5.4 2.2a1 1 0 0 0-.6.9v13a1 1 0 0 0 1.4.9L9 18.5l6 2 5.4-2.2a1 1 0 0 0 .6-.9v-13a1 1 0 0 0-1.4-.9L15 5.5l-6-2Z" />
    <path d="M9 3.5v15M15 5.5v15" />
  </Base>
);

export const IconEvent = (p: P) => (
  <Base {...p}>
    <path d="M12 2.5 3 20.5h18L12 2.5Z" />
    <path d="M12 8.5 7.5 17.5h9L12 8.5Z" />
  </Base>
);

export const IconShield = (p: P) => (
  <Base {...p}>
    <path d="M12 2.8 4.5 6v6c0 4.6 3.2 8.2 7.5 9.2 4.3-1 7.5-4.6 7.5-9.2V6L12 2.8Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Base>
);

export const IconSteering = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M3.3 10.5h17.4M12 15v6" />
  </Base>
);

export const IconPaste = (p: P) => (
  <Base {...p}>
    <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z" />
    <path d="M16 5h2a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
    <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" />
  </Base>
);

export const IconArrowRight = (p: P) => (
  <Base {...p}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </Base>
);

/* --- added with the portal redesign: masters, fleet, OnSheet, tables --- */

export const IconCar = (p: P) => (
  <Base {...p}>
    <path d="M5 16.5h14M6.5 16.5V19M17.5 16.5V19" />
    <path d="M4 16.5v-4.2l1.8-4.6A2 2 0 0 1 7.7 6.5h8.6a2 2 0 0 1 1.9 1.2l1.8 4.6v4.2" />
    <path d="M4.5 12.3h15" />
    <circle cx="8" cy="14.4" r=".6" />
    <circle cx="16" cy="14.4" r=".6" />
  </Base>
);

export const IconLayers = (p: P) => (
  <Base {...p}>
    <path d="m12 3.5 8.5 4.3L12 12 3.5 7.8 12 3.5Z" />
    <path d="m3.5 12 8.5 4.3 8.5-4.3" />
    <path d="m3.5 16.2 8.5 4.3 8.5-4.3" />
  </Base>
);

export const IconSheet = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M3.5 9h17M3.5 14.5h17M9 3.5v17M14.5 9v11.5" />
  </Base>
);

export const IconFilter = (p: P) => (
  <Base {...p}>
    <path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8L4 5Z" />
  </Base>
);

export const IconMore = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="5.5" r="1.1" fill="currentColor" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    <circle cx="12" cy="18.5" r="1.1" fill="currentColor" />
  </Base>
);

export const IconSort = (p: P) => (
  <Base {...p}>
    <path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5" />
  </Base>
);

export const IconUpload = (p: P) => (
  <Base {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </Base>
);

export const IconInbox = (p: P) => (
  <Base {...p}>
    <path d="M4 13.5 6.4 5.6A1.5 1.5 0 0 1 7.8 4.5h8.4a1.5 1.5 0 0 1 1.4 1.1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5Z" />
    <path d="M4 13.5h4.5l1.2 2.2h4.6l1.2-2.2H20" />
  </Base>
);

export const IconRupee = (p: P) => (
  <Base {...p}>
    <path d="M7 5h10M7 9h10M8 5c3.8 0 5.8 1.6 5.8 4S11.8 13 8 13l6.5 6" />
  </Base>
);

export const IconTrend = (p: P) => (
  <Base {...p}>
    <path d="M3.5 17 9 11.5l3.5 3.5 8-8" />
    <path d="M15 7h5.5v5.5" />
  </Base>
);

export const IconSparkle = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5 13.7 9 19 10.7 13.7 12.4 12 18l-1.7-5.6L5 10.7 10.3 9 12 3.5Z" />
    <path d="M18.5 16v4M16.5 18h4" />
  </Base>
);

export const IconBolt = (p: P) => (
  <Base {...p}>
    <path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3Z" />
  </Base>
);

export const IconIdCard = (p: P) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2.2" />
    <path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h4M14.5 13.5h3" />
  </Base>
);

export const IconChat = (p: P) => (
  <Base {...p}>
    <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4.5 20l1.4-4.3A7.5 7.5 0 1 1 20 12Z" />
    <path d="M9 11h6M9 14h4" />
  </Base>
);

export const IconStar = (p: P) => (
  <Base {...p}>
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.3l-4.8 2.6.9-5.4-3.9-3.8 5.4-.8L12 4Z" />
  </Base>
);

export const IconBook = (p: P) => (
  <Base {...p}>
    <path d="M4.5 5.5A2 2 0 0 1 6.5 3.5h12v14h-12a2 2 0 0 0-2 2v-14Z" />
    <path d="M4.5 19.5a2 2 0 0 0 2 2h12v-4M9 7.5h6" />
  </Base>
);

export const IconHistory = (p: P) => (
  <Base {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5M12 8v4.5l3 2" />
  </Base>
);

export const IconBell = (p: P) => (
  <Base {...p}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 7-3 8.5-3 8.5h18s-3-1.5-3-8.5" />
    <path d="M13.7 20.5a2 2 0 0 1-3.4 0" />
  </Base>
);

export const IconChevronLeft = (p: P) => (
  <Base {...p}>
    <path d="m15 5-7 7 7 7" />
  </Base>
);

export const IconChevronRight = (p: P) => (
  <Base {...p}>
    <path d="m9 5 7 7-7 7" />
  </Base>
);

export const IconRoute = (p: P) => (
  <Base {...p}>
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <path d="M8.2 18h7.3a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6h7.3" />
  </Base>
);

export const IconGauge = (p: P) => (
  <Base {...p}>
    <path d="M4.2 16.5a8.5 8.5 0 1 1 15.6 0" />
    <path d="m12 13 3.5-4.5" />
    <circle cx="12" cy="13.5" r="1.3" />
  </Base>
);

export const IconFile = (p: P) => (
  <Base {...p}>
    <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
    <path d="M13.5 3.5V9H19M8.5 13h7M8.5 16.5h5" />
  </Base>
);

/* --- language switch --- */
export const IconGlobe = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
  </Base>
);
