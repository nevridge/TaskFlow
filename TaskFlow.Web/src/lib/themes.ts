export interface Theme {
  id: string
  label: string
  accentLight: string
  accentDark: string
  bgLight: string
  bgDark: string
}

export const THEMES: Theme[] = [
  {
    id: 'default',
    label: 'Default',
    accentLight: '#2563eb',
    accentDark: '#2563eb',
    bgLight: '#f6f7f9',
    bgDark: '#0b1220',
  },
  {
    id: 'rose-pine',
    label: 'Ros\u00e9 Pine',
    accentLight: '#b4637a',
    accentDark: '#eb6f92',
    bgLight: '#faf4ed',
    bgDark: '#191724',
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    accentLight: '#1e66f5',
    accentDark: '#89b4fa',
    bgLight: '#eff1f5',
    bgDark: '#1e1e2e',
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    accentLight: '#2e7de9',
    accentDark: '#7aa2f7',
    bgLight: '#e1e2e7',
    bgDark: '#24283b',
  },
  {
    id: 'dracula',
    label: 'Dracula',
    accentLight: '#6272a4',
    accentDark: '#bd93f9',
    bgLight: '#f8f8f2',
    bgDark: '#282a36',
  },
  {
    id: 'nord',
    label: 'Nord',
    accentLight: '#5e81ac',
    accentDark: '#88c0d0',
    bgLight: '#eceff4',
    bgDark: '#2e3440',
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    accentLight: '#b57614',
    accentDark: '#d79921',
    bgLight: '#fbf1c7',
    bgDark: '#282828',
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    accentLight: '#4e8ca2',
    accentDark: '#7e9cd8',
    bgLight: '#f2ecbc',
    bgDark: '#1f1f28',
  },
]