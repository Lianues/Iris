/**
 * YAML 配置文件扁平化工具
 * 将嵌套的 YAML 对象转换为扁平的可编辑字段列表
 */

export interface ConfigField {
  /** 值在 YAML 对象中的路径段 */
  path: string[]
  /** 显示用的键名（路径最后一段） */
  key: string
  /** 缩进深度 */
  depth: number
  /** 是否为分组标题（对象 / 复杂数组容器） */
  isSection: boolean
  /** 字段原始值 */
  value: any
  /** 值类型（分组标题为 null） */
  valueType: "string" | "number" | "boolean" | "null" | null
  /** 是否可内联编辑 */
  editable: boolean
  /** 是否为简单数组（逗号分隔显示） */
  isSimpleArray: boolean
  /** 分组标题附加说明 */
  sectionHint?: string
}

export interface ConfigChange {
  path: string[]
  key: string
  oldValue: any
  newValue: any
}

// ── 内部常量 ──

const PATH_SEPARATOR = "\0"

// ── 公开工具函数 ──

export function pathToKey(path: string[]): string {
  return path.join(PATH_SEPARATOR)
}

export function keyToPath(key: string): string[] {
  return key.split(PATH_SEPARATOR)
}

/**
 * 将 YAML 对象递归扁平化为 ConfigField 列表。
 * 对象 → 分组标题 + 子字段；简单数组 → 逗号分隔可编辑字段；标量 → 可编辑字段。
 */
export function flattenYaml(obj: any, pathPrefix: string[] = [], depth = 0): ConfigField[] {
  if (obj == null || typeof obj !== "object") return []

  const fields: ConfigField[] = []

  for (const [key, value] of Object.entries(obj)) {
    const path = [...pathPrefix, key]

    if (Array.isArray(value)) {
      const isSimple = value.length === 0 || value.every((v) => v === null || typeof v !== "object")

      if (isSimple) {
        // 简单标量数组 → 单行逗号分隔
        fields.push({
          path, key, depth,
          isSection: false,
          value,
          valueType: "string",
          editable: true,
          isSimpleArray: true,
        })
      } else {
        // 复杂数组（含对象项）→ 分组标题 + 逐项展开
        fields.push({
          path, key, depth,
          isSection: true,
          value: undefined,
          valueType: null,
          editable: false,
          isSimpleArray: false,
          sectionHint: `(${value.length} 项)`,
        })
        for (let i = 0; i < value.length; i++) {
          const item = value[i]
          if (item != null && typeof item === "object" && !Array.isArray(item)) {
            fields.push({
              path: [...path, String(i)],
              key: `[${i}]`,
              depth: depth + 1,
              isSection: true,
              value: undefined,
              valueType: null,
              editable: false,
              isSimpleArray: false,
            })
            fields.push(...flattenYaml(item, [...path, String(i)], depth + 2))
          } else {
            fields.push({
              path: [...path, String(i)],
              key: `[${i}]`,
              depth: depth + 1,
              isSection: false,
              value: item,
              valueType: resolveValueType(item),
              editable: true,
              isSimpleArray: false,
            })
          }
        }
      }
    } else if (value != null && typeof value === "object") {
      // 嵌套对象 → 分组标题 + 递归
      fields.push({
        path, key, depth,
        isSection: true,
        value: undefined,
        valueType: null,
        editable: false,
        isSimpleArray: false,
      })
      fields.push(...flattenYaml(value, path, depth + 1))
    } else {
      // 标量值
      fields.push({
        path, key, depth,
        isSection: false,
        value,
        valueType: resolveValueType(value),
        editable: true,
        isSimpleArray: false,
      })
    }
  }

  return fields
}

function resolveValueType(value: any): "string" | "number" | "boolean" | "null" {
  if (value === null || value === undefined) return "null"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "number") return "number"
  return "string"
}

/** 格式化字段值用于终端显示 */
export function formatDisplayValue(value: any, isSimpleArray = false): string {
  if (isSimpleArray && Array.isArray(value)) {
    if (value.length === 0) return "(空列表)"
    return value.map(String).join(", ")
  }
  if (value === null || value === undefined) return "(未设置)"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") {
    if (value.length === 0) return "(空)"
    if (value.includes("\n")) {
      const lines = value.split("\n").filter(Boolean)
      const first = lines[0].length > 50 ? lines[0].slice(0, 47) + "..." : lines[0]
      return lines.length > 1 ? `${first}  (+${lines.length - 1} 行)` : first
    }
    if (value.length > 70) return value.slice(0, 67) + "..."
    return value
  }
  return String(value)
}

/** 将编辑框中的文本解析为目标类型的值 */
export function parseEditValue(text: string, originalType: "string" | "number" | "boolean" | "null"): any {
  const trimmed = text.trim()

  if (trimmed === "" || trimmed === "null" || trimmed === "~") return null

  if (originalType === "number") {
    const num = Number(trimmed)
    return Number.isNaN(num) ? trimmed : num
  }

  if (originalType === "boolean") {
    if (trimmed === "true" || trimmed === "1" || trimmed === "yes") return true
    if (trimmed === "false" || trimmed === "0" || trimmed === "no") return false
    return null
  }

  // string / null → string
  return text
}

/** 通过路径在嵌套对象上设置值 */
export function setByPath(obj: any, path: string[], value: any): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]
    if (current[segment] === undefined || current[segment] === null) {
      const next = path[i + 1]
      const num = Number(next)
      current[segment] = Number.isInteger(num) && String(num) === next ? [] : {}
    }
    current = current[segment]
  }
  current[path[path.length - 1]] = value
}

/** 格式化变更值（用于确认页） */
export function formatChangeValue(value: any): string {
  if (value === null || value === undefined) return "(未设置)"
  if (typeof value === "boolean") return value ? "✓ true" : "✗ false"
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return "(空列表)"
    const joined = value.map(String).join(", ")
    return joined.length > 40 ? joined.slice(0, 37) + "..." : joined
  }
  if (typeof value === "string") {
    if (value.length === 0) return "(空)"
    if (value.length > 40) return value.slice(0, 37) + "..."
    return value
  }
  return String(value)
}
