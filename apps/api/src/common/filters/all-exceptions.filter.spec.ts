import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter({} as HttpAdapterHost);

  it('maps a built-in HttpException', () => {
    const body = filter.buildBody(new NotFoundException('Nope'), '/x');
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Nope',
      path: '/x',
    });
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it('keeps validation messages as an array', () => {
    const body = filter.buildBody(
      new BadRequestException(['name must be a string']),
      '/x',
    );
    expect(body.statusCode).toBe(400);
    expect(body.message).toEqual(['name must be a string']);
  });

  it('handles a string response body', () => {
    const body = filter.buildBody(
      new HttpException('Slow down', HttpStatus.TOO_MANY_REQUESTS),
      '/x',
    );
    expect(body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Slow down',
    });
  });

  it('hides details of unexpected errors', () => {
    const body = filter.buildBody(
      new Error('connection string postgres://user:pw@host'),
      '/x',
    );
    expect(body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });
});
