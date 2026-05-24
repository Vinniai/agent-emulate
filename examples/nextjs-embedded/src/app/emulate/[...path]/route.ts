import { createEmulateHandler } from "@emulators/adapter-next";
import * as github from "@emulators/github";
import * as google from "@emulators/google";

export const { GET, POST, PUT, PATCH, DELETE } = createEmulateHandler({
  services: {
    github: {
      emulator: github,
      seed: {
        users: [
          { login: "admin", name: "Admin User", email: "admin@agent-emulate.dev" },
          { login: "designer", name: "Creative Director", email: "designer@agent-emulate.dev" },
          { login: "editor", name: "Content Editor", email: "editor@agent-emulate.dev" },
        ],
      },
    },
    google: {
      emulator: google,
      seed: {
        users: [
          { email: "admin@agent-emulate.dev", name: "Admin User" },
          { email: "designer@agent-emulate.dev", name: "Creative Director" },
          { email: "editor@agent-emulate.dev", name: "Content Editor" },
        ],
      },
    },
  },
});
