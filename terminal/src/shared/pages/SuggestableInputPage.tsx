import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
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

export interface SuggestableInputSuggestion {
  value: string
  label: string
  description?: string
}

interface SuggestableInputFieldContext {
  fieldKey: string
  value: string
  values: Record<string, string>
  suggestions: SuggestableInputSuggestion[]
}

type SuggestableFieldText = string | ((context: SuggestableInputFieldContext) => string | undefined)

type SuggestionSource =
  | SuggestableInputSuggestion[]
  | ((context: Omit<SuggestableInputFieldContext, "suggestions">) => SuggestableInputSuggestion[])

export interface SuggestableInputFieldDefinition {
  key: string
  label: string
  description?: SuggestableFieldText
  placeholder?: string
  defaultValue?: string
  required?: boolean
  masked?: boolean
  validate?: (value: string, values: Record<string, string>) => string | undefined
  normalizePastedText?: (text: string) => string
  suggestions?: SuggestionSource
  /** 仅允许从 suggestions 中选择，不接受自由文本输入。 */
  selectionOnly?: boolean
  suggestionEmptyText?: SuggestableFieldText
}

interface SuggestableInputPageProps {
  title: string
  description?: ReactNode
  fields: SuggestableInputFieldDefinition[]
  onSubmit: (values: Record<string, string>) => void
  onSkip?: () => void
  onBack?: () => void
  maxVisibleFields?: number
  maxVisibleSuggestions?: number
}

function maskValue(value: string): string {
  return value.length === 0 ? "" : value.slice(0, 4) + "•".repeat(Math.max(0, value.length - 4))
}

function buildInitialFieldStates(fields: SuggestableInputFieldDefinition[]): Record<string, TextInputState> {
  return Object.fromEntries(
    fields.map((field) => {
      const value = field.defaultValue ?? ""
      return [field.key, { value, cursor: value.length } satisfies TextInputState]
    }),
  )
}

function getFieldValues(fieldStates: Record<string, TextInputState>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fieldStates).map(([key, state]) => [key, state.value]),
  )
}

function computeFieldError(
  field: SuggestableInputFieldDefinition,
  values: Record<string, string>,
): string | undefined {
  const value = values[field.key] ?? ""
  if (field.required && value.trim().length === 0) {
    return `请填写 ${field.label}`
  }
  return field.validate?.(value, values)
}

function resolveSuggestions(
  field: SuggestableInputFieldDefinition,
  values: Record<string, string>,
): SuggestableInputSuggestion[] {
  const value = values[field.key] ?? ""
  const context = {
    fieldKey: field.key,
    value,
    values,
  }

  const rawSuggestions = typeof field.suggestions === "function"
    ? field.suggestions(context)
    : field.suggestions ?? []

  return rawSuggestions.filter((item) => item && item.value.trim().length > 0)
}

function resolveFieldText(
  source: SuggestableFieldText | undefined,
  context: SuggestableInputFieldContext,
): string | undefined {
  if (typeof source === "function") {
    return source(context)
  }
  return source
}

export function SuggestableInputPage({
  title,
  description,
  fields,
  onSubmit,
  onSkip,
  onBack,
  maxVisibleFields = 4,
  maxVisibleSuggestions = 8,
}: SuggestableInputPageProps) {
  const [fieldStates, setFieldStates] = useState<Record<string, TextInputState>>(() => buildInitialFieldStates(fields))
  const [activeIndex, setActiveIndex] = useState(0)
  const [showMaskedFields, setShowMaskedFields] = useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0)
  const cursorVisible = useCursorBlink()

  const activeField = fields[Math.min(activeIndex, Math.max(0, fields.length - 1))]
  const values = useMemo(() => getFieldValues(fieldStates), [fieldStates])
  const errors = useMemo(() => {
    return Object.fromEntries(
      fields.map((field) => [field.key, computeFieldError(field, values)]),
    ) as Record<string, string | undefined>
  }, [fields, values])

  const hasMaskedField = fields.some((field) => field.masked)
  const canSubmit = fields.length > 0 && fields.every((field) => !errors[field.key])

  const activeSuggestions = useMemo(() => {
    if (!activeField) return []
    return resolveSuggestions(activeField, values)
  }, [activeField, values])

  const safeSuggestionIndex = Math.min(selectedSuggestionIndex, Math.max(0, activeSuggestions.length - 1))
  const activeFieldKey = activeField?.key ?? ""
  const activeFieldValue = activeField ? values[activeField.key] ?? "" : ""

  useEffect(() => {
    if (activeField?.selectionOnly) {
      const selectedIndex = activeSuggestions.findIndex((suggestion) => suggestion.value === activeFieldValue)
      setSelectedSuggestionIndex(selectedIndex >= 0 ? selectedIndex : 0)
      return
    }
    setSelectedSuggestionIndex(0)
  }, [activeField, activeFieldKey, activeFieldValue, activeSuggestions])

  let fieldScrollStart = 0
  if (fields.length > maxVisibleFields) {
    fieldScrollStart = Math.max(0, Math.min(activeIndex - Math.floor(maxVisibleFields / 2), fields.length - maxVisibleFields))
  }
  const visibleFields = fields.slice(fieldScrollStart, fieldScrollStart + maxVisibleFields)

  let suggestionScrollStart = 0
  if (activeSuggestions.length > maxVisibleSuggestions) {
    suggestionScrollStart = Math.max(
      0,
      Math.min(safeSuggestionIndex - Math.floor(maxVisibleSuggestions / 2), activeSuggestions.length - maxVisibleSuggestions),
    )
  }
  const visibleSuggestions = activeSuggestions.slice(suggestionScrollStart, suggestionScrollStart + maxVisibleSuggestions)

  useKeyboard((key) => {
    if (key.name === "n" && key.ctrl) {
      onSkip?.()
      return
    }

    if (key.name === "escape") {
      onBack?.()
      return
    }

    if (key.name === "c" && key.ctrl) {
      gracefulExit()
      return
    }

    if (hasMaskedField && key.name === "h" && key.ctrl) {
      setShowMaskedFields((value) => !value)
      return
    }

    if (key.name === "tab") {
      setActiveIndex((index) => (fields.length === 0 ? 0 : (index + 1) % fields.length))
      return
    }

    if (key.name === "up") {
      if (activeSuggestions.length > 0) {
        setSelectedSuggestionIndex((index) => Math.max(0, index - 1))
      } else {
        setActiveIndex((index) => Math.max(0, index - 1))
      }
      return
 }

    if (key.name === "down") {
      if (activeSuggestions.length > 0) {
        setSelectedSuggestionIndex((index) => Math.min(activeSuggestions.length - 1, index + 1))
      } else {
        setActiveIndex((index) => Math.min(fields.length - 1, index + 1))
      }
      return
    }

    if (key.name === "return") {
      if (activeField && activeSuggestions.length > 0) {
        const selectedSuggestion = activeSuggestions[safeSuggestionIndex]
        if (selectedSuggestion && (values[activeField.key] ?? "").trim() !== selectedSuggestion.value) {
          setFieldStates((current) => ({
            ...current,
            [activeField.key]: {
              value: selectedSuggestion.value,
              cursor: selectedSuggestion.value.length,
            },
          }))
          return
        }
      }

      if (canSubmit) {
        onSubmit(values)
      }
      return
    }

    if (!activeField) return

    if (!activeField.selectionOnly && isTextInputKeyHandled(key)) {
      setFieldStates((current) => ({
        ...current,
        [activeField.key]: applyTextInputKey(current[activeField.key], key),
      }))
    }
  })

  usePaste((text) => {
    if (!activeField || activeField.selectionOnly) return

    const cleaned = text.replace(/[\r\n]/g, "").trim()
    if (!cleaned) return

    const normalized = activeField.normalizePastedText?.(cleaned) ?? cleaned
    if (!normalized) return

    setFieldStates((current) => ({
      ...current,
      [activeField.key]: insertTextInputValue(current[activeField.key], normalized),
    }))
  })

  const primaryNavigationAction = activeSuggestions.length > 0 ? "↑↓ 选择建议" : "↑↓ 切换字段"
  const enterAction = activeSuggestions.length > 0 ? "Enter 补全 / 确认" : "Enter 确认"

  return (
    <PageFrame
      title={title}
      description={description}
      actions={[
        primaryNavigationAction,
        fields.length > 1 ? "Tab 切换字段" : undefined,
        hasMaskedField ? "Ctrl+H 显示/隐藏敏感字段" : undefined,
        enterAction,
        onSkip ? "Ctrl+N 跳过此环节" : undefined,
        onBack ? "Esc 返回" : undefined,
      ]}
    >
      <box flexDirection="column" gap={1}>
        {fieldScrollStart > 0 && (
          <text fg="#636e72">{`↑ 上方还有 ${fieldScrollStart} 项`}</text>
        )}

        {visibleFields.map((field, index) => {
          const realIndex = fieldScrollStart + index
          const isActive = realIndex === activeIndex
          const fieldState = fieldStates[field.key]
          const error = errors[field.key]
          const fieldSuggestions = resolveSuggestions(field, values)
          const descriptionText = resolveFieldText(field.description, {
            fieldKey: field.key,
            value: values[field.key] ?? "",
            values,
            suggestions: fieldSuggestions,
          })
          const suggestionEmptyText = resolveFieldText(field.suggestionEmptyText, {
            fieldKey: field.key,
            value: values[field.key] ?? "",
            values,
            suggestions: fieldSuggestions,
          })

          return (
            <box key={field.key} flexDirection="column" gap={0}>
              <text>
                <span fg={isActive ? "#00b894" : "#636e72"}>{isActive ? "❯ " : "  "}</span>
                <span fg="#dfe6e9">{field.label}</span>
                {field.required && <span fg="#fdcb6e">{" *"}</span>}
              </text>
              {descriptionText && (
                <text fg="#636e72">{`  ${descriptionText}`}</text>
              )}
              <box
                borderStyle="single"
                borderColor={isActive ? "#00b894" : fieldState.value.length > 0 ? "#6c5ce7" : "#636e72"}
                paddingLeft={1}
                paddingRight={1}
                marginLeft={2}
              >
                <InputDisplay
                  value={fieldState.value}
                  cursor={fieldState.cursor}
                  isActive={isActive}
                  cursorVisible={cursorVisible}
                  placeholder={field.placeholder}
                  transform={field.masked && !showMaskedFields ? maskValue : undefined}
                />
              </box>
              {error && <text fg="#ff7675">{`  ${error}`}</text>}

              {isActive && fieldSuggestions.length > 0 && (
                <box flexDirection="column" marginLeft={3} marginTop={0}>
                  {suggestionScrollStart > 0 && (
                    <text fg="#636e72">{`  ↑ 还有 ${suggestionScrollStart} 项...`}</text>
                  )}
                  {visibleSuggestions.map((suggestion, suggestionIndex) => {
                    const realSuggestionIndex = suggestionScrollStart + suggestionIndex
                    const isSelected = realSuggestionIndex === safeSuggestionIndex
                    return (
                      <box key={`${field.key}-${suggestion.value}`} flexDirection="column" paddingLeft={1}>
                        <text>
                          <span fg={isSelected ? "#00b894" : "#636e72"}>
                            {isSelected ? "❯ " : "  "}
                          </span>
                          <span fg={isSelected ? "#dfe6e9" : "#b2bec3"}>
                            {isSelected ? <b>{suggestion.label}</b> : suggestion.label}
                          </span>
                        </text>
                        {suggestion.description && (
                          <text>
                            <span fg="#636e72">{`    ${suggestion.description}`}</span>
                          </text>
                        )}
                      </box>
                    )
                  })}
                  {suggestionScrollStart + maxVisibleSuggestions < fieldSuggestions.length && (
                    <text fg="#636e72">{`  ↓ 还有 ${fieldSuggestions.length - suggestionScrollStart - maxVisibleSuggestions} 项...`}</text>
                  )}
                </box>
              )}

              {isActive && fieldSuggestions.length === 0 && suggestionEmptyText && (
                <text fg="#636e72">{`  ${suggestionEmptyText}`}</text>
              )}
            </box>
          )
        })}

        {fieldScrollStart + maxVisibleFields < fields.length && (
          <text fg="#636e72">{`↓ 下方还有 ${fields.length - fieldScrollStart - maxVisibleFields} 项`}</text>
        )}
      </box>
    </PageFrame>
  )
}
