export type AppBindings = CloudflareBindings & {
  ADMIN_API_KEY?: string;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    requestId: string;
  };
};

export interface QueueEvent {
  eventId: string;
  eventType: "source.process" | "search.index" | "restaurant.reindex";
  entityId: string;
  attempt: number;
  createdAt: string;
}
