const formaSdkUrl = "https://esm.sh/forma-embedded-view-sdk/auto";

type AuthConfig = {
  clientId: string;
  callbackUrl: string;
  scopes: string[];
};

type ProjectRecord = {
  latitude?: number;
  longitude?: number;
};

export type FormaSdk = {
  auth: {
    configure(config: AuthConfig): void;
    acquireTokenOverlay(): Promise<{
      accessToken?: string;
    }>;
  };
  project: {
    getGeoLocation(): Promise<readonly [number, number] | null>;
    get(): Promise<ProjectRecord | null>;
  };
  getProjectId(): string;
  getRegion?: () => string;
  onEmbeddedViewClosing?: (handler: () => Promise<void> | void) => void;
};

let formaPromise: Promise<FormaSdk> | null = null;

export function loadForma() {
  if (!formaPromise) {
    formaPromise = import(/* @vite-ignore */ formaSdkUrl).then(
      (module) => module.Forma as FormaSdk,
    );
  }

  return formaPromise;
}
