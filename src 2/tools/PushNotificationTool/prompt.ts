export const PUSH_NOTIFICATION_TOOL_NAME = 'PushNotification'

export const DESCRIPTION =
  'Send a push notification to the user via ntfy or Pushover'

export const PUSH_NOTIFICATION_TOOL_PROMPT = `Send a real push notification to the user when something should interrupt them outside the terminal.

Use \`title\` for the short heading and \`body\` for the actual message. \`priority\` defaults to \`normal\`. \`tag\` is optional and can be an emoji or short label.`
