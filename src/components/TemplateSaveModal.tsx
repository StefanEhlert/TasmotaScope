import { useState, useEffect, useRef } from 'react'
import { saveTemplate, getCategories, type Template } from '../lib/templateStorage'
import { parseStructured, structuredToText } from '../lib/tasmotaRulesParser'

type Props = {
  isOpen: boolean
  text: string
  onClose: () => void
  onSave: (template: Template) => void
}

export default function TemplateSaveModal({ isOpen, text, onClose, onSave }: Props) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [useCustomCategory, setUseCustomCategory] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  
  // Reset form when modal opens - must be before early return
  useEffect(() => {
    if (isOpen) {
      setName('')
      setCategory('')
      setCustomCategory('')
      setUseCustomCategory(false)
      // Prevent body scroll when modal is open
      const originalOverflow = document.body.style.overflow
      const originalPosition = document.body.style.position
      const originalTop = document.body.style.top
      const scrollY = window.scrollY
      
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.width = '100%'
      
      return () => {
        // Restore body scroll when modal is closed
        document.body.style.overflow = originalOverflow
        document.body.style.position = originalPosition
        document.body.style.top = originalTop
        document.body.style.width = ''
        window.scrollTo(0, scrollY)
      }
    }
  }, [isOpen])

  // Add non-passive event listeners to prevent scrolling
  useEffect(() => {
    const backdrop = backdropRef.current
    if (!backdrop) return

    const handleWheel = (e: WheelEvent) => {
      // Prevent all scrolling on backdrop
      e.preventDefault()
      e.stopPropagation()
    }

    const handleTouchMove = (e: TouchEvent) => {
      // Prevent touch scrolling on backdrop
      const target = e.target as HTMLElement
      if (target === backdrop) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    // Add event listeners with passive: false
    backdrop.addEventListener('wheel', handleWheel, { passive: false })
    backdrop.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      backdrop.removeEventListener('wheel', handleWheel)
      backdrop.removeEventListener('touchmove', handleTouchMove)
    }
  }, [isOpen])
  
  const categories = getCategories()
  
  if (!isOpen) return null
  
  const handleSave = () => {
    if (!name.trim()) {
      alert('Bitte geben Sie einen Namen für das Template ein.')
      return
    }
    
    const finalCategory = useCustomCategory ? customCategory.trim() : category.trim()
    if (!finalCategory) {
      alert('Bitte wählen Sie ein Thema aus oder geben Sie ein neues ein.')
      return
    }
    
    // Structure the text before saving (so preview works without parser)
    const structured = parseStructured(text.trim())
    const structuredText = structuredToText(structured)
    
    const template = saveTemplate({
      name: name.trim(),
      category: finalCategory,
      text: structuredText,
    })
    
    onSave(template)
    handleClose()
  }
  
  const handleClose = () => {
    setName('')
    setCategory('')
    setCustomCategory('')
    setUseCustomCategory(false)
    onClose()
  }
  
  return (
    <div 
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ touchAction: 'none' }}
    >
      <div 
        className="modal-content w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl my-auto max-h-[90vh] overflow-y-auto"
        onWheel={(e) => {
          // Allow scrolling inside modal, but stop propagation to backdrop
          e.stopPropagation()
        }}
        style={{ touchAction: 'pan-y' }}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Template speichern</h2>
        
        <div className="mb-4">
          <label className="mb-2 block text-sm text-slate-300">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template-Name"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            autoFocus
          />
        </div>
        
        <div className="mb-4">
          <label className="mb-2 block text-sm text-slate-300">Thema</label>
          <div className="mb-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="radio"
                checked={!useCustomCategory}
                onChange={() => setUseCustomCategory(false)}
                className="h-3 w-3"
              />
              Vorhandenes Thema verwenden
            </label>
          </div>
          
          {!useCustomCategory && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Thema auswählen...</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}
          
          <div className="mt-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="radio"
                checked={useCustomCategory}
                onChange={() => setUseCustomCategory(true)}
                className="h-3 w-3"
              />
              Neues Thema erstellen
            </label>
          </div>
          
          {useCustomCategory && (
            <input
              type="text"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Neues Thema"
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          )}
        </div>
        
        <div className="mb-4 rounded-md border border-slate-700 bg-slate-950 p-3">
          <label className="mb-2 block text-xs text-slate-400">Vorschau</label>
          <pre 
            className="telemetry-scroll max-h-32 overflow-auto text-xs text-slate-300 whitespace-pre-wrap"
            onWheel={(e) => {
              // Allow scrolling within preview, but stop propagation
              e.stopPropagation()
            }}
          >
            {text.trim() || '(leer)'}
          </pre>
        </div>
        
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}
