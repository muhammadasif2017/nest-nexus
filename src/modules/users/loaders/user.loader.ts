import { Injectable, Scope } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import DataLoader from 'dataloader';
import { User, UserDocument } from '../schemas/user.schema';

// Scope.REQUEST is CRITICAL here. It means a new DataLoader instance is created
// for every incoming GraphQL request, and thrown away when the request ends.
// This is what makes the per-request batching window work correctly.
// A singleton DataLoader would leak data between requests (a serious security bug).
@Injectable({ scope: Scope.REQUEST })
export class UserLoader {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  // The loader is created lazily (first time it's accessed on the request).
  // The batch function receives an array of all the IDs requested within
  // the current event loop tick, makes ONE query, then returns the results
  // in the EXACT same order as the input IDs (DataLoader requires this).
  readonly batchUsers = new DataLoader<string, UserDocument | null>(
    async (userIds: readonly string[]) => {
      const users = await this.userModel
        .find({ _id: { $in: userIds } })
        .lean()
        .exec();

      // Build a Map for O(1) lookup when we reassemble the ordered results
      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      // Preserve input order — DataLoader will throw if lengths don't match
      return userIds.map((id) => userMap.get(id) ?? null) as any;
    },
    {
      // Cache results within the same request — if two resolvers ask for the
      // same userId, DataLoader returns the cached result without a new query.
      // This cache is safe because the DataLoader is request-scoped (destroyed after each request).
      cache: true,
    },
  );
}