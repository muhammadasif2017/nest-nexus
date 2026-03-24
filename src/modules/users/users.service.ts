import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UserLoader } from './loaders/user.loader';
import { UpdateUserInput } from './dto/update-user.input';
import { plainToInstance } from 'class-transformer';
import { UserOutput } from './dto/user.output';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    // Inject the DataLoader for batched lookups
    private readonly userLoader: UserLoader,
  ) {}

  async findAll(): Promise<UserOutput[]> {
    const users = await this.userModel.find({ isActive: true }).lean().exec();
    // We could also let the SerializeInterceptor do this transform, but
    // calling plainToInstance explicitly here means the service returns
    // a properly typed UserOutput[] — better for testing and composability.
    return plainToInstance(UserOutput, users, { excludeExtraneousValues: true });
  }

  // Uses DataLoader for batching when called from multiple resolvers
  async findById(id: string): Promise<UserOutput> {
    const user = await this.userLoader.batchUsers.load(id);
    if (!user) throw new NotFoundException(`User with id ${id} not found.`);
    return plainToInstance(UserOutput, user, { excludeExtraneousValues: true });
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    // select('+password') explicitly includes the password field,
    // overriding the `select: false` on the schema. Only the auth
    // service should ever call this method.
    return this.userModel.findOne({ email: email.toLowerCase() }).select('+password').exec();
  }

  async update(id: string, dto: UpdateUserInput): Promise<UserOutput> {
    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException(`User with id ${id} not found.`);
    return plainToInstance(UserOutput, updated, { excludeExtraneousValues: true });
  }

  async deactivate(id: string): Promise<UserOutput> {
    return this.update(id, { isActive: false } as any);
  }
}