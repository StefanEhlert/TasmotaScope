/**
 * Template storage for Tasmota Rules
 * Templates are stored in localStorage with structured text format
 */

export type Template = {
  id: string
  name: string
  category: string
  text: string // Structured text (formatted)
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'tasmotascope.templates.v1'

/**
 * Get all templates from storage
 */
export function getAllTemplates(): Template[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const templates = JSON.parse(stored) as Template[]
    return templates.sort((a, b) => {
      // Sort by category, then by name
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category)
      }
      return a.name.localeCompare(b.name)
    })
  } catch (error) {
    console.error('Error loading templates:', error)
    return []
  }
}

/**
 * Save a template
 */
export function saveTemplate(template: Omit<Template, 'id' | 'createdAt' | 'updatedAt'>): Template {
  const templates = getAllTemplates()
  const now = new Date().toISOString()
  
  const newTemplate: Template = {
    id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...template,
    createdAt: now,
    updatedAt: now,
  }
  
  templates.push(newTemplate)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  
  return newTemplate
}

/**
 * Delete a template
 */
export function deleteTemplate(id: string): boolean {
  try {
    const templates = getAllTemplates()
    const filtered = templates.filter(t => t.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
    return filtered.length < templates.length
  } catch (error) {
    console.error('Error deleting template:', error)
    return false
  }
}

/**
 * Update a template
 */
export function updateTemplate(id: string, updates: Partial<Omit<Template, 'id' | 'createdAt'>>): Template | null {
  try {
    const templates = getAllTemplates()
    const index = templates.findIndex(t => t.id === id)
    if (index === -1) return null
    
    templates[index] = {
      ...templates[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
    return templates[index]
  } catch (error) {
    console.error('Error updating template:', error)
    return null
  }
}

/**
 * Search templates by name or category
 */
export function searchTemplates(query: string): Template[] {
  const templates = getAllTemplates()
  if (!query.trim()) return templates
  
  const lowerQuery = query.toLowerCase()
  return templates.filter(t => 
    t.name.toLowerCase().includes(lowerQuery) ||
    t.category.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Get unique categories
 */
export function getCategories(): string[] {
  const templates = getAllTemplates()
  const categories = new Set(templates.map(t => t.category))
  return Array.from(categories).sort()
}
