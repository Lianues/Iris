export const ICONS = {
  common: {
    menu: 'menu',
    add: 'add',
    close: 'close',
    settings: 'settings',
    chevronRight: 'chevron_right',
    attach: 'attach_file',
    send: 'north_east',
    document: 'description',
    copy: 'content_copy',
    retry: 'refresh',
    arrowDown: 'south',
    sparkle: 'auto_awesome',
  },
  sidebar: {
    chat: 'chat',
    deploy: 'rocket_launch',
    empty: 'auto_awesome',
    key: 'key',
  },
  tool: {
    call: 'bolt',
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
