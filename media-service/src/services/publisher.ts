interface MediaEventPayload {
  id: string
  ownerId: string
  storedKey: string
  action: 'uploaded' | 'deleted'
  timestamp: string
}

export async function publishMediaEvent(payload: MediaEventPayload): Promise<void> {
  // Placeholder for Kafka/SQS integration.
  // eslint-disable-next-line no-console
  console.log('[media-event]', payload)
}
