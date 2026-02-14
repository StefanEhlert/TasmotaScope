export type TokenType = 'KEYWORD' | 'TOPIC' | 'TRIGGER' | 'COMMAND' | 'TEXT' | 'COMMENT'

export interface Token {
  type: TokenType
  value: string
  start: number
  end: number
}

export type BlockType = 'on' | 'if' | 'elseif' | 'else'

export interface StructuredLine {
  lineNumber: number
  indent: number
  blockType: BlockType | null
  blockLevel: number
  tokens: Token[]
  rawText: string
}

const KEYWORDS = [
  'on',
  'do',
  'endon',
  'if',
  'endif',
  'elseif',
  'else',
  'break',
  'publish',
  'backlog',
  'power',
  'var',
  'mem',
  'rule',
  'teleperiod',
  'and',
  'or',
  'not',
]

const TOPIC_PATTERNS = [
  /^(stat|cmnd|tele)\//, // stat/, cmnd/, tele/
  /%topic%/,
  /%prefix%/,
]

const FULLTOPIC_PATTERNS = [
  /%fulltopic%/,
  /%hostname%/,
]

export function isKeyword(word: string): boolean {
  return KEYWORDS.includes(word.toLowerCase())
}

export function isTopic(text: string): boolean {
  return TOPIC_PATTERNS.some((pattern) => pattern.test(text))
}

export function isFullTopic(text: string): boolean {
  return FULLTOPIC_PATTERNS.some((pattern) => pattern.test(text))
}

export function detectTrigger(text: string): boolean {
  // RuleTimer1, Switch1#State, Power1#State, Button1#State, etc.
  // Match patterns like: Power1, Power1#State, Power1#State=1, Switch1#State, etc.
  // The pattern should match the base name (Power, Switch, etc.) followed by optional number,
  // optional #State, and optional =value
  return /^(RuleTimer|Switch|Power|Button|Sensor|Time|System|Tele|Uptime|WiFi|Mqtt|Serial|SerialReceived|SerialSend)\d*(#\w+)?(=.*)?$/i.test(
    text,
  )
}

// Auto-correct capitalization for known commands
export function correctWord(word: string, context?: { previousToken?: Token }): string {
  if (!word) return word
  
  const lower = word.toLowerCase()
  
  // Check if "on" or "off" is used as a value (after topic or component)
  if ((lower === 'on' || lower === 'off') && context?.previousToken) {
    const prevType = context.previousToken.type
    // If previous token is a topic, trigger, or command (component), treat on/off as value
    if (prevType === 'TOPIC' || prevType === 'TRIGGER' || prevType === 'COMMAND') {
      return lower === 'on' ? 'ON' : 'OFF'
    }
  }
  
  // Check keywords
  if (isKeyword(lower)) {
    // Return keyword with correct capitalization
    const keywordIndex = KEYWORDS.indexOf(lower)
    if (keywordIndex !== -1) {
      return KEYWORDS[keywordIndex]
    }
  }
  
  // Check triggers (RuleTimer1, Switch1, Power1, etc.)
  const triggerMatch = /^(ruletimer|switch|power|button|sensor|time|system|tele|uptime|wifi|mqtt|serialreceived|serialsend)(\d*)(.*)/i.exec(word)
  if (triggerMatch) {
    const [, base, number, rest] = triggerMatch
    const correctedBase = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase()
    // Special cases
    if (base.toLowerCase() === 'ruletimer') return `RuleTimer${number}${rest}`
    if (base.toLowerCase() === 'serialreceived') return `SerialReceived${number}${rest}`
    if (base.toLowerCase() === 'serialsend') return `SerialSend${number}${rest}`
    if (base.toLowerCase() === 'wifi') return `WiFi${number}${rest}`
    if (base.toLowerCase() === 'mqtt') return `Mqtt${number}${rest}`
    return `${correctedBase}${number}${rest}`
  }
  
  // Check VAR/MEM patterns (VAR1, MEM1, etc.)
  const varMemMatch = /^(var|mem)(\d+)$/i.exec(word)
  if (varMemMatch) {
    const [, base, number] = varMemMatch
    return `${base.toUpperCase()}${number}`
  }
  
  // Check RULE pattern (RULE1, RULE2, etc.)
  const ruleMatch = /^rule(\d+)$/i.exec(word)
  if (ruleMatch) {
    const [, number] = ruleMatch
    return `RULE${number}`
  }
  
  return word // No correction needed
}

// Auto-correct capitalization for entire text
export function correctText(text: string): string {
  if (!text) return text
  
  // Split text into words, preserving boundaries (spaces, newlines, special chars)
  // Use a regex to match words and boundaries separately
  const parts: string[] = []
  let lastIndex = 0
  const wordBoundaryRegex = /([\s\n\r#=<>]+|[^\s\n\r#=<>]+)/g
  let match
  
  while ((match = wordBoundaryRegex.exec(text)) !== null) {
    const part = match[1]
    // If it's a word (not a boundary), correct it
    if (!/[\s\n\r#=<>]/.test(part)) {
      parts.push(correctWord(part))
    } else {
      parts.push(part) // Keep boundaries as-is
    }
    lastIndex = match.index + match[0].length
  }
  
  // Add any remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  
  return parts.join('')
}

export function parseRule(text: string): Token[] {
  const tokens: Token[] = []
  const lines = text.split('\n')

  let globalOffset = 0

  for (const line of lines) {
    const lineTokens = tokenizeLine(line, globalOffset)
    tokens.push(...lineTokens)
    globalOffset += line.length + 1 // +1 for newline
  }

  return tokens
}

export function parseStructured(text: string): StructuredLine[] {
  // First, split by actual line breaks
  let lines = text.split('\n')
  
  // If we only have one line, try to detect structure and split it
  // Handle multiple on...endon blocks in a single line
  if (lines.length === 1 && lines[0].trim().length > 0) {
    const singleLine = lines[0].trim()
    
    // Find all on...endon blocks in the line
    // Pattern: "on" followed by trigger, then "do", then commands, then "endon"
    // Use global regex to find all matches
    const blockPattern = /(on\s+[^\s]+(?:\s+[^\s]+)*?)\s+do\s+(.+?)\s+endon/gi
    const matches: Array<{ trigger: string; commands: string; start: number; end: number }> = []
    
    let match
    while ((match = blockPattern.exec(singleLine)) !== null) {
      const triggerPart = match[1].trim()
      const commandPart = match[2].trim()
      
      // Verify the parts are reasonable
      if (triggerPart && commandPart && !triggerPart.toLowerCase().includes('do') && !triggerPart.toLowerCase().includes('endon')) {
        matches.push({
          trigger: triggerPart,
          commands: commandPart,
          start: match.index,
          end: match.index + match[0].length,
        })
      }
    }
    
    // If we found blocks, split the line
    if (matches.length > 0) {
      const newLines: string[] = []
      let lastIndex = 0
      
      for (const blockMatch of matches) {
        // Add text before this block (if any)
        if (blockMatch.start > lastIndex) {
          const beforeText = singleLine.slice(lastIndex, blockMatch.start).trim()
          if (beforeText) {
            newLines.push(beforeText)
          }
        }
        
        // Add the block split into lines
        newLines.push(`${blockMatch.trigger} do`) // "on trigger do"
        newLines.push(blockMatch.commands) // commands
        newLines.push('endon') // "endon"
        
        lastIndex = blockMatch.end
      }
      
      // Add remaining text after last block (if any)
      if (lastIndex < singleLine.length) {
        const afterText = singleLine.slice(lastIndex).trim()
        if (afterText) {
          newLines.push(afterText)
        }
      }
      
      if (newLines.length > 0) {
        lines = newLines
      }
    }
  }
  
  // Split lines that contain "backlog" with other content - backlog should be alone
  const processedLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    const lowerTrimmed = trimmed.toLowerCase()
    
    // Normalize whitespace first: reduce multiple spaces to single space
    const normalized = trimmed.replace(/\s+/g, ' ')
    
    // Check if line contains "backlog" but is not just "backlog"
    if (lowerTrimmed.includes('backlog') && lowerTrimmed !== 'backlog') {
      // Split by "backlog" - backlog should be on its own line
      // Handle cases where backlog is at start, middle, or end
      const backlogRegex = /\s+backlog\s+/i
      const backlogMatch = normalized.match(backlogRegex)
      
      if (backlogMatch) {
        // Split at the backlog position
        const backlogIndex = normalized.toLowerCase().indexOf('backlog')
        const beforeBacklog = normalized.substring(0, backlogIndex).trim()
        const afterBacklog = normalized.substring(backlogIndex + 7).trim() // "backlog" is 7 chars
        
        // Add content before backlog (if any)
        if (beforeBacklog) {
          processedLines.push(beforeBacklog)
        }
        // Add backlog alone
        processedLines.push('backlog')
        // Add content after backlog (if any)
        if (afterBacklog) {
          processedLines.push(afterBacklog)
        }
      } else {
        // Fallback: check if it starts or ends with backlog
        if (lowerTrimmed.startsWith('backlog ')) {
          processedLines.push('backlog')
          const after = normalized.substring(7).trim()
          if (after) {
            processedLines.push(after)
          }
        } else if (lowerTrimmed.endsWith(' backlog')) {
          const before = normalized.substring(0, normalized.length - 8).trim()
          if (before) {
            processedLines.push(before)
          }
          processedLines.push('backlog')
        } else {
          // Just normalize whitespace
          processedLines.push(normalized)
        }
      }
    } else {
      // Normalize whitespace: reduce multiple spaces to single space
      processedLines.push(normalized)
    }
  }
  lines = processedLines
  const structured: StructuredLine[] = []
  const blockStack: BlockType[] = []
  let inDoBlock = false // Track if we're inside a "do" block
  let afterBacklog = false // Track if we're after a "backlog" line

  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i]
    const trimmedLine = rawLine.trim()
    const lowerLine = trimmedLine.toLowerCase()
    
    // Normalize whitespace: reduce multiple spaces to single space (except for indentation)
    // This normalizes the content but preserves the structure
    const normalizedLine = trimmedLine.replace(/\s+/g, ' ')
    
    // Check if this line is "backlog"
    const isBacklogLine = trimmedLine.toLowerCase() === 'backlog'
    
    // If we're after backlog and hit endon, reset the backlog flag
    if (afterBacklog && trimmedLine.toLowerCase() === 'endon') {
      afterBacklog = false
    }
    
    // If this is a backlog line, it should be alone
    if (isBacklogLine) {
      afterBacklog = true
      rawLine = 'backlog' // Ensure it's exactly "backlog" alone
    }
    
    // Calculate actual offset for tokens
    // If we split a single line, we need to calculate offset from original text
    // Otherwise, calculate from previous lines
    let lineOffset = 0
    if (lines.length > 1 && i > 0) {
      // Calculate offset from original text position
      // Find where this line starts in the original text
      const originalText = text
      let currentPos = 0
      for (let j = 0; j < i; j++) {
        // Find the position of this line in the original text
        const lineStart = originalText.indexOf(lines[j], currentPos)
        if (lineStart !== -1) {
          currentPos = lineStart + lines[j].length
          // Account for newline if it exists
          if (originalText[currentPos] === '\n') {
            currentPos++
          }
        }
      }
      lineOffset = currentPos
    }
    
    const lineTokens = tokenizeLine(rawLine, lineOffset)
    
    let indent = 0
    let blockType: BlockType | null = null

    // Check for block start/end keywords - only match exact patterns
    // Be very strict to avoid false positives
    
    // Match "on trigger do" - must end with " do" exactly
    if (lowerLine.startsWith('on ') && lowerLine.endsWith(' do') && lowerLine.split(/\s+/).length >= 3) {
      // "on trigger do" - block declaration with do, not indented
      blockType = 'on'
      blockStack.push('on')
      inDoBlock = true // We're now in the do block
      indent = blockStack.length - 1 // Indent based on outer blocks only
    }
    // Match "on trigger" - must start with "on " and not contain "do" or "endon"
    else if (lowerLine.startsWith('on ') && !lowerLine.includes(' do') && !lowerLine.includes('endon') && lowerLine.split(/\s+/).length >= 2) {
      // "on trigger" - block declaration without do, not indented
      blockType = 'on'
      blockStack.push('on')
      inDoBlock = false
      indent = blockStack.length - 1 // Indent based on outer blocks only
    }
    // Match exact "do" keyword
    else if (trimmedLine === 'do' && blockStack.length > 0 && blockStack[blockStack.length - 1] === 'on') {
      // "do" - start of on block content, indent this and following lines
      inDoBlock = true
      indent = blockStack.length // Indent based on all blocks including current
    }
    // Match exact "endon" keyword
    else if (trimmedLine === 'endon' && blockStack.length > 0 && blockStack[blockStack.length - 1] === 'on') {
      // "endon" - end of on block
      blockStack.pop()
      inDoBlock = false
      indent = blockStack.length // Back to outer block level
    }
    // Match "if condition" - must start with "if " and have content
    else if (lowerLine.startsWith('if ') && lowerLine.length > 3) {
      // "if condition" - start of if block
      blockType = 'if'
      blockStack.push('if')
      indent = blockStack.length - 1
    }
    // Match "elseif condition" - must start with "elseif " and have content
    else if (lowerLine.startsWith('elseif ') && lowerLine.length > 7 && blockStack.length > 0 && blockStack[blockStack.length - 1] === 'if') {
      // "elseif condition" - else branch of if block
      blockType = 'elseif'
      indent = blockStack.length - 1
    }
    // Match exact "else" keyword
    else if (trimmedLine === 'else' && blockStack.length > 0 && blockStack[blockStack.length - 1] === 'if') {
      // "else" - else branch
      blockType = 'else'
      indent = blockStack.length - 1
    }
    // Match exact "endif" keyword
    else if (trimmedLine === 'endif' && blockStack.length > 0 && blockStack[blockStack.length - 1] === 'if') {
      // "endif" - end of if block
      blockStack.pop()
      indent = blockStack.length
    }
    // Content inside a block - only indent if we're actually in a block
    else if (inDoBlock || blockStack.length > 0) {
      // Content inside a block - indent it
      indent = blockStack.length
    }
    // Everything else - no special handling, just display as-is

    // Normalize whitespace in rawText: reduce multiple spaces/tabs to single space
    // But preserve the structure - we'll add proper indentation in structuredToText
    let normalizedRawText = normalizedLine
    
    // If it's backlog, ensure it's exactly "backlog"
    if (isBacklogLine) {
      normalizedRawText = 'backlog'
    }

    structured.push({
      lineNumber: i,
      indent,
      blockType,
      blockLevel: blockStack.length,
      tokens: lineTokens,
      rawText: normalizedRawText, // Use normalized text with single spaces
    })
  }

  return structured
}

// Convert structured lines back to formatted text with proper line breaks and indentation
export function structuredToText(structured: StructuredLine[]): string {
  let afterBacklog = false
  
  return structured.map((line, _index) => {
    const trimmedText = line.rawText.trim()
    const lowerText = trimmedText.toLowerCase()
    
    // Check if this is a backlog line
    const isBacklogLine = lowerText === 'backlog'
    
    // Track backlog state - set flag when we see backlog
    if (isBacklogLine) {
      afterBacklog = true
    }
    
    // Check if we hit endon after backlog - reset the flag
    if (afterBacklog && lowerText === 'endon') {
      afterBacklog = false
    }
    
    // Calculate base indentation (5 spaces per indent level)
    let indent = '     '.repeat(Math.floor(line.indent)) // 5 spaces per indent level
    
    // Add extra 3 spaces if we're after backlog (until endon)
    // This applies to all lines after backlog, except backlog itself and endon
    if (afterBacklog && !isBacklogLine && lowerText !== 'endon') {
      indent += '   ' // Add 3 extra spaces
    }
    
    // Remove leading whitespace from rawText (to avoid double indentation)
    // The rawText is already normalized (single spaces)
    const trimmedLeading = trimmedText
    
    // Add the calculated indentation + the text without leading whitespace
    return indent + trimmedLeading
  }).join('\n')
}

// Convert structured lines to compact format (blocks in single lines) for editing
export function structuredToCompact(structured: StructuredLine[]): string {
  const result: string[] = []
  let currentBlock: string[] = []
  let currentIndent = 0

  for (let i = 0; i < structured.length; i++) {
    const line = structured[i]
    const trimmed = line.rawText.trim()

    // Check if this is the start of an "on" block
    if (line.blockType === 'on' && trimmed.toLowerCase().startsWith('on ') && trimmed.toLowerCase().endsWith(' do')) {
      // Start new block
      if (currentBlock.length > 0) {
        result.push(currentBlock.join(' '))
      }
      currentBlock = [trimmed]
      currentIndent = line.indent
    }
    // Check if this is "endon"
    else if (trimmed === 'endon' && line.indent === currentIndent) {
      // End current block
      currentBlock.push(trimmed)
      result.push(currentBlock.join(' '))
      currentBlock = []
    }
    // Check if this is content inside a block
    else if (currentBlock.length > 0) {
      currentBlock.push(trimmed)
    }
    // Regular line (not part of a block)
    else {
      if (currentBlock.length > 0) {
        result.push(currentBlock.join(' '))
        currentBlock = []
      }
      const indent = '     '.repeat(line.indent) // 5 spaces per indent level
      result.push(indent + trimmed)
    }
  }

  // Add any remaining block
  if (currentBlock.length > 0) {
    result.push(currentBlock.join(' '))
  }

  return result.join('\n')
}

// Render compact format (for editing mode) - blocks in single lines
export function renderCompact(structured: StructuredLine[], _indentWidth: number = 14.4): string {
  const compactText = structuredToCompact(structured)
  const tokens = parseRule(compactText)
  return renderTokens(tokens, compactText)
}

function tokenizeLine(line: string, lineOffset: number): Token[] {
  const tokens: Token[] = []
  
  // Check for comments (//) - everything after // is a comment
  const commentIndex = line.indexOf('//')
  let codePart = line
  if (commentIndex !== -1) {
    codePart = line.slice(0, commentIndex)
  }
  
  // Split by whitespace, but also split words that end with semicolon
  // This ensures semicolons are always separate tokens, even when attached to words like "on;"
  const parts = codePart.split(/(\s+|;|(?<=[^\s;])(?=;))/)

  let currentOffset = lineOffset

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i]

    if (!part) {
      continue
    }

    // Whitespace - skip but track offset
    if (/^\s+$/.test(part)) {
      currentOffset += part.length
      continue
    }

    // Semicolon - treat as separate token
    if (part === ';') {
      tokens.push({
        type: 'TEXT',
        value: ';',
        start: currentOffset,
        end: currentOffset + 1,
      })
      currentOffset += part.length
      continue
    }

    // If part ends with semicolon, split it
    if (part.endsWith(';') && part.length > 1) {
      const wordPart = part.slice(0, -1)
      
      // Process the word part first
      if (wordPart) {
        let prevToken: Token | null = null
        const start = currentOffset
        const end = start + wordPart.length
        const partLower = wordPart.toLowerCase()
        const isOnOffValue = (partLower === 'on' || partLower === 'off') && tokens.length > 0
        
        if (isOnOffValue) {
          // Check previous non-whitespace token
          for (let j = tokens.length - 1; j >= 0; j--) {
            if (tokens[j].type !== 'TEXT' || tokens[j].value.trim()) {
              prevToken = tokens[j]
              break
            }
          }
          
          if (prevToken && (prevToken.type === 'TOPIC' || prevToken.type === 'TRIGGER' || prevToken.type === 'COMMAND')) {
            const correctedValue = partLower === 'on' ? 'ON' : 'OFF'
            tokens.push({
              type: 'COMMAND',
              value: correctedValue,
              start,
              end,
            })
            currentOffset += wordPart.length
          } else {
            // Process as regular token
            part = wordPart
            // Will be processed below
          }
        } else {
          // Process as regular token
          part = wordPart
          // Will be processed below
        }
        
        // If we already processed on/off, add semicolon and continue
        if (isOnOffValue && prevToken && (prevToken.type === 'TOPIC' || prevToken.type === 'TRIGGER' || prevToken.type === 'COMMAND')) {
          // Add semicolon as separate token
          tokens.push({
            type: 'TEXT',
            value: ';',
            start: currentOffset,
            end: currentOffset + 1,
          })
          currentOffset += 1
          continue
        }
        
        // If word part wasn't processed as on/off value, continue with regular processing below
        // part is already set to wordPart
      }
    }

    const start = currentOffset
    const end = start + part.length

    // Check if "on" or "off" is used as a value (after topic or component)
    const partLower = part.toLowerCase()
    const isOnOffValue = (partLower === 'on' || partLower === 'off') && tokens.length > 0
    
    if (isOnOffValue) {
      // Check previous non-whitespace token to see if it's a topic or component
      let prevToken: Token | null = null
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].type !== 'TEXT' || tokens[j].value.trim()) {
          prevToken = tokens[j]
          break
        }
      }
      
      // If previous token is a topic, trigger, or command (component), treat on/off as value
      if (prevToken && (prevToken.type === 'TOPIC' || prevToken.type === 'TRIGGER' || prevToken.type === 'COMMAND')) {
        // Treat as value - correct to ON/OFF and mark as COMMAND
        const correctedValue = partLower === 'on' ? 'ON' : 'OFF'
        tokens.push({
          type: 'COMMAND',
          value: correctedValue,
          start,
          end,
        })
        currentOffset += part.length
        continue
      }
    }

    // Check for keywords (case-insensitive)
    if (isKeyword(part)) {
      tokens.push({
        type: 'KEYWORD',
        value: part,
        start,
        end,
      })
    }
    // Check for triggers FIRST (before checking for #, because triggers can contain #)
    // Examples: Power1#State, Switch1#State, etc.
    else if (detectTrigger(part)) {
      tokens.push({
        type: 'TRIGGER',
        value: part,
        start,
        end,
      })
    }
    // Check for topics (including full topics like stat/device/topic)
    else if (isTopic(part) || isFullTopic(part)) {
      tokens.push({
        type: 'TOPIC',
        value: part,
        start,
        end,
      })
    }
    // Check if it contains a topic pattern (e.g., "publish stat/device/topic payload")
    else if (part.includes('/') && (part.startsWith('stat/') || part.startsWith('cmnd/') || part.startsWith('tele/'))) {
      // Split by / to find topic parts
      const topicMatch = part.match(/^(stat|cmnd|tele)\/[\w\/]+/)
      if (topicMatch) {
        const topicPart = topicMatch[0]
        const restPart = part.slice(topicPart.length)
        
        // Topic part
        tokens.push({
          type: 'TOPIC',
          value: topicPart,
          start,
          end: start + topicPart.length,
        })
        
        // Rest as text
        if (restPart) {
          tokens.push({
            type: 'TEXT',
            value: restPart,
            start: start + topicPart.length,
            end,
          })
        }
      } else {
        tokens.push({
          type: 'COMMAND',
          value: part,
          start,
          end,
        })
      }
    }
    // Check if it's part of a command (contains #) - but only if it's not already a trigger
    else if (part.includes('#')) {
      tokens.push({
        type: 'COMMAND',
        value: part,
        start,
        end,
      })
    }
    // Default to text
    else {
      tokens.push({
        type: 'TEXT',
        value: part,
        start,
        end,
      })
    }

    currentOffset += part.length

    // Check if there's a semicolon right after this part in the original line.
    // Only add it here if the next part is NOT already ";" (otherwise we'd add it twice:
    // once here and once in the "part === ';'" branch when we process the next part).
    const nextNonWhitespacePart = (() => {
      for (let j = i + 1; j < parts.length; j++) {
        const p = parts[j]
        if (p && !/^\s+$/.test(p)) return p
      }
      return null
    })()
    if (codePart[currentOffset - lineOffset] === ';' && nextNonWhitespacePart !== ';') {
      const lastToken = tokens.length > 0 ? tokens[tokens.length - 1] : null
      if (!lastToken || lastToken.value !== ';') {
        tokens.push({
          type: 'TEXT',
          value: ';',
          start: currentOffset,
          end: currentOffset + 1,
        })
        currentOffset += 1
      }
    }
  }

  return tokens
}

export function renderTokens(tokens: Token[], text: string, enabled: boolean = true): string {
  // First, identify blocks (on...do...endon) to apply zebra stripes
  const lines = text.split('\n')
  const blockIndices: number[] = [] // Maps line index to block index
  let currentBlockIndex = -1
  let inBlock = false
  let waitingForDo = false // Track if we're waiting for "do" after "on trigger"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase()
    
    // Check if line starts a new block: "on trigger do" (all in one line)
    if (line.startsWith('on ') && line.endsWith(' do') && line.split(/\s+/).length >= 3) {
      currentBlockIndex++
      inBlock = true
      waitingForDo = false
      blockIndices[i] = currentBlockIndex
    }
    // Check if line is "on trigger" (without "do") - start of block, waiting for "do"
    else if (line.startsWith('on ') && !line.includes(' do') && !line.includes('endon') && line.split(/\s+/).length >= 2) {
      currentBlockIndex++
      waitingForDo = true
      blockIndices[i] = currentBlockIndex
    }
    // Check if line is "do" and we're waiting for it
    else if (line === 'do' && waitingForDo) {
      inBlock = true
      waitingForDo = false
      blockIndices[i] = currentBlockIndex
    }
    // Check if line is "endon" - end of current block
    else if (line === 'endon' && (inBlock || waitingForDo)) {
      blockIndices[i] = currentBlockIndex
      inBlock = false
      waitingForDo = false
    }
    // If we're inside a block or waiting for "do", assign the same block index
    else if (inBlock || waitingForDo) {
      blockIndices[i] = currentBlockIndex
    }
    // Outside any block
    else {
      blockIndices[i] = -1
    }
  }

  // Sort tokens by start position
  const sortedTokens = [...tokens].sort((a, b) => a.start - b.start)

  // Render line by line
  let result = ''
  let lineStartPos = 0
  
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex]
    const lineEndPos = lineStartPos + lineText.length
    
    // Get tokens for this line
    const lineTokens = sortedTokens.filter(
      token => token.start >= lineStartPos && token.start < lineEndPos
    )
    
    // Render tokens for this line
    let lineHtml = ''
    let lastIndex = 0
    
    for (const token of lineTokens) {
      const relativeStart = token.start - lineStartPos
      const relativeEnd = token.end - lineStartPos
      
      // Add text before token (including separators like ;)
      if (relativeStart > lastIndex) {
        const beforeText = lineText.slice(lastIndex, relativeStart)
        const escapedBefore = escapeHtml(beforeText)
        const withSemicolons = escapedBefore.replace(/;/g, '<span class="text-slate-500 font-semibold">;</span>')
        lineHtml += highlightVariablePercentSigns(withSemicolons)
      }

      // Add token with appropriate class
      const className = getTokenClassName(token.type, enabled)
      const tokenValue = highlightVariablePercentSigns(escapeHtml(token.value))
      lineHtml += `<span class="${className}">${tokenValue}</span>`

      lastIndex = relativeEnd
    }

    // Add remaining text in line (including separators)
    if (lastIndex < lineText.length) {
      const remainingText = lineText.slice(lastIndex)
      const escapedRemaining = escapeHtml(remainingText).replace(/;/g, '<span class="text-slate-500 font-semibold">;</span>')
      lineHtml += highlightVariablePercentSigns(escapedRemaining)
    }
    
    // Determine background color based on block index (zebra stripes)
    // Block 0: no background, Block 1: background, Block 2: no background, etc.
    const blockIndex = blockIndices[lineIndex]
    const isEvenBlock = blockIndex >= 0 && blockIndex % 2 === 1 // Second block (index 1) gets background
    const bgClass = isEvenBlock ? 'bg-slate-700/50' : '' // Match the color used in lists
    
    // Wrap line in div with zebra stripe background if it's part of a block
    // Use exact same styling as before to maintain synchronization with textarea
    result += `<div class="${bgClass}" style="display: block; margin: 0; padding: 0; line-height: 1.5rem; width: 100%; min-height: 1.5rem; box-sizing: border-box;">${lineHtml || '<br>'}</div>`
    
    // Move to next line (account for newline character)
    lineStartPos = lineEndPos + 1
  }

  return result || '<br>'
}

export function renderStructured(structured: StructuredLine[], indentWidth: number = 14.4): string {
  let result = ''

  for (const line of structured) {
    // Skip empty lines or render them as a simple break
    if (!line.rawText.trim() && line.tokens.length === 0) {
      result += `<div style="display: block !important; margin: 0; padding: 0; line-height: 1.5rem; width: 100%; min-height: 1.5rem; box-sizing: border-box;"><br></div>`
      continue
    }

    // Render tokens for this line
    let lineHtml = ''
    let lastIndex = 0

    for (const token of line.tokens) {
      // Calculate relative position within line
      const lineStart = line.tokens[0]?.start || 0
      const relativeStart = token.start - lineStart
      const relativeEnd = token.end - lineStart

      // Add text before token
      if (relativeStart > lastIndex) {
        const beforeText = line.rawText.slice(lastIndex, relativeStart)
        lineHtml += highlightVariablePercentSigns(escapeHtml(beforeText))
      }

      // Add token with appropriate class
      const className = getTokenClassName(token.type)
      lineHtml += `<span class="${className}">${highlightVariablePercentSigns(escapeHtml(token.value))}</span>`

      lastIndex = relativeEnd
    }

    // Add remaining text in line
    if (lastIndex < line.rawText.length) {
      lineHtml += highlightVariablePercentSigns(escapeHtml(line.rawText.slice(lastIndex)))
    }

    // No block styling - removed backgrounds and borders as they were confusing
    let blockStyle = ''

    // Wrap line with indent and block styling
    // Use a single line div that preserves whitespace and matches textarea line-height exactly
    // Calculate indent based on actual character width: 5 spaces per indent level
    // Use measured indentWidth to match exact spacing in textarea
    // indentWidth is per space (typically ~7.2px), so multiply by 5 for 5 spaces per indent level
    const indentPx = line.indent * indentWidth * 5 // 5 spaces per indent level
    // Ensure each div is displayed as a block element to force line breaks
    // Use exact line-height (1.5rem) to match textarea - must be exactly 24px high
    // No margin, no padding (except left for indent) to keep line-height consistent
    const lineDiv = `<div style="display: block !important; padding-left: ${indentPx}px; padding-right: 0; padding-top: 0; padding-bottom: 0; white-space: pre-wrap; margin: 0; margin-top: 0; margin-bottom: 0; line-height: 1.5rem; height: 1.5rem; width: 100%; box-sizing: border-box; overflow: visible; vertical-align: baseline; ${blockStyle}">${lineHtml || '<br>'}</div>`
    result += lineDiv
  }

  return result
}

function getTokenClassName(type: TokenType, enabled: boolean = true): string {
  // If disabled, use light gray for all token types, but preserve font-weight and other formatting
  if (!enabled) {
    switch (type) {
      case 'KEYWORD':
        return 'text-slate-400 font-semibold'
      case 'TOPIC':
        return 'text-slate-400 font-medium'
      case 'TRIGGER':
        return 'text-slate-400'
      case 'COMMAND':
        return 'text-slate-400'
      case 'COMMENT':
        return 'text-slate-500 italic'
      case 'TEXT':
        return 'text-slate-400'
      default:
        return 'text-slate-400'
    }
  }
  
  // Enabled: use original colors
  switch (type) {
    case 'KEYWORD':
      return 'text-amber-400 font-semibold'
    case 'TOPIC':
      return 'text-blue-400 font-medium'
    case 'TRIGGER':
      return 'text-green-400'
    case 'COMMAND':
      return 'text-purple-400 italic'
    case 'COMMENT':
      return 'text-slate-500 italic'
    case 'TEXT':
      return 'text-slate-100'
    default:
      return 'text-slate-100'
  }
}

// Helper function to check if a character should be highlighted as separator
export function isSeparator(char: string): boolean {
  return char === ';' || char === ',' || char === '|'
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/** Zeichenketten der Form %NAME%: die umschließenden % in hellem Grau darstellen (Tasmota-Variablen lesbarer machen). */
function highlightVariablePercentSigns(escapedHtml: string): string {
  return escapedHtml.replace(/%([^%]*)%/g, '<span class="text-slate-400">%</span>$1<span class="text-slate-400">%</span>')
}
