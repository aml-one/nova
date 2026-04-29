import type { ChatMessage } from "@nova/sdk/provider";

export class ShortTermStore {
  private readonly turns = new Map<string, ChatMessage[]>();

  append(userId: string, message: ChatMessage): void {
    const existing = this.turns.get(userId) ?? [];
    this.turns.set(userId, [...existing, message].slice(-12));
  }

  get(userId: string): ChatMessage[] {
    return this.turns.get(userId) ?? [];
  }
}
