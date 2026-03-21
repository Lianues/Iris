/**
 * 通用确认弹窗状态管理
 *
 * 替代 window.confirm，提供符合 GUI 风格的模态确认弹窗。
 * 通过 showConfirm() 返回 Promise<boolean>，调用处可 await 结果。
 */

import { ref } from 'vue'

export interface ConfirmDialogOptions {
  /** 弹窗标题 */
  title: string
  /** 描述文本（支持 HTML） */
  description: string
  /** 确认按钮文字（默认 "确认"） */
  confirmText?: string
  /** 取消按钮文字（默认 "取消"） */
  cancelText?: string
  /** 是否为危险操作（红色按钮，默认 false） */
  danger?: boolean
}

// 模块级单例状态
const visible = ref(false)
const options = ref<ConfirmDialogOptions>({
  title: '',
  description: '',
})

let _resolve: ((value: boolean) => void) | null = null

/** 显示确认弹窗，返回用户选择（true = 确认，false = 取消） */
export function showConfirm(opts: ConfirmDialogOptions): Promise<boolean> {
  // 如果已有弹窗，先关闭
  if (_resolve) {
    _resolve(false)
    _resolve = null
  }

  options.value = opts
  visible.value = true

  return new Promise<boolean>((resolve) => {
    _resolve = resolve
  })
}

/** 确认 */
function confirm() {
  visible.value = false
  if (_resolve) {
    _resolve(true)
    _resolve = null
  }
}

/** 取消 */
function cancel() {
  visible.value = false
  if (_resolve) {
    _resolve(false)
    _resolve = null
  }
}

export function useConfirmDialog() {
  return {
    visible,
    options,
    confirm,
    cancel,
  }
}
