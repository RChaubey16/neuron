import { Expose } from 'class-transformer';

/** Shape of a `User` as returned to dashboard clients — an explicit allowlist so new `User` fields aren't exposed by default. */
export class UserResponseDto {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Expose()
  createdAt: Date;

  constructor(partial: Pick<UserResponseDto, 'id' | 'email' | 'createdAt'>) {
    this.id = partial.id;
    this.email = partial.email;
    this.createdAt = partial.createdAt;
  }
}
