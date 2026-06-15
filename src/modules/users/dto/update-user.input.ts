import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;
}
