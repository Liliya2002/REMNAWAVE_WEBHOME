import React from 'react'
import AdminLayout from './AdminLayout'
import AdminLayoutV2 from './AdminLayoutV2'
import { useAdminUi } from '../contexts/AdminUiContext'

// Переключатель между классическим (AdminLayout) и новым (AdminLayoutV2)
// дизайном админки. Версия берётся из AdminUiContext (persist в localStorage),
// чтобы App-оболочка тоже знала, скрывать ли публичный header/footer в v2.
// Оба layout рендерят <Outlet />, поэтому дерево вложенных роутов /admin/* не меняется.

export default function AdminLayoutSwitch() {
  const { version, setVersion } = useAdminUi()

  if (version === 'v2') {
    return <AdminLayoutV2 onSwitchToClassic={() => setVersion('classic')} />
  }
  return <AdminLayout onSwitchToV2={() => setVersion('v2')} />
}
