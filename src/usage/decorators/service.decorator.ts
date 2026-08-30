import { SetMetadata } from '@nestjs/common';

export const SERVICE_KEY = 'service';

/** Tags a route/controller with the service name UsageLoggingInterceptor should log calls under. */
export const Service = (name: string) => SetMetadata(SERVICE_KEY, name);
