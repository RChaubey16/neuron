import { runWithRequestId } from '../request-context';
import { StructuredLogger } from './structured-logger.service';

describe('StructuredLogger', () => {
  let logger: StructuredLogger;
  let stdoutWrite: jest.SpyInstance;
  let stderrWrite: jest.SpyInstance;

  beforeEach(() => {
    logger = new StructuredLogger();
    stdoutWrite = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrWrite = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  const lastJsonWrittenTo = (
    spy: jest.SpyInstance,
  ): Record<string, unknown> => {
    const [written] = spy.mock.calls[spy.mock.calls.length - 1] as [string];
    return JSON.parse(written) as Record<string, unknown>;
  };

  it('writes a JSON line to stdout for a log-level message, with level/context/message', () => {
    logger.log('hello world', 'MyContext');

    const entry = lastJsonWrittenTo(stdoutWrite);
    expect(entry).toMatchObject({
      level: 'log',
      context: 'MyContext',
      message: 'hello world',
    });
    expect(typeof entry.timestamp).toBe('number');
  });

  it('writes a JSON line to stderr for an error, including the stack trace', () => {
    logger.error('boom', 'Error: boom\n at foo', 'MyContext');

    const entry = lastJsonWrittenTo(stderrWrite);
    expect(entry).toMatchObject({
      level: 'error',
      context: 'MyContext',
      message: 'boom',
      stack: 'Error: boom\n at foo',
    });
  });

  it('omits requestId when logging outside of a request context', () => {
    logger.log('no request in flight');

    const entry = lastJsonWrittenTo(stdoutWrite);
    expect(entry.requestId).toBeUndefined();
  });

  it('stamps the current requestId onto the log line when one is active', () => {
    runWithRequestId('req-123', () => {
      logger.log('inside a request');
    });

    const entry = lastJsonWrittenTo(stdoutWrite);
    expect(entry.requestId).toBe('req-123');
  });
});
