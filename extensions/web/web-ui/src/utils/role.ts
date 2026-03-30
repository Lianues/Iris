export function getRoleLabel(role: 'user' | 'model'): string {
  return role === 'user' ? '你' : 'Iris'
}
