/**
 * Remove comments from rule text and convert to single-line format for Tasmota
 * Tasmota Rules must be in a single line, separated by semicolons
 * Comments are lines or parts of lines starting with //
 */

export function removeComments(text: string): string {
  const lines = text.split('\n')
  const cleanedLines: string[] = []
  
  // First pass: remove comments
  for (const line of lines) {
    // Find comment marker (//)
    const commentIndex = line.indexOf('//')
    if (commentIndex === -1) {
      // No comment, keep line as-is (but trim)
      const trimmed = line.trim()
      if (trimmed.length > 0) {
        cleanedLines.push(trimmed)
      }
    } else {
      // Remove comment and trailing whitespace
      const codePart = line.slice(0, commentIndex).trimEnd()
      if (codePart.trim().length > 0) {
        cleanedLines.push(codePart.trim())
      }
    }
  }
  
  if (cleanedLines.length === 0) {
    return ''
  }
  
  // Second pass: convert to single line format
  // Tasmota format: "on trigger do command1; command2; endon"
  const result: string[] = []
  let inBlock = false // Track if we're inside an "on...do...endon" block
  let blockCommands: string[] = [] // Commands within current block
  let currentOnLine = '' // Track "on trigger" line
  
  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i].trim()
    if (!line) continue
    
    const lowerLine = line.toLowerCase()
    
    // Check if line starts a new block: "on trigger do" or "on trigger" followed by "do" on next line
    if (lowerLine.startsWith('on ') && (lowerLine.includes(' do') || lowerLine.endsWith(' do'))) {
      // Start of new block: "on trigger do"
      if (inBlock && blockCommands.length > 0) {
        // Close previous block if any
        result.push(blockCommands.join('; '))
        result.push('endon')
      }
      result.push(line) // "on trigger do"
      inBlock = true
      blockCommands = []
      currentOnLine = ''
    } else if (lowerLine.startsWith('on ') && !lowerLine.includes(' do')) {
      // "on trigger" without "do" - check if next line is "do"
      if (i + 1 < cleanedLines.length && cleanedLines[i + 1].trim().toLowerCase() === 'do') {
        // Close previous block if any
        if (inBlock && blockCommands.length > 0) {
          result.push(blockCommands.join('; '))
          result.push('endon')
        }
        result.push(line) // "on trigger"
        result.push('do') // "do" from next line
        i++ // Skip next line
        inBlock = true
        blockCommands = []
        currentOnLine = ''
      } else {
        // Store "on trigger" and wait for "do"
        currentOnLine = line
      }
    } else if (lowerLine === 'do' && currentOnLine) {
      // "do" on its own line after "on trigger"
      if (inBlock && blockCommands.length > 0) {
        result.push(blockCommands.join('; '))
        result.push('endon')
      }
      result.push(currentOnLine) // "on trigger"
      result.push('do')
      inBlock = true
      blockCommands = []
      currentOnLine = ''
    } else if (lowerLine === 'endon') {
      // End of block
      if (blockCommands.length > 0) {
        // Add commands separated by semicolons
        result.push(blockCommands.join('; '))
        blockCommands = []
      }
      result.push('endon')
      inBlock = false
      currentOnLine = ''
    } else {
      // Regular command or line
      if (inBlock) {
        // Inside block: collect commands
        blockCommands.push(line)
      } else if (currentOnLine) {
        // We have "on trigger" but no "do" yet - this might be a command, treat as new block
        result.push(currentOnLine)
        result.push('do')
        inBlock = true
        blockCommands = [line]
        currentOnLine = ''
      } else {
        // Outside block: add directly
        result.push(line)
      }
    }
  }
  
  // Close any open block
  if (inBlock && blockCommands.length > 0) {
    result.push(blockCommands.join('; '))
    result.push('endon')
  } else if (currentOnLine) {
    // We have "on trigger" but no "do" - add it as-is
    result.push(currentOnLine)
  }
  
  // Join all parts with spaces
  // Final format: "on trigger do command1; command2; endon on trigger2 do command3; endon"
  return result.join(' ')
}
