import { ProfileRepository } from "../storage/repositories/profile-repository.js";

export type UserProfile = {
  userId: string;
  preferredName?: string;
  preferredStyle?: string;
  preferredPersonaId?: string;
};

export class UserProfileStore {
  private readonly repository = new ProfileRepository();

  upsert(profile: UserProfile): void {
    this.repository.upsert(profile);
  }

  get(userId: string): UserProfile | undefined {
    return this.repository.get(userId);
  }
}
