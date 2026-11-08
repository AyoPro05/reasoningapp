// Framework-neutral values; native and browser renderers adapt these separately.
export const colours = {
  navy: '#12243A', blue: '#2459BA', background: '#F6F8FB', surface: '#FFFFFF',
  text: '#12243A', mutedText: '#4D5C70', border: '#D1D9E4',
  success: '#176443', danger: '#A12525', focus: '#2459BA',
} as const;
export const spacing = { none: 0, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const typography = {
  fontFamily: { web: 'Arial, Helvetica, sans-serif', native: 'System' },
  size: { caption: 14, body: 16, heading: 24, title: 32 },
  weight: { regular: '400', medium: '500', bold: '700' },
  lineHeight: { body: 1.5, heading: 1.2 },
} as const;
