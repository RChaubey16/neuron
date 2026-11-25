/**
 * The contract between the API, which adds email jobs, and the worker, which
 * sends them. Both import these so the queue name and job shape can't drift.
 */

/** BullMQ queue that holds emails waiting to be sent. */
export const EMAIL_QUEUE = 'email';

/** Job name for sending one message. */
export const SEND_EMAIL_JOB = 'send';

/**
 * Job payload. Only the message ID: the worker loads the message from Postgres,
 * which stays the single source of truth for its content and status.
 */
export interface SendEmailJobData {
  messageId: string;
}
