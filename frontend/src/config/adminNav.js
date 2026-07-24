// Единый источник разделов админ-панели.
// Используется и стартовым экраном (AdminOverview), и сайдбаром нового
// дизайна (AdminLayoutV2), чтобы список разделов не расходился.
import {
  BarChart3, Users, CreditCard, History,
  Gift, Bell,
  Sparkles, FileText,
  Globe, Server, ShoppingCart, Cloud,
  Activity, Palette, BookOpen, TrendingUp, Shield, MessageCircle,
} from 'lucide-react'

export const GROUPS = [
  {
    id: 'analytics',
    title: 'Аналитика',
    color: 'from-blue-500 to-cyan-500',
    items: [
      { to: '/admin/stats',    Icon: BarChart3,  label: 'Статистика' },
      { to: '/admin/payments', Icon: CreditCard, label: 'Платежи' },
    ],
  },
  {
    id: 'users',
    title: 'Пользователи',
    color: 'from-emerald-500 to-teal-500',
    items: [
      { to: '/admin/users',         Icon: Users,      label: 'Пользователи' },
      { to: '/admin/traffic',       Icon: TrendingUp, label: 'Трафик / Отслеживание' },
      { to: '/admin/referrals',     Icon: Gift,       label: 'Рефералы' },
      { to: '/admin/notifications', Icon: Bell,       label: 'Уведомления' },
    ],
  },
  {
    id: 'plans',
    title: 'Тарифы и контент',
    color: 'from-amber-500 to-orange-500',
    items: [
      { to: '/admin/plans',    Icon: Sparkles, label: 'Тарифы' },
      { to: '/admin/landings', Icon: FileText, label: 'Лендинги' },
    ],
  },
  {
    id: 'infra',
    title: 'Серверы и хостинг',
    color: 'from-violet-500 to-fuchsia-500',
    items: [
      { to: '/admin/servers',       Icon: Globe,         label: 'RemnaWave' },
      { to: '/admin/vps',           Icon: Server,        label: 'Управление VPS' },
      { to: '/admin/yandex-cloud',  Icon: Cloud,         label: 'Yandex Cloud' },
      { to: '/admin/hosting-order', Icon: ShoppingCart,  label: 'Заказать хостинг' },
    ],
  },
  {
    id: 'system',
    title: 'Система',
    color: 'from-sky-500 to-indigo-500',
    items: [
      { to: '/admin/system',   Icon: Activity,       label: 'Состояние системы' },
      { to: '/admin/settings', Icon: Palette,        label: 'Настройки' },
      { to: '/admin/telegram', Icon: MessageCircle,  label: 'Telegram-бот' },
    ],
  },
  {
    id: 'security',
    title: 'Безопасность',
    color: 'from-rose-500 to-red-500',
    items: [
      { to: '/admin/audit',         Icon: History, label: 'Журнал аудита' },
      { to: '/admin/traffic-guard', Icon: Shield,  label: 'Traffic Guard' },
    ],
  },
  {
    id: 'docs',
    title: 'Документация',
    color: 'from-cyan-500 to-blue-500',
    items: [
      { to: '/admin/instructions', Icon: BookOpen, label: 'Инструкции' },
    ],
  },
]

// Плоский список пунктов — удобно для поиска раздела по текущему пути.
export const FLAT_ITEMS = GROUPS.flatMap(g => g.items.map(i => ({ ...i, groupId: g.id, groupTitle: g.title })))
