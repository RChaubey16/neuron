import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Returns the default root-route greeting.
   *
   * @returns A static "Hello World!" string
   */
  getHello(): string {
    return 'Hello World!';
  }
}
