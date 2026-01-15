import dotenv from 'dotenv'
dotenv.config({ path: '../../.env' })

export const sanitizeSlackMessage = (message: string): string => {
  const allKeys = Object.keys(process.env)
  const sensitiveKeyContent = ['NEXT', 'API', 'KEY', 'MONITOR', 'INFURA', 'RPC']

  // Filter sensitive keys based on the predefined content list
  const sensitiveKeys = allKeys.filter(key =>
    sensitiveKeyContent.some(content => key.includes(content))
  )

  // Sanitize the message by replacing occurrences of sensitive keys with ***
  let sanitizedMessage = message
  sensitiveKeys.forEach(sensitiveKey => {
    const value = process.env[sensitiveKey]

    // make sure the value is not undefined or blank
    if (typeof value !== 'undefined' && String(value).trim().length > 0) {
      const regex = new RegExp(String(value).trim(), 'g')
      sanitizedMessage = sanitizedMessage.replace(regex, '***')
    }
  })

  return sanitizedMessage
}
