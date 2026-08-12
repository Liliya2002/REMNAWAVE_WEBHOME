// Единый источник разделов админ-панели.
// Используется и стартовым экраном (AdminOverview), и сайдбаром нового
// дизайна (AdminLayoutV2), чтобы список разделов не расходился.
import {
  BarChart3, Users, CreditCard, History, Database, Bot,
  Gift, Bell,
  Sparkles, FileText,
  Globe, Server, ShoppingCart, Cloud, Ticket, LifeBuoy, HardDrive, Wallet, KeyRound, Users2, CalendarClock,
  Activity, Palette, BookOpen, TrendingUp, Shield, MessageCircle, Wrench,
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
      { to: '/admin/config-builder', Icon: Wrench,        label: 'Конструктор конфигов' },
      { to: '/admin/vps',           Icon: Server,        label: 'Управление VPS' },
      { to: '/admin/yandex-cloud',  Icon: Cloud,         label: 'Yandex Cloud' },
      { to: '/admin/selectel',      Icon: Cloud,         label: 'Selectel Cloud' },
      { to: '/admin/hosting-order', Icon: ShoppingCart,  label: 'Заказать хостинг' },
    ],
  },
  {
    id: 'ruvds',
    title: 'RUVDS',
    color: 'from-orange-500 to-red-500',
    items: [
      { to: '/admin/ruvds/servers',       Icon: HardDrive, label: 'Серверы' },
      { to: '/admin/ruvds/statistics',    Icon: BarChart3, label: 'Статистика' },
      { to: '/admin/ruvds/balance',       Icon: Wallet,    label: 'Баланс' },
      { to: '/admin/ruvds/ssh-keys',      Icon: KeyRound,  label: 'SSH-ключи' },
      { to: '/admin/ruvds/notifications', Icon: Bell,      label: 'Уведомления' },
      { to: '/admin/ruvds/accounts',      Icon: Users2,    label: 'Аккаунты' },
    ],
  },
  {
    id: 'bedolaga',
    title: 'Bedolaga Bot',
    color: 'from-violet-500 to-fuchsia-500',
    items: [
      { to: '/admin/bedolaga/users',         Icon: Users,      label: 'Пользователи' },
      { to: '/admin/bedolaga/subscriptions', Icon: Ticket,        label: 'Подписки' },
      { to: '/admin/bedolaga/expiring',      Icon: CalendarClock, label: 'Истекающие' },
      { to: '/admin/bedolaga/promo',         Icon: Ticket,     label: 'Промокоды' },
      { to: '/admin/bedolaga/promo-uses',    Icon: Database,   label: 'Активации' },
      { to: '/admin/bedolaga/transactions',  Icon: CreditCard, label: 'Транзакции' },
      { to: '/admin/bedolaga/tickets',       Icon: LifeBuoy,   label: 'Тикеты' },
      { to: '/admin/ai/connection',          Icon: Bot,        label: 'ИИ-ассистент' },
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
      { to: '/admin/payment-settings', Icon: CreditCard, label: 'Платёжки' },
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
