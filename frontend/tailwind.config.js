/** @type {import('tailwindcss').Config} */

/**
 * Design tokens for Gupta Tours & Travels.
 *
 * One accent, one neutral, three status colours. Gold belongs to the brand mark
 * and the public site's hero — it is deliberately NOT part of the admin palette,
 * because two competing accents is what made the portal look inconsistent.
 *
 * Neutrals carry a slight blue bias so they sit with the cyan rather than
 * fighting it; a pure grey next to this accent reads as unconsidered.
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* The single accent. 500 is the brand cyan from the logo; 600/700 are
           the only ones dark enough for text on white (4.5:1 and above). */
        /* Read from CSS variables so the staff portal can carry its own,
           more formal accent (see `html.theme-admin` in index.css) while the
           public website keeps the logo cyan. The defaults below are the
           cyan; `<alpha-value>` keeps opacity utilities like bg-brand-50/45. */
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },

        /* Two more status hues, so every stage of a trip reads differently:
           violet = allotted, teal = under way. Status only, never decoration. */
        violet: {
          50: '#F3F0FD', 100: '#E6E0FA', 500: '#6D55D8', 600: '#5940C2', 700: '#4731A0',
        },
        teal: {
          50: '#E7F7F6', 100: '#C9EDEA', 500: '#13968C', 600: '#0E7C74', 700: '#0B635D',
        },

        /* Neutral ramp. 50 is the app background, white is the card surface. */
        ink: {
          50: '#F5F7FA',
          100: '#EDF1F6',
          200: '#E3E8EF',
          300: '#CDD5DF',
          400: '#9DAAB9',
          500: '#7A8CA0',
          600: '#5B6E84',
          700: '#46586C',
          800: '#2E3E4F',
          900: '#101C2B',
          950: '#0A131D',
        },

        /* Sidebar / dark chrome. */
        nav: {
          DEFAULT: '#0E1F2E',
          soft: '#162C3E',
          line: 'rgba(255,255,255,0.08)',
        },

        /* Status only — never decoration. */
        ok: {
          50: '#E9F7F0', 100: '#CFEEE0', 500: '#12996A', 600: '#0F7B52', 700: '#0C6343',
        },
        warn: {
          50: '#FDF4E3', 100: '#FAE7C2', 500: '#C1810E', 600: '#9A6608', 700: '#7A5107',
        },
        danger: {
          50: '#FDECEA', 100: '#FBD8D3', 500: '#DC3A2B', 600: '#B42318', 700: '#8F1C13',
        },

        /* Brand mark only. */
        gold: {
          100: '#FDF7D9', 200: '#F9EEA8', 300: '#F2E272', 400: '#EFDF6B', 500: '#D9C33A',
          600: '#B49E22', 700: '#8C7A1C',
        },
      },

      /* The "… Variable" names come from the bundled @fontsource-variable
         packages; the plain names are kept as a fallback in case the fonts
         are ever served from elsewhere. */
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        // Sora reads technical and mobility-flavoured without the geometric
        // sameness of the usual marketing faces.
        display: ['"Sora Variable"', 'Sora', '"Inter Variable"', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },

      /* A real type scale, so headings and labels stop drifting per page. */
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],      // 11px — labels
        xs: ['0.75rem', { lineHeight: '1.125rem' }],       // 12px — meta
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],      // 13px — UI default
        base: ['0.875rem', { lineHeight: '1.4rem' }],      // 14px — body
        md: ['0.9375rem', { lineHeight: '1.5rem' }],       // 15px
        lg: ['1.0625rem', { lineHeight: '1.55rem' }],      // 17px — card titles
        xl: ['1.25rem', { lineHeight: '1.7rem' }],         // 20px
        '2xl': ['1.5rem', { lineHeight: '1.95rem' }],      // 24px — page titles
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1.05' }],
        '6xl': ['3.75rem', { lineHeight: '1.03' }],
      },

      borderRadius: {
        sm: '0.375rem',
        DEFAULT: '0.5rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
      },

      boxShadow: {
        /* Three layers each, because that is what makes a surface read as a
           real object: a tight contact shadow that grounds the edge, a mid
           shadow for the form, and a wide faint one for the ambient occlusion
           it casts on the page. A single blur just looks like a glow.

           The ladder is card -> raised -> lift -> pop, and each step is a
           bigger apparent height off the page. Costs nothing and asks nothing
           of the browser beyond a repaint. */
        xs: '0 1px 2px rgba(16,28,43,.05)',
        card:
          '0 1px 1px rgba(16,28,43,.05), 0 4px 10px -5px rgba(16,28,43,.16), 0 14px 28px -20px rgba(16,28,43,.34)',
        raised:
          '0 1px 2px rgba(16,28,43,.06), 0 8px 16px -8px rgba(16,28,43,.22), 0 22px 42px -26px rgba(16,28,43,.42)',
        lift:
          '0 2px 4px rgba(16,28,43,.07), 0 14px 26px -10px rgba(16,28,43,.28), 0 34px 60px -34px rgba(16,28,43,.5)',
        pop:
          '0 3px 6px rgba(16,28,43,.09), 0 22px 42px -14px rgba(16,28,43,.36), 0 60px 100px -50px rgba(16,28,43,.6)',
        focus: '0 0 0 3px rgb(var(--brand-500) / .18)',
      },

      /* --- motion ---------------------------------------------------------
         Short, single-property-where-possible, and all transform/opacity so
         they stay on the compositor and never cost layout.                  */
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.97)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(14px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'none' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'bar-grow': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        /* --- cab-themed motion for the public site --- */
        drive: {
          '0%':   { transform: 'translateX(-18%)' },
          '100%': { transform: 'translateX(118%)' },
        },
        'road-dash': {
          to: { 'stroke-dashoffset': '-64' },
        },
        'wheel-spin': {
          to: { transform: 'rotate(360deg)' },
        },
        hover: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-5px)' },
        },
        'speed-line': {
          '0%':   { transform: 'translateX(0)', opacity: '0' },
          '25%':  { opacity: '.9' },
          '100%': { transform: 'translateX(-46px)', opacity: '0' },
        },

        /* --- the customer journey: trip IDs, timelines, invoices --- */
        /* A Trip ID lands rather than appears: it is the one thing on the
           screen the customer is meant to remember. */
        'pop-in': {
          '0%':   { opacity: '0', transform: 'scale(.86)' },
          '60%':  { opacity: '1', transform: 'scale(1.03)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        /* The connector between two status dots draws downwards. */
        'trail-grow': {
          from: { transform: 'scaleY(0)' },
          to:   { transform: 'scaleY(1)' },
        },
        /* One ring pushed out of the "you are here" dot. */
        'ping-once': {
          '0%':   { transform: 'scale(.8)', opacity: '.55' },
          '100%': { transform: 'scale(2.1)', opacity: '0' },
        },
        /* The tick on a success panel writes itself. */
        'check-draw': {
          from: { 'stroke-dashoffset': '32' },
          to:   { 'stroke-dashoffset': '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in .25s ease-out both',
        'fade-up': 'fade-up .38s cubic-bezier(.22,1,.36,1) both',
        'fade-down': 'fade-down .22s cubic-bezier(.22,1,.36,1) both',
        'scale-in': 'scale-in .2s cubic-bezier(.22,1,.36,1) both',
        'slide-in': 'slide-in .24s cubic-bezier(.22,1,.36,1) both',
        'slide-left': 'slide-left .28s cubic-bezier(.22,1,.36,1) both',
        shimmer: 'shimmer 1.6s infinite',
        'bar-grow': 'bar-grow .6s cubic-bezier(.22,1,.36,1) both',
        drive: 'drive 9s linear infinite',
        'road-dash': 'road-dash 1.1s linear infinite',
        'wheel-spin': 'wheel-spin 1.1s linear infinite',
        hover: 'hover 4.5s ease-in-out infinite',
        'speed-line': 'speed-line 1.5s ease-out infinite',
        'pop-in': 'pop-in .42s cubic-bezier(.22,1.4,.36,1) both',
        'trail-grow': 'trail-grow .5s cubic-bezier(.22,1,.36,1) both',
        'ping-once': 'ping-once 1.9s cubic-bezier(0,0,.2,1) infinite',
        'check-draw': 'check-draw .5s cubic-bezier(.22,1,.36,1) .1s both',
      },

      transitionTimingFunction: {
        smooth: 'cubic-bezier(.22,1,.36,1)',
      },
    },
  },
  plugins: [],
};
