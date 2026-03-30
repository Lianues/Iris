export const ICONS = {
  common: {
    menu: 'menu',
    add: 'add',
    close: 'close',
    delete: 'delete',
    settings: 'settings',
    chevronRight: 'chevron_right',
    attach: 'attach_file',
    send: 'send',
    bolt: 'bolt',
    document: 'description',
    copy: 'content_copy',
    retry: 'refresh',
    download: 'download',
    arrowDown: 'south',
    sparkle: 'auto_awesome',
    expandUp: 'expand_less',
    collapseDown: 'expand_more',
    compress: 'compress',
    schedule: 'schedule',
    dragHandle: 'drag_indicator',
    edit: 'edit',
  },
  sidebar: {
    chat: 'chat',
    deploy: 'rocket_launch',
    terminal: 'terminal',
    empty: 'auto_awesome',
    key: 'key',
    platform: 'dns',
    extension: 'extension',
  },
  tool: {
    call: 'build',
    response: 'check_circle',
  },
  status: {
    ok: 'check_circle',
    fail: 'cancel',
    warn: 'warning',
    loading: 'hourglass_top',
  },
} as const

export type IconName =
  | (typeof ICONS.common)[keyof typeof ICONS.common]
  | (typeof ICONS.sidebar)[keyof typeof ICONS.sidebar]
  | (typeof ICONS.tool)[keyof typeof ICONS.tool]
  | (typeof ICONS.status)[keyof typeof ICONS.status]
