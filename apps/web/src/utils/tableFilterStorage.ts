const STORAGE_KEY = 'tableFilterSettings'

export const loadTableSettings = (tableKey: string) => {
  if (!tableKey || typeof window === 'undefined') return {}

  try {
    const allSettings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')

    return allSettings[tableKey] || {}
  } catch (e) {
    console.log('Failed to load settings', e)

    return {}
  }
}

export const saveTableSettings = (tableKey: string, updates = {}) => {
  if (!tableKey || typeof window === 'undefined') return

  try {
    const allSettings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')

    const updatedSettings = {
      ...allSettings,
      [tableKey]: {
        ...allSettings[tableKey],
        ...updates
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSettings))
  } catch (e) {
    console.log('Failed to save settings', e)
  }
}

export const clearTableSettings = (tableKey: string) => {
  if (!tableKey || typeof window === 'undefined') return

  try {
    const allSettings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')

    delete allSettings[tableKey]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allSettings))
  } catch (e) {
    console.log('Failed to clear settings', e)
  }
}
