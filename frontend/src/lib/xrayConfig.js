/**
 * Сборка Xray-конфига для профиля RemnaWave.
 *
 * Вынесено из компонента отдельным модулем: это чистое преобразование данных,
 * его удобно проверять отдельно от интерфейса. Сборка идёт на фронте, чтобы
 * предпросмотр обновлялся мгновенно — ходить на сервер на каждое нажатие
 * незачем.
 *
 * Умолчания взяты не с потолка, а из рабочих профилей панели: блоки outbounds
 * и routing скопированы с уже боевых конфигов, чтобы сгенерированный профиль
 * вёл себя как остальные.
 */

export const TRANSPORTS = [
  { id: 'tcp',   label: 'TCP / RAW', hint: 'Самый распространённый. Работает везде.' },
  { id: 'grpc',  label: 'gRPC',      hint: 'Хорошо переживает плохие сети, сложнее блокируется.' },
  { id: 'xhttp', label: 'XHTTP',     hint: 'Новый транспорт, удобен за CDN.' },
  { id: 'ws',    label: 'WebSocket', hint: 'Пригодится, когда нужен обычный HTTP-апгрейд.' },
]

export const SECURITIES = [
  { id: 'reality', label: 'Reality', hint: 'Маскировка под чужой сайт. Сертификат не нужен.' },
  { id: 'tls',     label: 'TLS',     hint: 'Обычный TLS — нужен свой сертификат на сервере.' },
  { id: 'none',    label: 'Без шифрования', hint: 'Только за CDN или внутри доверенной сети.' },
]

/** Значения по умолчанию — те же, что в рабочих профилях панели. */
export const DEFAULTS = {
  name: 'NEW_VLESS_REALITY',
  tag: 'VLESS_IN',
  port: 443,
  listen: '0.0.0.0',
  transport: 'tcp',
  security: 'reality',

  // Reality
  dest: 'www.google.com:443',
  serverNames: 'www.google.com',
  privateKey: '',
  shortIds: '',
  spiderX: '/',
  xver: 0,
  // Xray 25.9+ переименовал privateKey в password. В панели встречаются оба
  // формата, поэтому выбор оставлен пользователю, а не зашит.
  realityKeyField: 'privateKey',

  // TLS
  tlsCertFile: '/etc/ssl/certs/fullchain.pem',
  tlsKeyFile: '/etc/ssl/private/privkey.pem',
  tlsServerName: '',

  // Транспорт
  grpcServiceName: 'grpc',
  grpcMultiMode: true,
  xhttpPath: '/',
  xhttpHost: '',
  xhttpMode: 'auto',
  wsPath: '/',
  wsHost: '',

  // Прочее
  sniffing: true,
  mptcp: true,
  tcpFastOpen: true,
  blockBittorrent: true,
  blockPrivate: true,
  logLevel: 'warning',
}

const splitList = s => String(s || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean)

/** Настройки транспорта — ключ зависит от выбранной сети. */
function transportSettings(f) {
  switch (f.transport) {
    case 'grpc':
      return {
        grpcSettings: {
          serviceName: f.grpcServiceName || 'grpc',
          multiMode: !!f.grpcMultiMode,
          idleTimeout: 60,
          healthCheckTimeout: 20,
          initialWindowsSize: 35538,
          permitWithoutStream: false,
        },
      }
    case 'xhttp':
      return {
        xhttpSettings: {
          path: f.xhttpPath || '/',
          mode: f.xhttpMode || 'auto',
          ...(f.xhttpHost ? { host: f.xhttpHost } : {}),
        },
      }
    case 'ws':
      return {
        wsSettings: {
          path: f.wsPath || '/',
          ...(f.wsHost ? { headers: { Host: f.wsHost } } : {}),
        },
      }
    default:
      return { tcpSettings: { header: { type: 'none' } } }
  }
}

/** Блок безопасности. */
function securitySettings(f) {
  if (f.security === 'reality') {
    const keyField = f.realityKeyField === 'password' ? 'password' : 'privateKey'
    return {
      realitySettings: {
        dest: f.dest || 'www.google.com:443',
        show: false,
        xver: Number(f.xver) || 0,
        spiderX: f.spiderX || '/',
        [keyField]: f.privateKey || '',
        shortIds: splitList(f.shortIds),
        serverNames: splitList(f.serverNames),
      },
    }
  }
  if (f.security === 'tls') {
    return {
      tlsSettings: {
        ...(f.tlsServerName ? { serverName: f.tlsServerName } : {}),
        certificates: [{
          certificateFile: f.tlsCertFile,
          keyFile: f.tlsKeyFile,
        }],
      },
    }
  }
  return {}
}

/**
 * Собрать полный конфиг.
 *
 * clients оставляем пустым намеренно: пользователей в inbound подставляет
 * сама панель RemnaWave, руками их сюда вписывать не нужно.
 */
export function buildConfig(f) {
  const inbound = {
    tag: f.tag || 'VLESS_IN',
    port: Number(f.port) || 443,
    listen: f.listen || '0.0.0.0',
    protocol: 'vless',
    settings: { clients: [], decryption: 'none' },
    ...(f.sniffing ? {
      sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
    } : {}),
    streamSettings: {
      network: f.transport === 'tcp' ? 'tcp' : f.transport,
      security: f.security,
      ...transportSettings(f),
      ...securitySettings(f),
      sockopt: {
        tcpMptcp: !!f.mptcp,
        tcpFastOpen: !!f.tcpFastOpen,
        tcpKeepAliveIdle: 100,
        tcpKeepAliveInterval: 15,
      },
    },
  }

  const rules = []
  if (f.blockPrivate) {
    rules.push({ type: 'field', ip: ['geoip:private'], outboundTag: 'BLOCK' })
    rules.push({ type: 'field', domain: ['geosite:private'], outboundTag: 'BLOCK' })
  }
  if (f.blockBittorrent) {
    rules.push({ type: 'field', protocol: ['bittorrent'], outboundTag: 'BLOCK' })
  }

  return {
    log: { loglevel: f.logLevel || 'warning' },
    inbounds: [inbound],
    outbounds: [
      {
        tag: 'DIRECT',
        protocol: 'freedom',
        settings: { domainStrategy: 'UseIPv4' },
        streamSettings: { sockopt: { tcpMptcp: !!f.mptcp, tcpFastOpen: !!f.tcpFastOpen } },
      },
      { tag: 'BLOCK', protocol: 'blackhole', settings: { response: { type: 'none' } } },
    ],
    routing: { rules },
  }
}

/**
 * Предполётная проверка. Ловит то, из-за чего конфиг молча не заработает:
 * пустой ключ Reality, отсутствующие serverNames, shortId нечётной длины.
 * Лучше сказать здесь, чем ловить потом в логах ноды.
 */
export function validate(f) {
  const problems = []
  const warn = []

  if (!f.port || Number(f.port) < 1 || Number(f.port) > 65535) problems.push('Порт вне диапазона 1–65535')
  if (!f.tag?.trim()) problems.push('Пустой тег inbound')

  if (f.security === 'reality') {
    if (!f.privateKey?.trim()) problems.push('Не задан ключ Reality — сгенерируйте пару')
    if (!splitList(f.serverNames).length) problems.push('Не указан ни один serverName')
    if (!f.dest?.trim()) problems.push('Не указан dest')
    else if (!/:\d+$/.test(f.dest)) warn.push('В dest обычно указывают порт, например site.com:443')

    const sids = splitList(f.shortIds)
    if (!sids.length) warn.push('shortIds пуст — многие клиенты это допускают, но лучше задать')
    for (const s of sids) {
      if (!/^[0-9a-f]*$/i.test(s)) problems.push(`shortId «${s}» — не hex`)
      else if (s.length % 2) problems.push(`shortId «${s}» — нечётная длина`)
      else if (s.length > 16) problems.push(`shortId «${s}» длиннее 16 символов`)
    }

    // dest и serverName из разных доменов — рабочая, но частая ошибка настройки
    const destHost = String(f.dest || '').split(':')[0]
    const names = splitList(f.serverNames)
    if (destHost && names.length && !names.includes(destHost)) {
      warn.push(`dest (${destHost}) не совпадает ни с одним serverName — обычно они должны быть одного домена`)
    }
  }

  if (f.security === 'tls') {
    if (!f.tlsCertFile?.trim() || !f.tlsKeyFile?.trim()) problems.push('Для TLS нужны пути к сертификату и ключу')
  }

  if (f.security === 'none' && f.transport === 'tcp') {
    warn.push('TCP без шифрования — трафик виден целиком. Осмысленно только за CDN')
  }

  return { problems, warn, ok: problems.length === 0 }
}
