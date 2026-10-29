export type TestUser = { id: string; email: string; token: string };

/** Vom globalen Setup angelegte Testdaten (nur lokal, wird am Ende gelöscht). */
export type Fixture = {
  url: string;
  publishableKey: string;
  /** Lokaler service_role-Key aus `supabase status`, nur für Aufbau und Abbau. */
  serviceKey: string;
  users: { a: TestUser; b: TestUser; c: TestUser };
  ids: { district: string; draftA: string; activeB: string; conversation: string; message: string; verificationA: string };
  paths: { docA: string; draftPhotoA: string; activePhotoB: string };
};

declare module "vitest" {
  interface ProvidedContext {
    supabaseFixture: Fixture | null;
  }
}
