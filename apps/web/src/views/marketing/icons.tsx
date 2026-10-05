import type { ReactNode } from 'react'

import {
  ChartBarIcon,
  GaugeIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  RadioIcon,
  ShieldIcon,
  TerminalIcon,
  UsersIcon,
  ZapIcon
} from '@vhyxui/icons'

// Feature icons by name, so content editors can pick one with a word.
const ICONS: Record<string, ReactNode> = {
  zap: <ZapIcon />,
  link: <LinkIcon />,
  radio: <RadioIcon />,
  shield: <ShieldIcon />,
  lock: <LockIcon />,
  users: <UsersIcon />,
  gauge: <GaugeIcon />,
  chart: <ChartBarIcon />,
  globe: <GlobeIcon />,
  terminal: <TerminalIcon />
}

export const featureIcon = (name: string) => ICONS[name] ?? <ZapIcon />
