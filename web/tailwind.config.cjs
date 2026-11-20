const path = require('node:path');
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
module.exports = {
  content: [path.resolve(__dirname, 'index.html'), path.resolve(__dirname, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        paper: v('paper'), surface: v('surface'), ink: v('ink'), muted: v('muted'), line: v('line'),
        olive: { DEFAULT: v('olive'), soft: v('olive-soft'), deep: v('olive-deep') },
        pass: v('pass'), reg: v('reg'), avail: v('avail'), fail: v('fail'), block: v('block'),
      },
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'Tahoma', 'sans-serif'], display: ['"Reem Kufi"', '"IBM Plex Sans Arabic"', 'sans-serif'] },
      borderRadius: { card: '14px' },
    },
  },
  plugins: [],
};
