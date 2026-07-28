import React, { useState } from 'react'
import { Wallet, RefreshCw, ArrowDownLeft, ArrowUpRight, CreditCard, TrendingDown } from 'lucide-react'
import { useRuvds, useRuvdsData } from './context'
import { Panel, Loading, ErrorBox, Empty, DataList, IconBtn, Pager, fmtMoney, fmtDT, card } from './ui'

export default function RuvdsBalance() {
  const { account } = useRuvds()
  const [page, setPage] = useState(0)
  const per = 25

  const bal = useRuvdsData('/balance')
  const pay = useRuvdsData(`/payments?per_page=${per}&page=${page + 1}`, { deps: [page] })

  if (!account) return null

  // /v2/balance → { balance: { amount, currency, type } } либо плоский объект
  const b = bal.data?.balance ?? bal.data
  const amount = b?.amount ?? b?.balance
  const currency = b?.currency === 'RUB' || !b?.currency ? '₽' : b.currency
  const payments = pay.data?.payments || []
  const total = pay.data?.pagination?.total ?? pay.data?.pagination?.total_count

  // Итоги по загруженной странице платежей
  const income = payments.filter(p => Number(p.amount) > 0 || /in|deposit|приход/i.test(String(p.direction || '')))
    .reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0)
  const spent = payments.filter(p => Number(p.amount) < 0 || /out|write|расход|списан/i.test(String(p.direction || '')))
    .reduce((s, p) => s + Math.abs(Number(p.amount) || 0), 0)

  const isOut = p => Number(p.amount) < 0 || /out|write|расход|списан/i.test(String(p.direction || ''))

  const cols = [
    { key: 'dir', h: '', mobile: 'hide', render: p => (
      <span className={`inline-flex w-6 h-6 rounded-lg items-center justify-center ${isOut(p) ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
        {isOut(p) ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
      </span>
    ) },
    { key: 'type', h: 'Операция', mobile: 'title', render: p => (
      <span className="text-slate-200 truncate">{p.type || p.pay_source || (isOut(p) ? 'Списание' : 'Пополнение')}</span>
    ) },
    { key: 'src', h: 'Источник', render: p => <span className="text-slate-400">{p.pay_source || '—'}</span> },
    { key: 'amount', h: 'Сумма', mobile: 'sub', render: p => {
      const v = Number(p.amount) || 0
      return <span className={`font-mono font-semibold ${isOut(p) ? 'text-rose-300' : 'text-emerald-300'}`}>
        {isOut(p) ? '−' : '+'}{fmtMoney(Math.abs(v), p.currency === 'RUB' || !p.currency ? '₽' : p.currency)}
      </span>
    } },
    { key: 'dt', h: 'Дата', render: p => <span className="text-slate-500 whitespace-nowrap">{fmtDT(p.dt)}</span> },
  ]

  return (
    <div className="space-y-4">
      {/* Баланс — крупной картой */}
      <div className={`${card} p-5 relative overflow-hidden`}>
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.08] to-transparent pointer-events-none" />
        <div className="relative flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs text-slate-400 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-emerald-400" /> Баланс аккаунта</div>
            {bal.loading && !bal.data ? (
              <div className="text-2xl font-bold text-slate-600 font-mono mt-2">…</div>
            ) : (
              <div className="text-3xl sm:text-4xl font-bold text-white font-mono mt-2 leading-none">
                {fmtMoney(amount, currency)}
              </div>
            )}
            {b?.type && <div className="text-[11px] text-slate-500 mt-1.5">Тип счёта: {b.type}</div>}
            <a href="https://ruvds.com/my/billing" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25">
              <CreditCard className="w-3.5 h-3.5" /> Пополнить в кабинете RUVDS
            </a>
          </div>
          <IconBtn onClick={bal.reload} title="Обновить баланс" spinning={bal.loading}><RefreshCw className="w-4 h-4" /></IconBtn>
        </div>
        <ErrorBox error={bal.error} onRetry={bal.reload} />
      </div>

      {/* Итоги по странице платежей */}
      {payments.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className={`${card} p-3.5`}>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5"><ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" /> Пополнения</div>
            <div className="text-xl font-bold text-emerald-300 font-mono mt-1">{fmtMoney(income, currency)}</div>
          </div>
          <div className={`${card} p-3.5`}>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5 text-rose-400" /> Списания</div>
            <div className="text-xl font-bold text-rose-300 font-mono mt-1">{fmtMoney(spent, currency)}</div>
          </div>
        </div>
      )}

      <Panel
        title="История платежей"
        Icon={CreditCard}
        accent="text-emerald-400"
        ring="bg-emerald-500/10"
        actions={<IconBtn onClick={pay.reload} title="Обновить" spinning={pay.loading}><RefreshCw className="w-4 h-4" /></IconBtn>}
      >
        <ErrorBox error={pay.error} onRetry={pay.reload} />
        {pay.loading && !pay.data ? <Loading />
          : payments.length === 0 ? <Empty icon={CreditCard} title="Платежей нет" hint="История операций по этому аккаунту пуста." />
          : (
            <>
              <DataList cols={cols} rows={payments} keyOf={(p, i) => `${p.dt}-${i}`} />
              <Pager page={page} hasMore={payments.length >= per} onPage={setPage} loading={pay.loading} total={total} />
            </>
          )}
      </Panel>
    </div>
  )
}
