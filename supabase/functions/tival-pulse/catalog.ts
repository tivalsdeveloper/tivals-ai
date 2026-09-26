export type CatalogEntry = {
  name: string;
  label: string;
  blurb: string;
};

/** Published Tivalsdeveloper packages on PyPI. */
export const OWNED_PACKAGES: readonly CatalogEntry[] = [
  {
    name: "loadfx",
    label: "loadfx",
    blurb: "Terminal effects, progress bars, and interactive menus",
  },
  {
    name: "tivelweb",
    label: "tivelweb",
    blurb: "Responsive static websites from Python",
  },
  {
    name: "tivalvideo-offline",
    label: "tivalvideo-offline",
    blurb: "Offline narrated video with Piper and FFmpeg",
  },
  {
    name: "tiveltext",
    label: "tiveltext",
    blurb: "ASCII art, Unicode typography, and terminal color",
  },
  {
    name: "tivals-easyos",
    label: "easyos",
    blurb: "Friendly wrappers for common OS tasks",
  },
  {
    name: "tivelop-agent",
    label: "tivelop-agent",
    blurb: "Local coding agent on an OpenAI-compatible Llama server",
  },
  {
    name: "tivaltube",
    label: "tivaltube",
    blurb: "Authorized YouTube downloads via a Python CLI",
  },
] as const;

export const PACKAGE_NAMES = OWNED_PACKAGES.map((p) => p.name);

export function isOwnedPackage(name: string): boolean {
  return OWNED_PACKAGES.some((p) => p.name === name);
}

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

export function assertSafePackageName(name: string): string {
  if (!SAFE_NAME.test(name) || name.length > 80) {
    throw new Error("Invalid package name");
  }
  return name;
}
