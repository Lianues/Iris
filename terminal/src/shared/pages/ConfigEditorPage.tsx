import { useMemo, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { InputDisplay } from "../components/InputDisplay.js"
import { useCursorBlink } from "../hooks/use-cursor-blink.js"
import { usePaste } from "../hooks/use-paste.js"
import {
  applyTextInputKey,
  insertTextInputValue,
  isTextInputKeyHandled,
  type TextInputState,
} from "../hooks/use-text-input.js"
import { gracefulExit } from "../runtime.js"
import { PageFrame } from "./PageFrame.js"
import {
  flattenYaml,
  formatDisplayValue,
  parseEditValue,
  setByPath,
  pathToKey,
  type ConfigField,
  type ConfigChange,
  keyToPath,
} from "../yaml-fields.js"

export interface ConfigEditorPageProps {
  title: string
  description?: string
  /** 解析后的 YAML 对象 */
  data: Record<string, any>
  /** 用户确认保存时调用 */
  onSave: (modifiedData: Record<string, any>, changes: ConfigChange[]) => void
  /** 返回上一级 */
  onBack?: () => void
}

export function ConfigEditorPage({
  title,
  description,
  data,
  onSave,
  onBack,
}: ConfigEditorPageProps) {
  const fields = useMemo(() => flattenYaml(data), [data])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editState, setEditState] = useState<TextInputState>({ value: "", cursor: 0 })
  const [changes, setChanges] = useState<Map<string, any>>(new Map())
  const cursorVisible = useCursorBlink()
  const { height: terminalHeight } = useTerminalDimensions()

  const isEditing = editingIndex !== null
  const hasChanges = changes.size > 0

  // ── 值访问 ──

  function getFieldCurrentValue(field: ConfigField): any {
    const pk = pathToKey(field.path)
    return changes.has(pk) ? changes.get(pk) : field.value
  }

  function isFieldModified(field: ConfigField): boolean {
    return changes.has(pathToKey(field.path))
  }

  // ── 编辑操作 ──

  function applyFieldChange(field: ConfigField, newValue: any) {
    const pk = pathToKey(field.path)
    setChanges((prev) => {
      const next = new Map(prev)
      if (JSON.stringify(newValue) === JSON.stringify(field.value)) {
        next.delete(pk)
      } else {
        next.set(pk, newValue)
      }
      return next
    })
  }

  function toggleBoolean(field: ConfigField) {
    applyFieldChange(field, !getFieldCurrentValue(field))
  }

  function startEditing(index: number) {
    const field = fields[index]
    if (!field || !field.editable || field.isSection) return

    if (field.valueType === "boolean") {
      toggleBoolean(field)
      return
    }

    const current = getFieldCurrentValue(field)
    let editText: string

    if (field.isSimpleArray && Array.isArray(current)) {
      editText = current.map(String).join(", ")
    } else if (current === null || current === undefined) {
      editText = ""
    } else {
      editText = String(current)
    }

    setEditingIndex(index)
    setEditState({ value: editText, cursor: editText.length })
  }

  function confirmEdit() {
    if (editingIndex === null) return
    const field = fields[editingIndex]
    if (!field) { setEditingIndex(null); return }

    let newValue: any
    if (field.isSimpleArray) {
      const text = editState.value.trim()
      newValue = text.length === 0 ? [] : text.split(",").map((s) => s.trim()).filter(Boolean)
    } else {
      newValue = parseEditValue(editState.value, field.valueType ?? "string")
    }

    applyFieldChange(field, newValue)
    setEditingIndex(null)
  }

  function cancelEdit() {
    setEditingIndex(null)
  }

  // ── 保存 ──

  function buildSavePayload() {
    const modified = structuredClone(data)
    const changeList: ConfigChange[] = []

    for (const [pk, newValue] of changes) {
      const path = keyToPath(pk)
      setByPath(modified, path, newValue)
      const field = fields.find((f) => pathToKey(f.path) === pk)
      changeList.push({
        path,
        key: field ? field.path.join(".") : path.join("."),
        oldValue: field?.value,
        newValue,
      })
    }

    return { modified, changeList }
  }

  // ── 滚动 ──

  const maxVisible = Math.max(3, Math.min(20, terminalHeight - 10))
  let scrollStart = 0
  if (fields.length > maxVisible) {
    scrollStart = Math.max(0, Math.min(
      selectedIndex - Math.floor(maxVisible / 2),
      fields.length - maxVisible,
    ))
  }
  const visibleFields = fields.slice(scrollStart, scrollStart + maxVisible)

  // ── 键盘 ──

  useKeyboard((key) => {
    if (key.name === "c" && key.ctrl) {
      gracefulExit()
      return
    }

    // 编辑模式
    if (isEditing) {
      if (key.name === "return") {
        confirmEdit()
        return
      }
      if (key.name === "escape") {
        cancelEdit()
        return
      }
      if (isTextInputKeyHandled(key)) {
        setEditState((prev) => applyTextInputKey(prev, key))
      }
      return
    }

    // 导航模式
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => Math.min(fields.length - 1, i + 1))
      return
    }

    if (key.name === "return") {
      startEditing(selectedIndex)
      return
    }

    if (key.name === "space") {
      const field = fields[selectedIndex]
      if (field?.valueType === "boolean" && field.editable) {
        toggleBoolean(field)
      }
      return
    }

    if (key.name === "s" && key.ctrl) {
      if (hasChanges) {
        const { modified, changeList } = buildSavePayload()
        onSave(modified, changeList)
      }
      return
    }

    if (key.name === "escape" || key.name === "q") {
      onBack?.()
    }
  })

  usePaste((text) => {
    if (!isEditing) return
    const cleaned = text.replace(/[\r\n]/g, "").trim()
    if (cleaned) {
      setEditState((prev) => insertTextInputValue(prev, cleaned))
    }
  })

  // ── 空状态 ──

  if (fields.length === 0) {
    return (
      <PageFrame
        title={title}
        description={description}
        actions={[onBack ? "Esc 返回" : undefined]}
      >
        <text fg="#636e72">(配置文件为空或所有配置项均已注释)</text>
      </PageFrame>
    )
  }

  // ── 操作栏 ──

  const actions = isEditing
    ? ["Enter 确认", "Esc 取消编辑"]
    : [
        "↑↓ 移动",
        "Enter 编辑",
        "Space 切换布尔值",
        hasChanges ? `Ctrl+S 保存 (${changes.size} 项变更)` : undefined,
        onBack ? "Esc 返回" : undefined,
      ]

  // ── 渲染 ──

  return (
    <PageFrame title={title} description={description} actions={actions}>
      <box flexDirection="column" gap={0}>
        {scrollStart > 0 && (
          <text fg="#636e72">{`  ↑ 上方还有 ${scrollStart} 项`}</text>
        )}

        {visibleFields.map((field, visIdx) => {
          const realIndex = scrollStart + visIdx
          const isSelected = realIndex === selectedIndex
          const isFieldEditing = realIndex === editingIndex
          const modified = isFieldModified(field)
          const indent = "  ".repeat(field.depth)

          // ── 分组标题 ──
          if (field.isSection) {
            return (
              <box key={pathToKey(field.path)} flexDirection="column" flexShrink={0}>
                <text>
                  <span fg={isSelected ? "#a29bfe" : "#6c5ce7"}>
                    {isSelected ? "❯ " : "  "}
                    {indent}{field.key}
                  </span>
                  {field.sectionHint && (
                    <span fg="#636e72">{` ${field.sectionHint}`}</span>
                  )}
                </text>
              </box>
            )
          }

          // ── 可编辑字段 ──
          const currentValue = getFieldCurrentValue(field)
          const displayVal = formatDisplayValue(
            currentValue,
            field.isSimpleArray,
          )

          const valueColor = field.valueType === "boolean"
            ? (currentValue ? "#00b894" : "#ff7675")
            : field.valueType === "number"
              ? "#74b9ff"
              : field.valueType === "null" || currentValue === null
                ? "#636e72"
                : "#dfe6e9"

          return (
            <box key={pathToKey(field.path)} flexDirection="column" flexShrink={0}>
              <text>
                <span fg={isSelected ? "#00b894" : "#636e72"}>
                  {isSelected ? "❯ " : "  "}
                </span>
                <span fg="#b2bec3">{indent}{field.key}</span>
                <span fg="#636e72">{": "}</span>
                {field.valueType === "boolean" && (
                  <span fg={valueColor}>{currentValue ? "✓ " : "✗ "}</span>
                )}
                <span fg={valueColor}>{displayVal}</span>
                {modified && <span fg="#fdcb6e">{" ●"}</span>}
              </text>

              {isFieldEditing && (
                <box
                  borderStyle="single"
                  borderColor="#00b894"
                  paddingLeft={1}
                  paddingRight={1}
                  marginLeft={2 + field.depth * 2}
                >
                  <InputDisplay
                    value={editState.value}
                    cursor={editState.cursor}
                    isActive={true}
                    cursorVisible={cursorVisible}
                    placeholder={field.isSimpleArray ? "逗号分隔多个值" : "输入新值"}
                  />
                </box>
              )}
            </box>
          )
        })}

        {scrollStart + maxVisible < fields.length && (
          <text fg="#636e72">{`  ↓ 下方还有 ${fields.length - scrollStart - maxVisible} 项`}</text>
        )}
      </box>
    </PageFrame>
  )
}
