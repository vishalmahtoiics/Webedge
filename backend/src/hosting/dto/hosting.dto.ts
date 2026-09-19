import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * A database name and user, as the provider accepts them.
 *
 * The account username prefix is added by the provider when omitted, so what
 * is typed here is the suffix. Restricted to what MySQL identifiers allow —
 * a name with a space or a quote in it fails at the provider with a message
 * nobody can act on.
 */
export class CreateDatabaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(48)
  @Matches(/^[a-z0-9_-]+$/i, {
    message: 'Use letters, digits, underscores and hyphens only.',
  })
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(48)
  @Matches(/^[a-z0-9_-]+$/i, {
    message: 'Use letters, digits, underscores and hyphens only.',
  })
  user!: string;

  @IsString() @MinLength(12) @MaxLength(128)
  password!: string;
}

export class ChangeDatabasePasswordDto {
  @IsString() @MinLength(12) @MaxLength(128)
  password!: string;
}

/**
 * A mailbox local part.
 *
 * The provider's own rule: starts and ends with a letter or digit, with single
 * dots, underscores and hyphens in between. Enforced here so the refusal is a
 * field error rather than a provider round trip.
 */
export class CreateMailboxDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-z0-9]([a-z0-9]|[._-](?![._-]))*[a-z0-9]$|^[a-z0-9]$/i, {
    message: 'Start and end with a letter or digit; single dots, underscores or hyphens between.',
  })
  localPart!: string;

  /** The provider requires upper, lower, a digit and a symbol, minimum eight. */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'Needs an uppercase letter, a lowercase letter, a digit and a symbol.',
  })
  password!: string;

  @IsOptional() @IsUUID()
  customerId?: string;
}
