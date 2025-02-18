import { AssertionLogs } from './types'

export function logAssertionSummary(assertionLogs: AssertionLogs): void {
  if (assertionLogs.createdLogs.length > 0 || assertionLogs.confirmedLogs.length > 0) {
    console.log(
      `Found ${assertionLogs.createdLogs.length} created and ${assertionLogs.confirmedLogs.length} confirmed assertions`
    )

    // Show latest confirmation details
    if (assertionLogs.confirmedLogs.length > 0) {
      const latestConfirmation =
        assertionLogs.confirmedLogs[assertionLogs.confirmedLogs.length - 1]
      console.log('\nLatest confirmation details:')
      console.log('- Block:', latestConfirmation.blockNumber)
      console.log(
        '- Assertion Hash:',
        (latestConfirmation as any).args.assertionHash
      )
      console.log('- Block Hash:', (latestConfirmation as any).args.blockHash)
      console.log('- Send Root:', (latestConfirmation as any).args.sendRoot)
    }
  }
} 