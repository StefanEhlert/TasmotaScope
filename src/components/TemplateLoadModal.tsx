import { useState, useEffect, useRef } from 'react'
import { searchTemplates, getAllTemplates, type Template } from '../lib/templateStorage'
import { renderTokens, parseRule } from '../lib/tasmotaRulesParser'

type Props = {
  isOpen: boolean
  enabled: boolean
  onClose: () => void
  onInsert: (text: string) => void
}

export default function TemplateLoadModal({ isOpen, enabled, onClose, onInsert }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const backdropRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    if (isOpen) {
      // Load all templates when modal opens
      setTemplates(getAllTemplates())
      setSearchQuery('')
      setSelectedTemplate(null)
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
  
  useEffect(() => {
    if (searchQuery.trim()) {
      setTemplates(searchTemplates(searchQuery))
    } else {
      setTemplates(getAllTemplates())
    }
    setSelectedTemplate(null)
  }, [searchQuery])
  
  if (!isOpen) return null
  
  const handleInsert = () => {
    if (selectedTemplate) {
      onInsert(selectedTemplate.text)
      handleClose()
    }
  }
  
  const handleClose = () => {
    setSearchQuery('')
    setSelectedTemplate(null)
    onClose()
  }
  
  // Render preview with syntax highlighting
  const renderPreview = (text: string) => {
    const tokens = parseRule(text)
    return renderTokens(tokens, text, enabled)
  }
  
  return (
    <div 
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ touchAction: 'none' }}
    >
      <div 
        className="flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl my-auto"
        onWheel={(e) => {
          // Allow scrolling inside modal, but stop propagation to backdrop
          e.stopPropagation()
        }}
      >
        <div className="border-b border-slate-700 p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Template laden</h2>
          
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Nach Name oder Thema suchen..."
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            autoFocus
          />
        </div>
        
        <div className="flex flex-1 gap-4 overflow-hidden p-6">
          {/* Template List */}
          <div className="flex w-1/2 flex-col overflow-hidden rounded-md border border-slate-700 bg-slate-950">
            <div className="border-b border-slate-700 p-2 text-xs text-slate-400">
              {templates.length} Template{templates.length !== 1 ? 's' : ''} gefunden
            </div>
            <div className="flex-1 overflow-y-auto">
              {templates.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-400">
                  Keine Templates gefunden
                </div>
              ) : (
                templates.map((template) => (
                  <div
                    key={template.id}
                    onClick={() => setSelectedTemplate(template)}
                    className={`cursor-pointer border-b border-slate-800 p-3 hover:bg-slate-800 ${
                      selectedTemplate?.id === template.id ? 'bg-slate-800' : ''
                    }`}
                  >
                    <div className="font-medium text-slate-100">{template.name}</div>
                    <div className="text-xs text-slate-400">{template.category}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {template.text.substring(0, 60)}...
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Preview */}
          <div className="flex w-1/2 flex-col overflow-hidden rounded-md border border-slate-700 bg-slate-950">
            <div className="border-b border-slate-700 p-2 text-xs text-slate-400">
              Vorschau
            </div>
            <div className="telemetry-scroll flex-1 overflow-y-auto p-4">
              {selectedTemplate ? (
                <div
                  className="font-mono text-sm"
                  dangerouslySetInnerHTML={{
                    __html: renderPreview(selectedTemplate.text) || '<br>',
                  }}
                />
              ) : (
                <div className="text-center text-sm text-slate-400">
                  Wählen Sie ein Template aus, um die Vorschau zu sehen
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="border-t border-slate-700 p-6">
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
              onClick={handleInsert}
              disabled={!selectedTemplate}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              Übernehmen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
