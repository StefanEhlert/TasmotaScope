import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import {
  parseRule,
  parseStructured,
  renderTokens,
  structuredToText,
  correctWord,
  correctText,
} from '../lib/tasmotaRulesParser'
import { extractDeviceComponents, type ComponentSuggestion } from '../lib/deviceComponents'
import { DeviceState } from '../DeviceState'
import { topicCache } from '../lib/topicCache'
import TemplateSaveModal from './TemplateSaveModal'
import TemplateLoadModal from './TemplateLoadModal'

type Props = {
  value: string
  onChange: (value: string) => void
  /** Nur bei echter Benutzereingabe (nicht bei initialem Laden/Strukturieren). Für „ungespeichert“-Dialog. */
  onUserChange?: (value: string) => void
  placeholder?: string
  className?: string
  onHeightChange?: () => void
  onUpload?: () => void
  enabled?: boolean
  deviceId?: string
  brokerId?: string
  onSaveTemplate?: () => void
  onLoadTemplate?: () => void
}

export type RuleEditorRef = {
  textarea: HTMLTextAreaElement | null
  insertTemplate: (templateText: string) => void
  openSaveTemplate: () => void
  openLoadTemplate: () => void
}

const RuleEditor = forwardRef<RuleEditorRef, Props>(({
  value,
  onChange,
  onUserChange,
  placeholder,
  className = '',
  onHeightChange,
  onUpload: _onUpload,
  enabled = true,
  deviceId,
  brokerId,
  onSaveTemplate: _onSaveTemplate,
  onLoadTemplate: _onLoadTemplate,
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const plainValueRef = useRef<string>(value) // Store the text as-is
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [currentSuggestions, setCurrentSuggestions] = useState<ComponentSuggestion[]>([])
  const [_suggestionPrefix, setSuggestionPrefix] = useState('')
  const [suggestionPosition, setSuggestionPosition] = useState({ top: 0, left: 0 })
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const pendingCursorPositionRef = useRef<number | null>(null)
  const isRestoringPositionRef = useRef(false) // Flag to prevent race conditions
  const lastInputTimeRef = useRef<number>(0) // Track timing of inputs
  const isUserEditingRef = useRef(false) // Flag to prevent structure updates during user input
  const lastUserInputTimeRef = useRef<number>(0) // Track when user last typed
  const editingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null) // Timeout for clearing editing flag
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showLoadModal, setShowLoadModal] = useState(false)

  // Function to structure the current text (can be called manually or by useEffect)
  const structureCurrentText = () => {
    // Don't structure if suggestions dropdown is open - this prevents interference with autocompletion
    if (showSuggestions) return
    if (!plainValueRef.current) return
    
    // Save current cursor position before restructuring
    const oldCursorPos = textareaRef.current?.selectionStart ?? pendingCursorPositionRef.current ?? 0
    const oldText = plainValueRef.current
    
    // Calculate which line and column the cursor is on in the old text
    const oldLines = oldText.split('\n')
    let currentLine = 0
    let currentCol = 0
    let charCount = 0
    for (let i = 0; i < oldLines.length; i++) {
      const lineLength = oldLines[i].length + 1 // +1 for newline
      if (charCount + lineLength > oldCursorPos) {
        currentLine = i
        currentCol = oldCursorPos - charCount
        break
      }
      charCount += lineLength
    }
    
    // Structure the text (add indentation)
    const structured = parseStructured(oldText)
    let structuredText = structuredToText(structured)
    
    // Auto-correct capitalization for the entire text
    structuredText = correctText(structuredText)
    
    // Only update if structure or capitalization changed
    if (structuredText !== oldText) {
      // Store the structured and corrected text (must match overlay for synchronization)
      plainValueRef.current = structuredText

      // Keep textarea DOM in sync (ref updates don't trigger re-render, so value={plainValueRef.current} would stay stale)
      if (textareaRef.current) {
        textareaRef.current.value = structuredText
      }

      // Update highlighting with structured text (must match textarea)
      if (highlightRef.current) {
        const tokens = parseRule(structuredText)
        const html = renderTokens(tokens, structuredText, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }

      // Update parent with structured and corrected text
      onChange(structuredText)
      
      // Calculate new cursor position after restructuring
      // The cursor should move with the indentation of its line
      const newLines = structuredText.split('\n')
      if (currentLine < structured.length && currentLine < newLines.length) {
        const lineInfo = structured[currentLine]
        const indentSpaces = 5 * lineInfo.indent // 5 spaces per indent level
        const newLineStart = newLines.slice(0, currentLine).join('\n').length + (currentLine > 0 ? 1 : 0) // +1 for newline if not first line
        const newCursorPos = newLineStart + indentSpaces + currentCol
        
        // Ensure position is within bounds
        const maxPos = structuredText.length
        const validPos = Math.min(Math.max(0, newCursorPos), maxPos)
        
        // Store and restore cursor position
        pendingCursorPositionRef.current = validPos
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(validPos, validPos)
        }
      } else {
        // Fallback: just restore to end if line calculation fails
        if (textareaRef.current) {
          const maxPos = textareaRef.current.value.length
          const validPos = Math.min(oldCursorPos, maxPos)
          textareaRef.current.setSelectionRange(validPos, validPos)
        }
      }
    }
  }

  // Update text and highlighting when value changes externally (e.g., on load)
  // Only update if value is different from current ref to avoid overwriting user input
  // IMPORTANT: Do NOT structure the text if user is currently editing (within last 5 seconds) or if suggestions are open
  useEffect(() => {
    // Don't update if suggestions dropdown is open - this prevents interference with autocompletion
    if (showSuggestions) {
      // Only update highlighting if enabled status changed
      if (highlightRef.current && plainValueRef.current) {
        const tokens = parseRule(plainValueRef.current)
        const html = renderTokens(tokens, plainValueRef.current, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }
      return
    }
    
    // Don't update if user is actively editing (within last 5 seconds)
    // This prevents the parser from restructuring the text while user is typing
    const timeSinceLastInput = Date.now() - lastUserInputTimeRef.current
    if (isUserEditingRef.current || timeSinceLastInput < 5000) {
      // User is editing or just finished editing - don't restructure
      // Only update highlighting if enabled status changed
      if (highlightRef.current && plainValueRef.current) {
        const tokens = parseRule(plainValueRef.current)
        const html = renderTokens(tokens, plainValueRef.current, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }
      return
    }
    
    // User has stopped typing for at least 1 second - structure the text
    if (plainValueRef.current) {
      structureCurrentText()
    } else if (value !== undefined && value !== plainValueRef.current) {
      // Initial load - structure the incoming value
      const structured = parseStructured(value)
      let structuredText = structuredToText(structured)
      structuredText = correctText(structuredText)

      plainValueRef.current = structuredText
      if (textareaRef.current) {
        textareaRef.current.value = structuredText
      }
      if (highlightRef.current) {
        const tokens = parseRule(structuredText)
        const html = renderTokens(tokens, structuredText, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }
      if (structuredText !== value) {
        onChange(structuredText)
        // Nicht onUserChange – das ist nur Strukturierung beim Laden, keine Benutzereingabe
      }
    }
  }, [value, onChange, enabled, showSuggestions])
  
  // Update highlighting when enabled status changes (without changing the text)
  useEffect(() => {
    if (highlightRef.current && plainValueRef.current) {
      const tokens = parseRule(plainValueRef.current)
      const html = renderTokens(tokens, plainValueRef.current, enabled)
      highlightRef.current.innerHTML = html || '<br>'
    }
  }, [enabled])

  // Sync scroll between textarea and highlight
  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
    // Hide suggestions on scroll
    if (showSuggestions) {
      setShowSuggestions(false)
    }
  }

  // Find suggestions based on cursor position
  const findSuggestions = (text: string, cursorPos: number): ComponentSuggestion[] => {
    if (!deviceId) return []
    
    const beforeCursor = text.slice(0, cursorPos)
    
    // Check if we're after "publish" - then suggest topic prefixes
    const publishMatch = beforeCursor.match(/publish\s+([^\s\n\r#=<>]*)$/i)
    if (publishMatch) {
      const afterPublish = publishMatch[1].trim()
      
      // Wenn noch nichts nach publish steht, zeige stat/ und cmnd/
      if (!afterPublish) {
        return [
          { type: 'topic', value: 'stat/', description: 'Status Topic (stat/)' },
          { type: 'topic', value: 'cmnd/', description: 'Command Topic (cmnd/)' },
        ]
      }
      
      // Wenn stat/ eingegeben wurde
      if (afterPublish.toLowerCase().startsWith('stat/')) {
        const device = DeviceState.getDevice(deviceId)
        const deviceTopic = device?.topic || deviceId
        
        // Wenn genau "stat/" - zeige das eigene Topic
        const parts = afterPublish.split('/')
        if (parts.length === 2 && parts[1] === '') {
          return [
            { type: 'topic', value: `stat/${deviceTopic}/`, description: `Eigenes Topic: ${deviceTopic}` },
          ]
        }
        
        // Wenn "stat/deviceTopic" oder "stat/deviceTopic/" - zeige Komponenten
        if ((parts.length === 2 && parts[1] === deviceTopic) || 
            (parts.length === 3 && parts[1] === deviceTopic && parts[2] === '')) {
          const components = topicCache.filterTopics(brokerId, {
            scope: 'stat',
            deviceId: deviceId,
          })
          
          return components.map(comp => ({
            type: 'topic' as const,
            value: comp.fullTopic,
            description: `Komponente: ${comp.component || 'N/A'}`,
          })).slice(0, 20)
        }
      }
      
      // Wenn cmnd/ eingegeben wurde
      if (afterPublish.toLowerCase().startsWith('cmnd/')) {
        const parts = afterPublish.split('/')
        
        // Wenn genau "cmnd/" - zeige alle Topics anderer Geräte
        if (parts.length === 2 && parts[1] === '') {
          const uniqueTopics = topicCache.getUniqueTopics(brokerId, deviceId)
          return uniqueTopics.map(topic => ({
            type: 'topic' as const,
            value: `cmnd/${topic}/`,
            description: `Gerät: ${topic}`,
          })).slice(0, 20)
        }
        
        // Wenn "cmnd/topic" - filtere Topics
        if (parts.length === 2 && parts[1]) {
          const topicPrefix = parts[1].toLowerCase()
          const uniqueTopics = topicCache.getUniqueTopics(brokerId, deviceId)
          const filtered = uniqueTopics.filter(t => t.toLowerCase().startsWith(topicPrefix))
          
          return filtered.map(topic => ({
            type: 'topic' as const,
            value: `cmnd/${topic}/`,
            description: `Gerät: ${topic}`,
          })).slice(0, 20)
        }
        
        // Wenn "cmnd/topic/" - zeige Komponenten dieses Gerätes
        if (parts.length === 3 && parts[2] === '') {
          const selectedTopic = parts[1]
          const components = topicCache.getComponentsForTopic(brokerId, selectedTopic, 'cmnd')
          
          return components.map(comp => ({
            type: 'topic' as const,
            value: `cmnd/${selectedTopic}/${comp}`,
            description: `Komponente: ${comp}`,
          })).slice(0, 20)
        }
      }
    }
    
    // Check if we're after "ON" - then suggest triggers
    // Match "ON" or "on" followed by optional whitespace and optional trigger name
    const onMatch = beforeCursor.match(/on\s+([^\s\n\r#=<>]*)$/i)
    if (onMatch) {
      const afterOn = onMatch[1].trim()
      const allSuggestions = extractDeviceComponents(deviceId)
      const triggers = allSuggestions.filter(s => s.type === 'trigger')
      
      // If nothing after "ON", show all triggers
      if (!afterOn) {
        return triggers.slice(0, 20)
      }
      // If something after "ON", filter triggers by prefix
      if (afterOn.length >= 1) {
        const filtered = triggers.filter(s => 
          s.value.toLowerCase().startsWith(afterOn.toLowerCase())
        )
        return filtered.slice(0, 20)
      }
    }
    
    // Check if we're typing a topic (contains /)
    const topicMatch = beforeCursor.match(/([^\s\n\r#=<>]+)$/)
    
    if (!topicMatch) {
      return []
    }
    
    const prefix = topicMatch[1]
    if (prefix.length < 2) {
      return [] // Only show suggestions for words with at least 2 characters
    }
    
    // Special handling for topics
    if (prefix.includes('/')) {
      const prefixLower = prefix.toLowerCase()
      // Check if we're typing cmnd/ - then include all broker topics
      const isCmnd = prefixLower.startsWith('cmnd/')
      const isCmndExact = prefixLower === 'cmnd/'
      
      // For topics, filter by the full prefix (allows filtering like "stat/deviceName/")
      const allSuggestions = extractDeviceComponents(deviceId, isCmnd)
      
      // If typing cmnd/, also get all known topics from broker
      if (isCmnd) {
        const knownTopics = DeviceState.getKnownTopics()
        knownTopics.forEach((topic) => {
          // Only add if not already in suggestions
          if (!allSuggestions.some(s => s.value === topic)) {
            allSuggestions.push({
              type: 'topic',
              value: topic,
              description: `Topic: ${topic}`,
            })
          }
        })
      }
      
      const filtered = allSuggestions.filter(s => {
        if (s.type === 'topic') {
          // If exactly "cmnd/", show all topics (for browsing)
          if (isCmndExact) {
            return true
          }
          // Otherwise filter by prefix
          return s.value.toLowerCase().startsWith(prefixLower)
        }
        // For non-topics, check if prefix matches at word boundary
        return s.value.toLowerCase().startsWith(prefixLower)
      })
      
      // Sort: exact matches first, then by length
      const sorted = filtered.sort((a, b) => {
        const aExact = a.value.toLowerCase() === prefixLower
        const bExact = b.value.toLowerCase() === prefixLower
        if (aExact && !bExact) return -1
        if (!aExact && bExact) return 1
        return a.value.length - b.value.length
      })
      
      return sorted.slice(0, 20) // More suggestions for topics
    }
    
    // Regular word matching (for triggers, commands, etc.)
    const allSuggestions = extractDeviceComponents(deviceId)
    
    // Filter suggestions by prefix
    const filtered = allSuggestions.filter(s => {
      const valueLower = s.value.toLowerCase()
      const prefixLower = prefix.toLowerCase()
      
      // For triggers, allow partial matches (e.g., "Power" matches "Power1#State")
      if (s.type === 'trigger') {
        return valueLower.startsWith(prefixLower) || valueLower.includes(prefixLower)
      }
      
      // For other types, require prefix match
      return valueLower.startsWith(prefixLower)
    })
    
    // Sort: triggers first, then by exact match, then by length
    const sorted = filtered.sort((a, b) => {
      // Triggers first
      if (a.type === 'trigger' && b.type !== 'trigger') return -1
      if (a.type !== 'trigger' && b.type === 'trigger') return 1
      
      // Then exact matches
      const aExact = a.value.toLowerCase() === prefix.toLowerCase()
      const bExact = b.value.toLowerCase() === prefix.toLowerCase()
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1
      
      // Then by length
      return a.value.length - b.value.length
    })
    
    return sorted.slice(0, 20) // More suggestions for triggers
  }

  // Calculate cursor position for suggestion dropdown (fixed positioning to allow overflow)
  const calculateSuggestionPosition = () => {
    if (!textareaRef.current || !wrapperRef.current) return
    
    const textarea = textareaRef.current
    const cursorPos = textarea.selectionStart
    const text = textarea.value
    
    // Get text before cursor
    const textBeforeCursor = text.slice(0, cursorPos)
    const lines = textBeforeCursor.split('\n')
    const currentLine = lines.length - 1
    const currentLineText = lines[currentLine] || ''
    
    // Create a temporary span to measure text width
    const measureDiv = document.createElement('div')
    measureDiv.style.position = 'absolute'
    measureDiv.style.visibility = 'hidden'
    measureDiv.style.whiteSpace = 'pre'
    measureDiv.style.fontFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    measureDiv.style.fontSize = '0.75rem'
    measureDiv.style.lineHeight = '1.5rem'
    measureDiv.style.padding = '0'
    measureDiv.style.margin = '0'
    measureDiv.textContent = currentLineText
    document.body.appendChild(measureDiv)
    
    const textWidth = measureDiv.offsetWidth
    document.body.removeChild(measureDiv)
    
    // Get position relative to viewport
    const textareaRect = textarea.getBoundingClientRect()
    const lineHeight = 24 // 1.5rem = 24px
    const padding = 8 // 0.5rem = 8px
    
    // Calculate position relative to viewport (fixed positioning)
    const top = textareaRect.top + (currentLine + 1) * lineHeight + padding
    const left = textareaRect.left + textWidth + padding
    
    // Make sure dropdown doesn't go outside viewport (but allow overflow of editor)
    const dropdownWidth = 256 // w-64 = 256px
    const maxLeft = window.innerWidth - dropdownWidth - 16 // 16px margin from edge
    const adjustedLeft = Math.min(left, maxLeft)
    
    setSuggestionPosition({ top, left: adjustedLeft })
  }

  // Insert suggestion at cursor position
  const insertSuggestion = (suggestion: string) => {
    if (!textareaRef.current) return
    
    const textarea = textareaRef.current
    const cursorPos = textarea.selectionStart
    const text = textarea.value
    const beforeCursor = text.slice(0, cursorPos)
    const afterCursor = text.slice(cursorPos)
    
    // Check if we're after "publish" - then replace everything after "publish "
    const publishMatch = beforeCursor.match(/publish\s+([^\s\n\r#=<>]*)$/i)
    if (publishMatch) {
      // Replace everything after "publish "
      const beforePublish = beforeCursor.slice(0, publishMatch.index! + 'publish '.length)
      const newText = beforePublish + suggestion + afterCursor
      const newCursorPos = beforePublish.length + suggestion.length
      
      plainValueRef.current = newText
      onChange(newText)
      onUserChange?.(newText)
      
      // Update highlighting
      if (highlightRef.current) {
        const tokens = parseRule(newText)
        const html = renderTokens(tokens, newText, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }
      
      // Store cursor position for restoration
      pendingCursorPositionRef.current = newCursorPos
      
      // Manually trigger suggestions update
      const updatedSuggestions = findSuggestions(newText, newCursorPos)
      if (updatedSuggestions.length > 0) {
        const publishMatch = newText.slice(0, newCursorPos).match(/publish\s+([^\s\n\r#=<>]*)$/i)
        if (publishMatch) {
          setSuggestionPrefix(publishMatch[1] || '')
        } else {
          const wordMatch = newText.slice(0, newCursorPos).match(/([\w#/]+)$/)
          setSuggestionPrefix(wordMatch ? wordMatch[1] : '')
        }
        setCurrentSuggestions(updatedSuggestions)
        setSuggestionIndex(0)
        calculateSuggestionPosition()
        setShowSuggestions(true)
      } else {
        setShowSuggestions(false)
      }
      
      autoGrow()
      return
    }
    
    // Find the word to replace (for regular suggestions)
    const wordMatch = beforeCursor.match(/([\w#/]+)$/)
    if (!wordMatch) return
    
    const prefix = wordMatch[1]
    const beforeWord = beforeCursor.slice(0, cursorPos - prefix.length)
    const newText = beforeWord + suggestion + afterCursor
    const newCursorPos = beforeWord.length + suggestion.length
    
    plainValueRef.current = newText
    onChange(newText)
    onUserChange?.(newText)
    
    // Update highlighting
    if (highlightRef.current) {
      const tokens = parseRule(newText)
      const html = renderTokens(tokens, newText, enabled)
      highlightRef.current.innerHTML = html || '<br>'
    }
    
    // Restore cursor position
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        textareaRef.current.focus()
        // Trigger input event to show next suggestions if needed
        const event = new Event('input', { bubbles: true })
        textareaRef.current.dispatchEvent(event)
      }
    })
    
    setShowSuggestions(false)
    autoGrow()
  }

  // Handle input changes
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let newValue = e.target.value
    const textarea = e.target
    
    // Mark that user is editing - this prevents the useEffect from restructuring the text
    isUserEditingRef.current = true
    const currentTime = Date.now()
    lastUserInputTimeRef.current = currentTime
    
    // Save cursor position BEFORE any updates
    // Use selectionStart which is the actual cursor position
    const cursorPosition = textarea.selectionStart
    const oldValue = plainValueRef.current
    
    // Calculate the actual cursor position change
    // If value increased, cursor likely moved forward
    // If value decreased, cursor likely stayed or moved back
    const valueDiff = newValue.length - oldValue.length
    const timeSinceLastInput = currentTime - lastInputTimeRef.current
    lastInputTimeRef.current = currentTime
    
    // Clear the editing flag after a delay (when user stops typing)
    // This allows the useEffect to restructure the text after user finishes editing
    if (editingTimeoutRef.current) {
      clearTimeout(editingTimeoutRef.current)
    }
    editingTimeoutRef.current = setTimeout(() => {
      isUserEditingRef.current = false
      editingTimeoutRef.current = null
      // Trigger structure update after 5 seconds of inactivity (only if suggestions are not open)
      if (!showSuggestions) {
        structureCurrentText()
      }
    }, 5000) // 5 seconds after last input
    
    // If we're currently restoring position, don't interfere
    // This prevents race conditions when typing fast
    if (isRestoringPositionRef.current && timeSinceLastInput < 50) {
      // User is typing very fast, let browser handle it naturally
      plainValueRef.current = newValue
      onChange(newValue)
      onUserChange?.(newValue)
      
      // Update highlighting
      if (highlightRef.current) {
        const tokens = parseRule(newValue)
        const html = renderTokens(tokens, newValue, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }
      autoGrow()
      return
    }
    
    // Check for autocomplete suggestions
    const suggestions = findSuggestions(newValue, cursorPosition)
    if (suggestions.length > 0) {
      // Check if we're after publish
      const publishMatch = newValue.slice(0, cursorPosition).match(/publish\s+([^\s\n\r#=<>]*)$/i)
      if (publishMatch) {
        setSuggestionPrefix(publishMatch[1] || '')
      } else {
        const wordMatch = newValue.slice(0, cursorPosition).match(/([\w#/]+)$/)
        setSuggestionPrefix(wordMatch ? wordMatch[1] : '')
      }
      setCurrentSuggestions(suggestions)
      setSuggestionIndex(0)
      calculateSuggestionPosition()
      setShowSuggestions(true)
    } else {
      setShowSuggestions(false)
    }
    
    // Auto-correct capitalization for words that are "complete" (after space, newline, or certain characters)
    // Only correct if the last character is a word boundary (space, newline, or special chars like #, =, ;, etc.)
    const lastChar = newValue[cursorPosition - 1]
    const isWordBoundary = lastChar && /[\s\n\r#=<>;]/.test(lastChar)
    
    if (isWordBoundary && cursorPosition > 1) {
      // Check the word before the cursor
      const beforeCursor = newValue.slice(0, cursorPosition - 1) // Exclude the boundary character
      const afterCursor = newValue.slice(cursorPosition - 1) // Include the boundary character
      
      // Find the last word before the boundary (exclude ; and other separators)
      const wordMatch = beforeCursor.match(/([^\s\n\r#=<>;]+)$/)
      if (wordMatch) {
        const word = wordMatch[1]
        // Find previous token for context (to detect if on/off is a value)
        const tokens = parseRule(beforeCursor.slice(0, beforeCursor.length - word.length))
        const previousToken = tokens.length > 0 ? tokens[tokens.length - 1] : undefined
        const correctedWord = correctWord(word, { previousToken })
        if (correctedWord !== word) {
          // Replace the word with corrected version
          const beforeWord = beforeCursor.slice(0, beforeCursor.length - word.length)
          newValue = beforeWord + correctedWord + afterCursor
          // Update cursor position (adjust for length difference)
          const lengthDiff = correctedWord.length - word.length
          const newCursorPosition = cursorPosition + lengthDiff
          
          // Update the ref and trigger onChange
          plainValueRef.current = newValue
          pendingCursorPositionRef.current = newCursorPosition
          
          // Update highlighting first (before onChange to minimize re-renders)
          if (highlightRef.current) {
            const tokens = parseRule(newValue)
            const html = renderTokens(tokens, newValue, enabled)
            highlightRef.current.innerHTML = html || '<br>'
          }
          
          // Trigger onChange (this will cause React to re-render)
          onChange(newValue)
          onUserChange?.(newValue)
          
          // Set cursor position immediately to prevent race conditions
          // Use requestAnimationFrame to ensure DOM is ready, but do it synchronously
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              const maxPos = textareaRef.current.value.length
              const finalPos = Math.min(newCursorPosition, maxPos)
              textareaRef.current.setSelectionRange(finalPos, finalPos)
            }
          })
          
          // Auto-grow
          autoGrow()
          return
        }
      }
    }
    
    // No correction needed, proceed normally
    // Check if value actually changed (not just highlighting update)
    const valueChanged = newValue !== plainValueRef.current
    
    if (valueChanged) {
      plainValueRef.current = newValue
      
      // Update highlighting with syntax highlighting (preserves line breaks and spaces)
      if (highlightRef.current) {
        const tokens = parseRule(newValue)
        const html = renderTokens(tokens, newValue, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }
      
      // Calculate the correct cursor position
      // For deletion (Backspace/Delete), the cursor position is already correct from the browser
      // For insertion, we need to account for the inserted characters
      let newCursorPos: number
      
      if (valueDiff < 0) {
        // Value decreased (deletion) - cursor position is already correct
        // The browser maintains the cursor position correctly during deletion
        // Use the cursor position from the textarea (which is already correct)
        newCursorPos = cursorPosition
      } else if (valueDiff > 0) {
        // Value increased (insertion) - cursor moved forward by the number of inserted chars
        newCursorPos = cursorPosition
      } else {
        // Value length unchanged (replacement) - cursor position stays the same
        newCursorPos = cursorPosition
      }
      
      // Ensure position is within bounds
      newCursorPos = Math.min(Math.max(0, newCursorPos), newValue.length)
      
      // Store cursor position for restoration
      pendingCursorPositionRef.current = newCursorPos
      
      // Set restoring flag to prevent race conditions
      isRestoringPositionRef.current = true
      
      // Send plain text to parent (no transformation)
      onChange(newValue)
      onUserChange?.(newValue)
      
      // Restore position immediately (synchronously) to prevent React from resetting it
      // This is critical for both insertions and deletions when typing fast
      if (textareaRef.current) {
        const maxPos = textareaRef.current.value.length
        const finalPos = Math.min(newCursorPos, maxPos)
        
        // Set position immediately
        textareaRef.current.setSelectionRange(finalPos, finalPos)
        
        // Also set it again after a microtask to catch any React re-renders
        Promise.resolve().then(() => {
          if (textareaRef.current && pendingCursorPositionRef.current === newCursorPos) {
            const currentMaxPos = textareaRef.current.value.length
            const currentFinalPos = Math.min(newCursorPos, currentMaxPos)
            const currentPos = textareaRef.current.selectionStart
            
            // Only restore if position is significantly wrong
            if (Math.abs(currentPos - currentFinalPos) > 1) {
              textareaRef.current.setSelectionRange(currentFinalPos, currentFinalPos)
            }
          }
          
          // Clear restoring flag after a short delay
          setTimeout(() => {
            isRestoringPositionRef.current = false
          }, 30)
        })
      } else {
        // Clear flag if textarea is not available
        setTimeout(() => {
          isRestoringPositionRef.current = false
        }, 30)
      }
      
      // Set cursor position immediately after onChange to prevent race conditions
      // Use a microtask to ensure it happens after React's state update but before next frame
      Promise.resolve().then(() => {
        if (textareaRef.current && pendingCursorPositionRef.current === newCursorPos) {
          const maxPos = textareaRef.current.value.length
          const finalPos = Math.min(newCursorPos, maxPos)
          // Only set if position is still valid and hasn't been overridden
          if (textareaRef.current.selectionStart !== finalPos) {
            textareaRef.current.setSelectionRange(finalPos, finalPos)
          }
        }
      })
    } else {
      // Value didn't change, just update highlighting
      if (highlightRef.current) {
        const tokens = parseRule(newValue)
        const html = renderTokens(tokens, newValue, enabled)
        highlightRef.current.innerHTML = html || '<br>'
      }
      // Don't call onChange if value didn't change
      // Don't restore cursor position either - browser handles it
    }
    
    // Auto-grow
    autoGrow()
  }

  // Auto-grow functionality
  const autoGrow = () => {
    if (textareaRef.current) {
      // Reset height to auto to allow shrinking
      textareaRef.current.style.height = 'auto'
      // Set to scrollHeight
      const newHeight = Math.max(
        textareaRef.current.scrollHeight,
        128, // min-h-[8rem] = 128px
      )
      textareaRef.current.style.height = `${newHeight}px`
      onHeightChange?.()
    }
  }

  // Initialize value on mount
  useEffect(() => {
    if (plainValueRef.current !== value) {
      // Store the value directly, no transformation
      plainValueRef.current = value
    }
  }, [])

  // Auto-grow on mount and when value changes
  useEffect(() => {
    autoGrow()
  }, [plainValueRef.current])
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (editingTimeoutRef.current) {
        clearTimeout(editingTimeoutRef.current)
      }
    }
  }, [])

  // Restore cursor position after value changes (fallback if Promise.resolve didn't work)
  // This is a safety net for cases where the microtask didn't execute in time
  useLayoutEffect(() => {
    // Don't restore if we're currently in the middle of restoring (prevent race conditions)
    if (isRestoringPositionRef.current) {
      return
    }
    
    if (pendingCursorPositionRef.current !== null && textareaRef.current) {
      const pos = pendingCursorPositionRef.current
      const maxPos = textareaRef.current.value.length
      const validPos = Math.min(pos, maxPos)
      const currentPos = textareaRef.current.selectionStart
      
      // Only restore if cursor is significantly wrong (likely reset by React)
      // Use a threshold to avoid unnecessary updates when position is already correct
      if (Math.abs(currentPos - validPos) > 2) {
        textareaRef.current.setSelectionRange(validPos, validPos)
      }
      
      // Clear the pending position after a short delay to allow for fast typing
      // This prevents race conditions when typing quickly
      const timeoutId = setTimeout(() => {
        pendingCursorPositionRef.current = null
      }, 100) // Longer delay to prevent interference with fast typing
      
      return () => clearTimeout(timeoutId)
    }
  }, [plainValueRef.current])

  // Initialize and update topic cache periodically
  useEffect(() => {
    if (brokerId !== undefined) {
      // Initial cache update
      topicCache.updateCache(brokerId)
      
      // Set up periodic updates (every 10 minutes)
      const interval = setInterval(() => {
        topicCache.updateCache(brokerId)
      }, 10 * 60 * 1000) // 10 minutes
      
      return () => clearInterval(interval)
    }
  }, [brokerId])

  // Get selected text or full text for template saving
  const getTextForTemplate = (): string => {
    if (!textareaRef.current) return plainValueRef.current
    
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    
    // If text is selected, use selected text, otherwise use full text
    if (start !== end) {
      return plainValueRef.current.substring(start, end)
    }
    
    return plainValueRef.current
  }
  
  // Handle template save (reserved for template UI)
  const handleSaveTemplate = () => {
    const text = getTextForTemplate()
    if (!text.trim()) {
      alert('Bitte wählen Sie Text aus oder geben Sie Text ein, um ein Template zu speichern.')
      return
    }
    
    setShowSaveModal(true)
  }
  
  // Handle template load (reserved for template UI)
  const handleLoadTemplate = () => {
    setShowLoadModal(true)
  }
  
  // Insert template at the end of the rule
  const handleInsertTemplate = (templateText: string) => {
    // Get current text from textarea directly to ensure we have the latest value
    const textarea = textareaRef.current
    const currentText = textarea?.value || plainValueRef.current || ''
    const trimmedCurrent = currentText.trimEnd()
    
    // Always insert at the end, with a newline if there's existing text
    const newText = trimmedCurrent
      ? `${trimmedCurrent}\n${templateText}`
      : templateText
    
    // Update the ref immediately
    plainValueRef.current = newText
    
    // Update highlighting
    if (highlightRef.current) {
      const tokens = parseRule(newText)
      const html = renderTokens(tokens, newText, enabled)
      highlightRef.current.innerHTML = html || '<br>'
    }
    
    // Call onChange to update parent
    onChange(newText)
    onUserChange?.(newText)
    
    // Update textarea value and focus
    if (textarea) {
      textarea.value = newText
      textarea.focus()
      const newCursorPos = newText.length
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }
  }

  // Expose textarea ref, insertTemplate and template modal openers to parent
  useImperativeHandle(ref, () => ({
    get textarea() {
      return textareaRef.current
    },
    insertTemplate: handleInsertTemplate,
    openSaveTemplate: handleSaveTemplate,
    openLoadTemplate: handleLoadTemplate,
  }), [enabled, onChange])
  
  return (
    <>
      <div
        ref={wrapperRef}
        className={`relative min-h-[8rem] w-full overflow-hidden rounded-md border border-slate-700 bg-slate-800/60 ${className}`}
      >
      {/* Highlight layer - BELOW textarea (z-index: 1) */}
      <div
        ref={highlightRef}
        className="pointer-events-none absolute inset-0 overflow-hidden highlight-no-scrollbar"
        style={{
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: '0.75rem',
          lineHeight: '1.5rem',
          margin: 0,
          padding: '0.5rem',
          letterSpacing: 'normal',
          textIndent: 0,
          boxSizing: 'border-box',
          border: 'none',
          outline: 'none',
          verticalAlign: 'baseline',
          backgroundColor: 'transparent',
          position: 'absolute',
          zIndex: 1, // BELOW textarea
        }}
        aria-hidden="true"
      />

      {/* Suggestions dropdown - fixed positioning to allow overflow */}
      {showSuggestions && currentSuggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="fixed z-50 max-h-48 w-64 overflow-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg"
          style={{
            top: `${suggestionPosition.top}px`,
            left: `${suggestionPosition.left}px`,
          }}
        >
          {currentSuggestions.map((suggestion, index) => (
            <div
              key={`${suggestion.value}-${index}`}
              className={`px-3 py-2 text-sm cursor-pointer ${
                index === suggestionIndex
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-200 hover:bg-slate-800'
              }`}
              onClick={() => insertSuggestion(suggestion.value)}
              onMouseEnter={() => setSuggestionIndex(index)}
            >
              <div className="font-mono">{suggestion.value}</div>
              {suggestion.description && (
                <div className="text-xs text-slate-400">{suggestion.description}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input layer (textarea) - ABOVE highlight (z-index: 10) */}
      <textarea
        ref={textareaRef}
        value={plainValueRef.current} // Use text as-is, no transformation
        onChange={handleInput}
        onScroll={handleScroll}
        onKeyDown={(e) => {
          if (showSuggestions && currentSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSuggestionIndex((prev) => 
                prev < currentSuggestions.length - 1 ? prev + 1 : prev
              )
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSuggestionIndex((prev) => (prev > 0 ? prev - 1 : 0))
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              insertSuggestion(currentSuggestions[suggestionIndex].value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setShowSuggestions(false)
            }
          }
          
          // For Backspace/Delete, ensure cursor position is preserved immediately
          // This helps when holding down Backspace to delete quickly
          if (e.key === 'Backspace' || e.key === 'Delete') {
            const textarea = e.currentTarget
            const currentPos = textarea.selectionStart
            // Store position immediately before deletion happens
            // This will be used in handleInput to restore position
            pendingCursorPositionRef.current = currentPos
          }
        }}
        onBlur={(_e) => {
          // Delay hiding suggestions to allow clicking on them
          setTimeout(() => {
            if (!suggestionsRef.current?.contains(document.activeElement)) {
              setShowSuggestions(false)
            }
          }, 200)
        }}
        placeholder={placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="relative min-h-[8rem] w-full resize-none overflow-auto border-0 bg-transparent caret-slate-100 outline-none focus:ring-0"
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: '0.75rem',
          lineHeight: '1.5rem',
          tabSize: 2,
          color: 'transparent', // Transparent so highlight shows through
          backgroundColor: 'transparent',
          letterSpacing: 'normal',
          textIndent: 0,
          margin: 0,
          padding: '0.5rem',
          boxSizing: 'border-box',
          border: 'none',
          outline: 'none',
          position: 'relative',
          zIndex: 10, // ABOVE highlight
        }}
      />
      </div>
      
      {/* Template Modals */}
      <TemplateSaveModal
        isOpen={showSaveModal}
        text={getTextForTemplate()}
        onClose={() => setShowSaveModal(false)}
        onSave={() => {
          setShowSaveModal(false)
        }}
      />
      <TemplateLoadModal
        isOpen={showLoadModal}
        enabled={enabled}
        onClose={() => setShowLoadModal(false)}
        onInsert={handleInsertTemplate}
      />
    </>
  )
})

RuleEditor.displayName = 'RuleEditor'

export default RuleEditor
