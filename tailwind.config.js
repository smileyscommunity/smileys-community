/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Club.color and Club.bgColor are stored as raw strings in the DB
  // and read straight into className across ~15 consumers (club
  // cards, hero strips, badges, etc.). Without a safelist, JIT
  // would purge any utility that doesn't appear statically in
  // source. A future admin who picks `bg-rose-100` for a club
  // would silently render no background. The safelist below
  // protects bg-<color>-<shade> and text-<color>-<shade> for the
  // common palette + shade ranges. The PUT validator in
  // /api/admin/clubs/[id] enforces this same shape on writes, so
  // unsafelisted strings can't reach the DB.
  safelist: [
    { pattern: /^(bg|text)-(amber|rose|sky|emerald|violet|indigo|orange|teal|cyan|lime|fuchsia|pink|red|green|blue|yellow|purple|slate|zinc|neutral|stone|gray)-(50|100|200|300|400|500|600|700|800|900)$/ },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      colors: {
        warm: '#faf9f7',
        brand: {
          50: '#fffbeb',
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      boxShadow: {
        card: '0 2px 16px 0 rgba(0,0,0,0.07)',
        'card-hover': '0 8px 32px 0 rgba(0,0,0,0.12)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
