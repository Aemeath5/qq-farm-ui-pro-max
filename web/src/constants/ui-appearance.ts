export type UiColorTheme = 'default' | 'sakura' | 'cyber' | 'elegant' | 'ocean'
export type UiBackgroundScope = 'login_only' | 'login_and_app' | 'global'

export type ThemeOption = {
  key: UiColorTheme
  color: string
  bg: string
  bgDark: string
  shadow: string
  name: string
  desc: string
}

export type LoginBackgroundPreset = {
  key: string
  themeKey?: UiColorTheme
  title: string
  description: string
  url: string
  overlayOpacity: number
  blur: number
  appOverlayOpacity: number
  appBlur: number
  badge?: string
  builtIn?: boolean
}

export const THEME_OPTIONS: ThemeOption[] = [
  { key: 'default', color: '#22c55e', bg: 'bg-green-500', bgDark: 'bg-green-600', shadow: 'shadow-[0_0_8px_rgba(34,197,94,0.6)]', name: '御农翠绿 (默认)', desc: '经典护眼配色，生机盎然。代表农业的丰收与稳定。' },
  { key: 'sakura', color: '#ffc0cb', bg: 'bg-[#ffc0cb]', bgDark: 'bg-pink-400', shadow: 'shadow-[0_0_8px_rgba(255,192,203,0.8)]', name: '樱花粉黛 (Sakura)', desc: '活泼灵动的少女粉，猛男标配，点缀极简的玫瑰边框。' },
  { key: 'cyber', color: '#8b5cf6', bg: 'bg-violet-500', bgDark: 'bg-fuchsia-600', shadow: 'shadow-[0_0_8px_rgba(139,92,246,0.6)]', name: '全息赛博 (Neon)', desc: '高对比度的电竞荧光紫，搭配极夜背景，凸显极客执行力。' },
  { key: 'elegant', color: '#eab308', bg: 'bg-yellow-500', bgDark: 'bg-amber-600', shadow: 'shadow-[0_0_8px_rgba(234,179,8,0.6)]', name: '尊贵黯金 (Elegant)', desc: '高端优雅，黄黑相间。适合长期挂机的大佬使用。' },
  { key: 'ocean', color: '#0ea5e9', bg: 'bg-sky-500', bgDark: 'bg-cyan-600', shadow: 'shadow-[0_0_8px_rgba(14,165,233,0.6)]', name: '深海矩阵 (Ocean)', desc: '冷静、理智的数据化浅蓝色调，带来流畅的数据监控体验。' },
]

export const UI_BACKGROUND_SCOPE_OPTIONS = [
  { label: '仅登录页', value: 'login_only', description: '保留登录页大图，业务页维持当前纯玻璃控制台。' },
  { label: '登录页 + 主界面', value: 'login_and_app', description: '登录页强表现，主界面弱化继承同一张氛围背景。' },
  { label: '全局启用', value: 'global', description: '所有后续页面都沿用这套背景系统，适合做统一品牌皮肤。' },
] as const

export const LOGIN_BACKGROUND_PRESETS: LoginBackgroundPreset[] = [
  {
    key: 'theme-default-emerald',
    themeKey: 'default',
    title: '御农翠绿',
    description: '对应默认翠绿主题，青绿山雾与庄园留白更适合日常控制台。',
    url: '/background-presets/jade-mist.svg',
    overlayOpacity: 24,
    blur: 2,
    appOverlayOpacity: 58,
    appBlur: 8,
    badge: '默认主题',
    builtIn: true,
  },
  {
    key: 'theme-sakura-blossom',
    themeKey: 'sakura',
    title: '樱雾庭前',
    description: '对应 Sakura 粉黛主题，背景更轻盈，适合偏装饰感的界面氛围。',
    url: '/background-presets/sakura-breeze.svg',
    overlayOpacity: 20,
    blur: 2,
    appOverlayOpacity: 54,
    appBlur: 7,
    badge: '樱花主题',
    builtIn: true,
  },
  {
    key: 'theme-cyber-grid',
    themeKey: 'cyber',
    title: '霓虹中枢',
    description: '对应 Cyber 赛博主题，带一点中控台和全息面板的荧光感。',
    url: '/background-presets/cyber-grid.svg',
    overlayOpacity: 36,
    blur: 3,
    appOverlayOpacity: 64,
    appBlur: 10,
    badge: '赛博主题',
    builtIn: true,
  },
  {
    key: 'theme-elegant-harvest',
    themeKey: 'elegant',
    title: '金穗落照',
    description: '对应 Elegant 黯金主题，暖色层次更像庄园主控室的开场海报。',
    url: '/background-presets/harvest-sunset.svg',
    overlayOpacity: 28,
    blur: 2,
    appOverlayOpacity: 60,
    appBlur: 8,
    badge: '黯金主题',
    builtIn: true,
  },
  {
    key: 'theme-ocean-depth',
    themeKey: 'ocean',
    title: '深海流光',
    description: '对应 Ocean 深海主题，适合仪表盘、实时数据和冷色玻璃面板。',
    url: '/background-presets/ocean-glass.svg',
    overlayOpacity: 38,
    blur: 4,
    appOverlayOpacity: 68,
    appBlur: 10,
    badge: '深海主题',
    builtIn: true,
  },
  {
    key: 'sample-red-horse',
    title: '红绫跃马',
    description: '你提供的示例图，酒红氛围很强，适合做登录页强视觉方案。',
    url: 'https://pic.netbian.com/uploads/allimg/260224/231748-1771946268a32d.jpg',
    overlayOpacity: 34,
    blur: 3,
    appOverlayOpacity: 66,
    appBlur: 10,
    badge: '示例图',
    builtIn: false,
  },
]

export function getThemeOption(themeKey: string) {
  return THEME_OPTIONS.find(theme => theme.key === themeKey) || THEME_OPTIONS[0]!
}

export function getThemeBackgroundPreset(themeKey: string) {
  return LOGIN_BACKGROUND_PRESETS.find(preset => preset.themeKey === themeKey) || LOGIN_BACKGROUND_PRESETS[0]!
}
